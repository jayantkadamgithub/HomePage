# WalkWell — Deployment JAR Guide

## 📦 Artifact

**`D:\HomePage\walking-app-deploy.jar`** (43 KB)

A Java launcher JAR that bundles the complete WalkWell project (frontend, Node.js backend,
SQL schema, and docs). Running it extracts the project, installs npm dependencies on first
launch, starts the Node server, and opens the site in your browser.

---

## ✅ Prerequisites on the target machine

| Requirement | Notes |
|-------------|-------|
| **Java (JRE 11+)** | Built and tested with OpenJDK 21. Check: `java -version` |
| **Node.js 18+ with npm** | Check: `node -v` and `npm -v`. Download from <https://nodejs.org> |
| **Oracle DB (optional)** | Only if you want real persistence. The bundled `.env` points to `localhost:1521/FREEPDB1` with `demouser/demouser`. Tables must exist (`sql/schema.sql`). Otherwise set `USE_MOCK_DB=true` in the extracted `.env`. |

> The JAR does **not** bundle Node.js or `node_modules` — it runs `npm install` on first
> launch (needs internet access) using the machine's Node/npm.

---

## 🚀 How to run

### Option A — Command line
```powershell
cd D:\HomePage
java -jar walking-app-deploy.jar
```
Then open **http://localhost:3000**.

Use a different port if 3000 is busy:
```powershell
java -jar walking-app-deploy.jar --port 3001
```

### Option B — Double-click
Run **`run-deploy.bat`** (opens the app on port 3000 and keeps the console window).

---

## 🔍 What happens on first launch

```
[WalkWell] Launcher starting...
[WalkWell] Extracted 20 project files.
[WalkWell] Node     : C:\Program Files\nodejs\node.exe
[WalkWell] First run: installing npm dependencies (this may take a minute)...
[WalkWell] Starting server on port 3000...
[db] connected to Oracle
Walking App running at http://localhost:3000
[WalkWell] Ready at http://localhost:3000
[WalkWell] Press Ctrl+C to stop.
```

1. The JAR extracts its `app/` contents to a folder **next to the JAR**:
   `D:\HomePage\walkwell-app`
2. If `walkwell-app\node_modules` is missing, it runs `npm install` there.
3. It starts `node src/server.js` with `PORT` set.
4. It opens the browser automatically (falls back to printing the URL in headless environments).
5. **Ctrl+C** stops the launcher and its Node child process (shutdown hook).

Subsequent launches skip `npm install` and start faster.

---

## ⚙️ Configuration

Edit `D:\HomePage\walkwell-app\.env` (created from the bundled copy) to change:

| Variable | Purpose |
|----------|---------|
| `PORT` | Default `3000` (CLI `--port` overrides it) |
| `USE_MOCK_DB` | `false` = real Oracle (default), `true` = in-memory mock |
| `ORACLE_USER` / `ORACLE_PASSWORD` / `ORACLE_CONNECTION_STRING` | Oracle credentials |
| `JWT_SECRET` | Change before production |

If you change config, restart the launcher.

---

## 🧭 Project layout inside the JAR

```
walking-app-deploy.jar
├── META-INF/MANIFEST.MF      (Main-Class: com.walkwell.launcher.Launcher)
├── com/walkwell/launcher/Launcher.class
└── app/
    ├── public/               (HTML, CSS, JS)
    ├── src/                  (server, routes, controllers, db config)
    ├── sql/schema.sql        (Oracle DDL)
    ├── tests/                (Jest + Supertest)
    ├── .env / .env.example
    └── package.json
```

---

## 🛠️ Rebuilding the JAR (after changing code)

```powershell
cd D:\HomePage
# 1. Refresh the staging copy (app/) with latest project files
# 2. Compile the launcher
javac -d build\classes deploy-src\com\walkwell\launcher\Launcher.java
# 3. Repackage
jar --create --file walking-app-deploy.jar `
    --main-class com.walkwell.launcher.Launcher `
    -C build\classes . -C build\stage app
```

Source of the launcher: `deploy-src\com\walkwell\launcher\Launcher.java`.

---

## ✅ Verification performed

- `java -jar walking-app-deploy.jar --port 3001` → extracted 20 files, ran `npm install`
  (376 packages), started server in **Oracle** mode.
- `GET /api/health` → `{"ok":true,"mode":"oracle"}`
- Live signup + login through the deployed instance → both succeeded.
- Shutdown hook stops the child Node process cleanly.

---

## ⚠️ Notes

- The bundled `.env` contains local dev DB credentials (`demouser/demouser`). For production,
  replace them and set a strong `JWT_SECRET`.
- `npm audit` reports dependency advisories from transitive packages; review before production.
- For a true single-file deployment with no Java/Node requirement, consider a native
  executable (`pkg`/`nexe`) or a Docker image instead of a JAR.
