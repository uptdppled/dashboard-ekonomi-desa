export function cleanParams(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v) out[k] = v;
  }
  return out;
}
