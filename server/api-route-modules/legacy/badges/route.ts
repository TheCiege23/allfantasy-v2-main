import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getUserBadges, getUserTotalXP, getBadgeDefinitions } from '@/lib/badge-engine'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

export const GET = withApiUsage({ endpoint: "/api/legacy/badges", tool: "LegacyBadges" })(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const showAll = searchParams?.get('all') === 'true'

  /*
   * Was `requireAuthOrOrigin` -- which passes any anonymous caller sending a matching
   * `Origin` header -- then served the badges of whatever `username` was named. The query
   * param is now only compared (403 on mismatch); the data is selected by the caller's own
   * linked Sleeper identity. allowGuest: BadgeDisplay renders on the af-legacy surface a
   * guest reaches straight after importing.
   */
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername: searchParams?.get('username'),
  })
  if (!gate.ok) return gate.response
  const username = gate.identity.sleeperUsername

  try {
    const userBadges = await getUserBadges(username)
    const totalXP = await getUserTotalXP(username)

    const response: any = {
      badges: userBadges.map(b => ({
        id: b.id,
        type: b.badgeType,
        name: b.badgeName,
        description: b.description,
        tier: b.tier,
        xp: b.xpReward,
        icon: (b.data as any)?.icon || '🏅',
        earnedAt: b.earnedAt,
      })),
      totalBadges: userBadges.length,
      totalXP,
    }

    if (showAll) {
      const allDefs = getBadgeDefinitions()
      const earnedTypes = new Set(userBadges.map(b => b.badgeType))
      response.available = Object.entries(allDefs)
        .filter(([key]) => !earnedTypes.has(key))
        .map(([key, def]) => ({
          type: key,
          name: def.badgeName,
          description: def.description,
          tier: def.tier,
          xp: def.xpReward,
          icon: def.icon,
          locked: true,
        }))
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to fetch badges:', error)
    return NextResponse.json({ error: 'Failed to fetch badges' }, { status: 500 })
  }
})

