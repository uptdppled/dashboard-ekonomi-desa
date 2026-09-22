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

export const api = {
  kabupaten: () => get('/wilayah/kabupaten'),
  kecamatan: (kabupaten) => get(`/wilayah/kecamatan${kabupaten ? `?kabupaten=${encodeURIComponent(kabupaten)}` : ''}`),
  dashboardSummary: (params) => get(`/dashboard/summary?${new URLSearchParams(params)}`),
  indeksRingkasan: (params) => get(`/indeks/ringkasan?${new URLSearchParams(params)}`),
  insightRingkasan: (params) => get(`/insight/ringkasan?${new URLSearchParams(params)}`),
  insightGapDesa: (params) => get(`/insight/gap/desa?${new URLSearchParams(params)}`),
  insightTanpaKoordinat: (params) => get(`/insight/tanpa-koordinat?${new URLSearchParams(params)}`),
  desaList: (params) => get(`/desa?${new URLSearchParams(params)}`),
  desaProfil: (kode) => get(`/desa/${kode}`),
  potensiSektor: () => get('/potensi/sektor'),
  potensiSektorDetail: (sektor, params) => get(`/potensi/sektor/${encodeURIComponent(sektor)}?${new URLSearchParams(params)}`),
  ekosistemSummary: () => get('/ekosistem/summary'),
  peta: (params) => get(`/peta?${new URLSearchParams(params)}`),
  analisisKuadran: (params) => get(`/analisis/kuadran?${new URLSearchParams(params)}`),
  importLog: () => get('/import/log'),
  importRun: () => post('/import/run'),
  rekomendasi: (kode, forceRefresh) => post(`/desa/${kode}/rekomendasi`, { forceRefresh: !!forceRefresh }),
  ringkasanKabupaten: (nama) => get(`/kabupaten/${encodeURIComponent(nama)}/ringkasan`),
  rekomendasiKabupaten: (nama, forceRefresh) =>
    post(`/kabupaten/${encodeURIComponent(nama)}/rekomendasi`, { forceRefresh: !!forceRefresh }),
  ringkasanProvinsi: () => get('/provinsi/ringkasan'),
  rekomendasiProvinsi: (forceRefresh) => post('/provinsi/rekomendasi', { forceRefresh: !!forceRefresh }),
  kodeRegistrasiList: () => get('/admin/kode-registrasi'),
  kodeRegistrasiBuat: (data) => post('/admin/kode-registrasi', data),
  usersList: () => get('/admin/users'),
};
