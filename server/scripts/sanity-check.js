import { db } from '../db.js';

const desa = await db.prepare("SELECT * FROM desa WHERE nama_desa = 'TABANIO'").get();
console.log('desa:', desa);

if (desa) {
  const potensi = await db
    .prepare("SELECT sektor, subsektor, nilai FROM potensi_desa WHERE kode_desa = ? AND nilai != 'Tidak Ada' LIMIT 10")
    .all(desa.kode_desa);
  console.log('potensi (non Tidak-Ada, sample):', potensi);

  const skor = await db
    .prepare('SELECT sub_dimensi, nama_indikator, skor FROM skor_indikator WHERE kode_desa = ? LIMIT 5')
    .all(desa.kode_desa);
  console.log('skor sample:', skor);
}

const counts = await db
  .prepare(
    'SELECT (SELECT COUNT(*) FROM desa) AS desa, (SELECT COUNT(*) FROM skor_indikator) AS skor, ' +
    '(SELECT COUNT(*) FROM jawaban_kuesioner) AS jawaban, (SELECT COUNT(*) FROM potensi_desa) AS potensi, ' +
    '(SELECT COUNT(*) FROM ekosistem_desa) AS ekosistem'
  )
  .get();
console.log('counts:', counts);
