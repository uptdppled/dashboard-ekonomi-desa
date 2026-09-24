import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import RekomendasiAI from '../components/RekomendasiAI';
import { cleanParams } from '../utils';
import { useDefinisiSkor, formatTooltip } from '../definisi';

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

// Same threshold/coloring language as BANUA INDEX's dimension pages and
// BANUA INSIGHT's Gap Analysis, so a red bar means the same thing everywhere.
function severityColor(ratio) {
  if (ratio === null) return 'var(--accent)';
  if (ratio < 0.6) return 'var(--critical)';
  if (ratio < 0.8) return 'var(--warning)';
  return 'var(--good)';
}

// Matches BANUA INDEX's DimensiDetail card severity exactly, so an
// indicator reads the same wherever it's shown in the app.
function severityCard(ratio) {
  if (ratio === null) return { color: 'var(--text-faint)', bg: 'var(--panel-2)', label: '-' };
  if (ratio < 0.6) return { color: 'var(--critical)', bg: 'var(--critical-soft)', label: 'Gap' };
  if (ratio < 0.8) return { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Sedang' };
  return { color: 'var(--good)', bg: 'var(--good-soft)', label: 'Baik' };
}

function ScoreBar({ label, value, max }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const ratio = max ? value / max : null;
  const color = severityColor(ratio);
  return (
    <div className="score-bar-row">
      <div className="score-bar-label-row">
        <span className="score-bar-label">{label}</span>
        <span className="score-bar-val" style={{ color }}>{value}{max ? ` / ${max}` : ''}</span>
      </div>
      <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

// Permendesa 9/2024's own dimension order, not the DB's insertion order.
const DIMENSI_ORDER = ['LAYANAN DASAR', 'SOSIAL', 'EKONOMI', 'LINGKUNGAN', 'AKSESIBILITAS', 'TATA KELOLA PEMERINTAHAN DESA'];

const DIMENSI_LABEL = {
  'LAYANAN DASAR': 'Layanan Dasar',
  SOSIAL: 'Sosial',
  EKONOMI: 'Ekonomi',
  LINGKUNGAN: 'Lingkungan',
  AKSESIBILITAS: 'Aksesibilitas',
  'TATA KELOLA PEMERINTAHAN DESA': 'Tata Kelola',
};

function ProfilDetail({ profil }) {
  const { desa, ekosistem, indeksDimensi = [] } = profil;
  const definisiSkor = useDefinisiSkor();
  const indeksByDimensi = new Map(indeksDimensi.map((d) => [d.dimensi, d]));
  const indeksSorted = DIMENSI_ORDER.filter((d) => indeksByDimensi.has(d)).map((d) => indeksByDimensi.get(d));
  const [selectedDimensi, setSelectedDimensi] = useState(null);
  const [dimensiDetail, setDimensiDetail] = useState(null);
  const [dimensiError, setDimensiError] = useState(null);
  const [narasi, setNarasi] = useState(null);
  const [narasiLoading, setNarasiLoading] = useState(true);
  const [narasiError, setNarasiError] = useState(null);
  const [narasiErrorCode, setNarasiErrorCode] = useState(null);

  useEffect(() => {
    if (!selectedDimensi) { setDimensiDetail(null); return; }
    setDimensiDetail(null);
    setDimensiError(null);
    api.indeksDimensi(selectedDimensi, { kode_desa: desa.kode_desa }).then(setDimensiDetail).catch((e) => setDimensiError(e.message));
  }, [selectedDimensi, desa.kode_desa]);

  // Auto-refreshes with the same dimension selection the "Rincian" panel
  // above reacts to - a short AI-written summary of exactly what's shown
  // there (or the whole-village picture when nothing is selected), not a
  // separate thing to click for.
  useEffect(() => {
    let cancelled = false;
    setNarasi(null);
    setNarasiLoading(true);
    setNarasiError(null);
    setNarasiErrorCode(null);
    api
      .narasiDesa(desa.kode_desa, selectedDimensi)
      .then((res) => { if (!cancelled) setNarasi(res); })
      .catch((e) => {
        if (cancelled) return;
        setNarasiError(e.message);
        setNarasiErrorCode(e.code);
      })
      .finally(() => { if (!cancelled) setNarasiLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDimensi, desa.kode_desa]);

  const bySub = useMemo(() => {
    if (!dimensiDetail) return {};
    const out = {};
    for (const r of dimensiDetail.indikatorRows) (out[r.subDimensi] ||= []).push(r);
    return out;
  }, [dimensiDetail]);

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
            Klik salah satu dimensi untuk melihat rincian sampai ke tingkat indikator (klik lagi untuk kembali ke ringkasan menyeluruh).
          </p>
          {indeksSorted.map((d) => {
            const active = d.dimensi === selectedDimensi;
            const ratio = d.bobot_maks ? d.skor / d.bobot_maks : null;
            const color = severityColor(ratio);
            const pct = d.bobot_maks ? Math.min(100, (d.skor / d.bobot_maks) * 100) : 0;
            return (
              <button
                key={d.dimensi}
                onClick={() => setSelectedDimensi(active ? null : d.dimensi)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: active ? 'var(--panel-2)' : 'transparent',
                  border: active ? '1px solid var(--border-strong)' : '1px solid transparent', borderRadius: 8,
                  padding: '8px 10px', margin: '0 -10px 4px', cursor: 'pointer',
                }}
              >
                <div className="score-bar-label-row">
                  <span className="score-bar-label" style={{ fontWeight: active ? 700 : 400, color: active ? 'var(--text)' : undefined }}>
                    {DIMENSI_LABEL[d.dimensi] || d.dimensi}{active ? ' ▾' : ''}
                  </span>
                  <span className="score-bar-val" style={{ color }}>{d.skor} / {d.bobot_maks}</span>
                </div>
                <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
              </button>
            );
          })}
        </div>
      )}

      <div className="panel">
        <h2 className="panel-title" style={{ marginBottom: 6 }}>
          {selectedDimensi ? `Analisis & Rekomendasi · ${DIMENSI_LABEL[selectedDimensi] || selectedDimensi}` : 'Analisis & Rekomendasi · Desa Secara Menyeluruh'}
        </h2>
        {narasiLoading && <p className="state-msg">AI sedang menganalisis data...</p>}
        {narasiError && !narasiLoading && (
          <div className="state-msg state-error" style={{ textAlign: 'left', padding: '10px 0' }}>
            {narasiErrorCode === 'NO_API_KEY'
              ? 'Fitur ini belum aktif: admin perlu mengisi GROQ_API_KEY atau GEMINI_API_KEY (gratis) di server/.env (lihat server/.env.example), lalu restart server.'
              : narasiError}
          </div>
        )}
        {narasi && !narasiLoading && (
          <div>
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

      {selectedDimensi && (
      <div className="panel">
        <h2 className="panel-title">Rincian {DIMENSI_LABEL[selectedDimensi] || selectedDimensi}</h2>
        {dimensiError && <div className="state-msg state-error">{dimensiError}</div>}
        {!dimensiDetail && !dimensiError && <p className="state-msg">Memuat...</p>}
        {dimensiDetail && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 28px' }}>
            {Object.entries(bySub).map(([sub, items]) => (
              <div key={sub} style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  {sub.replace(/^SUB-DIMENSI /i, '')}
                </p>
                {items.map((it) => {
                  const sev = severityCard(it.ratio);
                  const tooltip = formatTooltip(definisiSkor[it.indikator]);
                  return (
                    <div key={it.indikator} title={tooltip} style={{ marginBottom: 8, paddingLeft: 8, borderLeft: `3px solid ${sev.color}`, cursor: tooltip ? 'help' : undefined }}>
                      <div className="score-bar-label-row">
                        <span className="score-bar-label">{it.indikator.replace(/^SKOR /i, '')}{tooltip ? ' ⓘ' : ''}</span>
                        <span className="score-bar-val" style={{ color: sev.color }}>{it.avgSkor} / {it.avgBobot}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

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
