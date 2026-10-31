const express = require('express');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
app.use(express.json());

// Middleware CORS agar semua HP/client bisa akses tanpa diblokir
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-ID');
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

let PRIVATE_KEY;
try {
  const kp = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  PRIVATE_KEY = kp.privateKey;
} catch (e) {
  PRIVATE_KEY = process.env.PRIVATE_KEY || '';
}

function toUrlSafeBase64(buffer) {
  return buffer.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Shadow Admin"');
      return res.status(401).send('Autentikasi diperlukan.');
    }
    const parts = authHeader.split(' ');
    if (parts.length < 2) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Shadow Admin"');
      return res.status(401).send('Format auth salah.');
    }
    const credentials = Buffer.from(parts[1], 'base64').toString('ascii');
    const [username, password] = credentials.split(':');
    if (username === ADMIN_USER && password === ADMIN_PASS) { return next(); } 
  } catch (err) {}
  res.setHeader('WWW-Authenticate', 'Basic realm="Shadow Admin"');
  return res.status(401).send('Access Denied!');
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

// ADMIN PANEL HTML & ROUTES (UI modern, rapi, smooth, menggunakan Lucide Icons via JS CDN)
app.get('/', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Shadow License Admin Panel</title>
<!-- Google Fonts & Lucide Icons -->
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
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
  body { background: var(--bg-primary); color: var(--text-main); padding: 24px 16px; min-height: 100vh; display: flex; justify-content: center; }
  .container { width: 100%; max-width: 800px; display: flex; flex-direction: column; gap: 20px; }
  
  header { display: flex; align-items: center; justify-content: space-between; background: var(--bg-secondary); padding: 16px 24px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); }
  header h2 { font-size: 1.25rem; color: var(--accent); display: flex; align-items: center; gap: 10px; font-weight: 700; }
  header span { font-size: 0.85rem; color: var(--text-muted); background: var(--bg-card); padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border); }

  .card { background: var(--bg-secondary); padding: 20px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); transition: all 0.3s ease; }
  .card:hover { border-color: #4b5563; }
  .card-title { font-size: 1rem; font-weight: 600; color: var(--accent); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }

  label { display: block; font-size: 0.85rem; font-weight: 500; color: var(--text-muted); margin-bottom: 6px; }
  input, select { width: 100%; padding: 10px 14px; margin-bottom: 14px; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-main); border-radius: 8px; font-size: 0.9rem; outline: none; transition: border-color 0.2s; }
  input:focus, select:focus { border-color: var(--accent); }
  
  .row-group { display: flex; gap: 10px; }
  
  button { background: var(--accent); color: #000; border: none; padding: 10px 16px; cursor: pointer; border-radius: 8px; font-weight: 600; font-size: 0.9rem; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.2s, transform 0.1s; }
  button:hover { background: var(--accent-hover); }
  button:active { transform: scale(0.98); }

  .btn-secondary { background: #334155; color: #fff; width: auto; padding: 6px 12px; font-size: 0.8rem; }
  .btn-secondary:hover { background: #475569; }

  .btn-delete { background: #ef4444; color: #fff; width: auto; padding: 5px 10px; font-size: 0.75rem; }
  .btn-delete:hover { background: #dc2626; }
  .btn-reset { background: #eab308; color: #000; width: auto; padding: 5px 10px; font-size: 0.75rem; }
  .btn-suspend { background: #f97316; color: #fff; width: auto; padding: 5px 10px; font-size: 0.75rem; }
  .btn-unsuspend { background: #10b981; color: #fff; width: auto; padding: 5px 10px; font-size: 0.75rem; }
  .btn-session { background: #6366f1; color: #fff; width: auto; padding: 5px 10px; font-size: 0.75rem; }

  .url-box { background: var(--bg-primary); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.8rem; color: var(--accent); word-break: break-all; display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .lib-info-box { background: var(--bg-primary); padding: 12px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.85rem; margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px; }

  .table-responsive { width: 100%; overflow-x: auto; margin-top: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; white-space: nowrap; }
  th, td { border-bottom: 1px solid var(--border); padding: 10px 8px; text-align: left; }
  th { background: var(--bg-card); color: var(--accent); font-weight: 600; }
  
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
  .device-debug { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 4px; }
  #msg, #uploadMsg { margin-top: 8px; font-size: 0.85rem; text-align: center; font-weight: 500; }
  
  .actions-cell { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h2><i data-lucide="shield-check"></i> Shadow Admin</h2>
    <span>v2.0.51</span>
  </header>

  <!-- MANAJEMEN LIBRARY -->
  <div class="card">
    <div class="card-title"><i data-lucide="box"></i> Manajemen Library .so / .bin</div>
    <div class="url-box">
      <span id="libUrlBox">Library URL: Memuat...</span>
      <button class="btn-secondary" onclick="copyLibraryUrl()"><i data-lucide="copy" style="width:14px;height:14px;"></i> Copy</button>
    </div>
    <div class="lib-info-box" id="libInfoBox"><div><b>Status Library:</b> Memeriksa database...</div></div>
    <form id="formUploadLib">
      <label>Upload File Library Baru (.bin / .so):</label>
      <input type="file" id="library_file" accept=".bin,.so" required>
      <button type="submit" style="background: #8b5cf6; color:#fff;"><i data-lucide="upload"></i> Upload Library ke DB</button>
    </form>
    <div id="uploadMsg"></div>
  </div>

  <!-- BUAT LICENSE KEY -->
  <div class="card">
    <div class="card-title"><i data-lucide="key"></i> Buat License Key Baru</div>
    <div class="url-box" id="apiUrlBox" style="margin-bottom: 14px;">API URL: Memuat...</div>
    <form id="formKey">
      <label>Custom License Key:</label>
      <div class="row-group">
        <input type="text" id="license_key" placeholder="Contoh: RIO-ABC123XYZ" required style="margin-bottom:0;">
        <button type="button" onclick="generateKey()" style="width: 110px; background: #334155; color:#fff;"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Random</button>
      </div>
      <div style="margin-top: 14px;">
        <label id="durationLabel">Masa Aktif (Hari):</label>
        <input type="number" id="days_valid" value="30" min="1" required>
      </div>
      <label>Satuan Waktu:</label>
      <select id="duration_unit" onchange="updateDurationLabel()">
        <option value="days">Hari (Days)</option>
        <option value="minutes">Menit (Test 1 Min)</option>
      </select>
      <label>Maksimal Device (Max Devices):</label>
      <input type="number" id="max_devices" value="1" min="1" required>
      <button type="submit"><i data-lucide="plus-circle"></i> Simpan Key ke Database</button>
    </form>
    <div id="msg"></div>
  </div>

  <!-- DAFTAR KEY -->
  <div class="card">
    <div class="card-title"><i data-lucide="list"></i> Daftar Key & Device Terdaftar</div>
    <div class="table-responsive">
      <table>
        <thead>
          <tr><th>Key</th><th>Masa Aktif</th><th>Device Slot</th><th>Sesi & Status</th><th>Aksi</th></tr>
        </thead>
        <tbody id="keyList">
          <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Memuat data...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<script>
  lucide.createIcons();
  const dynamicLibUrl = 'https://' + window.location.host + '/api/v1/library.php?version=2.0.51';
  const dynamicApiUrl = 'https://' + window.location.host + '/api/v1/license.php';
  document.getElementById('libUrlBox').innerText = 'Library URL: ' + dynamicLibUrl;
  document.getElementById('apiUrlBox').innerText = 'API URL: ' + dynamicApiUrl;

  function copyLibraryUrl() {
    navigator.clipboard.writeText(dynamicLibUrl).then(() => alert('URL Library berhasil disalin!'));
  }
  function updateDurationLabel() {
    const unit = document.getElementById('duration_unit').value;
    document.getElementById('durationLabel').innerText = unit === 'minutes' ? 'Masa Aktif (Menit):' : 'Masa Aktif (Hari):';
  }
  function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let res = 'RIO-';
    for(let i=0; i<10; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('license_key').value = res;
  }
  async function loadLibraryInfo() {
    try {
      const res = await fetch('/api/admin/lib-info');
      const data = await res.json();
      const box = document.getElementById('libInfoBox');
      if(res.ok && data.ok && data.library) {
        const lib = data.library;
        box.innerHTML = '<div>📁 <b>File:</b> ' + lib.filename + '</div><div>📏 <b>Ukuran:</b> ' + lib.size + ' bytes</div><div>🔑 <b>SHA256:</b> <span style="color: var(--accent);">' + lib.sha256 + '</span></div><div style="margin-top: 6px;"><button class="btn-delete" onclick="deleteLibrary()"><i data-lucide="trash-2" style="width:12px;height:12px;"></i> Hapus Library Ini</button></div>';
        lucide.createIcons();
      } else {
        box.innerHTML = '<div style="color: #ef4444;">⚠️ Belum ada file library yang di-upload ke database.</div>';
      }
    } catch (err) { document.getElementById('libInfoBox').innerText = 'Gagal memuat info library.'; }
  }
  async function deleteLibrary() {
    if(!confirm('Yakin ingin menghapus library aktif?')) return;
    const res = await fetch('/api/admin/delete-lib', { method: 'POST' });
    const data = await res.json();
    if(data.ok) { alert('Berhasil dihapus!'); loadLibraryInfo(); } else { alert('Gagal'); }
  }
  async function loadKeys() {
    try {
      const res = await fetch('/api/admin/list');
      const data = await res.json();
      const tbody = document.getElementById('keyList');
      if(res.ok && data.ok && data.licenses) {
        if(data.licenses.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Belum ada key tersimpan.</td></tr>';
          return;
        }
        tbody.innerHTML = data.licenses.map(item => {
          const devices = item.device_id ? item.device_id.split(',').filter(Boolean) : [];
          const maxDev = item.max_devices || 1;
          const isFull = devices.length >= maxDev;
          const badgeColor = isFull ? '#ef4444' : '#38bdf8';
          let deviceHtml = '<span class="badge" style="border: 1px solid ' + badgeColor + '; color: ' + badgeColor + ';"><i data-lucide="smartphone" style="width:10px;height:10px;"></i> ' + devices.length + ' / ' + maxDev + ' Dev</span>';
          if (devices.length > 0) {
            deviceHtml += devices.map(d => '<div class="device-debug">📱 ' + d + '</div>').join('');
          } else {
            deviceHtml += '<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Belum ada device</div>';
          }

          let sessionStatus = '<span style="color: #10b981;">Aktif / Valid</span>';
          if (item.suspended) {
            sessionStatus = '<span style="color: #ef4444; font-weight: bold;">SUSPENDED</span>';
          } else if (!item.session_token) {
            sessionStatus = '<span style="color: var(--text-muted);">Tidak ada sesi</span>';
          } else if (item.session_expires_at && new Date() > new Date(item.session_expires_at)) {
            sessionStatus = '<span style="color: #eab308;">Sesi Kedaluwarsa</span>';
          }

          const suspendBtn = item.suspended 
            ? '<button class="btn-unsuspend" onclick="toggleSuspend(' + item.id + ', false)">Unsuspend</button>'
            : '<button class="btn-suspend" onclick="toggleSuspend(' + item.id + ', true)">Suspend</button>';

          return '<tr>' +
            '<td style="font-family: monospace; color: var(--accent); font-weight: bold;">' + item.license_key + '</td>' +
            '<td>' + item.days_valid + ' ' + (item.unit === 'minutes' ? 'Min' : 'Hari') + '</td>' +
            '<td>' + deviceHtml + '</td>' +
            '<td><div>' + sessionStatus + '</div><div style="font-size:0.75rem; color:var(--text-muted);">Token: ' + (item.session_token ? item.session_token.substring(0,8)+'...' : '-') + '</div></td>' +
            '<td><div class="actions-cell">' +
              suspendBtn +
              '<button class="btn-session" onclick="resetSession(' + item.id + ')">Reset Sesi</button>' +
              '<button class="btn-reset" onclick="resetDevice(' + item.id + ')">Reset Dev</button>' +
              '<button class="btn-delete" onclick="deleteKey(' + item.id + ')">Hapus</button>' +
            '</div></td>' +
          '</tr>';
        }).join('');
        lucide.createIcons();
      }
    } catch(err) { console.error(err); }
  }
  async function deleteKey(id) {
    if(!confirm('Yakin ingin menghapus key ini?')) return;
    const res = await fetch('/api/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if(data.ok) loadKeys(); else alert('Gagal');
  }
  async function resetDevice(id) {
    if(!confirm('Reset Device ID?')) return;
    const res = await fetch('/api/admin/reset-device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if(data.ok) loadKeys(); else alert('Gagal');
  }
  async function resetSession(id) {
    if(!confirm('Reset Sesi untuk key ini?')) return;
    const res = await fetch('/api/admin/reset-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if(data.ok) loadKeys(); else alert('Gagal');
  }
  async function toggleSuspend(id, suspend) {
    if(!confirm(suspend ? 'Suspend key ini?' : 'Unsuspend key ini?')) return;
    const endpoint = suspend ? '/api/admin/suspend' : '/api/admin/unsuspend';
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if(data.ok) loadKeys(); else alert('Gagal');
  }
  document.getElementById('formUploadLib').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('library_file');
    const uploadMsg = document.getElementById('uploadMsg');
    if (fileInput.files.length === 0) return alert('Pilih file!');
    const formData = new FormData();
    formData.append('library_file', fileInput.files[0]);
    uploadMsg.style.color = 'var(--text-muted)'; uploadMsg.innerText = 'Mengupload...';
    try {
      const res = await fetch('/api/admin/upload-lib', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data.ok) {
        uploadMsg.style.color = 'var(--accent)'; uploadMsg.innerText = '✅ ' + data.message;
        fileInput.value = ''; loadLibraryInfo();
      } else { uploadMsg.style.color = '#ef4444'; uploadMsg.innerText = '❌ ' + (data.message || 'Gagal'); }
    } catch (err) { uploadMsg.style.color = '#ef4444'; uploadMsg.innerText = '❌ Error'; }
  });
  document.getElementById('formKey').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('license_key').value;
    const days = document.getElementById('days_valid').value;
    const unit = document.getElementById('duration_unit').value;
    const max_devices = document.getElementById('max_devices').value;
    const msg = document.getElementById('msg');
    msg.style.color = 'var(--text-muted)'; msg.innerText = 'Menyimpan...';
    const res = await fetch('/api/admin/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key, days_valid: days, unit: unit, max_devices: max_devices })
    });
    const data = await res.json();
    if(res.ok && data.ok) {
      msg.style.color = 'var(--accent)'; msg.innerText = '✅ ' + data.message;
      document.getElementById('license_key').value = ''; loadKeys();
    } else { msg.style.color = '#ef4444'; msg.innerText = '❌ ' + (data.message || 'Gagal'); }
  });
  loadLibraryInfo();
  loadKeys();
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
