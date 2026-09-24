// Shared potensi x kinerja quadrant logic - one median-split definition
// used by both Analisis Kuadran (province-wide scatter, all 4 quadrants)
// and Analisis BUMDes's "Desa Prioritas" panel (kuadran II only, scoped to
// one kabupaten or the whole provinsi). Previously each computed its own
// median split independently; if the definition of "prioritas" ever
// changes it now only needs to change here.

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// rows: [{ ...anything, potensi: number, skor: number }] - skor must
// already be filtered to non-null by the caller (a desa with no Dimensi
// Ekonomi score can't be placed on the kinerja axis).
export function classifyKuadran(rows) {
  const potensiMedian = median(rows.map((r) => r.potensi));
  const skorMedian = median(rows.map((r) => r.skor));
  const desa = rows.map((r) => {
    const potensiTinggi = r.potensi >= potensiMedian;
    const kinerjaTinggi = r.skor >= skorMedian;
    let kuadran;
    if (potensiTinggi && kinerjaTinggi) kuadran = 'I - Potensi Tinggi, Kinerja Tinggi';
    else if (potensiTinggi && !kinerjaTinggi) kuadran = 'II - Potensi Tinggi, Kinerja Rendah';
    else if (!potensiTinggi && !kinerjaTinggi) kuadran = 'III - Potensi Rendah, Kinerja Rendah';
    else kuadran = 'IV - Potensi Rendah, Kinerja Tinggi';
    return { ...r, kuadran };
  });
  return { potensiMedian, skorMedian, desa };
}

// Just kuadran II ("potensi tinggi, kinerja rendah" - the priority
// intervention candidates), ranked by potensi desc then skor asc, top N.
export function listPrioritasDesa(rows, limit = 12) {
  return classifyKuadran(rows)
    .desa.filter((d) => d.kuadran === 'II - Potensi Tinggi, Kinerja Rendah')
    .sort((a, b) => b.potensi - a.potensi || a.skor - b.skor)
    .slice(0, limit);
}
