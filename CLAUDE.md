# CLAUDE.md

This file provides guidance to Claude Code when working with code in this directory.

## Project overview

**Banua360** ("Dashboard Ekonomi Desa Kalsel") — dashboard analisis potensi & kinerja ekonomi desa se-Kalimantan Selatan, dibangun oleh Dory Amanda Sari, S.Kom., M.M., dari dua file Excel sumber (`ekonomi.xlsx` dan `row data ID Aplikasi final kirim.xlsx` di folder Downloads). Berisi 9 modul: Dashboard, Dimensi Ekonomi, Potensi Desa, Profil Desa (termasuk Rekomendasi Produk Unggulan berbasis AI), Ekosistem Ekonomi, Peta Ekonomi, Analisis Kuadran (Potensi x Kinerja), Analisis BUMDes (kondisi BUM Desa & rekomendasi kebijakan tingkat kabupaten ATAU provinsi sekaligus, berbasis AI), dan Data (admin/import).

Lihat `../kamus-data/Kamus_Data_Ekonomi_Desa.xlsx` untuk kamus data lengkap (6.943 kolom, 24 sheet) yang mendasari desain skema database di bawah.

## Menjalankan

```bash
npm run dev
```
dari folder `dashboard-ekonomi-desa/` (root proyek ini) — menjalankan API (Express, port 5501) dan frontend (Vite, port 5502) bersamaan via `concurrently`. Buka `http://localhost:5502`.

Import/re-import data dari file Excel sumber:
```bash
npm run import
```
(atau lewat UI: menu Data → "Jalankan Import Ulang"). Path file sumber default ke `C:\Users\doryt\Downloads\ekonomi.xlsx` dan `...\row data ID Aplikasi final kirim.xlsx`, bisa dioverride lewat env var `EKONOMI_XLSX` / `RAW_XLSX`. Koordinat GPS desa diambil dari file CSV terpisah (lihat "Koordinat GPS" di bawah), default `C:\Users\doryt\Downloads\Posyandu 6 SPM - MW.csv`, dioverride lewat `KOORDINAT_DESA_CSV` - opsional, import tetap jalan tanpanya (fallback ke parse teks bebas, cakupan lebih rendah).

## Arsitektur

- **`server/`** — Express API + SQLite (modul bawaan `node:sqlite`, tanpa native build).
  - `db.js` — koneksi database + schema (`CREATE TABLE IF NOT EXISTS`).
  - `index.js` — semua route API (`/api/desa`, `/api/potensi/*`, `/api/ekosistem/*`, `/api/peta`, `/api/analisis/kuadran`, `/api/kabupaten/:nama/*`, `/api/provinsi/*`, `/api/dashboard/summary`, `/api/import/*`).
  - `lib/excel-parse.js` — parser generik sheet Excel sumber (deteksi baris header via sel "Kabupaten", deteksi baris data via pola Kode Desa 9-12 digit) + parser koordinat GPS best-effort dari field teks bebas.
  - `lib/categorize.js` — aturan regex kategorisasi sektor potensi (perikanan/peternakan/pariwisata/dst.), di-port dari kamus data.
  - `lib/llm.js` — pemanggilan LLM multi-provider bersama (Groq/Gemini/Anthropic, lihat bagian AI di bawah), dipakai oleh `recommend.js` dan `recommendKabupaten.js`.
  - `lib/recommend.js` — Rekomendasi Produk Unggulan per desa (AI): membangun prompt dari potensi aktif + indikator skor rendah ("masalah") + ekosistem desa, cache hasil di tabel `rekomendasi_produk` (key: hash data input, bukan waktu — otomatis invalid saat data desa berubah).
  - `lib/recommendKabupaten.js` — Analisis BUMDes (AI): agregasi deterministik per kabupaten, atau se-provinsi saat `kabupaten` param bernilai `null` (distribusi status desa, tier BUM Desa sesuai Kepmendes 145/2022, status KDMP, jumlah BUM Desa aktif/berbadan hukum, rata-rata hari operasional, sektor potensi terbanyak, daftar "desa prioritas" = potensi tinggi & skor rendah) lalu diberikan ke LLM untuk narasi + rekomendasi kebijakan. Daftar desa prioritas SELALU dihitung deterministik dari DB (bukan dikarang LLM) — expose lewat `buildKabupatenContext(kabupatenOrNull)` (dipakai juga oleh endpoint ringkasan non-AI) dan `getRekomendasiKabupaten` (cache di tabel `rekomendasi_kabupaten`, skop provinsi disimpan dengan kunci sentinel `PROVINSI_SENTINEL` karena kolom `kabupaten` NOT NULL; pola sama seperti `rekomendasi_produk`).
  - `lib/auth.js` — login: Google OAuth (plain `fetch`, sama pola dengan `lib/llm.js`), sesi JWT di cookie httpOnly, bootstrap admin pertama dari `ADMIN_BOOTSTRAP_CODE`, registrasi via kode undangan. Lihat bagian Login & Role Akses di bawah.
  - `lib/scope.js` — `mergeScope`/`assertDesaAccess`/`assertKabupatenAccess`/`assertProvinsiAccess`: penegakan RBAC per request, dipanggil di HAMPIR SEMUA route data di `index.js`. `assertProvinsiAccess` menjaga `/api/provinsi/*` hanya untuk role `admin`/`provinsi`. Kalau menambah route data baru, WAJIB panggil salah satu dari sini juga - jangan andalkan frontend saja untuk menyembunyikan data.
  - `scripts/import-excel.js` — pipeline import utama, baca kedua file Excel → isi SQLite.
  - `data/ekonomi-desa.db` — file database (gitignored).
  - `.env` — API key provider AI + kredensial login (gitignored; lihat `.env.example`).
