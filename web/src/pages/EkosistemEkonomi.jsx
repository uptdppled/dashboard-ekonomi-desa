import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import { useTheme } from '../theme';
import { ACCENT_SECONDARY } from '../colors';

export default function EkosistemEkonomi() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [selectedKomponen, setSelectedKomponen] = useState(null);
  const [desaList, setDesaList] = useState(null);
  const [desaError, setDesaError] = useState(null);
  const { resolved } = useTheme();

  useEffect(() => {
    api.ekosistemSummary().then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedKomponen) return;
    setDesaList(null);
    setDesaError(null);
    api.ekosistemDesa(selectedKomponen).then(setDesaList).catch((e) => setDesaError(e.message));
  }, [selectedKomponen]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Ekosistem Ekonomi Pendukung</h1>
        <p className="page-desc">
          Sebaran BUM Desa, Koperasi Desa Merah Putih (KDMP), dan komponen ekosistem ekonomi lain per desa.
        </p>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}
      {!rows && !error && <div className="state-msg">Memuat data...</div>}

      {rows && (
        <div className="panel">
          <h2 className="panel-title">Jumlah Desa per Komponen (30 teratas)</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>Klik bar untuk melihat daftar desanya.</p>
          <ResponsiveContainer width="100%" height={Math.max(300, rows.length * 40)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 20, top: 10, bottom: 10 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="komponen" width={340} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip />
              <Bar
                dataKey="jumlah_desa"
                fill={ACCENT_SECONDARY[resolved]}
                barSize={22}
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(d) => setSelectedKomponen((prev) => (prev === d.komponen ? null : d.komponen))}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {selectedKomponen && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="panel-title" style={{ marginBottom: 0 }}>Desa dengan "{selectedKomponen}"</h2>
            <button className="btn btn-secondary" onClick={() => setSelectedKomponen(null)}>Tutup</button>
          </div>
          {desaError && <div className="state-msg state-error">{desaError}</div>}
          {!desaList && !desaError && <p className="state-msg">Memuat...</p>}
          {desaList && desaList.length === 0 && <p className="state-msg">Tidak ada desa pada filter ini.</p>}
          {desaList && desaList.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>No.</th><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Nilai</th><th>Status</th></tr></thead>
                <tbody>
                  {desaList.slice(0, 200).map((d, i) => (
                    <tr key={d.kode_desa}>
                      <td>{i + 1}</td>
                      <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                      <td>{d.kabupaten}</td>
                      <td>{d.kecamatan}</td>
                      <td>{d.nilai}</td>
                      <td><StatusBadge status={d.status_desa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {desaList.length > 200 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Menampilkan 200 dari {desaList.length} desa.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
