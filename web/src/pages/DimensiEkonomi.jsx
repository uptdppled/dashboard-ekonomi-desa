import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import { cleanParams } from '../utils';

export default function DimensiEkonomi() {
  const [filter, setFilter] = useState({});
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ field: 'skor_ekonomi', dir: 'desc' });

  useEffect(() => {
    setRows(null);
    api.desaList(cleanParams(filter)).then(setRows).catch((e) => setError(e.message));
  }, [filter]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.field] ?? -Infinity;
      const bv = b[sort.field] ?? -Infinity;
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(field) {
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }));
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dimensi Ekonomi</h1>
        <p className="page-desc">Skor Dimensi Ekonomi (Produksi Desa + Fasilitas Pendukung Ekonomi) per desa.</p>
      </div>
      <FilterBar value={filter} onChange={setFilter} showSearch />

      {error && <div className="state-msg state-error">{error}</div>}
      {!rows && !error && <div className="state-msg">Memuat data...</div>}

      {rows && (
        <div className="panel">
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>{sorted.length} desa</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Desa</th>
                  <th>Kabupaten</th>
                  <th>Kecamatan</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('skor_ekonomi')}>
                    Skor Ekonomi {sort.field === 'skor_ekonomi' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('jumlah_sektor_potensi')}>
                    Jumlah Sektor Potensi {sort.field === 'jumlah_sektor_potensi' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 300).map((d) => (
                  <tr key={d.kode_desa}>
                    <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                    <td>{d.kabupaten}</td>
                    <td>{d.kecamatan}</td>
                    <td>{d.skor_ekonomi ?? '-'}</td>
                    <td>{d.jumlah_sektor_potensi}</td>
                    <td><StatusBadge status={d.status_desa} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > 300 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Menampilkan 300 dari {sorted.length} desa. Persempit dengan filter untuk melihat lebih spesifik.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
