import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function PotensiDesa() {
  const [sektor, setSektor] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.potensiSektor().then(setSektor).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Potensi Ekonomi Desa</h1>
        <p className="page-desc">Sebaran potensi sektor ekonomi berdasarkan hasil pendataan Rekap Isu.</p>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}
      {!sektor && !error && <div className="state-msg">Memuat data...</div>}

      {sektor && (
        <div className="sector-grid">
          {sektor.map((s) => (
            <button key={s.sektor} className="sector-card" onClick={() => navigate(`/potensi-desa/${encodeURIComponent(s.sektor)}`)}>
              <div className="n">{s.jumlah_desa.toLocaleString('id-ID')}</div>
              <div className="label">{s.sektor}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
