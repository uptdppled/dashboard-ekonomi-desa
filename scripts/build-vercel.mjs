// Build untuk Vercel memakai Build Output API (https://vercel.com/docs/build-output-api),
// pola yang sama dengan bumdesa-360:
//   .vercel/output/static             hasil `vite build` dari web/
//   .vercel/output/functions/api.func satu fungsi Node untuk semua /api/*, dibundel esbuild
//                                     jadi satu berkas mandiri (tanpa node_modules)
//   .vercel/output/config.json        aturan rute: /api/* ke fungsi, lalu berkas statis,
//                                     lalu index.html (aplikasi satu halaman)
//
// Jalankan dari root repo: `node scripts/build-vercel.mjs` (lewati build web dengan --tanpa-web).
//
// Kenapa Build Output API dan bukan konvensi `api/` bawaan Vercel: dependensi
// server ada di server/package.json, bukan di root, sehingga builder bawaan
// tidak menemukannya. esbuild membundel semuanya jadi satu berkas, jadi
// masalah resolusi itu hilang.
//
// Catatan: modul REVIEW RPKP menulis dokumen ke disk (server/data/rpkp-uploads).
// Di Vercel tidak ada disk permanen, jadi unggah/buka dokumen sengaja tidak
// tersedia di sini - lihat penjagaan di server/lib/rpkp.js. Modul lain jalan penuh.

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '.vercel', 'output');
const FUNC = path.join(OUT, 'functions', 'api.func');

rmSync(OUT, { recursive: true, force: true });

// --- frontend -------------------------------------------------------------
if (!process.argv.includes('--tanpa-web')) {
  execSync('npm --prefix web run build', { cwd: ROOT, stdio: 'inherit' });
}
const webDist = path.join(ROOT, 'web', 'dist');
if (!existsSync(webDist)) {
  throw new Error('web/dist tidak ada - jalankan tanpa --tanpa-web, atau build web dulu.');
}
cpSync(webDist, path.join(OUT, 'static'), { recursive: true });

// --- API ------------------------------------------------------------------
mkdirSync(FUNC, { recursive: true });
await build({
  entryPoints: [path.join(ROOT, 'server', 'vercel.js')],
  outfile: path.join(FUNC, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Semuanya dibundel jadi satu berkas, TIDAK dibiarkan external.
  //
  // Alasannya struktur repo ini: dependensi server ada di server/package.json,
  // sedangkan hasil build diletakkan di .vercel/output/. Kalau paket dibiarkan
  // external, resolusi Node dari lokasi baru itu tidak akan menemukan
  // server/node_modules - dan @vercel/nft pun tidak bisa melacaknya (itu yang
  // bikin salinan node_modules keluar nol pada percobaan pertama).
  external: [
    'pg-native', // opsional, dimuat pg di dalam try/catch
    'cpu-features', // opsional, transitif
  ],
  // express dan kawan-kawannya CommonJS. Dibundel ke format ESM, require()
  // bawaan mereka berubah jadi stub esbuild yang melempar "Dynamic require of
  // 'path' is not supported". Banner ini mengembalikan require yang sungguhan.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
});

// Bundel harus benar-benar mandiri: satu-satunya import yang boleh tersisa
// adalah modul bawaan Node dan paket opsional yang sengaja di-external di
// atas. Kalau ada sisa import paket npm, fungsi akan gagal di Vercel dengan
// ERR_MODULE_NOT_FOUND - lebih baik ketahuan sekarang.
const bundel = readFileSync(path.join(FUNC, 'index.mjs'), 'utf8');
const DIIZINKAN = new Set(['pg-native', 'cpu-features']);
const tersisa = [...bundel.matchAll(/(?:^|\n)\s*(?:import[^\n]*?from\s*|import\s*)["']([^"'.][^"']*)["']/g)]
  .map((m) => m[1])
  .filter((spec) => !spec.startsWith('node:') && !DIIZINKAN.has(spec));

if (tersisa.length > 0) {
  throw new Error(
    `Masih ada import paket npm yang belum dibundel: ${[...new Set(tersisa)].join(', ')}. ` +
      'Tambahkan ke external dan sediakan berkasnya, atau perbaiki bundling.',
  );
}

writeFileSync(
  path.join(FUNC, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      // Beberapa endpoint agregat butuh waktu (query lintas 480 ribu baris ke
      // region database); 30 detik memberi ruang tanpa menggantung selamanya.
      maxDuration: 30,
    },
    null,
    2,
  ),
);

writeFileSync(
  path.join(OUT, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      // Menjaga project Supabase free tier tidak dijeda: ia tertidur setelah
      // 7 hari tanpa permintaan ke database, dan harus dibangunkan manual.
      // Sekali sehari 03:00 UTC (10:00 WITA) sudah jauh dari ambang itu, dan
      // pas dengan batas paket Hobby Vercel yang hanya mengizinkan cron harian.
      crons: [{ path: '/api/keep-alive', schedule: '0 3 * * *' }],
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/api/(.*)$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log(`Build Vercel selesai: fungsi api (${(bundel.length/1024/1024).toFixed(1)} MB, mandiri), statis dari web/dist.`);
