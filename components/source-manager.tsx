'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, Pause, Play, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = { source: { id: string; slug: string; name: string; kind: string; platform: string; status: string; hasKey: boolean; lastSeen: string } };

export function SourceManager({ source }: Props) {
  const [status, setStatus] = useState(source.status); const [secret, setSecret] = useState(''); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false); const [error, setError] = useState('');
  async function act(action: 'rotate' | 'pause' | 'activate') {
    setBusy(true); setError('');
    try { const response = await fetch(`/api/admin/sources/${source.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }); const result = await response.json() as { status?: string; secret?: string; error?: string }; if (!response.ok) throw new Error(result.error ?? 'خطا در انجام عملیات'); if (result.status) setStatus(result.status); if (result.secret) setSecret(result.secret); }
    catch (e) { setError(e instanceof Error ? e.message : 'خطا'); } finally { setBusy(false); }
  }
  async function copy() { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  return <article className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="font-bold">{source.name}</h2><span className={`rounded-full px-2.5 py-1 text-xs ${status === 'active' ? 'bg-emerald-100 text-emerald-700' : status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-600'}`}>{status === 'active' ? 'فعال' : status === 'paused' ? 'متوقف' : 'در انتظار'}</span></div><p className="mt-2 text-sm text-[#748079]">{source.slug} · {source.platform} · {source.kind}</p><p className="mt-1 text-xs text-[#929b97]">آخرین دریافت: {source.lastSeen}</p></div><div className="flex flex-wrap gap-2"><Button disabled={busy} variant="outline" onClick={() => act('rotate')}><RotateCw />{source.hasKey || secret ? 'تعویض کلید' : 'ساخت کلید'}</Button>{status === 'active' ? <Button disabled={busy} variant="outline" onClick={() => act('pause')}><Pause />توقف</Button> : <Button disabled={busy || (!source.hasKey && !secret)} variant="outline" onClick={() => act('activate')}><Play />فعال‌سازی</Button>}</div></div>
    {secret && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-sm font-bold text-amber-900"><KeyRound size={17} />این کلید فقط همین یک‌بار نمایش داده می‌شود</div><div className="mt-3 flex gap-2"><code dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs">{secret}</code><Button onClick={copy} variant="outline" size="icon">{copied ? <Check /> : <Copy />}</Button></div></div>}{error && <p className="mt-3 text-sm text-red-600">{error}</p>}
  </article>;
}
