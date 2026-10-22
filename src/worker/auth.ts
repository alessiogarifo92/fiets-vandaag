// Identity without login (docs/architecture.md §2): a random device id and secret, of which only
// sha256(secret) is stored. Every call after registration carries `Authorization: Bearer <id>.<secret>`.

const encoder = new TextEncoder();

export interface DeviceRow {
  id: string;
  secret_hash: string;
  lang: string;
  push_endpoint: string;
  p256dh: string;
  auth: string;
  last_seen_at: number;
}

/** last_seen_at is refreshed at most this often, to keep D1 writes low (it only feeds the 60-day retention). */
export const SEEN_REFRESH_MS = 60 * 60 * 1000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * Constant-time string comparison. Both sides are hashed first, so the comparison runs over equal lengths
 * and does not reveal the length of the expected value either.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 32 random bytes, base64url (43 characters). */
export function newSecret(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function newDeviceId(): string {
  return crypto.randomUUID();
}

const BEARER_RE = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

export function parseBearer(header: string | null): { id: string; secret: string } | null {
  const m = header ? BEARER_RE.exec(header) : null;
  return m ? { id: m[1]!, secret: m[2]! } : null;
}

/** The calling device, or null for a missing, malformed or wrong credential. */
export async function authenticate(request: Request, db: D1Database, now: number): Promise<DeviceRow | null> {
  const cred = parseBearer(request.headers.get('authorization'));
  if (!cred) return null;
  const row = await db
    .prepare(
      'SELECT id, secret_hash, lang, push_endpoint, p256dh, auth, last_seen_at FROM devices WHERE id = ?',
    )
    .bind(cred.id)
    .first<DeviceRow>();
  // Hash and compare even for an unknown id, so both paths cost about the same.
  const given = await sha256Hex(cred.secret);
  const match = await safeEqual(given, row?.secret_hash ?? '');
  if (!row || !match) return null;
  if (now - row.last_seen_at >= SEEN_REFRESH_MS) {
    await db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, row.id).run();
    row.last_seen_at = now;
  }
  return row;
}
