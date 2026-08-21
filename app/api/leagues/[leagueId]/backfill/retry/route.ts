import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readBackfillOutcome, backfillSettingsPatch } from '@/lib/league-import/backfillOutcome'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST: re-run the historical backfill for an already-imported league
 * that had a partial-failure backfill run. Commissioner-only.
 *
 * Re-uses the provider-specific backfill services. Flips
 * League.settings.historicalBackfillStatus back to 'pending' while it
 * runs, then 'complete' or 'failed' when the background job resolves.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  // Commissioner-only explicit repair: by default this retry only re-fetches seasons that are
  // still missing draft/roster data (the new completion gate skips already-imported seasons for
  // speed). Pass `{"force": true}` to force a full refetch of every discovered season instead —
  // e.g. after a known provider data correction.
  let force = false
  try {
    const body = (await req.json()) as { force?: boolean } | null
    force = Boolean(body?.force)
  } catch {
    // No/invalid JSON body is fine — default to the safe, gated retry.
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, platform: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.userId !== userId) {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }
  const provider = String(league.platform ?? '').toLowerCase()
  if (!['sleeper', 'yahoo', 'espn', 'mfl', 'fantrax'].includes(provider)) {
    return NextResponse.json(
      { error: `Backfill retry is only supported for imported leagues (got platform=${league.platform}).` },
      { status: 400 },
    )
  }

  // Mark in-flight.
  const currentSettings = (league.settings as Record<string, unknown> | null) ?? {}
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: {
        ...currentSettings,
        historicalBackfillStatus: 'pending',
        historicalBackfillStartedAt: new Date().toISOString(),
        historicalBackfillError: null,
      } as never,
    },
  })

  void (async () => {
    /*
     * ⚠ THE RESULT WAS AWAITED AND THROWN AWAY, then `'complete'` written
     * regardless — the same defect as the import path. These services resolve
     * normally while reporting `success: false` and a `failureMessage`, so a
     * retry that imported nothing was indistinguishable from one that worked.
     */
    let result: unknown = null
    try {
      if (provider === 'sleeper') {
        const { syncSleeperHistoricalBackfillAfterImport } = await import(
          '@/lib/league-import/sleeper/SleeperHistoricalBackfillService'
        )
        const isDynasty = Boolean(
          ((currentSettings as Record<string, unknown>).isDynasty as boolean | undefined) ??
            (currentSettings as Record<string, unknown>).is_dynasty,
        )
        result = await syncSleeperHistoricalBackfillAfterImport({ leagueId, isDynasty, force })
      } else if (provider === 'yahoo') {
        const { syncYahooHistoricalBackfillAfterImport } = await import(
          '@/lib/league-import/yahoo/YahooHistoricalBackfillService'
        )
        result = await syncYahooHistoricalBackfillAfterImport({ leagueId, userId })
      } else if (provider === 'espn') {
        const { syncEspnHistoricalBackfillAfterImport } = await import(
          '@/lib/league-import/espn/EspnHistoricalBackfillService'
        )
        result = await syncEspnHistoricalBackfillAfterImport({ leagueId, userId })
      } else if (provider === 'mfl') {
        const { syncMflHistoricalBackfillAfterImport } = await import(
          '@/lib/league-import/mfl/MflHistoricalBackfillService'
        )
        result = await syncMflHistoricalBackfillAfterImport({ leagueId, userId })
      } else if (provider === 'fantrax') {
        const { syncFantraxHistoricalBackfillAfterImport } = await import(
          '@/lib/league-import/fantrax/FantraxHistoricalBackfillService'
        )
        result = await syncFantraxHistoricalBackfillAfterImport({ leagueId, userId })
      }
      const fresh = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { settings: true },
      })
      await prisma.league.update({
        where: { id: leagueId },
        data: {
          settings: {
            ...((fresh?.settings as Record<string, unknown> | null) ?? {}),
            ...backfillSettingsPatch(readBackfillOutcome(result), new Date().toISOString()),
          } as never,
        },
      })
    } catch (err) {
      const fresh = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { settings: true },
      })
      await prisma.league.update({
        where: { id: leagueId },
        data: {
          settings: {
            ...((fresh?.settings as Record<string, unknown> | null) ?? {}),
            historicalBackfillStatus: 'failed',
            historicalBackfillError: err instanceof Error ? err.message : 'unknown',
          } as never,
        },
      })
    }
  })()

  return NextResponse.json({ ok: true, status: 'pending', provider })
}
