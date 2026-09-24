// Groups every sektor's subsektor labels into the 4-group model: what the
// desa HAS (potensi), who manages it (kelembagaan), how reachable it is
// (akses), and whether it's actually being used (pemanfaatan). Order
// matters - first matching rule wins, most-specific first (mirrors
// categorize.js's own convention for sektor assignment).
//
// Pariwisata keeps its own hand-verified rule set (checked against all 91
// of its distinct subsektor labels with zero unmatched - see git history).
// Every other sektor falls back to GENERIC_RULES, verified the same way
// against a full dump of potensi_desa.subsektor per sektor (647 labels
// total, zero unmatched) - see server/scripts or conversation history for
// the verification script if these rules ever need re-checking after a
// re-import surfaces new labels.
const PARIWISATA_RULES = [
  [/POKDARWIS.*Mengadakan Kegiatan/i, 'pemanfaatan'],
  [/POKDARWIS/i, 'kelembagaan'],
  [/BUM Desa Pariwisata/i, 'kelembagaan'],
  [/Nomor SK Desa Wisata/i, 'kelembagaan'],
  [/^Nama (Desa Wisata|Wisata)/i, 'kelembagaan'],
  [/Pengelola/i, 'kelembagaan'],
  [/Bidang Pengembangan Desa Wisata/i, 'akses'],
  [/menuju (objek )?wisata/i, 'akses'],
  [/Aktivitas Wisata/i, 'pemanfaatan'],
  [/^Terdapat (Wisata|Bendungan untuk Objek Wisata)/i, 'potensi'],
];

