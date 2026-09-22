import { useState } from 'react';
import { api } from '../api';

const KATEGORI_LABEL = {
  pembinaan_bumdes: 'Pembinaan BUM Desa',
  infrastruktur: 'Infrastruktur',
  sdm: 'SDM',
  pemasaran: 'Pemasaran',
  kebijakan_anggaran: 'Kebijakan & Anggaran',
};

export default function RekomendasiKabupatenAI({ kabupaten }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  async function generate(forceRefresh) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.rekomendasiKabupaten(kabupaten, forceRefresh);
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
          <h2 className="panel-title" style={{ marginBottom: 2 }}>Analisis Kondisi BUM Desa & Rekomendasi (AI)</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
            Analisis kondisi BUM Desa se-kabupaten dan rekomendasi kebijakan/program tingkat kabupaten.
          </p>
        </div>
        {!loading && (
          <button className="btn" onClick={() => generate(!!data)}>
            {data ? 'Buat Ulang' : 'Buat Analisis'}
          </button>
        )}
      </div>

      {loading && <p className="state-msg">AI sedang menganalisis kondisi kabupaten ini...</p>}

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
          {data.ringkasan && <p style={{ fontSize: 13.5, marginBottom: 12 }}>{data.ringkasan}</p>}

          {data.kondisi_bumdes && (
            <div style={{ background: 'var(--panel-2)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 6px' }}>
                Kondisi BUM Desa
              </p>
              <p style={{ fontSize: 13, margin: 0 }}>{data.kondisi_bumdes}</p>
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            {(data.rekomendasi || []).map((r, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{r.judul}</strong>
                  <span className="badge" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
                    {KATEGORI_LABEL[r.kategori] || r.kategori}
                  </span>
                </div>
                <p style={{ fontSize: 13, margin: '8px 0 6px' }}>{r.alasan}</p>
                {r.target && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
                    <strong>Sasaran:</strong> {r.target}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
