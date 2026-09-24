import { useEffect, useState } from 'react';
import { api } from './api';

// Module-level cache (fetched once per page load, not per component) - this
// is static reference data (Buku Panduan Indeks Desa 2026), never changes
// while the app is running.
let skorPromise = null;
let potensiPromise = null;

function useDefinisi(getPromise, setPromise, fetcher) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!getPromise()) setPromise(fetcher().catch(() => ({})));
    getPromise().then((res) => { if (!cancelled) setData(res); });
    return () => { cancelled = true; };
  }, []);

  return data;
}

export function useDefinisiSkor() {
  return useDefinisi(() => skorPromise, (p) => { skorPromise = p; }, api.definisiSkor) || {};
}

export function useDefinisiPotensi() {
  return useDefinisi(() => potensiPromise, (p) => { potensiPromise = p; }, api.definisiPotensi) || {};
}

// Formats a { definisi, klasifikasi } entry (or null, when this indikator
// isn't in the partial-coverage dataset - see server/lib/definisiIndikator.js)
// into a plain-text tooltip string.
export function formatTooltip(def) {
  if (!def) return undefined;
  const lines = [];
  if (def.definisi) lines.push(def.definisi);
  if (def.klasifikasi?.length) {
    lines.push(def.klasifikasi.map((k) => `${k.level}: ${k.label}`).join('\n'));
  }
  return lines.join('\n\n') || undefined;
}
