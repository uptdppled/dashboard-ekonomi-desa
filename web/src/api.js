async function get(path) {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request gagal (${res.status})`);
    err.code = body.code;
    throw err;
  }
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(payload.error || `Request gagal (${res.status})`);
    err.code = payload.code;
    throw err;
  }
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(payload.error || `Request gagal (${res.status})`);
    err.code = payload.code;
    throw err;
  }
  return res.json();
}

// No Content-Type header here - the browser sets the multipart boundary
// itself when the body is a FormData instance.
async function postForm(path, formData) {
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: formData });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(payload.error || `Request gagal (${res.status})`);
    err.code = payload.code;
    throw err;
  }
  return res.json();
}

export const api = {
  kabupaten: () => get('/wilayah/kabupaten'),
  kecamatan: (kabupaten) => get(`/wilayah/kecamatan${kabupaten ? `?kabupaten=${encodeURIComponent(kabupaten)}` : ''}`),
  dashboardSummary: (params) => get(`/dashboard/summary?${new URLSearchParams(params)}`),
  indeksRingkasan: (params) => get(`/indeks/ringkasan?${new URLSearchParams(params)}`),
  indeksNarasi: (scope, forceRefresh) => post('/indeks/narasi', { ...scope, forceRefresh: !!forceRefresh }),
  indeksDimensi: (dimensi, params) => get(`/indeks/dimensi/${encodeURIComponent(dimensi)}?${new URLSearchParams(params)}`),
  insightRingkasan: (params) => get(`/insight/ringkasan?${new URLSearchParams(params)}`),
  insightGapDesa: (params) => get(`/insight/gap/desa?${new URLSearchParams(params)}`),
  insightTanpaKoordinat: (params) => get(`/insight/tanpa-koordinat?${new URLSearchParams(params)}`),
  insightNaikStatus: (params) => get(`/insight/naik-status?${new URLSearchParams(params)}`),
  opportunityCoverage: (params) => get(`/opportunity/coverage?${new URLSearchParams(params)}`),
  opportunityKawasan: (params) => get(`/opportunity/kawasan?${new URLSearchParams(params)}`),
  opportunityPotensiPotensi: (params) => get(`/opportunity/potensi-potensi?${new URLSearchParams(params)}`),
  opportunityProduksiAksesPasar: (params) => get(`/opportunity/produksi-akses-pasar?${new URLSearchParams(params)}`),
  opportunityDesaDesa: (params) => get(`/opportunity/desa-desa?${new URLSearchParams(params)}`),
  opportunityBumDesaPotensi: (params) => get(`/opportunity/bumdesa-potensi?${new URLSearchParams(params)}`),
  definisiSkor: () => get('/referensi/definisi-skor'),
  definisiPotensi: () => get('/referensi/definisi-potensi'),
  desaList: (params) => get(`/desa?${new URLSearchParams(params)}`),
  desaProfil: (kode) => get(`/desa/${kode}`),
  potensiSektor: () => get('/potensi/sektor'),
  potensiSektorDetail: (sektor, params) => get(`/potensi/sektor/${encodeURIComponent(sektor)}?${new URLSearchParams(params)}`),
  ekosistemSummary: () => get('/ekosistem/summary'),
  ekosistemDesa: (komponen, params) => get(`/ekosistem/desa?${new URLSearchParams({ ...params, komponen })}`),
  peta: (params) => get(`/peta?${new URLSearchParams(params)}`),
  petaIndikator: () => get('/peta/indikator'),
  analisisKuadran: (params) => get(`/analisis/kuadran?${new URLSearchParams(params)}`),
  importLog: () => get('/import/log'),
  importRun: () => post('/import/run'),
  rekomendasi: (kode, forceRefresh) => post(`/desa/${kode}/rekomendasi`, { forceRefresh: !!forceRefresh }),
  narasiDesa: (kode, dimensi, forceRefresh) => post(`/desa/${kode}/narasi`, { dimensi: dimensi || null, forceRefresh: !!forceRefresh }),
  ringkasanKabupaten: (nama) => get(`/kabupaten/${encodeURIComponent(nama)}/ringkasan`),
  rekomendasiKabupaten: (nama, forceRefresh) =>
    post(`/kabupaten/${encodeURIComponent(nama)}/rekomendasi`, { forceRefresh: !!forceRefresh }),
  desaKomponenKabupaten: (nama, komponen, value) =>
    get(`/kabupaten/${encodeURIComponent(nama)}/desa-komponen?${new URLSearchParams({ komponen, value })}`),
  ringkasanProvinsi: () => get('/provinsi/ringkasan'),
  rekomendasiProvinsi: (forceRefresh) => post('/provinsi/rekomendasi', { forceRefresh: !!forceRefresh }),
  desaKomponenProvinsi: (komponen, value) => get(`/provinsi/desa-komponen?${new URLSearchParams({ komponen, value })}`),
  kodeRegistrasiList: () => get('/admin/kode-registrasi'),
  kodeRegistrasiBuat: (data) => post('/admin/kode-registrasi', data),
  usersList: () => get('/admin/users'),
  devConfig: () => get('/auth/dev-config'),
  devLogin: (role) => post('/auth/dev-login', { role }),
  rpkpReviews: (params) => get(`/rpkp/reviews?${new URLSearchParams(params)}`),
  rpkpReviewCreate: (data) => post('/rpkp/reviews', data),
  rpkpReview: (id) => get(`/rpkp/reviews/${id}`),
  rpkpDocuments: (id) => get(`/rpkp/reviews/${id}/documents`),
  rpkpDocumentUpload: (id, formData) => postForm(`/rpkp/reviews/${id}/documents`, formData),
  rpkpDocumentFileUrl: (reviewId, docId) => `/api/rpkp/reviews/${reviewId}/documents/${docId}/file`,
  rpkpHistory: (id) => get(`/rpkp/reviews/${id}/history`),
  rpkpStatus: (id, status, note) => post(`/rpkp/reviews/${id}/status`, { status, note }),
  rpkpAiAsk: (id, question) => post(`/rpkp/reviews/${id}/ai/ask`, { question }),
  rpkpAiQaList: (id) => get(`/rpkp/reviews/${id}/ai/qa`),
  rpkpCompletenessItems: () => get('/rpkp/completeness-items'),
  rpkpFindings: (id, category) => get(`/rpkp/reviews/${id}/findings${category ? `?category=${category}` : ''}`),
  rpkpCompletenessCheck: (id, kode) => post(`/rpkp/reviews/${id}/completeness/${kode}/check`),
  rpkpChecklistItems: (kategori) => get(`/rpkp/checklist-items?kategori=${kategori}`),
  rpkpChecklistCheck: (id, kode) => post(`/rpkp/reviews/${id}/checklist/${kode}/check`),
  rpkpFindingVerify: (findingId, note) => post(`/rpkp/findings/${findingId}/verify`, { note }),
  rpkpFindingReject: (findingId, note) => post(`/rpkp/findings/${findingId}/reject`, { note }),
  rpkpRecommendation: (id) => get(`/rpkp/reviews/${id}/recommendation`),
  rpkpRecommendationSet: (id, keputusan, catatan) => post(`/rpkp/reviews/${id}/recommendation`, { keputusan, catatan }),
  rpkpReviewDesa: (id) => get(`/rpkp/reviews/${id}/desa`),
  rpkpReviewDesaSet: (id, kodeDesaList) => put(`/rpkp/reviews/${id}/desa`, { kodeDesaList }),
  rpkpRtrwCheck: (id) => post(`/rpkp/reviews/${id}/rtrw/check`),
  rpkpRpjmdCheck: (id) => post(`/rpkp/reviews/${id}/rpjmd/check`),
  rpkpBanua360Check: (id) => post(`/rpkp/reviews/${id}/banua360/check`),
};
