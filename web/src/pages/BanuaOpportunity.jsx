import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { cleanParams } from '../utils';

const SEKTOR_ICON = {
  Pertanian: '\u{1F33E}',
  Perikanan: '\u{1F41F}',
  Peternakan: '\u{1F404}',
  Perkebunan: '\u{1F334}',
  Pertambangan: '⛏️',
  'Kerajinan/Industri': '\u{1F3ED}',
  'Fasilitas Perdagangan/Keuangan': '\u{1F3EA}',
  'Pemasaran/Ekspor': '\u{1F4E6}',
  Pariwisata: '\u{1F3D6}️',
};

const TABS = [
  { key: 'kawasan', label: 'Potensi Kawasan', fetch: api.opportunityKawasan },
  { key: 'potensi_potensi', label: 'Potensi → Potensi', fetch: api.opportunityPotensiPotensi },
  { key: 'produksi_akses_pasar', label: 'Produksi → Akses Pasar', fetch: api.opportunityProduksiAksesPasar },
  { key: 'desa_desa', label: 'Desa ↔ Desa', fetch: api.opportunityDesaDesa },
  { key: 'bumdesa_potensi', label: 'BUM Desa → Potensi', fetch: api.opportunityBumDesaPotensi },
];

const TAB_DESC = {
  kawasan: 'Kandidat kawasan perdesaan: kelompok desa berbatasan dalam satu kabupaten dengan potensi sektor sejenis (kriteria Pasal 9 Permendesa PDTT 5/2016). Ini pengelompokan internal aplikasi berdasarkan data, bukan penetapan resmi Bupati/Wali Kota.',
  potensi_potensi: 'Peluang keterhubungan rantai nilai hulu → pengolahan: desa dengan potensi produksi berdekatan dengan desa yang punya potensi Kerajinan/Industri.',
  produksi_akses_pasar: 'Peluang menghubungkan produksi dengan fasilitas/akses pasar terdekat. Data yang tersedia hanya keberadaan fasilitas, bukan data pasar/permintaan aktual.',
  desa_desa: 'Eksplorasi umum: seluruh jenis peluang keterhubungan (Potensi→Potensi, Produksi→Akses Pasar, BUM Desa→Potensi) digabung dalam satu daftar.',
  bumdesa_potensi: 'Desa yang BUM Desa-nya sudah punya unit usaha di bidang yang sama dengan potensi sektor yang dimiliki desa itu sendiri.',
};

function Check({ ok, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: ok ? 'var(--text)' : 'var(--text-muted)' }}>
      <span style={{ color: ok ? 'var(--accent)' : 'var(--text-faint)', fontWeight: 700 }}>{ok ? '✓' : '○'}</span>
      {children}
    </div>
  );
}

function cardSearchText(item) {
  if (item.tipe === 'kawasan') {
    return [item.jenisKawasan, item.kabupaten, ...item.desa.map((d) => d.nama_desa)].join(' ').toLowerCase();
  }
  if (item.desaA) {
    return [item.label, item.desaA.nama_desa, item.desaB.nama_desa, ...item.desaA.sektor, ...item.desaB.sektor].join(' ').toLowerCase();
  }
  return [item.label, item.desa.nama_desa, item.sektor, item.bidang, ...(item.potensi || [])].join(' ').toLowerCase();
}

function PairCard({ item }) {
  const icon = SEKTOR_ICON[item.desaA.sektor[0]] || '\u{1F517}';
  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>
        {icon} {item.label} &middot; {item.desaA.sektor.join('/')} &rarr; {item.desaB.sektor.join('/')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Link to={`/profil-desa?kode=${item.desaA.kode_desa}`} style={{ fontWeight: 700, fontSize: 13.5 }}>{item.desaA.nama_desa}</Link>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{item.desaA.kecamatan}, {item.desaA.kabupaten}</div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
          &harr;<br />{item.jarakKm} km
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Link to={`/profil-desa?kode=${item.desaB.kode_desa}`} style={{ fontWeight: 700, fontSize: 13.5 }}>{item.desaB.nama_desa}</Link>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{item.desaB.kecamatan}, {item.desaB.kabupaten}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        {item.checklist.map((c, ci) => <Check key={ci} ok={c.ok}>{c.label}</Check>)}
      </div>
    </div>
  );
}

function BumDesaCard({ item }) {
  const icon = SEKTOR_ICON[item.sektor] || '\u{1F3E2}';
  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>{icon} {item.label}</div>
      <Link to={`/profil-desa?kode=${item.desa.kode_desa}`} style={{ fontWeight: 700, fontSize: 13.5 }}>{item.desa.nama_desa}</Link>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>{item.desa.kecamatan}, {item.desa.kabupaten}</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        {item.checklist.map((c, ci) => <Check key={ci} ok={c.ok}>{c.label}</Check>)}
      </div>
    </div>
  );
}

