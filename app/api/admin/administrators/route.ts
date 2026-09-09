import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import { can, getAdminRole } from '@/lib/admin-access';
import { writeAudit } from '@/lib/audit';

export async function POST(request:Request){const user=await getChatGPTUser();const role=await getAdminRole(user);if(!can(role,'owner'))return NextResponse.json({error:'Forbidden'},{status:403});const origin=request.headers.get('origin');const host=request.headers.get('host');if(origin&&host&&new URL(origin).host!==host)return NextResponse.json({error:'Invalid origin'},{status:403});const body=await request.json() as {email?:string;role?:string};if(!body.email||!/^\S+@\S+\.\S+$/.test(body.email)||!['owner','manager','viewer'].includes(body.role??''))return NextResponse.json({error:'اطلاعات نامعتبر است'},{status:400});await getDb().insert(administrators).values({id:crypto.randomUUID(),userId:body.email.toLowerCase(),email:body.email.toLowerCase(),role:body.role as 'owner'|'manager'|'viewer'}).onConflictDoUpdate({target:administrators.email,set:{role:body.role as 'owner'|'manager'|'viewer',active:true,updatedAt:new Date()}});await writeAudit(user,'administrator.saved','administrator',body.email,{role:body.role});return NextResponse.json({ok:true});}
