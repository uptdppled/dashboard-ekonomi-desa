import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from './db.js';
import { getRekomendasi } from './lib/recommend.js';
import { getNarasiDesa, DIMENSI_KEYS } from './lib/narasiDesa.js';
import { getNarasiIndeks, DIMENSI_KEYS as INDEKS_DIMENSI_KEYS } from './lib/narasiIndeks.js';
import { categorizePotensiKelompok } from './lib/categorizePotensi.js';
import { allDefinisiSkor, allDefinisiPotensi } from './lib/definisiIndikator.js';
import {
  getRekomendasiKabupaten,
  buildKabupatenContext,
  listDesaByBumTier,
  listDesaByKdmpStatus,
} from './lib/recommendKabupaten.js';
import {
  buildGapAnalysis,
  listDesaGapUntukIndikator,
  buildPotensiPengembangan,
  buildCoverage,
  buildKandidatNaikStatus,
  listDesaTanpaKoordinat,
} from './lib/insight.js';
import { classifyKuadran } from './lib/kuadran.js';
import {
  buildPotensiKawasan,
  buildPotensiPotensi,
  buildProduksiAksesPasar,
  buildDesaKeDesa,
  buildBumDesaPotensi,
} from './lib/opportunity.js';
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
  devLoginAllowed,
  findOrCreateDevUser,
} from './lib/auth.js';
import { mergeScope, assertDesaAccess, assertKabupatenAccess, assertProvinsiAccess, guard } from './lib/scope.js';
import multer from 'multer';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  DOCUMENT_TYPES,
  assertReviewAccess,
  listReviews,
  getReview,
  createReview,
  listDocuments,
  getDocument,
  addDocument,
  reviewUploadDir,
  changeStatus,
  listHistory,
  listReviewDesa,
  setReviewDesa,
} from './lib/rpkp.js';
import {
  askDocumentAssistant,
  checkCompletenessItem,
  checkChecklistItem,
  checkRtrwAlignment,
  checkRpjmdAlignment,
  saveQa,
  listQa,
} from './lib/rpkpAi.js';
import {
  listCompletenessItems,
  getCompletenessItem,
  listChecklistItems,
  getChecklistItem,
  listFindings,
  upsertCompletenessFinding,
  upsertChecklistFinding,
  upsertFinding,
  checkBanua360CrossCheck,
  getFinding,
  verifyFinding,
  rejectFinding,
  getRecommendation,
  setRecommendation,
} from './lib/rpkpFindings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env is optional in dev (e.g. ANTHROPIC_API_KEY not yet configured);
  // routes that need it report a clear error instead of crashing startup.
}
let importInProgress = false;

await bootstrapAdmin();

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

app.get('/api/auth/google/callback', guard(async (req, res) => {
  const frontendBase = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect(`${frontendBase}/login?error=google_gagal`);

    const kode = consumeOAuthState(String(state || ''));
    const { email, nama } = await exchangeGoogleCode(code, googleRedirectUri(req));

    let user = await findUserByEmail(email);
    if (!user) {
      if (!kode) return res.redirect(`${frontendBase}/login?error=belum_terdaftar`);
      try {
        user = await registerWithKode(email, nama, kode);
      } catch (err) {
        const reason = err.code === 'CODE_USED' ? 'kode_terpakai' : 'kode_invalid';
        return res.redirect(`${frontendBase}/login?error=${reason}`);
      }
    } else {
      await touchLogin(user.id);
    }

    setSessionCookie(res, user);
    res.redirect(`${frontendBase}/`);
  } catch (err) {
    console.error('Google OAuth callback gagal:', err);
    res.redirect(`${frontendBase}/login?error=server`);
  }
}));

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum masuk.' });
  res.json(user);
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/dev-config', (req, res) => {
  res.json({ devLoginEnabled: devLoginAllowed() });
});

// Supabase menjeda project free tier setelah 7 hari tanpa permintaan ke
// DATABASE-nya - bukan tanpa kunjungan ke aplikasi. Dashboard pemda memang
// bisa sepi seminggu penuh, dan project yang dijeda harus dibangunkan manual
// dari dashboard Supabase. Cron harian di Vercel memanggil endpoint ini
// (lihat crons di scripts/build-vercel.mjs), dan query remeh di bawah sudah
// cukup untuk dihitung sebagai aktivitas.
//
// Sengaja TIDAK di belakang requireAuth: pemanggilnya cron, bukan pengguna.
// Kalau CRON_SECRET diisi, Vercel mengirimkannya sebagai bearer token dan
// endpoint ini menolak pemanggil lain.
app.get('/api/keep-alive', guard(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('authorization') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Tidak diizinkan.' });
  }
  // dbMs diukur terpisah dari total waktu request: ia jarak fungsi ke
  // database, dan itulah angka yang menentukan region mana yang tepat -
  // karena satu halaman menembak beberapa query berurutan, ongkos ini
  // dikalikan, sedangkan jarak pengguna ke fungsi dibayar sekali saja.
  const t0 = performance.now();
  const row = await db.prepare('SELECT 1 AS hidup').get();
  const dbMs = Math.round(performance.now() - t0);
  res.json({
    ok: row?.hidup === 1,
    dbMs,
    region: process.env.VERCEL_REGION ?? null,
    waktu: new Date().toISOString(),
  });
}));

app.post('/api/auth/dev-login', guard(async (req, res) => {
  if (!devLoginAllowed()) return res.status(403).json({ error: 'Mode uji coba tidak tersedia.' });
  const { role } = req.body || {};
  if (!['admin', 'provinsi', 'kabupaten', 'desa'].includes(role)) {
    return res.status(400).json({ error: 'Role tidak valid.' });
  }
  const user = await findOrCreateDevUser(role);
  setSessionCookie(res, user);
  res.json({ ok: true, user });
}));

