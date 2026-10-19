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
  try {
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
              input, select { width: 100%; padding: 12px; background: #1e1e1e; border: 1px solid #333; color: #fff; border-radius: 6px; margin-bottom: 15px; box-sizing: border-box; font-size: 14px; }
              .row { display: flex; gap: 10px; }
              button.submit-btn { width: 100%; padding: 13px; background: #00ffcc; color: #000; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
              button.submit-btn:hover { background: #00cca3; }
              .btn-random { background: #333; color: #fff; width: 110px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 15px; height: 45px; }
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
                  <p class="sub">🔒 Secure Neon PostgreSQL Storage (Safe Mode)</p>
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

                      <label>Masa Aktif / Durasi:</label>
                      <select id="duration_preset" onchange="onPresetChange()">
                          <option value="1_minute">⚡ 1 Menit (Test Expired)</option>
                          <option value="1_hour">1 Jam</option>
                          <option value="1_day">1 Hari</option>
                          <option value="7_days">7 Hari</option>
                          <option value="30_days" selected>30 Hari (Default)</option>
                          <option value="custom">Custom (Atur Manual)</option>
                      </select>

                      <div id="customDurationBox" style="display: none; gap: 10px;">
                          <input type="number" id="duration_value" value="30" placeholder="Nilai" style="flex: 2;">
                          <select id="duration_unit" style="flex: 1;">
                              <option value="minutes">Menit</option>
                              <option value="hours">Jam</option>
                              <option value="days" selected>Hari</option>
                          </select>
                      </div>

                      <button type="submit" class="submit-btn">Simpan ke Database Neon</button>
                  </form>
                  <div id="msg"></div>
              </div>
              <div class="card">
                  <h3 style="color: #00ffcc; margin-top: 0; font-size: 16px; text-align: center;">Daftar Key yang Telah Dibuat</h3>
                  <table>
                      <thead>
                          <tr><th>Key</th><th>Durasi</th><th>Aksi</th></tr>
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

              function onPresetChange() {
                  const preset = document.getElementById('duration_preset').value;
                  const customBox = document.getElementById('customDurationBox');
                  if (preset === 'custom') {
                      customBox.style.display = 'flex';
                  } else {
                      customBox.style.display = 'none';
                  }
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
                                  <td>\${item.duration_value} \${item.duration_unit === 'minutes' ? 'Menit' : item.duration_unit === 'hours' ? 'Jam' : 'Hari'}</td>
                                  <td><button class="btn-delete" onclick="deleteKey(\${item.id})">Hapus</button></td>
                              </tr>
                          \`).join('');
                      } else {
                          document.getElementById('storageStatus').innerText = '0 / 500 Keys (Kosong atau Error DB)';
                          document.getElementById('storageBar').style.width = '2%';
                          tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #888;">' + (data.message || 'Belum ada key tersimpan.') + '</td></tr>';
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
                  const preset = document.getElementById('duration_preset').value;
                  
                  let val = 30;
                  let unit = 'days';

                  if (preset === '1_minute') {
                      val = 1; unit = 'minutes';
                  } else if (preset === '1_hour') {
                      val = 1; unit = 'hours';
                  } else if (preset === '1_day') {
                      val = 1; unit = 'days';
                  } else if (preset === '7_days') {
                      val = 7; unit = 'days';
                  } else if (preset === '30_days') {
                      val = 30; unit = 'days';
                  } else {
                      val = parseInt(document.getElementById('duration_value').value) || 30;
                      unit = document.getElementById('duration_unit').value;
                  }

                  const msg = document.getElementById('msg');
                  msg.style.color = '#ccc'; msg.innerText = 'Menyimpan...';
                  
                  const res = await fetch('/api/admin/create', { 
                      method: 'POST', 
                      headers: { 'Content-Type': 'application/json' }, 
                      body: JSON.stringify({ license_key: key, duration_value: val, duration_unit: unit }) 
                  });
                  const data = await res.json();
                  if(data.ok) { 
                      msg.style.color = '#00ffcc'; 
                      msg.innerText = '✅ ' + data.message; 
                      document.getElementById('license_key').value = ''; 
                      loadKeys(); 
                  } else { 
                      msg.style.color = '#ff4d4d'; 
                      msg.innerText = '❌ ' + data.message; 
                  }
              });

              loadKeys();
          </script>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Render Error: " + err.message);
  }
});

// Helper function to ensure table has the correct columns
async function ensureTable(sql) {
  try {
    await sql`CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY, 
      license_key VARCHAR(255) UNIQUE NOT NULL, 
      duration_value INT DEFAULT 30, 
      duration_unit VARCHAR(20) DEFAULT 'days', 
      device_id VARCHAR(255), 
      is_active BOOLEAN DEFAULT TRUE, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;
  } catch (err) {
    console.error("ensureTable Error:", err.message);
    throw err;
  }
}

// API Routes
app.get('/api/admin/list', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.json({ ok: false, licenses: [], message: "DATABASE_URL belum diset di Vercel Environment Variables!" });
    }
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);
    const licenses = await sql`SELECT id, license_key, duration_value, duration_unit, created_at FROM licenses ORDER BY id DESC`;
    res.json({ ok: true, licenses });
  } catch (err) { 
    res.json({ ok: false, licenses: [], message: "DB Error: " + err.message }); 
  }
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
    const { license_key, duration_value, duration_unit } = req.body;
    if (!license_key) return res.status(400).json({ ok: false, message: "Key wajib diisi!" });
    
    const val = parseInt(duration_value) || 30;
    const unit = duration_unit || 'days';

    await ensureTable(sql);
    
    await sql`INSERT INTO licenses (license_key, duration_value, duration_unit, is_active) 
              VALUES (${license_key}, ${val}, ${unit}, TRUE) 
              ON CONFLICT (license_key) 
              DO UPDATE SET duration_value = ${val}, duration_unit = ${unit}, is_active = TRUE, created_at = CURRENT_TIMESTAMP`;
    
    res.json({ ok: true, message: `Key berhasil dibuat (${val} ${unit === 'minutes' ? 'Menit' : unit === 'hours' ? 'Jam' : 'Hari'})!` });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/license', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diset!" });
    const sql = neon(process.env.DATABASE_URL);
    const { license_key, device_id } = req.body;
    if (!license_key) return res.json({ ok: false, message: "License key wajib diisi!" });

    const result = await sql`SELECT * FROM licenses WHERE license_key = ${license_key} AND is_active = TRUE`;
    if (result.length === 0) return res.json({ ok: false, message: "Key tidak valid atau sudah tidak aktif!" });

    const record = result[0];
    const val = record.duration_value || 30;
    const unit = record.duration_unit || 'days';

    const createdAtTime = new Date(record.created_at).getTime();
    let durationMs = val * 24 * 60 * 60 * 1000;

    if (unit === 'minutes') {
      durationMs = val * 60 * 1000;
    } else if (unit === 'hours') {
      durationMs = val * 60 * 60 * 1000;
    } else if (unit === 'days') {
      durationMs = val * 24 * 60 * 60 * 1000;
    }

    const expiresAtMs = createdAtTime + durationMs;
    const nowMs = Date.now();

    if (nowMs > expiresAtMs) {
      return res.json({ ok: false, message: "License key sudah expired (kedaluwarsa)!" });
    }

    const expiresAt = Math.floor(expiresAtMs / 1000);
    const now = Math.floor(nowMs / 1000);

    const licenseData = {
      license_id: `CUSTOM-${record.id}`,
      plan: `VIP ${val} ${unit.toUpperCase()}`,
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
