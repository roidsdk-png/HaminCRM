const BASE = 'http://127.0.0.1:9898/backups';

export async function backupService(method: 'GET' | 'POST' | 'DELETE', filename?: string) {
  const token = process.env.BACKUP_SERVICE_TOKEN?.trim();
  if (!token || token.length < 32) throw new Error('سرویس بکاپ CRM روی این محیط تنظیم نشده است.');
  if (filename && !/^socialcrm-\d{8}T\d{6}Z\.sqlite\.gz$/.test(filename)) throw new Error('نام فایل بکاپ نامعتبر است.');
  const path = filename ? `${BASE}/${filename}` : BASE;
  return fetch(path, { method, headers: { 'X-Backup-Service-Token': token }, cache: 'no-store' });
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('host');
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
