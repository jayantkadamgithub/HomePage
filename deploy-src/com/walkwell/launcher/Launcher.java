package com.walkwell.launcher;

import java.awt.Desktop;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Enumeration;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * WalkWell deployment launcher.
 *
 * Run with:  java -jar walking-app-deploy.jar [--port 3000]
 *
 * What it does:
 *  1. Extracts the bundled project from the JAR to a "walkwell-app" folder next to the JAR.
 *  2. Locates Node.js (node on PATH, or a common Windows install location).
 *  3. Runs `npm install` on first launch (when node_modules is missing).
 *  4. Starts `node src/server.js`.
 *  5. Opens http://localhost:<port> in the default browser.
 *  6. Stops the Node process when the launcher exits (Ctrl+C).
 */
public final class Launcher {

    private static Process serverProcess;
    private static String port = "3000";

    public static void main(String[] args) {
        try {
            parseArgs(args);
            Path jarPath = getJarPath();
            Path deployDir = jarPath.getParent().resolve("walkwell-app");

            System.out.println("[WalkWell] Launcher starting...");
            System.out.println("[WalkWell] JAR      : " + jarPath);
            System.out.println("[WalkWell] Deploy  : " + deployDir);

            extractBundledApp(deployDir);
            String portValue = resolvePort(deployDir);
            String node = findNode();
            if (node == null) {
                System.err.println("[WalkWell] ERROR: Node.js not found. Install Node.js from https://nodejs.org and retry.");
                System.exit(1);
                return;
            }
            System.out.println("[WalkWell] Node     : " + node);

            if (!Files.exists(deployDir.resolve("node_modules"))) {
                System.out.println("[WalkWell] First run: installing npm dependencies (this may take a minute)...");
                runCommand(deployDir, npmInstallCommand(), node);
            }

            System.out.println("[WalkWell] Starting server on port " + portValue + "...");
            startServer(deployDir, node, portValue);

            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                if (serverProcess != null && serverProcess.isAlive()) {
                    System.out.println("[WalkWell] Stopping server...");
                    serverProcess.destroy();
                    try { serverProcess.waitFor(5, java.util.concurrent.TimeUnit.SECONDS); }
                    catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                    if (serverProcess.isAlive()) serverProcess.destroyForcibly();
                }
            }));

            try { Thread.sleep(1500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            openBrowser(portValue);

            System.out.println("[WalkWell] Ready at http://localhost:" + portValue);
            System.out.println("[WalkWell] Press Ctrl+C to stop.");

            int exit = serverProcess.waitFor();
            System.out.println("[WalkWell] Node process exited with code " + exit);
            System.exit(exit);
        } catch (Exception e) {
            System.err.println("[WalkWell] FATAL: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }

    /** Support: --port 3001  or  --port=3001  or  3001 */
    private static void parseArgs(String[] args) {
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if (a.startsWith("--port=")) {
                port = a.substring(7).trim();
            } else if (a.equals("--port") && i + 1 < args.length) {
                port = args[++i].trim();
            } else if (a.matches("\\d+")) {
                port = a;
            }
        }
    }

    private static Path getJarPath() throws Exception {
        File f = new File(Launcher.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        return f.toPath().toAbsolutePath().normalize();
    }

    /** Copy every entry under app/ in the JAR into the deploy directory. */
    private static void extractBundledApp(Path target) throws Exception {
        Path jar = getJarPath();
        Files.createDirectories(target);
        int count = 0;
        try (JarFile jf = new JarFile(jar.toFile())) {
            Enumeration<JarEntry> entries = jf.entries();
            while (entries.hasMoreElements()) {
                JarEntry e = entries.nextElement();
                if (e.isDirectory() || !e.getName().startsWith("app/")) continue;
                String rel = e.getName().substring("app/".length());
                if (rel.isEmpty()) continue;
                Path out = target.resolve(rel).normalize();
                if (!out.startsWith(target)) continue; // safety: no path traversal
                Files.createDirectories(out.getParent());
                try (InputStream in = jf.getInputStream(e)) {
                    Files.copy(in, out, StandardCopyOption.REPLACE_EXISTING);
                }
                count++;
            }
        }
        if (count == 0) {
            throw new IllegalStateException("No bundled app/ files found inside the JAR.");
        }
        System.out.println("[WalkWell] Extracted " + count + " project files.");
    }

    /** PORT override from CLI beats the .env value. */
    private static String resolvePort(Path deployDir) {
        if (port != null && !port.isEmpty()) return port;
        Path env = deployDir.resolve(".env");
        if (Files.exists(env)) {
            try (BufferedReader r = Files.newBufferedReader(env, StandardCharsets.UTF_8)) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (line.trim().startsWith("PORT=")) {
                        String v = line.trim().substring(5).trim();
                        if (!v.isEmpty()) return v;
                    }
                }
            } catch (Exception ignored) { }
        }
        return "3000";
    }

    private static String findNode() {
        String[] candidates = { "node", "node.exe" };
        for (String c : candidates) {
            try {
                Process p = new ProcessBuilder(c, "--version")
                    .redirectErrorStream(true).start();
                String out = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))
                    .readLine();
                int code = p.waitFor();
                if (code == 0 && out != null && out.toLowerCase().startsWith("v")) {
                    // Resolve the real executable path so npm (in the same folder) is on PATH.
                    return resolveExecutable(c);
                }
            } catch (Exception ignored) { }
        }
        // Common Windows install locations
        String[] winPaths = {
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\Program Files (x86)\\nodejs\\node.exe"
        };
        for (String p : winPaths) {
            if (new File(p).exists()) return p;
        }
        return null;
    }

    /** Use `where.exe` (Windows) / `which` (Unix) to find the full path of a command. */
    private static String resolveExecutable(String cmd) {
        String finder = isWindows() ? "where.exe" : "which";
        try {
            Process p = new ProcessBuilder(finder, cmd).redirectErrorStream(true).start();
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = r.readLine()) != null) {
                if (!line.trim().isEmpty()) return line.trim();
            }
        } catch (Exception ignored) { }
        return cmd; // fallback: bare command name
    }

    private static String[] npmInstallCommand() {
        return isWindows()
            ? new String[] { "cmd", "/c", "npm", "install" }
            : new String[] { "npm", "install" };
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private static void runCommand(Path dir, String[] command, String node) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(dir.toFile());
        pb.redirectOutput(ProcessBuilder.Redirect.INHERIT);
        pb.redirectError(ProcessBuilder.Redirect.INHERIT);
        // Ensure npm.cmd can find the same node
        pb.environment().put("PATH", pb.environment().getOrDefault("PATH", "")
            + File.pathSeparator + new File(node).getAbsoluteFile().getParent());
        Process p = pb.start();
        int code = p.waitFor();
        if (code != 0) throw new IllegalStateException("npm install failed with code " + code);
    }

    private static void startServer(Path dir, String node, String portValue) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(node, "src/server.js");
        pb.directory(dir.toFile());
        pb.redirectOutput(ProcessBuilder.Redirect.INHERIT);
        pb.redirectError(ProcessBuilder.Redirect.INHERIT);
        pb.environment().put("PORT", portValue);
        serverProcess = pb.start();
    }

    private static void openBrowser(String portValue) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(new URI("http://localhost:" + portValue));
            } else {
                System.out.println("[WalkWell] Open http://localhost:" + portValue + " in your browser.");
            }
        } catch (Exception e) {
            System.out.println("[WalkWell] Could not auto-open browser: " + e.getMessage());
        }
    }
}
