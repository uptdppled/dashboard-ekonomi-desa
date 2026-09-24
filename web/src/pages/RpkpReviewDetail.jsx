import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { StatusBadge } from './RpkpReview';

const DOCUMENT_TYPE_LABEL = {
  RPKP: 'RPKP',
  RTRW: 'RTRW',
  RPJMD: 'RPJMD',
  MASTERPLAN: 'Masterplan',
  PETA: 'Peta',
  LAMPIRAN: 'Lampiran',
  LAINNYA: 'Lainnya',
};

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'dokumen', label: 'Dokumen' },
  { key: 'review', label: 'Review' },
  { key: 'temuan', label: 'Temuan' },
  { key: 'keputusan', label: 'Keputusan' },
  { key: 'riwayat', label: 'Riwayat' },
];

const AI_STATUS_LABEL = { FOUND: 'Ditemukan', PARTIAL: 'Sebagian', NOT_FOUND: 'Belum Ditemukan' };
const AI_STATUS_CLASS = { FOUND: 'badge-mandiri', PARTIAL: 'badge-berkembang', NOT_FOUND: 'badge-tertinggal' };
const REVIEWER_STATUS_LABEL = { PENDING: 'Menunggu Verifikasi', VERIFIED: 'Terverifikasi', REJECTED: 'Ditolak' };
const REVIEWER_STATUS_CLASS = { VERIFIED: 'badge-mandiri', REJECTED: 'badge-tertinggal' };
const KEPUTUSAN_LABEL = {
  DAPAT_DIREKOMENDASIKAN: 'Dapat Diberikan Rekomendasi',
  DENGAN_CATATAN: 'Dapat Diberikan Rekomendasi dengan Catatan',
  BELUM_DAPAT: 'Belum Dapat Direkomendasikan',
};
const KEPUTUSAN_CLASS = {
  DAPAT_DIREKOMENDASIKAN: 'badge-mandiri',
  DENGAN_CATATAN: 'badge-berkembang',
  BELUM_DAPAT: 'badge-tertinggal',
};

function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SmallBadge({ children, className }) {
  return <span className={`badge ${className || ''}`} style={!className ? { background: 'var(--panel-2)', color: 'var(--text-muted)' } : undefined}>{children}</span>;
}

function EvidenceList({ evidence }) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {evidence.map((e, i) => (
        <div key={i} style={{ fontSize: 11.5, color: 'var(--text-muted)', borderLeft: '2px solid var(--border-strong)', paddingLeft: 8 }}>
          {e.sumber_dokumen && <span>{e.sumber_dokumen}{e.halaman ? `, hal. ${e.halaman}` : ''}</span>}
          {e.kutipan && <div style={{ fontStyle: 'italic' }}>&ldquo;{e.kutipan}&rdquo;</div>}
        </div>
      ))}
    </div>
  );
}