// ---------- admin: manajemen pengguna ----------

app.get('/api/admin/kode-registrasi', requireAuth, requireRole('admin'), guard(async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT kr.*, u.email AS dipakai_oleh_email FROM kode_registrasi kr
       LEFT JOIN users u ON u.id = kr.dipakai_oleh_user_id
       ORDER BY kr.id DESC`
    )
    .all();
  res.json(rows);
}));

app.post('/api/admin/kode-registrasi', requireAuth, requireRole('admin'), guard(async (req, res) => {
  const { role, kode_desa, kabupaten } = req.body || {};
  if (!['desa', 'kabupaten', 'provinsi', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role tidak valid' });
  }
  if (role === 'desa' && !kode_desa) return res.status(400).json({ error: 'kode_desa wajib diisi untuk role desa' });
  if (role === 'kabupaten' && !kabupaten) return res.status(400).json({ error: 'kabupaten wajib diisi untuk role kabupaten' });

  const kode = generateKode();
  await db.prepare(
    `INSERT INTO kode_registrasi (kode, role, kode_desa, kabupaten, dibuat_oleh, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(kode, role, role === 'desa' ? kode_desa : null, role === 'kabupaten' ? kabupaten : null, req.user.email, new Date().toISOString());

  res.json({ kode });
}));

app.get('/api/admin/users', requireAuth, requireRole('admin'), guard(async (req, res) => {
  const rows = await db.prepare('SELECT id, email, nama, role, kode_desa, kabupaten, dibuat_pada, login_terakhir FROM users ORDER BY id DESC').all();
  res.json(rows);
}));

// ---------- referensi wilayah ----------

app.get('/api/wilayah/kabupaten', requireAuth, guard(async (req, res) => {
  const scoped = mergeScope(req.user, req.query);
  const rows = scoped.kabupaten
    ? [{ kabupaten: scoped.kabupaten }]
    : await db.prepare('SELECT DISTINCT kabupaten FROM desa ORDER BY kabupaten').all();
  res.json(rows.map((r) => r.kabupaten));
}));

app.get('/api/wilayah/kecamatan', requireAuth, guard(async (req, res) => {
  const scoped = mergeScope(req.user, req.query);
  const rows = scoped.kabupaten
    ? await db.prepare('SELECT DISTINCT kecamatan FROM desa WHERE kabupaten = ? ORDER BY kecamatan').all(scoped.kabupaten)
    : await db.prepare('SELECT DISTINCT kecamatan FROM desa ORDER BY kecamatan').all();
  res.json(rows.map((r) => r.kecamatan));
}));

// ---------- dashboard ----------

app.get('/api/dashboard/summary', requireAuth, guard(async (req, res) => {
  req.query = mergeScope(req.user, req.query);
  const { sql, params } = whereFromFilters(req.query);
  const totalDesa = (await db.prepare(`SELECT COUNT(*) AS n FROM desa d ${sql}`).get(...params)).n;

  const statusRows = await db
    .prepare(`SELECT status_desa, COUNT(*) AS n FROM desa d ${sql} GROUP BY status_desa ORDER BY n DESC`)
    .all(...params);

  const avgEkonomi = (await db
    .prepare(
      `SELECT AVG(${ekonomiSkorSubquery()}) AS avg_ekonomi FROM desa d ${sql}`
    )
    .get(...params)).avg_ekonomi;

  const subDimensiFilter = whereFromFilters(req.query, 'd', [
    `si.sub_dimensi IN ('SUB-DIMENSI PRODUKSI DESA', 'SUB-DIMENSI FASILTAS PENDUKUNG EKONOMI')`,
    `si.nama_indikator = si.sub_dimensi`,
  ]);
  const subDimensiRows = await db
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
}));

// ---------- indeks desa (6 dimensi, Permendesa 9/2024) ----------

app.get('/api/indeks/ringkasan', requireAuth, guard(async (req, res) => {
  req.query = mergeScope(req.user, req.query);
  const { sql, params } = whereFromFilters(req.query);
  const totalDesa = (await db.prepare(`SELECT COUNT(*) AS n FROM desa d ${sql}`).get(...params)).n;

  const statusRows = await db
    .prepare(`SELECT status_desa, COUNT(*) AS n FROM desa d ${sql} GROUP BY status_desa ORDER BY n DESC`)
    .all(...params);

  const avgNilaiIndeks = (await db
    .prepare(`SELECT AVG(nilai_indeks_desa) AS avg_nilai FROM desa d ${sql}`)
    .get(...params)).avg_nilai;

  // Each dimension's own composite score is stored as a row where
  // nama_indikator = dimensi (same convention as sub_dimensi's composite
  // rows, see recommendKabupaten.js's buildKabupatenContext).
  const dimensiFilter = whereFromFilters(req.query, 'd', [`si.nama_indikator = si.dimensi`]);
  const dimensiRows = await db
    .prepare(
      `SELECT si.dimensi, AVG(si.skor) AS avg_skor
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       ${dimensiFilter.sql}
       GROUP BY si.dimensi`
    )
    .all(...dimensiFilter.params);

  res.json({
    totalDesa,
    statusDesa: statusRows,
    avgNilaiIndeks: avgNilaiIndeks !== null ? Math.round(avgNilaiIndeks * 100) / 100 : null,
    dimensi: dimensiRows.map((r) => ({ dimensi: r.dimensi, avgSkor: Math.round(r.avg_skor * 100) / 100 })),
  });
}));

