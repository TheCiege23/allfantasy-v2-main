/**
 * POST /api/admin/chat/migrate-public-photos — move chat photos still in PUBLIC Blob storage into
 * private chat storage. Body: `{ mode?: 'dry-run' | 'apply' | 'delete-public', limit?, cursor? }`,
 * defaulting to `dry-run`. The work, and why each mode is shaped the way it is, lives in
 * `lib/chat-core/publicPhotoMigration.ts`; this file is the gate and the audit trail.
 *
 * 🛑 `requireAdmin`, NOT `requireAdminOrBearer`. `delete-public` destroys public objects and
 * `apply` rewrites other people's messages, so this is session-only on purpose: the bearer /
 * shared-secret path yields `{ role: 'admin' }` with no identity, which is the unattributable
 * case the league-recovery route documents (`app/api/admin/leagues/[leagueId]/recovery`).
 *
 * ⚠ A JSON BODY IS READ ONLY WITH `Content-Type: application/json`. Anything else runs the
 * DEFAULT — the read-only dry run. A cross-site `text/plain` form post (a "simple" request that
 * skips CORS preflight) therefore cannot reach `apply` or `delete-public`, on top of the admin
 * cookies being `SameSite=Lax`.
 *
 * ⚠ NO `export const maxDuration`. This is served from Railway, where that Vercel directive does
 * nothing (CLAUDE.md). Each call is bounded by the module's own time budget and batch limit and
 * reports `hasMore` + `nextCursor` instead.
 *
 * DB-first boundary: `*.blob.vercel-storage.com` is our OWN object storage, not a data provider, and
 * is absent from `DATA_API_HOST_PATTERNS` in `scripts/check-db-first-api-boundary.mjs` — correctly.
 * No marker is needed or used, and none should be added: this is admin-only maintenance, not a
 * request-path read.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/adminAuth'
import { logAdminAudit, resolveAdminAuditActor } from '@/lib/admin-audit'
import { MIGRATION_MODES, runPublicPhotoMigration } from '@/lib/chat-core/publicPhotoMigration'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  mode: z.enum(MIGRATION_MODES).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  cursor: z.string().max(4096).nullable().optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Only counts go to the audit log — never items, paths or ids from the report. */
function auditCounts(body: Record<string, unknown>): Record<string, unknown> {
  const counts = body.counts && typeof body.counts === 'object' ? (body.counts as Record<string, unknown>) : {}
  const numeric = Object.fromEntries(Object.entries(counts).filter(([, v]) => typeof v === 'number'))
  return { ...numeric, ok: body.ok === true, hasMore: body.hasMore === true, error: typeof body.error === 'string' ? body.error : undefined }
}

function errorKind(error: unknown): string {
  const name = (error as { constructor?: { name?: unknown } } | null)?.constructor?.name
  return typeof name === 'string' && /^[A-Za-z0-9_]{1,48}$/.test(name) ? name : 'unknown'
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  let raw: unknown = {}
  if ((request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    const text = await request.text().catch(() => '')
    if (text.trim()) {
      try {
        raw = JSON.parse(text)
      } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE })
      }
    }
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400, headers: NO_STORE })
  }
  const mode = parsed.data.mode ?? 'dry-run'

  try {
    const result = await runPublicPhotoMigration({ mode, limit: parsed.data.limit, cursor: parsed.data.cursor ?? null })
    if (mode !== 'dry-run') {
      await logAdminAudit({
        adminUserId: resolveAdminAuditActor(gate.user),
        action: 'chat_public_photo_migration',
        targetType: 'chat_storage',
        targetId: mode,
        details: auditCounts(result.body),
      })
    }
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    // Never the message: storage and SDK errors can carry bucket names, endpoints and URLs.
    const kind = errorKind(error)
    console.error('[admin/chat/migrate-public-photos] run failed', { mode, errorKind: kind })
    return NextResponse.json({ ok: false, mode, error: 'migration_failed', errorKind: kind }, { status: 500, headers: NO_STORE })
  }
}
