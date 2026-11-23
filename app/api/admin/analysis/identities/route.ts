import { getChatGPTUser } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import {
  AnalysisError,
  analysisDb,
  analysisErrorResponse,
  readAnalysisBody,
  sameOrigin,
} from '@/lib/analysis/bridge';

export const dynamic = 'force-dynamic';

async function authorize(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !can(await getAdminRole(user), 'owner'))
    throw new AnalysisError(
      403,
      'forbidden',
      'تأیید پیوند هویت به دسترسی مالک نیاز دارد.',
    );
  if (request.method !== 'GET' && !sameOrigin(request))
    throw new AnalysisError(403, 'invalid_origin', 'مبدأ درخواست معتبر نیست.');
  return user;
}

export async function GET(request: Request) {
  try {
    await authorize(request);
    const db = analysisDb();
    const rows = await db
      .prepare(`SELECT g.id,g.basis,g.verified_at,g.revoked_at,
      (SELECT COUNT(*) FROM analysis_identity_members WHERE group_id=g.id) AS member_count
      FROM analysis_identity_groups g ORDER BY g.verified_at DESC LIMIT 200`)
      .all<{
        id: string;
        basis: string;
        verified_at: number;
        revoked_at: number | null;
        member_count: number;
      }>();
    const members = await db
      .prepare(`SELECT im.group_id,c.id,c.name,s.name AS source_name
      FROM analysis_identity_members im JOIN contacts c ON c.id=im.contact_id
      JOIN sources s ON s.id=c.source_id
      WHERE im.group_id IN (SELECT id FROM analysis_identity_groups ORDER BY verified_at DESC LIMIT 200)
      ORDER BY c.name,c.id`)
      .all<{
        group_id: string;
        id: string;
        name: string | null;
        source_name: string;
      }>();
    return Response.json(
      {
        items: rows.results.map((row) => ({
          id: row.id,
          basis: row.basis,
          verifiedAt: row.verified_at,
          revokedAt: row.revoked_at,
          members: members.results
            .filter((member) => member.group_id === row.id)
            .map((member) => ({
              id: member.id,
              name: member.name || 'مخاطب بدون نام',
              sourceName: member.source_name,
            })),
        })),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return analysisErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorize(request);
    const body = await readAnalysisBody(request);
    const contacts = body.contactIds;
    const basis = typeof body.basis === 'string' ? body.basis.trim() : '';
    if (
      !Array.isArray(contacts) ||
      contacts.length < 2 ||
      contacts.length > 50 ||
      contacts.some((id) => typeof id !== 'string' || !id || id.length > 300) ||
      new Set(contacts).size !== contacts.length ||
      basis.length < 10 ||
      basis.length > 2000 ||
      body.confirmed !== true
    )
      throw new AnalysisError(
        400,
        'invalid_identity',
        'حداقل دو مخاطب، مبنای تأیید و تأیید صریح یکسان‌بودن فرد لازم است.',
      );
    const db = analysisDb();
    const marks = contacts.map(() => '?').join(',');
    const existing = await db
      .prepare(`SELECT id FROM contacts WHERE id IN (${marks})`)
      .bind(...contacts)
      .all();
    if (existing.results.length !== contacts.length)
      throw new AnalysisError(
        400,
        'invalid_contact',
        'بعضی مخاطبان دیگر در CRM وجود ندارند.',
      );
    const linked = await db
      .prepare(
        `SELECT contact_id FROM analysis_identity_members WHERE contact_id IN (${marks})`,
      )
      .bind(...contacts)
      .all();
    if (linked.results.length)
      throw new AnalysisError(
        409,
        'identity_conflict',
        'یک مخاطب قبلاً پیوند فعال دارد. برای اصلاح، پیوند قبلی را لغو کنید.',
      );
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db
          .prepare(
            'INSERT INTO analysis_identity_groups(id,basis,members_json,verified_by,verified_at) VALUES(?,?,?,?,?)',
          )
          .bind(id, basis, JSON.stringify(contacts), user.userId, Date.now()),
        ...contacts.map((contact) =>
          db
            .prepare(
              'INSERT INTO analysis_identity_members(contact_id,group_id) VALUES(?,?)',
            )
            .bind(contact, id),
        ),
      ]);
    } catch {
      throw new AnalysisError(
        409,
        'identity_conflict',
        'ثبت پیوند انجام نشد. ممکن است هم‌زمان مخاطب حذف یا پیوند دیگری ثبت شده باشد.',
      );
    }
    return Response.json({ id, syncRequired: true }, { status: 201 });
  } catch (error) {
    return analysisErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await authorize(request);
    const id = new URL(request.url).searchParams.get('id');
    if (!id || id.length > 100)
      throw new AnalysisError(
        400,
        'invalid_identity',
        'شناسهٔ پیوند معتبر نیست.',
      );
    const db = analysisDb();
    const group = await db
      .prepare(
        'SELECT id FROM analysis_identity_groups WHERE id=? AND revoked_at IS NULL',
      )
      .bind(id)
      .first();
    if (!group)
      throw new AnalysisError(404, 'not_found', 'پیوند فعال پیدا نشد.');
    await db.batch([
      db
        .prepare(
          'UPDATE analysis_identity_groups SET revoked_at=?,revoked_by=? WHERE id=? AND revoked_at IS NULL',
        )
        .bind(Date.now(), user.userId, id),
      db
        .prepare('DELETE FROM analysis_identity_members WHERE group_id=?')
        .bind(id),
    ]);
    return Response.json({ revoked: true, syncRequired: true });
  } catch (error) {
    return analysisErrorResponse(error);
  }
}