app.post('/api/indeks/narasi', requireAuth, guard(async (req, res) => {
  const dimensi = req.body?.dimensi || null;
  if (dimensi && !INDEKS_DIMENSI_KEYS.has(dimensi)) {
    return res.status(400).json({ error: 'Dimensi tidak valid.' });
  }
  const scope = mergeScope(req.user, req.body || {});
  const query = {
    dimensi: dimensi || undefined,
    kabupaten: scope.kabupaten || undefined,
    kecamatan: scope.kecamatan || undefined,
    status: scope.status || undefined,
  };
  (await getNarasiIndeks(query, { forceRefresh: !!req.body?.forceRefresh }))
    .then((result) => res.json(result))
    .catch((err) => {
      if (err.code === 'NO_API_KEY') {
        return res.status(503).json({ error: err.message, code: 'NO_API_KEY' });
      }
      console.error('Gagal membuat narasi BANUA INDEX:', err);
      res.status(500).json({ error: 'Gagal membuat narasi AI: ' + err.message });
    });
}));

// Detail for a single dimension (BANUA INDEX submenu) - down to individual
// "SKOR ..." indicators, generalizing the old Ekonomi-only page to all 6
// dimensions. `dimensi` is a path param (arbitrary client input), so it's
// always bound as a query parameter, never interpolated into SQL text.
app.get('/api/indeks/dimensi/:dimensi', requireAuth, guard(async (req, res) => {
  const { dimensi } = req.params;
  req.query = mergeScope(req.user, req.query);
  const { sql: baseSql, params: baseParams } = whereFromFilters(req.query);
  const totalDesa = (await db.prepare(`SELECT COUNT(*) AS n FROM desa d ${baseSql}`).get(...baseParams)).n;

  const { clauses: scopeClauses, params: scopeParams } = filterClauses(req.query, 'd');
  const scopeAnd = scopeClauses.length ? `AND ${scopeClauses.join(' AND ')}` : '';

  const avgSkorRow = await db
    .prepare(
      `SELECT AVG(si.skor) avg_skor FROM skor_indikator si JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.dimensi = ? AND si.nama_indikator = si.dimensi ${scopeAnd}`
    )
    .get(dimensi, ...scopeParams);

  const subDimensiRows = await db
    .prepare(
      `SELECT si.sub_dimensi, AVG(si.skor) avg_skor FROM skor_indikator si JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.dimensi = ? AND si.nama_indikator = si.sub_dimensi ${scopeAnd}
       GROUP BY si.sub_dimensi`
    )
    .all(dimensi, ...scopeParams);

  const indikatorRows = await db
    .prepare(
      `SELECT si.sub_dimensi, si.nama_indikator, AVG(si.skor) avg_skor, AVG(si.bobot_maks) avg_bobot
       FROM skor_indikator si JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.dimensi = ? AND si.nama_indikator LIKE 'SKOR %' ${scopeAnd}
       GROUP BY si.sub_dimensi, si.nama_indikator
       ORDER BY si.sub_dimensi, si.nama_indikator`
    )
    .all(dimensi, ...scopeParams);

  // Worst-scoring 12 desa on this dimension's composite score - a curated
  // "desa prioritas" list (same idea as recommendKabupaten.js's priorityDesa)
  // instead of dumping every desa, which is what made this page unusable
  // for actually spotting a problem.
  const desaTerendah = (await db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kabupaten, d.kecamatan, d.status_desa,
              (SELECT skor FROM skor_indikator si2 WHERE si2.kode_desa = d.kode_desa
                 AND si2.dimensi = ? AND si2.nama_indikator = si2.dimensi LIMIT 1) AS skor_dimensi
       FROM desa d ${baseSql}`
    )
    .all(dimensi, ...baseParams))
    .filter((r) => r.skor_dimensi !== null)
    .sort((a, b) => a.skor_dimensi - b.skor_dimensi)
    .slice(0, 12);

  // Sorted worst-first (lowest ratio of skor/bobot_maks) so the indicators
  // that most need attention are what the user sees first, not an
  // alphabetical/insertion-order dump. GAP_THRESHOLD matches insight.js.
  const GAP_THRESHOLD = 0.6;
  const indikatorWithRatio = indikatorRows
    .map((r) => ({
      subDimensi: r.sub_dimensi,
      indikator: r.nama_indikator,
      avgSkor: Math.round(r.avg_skor * 100) / 100,
      avgBobot: Math.round(r.avg_bobot * 100) / 100,
      ratio: r.avg_bobot ? r.avg_skor / r.avg_bobot : null,
    }))
    .sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1));

  res.json({
    dimensi,
    totalDesa,
    avgSkor: avgSkorRow.avg_skor !== null ? Math.round(avgSkorRow.avg_skor * 100) / 100 : null,
    subDimensiRows: subDimensiRows.map((r) => ({ subDimensi: r.sub_dimensi, avgSkor: Math.round(r.avg_skor * 100) / 100 })),
    indikatorRows: indikatorWithRatio,
    jumlahIndikatorGap: indikatorWithRatio.filter((r) => r.ratio !== null && r.ratio < GAP_THRESHOLD).length,
    desaTerendah,
  });
}));

// ---------- BANUA INSIGHT (Phase 1: Gap Analysis, Potensi Pengembangan -
// deterministic, no AI, no invented scores; see server/lib/insight.js.
// Spatial Matching itself moved to BANUA OPPORTUNITY, see /api/opportunity/*
// below - `coverage` here is direct COUNT queries via buildCoverage(), not
// a byproduct of running that matching engine) ----------

app.get('/api/insight/ringkasan', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  const gapAnalysis = await buildGapAnalysis(scope);
  const potensiPengembangan = await buildPotensiPengembangan(scope);
  const coverage = await buildCoverage(scope);

  res.json({
    coverage,
    gapAnalysis,
    potensiPengembangan,
  });
}));

app.get('/api/insight/gap/desa', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  const { indikator } = req.query;
  if (!indikator) return res.status(400).json({ error: 'Parameter indikator wajib diisi' });
  res.json(await listDesaGapUntukIndikator(scope, indikator));
}));

app.get('/api/insight/tanpa-koordinat', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await listDesaTanpaKoordinat(scope));
}));

app.get('/api/insight/naik-status', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await buildKandidatNaikStatus(scope));
}));

// ---------- BANUA OPPORTUNITY (deterministic, no AI - see
// server/lib/opportunity.js: one shared matching engine, 5 tabs each with
// its own relationship rule + honest checklist, never an invented score) ----------

app.get('/api/opportunity/coverage', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  const { sql, params } = whereFromFilters(scope);
  const totalDesa = (await db.prepare(`SELECT COUNT(*) AS n FROM desa d ${sql}`).get(...params)).n;
  const desaDenganKoordinat = (await db
    .prepare(`SELECT COUNT(*) AS n FROM desa d ${sql ? `${sql} AND` : 'WHERE'} d.lat IS NOT NULL AND d.lng IS NOT NULL`)
    .get(...params)).n;
  res.json({ totalDesa, desaDenganKoordinat, desaTanpaKoordinat: totalDesa - desaDenganKoordinat });
}));

app.get('/api/opportunity/kawasan', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await buildPotensiKawasan(scope));
}));

app.get('/api/opportunity/potensi-potensi', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await buildPotensiPotensi(scope));
}));

app.get('/api/opportunity/produksi-akses-pasar', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await buildProduksiAksesPasar(scope));
}));

app.get('/api/opportunity/desa-desa', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await buildDesaKeDesa(scope));
}));

app.get('/api/opportunity/bumdesa-potensi', requireAuth, guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await buildBumDesaPotensi(scope));
}));

// ---------- profil / list desa ----------

app.get('/api/desa', requireAuth, guard(async (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query));
  const rows = await db
    .prepare(
      `SELECT d.kode_desa, d.kabupaten, d.kecamatan, d.nama_desa, d.status_desa, d.lat, d.lng,
              ${ekonomiSkorSubquery()} AS skor_ekonomi,
              ${potensiSektorCountSubquery()} AS jumlah_sektor_potensi
       FROM desa d ${sql}
       ORDER BY d.kabupaten, d.kecamatan, d.nama_desa`
    )
    .all(...params);
  res.json(rows);
}));

app.get('/api/desa/:kode', requireAuth, guard(async (req, res) => {
  const { kode } = req.params;
  await assertDesaAccess(req.user, kode);
  const desa = await db.prepare('SELECT * FROM desa WHERE kode_desa = ?').get(kode);
  if (!desa) return res.status(404).json({ error: 'Desa tidak ditemukan' });

  // Scoped to EKONOMI - the ProfilDesa page's "Skor Dimensi Ekonomi" panel
  // only understands the 2-subdimensi Ekonomi shape. skor_indikator now also
  // holds the other 5 Permendesa 9/2024 dimensions (see recommendKabupaten.js
  // for the analogous kabupaten/provinsi-level breakdown); exposing them here
  // is deferred until ProfilDesa's UI is extended to show all 6 (roadmap
  // step 6), so this filter is intentional, not a leftover.
  const skor = await db
    .prepare(
      `SELECT sub_dimensi, nama_indikator, skor, bobot_maks FROM skor_indikator
       WHERE kode_desa = ? AND dimensi = 'EKONOMI' ORDER BY id`
    )
    .all(kode);

  // '0' excluded alongside the existing "empty" values - a count field
  // reading 0 (e.g. "Jumlah pasar dengan bangunan permanen": 0) means this
  // potensi does NOT exist, same as "Tidak Ada"; showing it as a tag was
  // actively misleading. Personnel-name fields (koperasi/BUM Desa officer
  // names) are administrative data, not a potensi signal, so they're
  // dropped too - same field labels categorize.js already recognizes as
  // non-potensi when grouping into "Fasilitas Perdagangan/Keuangan".
  const potensi = await db
    .prepare(
      `SELECT sektor, subsektor, nilai FROM potensi_desa
       WHERE kode_desa = ?
         AND nilai NOT IN ('Tidak Ada', '-', '', '0')
         AND subsektor NOT IN ('Nama Sekretaris', 'Nama Bendahara')
         AND subsektor NOT LIKE '%Ketua Pelaksana%'
       ORDER BY sektor, id`
    )
    .all(kode);

  const ekosistem = await db
    .prepare(
      `SELECT komponen, nilai FROM ekosistem_desa
       WHERE kode_desa = ? AND nilai NOT IN ('Tidak Ada', '-', '') ORDER BY id`
    )
    .all(kode);

  const jawaban = await db
    .prepare(`SELECT pertanyaan, jawaban FROM jawaban_kuesioner WHERE kode_desa = ? ORDER BY id`)
    .all(kode);

  // Composite score per Permendesa 9/2024 dimension (the 6 marker rows -
  // see /api/indeks/ringkasan for the same convention aggregated).
  const indeksDimensi = await db
    .prepare(`SELECT dimensi, skor, bobot_maks FROM skor_indikator WHERE kode_desa = ? AND nama_indikator = dimensi ORDER BY id`)
    .all(kode);

  res.json({ desa, skor, potensi, ekosistem, jawaban, indeksDimensi });
}));

app.post('/api/desa/:kode/rekomendasi', requireAuth, guard(async (req, res) => {
  await assertDesaAccess(req.user, req.params.kode);
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

app.post('/api/desa/:kode/narasi', requireAuth, guard(async (req, res) => {
  await assertDesaAccess(req.user, req.params.kode);
  const dimensi = req.body?.dimensi || null;
  if (dimensi && !DIMENSI_KEYS.has(dimensi)) {
    return res.status(400).json({ error: 'Dimensi tidak valid.' });
  }
  try {
    const result = await getNarasiDesa(req.params.kode, dimensi, { forceRefresh: !!req.body?.forceRefresh });
    if (result.notFound) return res.status(404).json({ error: 'Desa tidak ditemukan' });
    res.json(result);
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({ error: err.message, code: 'NO_API_KEY' });
    }
    console.error('Gagal membuat narasi desa:', err);
    res.status(500).json({ error: 'Gagal membuat narasi AI: ' + err.message });
  }
}));

app.get('/api/kabupaten/:nama/ringkasan', requireAuth, guard(async (req, res) => {
  assertKabupatenAccess(req.user, req.params.nama);
  const ctx = await buildKabupatenContext(req.params.nama);
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
app.get('/api/provinsi/ringkasan', requireAuth, guard(async (req, res) => {
  assertProvinsiAccess(req.user);
  const ctx = await buildKabupatenContext(null);
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

// Drill-down for the "Kondisi BUM Desa"/"Kondisi KDMP" bar charts on
// Analisis BUMDes - deterministic, no AI, same normalization as the
// aggregate counts above so a bar's count and its desa list always agree.
async function desaKomponenList(kabupaten, req, res) {
  const { komponen, value } = req.query;
  if (!value || (komponen !== 'bum' && komponen !== 'kdmp')) {
    return res.status(400).json({ error: 'Parameter komponen (bum|kdmp) dan value wajib diisi.' });
  }
  const rows = komponen === 'bum' ? await listDesaByBumTier(kabupaten, value) : await listDesaByKdmpStatus(kabupaten, value);
  res.json(rows);
}

app.get('/api/kabupaten/:nama/desa-komponen', requireAuth, guard(async (req, res) => {
  assertKabupatenAccess(req.user, req.params.nama);
  await desaKomponenList(req.params.nama, req, res);
}));

app.get('/api/provinsi/desa-komponen', requireAuth, guard(async (req, res) => {
  assertProvinsiAccess(req.user);
  await desaKomponenList(null, req, res);
}));

// ---------- potensi sektor ----------

// "nilai = 'Ada'" isolates genuine yes/no existence answers (e.g. "Terdapat
// Budidaya Udang Air Laut" -> "Ada"). Rekap Isu also has many non-boolean
// follow-up columns per sector (counts, distances, species names, ...); a
// looser "not blank / not Tidak Ada" filter counts nearly every desa for
// nearly every sector/subsektor, since some follow-up answer (even "0") is
// almost always present. Used for both the sector cards and the subsektor
// breakdown so the numbers stay consistent and comparable.
//
// nilai = 'Ada' alone isn't quite enough, though: some non-boolean follow-up
// columns (reference numbers, names, "Sebutkan" free-text fields) also ended
// up with a literal "Ada" answer for a handful of desa - a source data
// inconsistency, not a real potensi. Requiring the subsektor LABEL itself to
// start with "Terdapat " catches those, since that's the survey's own
// naming convention for a genuine existence question (and matches the
// ".replace(/^Terdapat /i, '')" display convention used everywhere in the UI).
const ADA_FILTER = `p.nilai = 'Ada' AND p.subsektor LIKE 'Terdapat %'`;

app.get('/api/potensi/sektor', requireAuth, guard(async (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query), 'd');
  const extra = sql ? `${sql} AND` : 'WHERE';
  const rows = await db
    .prepare(
      `SELECT p.sektor, COUNT(DISTINCT p.kode_desa) AS jumlah_desa
       FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       ${extra} ${ADA_FILTER}
       GROUP BY p.sektor ORDER BY jumlah_desa DESC`
    )
    .all(...params);
  res.json(rows);
}));

app.get('/api/potensi/sektor/:sektor', requireAuth, guard(async (req, res) => {
  const { sektor } = req.params;
  // Optional drill-down to a single subsektor/indikator (e.g. "Terdapat
  // Peternakan Sapi") so the desa list can answer "where exactly is this
  // specific potensi", not just "which desa have something in this sektor".
  const subsektorFilterValue = req.query.subsektor ? String(req.query.subsektor) : null;
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query), 'd');
  const extra = sql ? `${sql} AND` : 'WHERE';

  // Every genuine 'Ada' answer for this sektor, classified into the 4-group
  // model in JS (categorizePotensiKelompok) - the split can't be expressed
  // as a simple SQL LIKE pattern per sektor, so it's done row-level here
  // rather than in the query itself.
  const allRows = await db
    .prepare(
      `SELECT d.kode_desa, d.kabupaten, d.kecamatan, d.nama_desa, d.status_desa, d.lat, d.lng, p.subsektor
       FROM desa d
       JOIN potensi_desa p ON p.kode_desa = d.kode_desa
       ${extra} p.sektor = ? AND p.nilai = 'Ada'
       ORDER BY d.kabupaten, d.kecamatan, d.nama_desa`
    )
    .all(...params, sektor);
  const classified = allRows.map((r) => ({ ...r, kelompok: categorizePotensiKelompok(sektor, r.subsektor) }));

  // Desa list / jumlahDesa: scoped to Grup A (genuine potensi) only on the
  // main page, or to one specific subsektor when drilling down (any
  // kelompok - clicking a kelembagaan/akses/pemanfaatan row should still
  // show its desa list).
  const desaMap = new Map();
  for (const r of classified) {
    if (subsektorFilterValue ? r.subsektor === subsektorFilterValue : r.kelompok === 'potensi') {
      desaMap.set(r.kode_desa, r);
    }
  }
  const desa = [...desaMap.values()];

  const bySubsektor = new Map();
  for (const r of classified) {
    const entry = bySubsektor.get(r.subsektor) || { subsektor: r.subsektor, kelompok: r.kelompok, desaSet: new Set() };
    entry.desaSet.add(r.kode_desa);
    bySubsektor.set(r.subsektor, entry);
  }
  const subsektor = [...bySubsektor.values()]
    .map((e) => ({ subsektor: e.subsektor, kelompok: e.kelompok, jumlah_desa: e.desaSet.size }))
    .sort((a, b) => b.jumlah_desa - a.jumlah_desa)
    .slice(0, 200);

  res.json({ sektor, subsektorTerpilih: subsektorFilterValue, jumlahDesa: desa.length, desa, subsektor });
}));

// ---------- referensi (Buku Panduan Indeks Desa 2026) ----------
// Static reference dictionaries, not scoped to any user/region - definisi
// operasional + skala klasifikasi resmi, keyed by nama_indikator/subsektor
// exactly as stored in skor_indikator/potensi_desa. Fetched once by the
// frontend and looked up client-side, so this isn't query-parameterized.

app.get('/api/referensi/definisi-skor', requireAuth, (req, res) => {
  res.json(allDefinisiSkor());
});

app.get('/api/referensi/definisi-potensi', requireAuth, (req, res) => {
  res.json(allDefinisiPotensi());
});

// ---------- ekosistem ----------

app.get('/api/ekosistem/summary', requireAuth, guard(async (req, res) => {
  const filter = whereFromFilters(mergeScope(req.user, req.query), 'd', [
    `e.nilai NOT IN ('Tidak Ada', '-', '', '0')`,
  ]);
  const rows = await db
    .prepare(
      `SELECT e.komponen, COUNT(DISTINCT e.kode_desa) AS jumlah_desa
       FROM ekosistem_desa e
       JOIN desa d ON d.kode_desa = e.kode_desa
       ${filter.sql}
       GROUP BY e.komponen ORDER BY jumlah_desa DESC LIMIT 30`
    )
    .all(...filter.params);
  res.json(rows);
}));

// Drill-down for the "Jumlah Desa per Komponen" bar chart - same nilai
// filter as the aggregate above, scoped to one komponen (arbitrary client
// input, always bound as a query parameter, never interpolated).
app.get('/api/ekosistem/desa', requireAuth, guard(async (req, res) => {
  const { komponen } = req.query;
  if (!komponen) return res.status(400).json({ error: 'Parameter komponen wajib diisi.' });
  const filter = whereFromFilters(mergeScope(req.user, req.query), 'd', [
    `e.nilai NOT IN ('Tidak Ada', '-', '', '0')`,
    'e.komponen = ?',
  ]);
  const rows = await db
    .prepare(
      `SELECT DISTINCT d.kode_desa, d.nama_desa, d.kecamatan, d.kabupaten, d.status_desa, e.nilai
       FROM ekosistem_desa e
       JOIN desa d ON d.kode_desa = e.kode_desa
       ${filter.sql}
       ORDER BY d.kabupaten, d.kecamatan, d.nama_desa`
    )
    .all(...filter.params, komponen);
  res.json(rows);
}));

// ---------- peta ----------

app.get('/api/peta', requireAuth, guard(async (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query), 'd', [
    'd.lat IS NOT NULL',
    'd.lng IS NOT NULL',
  ]);
  // Optional: attach one indicator's own score/max weight per desa so the map
  // can color by that indicator (value bound as a parameter, never interpolated).
  const { indikator } = req.query;
  const indikatorSelect = indikator
    ? `, (SELECT si.skor FROM skor_indikator si WHERE si.kode_desa = d.kode_desa AND si.nama_indikator = ? LIMIT 1) AS skor_indikator,
         (SELECT si.bobot_maks FROM skor_indikator si WHERE si.kode_desa = d.kode_desa AND si.nama_indikator = ? LIMIT 1) AS bobot_indikator`
    : '';
  const rows = await db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kabupaten, d.kecamatan, d.status_desa, d.lat, d.lng,
              ${ekonomiSkorSubquery()} AS skor_ekonomi${indikatorSelect}
       FROM desa d ${sql}`
    )
    .all(...(indikator ? [indikator, indikator] : []), ...params);
  res.json(rows);
}));

