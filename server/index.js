import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from './db.js';
import { getRekomendasi } from './lib/recommend.js';
import { getRekomendasiKabupaten, buildKabupatenContext } from './lib/recommendKabupaten.js';
import {
  bootstrapAdmin,
  generateKode,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  requireAuth,
  requireRole,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  createOAuthState,
  consumeOAuthState,
  findUserByEmail,
  registerWithKode,
  touchLogin,
} from './lib/auth.js';
import { mergeScope, assertDesaAccess, assertKabupatenAccess, assertProvinsiAccess, guard } from './lib/scope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env is optional in dev (e.g. ANTHROPIC_API_KEY not yet configured);
  // routes that need it report a clear error instead of crashing startup.
}
let importInProgress = false;

bootstrapAdmin();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Deliberately NOT process.env.PORT: the dev harness injects PORT=5502 (the
// Vite dev server's port, declared in .claude/launch.json) into this whole
// process tree, which would otherwise make the API steal Vite's port.
const PORT = process.env.API_PORT || 5501;

// ---------- helpers ----------

function filterClauses(query, alias = 'd') {
  const clauses = [];
  const params = [];
  if (query.kabupaten) {
    clauses.push(`${alias}.kabupaten = ?`);
    params.push(query.kabupaten);
  }
  if (query.kode_desa) {
    clauses.push(`${alias}.kode_desa = ?`);
    params.push(query.kode_desa);
  }
  if (query.kecamatan) {
    clauses.push(`${alias}.kecamatan = ?`);
    params.push(query.kecamatan);
  }
  if (query.status) {
    clauses.push(`${alias}.status_desa = ?`);
    params.push(query.status);
  }
  if (query.q) {
    clauses.push(`${alias}.nama_desa LIKE ?`);
    params.push(`%${query.q}%`);
  }
  return { clauses, params };
}

// Builds "WHERE a AND b" (or "" ) from filterClauses, with optional extra
// pre-built conditions (e.g. "d.lat IS NOT NULL") appended.
function whereFromFilters(query, alias = 'd', extraClauses = []) {
  const { clauses, params } = filterClauses(query, alias);
  const all = [...clauses, ...extraClauses];
  return { sql: all.length ? `WHERE ${all.join(' AND ')}` : '', params };
}

function ekonomiSkorSubquery() {
  return `(SELECT skor FROM skor_indikator si WHERE si.kode_desa = d.kode_desa AND si.nama_indikator = 'EKONOMI' LIMIT 1)`;
}

function potensiSektorCountSubquery() {
  return `(SELECT COUNT(DISTINCT sektor) FROM potensi_desa p WHERE p.kode_desa = d.kode_desa AND p.nilai = 'Ada')`;
}

// ---------- auth ----------

function googleRedirectUri(req) {
  // Trust the app's own configured origin over request headers in
  // production (proxies can spoof Host); fall back to same-origin for
  // local dev where API and frontend are on different ports.
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/google/callback`;
}

app.get('/api/auth/google/start', (req, res) => {
  try {
    const state = createOAuthState(req.query.kode ? String(req.query.kode) : null);
    const url = buildGoogleAuthUrl({ redirectUri: googleRedirectUri(req), state });
    res.redirect(url);
  } catch (err) {
    res.status(500).send('Login Google belum dikonfigurasi di server: ' + err.message);
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  const frontendBase = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect(`${frontendBase}/login?error=google_gagal`);

    const kode = consumeOAuthState(String(state || ''));
    const { email, nama } = await exchangeGoogleCode(code, googleRedirectUri(req));

    let user = findUserByEmail(email);
    if (!user) {
      if (!kode) return res.redirect(`${frontendBase}/login?error=belum_terdaftar`);
      try {
        user = registerWithKode(email, nama, kode);
      } catch (err) {
        const reason = err.code === 'CODE_USED' ? 'kode_terpakai' : 'kode_invalid';
        return res.redirect(`${frontendBase}/login?error=${reason}`);
      }
    } else {
      touchLogin(user.id);
    }

    setSessionCookie(res, user);
    res.redirect(`${frontendBase}/`);
  } catch (err) {
    console.error('Google OAuth callback gagal:', err);
    res.redirect(`${frontendBase}/login?error=server`);
  }
});

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum masuk.' });
  res.json(user);
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- admin: manajemen pengguna ----------

app.get('/api/admin/kode-registrasi', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT kr.*, u.email AS dipakai_oleh_email FROM kode_registrasi kr
       LEFT JOIN users u ON u.id = kr.dipakai_oleh_user_id
       ORDER BY kr.id DESC`
    )
    .all();
  res.json(rows);
});

