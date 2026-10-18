import { and, eq, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import type { ChatGPTUser } from '@/app/chatgpt-auth';

export type AdminRole = 'owner' | 'manager' | 'viewer';
export async function getAdminRole(user: ChatGPTUser | null): Promise<AdminRole | null> {
  if (process.env.NODE_ENV === 'development') return 'owner'; if (!user) return null;
  const bootstrapOwnerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'owner@hamin.local';
  if (user.email.trim().toLowerCase() === bootstrapOwnerEmail) return 'owner';
  const db=getDb(); const [admin]=await db.select().from(administrators).where(and(eq(administrators.active,true),or(eq(administrators.userId,user.userId),eq(administrators.email,user.email)))).limit(1);
  if (!admin) return null;
  // Standalone sessions carry the exact access-record version. Any role,
  // password, or active-state change revokes the previous session immediately.
  if (user.sessionIssuedAt && user.accessVersion !== admin.updatedAt.getTime()) return null;
  return admin.role;
}
export function can(role: AdminRole|null, need: 'read'|'manage'|'owner'){ if(!role)return false; if(need==='read')return true; if(need==='manage')return role==='owner'||role==='manager'; return role==='owner'; }
