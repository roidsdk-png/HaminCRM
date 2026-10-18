const ITERATIONS = 210_000;
const KEY_LENGTH = 32;

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2_sha256$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterationsText, saltText, expectedText] = encoded.split('$');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2_sha256' || !Number.isInteger(iterations) || iterations < 100_000 || !saltText || !expectedText) return false;
  try {
    const actual = await derive(password, fromBase64Url(saltText), iterations);
    return constantTimeEqual(actual, fromBase64Url(expectedText));
  } catch {
    return false;
  }
}

export async function secureTextEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  return constantTimeEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations }, key, KEY_LENGTH * 8);
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}
