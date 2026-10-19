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

// Inisialisasi & Migrasi Otomatis Tabel Database (Mencegah Error Missing Column)
async function initDB(sql) {
  await sql`CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    license_key VARCHAR(255) UNIQUE NOT NULL,
    days_valid INT DEFAULT 30,
    unit VARCHAR(10) DEFAULT 'days',
    max_devices INT DEFAULT 1,
    device_id TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL
  );`;
  
  // Pastikan seluruh kolom aman dan ada jika tabel sudah terlanjur dibuat sebelumnya
  try { await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS days_valid INT DEFAULT 30`; } catch(e){}
  try { await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS unit VARCHAR(10) DEFAULT 'days'`; } catch(e){}
  try { await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS max_devices INT DEFAULT 1`; } catch(e){}
  try { await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS device_id TEXT DEFAULT ''`; } catch(e){}
  try { await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`; } catch(e){}
  try { await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL`; } catch(e){}
}

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
            .container { width: 100%; max-width: 680px; display: flex; flex-direction: column; gap: 20px; }
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
            .row-split { display: flex; gap: 10px; }
            .row-split > div { flex: 1; }
            button.submit-btn { width: 100%; padding: 13px; background: #00ffcc; color: #000; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
            button.submit-btn:hover { background: #00cca3; }
            .btn-random { background: #333; color: #fff; width: 110px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
            th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid #222; vertical-align: top; }
            th { color: #00ffcc; }
            .btn-delete { background: #ff4d4d; color: #fff; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; }
            .btn-reset { background: #ffa500; color: #fff; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; margin-bottom: 4px; }
            .badge { display: inline-block; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; background: #222; color: #00ffcc; margin-bottom: 5px; }
            .device-debug { font-size: 11px; color: #00ffcc; font-family: monospace; background: #1a1a1a; padding: 4px 6px; border-radius: 4px; margin-top: 3px; word-break: break-all; border: 1px solid #2a2a2a; }
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
                    <div class="row-split">
                        <div>
                            <label id="durationLabel">Masa Aktif (Hari):</label>
                            <input type="number" id="days_valid" value="30" min="1" required>
                        </div>
                        <div>
                            <label>Satuan Waktu:</label>
                            <select id="duration_unit" onchange="updateDurationLabel()">
                                <option value="days">Hari (Days)</option>
                                <option value="minutes">Menit (Test 1 Min)</option>
                            </select>
                        </div>
                    </div>
                    <label>Maksimal Device (Max Devices):</label>
                    <input type="number" id="max_devices" value="1" min="1" required>
                    
                    <button type="submit" class="submit-btn">Simpan ke Database Neon</button>
                </form>
                <div id="msg" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
            </div>
            <div class="card">
                <h3 style="color: #00ffcc; margin-top: 0; font-size: 16px; text-align: center;">Daftar Key & Debug Device ID</h3>
                <table>
                    <thead>
                        <tr><th>Key</th><th>Masa Aktif</th><th>Device Slot & Debug ID</th><th>Aksi</th></tr>
                    </thead>
                    <tbody id="keyList">
                        <tr><td colspan="4" style="text-align: center; color: #888;">Memuat data...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        <script>
            document.getElementById('apiUrlBox').innerText = 'API URL: ' + window.location.origin + '/api/license';
            
            function updateDurationLabel() {
                const unit = document.getElementById('duration_unit').value;
                const label = document.getElementById('durationLabel');
                if (unit === 'minutes') {
                    label.innerText = 'Masa Aktif (Menit):';
                } else {
                    label.innerText = 'Masa Aktif (Hari):';
                }
            }

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
                        
                        tbody.innerHTML = data.licenses.map(item => {
                            const devices = item.device_id ? item.device_id.split(',').filter(Boolean) : [];
                            const maxDev = item.max_devices || 1;
                            const isFull = devices.length >= maxDev;
                            const badgeColor = isFull ? '#ff4d4d' : '#00ffcc';
                            
                            // Render daftar device ID yang masuk untuk keperluan debug
                            let deviceHtml = \`<span class="badge" style="border: 1px solid \${badgeColor}; color: \${badgeColor};">\${devices.length} / \${maxDev} Device</span>\`;
                            if (devices.length > 0) {
                                deviceHtml += devices.map(d => \`<div class="device-debug">📱 \${d}</div>\`).join('');
                            } else {
                                deviceHtml += \`<div style="font-size: 11px; color: #666; margin-top: 2px;">Belum ada device masuk</div>\`;
                            }

                            return \`
                                <tr>
                                    <td style="font-family: monospace; color: #00ffcc; font-weight: bold;">\${item.license_key}</td>
                                    <td>\${item.days_valid} \${item.unit === 'minutes' ? 'Menit' : 'Hari'}</td>
                                    <td>\${deviceHtml}</td>
                                    <td>
                                        <button class="btn-reset" onclick="resetDevice(\${item.id})" title="Reset Device ID">Reset</button><br>
                                        <button class="btn-delete" onclick="deleteKey(\${item.id})">Hapus</button>
                                    </td>
                                </tr>
                            \`;
                        }).join('');
                    } else {
                        document.getElementById('storageStatus').innerText = '0 / 500 Keys (Kosong)';
                        document.getElementById('storageBar').style.width = '2%';
                        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888;">Belum ada key tersimpan.</td></tr>';
                    }
                } catch(err) { console.error(err); }
            }

            async function deleteKey(id) {
                if(!confirm('Yakin ingin menghapus key ini?')) return;
                const res = await fetch('/api/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
                const data = await res.json();
                if(data.ok) loadKeys(); else alert('Gagal: ' + data.message);
            }

            async function resetDevice(id) {
                if(!confirm('Reset Device ID untuk key ini agar bisa dipakai perangkat baru?')) return;
                const res = await fetch('/api/admin/reset-device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
                const data = await res.json();
                if(data.ok) { loadKeys(); } else { alert('Gagal: ' + data.message); }
            }

            document.getElementById('formKey').addEventListener('submit', async (e) => {
                e.preventDefault();
                const key = document.getElementById('license_key').value;
                const days = document.getElementById('days_valid').value;
                const unit = document.getElementById('duration_unit').value;
                const max_devices = document.getElementById('max_devices').value;
                const msg = document.getElementById('msg');
                msg.style.color = '#ccc'; msg.innerText = 'Menyimpan...';
                
                const res = await fetch('/api/admin/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_key: key, days_valid: days, unit: unit, max_devices: max_devices }) });
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
    await initDB(sql);
    const licenses = await sql`SELECT id, license_key, days_valid, unit, max_devices, device_id, expires_at FROM licenses ORDER BY id DESC`;
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

app.post('/api/admin/reset-device', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    await sql`UPDATE licenses SET device_id = '' WHERE id = ${id}`;
    res.json({ ok: true, message: "Device ID berhasil di-reset!" });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/admin/create', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);

    const { license_key, days_valid, unit, max_devices } = req.body;
    if (!license_key) return res.status(400).json({ ok: false, message: "Key wajib diisi!" });
    
    const duration = parseInt(days_valid) || 30;
    const durationUnit = unit === 'minutes' ? 'minutes' : 'days';
    const maxDev = parseInt(max_devices) || 1;

    if (durationUnit === 'minutes') {
      await sql`
        INSERT INTO licenses (license_key, days_valid, unit, max_devices, device_id, created_at, expires_at) 
        VALUES (${license_key}, ${duration}, ${durationUnit}, ${maxDev}, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + (${duration} * INTERVAL '1 minute'))
        ON CONFLICT (license_key) DO UPDATE 
        SET days_valid = ${duration}, unit = ${durationUnit}, max_devices = ${maxDev}, created_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP + (${duration} * INTERVAL '1 minute')
      `;
    } else {
      await sql`
        INSERT INTO licenses (license_key, days_valid, unit, max_devices, device_id, created_at, expires_at) 
        VALUES (${license_key}, ${duration}, ${durationUnit}, ${maxDev}, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + (${duration} * INTERVAL '1 day'))
        ON CONFLICT (license_key) DO UPDATE 
        SET days_valid = ${duration}, unit = ${durationUnit}, max_devices = ${maxDev}, created_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP + (${duration} * INTERVAL '1 day')
      `;
    }
    
    res.json({ ok: true, message: `Key berhasil dibuat (${duration} ${durationUnit === 'minutes' ? 'menit' : 'hari'}, Max ${maxDev} Device)!` });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

app.post('/api/license', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diset!" });
    const sql = neon(process.env.DATABASE_URL);
    await initDB(sql);

    const { license_key, device_id } = req.body;
    if (!license_key) return res.json({ ok: false, message: "License key wajib diisi!" });

    const result = await sql`SELECT * FROM licenses WHERE license_key = ${license_key}`;
    if (result.length === 0) return res.json({ ok: false, message: "Key tidak valid!" });

    const record = result[0];

    // 1. Cek Apakah Key Expired
    if (record.expires_at) {
      const nowMs = Date.now();
      const expiresMs = new Date(record.expires_at).getTime();
      if (nowMs > expiresMs) {
        return res.json({ ok: false, message: "License key sudah kedaluwarsa (expired)!" });
      }
    }

    // 2. Validasi & Binding Device ID (Max Devices Check)
    const clientDevice = device_id || "unknown";
    const maxDevs = record.max_devices || 1;
    let boundDevices = record.device_id ? record.device_id.split(',').map(s => s.trim()).filter(Boolean) : [];

    if (boundDevices.includes(clientDevice)) {
      // Device sudah terdaftar sebelumnya, izinkan masuk
    } else {
      if (boundDevices.length < maxDevs) {
        // Slot masih ada, daftarkan device baru ini
        boundDevices.push(clientDevice);
        const newDeviceStr = boundDevices.join(',');
        await sql`UPDATE licenses SET device_id = ${newDeviceStr} WHERE id = ${record.id}`;
      } else {
        // Slot penuh dan device berbeda
        return res.json({ 
          ok: false, 
          message: `Slot device penuh! (${boundDevices.length}/${maxDevs} device terdaftar). Reset device di admin panel jika ingin mengganti perangkat.` 
        });
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresTimestamp = record.expires_at ? Math.floor(new Date(record.expires_at).getTime() / 1000) : (now + 86400);

    const licenseData = {
      license_id: `CUSTOM-${record.id}`,
      plan: `VIP ${record.days_valid} ${record.unit === 'minutes' ? 'MENIT' : 'HARI'}`,
      product: { code: "rio-rise", name: "Shadow Rio Rise", game: "Rio Rise" },
      device_id: clientDevice,
      expires_at: expiresTimestamp,
      server_time: now,
      session_token: "mock_session_" + Math.random(),
      session_expires_at: expiresTimestamp,
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
