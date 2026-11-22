/**
 * POST /api/admin/redraft/stat-reingest — admin-only: re-ingest a date range of player game stats
 * and (optionally) rescore finished native redraft weeks, previewing every matchup first.
 *
 * Gated by `requireAdminOrBearer` — the admin session (or the admin password bearer), the same
 * gate as POST /api/redraft/score-sync and /api/admin/sports/sync. NOT the cron secret.
 *
 * Body: { sport: NFL|NBA|NHL|MLB, from: YYYY-MM-DD, to: YYYY-MM-DD (≤ 31 days),
 *         leagueId?, weeks?: number[], dryRun?: boolean (default true),
 *         confirm?: true | "allow-flips", skipIngest?: boolean }
 *
 * All logic, and the reason each step is the tool it is, lives in lib/admin/statReingest.ts.
 */
import { NextResponse } from 'next/server'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { parseStatReingestBody, runStatReingest, StatReingestError } from '@/lib/admin/statReingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const body = await request.json().catch(() => null)
  const parsed = parseStatReingestBody(body)
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

  const actorId = gate.user.id ?? gate.user.email ?? 'admin'
  try {
    const result = await runStatReingest(parsed.value, `admin:${actorId}`)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof StatReingestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Stat re-ingest failed'
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 500 })
  }
}
