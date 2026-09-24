import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

export const STATUS_LABEL = {
  DRAFT: 'Draft',
  SUBMITTED: 'Diajukan',
  IN_REVIEW: 'Dalam Review',
  NEED_CLARIFICATION: 'Perlu Klarifikasi',
  REVIEW_COMPLETED: 'Selesai Ditelaah',
};

export const STATUS_BADGE_CLASS = {
  SUBMITTED: 'badge-berkembang',
  IN_REVIEW: 'badge-maju',
  NEED_CLARIFICATION: 'badge-tertinggal',
  REVIEW_COMPLETED: 'badge-mandiri',
};

export function StatusBadge({ status }) {
  const cls = STATUS_BADGE_CLASS[status];
  if (!cls) return <span className="badge" style={{ background: 'var(--panel-2)', color: 'var(--text-muted)' }}>{STATUS_LABEL[status] || status}</span>;
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status] || status}</span>;
}

export default function RpkpReview() {
  const { user } = useAuth();
  const [kabupatenList, setKabupatenList] = useState([]);
  const [filter, setFilter] = useState({ kabupaten: '', status: '', q: '' });
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nama_kawasan: '', kabupaten: '', periode: '', tahun_dokumen: '', keterangan: '' });
  const [saving, setSaving] = useState(false);

  const kabupatenLocked = user.role === 'kabupaten';

  useEffect(() => {
    api.kabupaten().then((list) => {
      setKabupatenList(list);
      if (kabupatenLocked && list.length === 1) setForm((f) => ({ ...f, kabupaten: list[0] }));
    }).catch(() => {});
  }, [kabupatenLocked]);

  function refresh() {
    api.rpkpReviews({ kabupaten: filter.kabupaten, status: filter.status, q: filter.q }).then(setReviews).catch((e) => setError(e.message));
  }

  useEffect(refresh, [filter]);

  async function submitForm(e) {
    e.preventDefault();
    if (!form.nama_kawasan.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, tahun_dokumen: form.tahun_dokumen ? Number(form.tahun_dokumen) : null };
      await api.rpkpReviewCreate(payload);
      setForm({ nama_kawasan: '', kabupaten: kabupatenLocked ? form.kabupaten : '', periode: '', tahun_dokumen: '', keterangan: '' });
      setShowForm(false);
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const kpi = reviews
    ? {
        total: reviews.length,
        dalamReview: reviews.filter((r) => r.status === 'IN_REVIEW').length,
        perluKlarifikasi: reviews.filter((r) => r.status === 'NEED_CLARIFICATION').length,
        selesai: reviews.filter((r) => r.status === 'REVIEW_COMPLETED').length,
      }
    : null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Review RPKP</h1>
        <p className="page-desc">
          Telaah Rencana Pembangunan Kawasan Perdesaan yang disampaikan Kabupaten sebelum rekomendasi/penetapan Provinsi.
          Sistem ini membantu menelusuri kelengkapan dokumen - keputusan telaah tetap di tangan reviewer.
        </p>
      </div>

      {kpi && (
        <div className="kpi-row">
          <div className="kpi-card"><div className="kpi-label">Total RPKP</div><div className="kpi-value">{kpi.total}</div></div>
          <div className="kpi-card"><div className="kpi-label">Dalam Review</div><div className="kpi-value">{kpi.dalamReview}</div></div>
          <div className="kpi-card"><div className="kpi-label">Perlu Klarifikasi</div><div className="kpi-value">{kpi.perluKlarifikasi}</div></div>
          <div className="kpi-card"><div className="kpi-label">Selesai Ditelaah</div><div className="kpi-value">{kpi.selesai}</div></div>
        </div>
      )}

      <div className="filter-bar">
        <select value={filter.kabupaten} onChange={(e) => setFilter({ ...filter, kabupaten: e.target.value })} disabled={kabupatenLocked}>
          {!kabupatenLocked && <option value="">Semua Kabupaten</option>}
          {kabupatenList.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Semua Status</option>
          {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <input type="text" placeholder="Cari nama kawasan / kabupaten..." value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <button className="btn" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Batal' : '+ Review RPKP Baru'}</button>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}

      {showForm && (
        <div className="panel">
          <h2 className="panel-title">Review RPKP Baru</h2>
          <form onSubmit={submitForm}>
            <div className="filter-bar" style={{ marginTop: 0 }}>
              <input type="text" placeholder="Nama Kawasan" value={form.nama_kawasan} onChange={(e) => setForm({ ...form, nama_kawasan: e.target.value })} required />
              {kabupatenLocked ? (
                <input type="text" value={form.kabupaten} disabled />
              ) : (
                <select value={form.kabupaten} onChange={(e) => setForm({ ...form, kabupaten: e.target.value })} required>
                  <option value="">Pilih Kabupaten</option>
                  {kabupatenList.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
              <input type="text" placeholder="Periode (mis. 2026-2031)" value={form.periode} onChange={(e) => setForm({ ...form, periode: e.target.value })} />
              <input type="number" placeholder="Tahun Dokumen" value={form.tahun_dokumen} onChange={(e) => setForm({ ...form, tahun_dokumen: e.target.value })} />
            </div>
            <textarea
              placeholder="Keterangan (opsional)"
              value={form.keterangan}
              onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
              style={{ width: '100%', minHeight: 70, marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', fontFamily: 'inherit', fontSize: 13 }}
            />
            <button className="btn" type="submit" disabled={saving} style={{ marginTop: 10 }}>{saving ? 'Menyimpan...' : 'Buat Review'}</button>
          </form>
        </div>
      )}

      <div className="panel">
        {!reviews && <p className="state-msg">Memuat...</p>}
        {reviews && reviews.length === 0 && <p className="state-msg">Belum ada review RPKP.</p>}
        {reviews && reviews.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Kawasan</th><th>Kabupaten</th><th>Dokumen</th><th>Status</th><th>Diperbarui</th></tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/rpkp/review/${r.id}`} style={{ fontWeight: 600 }}>{r.nama_kawasan}</Link></td>
                    <td>{r.kabupaten}</td>
                    <td>{r.jumlah_dokumen}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{new Date(r.diperbarui_pada).toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
