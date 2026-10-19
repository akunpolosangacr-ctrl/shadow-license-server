const express = require('express');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json());

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

    if (username === ADMIN_USER && password === ADMIN_PASS) {
      return next();
    }
  } catch (err) {}

  res.setHeader('WWW-Authenticate', 'Basic realm="Shadow Admin"');
  return res.status(401).send('Access Denied: Username atau Password salah!');
};

// Halaman Admin Panel
app.get('/', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Shadow License Admin Panel</title>
        <style>
            body { background: #0a0a0a; color: #fff; font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
            .container { width: 100%; max-width: 650px; display: flex; flex-direction: column; gap: 20px; }
            .card { background: #121212; padding: 25px; border-radius: 14px; box-shadow: 0 4px 25px rgba(0,255,204,0.15); border: 1px solid #222; box-sizing: border-box; }
            h2 { color: #00ffcc; text-align: center; margin: 0 0 5px 0; font-size: 20px; }
            p.sub { font-size: 12px; color: #888; text-align: center; margin-bottom: 20px; word-break: break-all; }
            .storage-container { background: #1a1a1a; padding: 12px; border-radius: 8px; border: 1px solid #333; margin-bottom: 20px; }
            .storage-info { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; margin-bottom: 6px; }
            .storage-bar-bg { width: 100%; background: #222; height: 8px; border-radius: 4px; overflow: hidden; }
            .storage-bar-fill { width: 0%; background: #00ffcc; height: 100%; transition: width 0.4s ease; }
            .url-box { background: #1a1a1a; padding: 10px; border-radius: 6px; border: 1px dashed #333; font-size: 12px; color: #00ffcc; margin-bottom: 20px; text-align: center; }
            label { display: block; margin-bottom: 6px; font-size: 13px; color: #ccc; }
            input { width: 100%; padding: 12px; background: #1e1e1e; border: 1px solid #333; color: #fff; border-radius: 6px; margin-bottom: 15px; box-sizing: border-box; font-size: 14px; }
            .row { display: flex; gap: 10px; }
            button.submit-btn { width: 100%; padding: 13px; background: #00ffcc; color: #000; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
            button.submit-btn:hover { background: #00cca3; }
            .btn-random { background: #333; color: #fff; width: 110px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #222; }
            th { color: #00ffcc; }
            .btn-delete { background: #ff4d4d; color: #fff; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <h2>Shadow License Admin</h2>
                <p class="sub">🔒 Secure Neon PostgreSQL Storage</p>
                <div class="storage-container">
                    <div class="storage-info">
                        <span>Kapasitas Storage Database</span>
                        <span id="storageStatus">Memuat...</span>
                    </div>
                    <div class="storage-bar-bg">
                        <div id="storageBar" class="storage-bar-fill"></div>
                    </div>
                </div>
                <div class="url-box" id="apiUrlBox">Endpoint API: Memuat...</div>
                <form id="formKey">
                    <label>Custom License Key:</label>
                    <div class="row">
                        <input type="text" id="license_key" placeholder="Contoh: VIP123 / RIO-999" required style="margin-bottom:0;">
                        <button type="button" class="btn-random" onclick="generateKey()">Random</button>
                    </div>
                    <label>Masa Aktif (Hari / Days):</label>
                    <input type="number" id="days_valid" value="30" required>
                    <button type="submit" class="submit-btn">Simpan ke Database Neon</button>
                </form>
                <div id="msg"></div>
            </div>
            <div class="card">
                <h3 style="color: #00ffcc; margin-top: 0; font-size: 16px; text-align: center;">Daftar Key yang Telah Dibuat</h3>
                <table>
                    <thead>
                        <tr><th>Key</th><th>Masa Aktif</th><th>Aksi</th></tr>
                    </thead>
                    <tbody id="keyList">
                        <tr><td colspan="3" style="text-align: center; color: #888;">Memuat data...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        <script>
            document.getElementById('apiUrlBox').innerText = 'API URL: ' + window.location.origin + '/api/license';
            function generateKey() {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let res = 'RIO-';
                for(let i=0; i<10; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
                document.getElementById('license_key').value = res;
            }
            async function loadKeys() {
                try {
                    const res = await fetch('/api/admin/list');
                    const data = await res.json();
                    const tbody = document.getElementById('keyList');
                    if(data.ok && data.licenses.length > 0) {
                        document.getElementById('storageStatus').innerText = data.licenses.length + ' / 500 Keys (Aman)';
                        document.getElementById('storageBar').style.width = Math.min((data.licenses.length / 500) * 100, 100) + '%';
                        tbody.innerHTML = data.licenses.map(item => \`
                            <tr>
                                <td style="font-family: monospace; color: #00ffcc;">\${item.license_key}</td>
                                <td>\${item.days_valid || 30} Hari</td>
                                <td><button class="btn-delete" onclick="deleteKey(\${item.id})">Hapus</button></td>
                            </tr>
                        \`).join('');
                    } else {
                        document.getElementById('storageStatus').innerText = '0 / 500 Keys (Kosong)';
                        document.getElementById('storageBar').style.width = '2%';
                        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #888;">Belum ada key tersimpan.</td></tr>';
                    }
                } catch(err) { console.error(err); }
            }
            async function deleteKey(id) {
                if(!confirm('Yakin ingin menghapus key ini?')) return;
                const res = await fetch('/api/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
                const data = await res.json();
                if(data.ok) loadKeys(); else alert('Gagal: ' + data.message);
            }
            document.getElementById('formKey').addEventListener('submit', async (e) => {
                e.preventDefault();
                const key = document.getElementById('license_key').value;
                const days = document.getElementById('days_valid').value;
                const msg = document.getElementById('msg');
                msg.style.color = '#ccc'; msg.innerText = 'Menyimpan...';
                const res = await fetch('/api/admin/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_key: key, days_valid: days }) });
                const data = await res.json();
                if(data.ok) { msg.style.color = '#00ffcc'; msg.innerText = '✅ ' + data.message; document.getElementById('license_key').value = ''; loadKeys(); }
                else { msg.style.color = '#ff4d4d'; msg.innerText = '❌ ' + data.message; }
            });
            loadKeys();
        </script>
    </body>
    </html>
  `);
});

// API Routes
app.get('/api/admin/list', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.json({ ok: true, licenses: [] });
    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS licenses (id SERIAL PRIMARY KEY, license_key VARCHAR(255) UNIQUE NOT NULL, days_valid INT DEFAULT 30, device_id VARCHAR(255), is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`;
    const licenses = await sql`SELECT id, license_key, days_valid FROM licenses ORDER BY id DESC`;
    res.json({ ok: true, licenses });
  } catch (err) { res.json({ ok: true, licenses: [] }); }
});

app.post('/api/admin/delete', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    await sql`DELETE FROM licenses WHERE id = ${id}`;
    res.json({ ok: true, message: "Key berhasil dihapus!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/admin/create', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { license_key, days_valid } = req.body;
    if (!license_key) return res.status(400).json({ ok: false, message: "Key wajib diisi!" });
    const days = parseInt(days_valid) || 30;

    await sql`CREATE TABLE IF NOT EXISTS licenses (id SERIAL PRIMARY KEY, license_key VARCHAR(255) UNIQUE NOT NULL, days_valid INT DEFAULT 30, device_id VARCHAR(255), is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`;
    await sql`INSERT INTO licenses (license_key, days_valid, is_active) VALUES (${license_key}, ${days}, TRUE) ON CONFLICT (license_key) DO UPDATE SET days_valid = ${days}, is_active = TRUE`;
    
    res.json({ ok: true, message: `Key berhasil dibuat (Masa aktif: ${days} hari)!` });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/license', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diset!" });
    const sql = neon(process.env.DATABASE_URL);
    const { license_key, device_id } = req.body;
    if (!license_key) return res.json({ ok: false, message: "License key wajib diisi!" });

    const result = await sql`SELECT * FROM licenses WHERE license_key = ${license_key} AND is_active = TRUE`;
    if (result.length === 0) return res.json({ ok: false, message: "Key tidak valid!" });

    const record = result[0];
    const daysValid = record.days_valid || 30;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (daysValid * 24 * 60 * 60);

    const licenseData = {
      license_id: `CUSTOM-${record.id}`,
      plan: `VIP ${daysValid} HARI`,
      product: { code: "rio-rise", name: "Shadow Rio Rise", game: "Rio Rise" },
      device_id: device_id || record.device_id || "unknown",
      expires_at: expiresAt,
      server_time: now,
      session_token: "mock_session_" + Math.random(),
      session_expires_at: expiresAt,
      lib_enabled: true,
      library: {
        version: "2.0.42",
        sha256: "b54be9ef4af47ac9c901e83885ae67705bb7a4ec1d64c5a70adc15c86754ff50",
        size: 779152,
        min_app_version: "2.0.8",
        url: "https://shadowcheat.com/api/v1/library.php?version=2.0.8"
      },
      min_app_version: "2.0.8"
    };

    const base64Data = Buffer.from(JSON.stringify(licenseData)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    res.json({ ok: true, data: base64Data, signature: "dummy_signature" });
  } catch (err) { res.status(500).json({ ok: false, message: "Server Error: " + err.message }); }
});

module.exports = app;
