import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request) {
  try {
    const { license_key, days_valid } = await request.json();
    
    if (!license_key) {
      return NextResponse.json({ ok: false, message: "Key wajib diisi!" }, { status: 400 });
    }

    const days = parseInt(days_valid) || 30;

    // Otomatis buat tabel licenses jika belum ada di database Neon
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

    return NextResponse.json({ ok: true, message: "Key berhasil tersimpan ke database Neon!" });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
}
