import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getExportRows } from '@/lib/reports';
import { writeAudit } from '@/lib/audit';
import { can, getAdminRole } from '@/lib/admin-access';

export async function GET(request: Request) {
  const user = await getChatGPTUser(); const role = await getAdminRole(user);
  if (!can(role, 'read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const url = new URL(request.url); const type = url.searchParams.get('type') ?? 'users'; const format = url.searchParams.get('format') ?? 'csv';
  try {
    const data = await getExportRows(type, {
      source: url.searchParams.get('source') ?? '', section: url.searchParams.get('section') ?? '',
      province: url.searchParams.get('province') ?? '', gender: url.searchParams.get('gender') ?? '',
      ageFrom: url.searchParams.get('ageFrom') ?? '', ageTo: url.searchParams.get('ageTo') ?? '',
      from: validDate(url.searchParams.get('from')), to: validDate(url.searchParams.get('to')),
    });
    await writeAudit(user, 'report.exported', 'report', type, { format, rows: data.rows.length });
    if (format === 'xls') return new Response(toExcelXml(data.headers, data.rows), { headers: { 'content-type': 'application/vnd.ms-excel; charset=utf-8', 'content-disposition': `attachment; filename="hamin-${type}.xls"`, 'cache-control': 'no-store' } });
    return new Response('\ufeff' + [data.headers, ...data.rows].map((row) => row.map(csvCell).join(',')).join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="hamin-${type}.csv"`, 'cache-control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Export failed' }, { status: 400 }); }
}
function validDate(value: string | null) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined; }
function safe(value: unknown) { let text = ''; if (typeof value === 'string') text = value; else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = String(value); else if (value && typeof value === 'object') text = JSON.stringify(value); return /^[=+\-@]/.test(text) ? `'${text}` : text; }
function csvCell(value: unknown) { return `"${safe(value).replaceAll('"', '""')}"`; }
function xml(value: unknown) { return safe(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;'); }
function toExcelXml(headers: string[], rows: unknown[][]) { const line = (cells: unknown[]) => `<Row>${cells.map((cell) => `<Cell><Data ss:Type="String">${xml(cell)}</Data></Cell>`).join('')}</Row>`; return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${line(headers)}${rows.map(line).join('')}</Table></Worksheet></Workbook>`; }
