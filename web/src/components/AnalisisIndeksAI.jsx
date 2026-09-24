import { useEffect, useState } from 'react';
import { api } from '../api';

const DIMENSI_LABEL = {
  'LAYANAN DASAR': 'Layanan Dasar',
  SOSIAL: 'Sosial',
  EKONOMI: 'Ekonomi',
  LINGKUNGAN: 'Lingkungan',
  AKSESIBILITAS: 'Aksesibilitas',
  'TATA KELOLA PEMERINTAHAN DESA': 'Tata Kelola',
};

// Shared by BANUA INDEX's Ringkasan page (scope = filter only, all 6
// dimensi) and each per-dimensi submenu page (scope also carries `dimensi`,
// narrower/deeper analysis for just that one). On-demand per klik, not
// auto-fetched - same convention as Rekomendasi Produk Unggulan / Analisis
// BUMDes (see CLAUDE.md).
export default function AnalisisIndeksAI({ scope, title = 'Analisis & Rekomendasi (AI)', desc }) {
  const [narasi, setNarasi] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    setNarasi(null);
    setError(null);
    setErrorCode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  async function generate(forceRefresh) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.indeksNarasi(scope, forceRefresh);
      setNarasi(res);
    } catch (e) {
      setError(e.message);
      setErrorCode(e.code);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="panel-title" style={{ marginBottom: 2 }}>{title}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
            {desc || 'Analisis kondisi di atas dan rekomendasi kegiatan untuk meningkatkan skor yang masih lemah.'}
          </p>
        </div>
        {!loading && (
          <button className="btn" onClick={() => generate(!!narasi)}>
            {narasi ? 'Buat Ulang' : 'Buat Analisis'}
          </button>
        )}
      </div>

      {loading && <p className="state-msg">AI sedang menganalisis data...</p>}

      {error && !loading && (
        <div className="state-msg state-error" style={{ textAlign: 'left', padding: '14px 0' }}>
          {errorCode === 'NO_API_KEY'
            ? 'Fitur ini belum aktif: admin perlu mengisi GROQ_API_KEY atau GEMINI_API_KEY (gratis) di server/.env (lihat server/.env.example), lalu restart server.'
            : error}
        </div>
      )}

      {narasi && !loading && (
        <div style={{ marginTop: 14 }}>
          {narasi.cached && (
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
              Hasil tersimpan dari {new Date(narasi.dibuatPada).toLocaleString('id-ID')} - klik "Buat Ulang" untuk analisis baru.
            </p>
          )}
          <p style={{ fontSize: 13.5, marginBottom: 16 }}>{narasi.analisis}</p>

          <div style={{ display: 'grid', gap: 10 }}>
            {(narasi.rekomendasi || []).map((r, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                <span className="badge" style={{ background: 'var(--panel-2)', color: 'var(--text-muted)', marginBottom: 6, display: 'inline-block' }}>
                  {DIMENSI_LABEL[r.dimensi] || r.dimensi}
                </span>
                <p style={{ fontSize: 13.5, fontWeight: 600, margin: '4px 0 6px' }}>{r.aktivitas}</p>
                {r.alasan && <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>{r.alasan}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
