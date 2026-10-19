import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request) {
  try {
    const body = await request.json();
    const { license_key, device_id } = body;

    if (!license_key) {
      return NextResponse.json({ ok: false, message: "License key wajib diisi!" }, { status: 400 });
    }

    const result = await sql`
      SELECT * FROM licenses WHERE license_key = ${license_key} AND is_active = TRUE
    `;

    if (result.length === 0) {
      return NextResponse.json({ ok: false, message: "Key tidak valid atau sudah tidak aktif!" });
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
        url: "https://shadowcheat.com/api/v1/library.php?version=2.0.42"
      },
      min_app_version: "2.0.8"
    };

    const jsonStr = JSON.stringify(licenseData);
    const base64Data = Buffer.from(jsonStr).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    return NextResponse.json({
      ok: true,
      data: base64Data,
      signature: "dummy_signature_terserah"
    });

  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ ok: false, message: "Server Error" }, { status: 500 });
  }
}
