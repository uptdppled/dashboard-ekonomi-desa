import { db } from '../db.js';
// Diimpor sebagai modul JSON (bukan readFileSync) agar ikut ter-bundle ke
// Vercel - alasan yang sama dengan data/panduan di definisiIndikator.js.
import pemetaan from '../data/rujukan-intervensi.json' with { type: 'json' };

// BANUA INSIGHT - Rujukan Intervensi. Deterministik, tanpa AI: jumlah desa
// gap dihitung dari skor_indikator, lalu dipasangkan dengan pemetaan statis
// indikator -> urusan/program/kegiatan (nomenklatur Kepmendagri 050 /
// Permendagri 90), dipisah kewenangan kabupaten/kota (`kab`) dan provinsi
// (`prov`) sesuai UU 23/2014. Sengaja tidak memuat estimasi dana: besaran
// anggaran ditentukan SKPD berdasarkan SSH masing-masing.

const GAP_THRESHOLD = 0.6; // sama dengan insight.js
const PRIORITAS_TINGGI = 0.3; // >= 30% desa dinilai gap
const PRIORITAS_SEDANG = 0.1;
export const LEVELS = ['kab', 'prov'];
const PERAN_RANK = { Utama: 3, Pendukung: 2, Fasilitasi: 1 };

function prioritas(persen) {
  if (persen >= PRIORITAS_TINGGI) return 'Tinggi';
  if (persen >= PRIORITAS_SEDANG) return 'Sedang';
  return 'Rendah';
}

function scopeWhere(scope) {
  const clauses = [];
  const params = [];
  for (const field of ['kabupaten', 'kecamatan', 'kode_desa']) {
    if (scope[field]) {
      clauses.push(`d.${field} = ?`);
      params.push(scope[field]);
    }
  }
  if (scope.dimensi) {
    clauses.push('si.dimensi = ?');
    params.push(scope.dimensi);
  }
  return { sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params };
}

export async function buildRujukanIntervensi(scope, level) {
  if (!LEVELS.includes(level)) {
    const err = new Error(`Parameter level harus salah satu dari: ${LEVELS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const keys = pemetaan.indikator.map((e) => e.key);
  const where = scopeWhere(scope);
  const rows = await db
    .prepare(
      `SELECT si.nama_indikator, si.dimensi, si.sub_dimensi,
              COUNT(*) AS total_dinilai,
              SUM(CASE WHEN si.skor / si.bobot_maks < ? THEN 1 ELSE 0 END) AS jumlah_gap
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.bobot_maks > 0 AND si.nama_indikator IN (${keys.map(() => '?').join(', ')}) ${where.sql}
       GROUP BY si.nama_indikator, si.dimensi, si.sub_dimensi`
    )
    .all(GAP_THRESHOLD, ...keys, ...where.params);
  const statByKey = new Map(rows.map((r) => [r.nama_indikator, r]));

  const indikator = [];
  for (const e of pemetaan.indikator) {
    const s = statByKey.get(e.key);
    if (!s) continue; // tersaring oleh filter dimensi
    const totalDinilai = Number(s.total_dinilai);
    const jumlahGap = Number(s.jumlah_gap);
    if (!jumlahGap) continue;
    const persenGap = jumlahGap / totalDinilai;
    indikator.push({
      key: e.key,
      label: e.key.replace(/^SKOR /i, ''),
      induk: e.induk,
      dimensi: s.dimensi,
      subDimensi: s.sub_dimensi,
      totalDinilai,
      jumlahGap,
      persenGap,
      prioritas: prioritas(persenGap),
      rujukan: e[level],
      // Untuk indikator di luar kewenangan level ini: apakah level lain berwenang.
      kewenanganLain: e[level === 'kab' ? 'prov' : 'kab'].length ? (level === 'kab' ? 'Provinsi' : 'Kabupaten/Kota') : null,
      pusat: e.pusat,
      desa: e.desa,
      catatan: e.catatan,
    });
  }
  indikator.sort((a, b) => b.jumlahGap - a.jumlahGap);

  // Kelompokkan per bidang urusan. Satu indikator bisa muncul di beberapa
  // urusan (mis. pendidikan nonformal: Dinas Pendidikan & Dinas Tenaga Kerja).
  const byUrusan = new Map();
  for (const ind of indikator) {
    for (const r of ind.rujukan) {
      const u = byUrusan.get(r.kodeUrusan) || {
        kodeUrusan: r.kodeUrusan,
        namaUrusan: pemetaan.urusan[r.kodeUrusan],
        skpd: new Set(),
        kasusGapUtama: 0,
        jumlahUtama: 0,
        indikator: [],
      };
      u.skpd.add(r.skpd);
      if (r.peran === 'Utama') {
        u.kasusGapUtama += ind.jumlahGap;
        u.jumlahUtama++;
      }
      u.indikator.push({
        key: ind.key,
        label: ind.label,
        induk: ind.induk,
        jumlahGap: ind.jumlahGap,
        persenGap: ind.persenGap,
        prioritas: ind.prioritas,
        catatan: ind.catatan,
        ...r,
      });
      byUrusan.set(r.kodeUrusan, u);
    }
  }
  const urusan = [...byUrusan.values()]
    .map((u) => ({
      ...u,
      skpd: [...u.skpd],
      indikator: u.indikator.sort(
        (a, b) => PERAN_RANK[b.peran] - PERAN_RANK[a.peran] || b.jumlahGap - a.jumlahGap
      ),
    }))
    .sort((a, b) => b.kasusGapUtama - a.kasusGapUtama || b.indikator.length - a.indikator.length);

  const diLuarKewenangan = indikator
    .filter((i) => i.rujukan.length === 0)
    .map(({ key, label, induk, jumlahGap, persenGap, prioritas: p, kewenanganLain, pusat, desa, catatan }) => ({
      key, label, induk, jumlahGap, persenGap, prioritas: p, kewenanganLain, pusat, desa, catatan,
    }));

  return {
    level,
    sumber: pemetaan.sumber,
    ringkasan: {
      indikatorGap: indikator.length,
      indikatorDalamKewenangan: indikator.length - diLuarKewenangan.length,
      jumlahUrusan: urusan.length,
      prioritasTinggi: indikator.filter((i) => i.prioritas === 'Tinggi' && i.rujukan.length).length,
    },
    urusan,
    indikator,
    diLuarKewenangan,
  };
}
