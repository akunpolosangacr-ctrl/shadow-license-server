const express = require('express');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json());

// Halaman Utama Admin (HTML untuk Create Key & Atur Masa Aktif/Days)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Shadow License Admin Panel</title>
        <style>
            body { background: #0a0a0a; color: #fff; font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: #121212; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,255,204,0.1); width: 100%; max-width: 450px; border: 1px solid #222; }
            h2 { color: #00ffcc; text-align: center; margin-bottom: 5px; }
            p.sub { font-size: 12px; color: #888; text-align: center; margin-bottom: 25px; }
            label { display: block; margin-bottom: 8px; font-size: 13px; color: #ccc; }
            input { width: 100%; padding: 12px; background: #1e1e1e; border: 1px solid #333; color: #fff; border-radius: 6px; margin-bottom: 15px; box-sizing: border-box; }
            .row { display: flex; gap: 10px; }
            button { width: 100%; padding: 12px; background: #00ffcc; color: #000; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; transition: 0.2s; }
            button:hover { background: #00cca3; }
            .btn-random { background: #333; color: #fff; width: 120px; }
            .btn-random:hover { background: #444; }
            #msg { margin-top: 15px; text-align: center; font-size: 13px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Shadow License Admin</h2>
            <p class="sub">Endpoint APK: <code style="color:#00ffcc">/api/license</code></p>
            <form id="formKey">
                <label>Custom License Key:</label>
                <div class="row">
                    <input type="text" id="license_key" placeholder="Contoh: VIP123 / RIO-999" required>
                    <button type="button" class="btn-random" onclick="generateKey()">Random</button>
                </div>
                <label>Masa Aktif (Hari / Days):</label>
                <input type="number" id="days_valid" value="30" required>
                <button type="submit">Simpan ke Database Neon</button>
            </form>
            <div id="msg"></div>
        </div>
        <script>
            function generateKey() {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let res = 'RIO-';
                for(let i=0; i<10; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
                document.getElementById('license_key').value = res;
            }

            document.getElementById('formKey').addEventListener('submit', async (e) => {
                e.preventDefault();
                const key = document.getElementById('license_key').value;
                const days = document.getElementById('days_valid').value;
                const msg = document.getElementById('msg');
                msg.style.color = '#ccc';
                msg.innerText = 'Menyimpan...';

                try {
                    const res = await fetch('/api/admin/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ license_key: key, days_valid: days })
                    });
                    const data = await res.json();
                    if(data.ok) {
                        msg.style.color = '#00ffcc';
                        msg.innerText = '✅ ' + data.message;
                        document.getElementById('license_key').value = '';
                    } else {
                        msg.style.color = '#ff4d4d';
                        msg.innerText = '❌ ' + data.message;
                    }
                } catch(err) {
                    msg.style.color = '#ff4d4d';
                    msg.innerText = '❌ Gagal terhubung ke server.';
                }
            });
        </script>
    </body>
    </html>
  `);
});

// API Admin: Simpan Key ke Neon DB
app.post('/api/admin/create', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur di Vercel Environment Variables!" });
    }
    const sql = neon(process.env.DATABASE_URL);
    const { license_key, days_valid } = req.body;
    
    if (!license_key) return res.status(400).json({ ok: false, message: "Key wajib diisi!" });

    const days = parseInt(days_valid) || 30;

    await sql`
      CREATE TABLE IF NOT EXISTS licenses (
          id SERIAL PRIMARY KEY,
          license_key VARCHAR(255) UNIQUE NOT NULL,
          days_valid INT DEFAULT 30,
          device_id VARCHAR(255),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      INSERT INTO licenses (license_key, days_valid, is_active)
      VALUES (${license_key}, ${days}, TRUE)
      ON CONFLICT (license_key) 
      DO UPDATE SET days_valid = ${days}, is_active = TRUE
    `;

    res.json({ ok: true, message: `Key berhasil dibuat (Masa aktif: ${days} hari)!` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// API Verifikasi License untuk APK
app.post('/api/license', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ ok: false, message: "DATABASE_URL belum diset!" });
    }
    const sql = neon(process.env.DATABASE_URL);
    const body = req.body;
    const { license_key, device_id } = body;

    if (!license_key) {
      return res.json({ ok: false, message: "License key wajib diisi!" });
    }

    const result = await sql`
      SELECT * FROM licenses WHERE license_key = ${license_key} AND is_active = TRUE
    `;

    if (result.length === 0) {
      return res.json({ ok: false, message: "Key tidak valid atau sudah tidak aktif!" });
    }

    const licenseRecord = result[0];
    const daysValid = licenseRecord.days_valid || 30;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (daysValid * 24 * 60 * 60);

    const licenseData = {
      license_id: `CUSTOM-${licenseRecord.id}`,
      plan: `VIP ${daysValid} HARI`,
      product: {
        code: "rio-rise",
        name: "Shadow Rio Rise",
        game: "Rio Rise"
      },
      device_id: device_id || licenseRecord.device_id || "unknown",
      expires_at: expiresAt,
      server_time: now,
      session_token: "mock_session_token_" + Math.random(),
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

    const jsonStr = JSON.stringify(licenseData);
    const base64Data = Buffer.from(jsonStr).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    res.json({
      ok: true,
      data: base64Data,
      signature: "dummy_signature_terserah"
    });

  } catch (err) {
    res.status(500).json({ ok: false, message: "Server Error: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