app.get('/api/peta/indikator', requireAuth, guard(async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT DISTINCT dimensi, sub_dimensi AS subDimensi, nama_indikator AS indikator
       FROM skor_indikator WHERE nama_indikator LIKE 'SKOR %' ORDER BY dimensi, sub_dimensi, nama_indikator`
    )
    .all();
  res.json(rows);
}));

// ---------- analisis kuadran (potensi x kinerja) ----------

app.get('/api/analisis/kuadran', requireAuth, guard(async (req, res) => {
  const { sql, params } = whereFromFilters(mergeScope(req.user, req.query));
  const rows = (await db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kabupaten, d.kecamatan, d.status_desa,
              ${ekonomiSkorSubquery()} AS skor,
              ${potensiSektorCountSubquery()} AS potensi
       FROM desa d ${sql}`
    )
    .all(...params))
    .filter((r) => r.skor !== null);

  const { potensiMedian, skorMedian, desa } = classifyKuadran(rows);
  res.json({
    potensiMedian,
    kinerjaMedian: skorMedian,
    desa: desa.map(({ skor, ...r }) => ({ ...r, kinerja: skor })),
  });
}));

// ---------- import (admin) ----------

app.get('/api/import/log', requireAuth, requireRole('admin'), guard(async (req, res) => {
  const rows = await db
    .prepare('SELECT sumber_file, sheet, waktu_import, jumlah_baris FROM import_log ORDER BY id DESC')
    .all();
  res.json(rows);
}));

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

