import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { administrators, appSettings } from '@/db/schema';
import { secureTextEqual } from '@/lib/password';

export const MAGIC_ACCESS_SETTING_KEY = 'owner_magic_access_link';
export const MAGIC_ACCESS_USER_ID = 'system:magic-link-owner';
export const MAGIC_ACCESS_EMAIL = 'magic-link@hamin.local';

export type MagicAccessConfig = {
  active: boolean;
  tokenHash: string;
  createdAt: string;
  createdBy: string;
};

export async function hashMagicAccessToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Buffer.from(digest).toString('base64url');
}

export function createMagicAccessToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export async function getMagicAccessConfig(): Promise<MagicAccessConfig | null> {
  const [setting] = await getDb().select().from(appSettings).where(eq(appSettings.key, MAGIC_ACCESS_SETTING_KEY)).limit(1);
  if (!setting?.value || typeof setting.value !== 'object') return null;
  const value = setting.value as Partial<MagicAccessConfig>;
  if (typeof value.active !== 'boolean' || typeof value.tokenHash !== 'string' || typeof value.createdAt !== 'string') return null;
  return {
    active: value.active,
    tokenHash: value.tokenHash,
    createdAt: value.createdAt,
    createdBy: typeof value.createdBy === 'string' ? value.createdBy : '',
  };
}

export async function validateMagicAccessToken(token: string) {
  if (!token || token.length > 128) return null;
  const config = await getMagicAccessConfig();
  if (!config?.active || !config.tokenHash) return null;
  const candidateHash = await hashMagicAccessToken(token);
  if (!(await secureTextEqual(candidateHash, config.tokenHash))) return null;

  const [admin] = await getDb().select().from(administrators).where(eq(administrators.userId, MAGIC_ACCESS_USER_ID)).limit(1);
  return admin?.active && admin.role === 'owner' ? admin : null;
}