- **`web/`** — React + Vite. Routing per modul di `src/pages/`, komponen bersama (Sidebar, FilterBar, StatusBadge) di `src/components/`, `src/api.js` sebagai wrapper fetch ke backend, `src/auth.jsx` untuk state login (`useAuth()`).

## Skema database

Lihat tabel `desa`, `skor_indikator`, `jawaban_kuesioner`, `potensi_desa`, `ekosistem_desa`, `import_log`, `rekomendasi_produk`, `rekomendasi_kabupaten`, `kode_registrasi`, `users` di `server/db.js`. Semua tabel selain `desa`/`rekomendasi_kabupaten`/`kode_registrasi`/`users` mereferensikan `desa.kode_desa` — saat menghapus/insert ulang data, hapus tabel anak dahulu baru `desa` (urutan di `import-excel.js`).

## Cakupan data v1 (lihat juga menu "Data" di UI)

- Sumber skor & jawaban kuesioner Ekonomi: sheet yang **sudah difilter** di `ekonomi.xlsx` (`rekap`, `Rekap kuisioner 1`) — menghindari duplikasi blok pertanyaan Ekonomi yang ditemukan di file master.
- Sumber potensi sektor: sheet `Rekap Isu` di file master (1.416 kolom, lengkap).
- Sumber ekosistem pendukung: sheet `Rekap Tambahan` di file master — **bukan** `Tambahan 2026` meski skemanya lebih baru, karena `Tambahan 2026` baru terisi ~6% (lihat komentar di `import-excel.js`).
- **Tidak diimpor**: sheet `rekap ISU DESA PERDESAAN` (2.283 kolom, tata kelola & modal sosial desa — mayoritas di luar cakupan ekonomi), dan sheet duplikat/QA lainnya (`rekap KUISIONER`, `Kuisioner`, `Info Grafis`, dll).
- **Koordinat GPS** (untuk Peta Ekonomi, BANUA OPPORTUNITY, BANUA INSIGHT, dll): sumber utama adalah file CSV geocoded-by-address terpisah (`KOORDINAT_DESA_CSV`, default `Posyandu 6 SPM - MW.csv` di Downloads) — mencakup 1.871/1.871 desa (100%), kode_desa cocok persis, divalidasi 2026-09-24 terhadap hasil parse teks bebas lama: mengisi 445 desa yang dulu tidak punya koordinat sama sekali, dan mengoreksi ~305 desa lain yang koordinat hasil parse-nya meleset >5km (bukan cuma kurang presisi — salah desa/lokasi). Field teks bebas "Titik Koordinat Desa" (parse best-effort, ~75% berhasil) masih dipertahankan sebagai fallback kalau file CSV ini tidak tersedia.

## Rekomendasi AI (Profil Desa & Analisis BUMDes)

