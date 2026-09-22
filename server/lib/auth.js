import { randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';

const COOKIE_NAME = 'ded_session';
const SESSION_TTL_DAYS = 30;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`${name} belum diatur di server/.env`);
    err.code = 'MISSING_ENV';
    throw err;
  }
  return v;
}

// Runs once at server startup. If no admin exists yet, mint a single-use
// admin registration code from ADMIN_BOOTSTRAP_CODE so the first deploy
// always has a way in - without this there would be no way to create the
// first account at all (every other role needs an admin-generated code).
export function bootstrapAdmin() {
  const bootstrapCode = process.env.ADMIN_BOOTSTRAP_CODE;
  if (!bootstrapCode) return;

  const anyAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (anyAdmin) return;

  const existing = db.prepare('SELECT id FROM kode_registrasi WHERE kode = ?').get(bootstrapCode);
  if (existing) return;

  db.prepare(
    `INSERT INTO kode_registrasi (kode, role, dibuat_oleh, dibuat_pada) VALUES (?, 'admin', 'system:bootstrap', ?)`
  ).run(bootstrapCode, new Date().toISOString());
  console.log('Kode registrasi admin pertama dibuat dari ADMIN_BOOTSTRAP_CODE.');
}

export function generateKode() {
  // 10 base32-ish uppercase alnum chars, grouped for readability when
  // dictated over phone/WhatsApp (e.g. "K7QM-3RXP").
  const raw = randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function signSession(user) {
  const secret = requireEnv('SESSION_SECRET');
  return jwt.sign(
    { uid: user.id, email: user.email, role: user.role, kode_desa: user.kode_desa, kabupaten: user.kabupaten },
    secret,
    { expiresIn: `${SESSION_TTL_DAYS}d` }
  );
}

export function setSessionCookie(res, user) {
  const token = signSession(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

export function getSessionUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const secret = requireEnv('SESSION_SECRET');
    const payload = jwt.verify(token, secret);
    return { id: payload.uid, email: payload.email, role: payload.role, kode_desa: payload.kode_desa, kabupaten: payload.kabupaten };
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum masuk. Silakan login.', code: 'UNAUTHENTICATED' });
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Anda tidak punya akses ke fitur ini.', code: 'FORBIDDEN' });
    }
    next();
  };
}

// ---------- Google OAuth (plain fetch, no SDK - same pattern as lib/llm.js) ----------

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function buildGoogleAuthUrl({ redirectUri, state }) {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(code, redirectUri) {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange gagal: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error(`Gagal ambil profil Google: ${profileRes.status}`);
  const profile = await profileRes.json();
  return { email: profile.email, nama: profile.name };
}

// In-memory store for the short-lived OAuth `state` -> kode registrasi
// mapping. A signed/encoded state isn't needed for security here (the kode
// itself is re-validated against the DB on callback regardless of what the
// client claims), just to survive the redirect round-trip. Single-process
// deployment (Railway) makes an in-memory Map fine; if this ever runs
// multi-instance, move this to the DB or a shared cache.
const pendingState = new Map();

export function createOAuthState(kode) {
  const state = randomUUID();
  pendingState.set(state, { kode: kode || null, createdAt: Date.now() });
  // Best-effort cleanup of stale entries (>10 min old) on each call.
  for (const [key, val] of pendingState) {
    if (Date.now() - val.createdAt > 10 * 60 * 1000) pendingState.delete(key);
  }
  return state;
}

export function consumeOAuthState(state) {
  const entry = pendingState.get(state);
  pendingState.delete(state);
  return entry?.kode ?? null;
}

// ---------- registration / login ----------

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function registerWithKode(email, nama, kode) {
  const kodeRow = db.prepare('SELECT * FROM kode_registrasi WHERE kode = ?').get(kode);
  if (!kodeRow) {
    const err = new Error('Kode registrasi tidak ditemukan.');
    err.code = 'INVALID_CODE';
    throw err;
  }
  if (kodeRow.dipakai_oleh_user_id) {
    const err = new Error('Kode registrasi sudah pernah dipakai.');
    err.code = 'CODE_USED';
    throw err;
  }

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO users (email, nama, role, kode_desa, kabupaten, dibuat_pada, login_terakhir)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(email, nama, kodeRow.role, kodeRow.kode_desa, kodeRow.kabupaten, now, now);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    db.prepare('UPDATE kode_registrasi SET dipakai_oleh_user_id = ?, dipakai_pada = ? WHERE id = ?').run(
      user.id,
      now,
      kodeRow.id
    );
    db.exec('COMMIT');
    return user;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function touchLogin(userId) {
  db.prepare('UPDATE users SET login_terakhir = ? WHERE id = ?').run(new Date().toISOString(), userId);
}
