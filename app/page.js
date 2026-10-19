'use client';

import { useState, useEffect } from 'react';

export default function AdminPage() {
  const [key, setKey] = useState('');
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setApiBaseUrl(window.location.origin);
    }
  }, []);

  const generateRandomKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'RIO-';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setKey(result);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const res = await fetch('/api/admin/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: key, days_valid: parseInt(days) })
      });
      const data = await res.json();
      if (data.ok) {
        setMessage('✅ Sukses! Key tersimpan di database Neon.');
        setKey('');
      } else {
        setMessage('❌ Gagal: ' + (data.message || 'Error saat menyimpan'));
      }
    } catch (err) {
      setMessage('❌ Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: '600px', margin: '40px auto', fontFamily: 'sans-serif', padding: '25px', background: '#121212', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
      <h2 style={{ color: '#00ffcc', textAlign: 'center', marginTop: 0 }}>Shadow License Admin</h2>
      <p style={{ fontSize: '13px', color: '#aaa', textAlign: 'center' }}>
        Endpoint URL APK: <br/>
        <code style={{ color: '#00ffcc' }}>{apiBaseUrl ? `${apiBaseUrl}/api/license` : 'Loading...'}</code>
      </p>
      
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Custom License Key:</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              value={key} 
              onChange={(e) => setKey(e.target.value)} 
              placeholder="Contoh: VIP123 / RIO-KEY99" 
              required
              style={{ flex: 1, padding: '12px', background: '#1e1e1e', border: '1px solid #333', color: '#fff', borderRadius: '6px' }}
            />
            <button type="button" onClick={generateRandomKey} style={{ padding: '12px 18px', background: '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Random</button>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Masa Aktif (Hari / Days):</label>
          <input 
            type="number" 
            value={days} 
            onChange={(e) => setDays(e.target.value)} 
            required
            style={{ width: '100%', padding: '12px', background: '#1e1e1e', border: '1px solid #333', color: '#fff', borderRadius: '6px', boxSizing: 'border-box' }}
          />
        </div>

        <button type="submit" disabled={loading} style={{ padding: '14px', background: '#00ffcc', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer', marginTop: '10px' }}>
          {loading ? 'Menyimpan ke Database Neon...' : 'Simpan Key ke Database Neon'}
        </button>
      </form>

      {message && <div style={{ marginTop: '20px', padding: '12px', background: '#1e1e1e', borderRadius: '6px', textAlign: 'center', fontSize: '14px', border: '1px solid #333' }}>{message}</div>}
    </main>
  );
}