// ---------- BANUA ECOSYSTEM: Review RPKP (Sprint 1 - CRUD, upload, versi, status; belum ada AI) ----------

const RPKP_ROLES = ['kabupaten', 'provinsi', 'admin']; // desa has no legitimate use for this module
const ALLOWED_UPLOAD_EXT = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xls', '.xlsx']);

const rpkpUpload = multer({
  storage: multer.memoryStorage(),
  // Real RPKP documents (scanned, image-heavy) run well past a "reasonable"
  // PDF size - one Tabalong test document was 65MB - so this needs real
  // headroom, not just a nominal upload guard.
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
      return cb(new Error(`Jenis file tidak didukung: ${ext || '(tanpa ekstensi)'}`));
    }
    cb(null, true);
  },
});

// multer's fileFilter/size-limit errors surface via the callback multer
// itself invokes, not a thrown exception guard() can catch - wrap it so
// those also come back as clean JSON instead of Express's default HTML
// error page.
function uploadSingle(field) {
  const mw = rpkpUpload.single(field);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload gagal.' });
      next();
    });
  };
}

async function loadReviewOr404(req) {
  const id = Number(req.params.id);
  const review = await getReview(id);
  if (!review) {
    const err = new Error('Review RPKP tidak ditemukan.');
    err.status = 404;
    throw err;
  }
  return review;
}

