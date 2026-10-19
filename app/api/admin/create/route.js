import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request) {
  try {
    const { license_key, days_valid } = await request.json();
    
    if (!license_key) {
      return NextResponse.json({ ok: false, message: "Key tidak boleh kosong!" }, { status: 400 });
    }

    await sql`
      INSERT INTO licenses (license_key, days_valid, is_active)
      VALUES (${license_key}, ${days_valid || 30}, TRUE)
      ON CONFLICT (license_key) DO UPDATE SET days_valid = ${days_valid || 30}, is_active = TRUE
    `;

    return NextResponse.json({ ok: true, message: "Key berhasil dibuat!" });
  } catch (error) {
    console.error("Error creating license:", error);
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
}
