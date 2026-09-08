import { NextResponse } from 'next/server'

import { findTemplate } from '@/lib/commissioner-reports/reportCatalog'
import { generateReport } from '@/lib/commissioner-reports/reportStore'
import { isLiveReady } from '@/lib/commissioner-ui/liveReadiness'
import { resolveActiveLeagueId } from '@/lib/commissioner-ui/resolveActiveLeagueId'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Commissioner OS · POST /api/commissioner-os/reports/generate
 *
 * Generates one report on demand and returns its history row.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────────────────────
 *
 * `ReportsView`'s Generate button used to add a `generating` row to LOCAL STATE and flip it to
 * `ready` after a two-second timer, with a hard-coded `sizeLabel: '128 KB'`. That was defensible
 * while the whole module was a fixture — the view's own comment justifies it as Demo Mode looking
 * convincing. It stops being defensible the moment the history beside it is real: a genuine list
 * of artifacts next to a button that invents entries is worse than the honest error the module
 * returned before, because the invented row is indistinguishable from the real ones.
 *
 * So in live mode the button calls this, and the simulation stays for stub/demo where it is true.
 *
 * ── AUTHORIZATION ────────────────────────────────────────────────────────────────────────────
 *
 * 🛑 THE LEAGUE IS RESOLVED, NEVER TAKEN FROM THE REQUEST. There is deliberately no `leagueId` in
 * the body. `resolveActiveLeagueId()` returns only leagues the session user COMMISSIONS, and it
 * matches the selector cookie against that owned set — so a tampered cookie can only ever select a
 * league they already commission. Accepting a league id from the caller would be an IDOR: the
 * generator would faithfully build a report for whatever it was handed.
 *
 * ⚠ NO PRISMA IMPORT. `app/api/commissioner-os/**` is inside the ESLint boundary; database access
 * goes through `lib/commissioner-reports/`.
 */
export async function POST(request: Request) {
  const leagueId = await resolveActiveLeagueId()
  if (!leagueId) {
    // Not "no league" but "not a commissioner of one" — the same gate every module's live client
    // short-circuits on. 403 rather than 404: the resource exists, this session may not act on it.
    return NextResponse.json({ error: 'No commissioned league for this session.' }, { status: 403 })
  }

  if (!(await isLiveReady('reports'))) {
    return NextResponse.json(
      { error: 'Report generation is not enabled in this environment.' },
      { status: 409 },
    )
  }

  let templateId: unknown
  try {
    templateId = (await request.json())?.templateId
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  if (typeof templateId !== 'string' || !findTemplate(templateId)) {
    /*
     * Validated against the CODE catalog, which is the same list the page rendered its buttons
     * from. An unknown id is a client out of step with the deployment, not a user error worth
     * describing in detail.
     */
    return NextResponse.json({ error: 'Unknown report template.' }, { status: 400 })
  }

  const result = await generateReport(leagueId, templateId, 'You')

  /*
   * A failed generation is a 200 carrying a failed row, not a 500. The run really happened and is
   * really recorded; the client's job is to show it in the history with its reason, which is
   * exactly what a commissioner needs to see. A 500 would discard the row's existence and leave
   * the page unable to explain what it just did.
   */
  return NextResponse.json({
    id: result.id,
    templateId: result.templateId,
    status: result.status,
    sizeBytes: result.sizeBytes,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
  })
}