const GENERIC_RULES = [
  // Base existence of the cooperation itself is the potensi signal for
  // Kerjasama Antar Desa (checked before the broader "Perjanjian Kerjasama"
  // kelembagaan rule below, which is about the agreement's DETAILS).
  [/^Terdapat Perjanjian Kerjasama/i, 'potensi'],
  // A "Terdapat X" problem/welfare flag (e.g. PMKS - Penyandang Masalah
  // Kesejahteraan Sosial) is the opposite of a potensi despite matching the
  // generic "Terdapat " existence pattern below - 'lainnya' isn't one of
  // the 4 displayed groups, so this just doesn't render rather than being
  // miscounted as an asset.
  [/Masalah Kesejahteraan Sosial|\bPMKS\b/i, 'lainnya'],
  // kelembagaan - siapa yang mengelola/melembagakan potensi ini
  [/BUM Desa/i, 'kelembagaan'],
  [/Koperasi/i, 'kelembagaan'],
  [/\bKUD\b/i, 'kelembagaan'],
  [/Kelompok\/?\s*organisasi\/?\s*lembaga/i, 'kelembagaan'],
  [/POKDARWIS/i, 'kelembagaan'],
  [/Pengelola/i, 'kelembagaan'],
  [/Nomor SK/i, 'kelembagaan'],
  [/SK yang di\s*keluarkan/i, 'kelembagaan'],
  [/Ketua Pelaksana/i, 'kelembagaan'],
  [/^Nama (Ketua|Sekretaris|Bendahara|Desa Wisata|Wisata|BKAD)/i, 'kelembagaan'],
  [/\bBKAD\b/i, 'kelembagaan'],
  [/Status Keaktifan/i, 'kelembagaan'],
  [/Perjanjian Kerjasama/i, 'kelembagaan'],
  [/Nomor Perjanjian/i, 'kelembagaan'],
  [/Bidang Kerjasama/i, 'kelembagaan'],
  [/Peraturan Desa|\bPerdes\b/i, 'kelembagaan'],
  // akses - seberapa mudah potensi ini dikembangkan/dijangkau
  [/menuju/i, 'akses'],
  [/^Jarak/i, 'akses'],
  [/Kemudahan akses/i, 'akses'],
  [/Ketersediaan Transp/i, 'akses'],
  [/difasilitasi pihak ke ?3/i, 'akses'],
  [/Konsultan/i, 'akses'],
  [/Kondisi jalan/i, 'akses'],
  [/panjang jalan rusak/i, 'akses'],
  [/Keterangan Terkait Perjalanan/i, 'akses'],
  [/program pemberdayaan/i, 'akses'],
  [/alat bantu|Teknologi Tepat Guna/i, 'akses'],
  [/^Tersedianya/i, 'akses'],
  [/Bersumber Pembiayaan|Sumber Pembiayaan/i, 'akses'],
  // pemanfaatan - apakah potensi ini sudah benar-benar dipakai/dijalankan
  [/memiliki usaha/i, 'pemanfaatan'],
  [/dimanfaatkan untuk|produk bank/i, 'pemanfaatan'],
  [/^Jumlah Usaha/i, 'pemanfaatan'],
  [/^Jumlah Produksi/i, 'pemanfaatan'],
  [/^Total Produksi/i, 'pemanfaatan'],
  [/^Total .*Unggulan/i, 'pemanfaatan'],
  [/Aktivitas/i, 'pemanfaatan'],
  [/Keaktifan Aktivitas/i, 'pemanfaatan'],
  [/^Operasional/i, 'pemanfaatan'],
  [/dipasarkan ke Pasar/i, 'pemanfaatan'],
  [/Wilayah Tujuan/i, 'pemanfaatan'],
  [/Tujuan Pasar/i, 'pemanfaatan'],
  [/^Berapa Kali/i, 'pemanfaatan'],
  [/Bagi Hasil/i, 'pemanfaatan'],
  [/Masuk Pasar Modern/i, 'pemanfaatan'],
  [/Jenis Program/i, 'pemanfaatan'],
  [/Nama Program Kegiatan/i, 'pemanfaatan'],
  [/Total Anggaran/i, 'pemanfaatan'],
  [/Jenis Produk/i, 'pemanfaatan'],
  [/^Apakah desa (mem)?produksi/i, 'pemanfaatan'],
  [/Jumlah Tenaga Kerja Masyarakat Desa Setempat bekerja di/i, 'pemanfaatan'],
  // potensi - apa yang dimiliki desa (fallback paling umum)
  [/^(Jumlah|Total) industri/i, 'potensi'],
  [/^Jumlah (pasar|Pedagang|toko|pemilik toko)/i, 'potensi'],
  [/^(Petani|Nelayan|Buruh|PNS|Pegawai Swasta|Wiraswasta)/i, 'potensi'],
  [/Jumlah Pekerja Migran/i, 'potensi'],
  [/Panjang Garis Pantai/i, 'potensi'],
  [/^Nama .*Lokal/i, 'potensi'],
  [/Sumber pangan/i, 'potensi'],
  [/Lainnya.{0,3}[Ss]ebutkan/i, 'potensi'],
  [/^Terdapat /i, 'potensi'],
  [/^Produk Unggulan/i, 'potensi'],
  [/^Budidaya/i, 'potensi'],
  [/^Perkebunan /i, 'potensi'],
  [/^Peternakan /i, 'potensi'],
  [/^Tambang /i, 'potensi'],
  [/Berbatasan langsung/i, 'potensi'],
];

export const KELOMPOK_ORDER = ['potensi', 'kelembagaan', 'akses', 'pemanfaatan'];

export const KELOMPOK_LABEL = {
  potensi: 'Potensi / Apa yang Dimiliki',
  kelembagaan: 'Kelembagaan & Pengelolaan',
  akses: 'Akses & Dukungan',
  pemanfaatan: 'Pemanfaatan / Aktivitas',
};

export function categorizePotensiKelompok(sektor, subsektor) {
  const rules = sektor === 'Pariwisata' ? PARIWISATA_RULES : GENERIC_RULES;
  for (const [re, kelompok] of rules) {
    if (re.test(subsektor)) return kelompok;
  }
  return 'potensi';
}
