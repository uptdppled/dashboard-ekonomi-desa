import { useState } from 'react';
import { api } from '../api';

const KESIAPAN_COLOR = {
  Mudah: { bg: 'var(--good-soft)', fg: 'var(--good)' },
  Sedang: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  'Perlu Investasi': { bg: 'var(--critical-soft)', fg: 'var(--critical)' },
};

const BERBASIS_LABEL = {
  potensi: 'Berbasis Potensi',
  masalah: 'Berbasis Masalah',
  keduanya: 'Potensi & Masalah',
};

export default function RekomendasiAI({ kode }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  async function generate(forceRefresh) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.rekomendasi(kode, forceRefresh);
      setData(res);
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
          <h2 className="panel-title" style={{ marginBottom: 2 }}>Rekomendasi Produk Unggulan (AI)</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
            Saran lini usaha BUM Desa berdasarkan potensi ekonomi dan kekurangan fasilitas desa ini.
          </p>
        </div>
        {!loading && (
          <button className="btn" onClick={() => generate(!!data)}>
            {data ? 'Buat Ulang' : 'Buat Rekomendasi'}
          </button>
        )}
      </div>

      {loading && <p className="state-msg">AI sedang menganalisis data desa ini...</p>}

      {error && !loading && (
        <div className="state-msg state-error" style={{ textAlign: 'left', padding: '14px 0' }}>
          {errorCode === 'NO_API_KEY'
            ? 'Fitur ini belum aktif: admin perlu mengisi GROQ_API_KEY atau GEMINI_API_KEY (gratis) di server/.env (lihat server/.env.example), lalu restart server.'
            : error}
        </div>
      )}

      {data && !loading && (
        <div style={{ marginTop: 14 }}>
          {data.cached && (
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -8 }}>
              Hasil tersimpan dari {new Date(data.dibuatPada).toLocaleString('id-ID')} - klik "Buat Ulang" untuk analisis baru.
            </p>
          )}
          {data.ringkasan && <p style={{ fontSize: 13.5, marginBottom: 16 }}>{data.ringkasan}</p>}

          <div style={{ display: 'grid', gap: 12 }}>
            {(data.rekomendasi || []).map((r, i) => {
              const kesiapan = KESIAPAN_COLOR[r.kesiapan] || KESIAPAN_COLOR.Sedang;
              return (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{r.nama}</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="badge" style={{ background: 'var(--panel-2)', color: 'var(--text-muted)' }}>
                        {BERBASIS_LABEL[r.berbasis] || r.berbasis}
                      </span>
                      <span className="badge" style={{ background: kesiapan.bg, color: kesiapan.fg }}>{r.kesiapan}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, margin: '8px 0 6px' }}>{r.alasan}</p>
                  {r.langkah_awal && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
                      <strong>Langkah awal:</strong> {r.langkah_awal}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
