const express = require('express');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const multer = require('multer');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Middleware CORS dasar
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-ID, X-CSRF-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } 
});

const ADMIN_USER = process.env.ADMIN_USER || "shadow";
const ADMIN_PASS = process.env.ADMIN_PASS || "rizky123@";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

let PRIVATE_KEY = process.env.PRIVATE_KEY || '';
if (!PRIVATE_KEY) {
  try {
    const kp = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    PRIVATE_KEY = kp.privateKey;
  } catch (e) {
    console.error("Gagal generate RSA key otomatis:", e.message);
  }
}

const activeAdminSessions = new Map();

function toUrlSafeBase64(buffer) {
  return buffer.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateAdminSessionToken(username) {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(username + Date.now().toString());
  return hmac.digest('hex');
}

const requireAuth = (req, res, next) => {
  try {
    const sessionToken = req.cookies && req.cookies.admin_session;
    if (sessionToken && activeAdminSessions.has(sessionToken)) {
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const clientCsrf = req.headers['x-csrf-token'] || req.body._csrf;
        const storedCsrf = activeAdminSessions.get(sessionToken).csrfToken;
        if (!clientCsrf || clientCsrf !== storedCsrf) {
          return res.status(403).json({ ok: false, message: "CSRF token tidak valid!" });
        }
      }
      return next();
    }
  } catch (err) {}

  if (req.xhr || req.path.startsWith('/api/admin/')) {
    return res.status(401).json({ ok: false, message: "Autentikasi diperlukan." });
  }

  return res.redirect('/login');
};

async function initDB(sql) {
  await sql`CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    license_key TEXT UNIQUE NOT NULL,
    days_valid INT DEFAULT 30,
    unit VARCHAR(10) DEFAULT 'days',
    max_devices INT DEFAULT 1,
    device_id TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NULL
  )`;

  await sql`CREATE TABLE IF NOT EXISTS runtime_files (
    id SERIAL PRIMARY KEY,
    filename TEXT,
    file_data TEXT,
    sha256 VARCHAR(64),
    size BIGINT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  )`;
  
  try {
    await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS session_token TEXT DEFAULT ''`;
    await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ NULL`;
    await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE`;
  } catch (e) {}
}

async function handleLicenseActivation(req, res) {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diset!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);

    const license_key = req.body.license_key || req.query.license_key;
    const clientDevice = req.body.device_id || req.headers['x-device-id'] || "unknown";

    if (!license_key) return res.json({ ok: false, message: "Key wajib diisi!" });

    const result = await sql`SELECT * FROM licenses WHERE license_key = ${String(license_key).trim()}`;
    if (result.length === 0) return res.json({ ok: false, message: "Key tidak valid!" });

    const record = result[0];
    const nowMs = Date.now();

    if (record.suspended) return res.json({ ok: false, message: "Acesso suspenso pelo servidor." });
    if (record.expires_at && nowMs > new Date(record.expires_at).getTime()) {
      return res.json({ ok: false, message: "Key sudah kedaluwarsa!" });
    }

    const maxDevs = record.max_devices || 1;
    let boundDevices = record.device_id ? record.device_id.split(',').map(s => s.trim()).filter(Boolean) : [];

    if (!boundDevices.includes(clientDevice)) {
      if (boundDevices.length < maxDevs) {
        boundDevices.push(clientDevice);
        await sql`UPDATE licenses SET device_id = ${boundDevices.join(',')} WHERE id = ${record.id}`;
      } else {
        return res.json({ ok: false, message: `Slot device penuh! (${boundDevices.length}/${maxDevs})` });
      }
    }

    const serverTimeSec = Math.floor(nowMs / 1000);
    const expiresTimestampSec = record.expires_at ? Math.floor(new Date(record.expires_at).getTime() / 1000) : (serverTimeSec + 86400);
    
    const sessionToken = record.session_token || crypto.randomBytes(32).toString('hex');
    const sessionExpiresAt = record.expires_at ? new Date(record.expires_at) : new Date(nowMs + 10 * 60 * 1000);
    const sessionExpiresSec = Math.floor(sessionExpiresAt.getTime() / 1000);

    await sql`UPDATE licenses SET session_token = ${sessionToken}, session_expires_at = ${sessionExpiresAt.toISOString()} WHERE id = ${record.id}`;

    const licenseIdHex = crypto.createHash('md5').update(record.license_key).digest('hex').toUpperCase();

    const libRows = await sql`SELECT sha256, size, filename FROM runtime_files ORDER BY id DESC LIMIT 1`;
    const libInfo = libRows.length > 0 ? libRows[0] : { sha256: "5726f274b693d2e640625f2c11c4455cac0d2d778381ed0227ae406c860c7fe0", size: 926984, filename: "libshadowcore.so" };

    const hostName = req.get('host');
    const libraryUrl = `https://${hostName}/api/v1/library.php`;

    const licenseData = {
      license_id: licenseIdHex,
      plan: record.plan || "Padrão",
      device_id: clientDevice,
      expires_at: expiresTimestampSec,
      session_expires_at: sessionExpiresSec,
      lib_enabled: true,
      session_token: sessionToken,
      library: {
        version: "2.0.51",
        sha256: libInfo.sha256,
        size: Number(libInfo.size),
        url: libraryUrl
      }
    };

    const base64Data = toUrlSafeBase64(Buffer.from(JSON.stringify(licenseData), 'utf-8'));
    
    let signature = "MIIB";
    try {
      const sign = crypto.createSign('SHA256');
      sign.update(base64Data);
      sign.end();
      signature = toUrlSafeBase64(sign.sign(PRIVATE_KEY));
    } catch (e) {}

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ ok: true, data: base64Data, signature: signature });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Server Error: " + err.message });
  }
}