app.get('/api/rpkp/reviews', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const scope = mergeScope(req.user, req.query);
  res.json(await listReviews(scope));
}));

app.post('/api/rpkp/reviews', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await createReview(req.user, req.body || {});
  res.status(201).json(review);
}));

app.get('/api/rpkp/reviews/:id', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  res.json(review);
}));

app.get('/api/rpkp/reviews/:id/documents', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  res.json(await listDocuments(review.id));
}));

app.post(
  '/api/rpkp/reviews/:id/documents',
  requireAuth,
  requireRole(...RPKP_ROLES),
  uploadSingle('file'),
  guard(async (req, res) => {
    const review = await loadReviewOr404(req);
    assertReviewAccess(req.user, review);
    if (!req.file) return res.status(400).json({ error: 'File wajib dilampirkan.' });
    const documentType = req.body.documentType;
    if (!DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ error: 'Jenis dokumen tidak dikenali.' });
    }
    const ext = path.extname(req.file.originalname).toLowerCase();
    const storedFilename = `${crypto.randomUUID()}${ext}`;
    const dir = reviewUploadDir(review.id);
    fs.writeFileSync(path.join(dir, storedFilename), req.file.buffer);
    const doc = await addDocument(review.id, req.user, {
      documentType,
      originalFilename: req.file.originalname,
      storedFilename,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });
    res.status(201).json(doc);
  })
);

