/* WalkWell — frontend logic (vanilla JS) */
(function () {
  'use strict';

  const tabs = document.querySelector('.tabs');
  const tabButtons = document.querySelectorAll('.tab');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const toast = document.getElementById('toast');

  let toastTimer = null;

  function showToast(msg, type) {
    toast.textContent = msg;
    toast.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.className = 'toast ' + (type || '');
    }, 3200);
  }

  /* ---------- Tab switching ---------- */
  function switchTab(name) {
    if (tabs.classList.contains('signup') && name === 'signup') return;
    if (!tabs.classList.contains('signup') && name === 'login') return;

    if (name === 'signup') {
      tabs.classList.add('signup');
      loginForm.classList.remove('active');
      signupForm.classList.add('active');
    } else {
      tabs.classList.remove('signup');
      signupForm.classList.remove('active');
      loginForm.classList.add('active');
    }
    tabButtons.forEach(function (b) {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  tabButtons.forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });

  /* ---------- Password visibility toggle ---------- */
  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const input = document.getElementById(btn.dataset.target);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.style.opacity = show ? '1' : '0.55';
      btn.textContent = show ? '🙈' : '👁';
    });
  });

  /* ---------- Inline error helpers ---------- */
  function setError(input, msg) {
    const field = input.closest('.field');
    const errEl = document.querySelector('.error-msg[data-for="' + input.id + '"]');
    if (field) field.classList.toggle('invalid', !!msg);
    if (errEl) {
      errEl.textContent = msg || '';
      errEl.classList.toggle('show', !!msg);
    }
  }
  function clearErrors(form) {
    form.querySelectorAll('input').forEach(function (i) { setError(i, ''); });
  }

  /* ---------- Button loading state ---------- */
  function setLoading(btn, loading) {
    btn.classList.toggle('loading', loading);
    btn.disabled = loading;
  }

  /* ---------- Generic form submit ---------- */
  function postJSON(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  /* ---------- LOGIN ---------- */
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors(loginForm);

    const userId = document.getElementById('login-userId').value.trim();
    const password = document.getElementById('login-password').value;
    let valid = true;

    if (!userId) { setError(document.getElementById('login-userId'), 'User ID is required.'); valid = false; }
    if (!password) { setError(document.getElementById('login-password'), 'Password is required.'); valid = false; }
    if (!valid) return;

    const btn = loginForm.querySelector('.btn');
    setLoading(btn, true);

    postJSON('/api/login', { userId: userId, password: password })
      .then(function (r) {
        if (r.ok) {
          showToast(r.body.message || 'Login successful.', 'ok');
          localStorage.setItem('walkwell_token', r.body.token);
          loginForm.reset();
        } else {
          showToast(r.body.message || 'Login failed.', 'err');
          setError(document.getElementById('login-password'), r.body.message || '');
        }
      })
      .catch(function () {
        showToast('Network error. Is the server running?', 'err');
      })
      .then(function () { setLoading(btn, false); });
  });

  /* ---------- SIGNUP ---------- */
  signupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors(signupForm);

    const userId = document.getElementById('signup-userId').value.trim();
    const name = document.getElementById('signup-name').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    let valid = true;

    if (userId.length < 3) { setError(document.getElementById('signup-userId'), 'User ID must be at least 3 characters.'); valid = false; }
    if (!name) { setError(document.getElementById('signup-name'), 'Full name is required.'); valid = false; }
    if (password.length < 8) { setError(document.getElementById('signup-password'), 'Password must be at least 8 characters.'); valid = false; }
    if (confirm !== password) { setError(document.getElementById('signup-confirm'), 'Passwords do not match.'); valid = false; }
    if (!valid) return;

    const btn = signupForm.querySelector('.btn');
    setLoading(btn, true);

    postJSON('/api/signup', { userId: userId, name: name, password: password })
      .then(function (r) {
        if (r.ok) {
          showToast(r.body.message || 'Account created. Please sign in.', 'ok');
          localStorage.setItem('walkwell_token', r.body.token);
          signupForm.reset();
          setTimeout(function () { switchTab('login'); }, 900);
        } else {
          showToast(r.body.message || 'Signup failed.', 'err');
          if (r.status === 409) setError(document.getElementById('signup-userId'), r.body.message);
        }
      })
      .catch(function () {
        showToast('Network error. Is the server running?', 'err');
      })
      .then(function () { setLoading(btn, false); });
  });

  /* ---------- Info links ---------- */
  document.querySelectorAll('[data-info]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      showToast(a.dataset.info, '');
    });
  });

  /* ---------- On load: verify health quietly ---------- */
  fetch('/api/health').catch(function () {});

  /* ---------- Deep link to a tab: ?tab=signup (or #signup) ---------- */
  (function openFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var tab = params.get('tab') || (window.location.hash || '').replace('#', '');
    if (tab === 'signup' || tab === 'login') switchTab(tab);
  })();
})();