// ==================== HALAMAN LOGIN HTML ====================
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login - Shadow Admin Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://unpkg.com/lucide@latest"></script>
<style>
  :root {
    --bg-primary: #090d16;
    --bg-secondary: #111827;
    --bg-card: #1f2937;
    --accent: #38bdf8;
    --accent-hover: #0ea5e9;
    --text-main: #f3f4f6;
    --text-muted: #9ca3af;
    --border: #374151;
    --radius: 12px;
  }
  .light-mode {
    --bg-primary: #f8fafc;
    --bg-secondary: #ffffff;
    --bg-card: #f1f5f9;
    --accent: #0284c7;
    --accent-hover: #0369a1;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --border: #cbd5e1;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; transition: background-color 0.2s, color 0.2s, border-color 0.2s; }
  body { background: var(--bg-primary); color: var(--text-main); display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }
  .login-card { width: 100%; max-width: 400px; background: var(--bg-secondary); padding: 32px 24px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
  .login-header { text-align: center; margin-bottom: 24px; }
  .login-header i { color: var(--accent); width: 48px; height: 48px; margin-bottom: 12px; }
  .login-header h2 { font-size: 1.5rem; color: var(--accent); font-weight: 700; }
  .login-header p { font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; }
  
  .input-group { margin-bottom: 16px; position: relative; }
  label { display: block; font-size: 0.85rem; font-weight: 500; color: var(--text-muted); margin-bottom: 6px; }
  input { width: 100%; padding: 12px 14px; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-main); border-radius: 8px; font-size: 0.95rem; outline: none; }
  input:focus { border-color: var(--accent); }
  
  .password-wrapper { position: relative; }
  .toggle-password { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; }
  .toggle-password:hover { color: var(--text-main); }

  button.btn-login { background: var(--accent); color: #fff; border: none; padding: 12px; width: 100%; border-radius: 8px; font-weight: 600; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px; }
  button.btn-login:hover { background: var(--accent-hover); }
  
  #errorMsg { margin-top: 16px; font-size: 0.85rem; text-align: center; color: #ef4444; font-weight: 500; min-height: 20px; }
  .spinner { width: 18px; height: 18px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="login-card">
  <div class="login-header">
    <i data-lucide="shield-check"></i>
    <h2>Shadow Admin</h2>
    <p>Silakan login untuk mengelola lisensi</p>
  </div>
  <form id="loginForm">
    <div class="input-group">
      <label>Username</label>
      <input type="text" id="username" name="username" autocomplete="username" required placeholder="Masukkan username">
    </div>
    <div class="input-group">
      <label>Password</label>
      <div class="password-wrapper">
        <input type="password" id="password" name="password" autocomplete="current-password" required placeholder="Masukkan password">
        <button type="button" class="toggle-password" id="toggleBtn" onclick="togglePassword()">
          <i data-lucide="eye" style="width:18px;height:18px;" id="eyeIcon"></i>
        </button>
      </div>
    </div>
    <button type="submit" class="btn-login" id="submitBtn">
      <span id="btnText">Login</span>
      <div class="spinner" id="spinner"></div>
    </button>
    <div id="errorMsg"></div>
  </form>
</div>

<script>
  if (localStorage.getItem('shadow_theme') === 'light') {
    document.body.classList.add('light-mode');
  }
  lucide.createIcons();
  function togglePassword() {
    const pwd = document.getElementById('password');
    const icon = document.getElementById('eyeIcon');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      icon.setAttribute('data-lucide', 'eye-off');
    } else {
      pwd.type = 'password';
      icon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errBox = document.getElementById('errorMsg');
    const btnText = document.getElementById('btnText');
    const spinner = document.getElementById('spinner');
    const submitBtn = document.getElementById('submitBtn');

    errBox.innerText = '';
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        window.location.href = '/';
      } else {
        errBox.innerText = data.message || 'Login gagal. Periksa kembali username/password.';
        btnText.style.display = 'inline';
        spinner.style.display = 'none';
        submitBtn.disabled = false;
      }
    } catch (err) {
      errBox.innerText = 'Terjadi kesalahan koneksi ke server.';
      btnText.style.display = 'inline';
      spinner.style.display = 'none';
      submitBtn.disabled = false;
    }
  });