app.get(
  '/api/rpkp/reviews/:id/documents/:docId/file',
  requireAuth,
  requireRole(...RPKP_ROLES),
  guard(async (req, res) => {
    const review = await loadReviewOr404(req);
    assertReviewAccess(req.user, review);
    const doc = await getDocument(review.id, Number(req.params.docId));
    if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
    const filePath = path.join(reviewUploadDir(review.id), doc.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Berkas tidak ditemukan di server.' });
    const isPdf = doc.mime_type === 'application/pdf';
    const safeName = doc.original_filename.replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${isPdf ? 'inline' : 'attachment'}; filename="${safeName}"`);
    res.sendFile(filePath);
  })
);

app.get('/api/rpkp/reviews/:id/history', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  res.json(await listHistory(review.id));
}));

app.post('/api/rpkp/reviews/:id/status', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  const { status, note } = req.body || {};
  const updated = await changeStatus(req.user, review, status, note);
  res.json(updated);
}));

// Sprint 2: AI Document Assistant (Gemini reads the review's PDFs directly -
// see lib/rpkpAi.js). Every answer is persisted, never just returned, so
// the Q&A history survives and doubles as an audit trail.
app.get('/api/rpkp/reviews/:id/ai/qa', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  res.json(await listQa(review.id));
}));

app.post('/api/rpkp/reviews/:id/ai/ask', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  const question = (req.body || {}).question;
  let result;
  try {
    result = await askDocumentAssistant(review, question);
  } catch (err) {
    // The message shown to the reviewer is deliberately generic/friendly
    // (lib/rpkpAi.js) - log the real underlying cause here so a genuine
    // failure (vs. routine Gemini overload) can actually be diagnosed.
    console.error('Asisten AI RPKP gagal:', err.cause || err);
    throw err;
  }
  await saveQa(review.id, req.user, question, result);
  res.status(201).json(result);
}));

// ---------- Sprint 3: Kelengkapan/Completeness finding engine ----------
// Master checklist is read-only here (edited later via an Admin master-data
// page, per blueprint) - reviewers only trigger AI checks and verify/reject
// the resulting findings.

app.get('/api/rpkp/completeness-items', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  res.json(listCompletenessItems());
}));

app.get('/api/rpkp/reviews/:id/findings', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  res.json(await listFindings(review.id, req.query.category));
}));

app.post(
  '/api/rpkp/reviews/:id/completeness/:kode/check',
  requireAuth,
  requireRole(...RPKP_ROLES),
  guard(async (req, res) => {
    const review = await loadReviewOr404(req);
    assertReviewAccess(req.user, review);
    const item = await getCompletenessItem(req.params.kode);
    if (!item) return res.status(404).json({ error: 'Item kelengkapan tidak dikenali.' });
    let aiResult;
    try {
      aiResult = await checkCompletenessItem(review, item);
    } catch (err) {
      console.error('Cek kelengkapan RPKP gagal:', err.cause || err);
      throw err;
    }
    const finding = upsertCompletenessFinding(review.id, item, aiResult, req.user);
    res.status(201).json(finding);
  })
);

// ---------- Sprint 5: IPKP & Kesiapan Kawasan (Readiness) engines ----------
// Same shared checklist-item table/finding shape as Completeness, just a
// different kategori ('IPKP' | 'READINESS') and prompt per lib/rpkpAi.js.

app.get('/api/rpkp/checklist-items', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const kategori = req.query.kategori;
  if (!['IPKP', 'READINESS'].includes(kategori)) {
    return res.status(400).json({ error: 'Parameter kategori wajib diisi: IPKP atau READINESS.' });
  }
  res.json(await listChecklistItems(kategori));
}));

app.post(
  '/api/rpkp/reviews/:id/checklist/:kode/check',
  requireAuth,
  requireRole(...RPKP_ROLES),
  guard(async (req, res) => {
    const review = await loadReviewOr404(req);
    assertReviewAccess(req.user, review);
    const item = await getChecklistItem(req.params.kode);
    if (!item || !['IPKP', 'READINESS'].includes(item.kategori)) {
      return res.status(404).json({ error: 'Item checklist tidak dikenali.' });
    }
    let aiResult;
    try {
      aiResult = await checkChecklistItem(review, item);
    } catch (err) {
      console.error(`Cek ${item.kategori} RPKP gagal:`, err.cause || err);
      throw err;
    }
    const finding = upsertChecklistFinding(review.id, item, aiResult, req.user);
    res.status(201).json(finding);
  })
);

// ---------- Sprint 4: RTRW/RPJMD/BANUA360 alignment engines ----------

app.get('/api/rpkp/reviews/:id/desa', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  res.json(await listReviewDesa(review.id));
}));

app.put('/api/rpkp/reviews/:id/desa', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  const result = await setReviewDesa(review, req.user, (req.body || {}).kodeDesaList || []);
  res.json(result);
}));

app.post('/api/rpkp/reviews/:id/rtrw/check', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  let aiResult;
  try {
    aiResult = await checkRtrwAlignment(review);
  } catch (err) {
    console.error('Cek RTRW RPKP gagal:', err.cause || err);
    throw err;
  }
  const finding = await upsertFinding(review.id, 'RTRW', 'RTRW_ALIGNMENT', 'Kesesuaian Tata Ruang (RTRW)', aiResult, req.user);
  res.status(201).json(finding);
}));

app.post('/api/rpkp/reviews/:id/rpjmd/check', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  let aiResult;
  try {
    aiResult = await checkRpjmdAlignment(review);
  } catch (err) {
    console.error('Cek RPJMD RPKP gagal:', err.cause || err);
    throw err;
  }
  const finding = await upsertFinding(review.id, 'RPJMD', 'RPJMD_ALIGNMENT', 'Keselarasan RPJMD', aiResult, req.user);
  res.status(201).json(finding);
}));

app.post('/api/rpkp/reviews/:id/banua360/check', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  const finding = await checkBanua360CrossCheck(review, req.user);
  res.status(201).json(finding);
}));

async function loadFindingOr404(req) {
  const finding = await getFinding(Number(req.params.findingId));
  if (!finding) {
    const err = new Error('Temuan tidak ditemukan.');
    err.status = 404;
    throw err;
  }
  return finding;
}

async function assertFindingReviewAccess(user, finding) {
  const review = await getReview(finding.review_id);
  if (!review) {
    const err = new Error('Review RPKP tidak ditemukan.');
    err.status = 404;
    throw err;
  }
  assertReviewAccess(user, review);
}

app.post('/api/rpkp/findings/:findingId/verify', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const finding = await loadFindingOr404(req);
  await assertFindingReviewAccess(req.user, finding);
  res.json(verifyFinding(finding.id, req.user, (req.body || {}).note));
}));

app.post('/api/rpkp/findings/:findingId/reject', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const finding = await loadFindingOr404(req);
  await assertFindingReviewAccess(req.user, finding);
  res.json(rejectFinding(finding.id, req.user, (req.body || {}).note));
}));

app.get('/api/rpkp/reviews/:id/recommendation', requireAuth, requireRole(...RPKP_ROLES), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  res.json(await getRecommendation(review.id) || null);
}));

app.post('/api/rpkp/reviews/:id/recommendation', requireAuth, requireRole('admin', 'provinsi'), guard(async (req, res) => {
  const review = await loadReviewOr404(req);
  assertReviewAccess(req.user, review);
  const { keputusan, catatan } = req.body || {};
  const result = await setRecommendation(review.id, req.user, keputusan, catatan);
  if (review.status === 'IN_REVIEW') {
    await changeStatus(req.user, review, 'REVIEW_COMPLETED', `Recommendation Gate: ${keputusan}`);
  }
  res.status(201).json(result);
}));

// ---------- production static serving ----------
// In dev, Vite serves web/ separately (see .claude/launch.json) and proxies
// /api to this server. In production there's no Vite process - this same
// Express server also serves the built frontend, so the whole app is one
// process on one port (what Railway and similar host-by-port platforms
// expect). Must be registered after every /api/* route above, since the SPA
// fallback below would otherwise swallow them.
// Not on Vercel: there the CDN serves web/dist and only /api/* reaches this
// function, so the fallback below would never fire and webDist would not even
// be in the bundle.
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
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

// On Vercel the platform owns the socket: the app is exported as the request
// handler instead (see scripts/build-vercel.mjs). Binding a port there would
// do nothing at best and hang the function at worst.
if (!process.env.VERCEL) {
  app.listen(LISTEN_PORT, () => {
    console.log(`API berjalan di http://localhost:${LISTEN_PORT}`);
  });
}

export default app;
