import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import RekomendasiAI from '../components/RekomendasiAI';
import { cleanParams } from '../utils';

export default function ProfilDesa() {
  const [params, setParams] = useSearchParams();
  const kode = params.get('kode');
  const [filter, setFilter] = useState({});
  const [list, setList] = useState(null);
  const [profil, setProfil] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (kode) return;
    api.desaList(cleanParams({ ...filter, q: filter.q })).then(setList).catch((e) => setError(e.message));
  }, [filter, kode]);

  useEffect(() => {
    if (!kode) { setProfil(null); return; }
    setProfil(null);
    api.desaProfil(kode).then(setProfil).catch((e) => setError(e.message));
  }, [kode]);

  if (kode) {
    return (
      <div>
        <div className="page-header">
          <button className="link-button" onClick={() => setParams({})}>&larr; Kembali ke pencarian</button>
        </div>
        {error && <div className="state-msg state-error">{error}</div>}
        {!profil && !error && <div className="state-msg">Memuat profil desa...</div>}
        {profil && <ProfilDetail profil={profil} />}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Profil Desa</h1>
        <p className="page-desc">Cari desa untuk melihat skor ekonomi, potensi, dan ekosistem pendukungnya secara lengkap.</p>
      </div>
      <FilterBar value={filter} onChange={setFilter} showSearch />

      {error && <div className="state-msg state-error">{error}</div>}
      {!list && !error && <div className="state-msg">Memuat data...</div>}

      {list && (
        <div className="panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Status</th></tr></thead>
              <tbody>
                {list.slice(0, 200).map((d) => (
                  <tr key={d.kode_desa} style={{ cursor: 'pointer' }} onClick={() => setParams({ kode: d.kode_desa })}>
                    <td>{d.nama_desa}</td>
                    <td>{d.kabupaten}</td>
                    <td>{d.kecamatan}</td>
                    <td><StatusBadge status={d.status_desa} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 200 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Menampilkan 200 dari {list.length} desa - persempit dengan pencarian.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value, max }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="score-bar-row">
      <div className="score-bar-label-row">
        <span className="score-bar-label">{label}</span>
        <span className="score-bar-val">{value}{max ? ` / ${max}` : ''}</span>
      </div>
      <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// Permendesa 9/2024's own dimension order, not the DB's insertion order.
const DIMENSI_ORDER = ['LAYANAN DASAR', 'SOSIAL', 'EKONOMI', 'LINGKUNGAN', 'AKSESIBILITAS', 'TATA KELOLA PEMERINTAHAN DESA'];

function ProfilDetail({ profil }) {
  const { desa, skor, potensi, ekosistem, indeksDimensi = [] } = profil;
  const indeksByDimensi = new Map(indeksDimensi.map((d) => [d.dimensi, d]));
  const indeksSorted = DIMENSI_ORDER.filter((d) => indeksByDimensi.has(d)).map((d) => indeksByDimensi.get(d));
  const topLevel = skor.filter((s) => s.sub_dimensi === '' || s.nama_indikator === s.sub_dimensi);
  const bySub = {};
  for (const s of skor) {
    if (s.nama_indikator === s.sub_dimensi || s.sub_dimensi === '') continue;
    if (!/^SKOR /i.test(s.nama_indikator)) continue;
    (bySub[s.sub_dimensi] ||= []).push(s);
  }
  const sektorGroups = {};
  for (const p of potensi) (sektorGroups[p.sektor] ||= []).push(p);

  return (
    <div>
      <div className="profile-header panel">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>{desa.nama_desa}</h1>
          <p className="page-desc">{desa.kecamatan}, {desa.kabupaten} &middot; {desa.provinsi}</p>
        </div>
        <StatusBadge status={desa.status_desa} />
      </div>

      <RekomendasiAI kode={desa.kode_desa} />

      {indeksSorted.length > 0 && (
        <div className="panel">
          <h2 className="panel-title">Indeks Desa (6 Dimensi)</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
            Skor komposit per dimensi Permendesa 9/2024. Rincian indikator per dimensi selain Ekonomi belum ditampilkan di sini.
          </p>
          {indeksSorted.map((d) => (
            <ScoreBar key={d.dimensi} label={d.dimensi} value={d.skor} max={d.bobot_maks} />
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h2 className="panel-title">Skor Dimensi Ekonomi</h2>
          {topLevel.map((s) => (
            <ScoreBar key={s.nama_indikator} label={s.nama_indikator.replace('SUB-DIMENSI ', '')} value={s.skor} max={s.bobot_maks} />
          ))}
          {Object.entries(bySub).map(([sub, items]) => (
            <div key={sub} style={{ marginTop: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {sub.replace('SUB-DIMENSI ', '')}
              </p>
              {items.map((s) => (
                <ScoreBar key={s.nama_indikator} label={s.nama_indikator.replace('SKOR ', '')} value={s.skor} max={s.bobot_maks} />
              ))}
            </div>
          ))}
        </div>

        <div className="panel">
          <h2 className="panel-title">Potensi Ekonomi</h2>
          {Object.keys(sektorGroups).length === 0 && <p className="state-msg">Belum ada potensi tercatat.</p>}
          {Object.entries(sektorGroups).map(([sektor, items]) => (
            <div key={sektor} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>{sektor}</p>
              <div className="tag-list">
                {items.map((p) => (
                  <span className="tag" key={p.subsektor} title={p.nilai}>{p.subsektor.replace(/^Terdapat /i, '')}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Ekosistem Ekonomi Pendukung</h2>
        {ekosistem.length === 0 && <p className="state-msg">Tidak ada data ekosistem pendukung.</p>}
        {ekosistem.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Komponen</th><th>Nilai</th></tr></thead>
              <tbody>
                {ekosistem.map((e) => (
                  <tr key={e.komponen}><td>{e.komponen}</td><td>{e.nilai}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