</script>
</body>
</html>`);
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = generateAdminSessionToken(username);
    const csrfToken = crypto.randomBytes(24).toString('hex');
    activeAdminSessions.set(token, { username, csrfToken, createdAt: Date.now() });

    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    return res.json({ ok: true, csrfToken });
  }
  return res.status(401).json({ ok: false, message: "Username atau password salah!" });
});

app.post('/api/admin/logout', requireAuth, (req, res) => {
  const token = req.cookies && req.cookies.admin_session;
  if (token) {
    activeAdminSessions.delete(token);
  }
  res.clearCookie('admin_session');
  return res.json({ ok: true });
});

app.get('/api/admin/csrf', requireAuth, (req, res) => {
  const token = req.cookies && req.cookies.admin_session;
  const session = activeAdminSessions.get(token);
  return res.json({ ok: true, csrfToken: session ? session.csrfToken : '' });
});

// ==================== ADMIN PANEL HTML & ROUTES ====================
app.get('/', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Shadow License Admin Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://unpkg.com/lucide@latest"></script>
<style>
  :root {
    --bg-primary: #090d16;
    --bg-secondary: #111827;
    --bg-card: #1f2937;
    --accent: #38bdf8;
    --accent-hover: #0ea5e9;
    --text-main: #f3f4f6;
    --text-muted: #9ca3af;
    --border: #374151;
    --radius: 12px;
  }
  .light-mode {
    --bg-primary: #f8fafc;
    --bg-secondary: #ffffff;
    --bg-card: #f1f5f9;
    --accent: #0284c7;
    --accent-hover: #0369a1;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --border: #cbd5e1;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; }
  body { background: var(--bg-primary); color: var(--text-main); padding: 24px 16px; min-height: 100vh; display: flex; justify-content: center; }
  .container { width: 100%; max-width: 800px; display: flex; flex-direction: column; gap: 20px; }
  
  header { display: flex; align-items: center; justify-content: space-between; background: var(--bg-secondary); padding: 16px 24px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); flex-wrap: wrap; gap: 12px; }
  header h2 { font-size: 1.25rem; color: var(--accent); display: flex; align-items: center; gap: 10px; font-weight: 700; }
  
  .header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .badge-version { font-size: 0.8rem; color: var(--text-muted); background: var(--bg-card); padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border); }
  
  .btn-icon-top { background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border); padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .btn-icon-top:hover { background: var(--border); }

  .btn-logout { background: #ef4444; color: #fff; border: none; padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; }
  .btn-logout:hover { background: #dc2626; }

  .card { background: var(--bg-secondary); padding: 20px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
  .card-title { font-size: 1rem; font-weight: 600; color: var(--accent); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }

  label { display: block; font-size: 0.85rem; font-weight: 500; color: var(--text-muted); margin-bottom: 6px; }
  input, select { width: 100%; padding: 10px 14px; margin-bottom: 14px; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-main); border-radius: 8px; font-size: 0.9rem; outline: none; }
  input:focus, select:focus { border-color: var(--accent); }
  
  .row-group { display: flex; gap: 10px; }
  
  button { background: var(--accent); color: #fff; border: none; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 0.9rem; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; }
  button:hover { opacity: 0.9; }
  button:active { transform: scale(0.98); }
  button:disabled { opacity: 0.6; cursor: not-allowed; }

  .light-mode button[type="submit"], .light-mode .modal-btn-confirm { color: #fff; }

  .btn-secondary { background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border); width: 100%; padding: 10px 14px; font-size: 0.85rem; border-radius: 8px; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 6px; }
  .btn-secondary:hover { background: var(--border); }

  .btn-delete { background: #ef4444; color: #fff; padding: 6px 12px; font-size: 0.75rem; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .btn-delete:hover { background: #dc2626; }
  .btn-reset { background: #eab308; color: #000; padding: 6px 12px; font-size: 0.75rem; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .btn-suspend { background: #f97316; color: #fff; padding: 6px 12px; font-size: 0.75rem; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .btn-unsuspend { background: #10b981; color: #fff; padding: 6px 12px; font-size: 0.75rem; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .btn-session { background: #6366f1; color: #fff; padding: 6px 12px; font-size: 0.75rem; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }

  .url-box { background: var(--bg-primary); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.82rem; color: var(--accent); word-break: break-all; overflow-wrap: break-word; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .lib-info-box { background: var(--bg-primary); padding: 12px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.85rem; margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px; word-break: break-all; }

  .keys-container { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; }
  .key-item-card { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .key-item-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .key-title { font-family: monospace; color: var(--accent); font-weight: bold; font-size: 0.95rem; word-break: break-all; }
  .key-duration { font-size: 0.8rem; color: var(--text-muted); background: var(--bg-card); padding: 2px 8px; border-radius: 4px; white-space: nowrap; border: 1px solid var(--border); }
  
  .key-details { display: flex; flex-direction: column; gap: 6px; font-size: 0.82rem; }
  .key-row-info { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  
  .device-list-box { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .device-pill { display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); font-size: 0.78rem; color: var(--text-main); gap: 6px; }
  .device-pill-content { display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .device-pill-content span { overflow: hidden; text-overflow: ellipsis; }
  
  .btn-copy-mini { background: var(--border); color: var(--text-main); border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .btn-copy-mini:hover { opacity: 0.8; }

  .actions-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 6px; }
  
  #customModal { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center; align-items: center; z-index: 2000; opacity: 0; pointer-events: none; transition: opacity 0.25s ease; padding: 16px; }
  #customModal.show { opacity: 1; pointer-events: auto; }
  .modal-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); width: 100%; max-width: 360px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); transform: translateY(10px); transition: transform 0.25s ease; display: flex; flex-direction: column; gap: 16px; text-align: center; }
  #customModal.show .modal-box { transform: translateY(0); }
  .modal-icon { width: 48px; height: 48px; border-radius: 50%; background: rgba(56, 189, 248, 0.1); color: var(--accent); display: flex; align-items: center; justify-content: center; margin: 0 auto; }
  .modal-title { font-size: 1.1rem; font-weight: 700; color: var(--text-main); }
  .modal-desc { font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; }
  .modal-actions { display: flex; gap: 10px; margin-top: 4px; }
  .modal-btn { flex: 1; padding: 10px; border-radius: 8px; font-weight: 600; font-size: 0.9rem; cursor: pointer; border: none; }
  .modal-btn-cancel { background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border); }
  .modal-btn-cancel:hover { opacity: 0.8; }
  .modal-btn-confirm { background: var(--accent); color: #fff; }
  .modal-btn-confirm.danger { background: #ef4444; color: #fff; }

  #toast { position: fixed; bottom: 20px; right: 20px; background: #10b981; color: #fff; padding: 12px 20px; border-radius: 8px; font-size: 0.9rem; font-weight: 600; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.2); opacity: 0; transition: opacity 0.3s ease; pointer-events: none; z-index: 3000; }
  #toast.show { opacity: 1; }
  #toast.error { background: #ef4444; }

  .spinner-btn { width: 16px; height: 16px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="container">
  <header>
    <h2><i data-lucide="shield-check"></i> Shadow Admin</h2>
    <div class="header-actions">
      <span class="badge-version">v2.0.51</span>
      <button class="btn-icon-top" id="langToggleBtn" onclick="toggleLanguage()"><i data-lucide="languages" style="width:16px;height:16px;"></i> <span id="langText">ID</span></button>
      <button class="btn-icon-top" id="themeToggleBtn" onclick="toggleTheme()"><i data-lucide="moon" id="themeIcon" style="width:16px;height:16px;"></i></button>
      <button class="btn-logout" onclick="confirmAction(i18n[currentLang].logoutConfirm, logoutAdmin, false)"><i data-lucide="log-out" style="width:14px;height:14px;"></i> <span data-i18n="logout">Logout</span></button>
    </div>
  </header>

  <div class="card">
    <div class="card-title"><i data-lucide="box"></i> <span data-i18n="libManagement">Manajemen Library .so / .bin</span></div>
    <div class="url-box">
      <span id="libUrlBox">Library URL: Memuat...</span>
      <button class="btn-secondary" onclick="copyText(dynamicLibUrl, i18n[currentLang].libUrlCopied)"><i data-lucide="copy" style="width:16px;height:16px;"></i> <span data-i18n="copyLibUrl">Salin URL Library</span></button>
    </div>
    <div class="lib-info-box" id="libInfoBox"><div><b data-i18n="libStatus">Status Library:</b> Memeriksa database...</div></div>
    <form id="formUploadLib">
      <label data-i18n="uploadLabel">Upload File Library Baru (.bin / .so):</label>
      <input type="file" id="library_file" accept=".bin,.so" required>
      <button type="submit" id="btnUploadLib" style="background: #8b5cf6; color:#fff;">
        <span class="btn-text"><i data-lucide="upload"></i> <span data-i18n="uploadBtn">Upload Library ke DB</span></span>
        <div class="spinner-btn" id="uploadSpinner"></div>
      </button>
    </form>
  </div>

  <div class="card">
    <div class="card-title"><i data-lucide="key"></i> <span data-i18n="createKeyTitle">Buat License Key Baru</span></div>
    <div class="url-box">
      <span id="apiUrlBox">API URL: Memuat...</span>
      <button class="btn-secondary" onclick="copyText(dynamicApiUrl, i18n[currentLang].apiUrlCopied)"><i data-lucide="copy" style="width:16px;height:16px;"></i> <span data-i18n="copyApiUrl">Salin URL API</span></button>
    </div>
    <form id="formKey" style="margin-top: 14px;">
      <label data-i18n="customKeyLabel">Custom License Key:</label>
      <div class="row-group">
        <input type="text" id="license_key" placeholder="Contoh: RIO-ABC123XYZ" required style="margin-bottom:0;">
        <button type="button" onclick="generateKey()" style="width: 110px; background: #334155; color:#fff;"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> <span data-i18n="randomBtn">Random</span></button>
      </div>
      <div style="margin-top: 14px;">
        <label id="durationLabel" data-i18n="durationDays">Masa Aktif (Hari):</label>
        <input type="number" id="days_valid" value="30" min="1" required>
      </div>
      <label data-i18n="unitLabel">Satuan Waktu:</label>
      <select id="duration_unit" onchange="updateDurationLabel()">
        <option value="days" data-i18n="unitDays">Hari (Days)</option>
        <option value="minutes" data-i18n="unitMinutes">Menit (Test 1 Min)</option>
      </select>
      <label data-i18n="maxDevLabel">Maksimal Device (Max Devices):</label>
      <input type="number" id="max_devices" value="1" min="1" required>
      <button type="submit" id="btnCreateKey">
        <span class="btn-text"><i data-lucide="plus-circle"></i> <span data-i18n="saveKeyBtn">Simpan Key ke Database</span></span>
        <div class="spinner-btn" id="createSpinner"></div>
      </button>
    </form>
  </div>

  <div class="card">
    <div class="card-title"><i data-lucide="list"></i> <span data-i18n="listKeyTitle">Daftar Key & Device Terdaftar</span></div>
    <div class="keys-container" id="keyList">
      <div style="text-align: center; color: var(--text-muted); padding: 20px;" data-i18n="loading">Memuat data...</div>
    </div>
  </div>
</div>

<!-- MODAL KONFIRMASI CUSTOM -->
<div id="customModal">
  <div class="modal-box">
    <div class="modal-icon" id="modalIcon"><i data-lucide="help-circle" style="width:24px;height:24px;"></i></div>
    <div class="modal-title" id="modalTitle" data-i18n="modalTitleText">Konfirmasi Aksi</div>
    <div class="modal-desc" id="modalDesc">Apakah Anda yakin ingin melanjutkan tindakan ini?</div>
    <div class="modal-actions">
      <button class="modal-btn modal-btn-cancel" onclick="closeModal()" data-i18n="cancelBtn">Batal</button>
      <button class="modal-btn modal-btn-confirm" id="modalConfirmBtn" onclick="executeModalAction()" data-i18n="confirmBtn">Ya, Lanjutkan</button>
    </div>
  </div>
</div>

<div id="toast">Notifikasi berhasil</div>

<script>
  const i18n = {
    id: {
      logout: "Keluar",
      logoutConfirm: "Keluar dari Admin Panel?",
      libManagement: "Manajemen Library .so / .bin",
      copyLibUrl: "Salin URL Library",
      libUrlCopied: "URL Library berhasil disalin!",
      libStatus: "Status Library:",
      uploadLabel: "Upload File Library Baru (.bin / .so):",
      uploadBtn: "Upload Library ke DB",
      createKeyTitle: "Buat License Key Baru",
      copyApiUrl: "Salin URL API",
      apiUrlCopied: "URL API berhasil disalin!",
      customKeyLabel: "Custom License Key:",
      randomBtn: "Random",
      durationDays: "Masa Aktif (Hari):",
      durationMinutes: "Masa Aktif (Menit):",
      unitLabel: "Satuan Waktu:",
      unitDays: "Hari (Days)",
      unitMinutes: "Menit (Test 1 Min)",
      maxDevLabel: "Maksimal Device (Max Devices):",
      saveKeyBtn: "Simpan Key ke Database",
      listKeyTitle: "Daftar Key & Device Terdaftar",
      loading: "Memuat data...",
      noKeys: "Belum ada key tersimpan.",
      noDevice: "Belum ada device terdaftar",
      deviceCopied: "Device ID disalin!",
      activeValid: "Aktif / Valid",
      suspended: "SUSPENDED",
      noSession: "Tidak ada sesi",
      sessionExpired: "Sesi Kedaluwarsa",
      unsuspend: "Unsuspend",
      suspend: "Suspend",
      resetSession: "Reset Sesi",
      resetDev: "Reset Dev",
      deleteKey: "Hapus Key",
      deleteLibConfirm: "Hapus file library ini dari database?",
      modalTitleText: "Konfirmasi Aksi",
      cancelBtn: "Batal",
      confirmBtn: "Ya, Lanjutkan",
      successDeleteKey: "License key berhasil dihapus",
      successResetDev: "Device ID berhasil di-reset",
      successResetSession: "Sesi berhasil di-reset",
      successSuspend: "Key berhasil disuspend",
      successUnsuspend: "Key berhasil di-unsuspend",
      errorNetwork: "Terjadi kesalahan koneksi",
      selectFile: "Pilih file terlebih dahulu!"
    },
    pt: {
      logout: "Sair",
      logoutConfirm: "Deseja sair do Painel Administrativo?",
      libManagement: "Gerenciamento de Biblioteca .so / .bin",
      copyLibUrl: "Copiar URL da Biblioteca",
      libUrlCopied: "URL da biblioteca copiada com sucesso!",
      libStatus: "Status da Biblioteca:",
      uploadLabel: "Enviar Novo Arquivo de Biblioteca (.bin / .so):",
      uploadBtn: "Enviar Biblioteca para o DB",
      createKeyTitle: "Criar Nova Chave de Licença",
      copyApiUrl: "Copiar URL da API",
      apiUrlCopied: "URL da API copiada com sucesso!",
      customKeyLabel: "Chave de Licença Personalizada:",
      randomBtn: "Gerar",
      durationDays: "Validade (Dias):",
      durationMinutes: "Validade (Minutos):",
      unitLabel: "Unidade de Tempo:",
      unitDays: "Dias (Days)",
      unitMinutes: "Minutos (Test 1 Min)",
      maxDevLabel: "Dispositivos Máximos (Max Devices):",
      saveKeyBtn: "Salvar Chave no Banco de Dados",
      listKeyTitle: "Lista de Chaves e Dispositivos Registrados",
      loading: "Carregando dados...",
      noKeys: "Nenhuma chave salva.",
      noDevice: "Nenhum dispositivo registrado",
      deviceCopied: "ID do dispositivo copiado!",
      activeValid: "Ativo / Válido",
      suspended: "SUSPENSO",
      noSession: "Sem sessão",
      sessionExpired: "Sessão Expirada",
      unsuspend: "Reativar",
      suspend: "Suspender",
      resetSession: "Redefinir Sessão",
      resetDev: "Redefinir Disp.",
      deleteKey: "Excluir Chave",
      deleteLibConfirm: "Excluir este arquivo de biblioteca do banco de dados?",
      modalTitleText: "Confirmação de Ação",
      cancelBtn: "Cancelar",
      confirmBtn: "Sim, Continuar",
      successDeleteKey: "Chave de licença excluída com sucesso",
      successResetDev: "ID do dispositivo redefinido com sucesso",
      successResetSession: "Sessão redefinida com sucesso",
      successSuspend: "Chave suspensa com sucesso",
      successUnsuspend: "Chave reativada com sucesso",
      errorNetwork: "Ocorreu um erro de conexão",
      selectFile: "Selecione um arquivo primeiro!"
    }
  };

  let currentLang = localStorage.getItem('shadow_lang') || 'id';
  let currentTheme = localStorage.getItem('shadow_theme') || 'dark';

  function applyTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('shadow_theme', theme);
    const icon = document.getElementById('themeIcon');
    if (theme === 'light') {
      document.body.classList.add('light-mode');
      icon.setAttribute('data-lucide', 'sun');
    } else {
      document.body.classList.remove('light-mode');
      icon.setAttribute('data-lucide', 'moon');
    }
    lucide.createIcons();
  }

  function toggleTheme() {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('shadow_lang', lang);
    document.getElementById('langText').innerText = lang === 'id' ? 'ID' : 'PT';
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (i18n[currentLang][key]) {
        el.innerText = i18n[currentLang][key];
      }
    });
    updateDurationLabel();
    loadKeys();
    loadLibraryInfo();
  }

  function toggleLanguage() {
    applyLanguage(currentLang === 'id' ? 'pt' : 'id');
  }

  let CSRF_TOKEN = '';
  let dynamicLibUrl = '';
  let dynamicApiUrl = '';
  let pendingAction = null;

  async function fetchCsrf() {
    try {
      const res = await fetch('/api/admin/csrf');
      const data = await res.json();
      if (res.ok && data.csrfToken) {
        CSRF_TOKEN = data.csrfToken;
      }
    } catch (e) {}
  }

  function showToast(message, isError = false) {
    const t = document.getElementById('toast');
    t.innerText = message;
    t.className = isError ? 'error show' : 'show';
    setTimeout(() => { t.className = ''; }, 3000);
  }

  function confirmAction(title, callback, isDanger = false) {
    document.getElementById('modalDesc').innerText = title;
    document.getElementById('modalTitle').innerText = i18n[currentLang].modalTitleText;
    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.innerText = i18n[currentLang].confirmBtn;
    document.querySelector('.modal-btn-cancel').innerText = i18n[currentLang].cancelBtn;
    
    if (isDanger) {
      confirmBtn.className = 'modal-btn modal-btn-confirm danger';
    } else {
      confirmBtn.className = 'modal-btn modal-btn-confirm';
    }
    pendingAction = callback;
    document.getElementById('customModal').classList.add('show');
  }

  function closeModal() {
    document.getElementById('customModal').classList.remove('show');
    pendingAction = null;
  }

  function executeModalAction() {
    if (typeof pendingAction === 'function') {
      pendingAction();
    }
    closeModal();
  }

  applyTheme(currentTheme);
  applyLanguage(currentLang);

  dynamicLibUrl = 'https://' + window.location.host + '/api/v1/library.php?version=2.0.51';
  dynamicApiUrl = 'https://' + window.location.host + '/api/v1/license.php';
  document.getElementById('libUrlBox').innerText = 'Library URL: ' + dynamicLibUrl;
  document.getElementById('apiUrlBox').innerText = 'API URL: ' + dynamicApiUrl;

  function copyText(text, successMsg) {
    navigator.clipboard.writeText(text).then(() => showToast(successMsg));
  }

  function updateDurationLabel() {
    const unit = document.getElementById('duration_unit').value;
    document.getElementById('durationLabel').innerText = unit === 'minutes' ? i18n[currentLang].durationMinutes : i18n[currentLang].durationDays;
  }

  function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let res = 'RIO-';
    for(let i=0; i<10; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('license_key').value = res;
  }

  async function logoutAdmin() {
    try {
      await fetch('/api/admin/logout', { method: 'POST', headers: { 'X-CSRF-Token': CSRF_TOKEN } });
      window.location.href = '/login';
    } catch (e) {
      window.location.href = '/login';
    }
  }

  async function loadLibraryInfo() {
    try {
      const res = await fetch('/api/admin/lib-info');
      const data = await res.json();
      const box = document.getElementById('libInfoBox');
      if(res.ok && data.ok && data.library) {
        const lib = data.library;
        box.innerHTML = '<div>📁 <b>File:</b> ' + lib.filename + '</div><div>📏 <b>Ukuran:</b> ' + lib.size + ' bytes</div><div>🔑 <b>SHA256:</b> <span style="color: var(--accent);">' + lib.sha256 + '</span></div><div style="margin-top: 8px;"><button class="btn-delete" onclick="confirmAction(\\'' + i18n[currentLang].deleteLibConfirm + '\\', deleteLibrary, true)"><i data-lucide="trash-2" style="width:12px;height:12px;"></i> Hapus Library Ini</button></div>';
        lucide.createIcons();
      } else {
        box.innerHTML = '<div style="color: #ef4444;">⚠️ Belum ada file library yang di-upload ke database.</div>';
      }
    } catch (err) { document.getElementById('libInfoBox').innerText = 'Gagal memuat info library.'; }
  }

  async function deleteLibrary() {
    try {
      const res = await fetch('/api/admin/delete-lib', { method: 'POST', headers: { 'X-CSRF-Token': CSRF_TOKEN } });
      const data = await res.json();
      if(data.ok) { showToast('Library berhasil dihapus!'); loadLibraryInfo(); } else { showToast(data.message || 'Gagal menghapus library', true); }
    } catch (e) { showToast(i18n[currentLang].errorNetwork, true); }
  }

  async function loadKeys() {
    try {
      const res = await fetch('/api/admin/list');
      if (res.status === 401) { window.location.href = '/login'; return; }
      const data = await res.json();
      const container = document.getElementById('keyList');
      if(res.ok && data.ok && data.licenses) {
        if(data.licenses.length === 0) {
          container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">' + i18n[currentLang].noKeys + '</div>';
          return;
        }
        container.innerHTML = data.licenses.map(item => {
          const devices = item.device_id ? item.device_id.split(',').filter(Boolean) : [];
          const maxDev = item.max_devices || 1;
          const isFull = devices.length >= maxDev;
          const badgeColor = isFull ? '#ef4444' : '#38bdf8';
          
          let deviceHtml = '<div style="font-size: 0.8rem; color: var(--text-muted);">' + i18n[currentLang].noDevice + '</div>';
          if (devices.length > 0) {
            deviceHtml = '<div class="device-list-box">' + devices.map(d => 
              '<div class="device-pill">' +
                '<div class="device-pill-content">' +
                  '<i data-lucide="cpu" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>' +
                  '<span title="' + d + '">' + d + '</span>' +
                '</div>' +
                '<button class="btn-copy-mini" onclick="copyText(\\'' + d + '\\', \\'' + i18n[currentLang].deviceCopied + '\\')"><i data-lucide="copy" style="width:12px;height:12px;"></i> Salin</button>' +
              '</div>'
            ).join('') + '</div>';
          }

          let sessionStatus = '<span style="color: #10b981; font-weight:600;">' + i18n[currentLang].activeValid + '</span>';
          if (item.suspended) {
            sessionStatus = '<span style="color: #ef4444; font-weight: bold;">' + i18n[currentLang].suspended + '</span>';
          } else if (!item.session_token) {
            sessionStatus = '<span style="color: var(--text-muted);">' + i18n[currentLang].noSession + '</span>';
          } else if (item.session_expires_at && new Date() > new Date(item.session_expires_at)) {
            sessionStatus = '<span style="color: #eab308; font-weight:600;">' + i18n[currentLang].sessionExpired + '</span>';
          }

          const suspendBtn = item.suspended 
            ? '<button class="btn-unsuspend" onclick="confirmAction(\\'Unsuspend key ' + item.license_key + '?\\', () => toggleSuspend(' + item.id + ', false))"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> ' + i18n[currentLang].unsuspend + '</button>'
            : '<button class="btn-suspend" onclick="confirmAction(\\'Suspend key ' + item.license_key + '?\\', () => toggleSuspend(' + item.id + ', true), true)"><i data-lucide="slash" style="width:12px;height:12px;"></i> ' + i18n[currentLang].suspend + '</button>';

          return '<div class="key-item-card">' +
            '<div class="key-item-header">' +
              '<div class="key-title">' + item.license_key + '</div>' +
              '<div class="key-duration">' + item.days_valid + ' ' + (item.unit === 'minutes' ? (currentLang === 'pt' ? 'Minutos' : 'Menit') : (currentLang === 'pt' ? 'Dias' : 'Hari')) + '</div>' +
            '</div>' +
            '<div class="key-details">' +
              '<div class="key-row-info">' +
                '<span style="color:var(--text-muted);">Slot Device:</span>' +
                '<span class="badge" style="border: 1px solid ' + badgeColor + '; color: ' + badgeColor + ';"><i data-lucide="hard-drive" style="width:11px;height:11px;"></i> ' + devices.length + ' / ' + maxDev + ' Dev</span>' +
              '</div>' +
              deviceHtml +
              '<div class="key-row-info" style="margin-top:4px;">' +
                '<span style="color:var(--text-muted);">Status Sesi:</span>' +
                '<span>' + sessionStatus + '</span>' +
              '</div>' +
              '<div class="key-row-info" style="font-size:0.75rem; color:var(--text-muted); word-break:break-all;">' +
                '<span>Token:</span> <span style="font-family:monospace;">' + (item.session_token || '-') + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="actions-grid">' +
              suspendBtn +
              '<button class="btn-session" onclick="confirmAction(\\'Reset Sesi?\\', () => resetSession(' + item.id + '))"><i data-lucide="refresh-cw" style="width:12px;height:12px;"></i> ' + i18n[currentLang].resetSession + '</button>' +
              '<button class="btn-reset" onclick="confirmAction(\\'Reset Device ID?\\', () => resetDevice(' + item.id + '), true)"><i data-lucide="cpu" style="width:12px;height:12px;"></i> ' + i18n[currentLang].resetDev + '</button>' +
              '<button class="btn-delete" onclick="confirmAction(\\'Hapus Key?\\', () => deleteKey(' + item.id + '), true)"><i data-lucide="trash-2" style="width:12px;height:12px;"></i> ' + i18n[currentLang].deleteKey + '</button>' +
            '</div>' +
          '</div>';
        }).join('');
        lucide.createIcons();
      }
    } catch(err) { console.error(err); }
  }

  async function deleteKey(id) {
    try {
      const res = await fetch('/api/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN }, body: JSON.stringify({ id }) });
      const data = await res.json();
      if(data.ok) { showToast(i18n[currentLang].successDeleteKey); loadKeys(); } else { showToast(data.message || 'Error', true); }
    } catch (e) { showToast(i18n[currentLang].errorNetwork, true); }
  }

  async function resetDevice(id) {
    try {
      const res = await fetch('/api/admin/reset-device', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN }, body: JSON.stringify({ id }) });
      const data = await res.json();
      if(data.ok) { showToast(i18n[currentLang].successResetDev); loadKeys(); } else { showToast(data.message || 'Error', true); }
    } catch (e) { showToast(i18n[currentLang].errorNetwork, true); }
  }

  async function resetSession(id) {
    try {
      const res = await fetch('/api/admin/reset-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN }, body: JSON.stringify({ id }) });
      const data = await res.json();
      if(data.ok) { showToast(i18n[currentLang].successResetSession); loadKeys(); } else { showToast(data.message || 'Error', true); }
    } catch (e) { showToast(i18n[currentLang].errorNetwork, true); }
  }

  async function toggleSuspend(id, suspend) {
    const endpoint = suspend ? '/api/admin/suspend' : '/api/admin/unsuspend';
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN }, body: JSON.stringify({ id }) });
      const data = await res.json();
      if(data.ok) { showToast(suspend ? i18n[currentLang].successSuspend : i18n[currentLang].successUnsuspend); loadKeys(); } else { showToast(data.message || 'Error', true); }
    } catch (e) { showToast(i18n[currentLang].errorNetwork, true); }
  }

  document.getElementById('formUploadLib').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('library_file');
    const btn = document.getElementById('btnUploadLib');
    const btnText = btn.querySelector('.btn-text');
    const spinner = document.getElementById('uploadSpinner');

    if (fileInput.files.length === 0) return showToast(i18n[currentLang].selectFile, true);
    const formData = new FormData();
    formData.append('library_file', fileInput.files[0]);

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';

    try {
      const res = await fetch('/api/admin/upload-lib', { method: 'POST', headers: { 'X-CSRF-Token': CSRF_TOKEN }, body: formData });
      const data = await res.json();
      if (res.ok && data.ok) {
        showToast('✅ ' + data.message);
        fileInput.value = ''; 
        loadLibraryInfo();
      } else { 
        showToast('❌ ' + (data.message || 'Error'), true); 
      }
    } catch (err) { 
      showToast('❌ ' + i18n[currentLang].errorNetwork, true); 
    } finally {
      btn.disabled = false;
      btnText.style.display = 'inline';
      spinner.style.display = 'none';
    }
  });

  document.getElementById('formKey').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('license_key').value;
    const days = document.getElementById('days_valid').value;
    const unit = document.getElementById('duration_unit').value;
    const max_devices = document.getElementById('max_devices').value;
    
    const btn = document.getElementById('btnCreateKey');
    const btnText = btn.querySelector('.btn-text');
    const spinner = document.getElementById('createSpinner');

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';

    try {
      const res = await fetch('/api/admin/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
        body: JSON.stringify({ license_key: key, days_valid: days, unit: unit, max_devices: max_devices })
      });
      const data = await res.json();
      if(res.ok && data.ok) {
        showToast('✅ ' + data.message);
        document.getElementById('license_key').value = ''; 
        loadKeys();
      } else { 
        showToast('❌ ' + (data.message || 'Error'), true); 
      }
    } catch (err) { 
      showToast('❌ ' + i18n[currentLang].errorNetwork, true); 
    } finally {
      btn.disabled = false;
      btnText.style.display = 'inline';
      spinner.style.display = 'none';
    }
  });

  fetchCsrf().then(() => {
    loadLibraryInfo();
    loadKeys();
  });
</script>
</body>
</html>`);
});