function KawasanCard({ item }) {
  const icon = SEKTOR_ICON[item.sektorDominan] || '\u{1F5FA}️';
  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>{icon} {item.jenisKawasan}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>{item.kabupaten} &middot; {item.jumlahDesa} desa</div>
      <div className="tag-list" style={{ marginBottom: 10 }}>
        {item.desa.map((d) => (
          <Link key={d.kode_desa} to={`/profil-desa?kode=${d.kode_desa}`} className="tag">{d.nama_desa}</Link>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        {item.checklist.map((c, ci) => <Check key={ci} ok={c.ok}>{c.label}</Check>)}
      </div>
    </div>
  );
}

function Card({ item }) {
  if (item.tipe === 'kawasan') return <KawasanCard item={item} />;
  if (item.tipe === 'bumdesa_potensi') return <BumDesaCard item={item} />;
  return <PairCard item={item} />;
}

export default function BanuaOpportunity() {
  const { user } = useAuth();
  const [tab, setTab] = useState('kawasan');
  const [kabupatenList, setKabupatenList] = useState([]);
  const [kecamatanList, setKecamatanList] = useState([]);
  const [filter, setFilter] = useState({ kabupaten: '', kecamatan: '' });
  const [q, setQ] = useState('');
  const [coverage, setCoverage] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const kabupatenLocked = kabupatenList.length === 1 && user.role !== 'admin' && user.role !== 'provinsi';

  useEffect(() => {
    api.kabupaten().then((list) => {
      setKabupatenList(list);
      if (list.length === 1) setFilter((f) => ({ ...f, kabupaten: list[0] }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.kecamatan(filter.kabupaten).then(setKecamatanList).catch(() => {});
  }, [filter.kabupaten]);

  useEffect(() => {
    api.opportunityCoverage(cleanParams(filter)).then(setCoverage).catch(() => {});
  }, [filter]);

  useEffect(() => {
    setItems(null);
    setError(null);
    const activeTab = TABS.find((t) => t.key === tab);
    activeTab.fetch(cleanParams(filter)).then(setItems).catch((e) => setError(e.message));
  }, [tab, filter]);

  function update(field, val) {
    const next = { ...filter, [field]: val };
    if (field === 'kabupaten') next.kecamatan = '';
    setFilter(next);
  }

  const filtered = items ? items.filter((item) => !q.trim() || cardSearchText(item).includes(q.trim().toLowerCase())) : [];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">BANUA OPPORTUNITY</h1>
        <p className="page-desc">
          Dari temuan BANUA INSIGHT, peluang pengembangan/keterhubungan apa yang terlihat - berdasarkan kesamaan/komplementaritas
          potensi, kedekatan lokasi, dan kelembagaan yang sudah ada. Bukan rekomendasi "harus", hanya indikasi yang teridentifikasi dari data.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={t.key === tab ? 'btn' : 'btn btn-secondary'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <select value={filter.kabupaten} onChange={(e) => update('kabupaten', e.target.value)} disabled={kabupatenLocked}>
          {!kabupatenLocked && <option value="">Semua Kabupaten</option>}
          {kabupatenList.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={filter.kecamatan} onChange={(e) => update('kecamatan', e.target.value)}>
          <option value="">Semua Kecamatan</option>
          {kecamatanList.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input
          type="text"
          placeholder={'\u{1F50E} Cari peluang (sektor atau nama desa)...'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="panel">
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>{TAB_DESC[tab]}</p>
      </div>

      {coverage && (
        <div className="kpi-row">
          <div className="kpi-card">
            <div className="kpi-label">Peluang Teridentifikasi</div>
            <div className="kpi-value">{filtered.length.toLocaleString('id-ID')}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Desa dengan Koordinat</div>
            <div className="kpi-value">
              {coverage.desaDenganKoordinat.toLocaleString('id-ID')}
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> / {coverage.totalDesa.toLocaleString('id-ID')}</span>
            </div>
          </div>
        </div>
      )}

      {error && <div className="state-msg state-error">{error}</div>}
      {!items && !error && <div className="state-msg">Memuat data...</div>}
      {items && filtered.length === 0 && <div className="panel"><p className="state-msg">Tidak ada peluang yang cocok pada filter/pencarian ini.</p></div>}

      <div style={{ display: 'grid', gap: 12 }}>
        {filtered.map((item, i) => (
          <Card key={item.tipe === 'kawasan' ? `kw-${i}` : item.desaA ? `${item.tipe}-${item.desaA.kode_desa}-${item.desaB.kode_desa}` : `${item.tipe}-${item.desa.kode_desa}-${item.bidang}`} item={item} />
        ))}
      </div>
    </div>
  );
}
