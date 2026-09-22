import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const ERROR_MESSAGES = {
  belum_terdaftar: 'Email Google Anda belum terdaftar. Masukkan kode registrasi terlebih dahulu untuk mendaftar.',
  kode_invalid: 'Kode registrasi tidak ditemukan. Periksa kembali kode yang diberikan admin.',
  kode_terpakai: 'Kode registrasi ini sudah pernah dipakai untuk mendaftar.',
  google_gagal: 'Login Google gagal atau dibatalkan. Coba lagi.',
  server: 'Terjadi kesalahan di server saat login. Coba lagi sebentar.',
};

export default function Login() {
  const [params] = useSearchParams();
  const [kode, setKode] = useState('');
  const [mode, setMode] = useState('masuk'); // 'masuk' | 'daftar'
  const error = params.get('error');

  function startGoogle(withKode) {
    const url = withKode ? `/api/auth/google/start?kode=${encodeURIComponent(kode.trim())}` : '/api/auth/google/start';
    window.location.href = url;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: 16,
      }}
    >
      <div className="panel" style={{ maxWidth: 420, width: '100%', marginBottom: 0 }}>
        <h1 className="page-title" style={{ marginBottom: 2 }}>Dashboard Ekonomi Desa</h1>
        <p className="page-desc" style={{ marginBottom: 20 }}>Kalimantan Selatan</p>

        {error && (
          <div className="state-msg state-error" style={{ textAlign: 'left', padding: '10px 0 16px' }}>
            {ERROR_MESSAGES[error] || 'Terjadi kesalahan saat login.'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: 'var(--panel-2)', borderRadius: 999, padding: 3 }}>
          <button
            onClick={() => setMode('masuk')}
            style={{
              flex: 1, border: 'none', borderRadius: 999, padding: '8px 0', fontSize: 13, cursor: 'pointer',
              background: mode === 'masuk' ? 'var(--panel)' : 'transparent',
              fontWeight: mode === 'masuk' ? 700 : 400,
              boxShadow: mode === 'masuk' ? 'var(--shadow-sm)' : 'none',
              color: 'var(--text)',
            }}
          >
            Sudah Punya Akun
          </button>
          <button
            onClick={() => setMode('daftar')}
            style={{
              flex: 1, border: 'none', borderRadius: 999, padding: '8px 0', fontSize: 13, cursor: 'pointer',
              background: mode === 'daftar' ? 'var(--panel)' : 'transparent',
              fontWeight: mode === 'daftar' ? 700 : 400,
              boxShadow: mode === 'daftar' ? 'var(--shadow-sm)' : 'none',
              color: 'var(--text)',
            }}
          >
            Daftar Baru
          </button>
        </div>

        {mode === 'masuk' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Masuk dengan akun Google yang sudah terdaftar.
            </p>
            <button className="btn" style={{ width: '100%' }} onClick={() => startGoogle(false)}>
              Masuk dengan Google
            </button>
          </div>
        )}

        {mode === 'daftar' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              Masukkan kode registrasi yang diberikan admin DPMD, lalu lanjutkan dengan akun Google Anda.
            </p>
            <input
              type="text"
              placeholder="Kode registrasi (mis. K7QM-3RXP)"
              value={kode}
              onChange={(e) => setKode(e.target.value)}
              style={{
                width: '100%', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '9px 12px',
                fontSize: 13, background: 'var(--panel)', color: 'var(--text)', marginBottom: 12, boxSizing: 'border-box',
              }}
            />
            <button className="btn" style={{ width: '100%' }} disabled={!kode.trim()} onClick={() => startGoogle(true)}>
              Lanjut dengan Google
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
