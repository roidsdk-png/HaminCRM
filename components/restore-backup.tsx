'use client';
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function RestoreBackup({ bare = false }: { bare?: boolean }) {
  const [file,setFile]=useState<File|null>(null); const [status,setStatus]=useState(''); const [busy,setBusy]=useState(false);
  async function restore(){ if(!file)return; setBusy(true); setStatus(''); try{ const response=await fetch('/api/admin/restore',{method:'POST',headers:{'content-type':'application/json'},body:await file.text()}); const result=await response.json() as {inserted?:number;error?:string}; if(!response.ok)throw new Error(result.error??'خطا'); setStatus(`${(result.inserted??0).toLocaleString('fa-IR')} رکورد جدید بازیابی شد`);}catch(e){setStatus(e instanceof Error?e.message:'خطا');}finally{setBusy(false);} }
  const content = <><p className="text-sm leading-7 text-[#6f7c76]">اطلاعات فایل با داده‌های موجود ادغام می‌شوند و هیچ رکورد فعلی حذف یا بازنویسی نمی‌شود.</p><div className="mt-4 flex flex-wrap gap-2"><Input type="file" accept="application/json,.json" onChange={(e)=>setFile(e.target.files?.[0]??null)} className="h-11 max-w-md" /><Button disabled={!file||busy} onClick={restore} className="h-11 bg-[#0b6b5b]"><Upload />{busy ? 'در حال بازیابی...' : 'بازیابی امن'}</Button></div>{status&&<p className="mt-3 text-sm text-[#176b52]">{status}</p>}</>;
  return bare ? <div>{content}</div> : <div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">بازیابی پشتیبان</h2>{content}</div>;
}
