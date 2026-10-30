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

let PRIVATE_KEY;
try {
  const kp = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  PRIVATE_KEY = kp.privateKey;
} catch (e) {
  PRIVATE_KEY = '';
}

// Helper untuk Base64 URL-Safe tanpa padding (flag 0xb setara dengan Android Base64.URL_SAFE | NO_WRAP | NO_PADDING)
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

    const { license_key, device_id } = req.body;
    if (!license_key) return res.json({ ok: false, message: "Key wajib diisi!" });

    const result = await sql`SELECT * FROM licenses WHERE license_key = ${String(license_key).trim()}`;
    if (result.length === 0) return res.json({ ok: false, message: "Key tidak valid!" });

    const record = result[0];
    const nowMs = Date.now();

    if (record.suspended) return res.json({ ok: false, message: "Acesso suspenso pelo servidor." });
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
    
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionExpiresAt = record.expires_at ? new Date(record.expires_at) : new Date(nowMs + 10 * 60 * 1000);
    const sessionExpiresSec = Math.floor(sessionExpiresAt.getTime() / 1000);

    await sql`UPDATE licenses SET session_token = ${sessionToken}, session_expires_at = ${sessionExpiresAt.toISOString()} WHERE id = ${record.id}`;

    const licenseIdHex = crypto.createHash('md5').update(record.license_key).digest('hex').toUpperCase();

    // Ambil data file library (.so/.bin) dari database untuk memicu auto-download di APK
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
        version: "2.0.15",
        sha256: libInfo.sha256,
        size: Number(libInfo.size),
        url: libraryUrl
      }
    };

    // Encode JSON menggunakan URL-Safe Base64 (cocok dengan flag 0xb / android.util.Base64.URL_SAFE)
    const base64Data = toUrlSafeBase64(Buffer.from(JSON.stringify(licenseData), 'utf-8'));
    
    let signature = "MIIB";
    try {
      const sign = crypto.createSign('SHA256');
      sign.update(base64Data);
      sign.end();
      signature = toUrlSafeBase64(sign.sign(PRIVATE_KEY));
    } catch (e) {}

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Connection', 'close');
    return res.status(200).json({ ok: true, data: base64Data, signature: signature });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Server Error: " + err.message });
  }
}

app.get('/', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html><html><body style="background:#0f172a;color:#fff;font-family:monospace;padding:20px;"><h2>Shadow License Server Active</h2></body></html>`);
});

app.post('/api/v1/license.php', handleLicenseActivation);
app.post('/v1/license.php', handleLicenseActivation);

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
