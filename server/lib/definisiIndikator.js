import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Definisi operasional + skala klasifikasi resmi, diekstrak dari "Buku
// Panduan Indeks Desa Tahun 2026" (Kemendes) - dicocokkan by exact-name
// terhadap nama_indikator (skor_indikator) dan subsektor (potensi_desa).
// Cakupan sebagian saja (~32% dari total kolom): banyak "SKOR ..." di DB
// adalah nilai KOMPOSIT hasil hitungan Kemendes dari beberapa pertanyaan
// mentah sekaligus, bukan satu pertanyaan tunggal - panduan ini
// mendokumentasikan pertanyaan mentah per item, bukan rumus komposit
// tersebut, jadi tidak semua indikator punya definisi di sini. Item yang
// tidak ada di dataset ini sengaja TIDAK ditampilkan tooltip-nya, daripada
// menampilkan definisi yang salah/dikarang.
const skorDefinisi = JSON.parse(readFileSync(path.join(__dirname, '../data/panduan/skor-definisi.json'), 'utf-8'));
const potensiDefinisi = JSON.parse(readFileSync(path.join(__dirname, '../data/panduan/potensi-definisi.json'), 'utf-8'));

export function getDefinisiSkor(namaIndikator) {
  return skorDefinisi[namaIndikator] || null;
}

export function getDefinisiPotensi(subsektor) {
  return potensiDefinisi[subsektor] || null;
}

export function allDefinisiSkor() {
  return skorDefinisi;
}

export function allDefinisiPotensi() {
  return potensiDefinisi;
}
