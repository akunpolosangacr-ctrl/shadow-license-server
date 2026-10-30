const https = require('https');
const fs = require('fs');

const payload = JSON.stringify({
  license_key: "SHADOW-GVDY-YCT4-G9AP-4CJS",
  device_id: "termux_test_device_id_12345"
});

const req = https.request({
  hostname: 'shadowsystems.shop',
  path: '/api/license',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': payload.length
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log("==========================================");
    console.log("RESPONS MENTAH DARI SERVER ASLI:");
    console.log("==========================================");
    console.log(body);
    
    try {
      const json = JSON.parse(body);
      if (json.ok && json.data) {
        // Decode base64 URL-safe
        let base64Normalized = json.data.replace(/-/g, '+').replace(/_/g, '/');
        while (base64Normalized.length % 4) base64Normalized += '=';
        const decodedJson = JSON.parse(Buffer.from(base64Normalized, 'base64').toString('utf8'));
        
        console.log("\n==========================================");
        console.log("JSON SETELAH DI-DECODE (Struktur Asli):");
        console.log("==========================================");
        console.log(JSON.stringify(decodedJson, null, 2));

        const libUrl = decodedJson.library && decodedJson.library.url;
        if (libUrl) {
          console.log("\n==========================================");
          console.log("MENDOWNLOAD LIBRARY DARI URL ASLI:");
          console.log(libUrl);
          console.log("==========================================");
          
          https.get(libUrl, (libRes) => {
            const fileStream = fs.createWriteStream('libgm.so');
            libRes.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close();
              console.log("✅ SUKSES! File libgm.so original berhasil didownload ke folder project!");
            });
          }).on('error', (err) => {
            console.error("❌ Gagal download library:", err.message);
          });
        }
      } else {
        console.log("❌ Key gagal atau ditolak oleh server asli:", json.message);
      }
    } catch(e) {
      console.error("❌ Gagal parse JSON:", e.message);
    }
  });
});

req.on('error', (e) => {
  console.error("❌ Koneksi error:", e.message);
});

req.write(payload);
req.end();
