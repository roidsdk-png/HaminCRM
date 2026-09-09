import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import type { ChatGPTUser } from '@/app/chatgpt-auth';

export type AdminRole = 'owner' | 'manager' | 'viewer';
export async function getAdminRole(user: ChatGPTUser | null): Promise<AdminRole | null> {
  if (process.env.NODE_ENV === 'development') return 'owner'; if (!user) return null;
  const db=getDb(); const [admin]=await db.select().from(administrators).where(and(eq(administrators.active,true),or(eq(administrators.userId,user.userId),eq(administrators.email,user.email)))).limit(1);
  if(admin)return admin.role; const count=await db.get<{count:number}>(sql`SELECT COUNT(*) count FROM administrators WHERE active=1`); return Number(count?.count??0)===0?'owner':null;
}
export function can(role: AdminRole|null, need: 'read'|'manage'|'owner'){ if(!role)return false; if(need==='read')return true; if(need==='manage')return role==='owner'||role==='manager'; return role==='owner'; }
