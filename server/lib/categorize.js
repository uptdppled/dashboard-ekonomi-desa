// Sector rules for the "Rekap Isu" sheet, ported from the PowerShell rules
// used to build kamus-data/Kamus_Data_Ekonomi_Desa.xlsx. Order matters: the
// first matching rule wins, most-specific first.
const SECTOR_RULES = [
  [/Perikanan|Lobster|Udang|Kepiting|Teripang|Rajungan|Rumput Laut|Tuna|Abalon|Kerapu|Kakap|Napoleon|Tiram|Kerang|Budidaya Lele|Tilapia|Budidaya Nila|Gurame|Ikan Mas|Bandeng|Ikan Hias|Garam laut|produksi garam|Pabrik Es|pasar ikan|[Pp]elelangan [Ii]kan|Tambatan perahu|pelabuhan|dermaga|Panjang Garis Pantai|Berbatasan langsung dengan laut/, 'Perikanan'],
  [/Peternakan|Ternak (Ayam|Bebek|Kambing|Sapi|Babi|Kerbau)/, 'Peternakan'],
  [/Wisata|Desa Wisata|POKDARWIS|Objek wisata/, 'Pariwisata'],
  [/Perkebunan|Sawit|Karet|Kopi|Kakao|Kelapa/, 'Perkebunan'],
  [/Kerajinan|Industri Rumah Tangga|Industri Kecil|UMKM Unggulan|industri mikro|industri menengah/, 'Kerajinan/Industri'],
  [/Tambang|Pertambangan|Golongan [ABC] Lainnya|Minyak Bumi|Gas Alam|Batu Bara|Bauksit|Nikel$/, 'Pertambangan'],
  [/Petani (Laki|Perempuan)|^Nelayan (Laki|Perempuan)|Buruh (Tani|Nelayan|Pabrik)|^PNS (Laki|Perempuan)|Pegawai Swasta (Laki|Perempuan)|Wiraswasta|Pekerja Migran|Pekerja Informal/, 'Ketenagakerjaan'],
  [/Ekspor|Pasar Modern|Komoditas .*Unggulan|Wilayah Tujuan Pasar|yang dipasarkan ke Pasar|Tanaman Obat Unggulan/, 'Pemasaran/Ekspor'],
  [/BKAD|Badan Kerjasama Antar[- ]?Desa|Perjanjian Kerjasama|Bidang Kerjasama/, 'Kerjasama Antar Desa'],
  [/Pertanian|Tanaman Pangan|Padi|Jagung|Hortikultura|Sayur|Buah|Jumlah Produksi|Total Produksi|Nama .*Lokal \(sebutkan\)|Sumber pangan/, 'Pertanian'],
  [/Koperasi di Desa|Ketua Pelaksana|^Nama Sekretaris$|^Nama Bendahara$|Jumlah pasar|Pedagang di pasar|Pasar Hewan|Pasar Pelelangan Ikan|toko *\/ *warung kelontong|Agen Penjual LPG|Bank Umum|Bank Swasta/, 'Fasilitas Perdagangan/Keuangan'],
];

export function categorizeSektor(header) {
  for (const [re, label] of SECTOR_RULES) {
    if (re.test(header)) return label;
  }
  return null;
}
