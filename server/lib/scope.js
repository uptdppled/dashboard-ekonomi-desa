import { db } from '../db.js';

function forbidden(msg = 'Anda tidak punya akses ke data ini.') {
  const err = new Error(msg);
  err.code = 'FORBIDDEN';
  err.status = 403;
  return err;
}

// Merges a request's query filters with the caller's forced scope. admin/
// provinsi pass through unchanged; kabupaten users get `kabupaten` pinned to
// their own regardless of what the client sent; desa users additionally get
// `kode_desa` pinned, which - once filterClauses() honors it - collapses any
// list-style endpoint down to just their own village. This runs server-side
// on every request, independent of what the frontend hides, so a desa/
// kabupaten account can't see other regions by calling the API directly.
export function mergeScope(user, query) {
  if (!user || user.role === 'admin' || user.role === 'provinsi') return { ...query };
  if (user.role === 'kabupaten') return { ...query, kabupaten: user.kabupaten };
  if (user.role === 'desa') return { ...query, kabupaten: user.kabupaten, kode_desa: user.kode_desa };
  throw forbidden();
}

// For routes keyed by a specific :kode path param (desa detail, per-desa
// recommendation). Throws unless the caller is allowed to see that village.
export function assertDesaAccess(user, kodeDesa) {
  if (!user || user.role === 'admin' || user.role === 'provinsi') return;
  if (user.role === 'desa') {
    if (kodeDesa !== user.kode_desa) throw forbidden();
    return;
  }
  if (user.role === 'kabupaten') {
    const desaRow = db.prepare('SELECT kabupaten FROM desa WHERE kode_desa = ?').get(kodeDesa);
    if (!desaRow || desaRow.kabupaten !== user.kabupaten) throw forbidden();
    return;
  }
  throw forbidden();
}

// For routes keyed by a :nama (kabupaten) path param. desa accounts never
// have a legitimate kabupaten-wide view, even their own.
export function assertKabupatenAccess(user, kabupatenName) {
  if (!user || user.role === 'admin' || user.role === 'provinsi') return;
  if (user.role === 'kabupaten' && kabupatenName === user.kabupaten) return;
  throw forbidden();
}

// Province-wide view (all kabupaten at once) - only admin/provinsi ever see
// beyond a single kabupaten, so desa and kabupaten accounts are always
// rejected here regardless of which kabupaten they're pinned to.
export function assertProvinsiAccess(user) {
  if (!user || user.role === 'admin' || user.role === 'provinsi') return;
  throw forbidden();
}

// Express error-handling wrapper for the two assert* helpers above, so
// route handlers can just call assertX(...) and let this catch/respond.
// Wraps with Promise.resolve().catch() rather than a plain try/catch because
// `fn` may be async - a throw inside an async function surfaces as a
// rejected promise, not a synchronous exception, even when it happens
// before the first `await`.
export function guard(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message, code: 'FORBIDDEN' });
      next(err);
    });
  };
}
