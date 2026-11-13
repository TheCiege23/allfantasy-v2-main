import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { syncIdentityMap } from '@/lib/unified-player-service'
import { syncAPISportsPlayersToIdentityMap } from '@/lib/api-sports'
import { requireAdminOrBearer } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const POST = withApiUsage({ endpoint: "/api/legacy/identity-sync", tool: "LegacyIdentitySync" })(async (request: NextRequest) => {
  try {
    // 🛑 This was `if (adminPassword && header !== adminPassword)` — which ALLOWS every caller
    // when ADMIN_PASSWORD is unset (a hash-only admin setup is supported). Fail closed, and use
    // the shared gate: admin session, bearer, or x-admin-secret, all compared in constant time.
    const gate = await requireAdminOrBearer(request)
    if (!gate.ok) return gate.res

    console.log('[IdentitySync] Starting identity map sync...')
    const result = await syncIdentityMap()
    console.log(`[IdentitySync] FantasyCalc/RI: ${result.created} created, ${result.updated} updated, ${result.matched} RI matched`)

    let apiSportsResult = { linked: 0, created: 0 }
    try {
      apiSportsResult = await syncAPISportsPlayersToIdentityMap()
      console.log(`[IdentitySync] API-Sports: ${apiSportsResult.linked} linked, ${apiSportsResult.created} created`)
    } catch (err) {
      console.warn('[IdentitySync] API-Sports sync skipped:', err)
    }

    return NextResponse.json({
      success: true,
      fantasyCalc: { created: result.created, updated: result.updated },
      rollingInsights: { matched: result.matched },
      apiSports: apiSportsResult,
    })
  } catch (error) {
    console.error('[IdentitySync] Error:', error)
    return NextResponse.json(
      { error: 'Identity sync failed', details: String(error) },
      { status: 500 }
    )
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/identity-sync", tool: "LegacyIdentitySync" })(async () => {
  const { prisma } = await import('@/lib/prisma')

  const [
    totalPlayers,
    withSleeperId,
    withFantasyCalcId,
    withRollingInsightsId,
    withApiSportsId,
    withEspnId,
    withFleaflickerId,
    fullyLinked,
  ] = await Promise.all([
    prisma.playerIdentityMap.count(),
    prisma.playerIdentityMap.count({ where: { sleeperId: { not: null } } }),
    prisma.playerIdentityMap.count({ where: { fantasyCalcId: { not: null } } }),
    prisma.playerIdentityMap.count({ where: { rollingInsightsId: { not: null } } }),
    prisma.playerIdentityMap.count({ where: { apiSportsId: { not: null } } }),
    prisma.playerIdentityMap.count({ where: { espnId: { not: null } } }),
    prisma.playerIdentityMap.count({ where: { fleaflickerId: { not: null } } }),
    prisma.playerIdentityMap.count({
      where: {
        sleeperId: { not: null },
        fantasyCalcId: { not: null },
        rollingInsightsId: { not: null },
      },
    }),
  ])

  return NextResponse.json({
    totalPlayers,
    withSleeperId,
    withFantasyCalcId,
    withRollingInsightsId,
    withApiSportsId,
    withEspnId,
    withFleaflickerId,
    fullyLinked,
    coverage: {
      sleeper: totalPlayers > 0 ? Math.round((withSleeperId / totalPlayers) * 100) : 0,
      fantasyCalc: totalPlayers > 0 ? Math.round((withFantasyCalcId / totalPlayers) * 100) : 0,
      rollingInsights: totalPlayers > 0 ? Math.round((withRollingInsightsId / totalPlayers) * 100) : 0,
      apiSports: totalPlayers > 0 ? Math.round((withApiSportsId / totalPlayers) * 100) : 0,
      espn: totalPlayers > 0 ? Math.round((withEspnId / totalPlayers) * 100) : 0,
      fleaflicker: totalPlayers > 0 ? Math.round((withFleaflickerId / totalPlayers) * 100) : 0,
      fullyLinked: totalPlayers > 0 ? Math.round((fullyLinked / totalPlayers) * 100) : 0,
    },
  })
})