app.post('/api/admin/kode-registrasi', requireAuth, requireRole('admin'), (req, res) => {
  const { role, kode_desa, kabupaten } = req.body || {};
  if (!['desa', 'kabupaten', 'provinsi', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role tidak valid' });
  }
  if (role === 'desa' && !kode_desa) return res.status(400).json({ error: 'kode_desa wajib diisi untuk role desa' });
  if (role === 'kabupaten' && !kabupaten) return res.status(400).json({ error: 'kabupaten wajib diisi untuk role kabupaten' });

  const kode = generateKode();
  db.prepare(
    `INSERT INTO kode_registrasi (kode, role, kode_desa, kabupaten, dibuat_oleh, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(kode, role, role === 'desa' ? kode_desa : null, role === 'kabupaten' ? kabupaten : null, req.user.email, new Date().toISOString());

  res.json({ kode });
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT id, email, nama, role, kode_desa, kabupaten, dibuat_pada, login_terakhir FROM users ORDER BY id DESC').all();
  res.json(rows);
});

// ---------- referensi wilayah ----------

app.get('/api/wilayah/kabupaten', requireAuth, (req, res) => {
  const scoped = mergeScope(req.user, req.query);
  const rows = scoped.kabupaten
    ? [{ kabupaten: scoped.kabupaten }]
    : db.prepare('SELECT DISTINCT kabupaten FROM desa ORDER BY kabupaten').all();
  res.json(rows.map((r) => r.kabupaten));
});

app.get('/api/wilayah/kecamatan', requireAuth, (req, res) => {
  const scoped = mergeScope(req.user, req.query);
  const rows = scoped.kabupaten
    ? db.prepare('SELECT DISTINCT kecamatan FROM desa WHERE kabupaten = ? ORDER BY kecamatan').all(scoped.kabupaten)
    : db.prepare('SELECT DISTINCT kecamatan FROM desa ORDER BY kecamatan').all();
  res.json(rows.map((r) => r.kecamatan));
});

// ---------- dashboard ----------

app.get('/api/dashboard/summary', requireAuth, (req, res) => {
  req.query = mergeScope(req.user, req.query);
  const { sql, params } = whereFromFilters(req.query);
  const totalDesa = db.prepare(`SELECT COUNT(*) AS n FROM desa d ${sql}`).get(...params).n;

  const statusRows = db
    .prepare(`SELECT status_desa, COUNT(*) AS n FROM desa d ${sql} GROUP BY status_desa ORDER BY n DESC`)
    .all(...params);

  const avgEkonomi = db
    .prepare(
      `SELECT AVG(${ekonomiSkorSubquery()}) AS avg_ekonomi FROM desa d ${sql}`
    )
    .get(...params).avg_ekonomi;

  const subDimensiFilter = whereFromFilters(req.query, 'd', [
    `si.sub_dimensi IN ('SUB-DIMENSI PRODUKSI DESA', 'SUB-DIMENSI FASILTAS PENDUKUNG EKONOMI')`,
    `si.nama_indikator = si.sub_dimensi`,
  ]);
  const subDimensiRows = db
    .prepare(
      `SELECT si.sub_dimensi, AVG(si.skor) AS avg_skor
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       ${subDimensiFilter.sql}
       GROUP BY si.sub_dimensi`
    )
    .all(...subDimensiFilter.params);

  res.json({
    totalDesa,
    avgEkonomi: avgEkonomi ? Math.round(avgEkonomi * 100) / 100 : null,
    statusDesa: statusRows,
    subDimensi: subDimensiRows,
  });
});

// ---------- profil / list desa ----------

app.get('/api/desa', requireAuth, (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query));
  const rows = db
    .prepare(
      `SELECT d.kode_desa, d.kabupaten, d.kecamatan, d.nama_desa, d.status_desa, d.lat, d.lng,
              ${ekonomiSkorSubquery()} AS skor_ekonomi,
              ${potensiSektorCountSubquery()} AS jumlah_sektor_potensi
       FROM desa d ${sql}
       ORDER BY d.kabupaten, d.kecamatan, d.nama_desa`
    )
    .all(...params);
  res.json(rows);
});

app.get('/api/desa/:kode', requireAuth, guard((req, res) => {
  const { kode } = req.params;
  assertDesaAccess(req.user, kode);
  const desa = db.prepare('SELECT * FROM desa WHERE kode_desa = ?').get(kode);
  if (!desa) return res.status(404).json({ error: 'Desa tidak ditemukan' });

  // Scoped to EKONOMI - the ProfilDesa page's "Skor Dimensi Ekonomi" panel
  // only understands the 2-subdimensi Ekonomi shape. skor_indikator now also
  // holds the other 5 Permendesa 9/2024 dimensions (see recommendKabupaten.js
  // for the analogous kabupaten/provinsi-level breakdown); exposing them here
  // is deferred until ProfilDesa's UI is extended to show all 6 (roadmap
  // step 6), so this filter is intentional, not a leftover.
  const skor = db
    .prepare(
      `SELECT sub_dimensi, nama_indikator, skor, bobot_maks FROM skor_indikator
       WHERE kode_desa = ? AND dimensi = 'EKONOMI' ORDER BY id`
    )
    .all(kode);

  const potensi = db
    .prepare(
      `SELECT sektor, subsektor, nilai FROM potensi_desa
       WHERE kode_desa = ? AND nilai NOT IN ('Tidak Ada', '-', '') ORDER BY sektor, id`
    )
    .all(kode);

  const ekosistem = db
    .prepare(
      `SELECT komponen, nilai FROM ekosistem_desa
       WHERE kode_desa = ? AND nilai NOT IN ('Tidak Ada', '-', '') ORDER BY id`
    )
    .all(kode);

  const jawaban = db
    .prepare(`SELECT pertanyaan, jawaban FROM jawaban_kuesioner WHERE kode_desa = ? ORDER BY id`)
    .all(kode);

  res.json({ desa, skor, potensi, ekosistem, jawaban });
}));

app.post('/api/desa/:kode/rekomendasi', requireAuth, guard(async (req, res) => {
  assertDesaAccess(req.user, req.params.kode);
  try {
    const result = await getRekomendasi(req.params.kode, { forceRefresh: !!req.body?.forceRefresh });
    if (result.notFound) return res.status(404).json({ error: 'Desa tidak ditemukan' });
    res.json(result);
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({ error: err.message, code: 'NO_API_KEY' });
    }
    console.error('Gagal membuat rekomendasi:', err);
    res.status(500).json({ error: 'Gagal membuat rekomendasi AI: ' + err.message });
  }
}));

app.get('/api/kabupaten/:nama/ringkasan', requireAuth, guard((req, res) => {
  assertKabupatenAccess(req.user, req.params.nama);
  const ctx = buildKabupatenContext(req.params.nama);
  if (!ctx) return res.status(404).json({ error: 'Kabupaten tidak ditemukan' });
  res.json(ctx);
}));

app.post('/api/kabupaten/:nama/rekomendasi', requireAuth, guard(async (req, res) => {
  assertKabupatenAccess(req.user, req.params.nama);
  try {
    const result = await getRekomendasiKabupaten(req.params.nama, { forceRefresh: !!req.body?.forceRefresh });
    if (result.notFound) return res.status(404).json({ error: 'Kabupaten tidak ditemukan' });
    res.json(result);
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({ error: err.message, code: 'NO_API_KEY' });
    }
    console.error('Gagal membuat analisis kabupaten:', err);
    res.status(500).json({ error: 'Gagal membuat analisis AI: ' + err.message });
  }
}));

// Province-wide view of the same BUM Desa analysis - same context builder
// with kabupaten=null, only admin/provinsi may reach it.
app.get('/api/provinsi/ringkasan', requireAuth, guard((req, res) => {
  assertProvinsiAccess(req.user);
  const ctx = buildKabupatenContext(null);
  if (!ctx) return res.status(404).json({ error: 'Data provinsi tidak ditemukan' });
  res.json(ctx);
}));

app.post('/api/provinsi/rekomendasi', requireAuth, guard(async (req, res) => {
  assertProvinsiAccess(req.user);
  try {
    const result = await getRekomendasiKabupaten(null, { forceRefresh: !!req.body?.forceRefresh });
    if (result.notFound) return res.status(404).json({ error: 'Data provinsi tidak ditemukan' });
    res.json(result);
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({ error: err.message, code: 'NO_API_KEY' });
    }
    console.error('Gagal membuat analisis provinsi:', err);
    res.status(500).json({ error: 'Gagal membuat analisis AI: ' + err.message });
  }
}));

// ---------- potensi sektor ----------

// "nilai = 'Ada'" isolates genuine yes/no existence answers (e.g. "Terdapat
// Budidaya Udang Air Laut" -> "Ada"). Rekap Isu also has many non-boolean
// follow-up columns per sector (counts, distances, species names, ...); a
// looser "not blank / not Tidak Ada" filter counts nearly every desa for
// nearly every sector/subsektor, since some follow-up answer (even "0") is
// almost always present. Used for both the sector cards and the subsektor
// breakdown so the numbers stay consistent and comparable.
const ADA_FILTER = `nilai = 'Ada'`;

app.get('/api/potensi/sektor', requireAuth, (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query), 'd');
  const extra = sql ? `${sql} AND` : 'WHERE';
  const rows = db
    .prepare(
      `SELECT p.sektor, COUNT(DISTINCT p.kode_desa) AS jumlah_desa
       FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       ${extra} p.${ADA_FILTER}
       GROUP BY p.sektor ORDER BY jumlah_desa DESC`
    )
    .all(...params);
  res.json(rows);
});

app.get('/api/potensi/sektor/:sektor', requireAuth, (req, res) => {
  const { sektor } = req.params;
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query), 'd');
  const extra = sql ? `${sql} AND` : 'WHERE';
  const rows = db
    .prepare(
      `SELECT DISTINCT d.kode_desa, d.kabupaten, d.kecamatan, d.nama_desa, d.status_desa
       FROM desa d
       JOIN potensi_desa p ON p.kode_desa = d.kode_desa
       ${extra} p.sektor = ? AND p.${ADA_FILTER}
       ORDER BY d.kabupaten, d.kecamatan, d.nama_desa`
    )
    .all(...params, sektor);

  const subsektorFilter = whereFromFilters(mergeScope(req.user, req.query), 'd', [
    'p.sektor = ?',
    `p.${ADA_FILTER}`,
  ]);
  const subsektor = db
    .prepare(
      `SELECT p.subsektor, COUNT(DISTINCT p.kode_desa) AS jumlah_desa
       FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       ${subsektorFilter.sql}
       GROUP BY p.subsektor ORDER BY jumlah_desa DESC LIMIT 40`
    )
    .all(...subsektorFilter.params, sektor);

  res.json({ sektor, jumlahDesa: rows.length, desa: rows, subsektor });
});

// ---------- ekosistem ----------

app.get('/api/ekosistem/summary', requireAuth, (req, res) => {
  const filter = whereFromFilters(mergeScope(req.user, req.query), 'd', [
    `e.nilai NOT IN ('Tidak Ada', '-', '', '0')`,
  ]);
  const rows = db
    .prepare(
      `SELECT e.komponen, COUNT(DISTINCT e.kode_desa) AS jumlah_desa
       FROM ekosistem_desa e
       JOIN desa d ON d.kode_desa = e.kode_desa
       ${filter.sql}
       GROUP BY e.komponen ORDER BY jumlah_desa DESC LIMIT 30`
    )
    .all(...filter.params);
  res.json(rows);
});

// ---------- peta ----------

app.get('/api/peta', requireAuth, (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query), 'd', [
    'd.lat IS NOT NULL',
    'd.lng IS NOT NULL',
  ]);
  const rows = db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kabupaten, d.kecamatan, d.status_desa, d.lat, d.lng,
              ${ekonomiSkorSubquery()} AS skor_ekonomi
       FROM desa d ${sql}`
    )
    .all(...params);
  res.json(rows);
});

// ---------- analisis kuadran (potensi x kinerja) ----------

app.get('/api/analisis/kuadran', requireAuth, (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query));
  const rows = db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kabupaten, d.kecamatan, d.status_desa,
              ${ekonomiSkorSubquery()} AS kinerja,
              ${potensiSektorCountSubquery()} AS potensi
       FROM desa d ${sql}`
    )
    .all(...params)
    .filter((r) => r.kinerja !== null);

  const kinerjaVals = rows.map((r) => r.kinerja).sort((a, b) => a - b);
  const potensiVals = rows.map((r) => r.potensi).sort((a, b) => a - b);
  const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
  const kinerjaMedian = median(kinerjaVals);
  const potensiMedian = median(potensiVals);

  const withKuadran = rows.map((r) => {
    const potensiTinggi = r.potensi >= potensiMedian;
    const kinerjaTinggi = r.kinerja >= kinerjaMedian;
    let kuadran;
    if (potensiTinggi && kinerjaTinggi) kuadran = 'I - Potensi Tinggi, Kinerja Tinggi';
    else if (potensiTinggi && !kinerjaTinggi) kuadran = 'II - Potensi Tinggi, Kinerja Rendah';
    else if (!potensiTinggi && !kinerjaTinggi) kuadran = 'III - Potensi Rendah, Kinerja Rendah';
    else kuadran = 'IV - Potensi Rendah, Kinerja Tinggi';
    return { ...r, kuadran };
  });

  res.json({ kinerjaMedian, potensiMedian, desa: withKuadran });
});

// ---------- import (admin) ----------

app.get('/api/import/log', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db
    .prepare('SELECT sumber_file, sheet, waktu_import, jumlah_baris FROM import_log ORDER BY id DESC')
    .all();
  res.json(rows);
});

app.post('/api/import/run', requireAuth, requireRole('admin'), (req, res) => {
  if (importInProgress) {
    return res.status(409).json({ error: 'Import lain sedang berjalan, coba lagi sebentar.' });
  }
  importInProgress = true;
  const scriptPath = path.join(__dirname, 'scripts', 'import-excel.js');
  const child = fork(scriptPath, [], { stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });
  child.on('exit', (code) => {
    importInProgress = false;
    if (code === 0) res.json({ ok: true, log: output });
    else res.status(500).json({ ok: false, error: 'Import gagal', log: output });
  });
});

// ---------- production static serving ----------
// In dev, Vite serves web/ separately (see .claude/launch.json) and proxies
// /api to this server. In production there's no Vite process - this same
// Express server also serves the built frontend, so the whole app is one
// process on one port (what Railway and similar host-by-port platforms
// expect). Must be registered after every /api/* route above, since the SPA
// fallback below would otherwise swallow them.
if (process.env.NODE_ENV === 'production') {
  const webDist = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

// Railway (and most host-by-port platforms) inject PORT and expect the app
// to bind to exactly that port; API_PORT is only for local dev, where the
// harness's own PORT=5502 belongs to the separate Vite process instead.
const LISTEN_PORT = process.env.NODE_ENV === 'production' ? process.env.PORT || PORT : PORT;

app.listen(LISTEN_PORT, () => {
  console.log(`API berjalan di http://localhost:${LISTEN_PORT}`);
});
