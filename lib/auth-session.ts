const COOKIE_NAME = 'crm_session';
const DEVELOPMENT_SESSION_SECRET = 'hamin-crm-development-session-secret-only';

export type SessionPayload = {
  userId: string;
  email: string;
  displayName: string;
  role?: string;
  accessVersion?: number;
  issuedAt: number;
};

function getSessionSecret(): string {
  const configuredSecret = process.env.SESSION_SECRET?.trim();
  if (configuredSecret && configuredSecret.length >= 32) return configuredSecret;

  // Local previews are intentionally usable without a checked-in secret.
  // A deployed CRM must always have its own, non-public signing secret.
  if (process.env.NODE_ENV === 'development') return DEVELOPMENT_SESSION_SECRET;

  throw new Error('SESSION_SECRET باید در محیط اجرا تنظیم و حداقل ۳۲ کاراکتر باشد.');
}

async function getHmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionToken(payload: Omit<SessionPayload, 'issuedAt'>): Promise<string> {
  const data: SessionPayload = { ...payload, issuedAt: Date.now() };
  const jsonStr = JSON.stringify(data);
  const enc = new TextEncoder();
  const encodedPayload = Buffer.from(jsonStr).toString('base64url');
  const key = await getHmacKey();
  const signatureBytes = await crypto.subtle.sign('HMAC', key, enc.encode(encodedPayload));
  const signature = Buffer.from(signatureBytes).toString('base64url');
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    const key = await getHmacKey();
    const enc = new TextEncoder();
    const signatureBytes = Buffer.from(signature, 'base64url');
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, enc.encode(encodedPayload));
    if (!valid) return null;
    const jsonStr = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload = JSON.parse(jsonStr) as SessionPayload;
    // Sessions valid for 14 days
    if (!Number.isFinite(payload.issuedAt) || payload.issuedAt > Date.now() || Date.now() - payload.issuedAt > 14 * 24 * 60 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}
