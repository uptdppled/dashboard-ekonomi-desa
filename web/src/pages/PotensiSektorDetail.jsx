import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import { cleanParams } from '../utils';

export default function PotensiSektorDetail() {
  const { sektor } = useParams();
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.potensiSektorDetail(sektor, cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [sektor, filter]);

  return (
    <div>
      <div className="page-header">
        <p style={{ marginBottom: 4 }}><Link to="/potensi-desa">&larr; Potensi Desa</Link></p>
        <h1 className="page-title">Potensi {sektor}</h1>
        <p className="page-desc">{data ? `${data.jumlahDesa.toLocaleString('id-ID')} desa memiliki potensi ini.` : ' '}</p>
      </div>
      <FilterBar value={filter} onChange={setFilter} />

      {error && <div className="state-msg state-error">{error}</div>}
      {!data && !error && <div className="state-msg">Memuat data...</div>}

      {data && (
        <div className="grid-2">
          <div className="panel">
            <h2 className="panel-title">Desa dengan Potensi {sektor}</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.desa.slice(0, 200).map((d) => (
                    <tr key={d.kode_desa}>
                      <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                      <td>{d.kabupaten}</td>
                      <td>{d.kecamatan}</td>
                      <td><StatusBadge status={d.status_desa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.desa.length > 200 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Menampilkan 200 dari {data.desa.length} desa.</p>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Rincian Subsektor</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Subsektor / Indikator</th><th>Jumlah Desa</th></tr></thead>
                <tbody>
                  {data.subsektor.map((s) => (
                    <tr key={s.subsektor}>
                      <td>{s.subsektor}</td>
                      <td>{s.jumlah_desa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