// Shared by Kelengkapan's 13 items and the single RTRW/RPJMD/BANUA360
// checks - same AI-proposes/reviewer-verifies shape either way, just one
// checklist row vs. one review-wide check.
function FindingCard({ title, description, finding, busy, locked, onCheck, checkLabel, isReviewer, findingNotes, setFindingNotes, findingBusy, onVerify, onReject }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
          {description && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{description}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {finding && <SmallBadge className={AI_STATUS_CLASS[finding.ai_status]}>{AI_STATUS_LABEL[finding.ai_status]}</SmallBadge>}
          {finding && <SmallBadge className={REVIEWER_STATUS_CLASS[finding.reviewer_status]}>{REVIEWER_STATUS_LABEL[finding.reviewer_status]}</SmallBadge>}
          {isReviewer && onCheck && (
            <button className="btn btn-secondary" disabled={busy || locked} onClick={onCheck}>
              {busy ? 'Memeriksa...' : finding ? 'Cek Ulang dengan AI' : (checkLabel || 'Cek dengan AI')}
            </button>
          )}
        </div>
      </div>
      {finding && (
        <div style={{ marginTop: 8 }}>
          {finding.ai_summary && <p style={{ fontSize: 12.5, margin: '0 0 4px' }}>{finding.ai_summary}</p>}
          <EvidenceList evidence={finding.evidence} />
          {isReviewer && finding.reviewer_status === 'PENDING' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Catatan (opsional)"
                value={findingNotes[finding.id] || ''}
                onChange={(e) => setFindingNotes((prev) => ({ ...prev, [finding.id]: e.target.value }))}
                style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-strong)', fontSize: 12.5 }}
              />
              <button className="btn" disabled={findingBusy === finding.id || locked} onClick={() => onVerify(finding.id)}>Verifikasi</button>
              <button className="btn btn-secondary" disabled={findingBusy === finding.id || locked} onClick={() => onReject(finding.id)}>Tolak</button>
            </div>
          )}
          {finding.reviewer_note && finding.reviewer_status !== 'PENDING' && (
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>Catatan reviewer: {finding.reviewer_note}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function RpkpReviewDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [review, setReview] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [uploadType, setUploadType] = useState('RPKP');
  const [uploading, setUploading] = useState(false);
  const [clarifyNote, setClarifyNote] = useState('');
  const [showClarifyBox, setShowClarifyBox] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const [qaList, setQaList] = useState(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiErrorCode, setAiErrorCode] = useState(null);
  const [showAskBox, setShowAskBox] = useState(false);

  const [completenessItems, setCompletenessItems] = useState(null);
  const [ipkpItems, setIpkpItems] = useState(null);
  const [readinessItems, setReadinessItems] = useState(null);
  const [findings, setFindings] = useState(null);
  const [checkingKode, setCheckingKode] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [findingBusy, setFindingBusy] = useState(null);
  const [findingNotes, setFindingNotes] = useState({});

  const [recommendation, setRecommendation] = useState(undefined);
  const [gateKeputusan, setGateKeputusan] = useState('DAPAT_DIREKOMENDASIKAN');
  const [gateCatatan, setGateCatatan] = useState('');
  const [gateSaving, setGateSaving] = useState(false);
  const [gateError, setGateError] = useState(null);

  const [reviewDesa, setReviewDesa] = useState(null);
  const [desaOptions, setDesaOptions] = useState(null);
  const [desaSelection, setDesaSelection] = useState(new Set());
  const [desaFilter, setDesaFilter] = useState('');
  const [desaEditing, setDesaEditing] = useState(false);
  const [desaSaving, setDesaSaving] = useState(false);
  const [desaError, setDesaError] = useState(null);

  const [rtrwChecking, setRtrwChecking] = useState(false);
  const [rpjmdChecking, setRpjmdChecking] = useState(false);
  const [banua360Checking, setBanua360Checking] = useState(false);
  const [alignmentError, setAlignmentError] = useState(null);

  const [checkAllRunning, setCheckAllRunning] = useState(false);
  const [checkAllRedo, setCheckAllRedo] = useState(false);
  const [checkAllProgress, setCheckAllProgress] = useState(null);
  const [checkAllErrors, setCheckAllErrors] = useState([]);
  const checkAllCancelRef = useRef(false);

  function loadReview() {
    api.rpkpReview(id).then(setReview).catch((e) => setError(e.message));
  }
  function loadDocuments() {
    api.rpkpDocuments(id).then(setDocuments).catch((e) => setError(e.message));
  }
  function loadHistory() {
    api.rpkpHistory(id).then(setHistory).catch((e) => setError(e.message));
  }
  function loadQa() {
    api.rpkpAiQaList(id).then(setQaList).catch((e) => setError(e.message));
  }
  function loadFindings() {
    api.rpkpFindings(id).then(setFindings).catch((e) => setError(e.message));
  }
  function loadRecommendation() {
    api.rpkpRecommendation(id).then((r) => {
      setRecommendation(r);
      if (r) {
        setGateKeputusan(r.keputusan);
        setGateCatatan(r.catatan || '');
      }
    }).catch((e) => setError(e.message));
  }
  function loadReviewDesa() {
    api.rpkpReviewDesa(id).then((rows) => {
      setReviewDesa(rows);
      setDesaSelection(new Set(rows.map((d) => d.kode_desa)));
    }).catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadReview();
    loadDocuments();
    loadHistory();
    loadQa();
    loadFindings();
    loadRecommendation();
    loadReviewDesa();
    api.rpkpCompletenessItems().then(setCompletenessItems).catch((e) => setError(e.message));
    api.rpkpChecklistItems('IPKP').then(setIpkpItems).catch((e) => setError(e.message));
    api.rpkpChecklistItems('READINESS').then(setReadinessItems).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!review) return;
    api.desaList({ kabupaten: review.kabupaten }).then(setDesaOptions).catch((e) => setError(e.message));
  }, [review?.kabupaten]);

  async function handleAsk(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAiError(null);
    setAiErrorCode(null);
    try {
      await api.rpkpAiAsk(id, question.trim());
      setQuestion('');
      loadQa();
    } catch (e) {
      setAiError(e.message);
      setAiErrorCode(e.code);
    } finally {
      setAsking(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('documentType', uploadType);
      formData.append('file', file);
      await api.rpkpDocumentUpload(id, formData);
      e.target.reset();
      loadDocuments();
      loadReview();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function doStatus(status, note) {
    setStatusBusy(true);
    setError(null);
    try {
      await api.rpkpStatus(id, status, note);
      setShowClarifyBox(false);
      setClarifyNote('');
      loadReview();
      loadHistory();
    } catch (e) {
      setError(e.message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleCheck(kode) {
    setCheckingKode(kode);
    setCheckError(null);
    try {
      await api.rpkpCompletenessCheck(id, kode);
      loadFindings();
      loadHistory();
    } catch (e) {
      setCheckError(`${kode}: ${e.message}`);
    } finally {
      setCheckingKode(null);
    }
  }

  async function handleChecklistCheck(kode) {
    setCheckingKode(kode);
    setCheckError(null);
    try {
      await api.rpkpChecklistCheck(id, kode);
      loadFindings();
      loadHistory();
    } catch (e) {
      setCheckError(`${kode}: ${e.message}`);
    } finally {
      setCheckingKode(null);
    }
  }

  async function handleFindingAction(findingId, action) {
    setFindingBusy(findingId);
    try {
      const note = findingNotes[findingId];
      if (action === 'verify') await api.rpkpFindingVerify(findingId, note);
      else await api.rpkpFindingReject(findingId, note);
      loadFindings();
      loadHistory();
    } catch (e) {
      setError(e.message);
    } finally {
      setFindingBusy(null);
    }
  }

  function toggleDesa(kode) {
    setDesaSelection((prev) => {
      const next = new Set(prev);
      if (next.has(kode)) next.delete(kode);
      else next.add(kode);
      return next;
    });
  }

  async function handleSaveDesa() {
    setDesaSaving(true);
    setDesaError(null);
    try {
      await api.rpkpReviewDesaSet(id, [...desaSelection]);
      loadReviewDesa();
      loadHistory();
      setDesaEditing(false);
    } catch (e) {
      setDesaError(e.message);
    } finally {
      setDesaSaving(false);
    }
  }

  async function handleRtrwCheck() {
    setRtrwChecking(true);
    setAlignmentError(null);
    try {
      await api.rpkpRtrwCheck(id);
      loadFindings();
      loadHistory();
    } catch (e) {
      setAlignmentError(`RTRW: ${e.message}`);
    } finally {
      setRtrwChecking(false);
    }
  }

  async function handleRpjmdCheck() {
    setRpjmdChecking(true);
    setAlignmentError(null);
    try {
      await api.rpkpRpjmdCheck(id);
      loadFindings();
      loadHistory();
    } catch (e) {
      setAlignmentError(`RPJMD: ${e.message}`);
    } finally {
      setRpjmdChecking(false);
    }
  }

  async function handleBanua360Check() {
    setBanua360Checking(true);
    setAlignmentError(null);
    try {
      await api.rpkpBanua360Check(id);
      loadFindings();
      loadHistory();
    } catch (e) {
      setAlignmentError(`BANUA360: ${e.message}`);
    } finally {
      setBanua360Checking(false);
    }
  }

  // One combined queue covering every AI check on the page (Kelengkapan +
  // IPKP + Kesiapan Kawasan + RTRW + RPJMD + BANUA360) so the reviewer can
  // run them all from a single button instead of clicking each one. Skips
  // items that already have a finding unless "redo" is checked, since
  // re-running an already-verified item wastes Gemini quota for no reason.
  function getCheckAllTasks() {
    const hasFinding = (category, kode) => (findings || []).some((f) => f.category === category && f.item_kode === kode);
    const hasCategoryFinding = (category) => (findings || []).some((f) => f.category === category);
    const tasks = [];
    for (const item of completenessItems || []) {
      if (checkAllRedo || !hasFinding('COMPLETENESS', item.kode)) {
        tasks.push({ label: item.label, run: () => api.rpkpCompletenessCheck(id, item.kode) });
      }
    }
    for (const item of ipkpItems || []) {
      if (checkAllRedo || !hasFinding('IPKP', item.kode)) {
        tasks.push({ label: item.label, run: () => api.rpkpChecklistCheck(id, item.kode) });
      }
    }
    for (const item of readinessItems || []) {
      if (checkAllRedo || !hasFinding('READINESS', item.kode)) {
        tasks.push({ label: item.label, run: () => api.rpkpChecklistCheck(id, item.kode) });
      }
    }
    if (checkAllRedo || !hasCategoryFinding('RTRW')) {
      tasks.push({ label: 'Kesesuaian Tata Ruang (RTRW)', run: () => api.rpkpRtrwCheck(id) });
    }
    if (checkAllRedo || !hasCategoryFinding('RPJMD')) {
      tasks.push({ label: 'Keselarasan RPJMD', run: () => api.rpkpRpjmdCheck(id) });
    }
    if (checkAllRedo || !hasCategoryFinding('BANUA360')) {
      tasks.push({ label: 'Cross-check BANUA360', run: () => api.rpkpBanua360Check(id) });
    }
    return tasks;
  }

  async function handleCheckAll() {
    const tasks = getCheckAllTasks();
    if (tasks.length === 0) return;
    checkAllCancelRef.current = false;
    setCheckAllRunning(true);
    setCheckAllErrors([]);
    setCheckAllProgress({ done: 0, total: tasks.length, label: tasks[0].label });
    for (let i = 0; i < tasks.length; i++) {
      if (checkAllCancelRef.current) break;
      setCheckAllProgress({ done: i, total: tasks.length, label: tasks[i].label });
      try {
        await tasks[i].run();
        loadFindings();
      } catch (e) {
        setCheckAllErrors((prev) => [...prev, { label: tasks[i].label, message: e.message }]);
      }
    }
    loadHistory();
    setCheckAllProgress((prev) => (prev ? { ...prev, done: tasks.length } : prev));
    setCheckAllRunning(false);
  }

  function handleCheckAllStop() {
    checkAllCancelRef.current = true;
  }

  async function handleGateSubmit(e) {
    e.preventDefault();
    setGateSaving(true);
    setGateError(null);
    try {
      await api.rpkpRecommendationSet(id, gateKeputusan, gateCatatan.trim() || null);
      loadRecommendation();
      loadReview();
      loadHistory();
    } catch (e) {
      setGateError(e.message);
    } finally {
      setGateSaving(false);
    }
  }

  if (!review) {
    return <div className="state-msg">{error || 'Memuat...'}</div>;
  }

  const isKabupaten = user.role === 'kabupaten';
  const isReviewer = user.role === 'admin' || user.role === 'provinsi';
  const kabupatenCanAct = isKabupaten && (review.status === 'DRAFT' || review.status === 'NEED_CLARIFICATION');
  const reviewerCanClarify = isReviewer && review.status === 'IN_REVIEW';
  const reviewerCanStart = isReviewer && review.status === 'SUBMITTED';
  const hasAction = kabupatenCanAct || reviewerCanClarify || reviewerCanStart;

  const findingByKode = new Map((findings || []).filter((f) => f.category === 'COMPLETENESS').map((f) => [f.item_kode, f]));
  const ipkpFindingByKode = new Map((findings || []).filter((f) => f.category === 'IPKP').map((f) => [f.item_kode, f]));
  const readinessFindingByKode = new Map((findings || []).filter((f) => f.category === 'READINESS').map((f) => [f.item_kode, f]));
  const rtrwFinding = (findings || []).find((f) => f.category === 'RTRW');
  const rpjmdFinding = (findings || []).find((f) => f.category === 'RPJMD');
  const banua360Finding = (findings || []).find((f) => f.category === 'BANUA360');
  const onVerify = (fid) => handleFindingAction(fid, 'verify');
  const onReject = (fid) => handleFindingAction(fid, 'reject');
  const checkAllPending = isReviewer && completenessItems && ipkpItems && readinessItems ? getCheckAllTasks().length : 0;

  return (
    <div>
      <div className="page-header">
        <Link to="/rpkp/review" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>&larr; Review RPKP</Link>
        <h1 className="page-title" style={{ marginTop: 6 }}>{review.nama_kawasan}</h1>
        <p className="page-desc">
          {review.kabupaten}{review.periode ? ` · Periode ${review.periode}` : ''} · <StatusBadge status={review.status} />
        </p>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.key} className={t.key === tab ? 'btn' : 'btn btn-secondary'} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <Link to={`/rpkp/review/${id}/cetak`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>Cetak Ringkasan</Link>
      </div>

      {tab === 'overview' && (
        <>
          <div className="panel">
            <h2 className="panel-title">Identitas</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, fontSize: 13 }}>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Kabupaten</div>{review.kabupaten}</div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Periode</div>{review.periode || '-'}</div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Tahun Dokumen</div>{review.tahun_dokumen || '-'}</div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Diajukan Oleh</div>{review.dibuat_oleh}</div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Dibuat</div>{new Date(review.dibuat_pada).toLocaleString('id-ID')}</div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Diperbarui</div>{new Date(review.diperbarui_pada).toLocaleString('id-ID')}</div>
            </div>
            {review.keterangan && (
              <div style={{ marginTop: 14 }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Keterangan</div>
                <p style={{ margin: '4px 0 0', fontSize: 13 }}>{review.keterangan}</p>
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Aksi</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {isKabupaten && (review.status === 'DRAFT' || review.status === 'NEED_CLARIFICATION') && (
                <button className="btn" disabled={statusBusy} onClick={() => doStatus('SUBMITTED')}>
                  {review.status === 'NEED_CLARIFICATION' ? 'Ajukan Ulang (Sudah Direvisi)' : 'Ajukan untuk Review'}
                </button>
              )}
              {reviewerCanStart && (
                <button className="btn" disabled={statusBusy} onClick={() => doStatus('IN_REVIEW')}>Mulai Review</button>
              )}
              {reviewerCanClarify && (
                <button className="btn btn-secondary" disabled={statusBusy} onClick={() => setShowClarifyBox((v) => !v)}>Minta Klarifikasi</button>
              )}
              {!hasAction && (
                <p className="state-msg" style={{ padding: 0 }}>
                  {review.status === 'REVIEW_COMPLETED'
                    ? 'Review ini sudah selesai ditelaah - lihat tab Keputusan untuk hasilnya.'
                    : 'Tidak ada aksi yang bisa Anda lakukan pada status saat ini.'}
                </p>
              )}
            </div>
            {reviewerCanClarify && (
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '10px 0 0' }}>
                Sudah selesai menelaah? Buka tab <strong>Keputusan</strong> untuk menetapkan Recommendation Gate - itu yang menandai review ini selesai.
              </p>
            )}
            {showClarifyBox && (
              <div style={{ marginTop: 12 }}>
                <textarea
                  placeholder="Catatan klarifikasi untuk Kabupaten..."
                  value={clarifyNote}
                  onChange={(e) => setClarifyNote(e.target.value)}
                  style={{ width: '100%', minHeight: 70, padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', fontFamily: 'inherit', fontSize: 13 }}
                />
                <button className="btn" style={{ marginTop: 8 }} disabled={statusBusy || !clarifyNote.trim()} onClick={() => doStatus('NEED_CLARIFICATION', clarifyNote.trim())}>
                  Kirim Permintaan Klarifikasi
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'dokumen' && (
        <>
          <div className="panel">
            <h2 className="panel-title">Unggah Dokumen</h2>
            <form onSubmit={handleUpload}>
              <div className="filter-bar" style={{ marginTop: 0 }}>
                <select value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                  {Object.entries(DOCUMENT_TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <input type="file" name="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx" required />
                <button className="btn" type="submit" disabled={uploading}>{uploading ? 'Mengunggah...' : 'Unggah'}</button>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                Format: PDF, Word, Excel, atau gambar - maks 100MB. Mengunggah jenis dokumen yang sama akan tersimpan sebagai versi baru (versi lama tetap ada).
              </p>
            </form>
          </div>

          <div className="panel">
            <h2 className="panel-title">Daftar Dokumen</h2>
            {!documents && <p className="state-msg">Memuat...</p>}
            {documents && documents.length === 0 && <p className="state-msg">Belum ada dokumen diunggah.</p>}
            {documents && documents.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Jenis</th><th>Versi</th><th>Nama File</th><th>Ukuran</th><th>Diunggah</th><th></th></tr>
                  </thead>
                  <tbody>
                    {documents.map((d) => (
                      <tr key={d.id}>
                        <td>{DOCUMENT_TYPE_LABEL[d.document_type] || d.document_type}</td>
                        <td>v{d.version}</td>
                        <td>{d.original_filename}</td>
                        <td>{formatSize(d.file_size)}</td>
                        <td>{new Date(d.diunggah_pada).toLocaleString('id-ID')}</td>
                        <td>
                          <a href={api.rpkpDocumentFileUrl(id, d.id)} target="_blank" rel="noreferrer">Lihat/Unduh</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'review' && (
        <>
          {isReviewer && (
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h2 className="panel-title" style={{ marginBottom: 2 }}>Periksa Semua dengan AI</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                    Menjalankan seluruh pemeriksaan AI di bawah (Kelengkapan, IPKP, Kesiapan Kawasan, RTRW, RPJMD, BANUA360) satu per satu secara otomatis - tidak perlu klik "Cek dengan AI" di tiap item.
                  </p>
                </div>
                {checkAllRunning ? (
                  <button className="btn btn-secondary" onClick={handleCheckAllStop}>Hentikan</button>
                ) : (
                  <button className="btn" onClick={handleCheckAll} disabled={checkAllPending === 0}>
                    {checkAllPending === 0 ? 'Semua Sudah Diperiksa' : `Periksa Semua (${checkAllPending} item)`}
                  </button>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 10, color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={checkAllRedo} disabled={checkAllRunning} onChange={(e) => setCheckAllRedo(e.target.checked)} />
                Periksa ulang item yang sudah punya temuan (bukan hanya yang belum diperiksa)
              </label>
              {checkAllProgress && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12.5 }}>
                    {checkAllRunning
                      ? `Memeriksa ${checkAllProgress.done + 1} dari ${checkAllProgress.total}: ${checkAllProgress.label}...`
                      : `Selesai: ${checkAllProgress.total - checkAllErrors.length} dari ${checkAllProgress.total} berhasil.`}
                  </div>
                  <div className="score-bar-track" style={{ marginTop: 6 }}>
                    <div
                      className="score-bar-fill"
                      style={{ width: `${Math.round(((checkAllRunning ? checkAllProgress.done : checkAllProgress.total) / checkAllProgress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {checkAllErrors.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--status-tertinggal)', fontWeight: 600 }}>
                    {checkAllErrors.length} item gagal diperiksa (biasanya server AI sedang sibuk - klik "Periksa Semua" lagi untuk mencoba item yang belum berhasil):
                  </div>
                  {checkAllErrors.map((e, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{e.label}: {e.message}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 className="panel-title" style={{ marginBottom: 2 }}>Asisten AI Dokumen</h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Tanya bebas isi dokumen - untuk investigasi di luar checklist kelengkapan di bawah.</p>
              </div>
              <button className="btn btn-secondary" onClick={() => setShowAskBox((v) => !v)}>{showAskBox ? 'Tutup' : 'Tanya AI'}</button>
            </div>
            {showAskBox && (
              <div style={{ marginTop: 12 }}>
                <form onSubmit={handleAsk}>
                  <textarea
                    placeholder='Contoh: "Apa saja tujuan RPKP ini?" atau "Di halaman berapa strategi pengembangan ekonomi dibahas?"'
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', fontFamily: 'inherit', fontSize: 13 }}
                  />
                  <button className="btn" type="submit" style={{ marginTop: 8 }} disabled={asking || !question.trim()}>
                    {asking ? 'AI sedang membaca dokumen...' : 'Tanya AI'}
                  </button>
                  {asking && (
                    <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                      Bisa memakan waktu beberapa menit untuk dokumen berukuran besar, atau saat server AI Gemini sedang sibuk - sistem otomatis mencoba ulang.
                    </p>
                  )}
                </form>
                {aiError && (
                  <div className="state-msg state-error" style={{ textAlign: 'left', padding: '10px 0' }}>
                    {aiErrorCode === 'NO_API_KEY'
                      ? 'Fitur ini belum aktif: admin perlu mengisi GEMINI_API_KEY (gratis) di server/.env, lalu restart server.'
                      : aiError}
                  </div>
                )}
                {qaList && qaList.length > 0 && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {qaList.map((qa) => (
                      <div key={qa.id} style={{ borderLeft: `2px solid ${qa.ditemukan ? 'var(--status-mandiri)' : 'var(--status-tertinggal)'}`, paddingLeft: 12 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{qa.pertanyaan}</div>
                        <div style={{ fontSize: 13, margin: '4px 0' }}>{qa.jawaban}</div>
                        {qa.ditemukan && qa.sumber_dokumen && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Sumber: {qa.sumber_dokumen}{qa.halaman ? `, hal. ${qa.halaman}` : ''}</div>
                        )}
                        {qa.kutipan && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>&ldquo;{qa.kutipan}&rdquo;</div>}
                        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 4 }}>{qa.ditanya_oleh} · {new Date(qa.dibuat_pada).toLocaleString('id-ID')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Kelengkapan RPKP</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Untuk tiap topik, klik "Cek dengan AI" untuk mencari apakah topik tersebut dibahas di dokumen. AI hanya mengusulkan temuan -
              reviewer yang memverifikasi atau menolaknya.
            </p>
            {checkError && <div className="state-msg state-error" style={{ padding: '8px 0' }}>{checkError}</div>}
            {!completenessItems && <p className="state-msg">Memuat...</p>}
            {completenessItems && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {completenessItems.map((item) => (
                  <FindingCard
                    key={item.kode}
                    title={item.label}
                    description={item.deskripsi}
                    finding={findingByKode.get(item.kode)}
                    busy={checkingKode === item.kode}
                    locked={checkAllRunning}
                    onCheck={() => handleCheck(item.kode)}
                    isReviewer={isReviewer}
                    findingNotes={findingNotes}
                    setFindingNotes={setFindingNotes}
                    findingBusy={findingBusy}
                    onVerify={onVerify}
                    onReject={onReject}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">IPKP (Indeks Perkembangan Kawasan Perdesaan)</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              "Hasil Pengukuran IPKP" mengecek apakah kawasan ini sudah punya skor IPKP terukur - belum tentu ada, dan itu bukan berarti RPKP kurang.
              5 dimensi di bawahnya mengecek substansi tiap dimensi dalam dokumen.
            </p>
            {checkError && <div className="state-msg state-error" style={{ padding: '8px 0' }}>{checkError}</div>}
            {!ipkpItems && <p className="state-msg">Memuat...</p>}
            {ipkpItems && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {ipkpItems.map((item) => (
                  <FindingCard
                    key={item.kode}
                    title={item.label}
                    description={item.deskripsi}
                    finding={ipkpFindingByKode.get(item.kode)}
                    busy={checkingKode === item.kode}
                    locked={checkAllRunning}
                    onCheck={() => handleChecklistCheck(item.kode)}
                    isReviewer={isReviewer}
                    findingNotes={findingNotes}
                    setFindingNotes={setFindingNotes}
                    findingBusy={findingBusy}
                    onVerify={onVerify}
                    onReject={onReject}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Kesiapan Kawasan</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Analisis kelayakan pengembangan kawasan dari sisi operasional, sosial budaya, lingkungan, dan ekonomi finansial.
            </p>
            {checkError && <div className="state-msg state-error" style={{ padding: '8px 0' }}>{checkError}</div>}
            {!readinessItems && <p className="state-msg">Memuat...</p>}
            {readinessItems && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {readinessItems.map((item) => (
                  <FindingCard
                    key={item.kode}
                    title={item.label}
                    description={item.deskripsi}
                    finding={readinessFindingByKode.get(item.kode)}
                    busy={checkingKode === item.kode}
                    locked={checkAllRunning}
                    onCheck={() => handleChecklistCheck(item.kode)}
                    isReviewer={isReviewer}
                    findingNotes={findingNotes}
                    setFindingNotes={setFindingNotes}
                    findingBusy={findingBusy}
                    onVerify={onVerify}
                    onReject={onReject}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 className="panel-title" style={{ marginBottom: 2 }}>Desa Anggota Kawasan</h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  Dipakai untuk cross-check BANUA360 di bawah - tandai desa mana saja yang termasuk kawasan ini.
                </p>
              </div>
              {!desaEditing && (
                <button className="btn btn-secondary" onClick={() => setDesaEditing(true)}>
                  {reviewDesa && reviewDesa.length > 0 ? 'Ubah Daftar Desa' : 'Tandai Desa Anggota'}
                </button>
              )}
            </div>
            {!desaEditing && (
              <div style={{ marginTop: 10 }}>
                {!reviewDesa && <p className="state-msg" style={{ padding: 0 }}>Memuat...</p>}
                {reviewDesa && reviewDesa.length === 0 && <p className="state-msg" style={{ padding: 0 }}>Belum ada desa yang ditandai.</p>}
                {reviewDesa && reviewDesa.length > 0 && (
                  <div className="tag-list">
                    {reviewDesa.map((d) => <span key={d.kode_desa} className="tag">{d.nama_desa}</span>)}
                  </div>
                )}
              </div>
            )}
            {desaEditing && (
              <div style={{ marginTop: 10 }}>
                <input
                  type="text"
                  placeholder="Cari nama desa..."
                  value={desaFilter}
                  onChange={(e) => setDesaFilter(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-strong)', fontSize: 12.5, marginBottom: 8 }}
                />
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  {!desaOptions && <p className="state-msg" style={{ padding: 0 }}>Memuat...</p>}
                  {desaOptions && desaOptions
                    .filter((d) => d.nama_desa.toLowerCase().includes(desaFilter.trim().toLowerCase()))
                    .map((d) => (
                      <label key={d.kode_desa} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                        <input type="checkbox" checked={desaSelection.has(d.kode_desa)} onChange={() => toggleDesa(d.kode_desa)} />
                        {d.nama_desa} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({d.kecamatan})</span>
                      </label>
                    ))}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>{desaSelection.size} desa dipilih.</p>
                {desaError && <div className="state-msg state-error" style={{ padding: '8px 0' }}>{desaError}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn" disabled={desaSaving} onClick={handleSaveDesa}>{desaSaving ? 'Menyimpan...' : 'Simpan'}</button>
                  <button className="btn btn-secondary" disabled={desaSaving} onClick={() => { setDesaEditing(false); setDesaSelection(new Set((reviewDesa || []).map((d) => d.kode_desa))); }}>Batal</button>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Kesesuaian RTRW & RPJMD</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Membandingkan RPKP dengan dokumen RTRW/RPJMD yang diunggah di tab Dokumen. Kalau dokumennya belum diunggah, hasilnya "Belum Ditemukan" - bukan diabaikan atau dianggap sesuai.
            </p>
            {alignmentError && <div className="state-msg state-error" style={{ padding: '8px 0' }}>{alignmentError}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <FindingCard
                title="Kesesuaian Tata Ruang (RTRW)"
                finding={rtrwFinding}
                busy={rtrwChecking}
                locked={checkAllRunning}
                onCheck={handleRtrwCheck}
                checkLabel="Cek RTRW"
                isReviewer={isReviewer}
                findingNotes={findingNotes}
                setFindingNotes={setFindingNotes}
                findingBusy={findingBusy}
                onVerify={onVerify}
                onReject={onReject}
              />
              <FindingCard
                title="Keselarasan RPJMD"
                finding={rpjmdFinding}
                busy={rpjmdChecking}
                locked={checkAllRunning}
                onCheck={handleRpjmdCheck}
                checkLabel="Cek RPJMD"
                isReviewer={isReviewer}
                findingNotes={findingNotes}
                setFindingNotes={setFindingNotes}
                findingBusy={findingBusy}
                onVerify={onVerify}
                onReject={onReject}
              />
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Cross-check BANUA360</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Bukan hasil AI - ini data potensi & BUM Desa milik desa anggota kawasan, diambil langsung dari database BANUA360, untuk dibandingkan reviewer dengan klaim di RPKP.
            </p>
            <FindingCard
              title="Data Potensi & Kelembagaan Desa Anggota"
              finding={banua360Finding}
              busy={banua360Checking}
              locked={checkAllRunning}
              onCheck={handleBanua360Check}
              checkLabel="Jalankan Cross-check"
              isReviewer={isReviewer}
              findingNotes={findingNotes}
              setFindingNotes={setFindingNotes}
              findingBusy={findingBusy}
              onVerify={onVerify}
              onReject={onReject}
            />
          </div>
        </>
      )}

      {tab === 'temuan' && (
        <div className="panel">
          <h2 className="panel-title">Temuan</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>Ringkasan seluruh temuan lintas kategori pada review ini.</p>
          {!findings && <p className="state-msg">Memuat...</p>}
          {findings && findings.length === 0 && <p className="state-msg">Belum ada temuan - buka tab Review untuk menjalankan pemeriksaan.</p>}
          {findings && findings.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Kategori</th><th>Topik</th><th>Status AI</th><th>Status Reviewer</th><th>Diperbarui</th></tr>
                </thead>
                <tbody>
                  {findings.map((f) => (
                    <tr key={f.id}>
                      <td>{f.category}</td>
                      <td>{f.title}</td>
                      <td><SmallBadge className={AI_STATUS_CLASS[f.ai_status]}>{AI_STATUS_LABEL[f.ai_status]}</SmallBadge></td>
                      <td><SmallBadge className={REVIEWER_STATUS_CLASS[f.reviewer_status]}>{REVIEWER_STATUS_LABEL[f.reviewer_status]}</SmallBadge></td>
                      <td>{new Date(f.diperbarui_pada).toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'keputusan' && (
        <div className="panel">
          <h2 className="panel-title">Recommendation Gate</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            Keputusan akhir apakah rekomendasi Provinsi dapat diterbitkan untuk kawasan ini. Ini keputusan reviewer manusia - AI tidak terlibat di sini.
          </p>
          {recommendation && (
            <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'var(--panel-2)' }}>
              <SmallBadge className={KEPUTUSAN_CLASS[recommendation.keputusan]}>{KEPUTUSAN_LABEL[recommendation.keputusan]}</SmallBadge>
              {recommendation.catatan && <p style={{ fontSize: 12.5, margin: '8px 0 0' }}>{recommendation.catatan}</p>}
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                {recommendation.dibuat_oleh} · {new Date(recommendation.dibuat_pada).toLocaleString('id-ID')}
              </p>
            </div>
          )}
          {isReviewer ? (
            <form onSubmit={handleGateSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(KEPUTUSAN_LABEL).map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="radio" name="keputusan" value={key} checked={gateKeputusan === key} onChange={() => setGateKeputusan(key)} />
                    {label}
                  </label>
                ))}
              </div>
              <textarea
                placeholder="Catatan (wajib jika memilih 'dengan catatan' atau 'belum dapat')"
                value={gateCatatan}
                onChange={(e) => setGateCatatan(e.target.value)}
                style={{ width: '100%', minHeight: 70, marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', fontFamily: 'inherit', fontSize: 13 }}
              />
              {gateError && <div className="state-msg state-error" style={{ padding: '8px 0' }}>{gateError}</div>}
              <button
                className="btn"
                type="submit"
                style={{ marginTop: 8 }}
                disabled={gateSaving || (gateKeputusan !== 'DAPAT_DIREKOMENDASIKAN' && !gateCatatan.trim())}
              >
                {gateSaving ? 'Menyimpan...' : recommendation ? 'Perbarui Keputusan' : 'Tetapkan Keputusan'}
              </button>
            </form>
          ) : (
            !recommendation && <p className="state-msg" style={{ padding: 0 }}>Belum ada keputusan - hanya reviewer Provinsi yang bisa menetapkannya.</p>
          )}
        </div>
      )}

      {tab === 'riwayat' && (
        <div className="panel">
          <h2 className="panel-title">Riwayat</h2>
          {!history && <p className="state-msg">Memuat...</p>}
          {history && history.length === 0 && <p className="state-msg">Belum ada riwayat.</p>}
          {history && history.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {history.map((h) => (
                <div key={h.id} style={{ borderLeft: '2px solid var(--border-strong)', paddingLeft: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.detail || h.event_type}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.aktor} · {new Date(h.dibuat_pada).toLocaleString('id-ID')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
