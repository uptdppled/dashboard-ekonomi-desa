import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';

const DEV_ROLES = [
  { role: 'admin', label: 'Admin' },
  { role: 'provinsi', label: 'Provinsi' },
  { role: 'kabupaten', label: 'Kabupaten (contoh)' },
  { role: 'desa', label: 'Desa (contoh)' },
];

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
  const [devLoginEnabled, setDevLoginEnabled] = useState(false);
  const [devBusy, setDevBusy] = useState(null);
  const error = params.get('error');

  useEffect(() => {
    api.devConfig().then((c) => setDevLoginEnabled(c.devLoginEnabled)).catch(() => {});
  }, []);

  function startGoogle(withKode) {
    const url = withKode ? `/api/auth/google/start?kode=${encodeURIComponent(kode.trim())}` : '/api/auth/google/start';
    window.location.href = url;
  }

  async function devLogin(role) {
    setDevBusy(role);
    try {
      await api.devLogin(role);
      window.location.href = '/';
    } catch (e) {
      setDevBusy(null);
      alert(e.message);
    }
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
        <h1 className="page-title" style={{ marginBottom: 2 }}>Banua360</h1>
        <p className="page-desc" style={{ marginBottom: 20 }}>Dashboard Ekonomi Desa Kalimantan Selatan</p>

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

        {devLoginEnabled && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed var(--border-strong)' }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--warning)', marginBottom: 8 }}>
              MODE UJI COBA (Google belum dikonfigurasi)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {DEV_ROLES.map(({ role, label }) => (
                <button
                  key={role}
                  className="btn btn-secondary"
                  disabled={!!devBusy}
                  onClick={() => devLogin(role)}
                  style={{ fontSize: 12.5 }}
                >
                  {devBusy === role ? '...' : label}
                </button>
              ))}
            </div>
          </div>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 24, marginBottom: 0, textAlign: 'center' }}>
          Dibangun oleh Dory Amanda Sari, S.Kom., M.M.
        </p>
      </div>
    </div>
  );
}