app.post('/api/admin/upload-lib', requireAuth, upload.single('library_file'), async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    if (!req.file) return res.status(400).json({ ok: false, message: "Tidak ada file!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);
    const fileBuffer = req.file.buffer;
    const filename = req.file.originalname;
    const size = fileBuffer.length;
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const base64Data = fileBuffer.toString('base64');
    await sql`DELETE FROM runtime_files`;
    await sql`INSERT INTO runtime_files (filename, file_data, sha256, size, updated_at) VALUES (${filename}, ${base64Data}, ${sha256}, ${size}, CURRENT_TIMESTAMP)`;
    res.json({ ok: true, message: `Library di-upload! (${size} bytes)`, sha256, size });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.get('/api/admin/lib-info', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);
    const files = await sql`SELECT filename, size, sha256 FROM runtime_files ORDER BY id DESC LIMIT 1`;
    if (files.length === 0) return res.json({ ok: false });
    res.json({ ok: true, library: files[0] });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/delete-lib', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM runtime_files`;
    res.json({ ok: true, message: "Library dihapus!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.get('/api/admin/list', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);
    const licenses = await sql`SELECT id, license_key, days_valid, unit, max_devices, device_id, expires_at, session_token, session_expires_at, suspended FROM licenses ORDER BY id DESC`;
    res.json({ ok: true, licenses });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/delete', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    await sql`DELETE FROM licenses WHERE id = ${id}`;
    res.json({ ok: true, message: "Key dihapus!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/admin/reset-device', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    await sql`UPDATE licenses SET device_id = '' WHERE id = ${id}`;
    res.json({ ok: true, message: "Device di-reset!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/admin/reset-session', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    await sql`UPDATE licenses SET session_token = '', session_expires_at = NULL WHERE id = ${id}`;
    res.json({ ok: true, message: "Sesi berhasil di-reset!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/admin/suspend', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    await sql`UPDATE licenses SET suspended = TRUE WHERE id = ${id}`;
    res.json({ ok: true, message: "Key disuspend!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/admin/unsuspend', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    await sql`UPDATE licenses SET suspended = FALSE WHERE id = ${id}`;
    res.json({ ok: true, message: "Key di-unsuspend!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/admin/create', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);
    const { license_key, days_valid, unit, max_devices } = req.body;
    if (!license_key || license_key.trim() === '') return res.status(400).json({ ok: false, message: "Key wajib diisi!" });
    const duration = parseInt(days_valid);
    const durationUnit = unit === 'minutes' ? 'minutes' : 'days';
    const maxDev = parseInt(max_devices) || 1;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (durationUnit === 'minutes' ? duration * 60 * 1000 : duration * 24 * 60 * 60 * 1000));
    await sql`INSERT INTO licenses (license_key, days_valid, unit, max_devices, device_id, created_at, expires_at, suspended) VALUES (${license_key.trim()}, ${duration}, ${durationUnit}, ${maxDev}, '', ${now.toISOString()}, ${expiresAt.toISOString()}, FALSE)`;
    res.json({ ok: true, message: `Key dibuat!` });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/v1/license.php', handleLicenseActivation);
app.get('/api/v1/license.php', handleLicenseActivation);
app.post('/v1/license.php', handleLicenseActivation);
app.get('/v1/license.php', handleLicenseActivation);

app.get('/api/v1/status.php', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DB URL missing" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ ok: false, message: "Sessão ausente." });
    const token = auth.substring(7);
    const deviceId = req.headers['x-device-id'] || '';

    const rows = await sql`SELECT * FROM licenses WHERE session_token = ${token}`;
    if (rows.length === 0) return res.status(401).json({ ok: false, message: "Sessão inválida." });
    const r = rows[0];

    if (r.suspended) return res.status(403).json({ ok: false, message: "Acesso suspenso pelo servidor." });
    if (r.expires_at && Date.now() > new Date(r.expires_at).getTime())
      return res.status(403).json({ ok: false, message: "Key expirada." });

    const expiresTimestampSec = r.expires_at ? Math.floor(new Date(r.expires_at).getTime()/1000) : 0;
    const sessionExpiresSec = r.session_expires_at ? Math.floor(new Date(r.session_expires_at).getTime()/1000) : 0;
    const licenseIdHex = crypto.createHash('md5').update(r.license_key).digest('hex').toUpperCase();

    const libRows = await sql`SELECT sha256, size, filename FROM runtime_files ORDER BY id DESC LIMIT 1`;
    const libInfo = libRows.length > 0 ? libRows[0] : { sha256: "5726f274b693d2e640625f2c11c4455cac0d2d778381ed0227ae406c860c7fe0", size: 926984 };

    const host = req.get('host');
    const data = {
      license_id: licenseIdHex,
      plan: r.plan || "Padrão",
      device_id: deviceId,
      expires_at: expiresTimestampSec,
      session_expires_at: sessionExpiresSec,
      lib_enabled: true,
      session_token: token,
      library: {
        version: "2.0.51",
        sha256: libInfo.sha256,
        size: Number(libInfo.size),
        url: `https://${host}/api/v1/library.php`
      }
    };

    const b64 = toUrlSafeBase64(Buffer.from(JSON.stringify(data), 'utf-8'));
    let sig = "MIIB";
    try {
      const s = crypto.createSign('SHA256'); s.update(b64); s.end();
      sig = toUrlSafeBase64(s.sign(PRIVATE_KEY));
    } catch (e) {}

    return res.status(200).json({ ok: true, data: b64, signature: sig });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Server Error: " + err.message });
  }
});

app.get('/api/v1/library.php', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).send("DB URL missing");
    const sql = neon(process.env.DATABASE_URL);
    const files = await sql`SELECT file_data, filename FROM runtime_files ORDER BY id DESC LIMIT 1`;
    if (files.length === 0) return res.status(404).send("Library not found");
    const fileBuffer = Buffer.from(files[0].file_data, 'base64');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${files[0].filename || 'libshadowcore.so'}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    return res.end(fileBuffer);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

module.exports = app;
