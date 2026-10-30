const express = require('express');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
app.use(express.json());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } 
});

const ADMIN_USER = process.env.ADMIN_USER || "shadow";
const ADMIN_PASS = process.env.ADMIN_PASS || "rizky123@";

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
  return res.status(401).send('Access Denied: Username atau Password salah!');
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
    await sql`ALTER TABLE licenses ALTER COLUMN license_key TYPE TEXT`;
    await sql`ALTER TABLE licenses ALTER COLUMN device_id TYPE TEXT`;
    await sql`ALTER TABLE runtime_files ALTER COLUMN filename TYPE TEXT`;
    await sql`ALTER TABLE runtime_files ALTER COLUMN file_data TYPE TEXT`;
  } catch (e) {
    console.log("Alter notice:", e.message);
  }
}

app.get('/', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Shadow License Admin Panel</title>
<style>
  body { background: #0f172a; color: #f8fafc; font-family: monospace; padding: 20px; }
  .container { max-width: 650px; margin: 0 auto; background: #1e293b; padding: 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
  h2 { color: #38bdf8; text-align: center; }
  .card { background: #0f172a; padding: 15px; margin-bottom: 15px; border-radius: 6px; border: 1px solid #334155; }
  input, select { width: 100%; padding: 10px; margin: 5px 0 15px 0; background: #1e293b; border: 1px solid #475569; color: #fff; border-radius: 4px; box-sizing: border-box; }
  button { background: #0284c7; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight: bold; width: 100%; }
  button:hover { background: #0369a1; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  th, td { border: 1px solid #334155; padding: 8px; text-align: left; }
  th { background: #1e293b; color: #38bdf8; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }
  .btn-delete { background: #ef4444; width: auto; padding: 4px 8px; font-size: 11px; }
  .btn-delete:hover { background: #dc2626; }
  .btn-reset { background: #eab308; color: #000; width: auto; padding: 4px 8px; font-size: 11px; margin-bottom: 4px; }
  .btn-reset:hover { background: #ca8a04; }
  .device-debug { font-size: 10px; color: #94a3b8; word-break: break-all; margin-top: 2px; }
  .lib-info-box { background: #111827; padding: 10px; border-radius: 4px; border: 1px solid #374151; font-size: 12px; margin-bottom: 10px; }
</style>
</head>
<body>
<div class="container">
  <h2>Shadow License Admin</h2>
  <div class="card">
    <h3 style="color: #38bdf8; margin-top: 0; font-size: 14px; text-align: center;">📦 Manajemen Library .so / .bin</h3>
    <div id="libUrlBox" style="font-size: 11px; margin-bottom: 8px; color: #38bdf8; word-break: break-all;">Library URL: Memuat...</div>
    <button type="button" onclick="copyLibraryUrl()" style="background: #10b981; margin-bottom: 15px;">📋 Copy URL Library</button>
    <div class="lib-info-box" id="libInfoBox"><div><b>Status Library:</b> Memeriksa database...</div></div>
    <form id="formUploadLib">
      <label>Upload File Library Baru (.bin / .so):</label>
      <input type="file" id="library_file" accept=".bin,.so" required style="margin-bottom: 10px;">
      <button type="submit" style="background: #8b5cf6;">🚀 Upload Library ke DB</button>
    </form>
    <div id="uploadMsg" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
  </div>
  <div class="card">
    <div id="apiUrlBox" style="font-size: 12px; margin-bottom: 10px; color: #38bdf8;">API URL: Memuat...</div>
    <form id="formKey">
      <label>Custom License Key:</label>
      <div style="display: flex; gap: 5px;">
        <input type="text" id="license_key" placeholder="Contoh: RIO-ABC123XYZ" required style="margin-bottom:0;">
        <button type="button" onclick="generateKey()" style="width: 100px;">Random</button>
      </div>
      <div style="margin-top: 15px;">
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
      <button type="submit">Simpan Key ke Database</button>
    </form>
    <div id="msg" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
  </div>
  <div class="card">
    <h3 style="color: #38bdf8; margin-top: 0; font-size: 14px; text-align: center;">Daftar Key & Device Terdaftar</h3>
    <table>
      <thead>
        <tr><th>Key</th><th>Masa Aktif</th><th>Device Slot</th><th>Aksi</th></tr>
      </thead>
      <tbody id="keyList">
        <tr><td colspan="4" style="text-align: center; color: #888;">Memuat data...</td></tr>
      </tbody>
    </table>
  </div>
</div>
<script>
const dynamicLibUrl = 'https://' + window.location.host + '/api/v1/library.php?version=2.0.51';
document.getElementById('libUrlBox').innerText = 'Library URL: ' + dynamicLibUrl;
document.getElementById('apiUrlBox').innerText = 'API URL: ' + 'https://' + window.location.host + '/api/license';
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
      box.innerHTML = \`<div>📁 <b>File:</b> \${lib.filename}</div><div>📏 <b>Ukuran:</b> \${lib.size} bytes</div><div>🔑 <b>SHA256:</b> <span style="color: #38bdf8;">\${lib.sha256}</span></div><div style="margin-top: 8px;"><button class="btn-delete" onclick="deleteLibrary()">Hapus Library Ini</button></div>\`;
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
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888;">Belum ada key tersimpan.</td></tr>';
        return;
      }
      tbody.innerHTML = data.licenses.map(item => {
        const devices = item.device_id ? item.device_id.split(',').filter(Boolean) : [];
        const maxDev = item.max_devices || 1;
        const isFull = devices.length >= maxDev;
        const badgeColor = isFull ? '#ef4444' : '#38bdf8';
        let deviceHtml = \`<span class="badge" style="border: 1px solid \${badgeColor}; color: \${badgeColor};">\${devices.length} / \${maxDev} Device</span>\`;
        if (devices.length > 0) {
          deviceHtml += devices.map(d => \`<div class="device-debug">📱 \${d}</div>\`).join('');
        } else {
          deviceHtml += '<div style="font-size: 10px; color: #666; margin-top: 2px;">Belum ada device</div>';
        }
        return \`<tr>
          <td style="font-family: monospace; color: #38bdf8; font-weight: bold;">\${item.license_key}</td>
          <td>\${item.days_valid} \${item.unit === 'minutes' ? 'Menit' : 'Hari'}</td>
          <td>\${deviceHtml}</td>
          <td>
            <button class="btn-reset" onclick="resetDevice(\${item.id})">Reset</button><br>
            <button class="btn-delete" onclick="deleteKey(\${item.id})">Hapus</button>
          </td>
        </tr>\`;
      }).join('');
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
document.getElementById('formUploadLib').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('library_file');
  const uploadMsg = document.getElementById('uploadMsg');
  if (fileInput.files.length === 0) return alert('Pilih file!');
  const formData = new FormData();
  formData.append('library_file', fileInput.files[0]);
  uploadMsg.style.color = '#ccc'; uploadMsg.innerText = 'Mengupload...';
  try {
    const res = await fetch('/api/admin/upload-lib', { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok && data.ok) {
      uploadMsg.style.color = '#38bdf8'; uploadMsg.innerText = '✅ ' + data.message;
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
  msg.style.color = '#ccc'; msg.innerText = 'Menyimpan...';
  const res = await fetch('/api/admin/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: key, days_valid: days, unit: unit, max_devices: max_devices })
  });
  const data = await res.json();
  if(res.ok && data.ok) {
    msg.style.color = '#38bdf8'; msg.innerText = '✅ ' + data.message;
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

app.get('/api/v1/library.php', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).send("DATABASE_URL belum diatur!");
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);
    const files = await sql`SELECT file_data, filename FROM runtime_files ORDER BY id DESC LIMIT 1`;
    if (files.length === 0) return res.status(404).send("Library not found.");
    const base64Data = files[0].file_data;
    if (!base64Data) return res.status(404).send("Data empty.");
    const fileBuffer = Buffer.from(base64Data, 'base64');
    const filename = files[0].filename || "libshadowcore.so";
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    return res.end(fileBuffer);
  } catch (err) { res.status(500).send("Server Error: " + err.message); }
});

app.get('/api/admin/list', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);
    const licenses = await sql`SELECT id, license_key, days_valid, unit, max_devices, device_id, expires_at FROM licenses ORDER BY id DESC`;
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
    await sql`INSERT INTO licenses (license_key, days_valid, unit, max_devices, device_id, created_at, expires_at) VALUES (${license_key.trim()}, ${duration}, ${durationUnit}, ${maxDev}, '', ${now.toISOString()}, ${expiresAt.toISOString()})`;
    res.json({ ok: true, message: `Key dibuat!` });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/license', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diset!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);
    const { license_key, device_id } = req.body;
    if (!license_key) return res.json({ ok: false, message: "Key wajib diisi!" });
    const result = await sql`SELECT * FROM licenses WHERE license_key = ${String(license_key).trim()}`;
    if (result.length === 0) return res.json({ ok: false, message: "Key tidak valid!" });
    const record = result[0];
    const nowMs = Date.now();
    if (record.expires_at && nowMs > new Date(record.expires_at).getTime()) {
      return res.json({ ok: false, message: "Key sudah kedaluwarsa!" });
    }
    const clientDevice = device_id || "unknown";
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
    const licenseIdHex = crypto.createHash('md5').update(record.license_key).digest('hex').toUpperCase();
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const libRows = await sql`SELECT sha256, size FROM runtime_files ORDER BY id DESC LIMIT 1`;
    const libInfo = libRows.length > 0 ? libRows[0] : { sha256: "5726f274b693d2e640625f2c11c4455cac0d2d778381ed0227ae406c860c7fe0", size: 926984 };
    
    // Paksa menggunakan HTTPS agar aman dari pemblokiran cleartext traffic di Android / Python
    const hostName = req.get('host');
    const libraryUrl = `https://${hostName}/api/v1/library.php?version=2.0.51`;

    const licenseData = {
      license_id: licenseIdHex,
      plan: "Correção de acesso",
      product: { code: "rio-rise", name: "Shadow Rio Rise", game: "Rio Rise" },
      device_id: clientDevice,
      expires_at: expiresTimestampSec,
      server_time: serverTimeSec,
      session_token: sessionToken,
      session_expires_at: expiresTimestampSec,
      lib_enabled: true,
      library: { version: "2.0.51", sha256: libInfo.sha256, size: Number(libInfo.size), min_app_version: "2.0.8", url: libraryUrl },
      min_app_version: "2.0.8"
    };
    const base64Data = Buffer.from(JSON.stringify(licenseData)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signature = crypto.createHmac('sha256', process.env.LICENSE_SECRET || 'shadow_default_secret_key').update(base64Data).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    res.json({ ok: true, data: base64Data, signature: signature });
  } catch (err) { res.status(500).json({ ok: false, message: "Server Error: " + err.message }); }
});

module.exports = app;
