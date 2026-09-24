import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

const CATEGORY_LABEL = {
  COMPLETENESS: 'Kelengkapan RPKP',
  IPKP: 'IPKP (Indeks Perkembangan Kawasan Perdesaan)',
  READINESS: 'Kesiapan Kawasan',
  RTRW: 'Kesesuaian RTRW & RPJMD',
  RPJMD: 'Kesesuaian RTRW & RPJMD',
  BANUA360: 'Cross-check BANUA360',
};
const CATEGORY_ORDER = ['COMPLETENESS', 'IPKP', 'READINESS', 'RTRW', 'RPJMD', 'BANUA360'];

const AI_STATUS_LABEL = { FOUND: 'Ditemukan', PARTIAL: 'Sebagian', NOT_FOUND: 'Belum Ditemukan' };
const REVIEWER_STATUS_LABEL = { PENDING: 'Menunggu Verifikasi', VERIFIED: 'Terverifikasi', REJECTED: 'Ditolak' };
const KEPUTUSAN_LABEL = {
  DAPAT_DIREKOMENDASIKAN: 'Dapat Diberikan Rekomendasi',
  DENGAN_CATATAN: 'Dapat Diberikan Rekomendasi dengan Catatan',
  BELUM_DAPAT: 'Belum Dapat Direkomendasikan',
};

function groupByCategory(findings) {
  const byCategory = new Map();
  for (const f of findings) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category).push(f);
  }
  return byCategory;
}

export default function RpkpReviewCetak() {
  const { id } = useParams();
  const [review, setReview] = useState(null);
  const [findings, setFindings] = useState(null);
  const [recommendation, setRecommendation] = useState(undefined);
  const [reviewDesa, setReviewDesa] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.rpkpReview(id),
      api.rpkpFindings(id),
      api.rpkpRecommendation(id),
      api.rpkpReviewDesa(id),
    ])
      .then(([r, f, rec, desa]) => {
        setReview(r);
        setFindings(f);
        setRecommendation(rec);
        setReviewDesa(desa);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="state-msg state-error">{error}</div>;
  if (!review || !findings || recommendation === undefined || !reviewDesa) {
    return <div className="state-msg">Memuat...</div>;
  }

  const byCategory = groupByCategory(findings);
  const totalItems = findings.length;
  const verifiedCount = findings.filter((f) => f.reviewer_status === 'VERIFIED').length;
  const rejectedCount = findings.filter((f) => f.reviewer_status === 'REJECTED').length;
  const pendingCount = findings.filter((f) => f.reviewer_status === 'PENDING').length;
  const now = new Date();

  return (
    <div className="cetak-page">
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <Link to={`/rpkp/review/${id}`} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>&larr; Kembali ke Review</Link>
        <button className="btn" onClick={() => window.print()}>Cetak / Simpan sebagai PDF</button>
      </div>

      <div className="cetak-kop">
        <div className="cetak-kop-instansi">PEMERINTAH PROVINSI KALIMANTAN SELATAN</div>
        <div className="cetak-kop-sub">Dinas Pemberdayaan Masyarakat dan Desa</div>
        <div className="cetak-judul">Ringkasan Hasil Review Rencana Pembangunan Kawasan Perdesaan (RPKP)</div>
      </div>

      <div className="panel cetak-section">
        <h2 className="cetak-section-title">Identitas Kawasan</h2>
        <div className="cetak-field-grid">
          <div><div className="cetak-field-label">Nama Kawasan</div>{review.nama_kawasan}</div>
          <div><div className="cetak-field-label">Kabupaten</div>{review.kabupaten}</div>
          <div><div className="cetak-field-label">Periode RPKP</div>{review.periode || '-'}</div>
          <div><div className="cetak-field-label">Tahun Dokumen</div>{review.tahun_dokumen || '-'}</div>
          <div><div className="cetak-field-label">Diajukan Oleh</div>{review.dibuat_oleh}</div>
          <div><div className="cetak-field-label">Status Review</div>{review.status}</div>
        </div>
        {reviewDesa.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="cetak-field-label" style={{ marginBottom: 6 }}>Desa Anggota Kawasan ({reviewDesa.length})</div>
            <div className="tag-list">
              {reviewDesa.map((d) => <span key={d.kode_desa} className="tag">{d.nama_desa}</span>)}
            </div>
          </div>
        )}
      </div>

      <div className="panel cetak-section">
        <h2 className="cetak-section-title">Ringkasan Verifikasi Temuan</h2>
        <div className="cetak-field-grid">
          <div><div className="cetak-field-label">Total Item Diperiksa</div>{totalItems}</div>
          <div><div className="cetak-field-label">Terverifikasi</div>{verifiedCount}</div>
          <div><div className="cetak-field-label">Ditolak</div>{rejectedCount}</div>
          <div><div className="cetak-field-label">Menunggu Verifikasi</div>{pendingCount}</div>
        </div>
      </div>

      {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => (
        <div className="panel cetak-section" key={cat}>
          <h2 className="cetak-section-title">{CATEGORY_LABEL[cat]}</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Topik</th><th>Status AI</th><th>Status Reviewer</th><th>Catatan Reviewer</th></tr>
              </thead>
              <tbody>
                {byCategory.get(cat).map((f) => (
                  <tr key={f.id}>
                    <td style={{ whiteSpace: 'normal' }}>{f.title}</td>
                    <td>{AI_STATUS_LABEL[f.ai_status] || f.ai_status}</td>
                    <td>{REVIEWER_STATUS_LABEL[f.reviewer_status] || f.reviewer_status}</td>
                    <td style={{ whiteSpace: 'normal' }}>{f.reviewer_note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="panel cetak-section">
        <h2 className="cetak-section-title">Keputusan (Recommendation Gate)</h2>
        {recommendation ? (
          <>
            <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>{KEPUTUSAN_LABEL[recommendation.keputusan] || recommendation.keputusan}</p>
            {recommendation.catatan && <p style={{ fontSize: 13, margin: '0 0 8px' }}>{recommendation.catatan}</p>}
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0 }}>
              Ditetapkan oleh {recommendation.dibuat_oleh} pada {new Date(recommendation.dibuat_pada).toLocaleString('id-ID')}
            </p>
          </>
        ) : (
          <p className="state-msg" style={{ padding: 0 }}>
            Belum ada keputusan yang ditetapkan - dokumen ini masih berupa draf ringkasan temuan, bukan hasil rekomendasi resmi.
          </p>
        )}
      </div>

      <div className="cetak-signature">
        <div className="cetak-signature-block">
          <div>Banjarmasin, {now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div style={{ marginTop: 4 }}>Reviewer Provinsi,</div>
          <div className="cetak-signature-gap" />
          <div style={{ fontWeight: 700, borderTop: '1px solid var(--text)', paddingTop: 4 }}>
            {recommendation ? recommendation.dibuat_oleh : '(...........................)'}
          </div>
        </div>
      </div>

      <p className="cetak-footer-note">
        Dokumen ini dihasilkan otomatis oleh Banua360 pada {now.toLocaleString('id-ID')}. Temuan AI bersifat usulan dan hanya
        sah sebagai temuan setelah diverifikasi oleh reviewer manusia; keputusan akhir merupakan keputusan reviewer Provinsi.
      </p>
    </div>
  );
}
