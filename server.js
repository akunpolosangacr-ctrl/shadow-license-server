const express = require('express');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json());

const ADMIN_USER = process.env.ADMIN_USER || "shadow";
const ADMIN_PASS = process.env.ADMIN_PASS || "rizky123@";

// Middleware Proteksi Password (HTTP Basic Auth) yang Aman dari Crash
const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Shadow Admin Protected Area"');
      return res.status(401).send('Autentikasi diperlukan.');
    }
    const parts = authHeader.split(' ');
    if (parts.length < 2) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Shadow Admin Protected Area"');
      return res.status(401).send('Format auth salah.');
    }
    const credentials = Buffer.from(parts[1], 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (username === ADMIN_USER && password === ADMIN_PASS) {
      return next();
    }
  } catch (err) {}

  res.setHeader('WWW-Authenticate', 'Basic realm="Shadow Admin Protected Area"');
  return res.status(401).send('Access Denied: Username atau Password salah!');
};

// ==================== FRONTEND DASHBOARD (ULTRA PREMIUM UI) ====================
app.get('/', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Shadow License | Secure Admin Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg-deep: #07090D;
                --bg-card: #11151C;
                --bg-card-hover: #161C26;
                --border-color: #1F2836;
                --accent-cyan: #00FFCC;
                --accent-emerald: #10B981;
                --accent-danger: #EF4444;
                --text-main: #F3F4F6;
                --text-muted: #9CA3AF;
                --font-sans: 'Plus Jakarta Sans', sans-serif;
                --font-mono: 'JetBrains Mono', monospace;
            }

            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
                background-color: var(--bg-deep);
                color: var(--text-main);
                font-family: var(--font-sans);
                min-height: 100vh;
                padding: 16px;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                -webkit-font-smoothing: antialiased;
            }

            .dashboard-container {
                width: 100%;
                max-width: 800px;
                display: flex;
                flex-direction: column;
                gap: 20px;
                animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(12px); }
                to { opacity: 1; transform: translateY(0); }
            }

            /* Header Styles */
            .header-card {
                background: var(--bg-card);
                border: 1px solid var(--border-color);
                border-radius: 16px;
                padding: 20px 24px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            }
            .brand-group { display: flex; align-items: center; gap: 14px; }
            .brand-icon {
                width: 44px; height: 44px; background: rgba(0, 255, 204, 0.1);
                border: 1px solid rgba(0, 255, 204, 0.3); border-radius: 12px;
                display: flex; align-items: center; justify-content: center;
            }
            .brand-icon svg { width: 22px; height: 22px; stroke: var(--accent-cyan); }
            .brand-title h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; color: #fff; }
            .brand-title p { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

            .header-badges { display: flex; align-items: center; gap: 8px; }
            .badge {
                display: flex; align-items: center; gap: 6px;
                background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2);
                padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; color: var(--accent-emerald);
            }
            .badge-dot { width: 6px; height: 6px; background: var(--accent-emerald); border-radius: 50%; box-shadow: 0 0 8px var(--accent-emerald); }

            .sound-toggle {
                background: var(--bg-card-hover); border: 1px solid var(--border-color);
                color: var(--text-muted); width: 36px; height: 36px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s;
            }
            .sound-toggle.active { color: var(--accent-cyan); border-color: rgba(0,255,204,0.4); }

            /* Grid Stats */
            .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
            @media(min-width: 540px) { .stats-grid { grid-template-columns: repeat(4, 1fr); } }
            .stat-card {
                background: var(--bg-card); border: 1px solid var(--border-color);
                border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 8px;
            }
            .stat-label { font-size: 11px; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
            .stat-value { font-size: 20px; font-weight: 700; color: #fff; font-family: var(--font-mono); }

            /* Storage Progress Bar */
            .storage-card {
                background: var(--bg-card); border: 1px solid var(--border-color);
                border-radius: 14px; padding: 16px 20px;
            }
            .storage-header { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; font-weight: 500; }
            .storage-track { width: 100%; height: 6px; background: var(--border-color); border-radius: 3px; overflow: hidden; }
            .storage-fill { width: 0%; height: 100%; background: linear-gradient(90deg, var(--accent-cyan), var(--accent-emerald)); border-radius: 3px; transition: width 0.5s ease; }

            /* Card Containers */
            .card {
                background: var(--bg-card); border: 1px solid var(--border-color);
                border-radius: 16px; padding: 22px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            }
            .card-title { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
            
            .url-display {
                background: #0D1117; border: 1px dashed var(--border-color);
                padding: 10px 14px; border-radius: 8px; font-size: 12px;
                font-family: var(--font-mono); color: var(--accent-cyan); word-break: break-all; margin-bottom: 16px;
            }

            /* Form Styling */
            .form-group { margin-bottom: 14px; }
            label { display: block; font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 6px; }
            .input-row { display: flex; gap: 8px; }
            input {
                width: 100%; background: var(--bg-deep); border: 1px solid var(--border-color);
                color: #fff; padding: 12px 14px; border-radius: 10px; font-size: 13px; font-family: var(--font-mono);
                transition: border-color 0.2s; outline: none;
            }
            input:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 2px rgba(0,255,204,0.15); }
            
            .btn {
                padding: 12px 18px; border-radius: 10px; font-weight: 600; font-size: 13px;
                cursor: pointer; border: none; transition: 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            }
            .btn-primary { background: var(--accent-cyan); color: #000; width: 100%; }
            .btn-primary:hover { background: #00cca3; }
            .btn-secondary { background: var(--bg-card-hover); border: 1px solid var(--border-color); color: var(--text-main); }
            .btn-secondary:hover { background: #1f2836; border-color: #334155; }
            .btn-danger { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--accent-danger); padding: 6px 12px; font-size: 11px; }
            .btn-danger:hover { background: rgba(239, 68, 68, 0.25); }

            /* Table Layout */
            .table-wrapper { width: 100%; overflow-x: auto; margin-top: 10px; }
            table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
            th { color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
            td { padding: 12px; border-bottom: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 12px; }
            tr:hover td { background: rgba(255,255,255,0.01); }

            .empty-state { text-align: center; color: var(--text-muted); padding: 24px; font-size: 13px; }
            
            /* Toast Notifications */
            #toastContainer { position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; }
            .toast {
                background: #11151C; border: 1px solid var(--border-color); color: #fff;
                padding: 12px 18px; border-radius: 10px; font-size: 12px; font-weight: 500;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 10px;
                animation: toastIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            .toast.success { border-color: rgba(16, 185, 129, 0.4); }
            .toast.error { border-color: rgba(239, 68, 68, 0.4); }
            @keyframes toastIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    </head>
    <body>
        <div class="dashboard-container">
            <!-- Header -->
            <div class="header-card">
                <div class="brand-group">
                    <div class="brand-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                    <div class="brand-title">
                        <h1>SHADOW LICENSE</h1>
                        <p>Secure License Management System</p>
                    </div>
                </div>
                <div class="header-badges">
                    <div class="badge"><span class="badge-dot"></span><span>Online</span></div>
                    <button class="sound-toggle" id="soundToggleBtn" title="Toggle UI Sound" onclick="toggleSound()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
                    </button>
                </div>
            </div>

            <!-- Stats Grid -->
            <div class="stats-grid">
                <div class="stat-card">
                    <span class="stat-label">Total Licenses</span>
                    <span class="stat-value" id="statTotal">-</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">Active</span>
                    <span class="stat-value" id="statActive" style="color: var(--accent-emerald)">-</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">Inactive</span>
                    <span class="stat-value" id="statInactive" style="color: var(--accent-danger)">-</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">Capacity</span>
                    <span class="stat-value" id="statCapacity">-</span>
                </div>
            </div>

            <!-- Storage Capacity Bar -->
            <div class="storage-card">
                <div class="storage-header">
                    <span>Neon Database Storage Limit</span>
                    <span id="storageText">Calculated...</span>
                </div>
                <div class="storage-track">
                    <div class="storage-fill" id="storageBar"></div>
                </div>
            </div>

            <!-- License Creator Form -->
            <div class="card">
                <div class="card-title">Generate New License Key</div>
                <div class="url-display" id="apiUrlBox">API Endpoint: Loading...</div>

                <form id="formKey">
                    <div class="form-group">
                        <label>Custom License Key:</label>
                        <div class="input-row">
                            <input type="text" id="license_key" placeholder="Contoh: RIO-VIP-XXXXX" required autocomplete="off">
                            <button type="button" class="btn btn-secondary" onclick="generateRandomKey()">Random</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Masa Aktif (Hari):</label>
                        <input type="number" id="days_valid" value="30" min="1" max="3650" required>
                    </div>
                    <button type="submit" class="btn btn-primary" id="submitBtn">Simpan ke Database Neon</button>
                </form>
                <div id="msg"></div>
            </div>

            <!-- License Management Table -->
            <div class="card">
                <div class="card-title">Database Records & Management</div>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Key</th>
                                <th>Masa Aktif</th>
                                <th>Status</th>
                                <th style="text-align: right;">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="keyList">
                            <tr><td colspan="4" class="empty-state">Memuat data dari database...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div id="toastContainer"></div>

        <script>
            let soundEnabled = localStorage.getItem('shadow_sound') === 'true';
            updateSoundIcon();

            function toggleSound() {
                soundEnabled = !soundEnabled;
                localStorage.setItem('shadow_sound', soundEnabled);
                updateSoundIcon();
                if(soundEnabled) playBeep(600, 0.05, 'sine');
            }

            function updateSoundIcon() {
                const btn = document.getElementById('soundToggleBtn');
                if(soundEnabled) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }

            function playBeep(freq, duration, type='sine') {
                if(!soundEnabled) return;
                try {
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = type;
                    osc.frequency.value = freq;
                    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start();
                    osc.stop(audioCtx.currentTime + duration);
                } catch(e) {}
            }

            function showToast(text, type='success') {
                const container = document.getElementById('toastContainer');
                const toast = document.createElement('div');
                toast.className = 'toast ' + type;
                toast.innerHTML = '<span>' + (type==='success'?'✅':'❌') + '</span> ' + text;
                container.appendChild(toast);
                setTimeout(() => {
                    toast.style.opacity = '0';
                    setTimeout(() => toast.remove(), 300);
                }, 3000);
            }

            document.getElementById('apiUrlBox').innerText = 'API URL: ' + window.location.origin + '/api/license';

            function generateRandomKey() {
                playBeep(800, 0.04);
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let res = 'RIO-';
                for(let i=0; i<10; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
                document.getElementById('license_key').value = res;
            }

            async function loadDashboardData() {
                try {
                    const res = await fetch('/api/admin/list');
                    const data = await res.json();
                    const tbody = document.getElementById('keyList');

                    if(!data.ok) {
                        throw new Error(data.message || 'Gagal memuat database');
                    }

                    const licenses = data.licenses || [];
                    const total = licenses.length;
                    const activeCount = licenses.filter(l => l.is_active).length;
                    const inactiveCount = total - activeCount;

                    document.getElementById('statTotal').innerText = total;
                    document.getElementById('statActive').innerText = activeCount;
                    document.getElementById('statInactive').innerText = inactiveCount;
                    document.getElementById('statCapacity').innerText = total + '/500';

                    document.getElementById('storageText').innerText = total + ' dari 500 Slot Terpakai (' + Math.round((total/500)*100) + '%)';
                    document.getElementById('storageBar').style.width = Math.min((total / 500) * 100, 100) + '%';

                    if (total > 0) {
                        tbody.innerHTML = licenses.map(item => \`
                            <tr>
                                <td style="color: var(--accent-cyan); font-weight: 600;">\${item.license_key}</td>
                                <td>\${item.days_valid || 30} Hari</td>
                                <td><span style="color: \${item.is_active ? 'var(--accent-emerald)' : 'var(--accent-danger)'}">\${item.is_active ? '● Aktif' : '○ Nonaktif'}</span></td>
                                <td style="text-align: right;">
                                    <button class="btn btn-danger" onclick="deleteKey(\${item.id})">Hapus</button>
                                </td>
                            </tr>
                        \`).join('');
                    } else {
                        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Belum ada license key tersimpan di database.</td></tr>';
                    }
                } catch(err) {
                    showToast('Gagal memuat data: ' + err.message, 'error');
                    document.getElementById('keyList').innerHTML = '<tr><td colspan="4" class="empty-state" style="color: var(--accent-danger);">Gagal terhubung ke database.</td></tr>';
                }
            }

            async function deleteKey(id) {
                if(!confirm('Yakin ingin menghapus lisensi ini dari database?')) return;
                playBeep(300, 0.08, 'sawtooth');
                try {
                    const res = await fetch('/api/admin/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id })
                    });
                    const data = await res.json();
                    if(data.ok) {
                        showToast('License berhasil dihapus.');
                        loadDashboardData();
                    } else {
                        showToast(data.message || 'Gagal menghapus.', 'error');
                    }
                } catch(e) {
                    showToast('Terjadi kesalahan jaringan.', 'error');
                }
            }

            document.getElementById('formKey').addEventListener('submit', async (e) => {
                e.preventDefault();
                const keyInput = document.getElementById('license_key');
                const daysInput = document.getElementById('days_valid');
                const submitBtn = document.getElementById('submitBtn');
                const msg = document.getElementById('msg');

                const key = keyInput.value.trim();
                const days = parseInt(daysInput.value);

                if(!key || isNaN(days) || days <= 0) {
                    showToast('Mohon isi key dan durasi dengan benar.', 'error');
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.innerText = 'Menyimpan...';
                msg.innerText = '';

                try {
                    const res = await fetch('/api/admin/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ license_key: key, days_valid: days })
                    });
                    const data = await res.json();

                    if(data.ok) {
                        playBeep(1200, 0.1, 'triangle');
                        showToast('License berhasil dibuat & disimpan!');
                        keyInput.value = '';
                        loadDashboardData();
                    } else {
                        playBeep(250, 0.15, 'sawtooth');
                        showToast(data.message || 'Gagal menyimpan.', 'error');
                    }
                } catch(err) {
                    showToast('Kesalahan koneksi server.', 'error');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerText = 'Simpan ke Database Neon';
                }
            });

            loadDashboardData();
        </script>
    </body>
    </html>
  `);
});

// ==================== BACKEND API ROUTES ====================

// 1. Endpoint Daftar Lisensi
app.get('/api/admin/list', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur di environment variables!" });
    }
    const sql = neon(process.env.DATABASE_URL);
    
    await sql`
      CREATE TABLE IF NOT EXISTS licenses (
          id SERIAL PRIMARY KEY,
          license_key VARCHAR(255) UNIQUE NOT NULL,
          days_valid INT DEFAULT 30,
          device_id VARCHAR(255),
          is_active BOOLEAN DEFAULT TRUE,
          expires_at BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const licenses = await sql`SELECT id, license_key, days_valid, is_active, expires_at, created_at FROM licenses ORDER BY id DESC`;
    res.json({ ok: true, licenses });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Database Error: " + err.message });
  }
});

// 2. Endpoint Hapus Lisensi
app.post('/api/admin/delete', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur!" });
    const sql = neon(process.env.DATABASE_URL);
    const { id } = req.body;
    
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, message: "ID tidak valid!" });

    await sql`DELETE FROM licenses WHERE id = ${id}`;
    res.json({ ok: true, message: "Key berhasil dihapus!" });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 3. Endpoint Buat Lisensi (Menyimpan Stable Expiration Timestamp Secara Permanen)
app.post('/api/admin/create', requireAuth, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diatur di Vercel!" });
    const sql = neon(process.env.DATABASE_URL);
    const { license_key, days_valid } = req.body;
    
    if (!license_key || typeof license_key !== 'string' || license_key.trim() === '') {
      return res.status(400).json({ ok: false, message: "License key wajib diisi!" });
    }

    const days = parseInt(days_valid);
    if (isNaN(days) || days <= 0 || days > 3650) {
      return res.status(400).json({ ok: false, message: "Durasi hari tidak valid (1 - 3650)!" });
    }

    await sql`
      CREATE TABLE IF NOT EXISTS licenses (
          id SERIAL PRIMARY KEY,
          license_key VARCHAR(255) UNIQUE NOT NULL,
          days_valid INT DEFAULT 30,
          device_id VARCHAR(255),
          is_active BOOLEAN DEFAULT TRUE,
          expires_at BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = nowSec + (days * 24 * 60 * 60);

    await sql`
      INSERT INTO licenses (license_key, days_valid, is_active, expires_at)
      VALUES (${license_key.trim()}, ${days}, TRUE, ${expiresAt})
      ON CONFLICT (license_key) 
      DO UPDATE SET days_valid = ${days}, is_active = TRUE, expires_at = ${expiresAt}
    `;

    res.json({ ok: true, message: \`Key berhasil dibuat & disimpan (Masa aktif: \${days} hari)!\` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 4. Endpoint Publik Verifikasi APK (Mencegah Rolling Expiration / Waktu Bergeser)
app.post('/api/license', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false, message: "DATABASE_URL belum diset!" });
    const sql = neon(process.env.DATABASE_URL);
    const { license_key, device_id } = req.body;

    if (!license_key) return res.json({ ok: false, message: "License key wajib diisi!" });

    const result = await sql`
      SELECT * FROM licenses WHERE license_key = ${license_key} AND is_active = TRUE
    `;

    if (result.length === 0) {
      return res.json({ ok: false, message: "Key tidak valid atau sudah tidak aktif!" });
    }

    const record = result[0];
    const daysValid = record.days_valid || 30;
    const now = Math.floor(Date.now() / 1000);

    let expiresAt = record.expires_at;
    if (!expiresAt) {
      const createdAtSeconds = Math.floor(new Date(record.created_at).getTime() / 1000);
      expiresAt = createdAtSeconds + (daysValid * 24 * 60 * 60);
    }

    if (now > expiresAt) {
      return res.json({ ok: false, message: "Masa aktif lisensi telah kedaluwarsa!" });
    }

    const licenseData = {
      license_id: 'CUSTOM-' + record.id,
      plan: 'VIP ' + daysValid + ' HARI',
      product: {
        code: "rio-rise",
        name: "Shadow Rio Rise",
        game: "Rio Rise"
      },
      device_id: device_id || record.device_id || "unknown",
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

    const base64Data = Buffer.from(JSON.stringify(licenseData)).toString('base64')
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

module.exports = app;
