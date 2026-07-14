import { NextResponse } from 'next/server'
import type { FantasyCalcSettings } from '@/lib/player-valuations/canonicalPlayerValuations'
import { getFantasyCalcCacheHealth, readFantasyCalcValuesFromDb } from '@/lib/fantasycalc-db'

export const dynamic = 'force-dynamic'

const DEFAULT_SETTINGS: FantasyCalcSettings = {
  isDynasty: true,
  numQbs: 2,
  numTeams: 12,
  ppr: 1,
}

export async function GET() {
  try {
    const [health, defaultSnapshot] = await Promise.all([
      getFantasyCalcCacheHealth(),
      readFantasyCalcValuesFromDb(DEFAULT_SETTINGS, { allowStale: true }),
    ])

    return NextResponse.json({
      ok: health.freshKeys > 0 || defaultSnapshot.players.length > 0,
      source: 'db-cache',
      cache: {
        totalKeys: health.totalKeys,
        freshKeys: health.freshKeys,
        latestSyncedAt: health.latestSyncedAt,
      },
      defaultProfile: {
        settings: DEFAULT_SETTINGS,
        playerCount: defaultSnapshot.players.length,
        stale: defaultSnapshot.stale,
        syncedAt: defaultSnapshot.syncedAt,
        expiresAt: defaultSnapshot.expiresAt,
      },
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[health/fantasycalc] failed:', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to read FantasyCalc cache health',
      },
      { status: 500 }
    )
  }
}