Dua panel AI terpisah — "Rekomendasi Produk Unggulan" (per desa, di Profil Desa) dan "Analisis Kondisi BUM Desa & Rekomendasi" (per kabupaten ATAU per provinsi, di Analisis BUMDes) — sama-sama lewat `lib/llm.js`: satu LLM gratis (Groq atau Gemini) atau, jika diisi, Anthropic (berbayar), dicoba berurutan **Groq → Gemini → Anthropic**, jatuh ke provider berikutnya bila satu gagal atau limit harian habis. Tanpa API key sama sekali, endpoint mengembalikan HTTP 503 dengan `code: "NO_API_KEY"` dan UI menampilkan pesan yang mengarahkan ke `server/.env.example` — bukan bug, itu perilaku yang diharapkan. Isi minimal satu key di `server/.env` (disalin dari `.env.example`) lalu restart `npm run dev` untuk mengaktifkan.

Hasil di-cache per scope (`rekomendasi_produk` per desa, `rekomendasi_kabupaten` per kabupaten atau per provinsi via sentinel), keyed oleh hash dari data agregat yang dipakai — generate ulang hanya terjadi kalau data yang mendasarinya berubah (re-import) atau user klik "Buat Ulang" (`forceRefresh`). Jangan tambahkan pemanggilan otomatis/batch ke semua desa/kabupaten tanpa diminta eksplisit — ini fitur on-demand per klik, bukan proses latar belakang, karena tiap panggilan (walau gratis) tetap kena rate limit provider. Endpoint ringkasan (`GET /api/kabupaten/:nama/ringkasan`, `GET /api/provinsi/ringkasan`) TIDAK memanggil AI — hanya agregasi SQL langsung — sehingga aman dipanggil setiap kali user ganti wilayah di dropdown tanpa boros kuota. Opsi "Provinsi (Semua Kabupaten)" di dropdown hanya muncul kalau daftar kabupaten yang dikembalikan `/api/wilayah/kabupaten` lebih dari satu — yang secara alami sudah dibatasi server-side hanya untuk role `admin`/`provinsi` (role `kabupaten` selalu menerima daftar 1 kabupaten saja).

## Login & Role Akses

4 role: `desa` (hanya melihat desanya sendiri, sidebar disederhanakan jadi cuma "Profil Desa", `App.jsx` auto-redirect ke `/profil-desa?kode=<kode_desa milik user>`), `kabupaten` (semua modul tapi terkunci ke satu kabupaten - dropdown kabupaten di `FilterBar`/`AnalisisKabupaten` otomatis disabled saat `/api/wilayah/kabupaten` cuma mengembalikan satu nilai), `provinsi` (semua modul, semua wilayah, read-only), `admin` (semua + `/data` + `/pengguna`).

**Registrasi**: admin generate kode sekali-pakai di halaman "Manajemen Pengguna" (`POST /api/admin/kode-registrasi`), dibagikan manual ke operator. User baru isi kode itu di halaman Login → redirect Google OAuth → email dari Google dicocokkan/didaftarkan sesuai role+wilayah kode tsb (`registerWithKode` di `lib/auth.js`). Login berikutnya cukup "Masuk dengan Google" (kode tidak dipakai lagi, dicocokkan by email).

**Wajib untuk aktifkan login**: isi `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_BOOTSTRAP_CODE`, `PUBLIC_URL` di `server/.env` (lihat `.env.example` untuk cara generate & link Google Cloud Console). Tanpa `GOOGLE_CLIENT_ID`/`SECRET`, tombol login akan gagal dengan pesan jelas (bukan crash) - baru berfungsi penuh setelah kredensial asli diisi.

**Penegakan scope ada di server**, bukan cuma UI: `lib/scope.js`'s `mergeScope()` meng-override parameter `kabupaten`/`kode_desa` dari query apa pun yang dikirim client dengan nilai yang dipaksa dari sesi user (untuk role `kabupaten`/`desa`); `assertDesaAccess`/`assertKabupatenAccess` menolak akses langsung ke `:kode`/`:nama` path param di luar scope. Sudah diverifikasi dengan 9 skenario RBAC (lihat riwayat commit/percakapan) - kalau menambah endpoint data baru, ikuti pola yang sama, jangan lupa `requireAuth` + salah satu helper scope.

## Konvensi

- Bahasa Indonesia untuk semua teks UI, konsisten dengan `desa-budget-tracker/`.
- Skor/nilai desa selalu untuk tahun 2026 (`TAHUN` constant di `import-excel.js`) — belum ada data multi-tahun di sumber.
- Saat menambah kolom/kategori baru dari sumber Excel, cocokkan dulu dengan kamus data (`../kamus-data/Kamus_Data_Ekonomi_Desa.xlsx`) agar konsisten dengan hasil rekonsiliasi yang sudah divalidasi.
