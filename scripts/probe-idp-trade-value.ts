/** READ-ONLY. Does a defender reach the trade engine with a price now? Never writes. */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring, isIdpPosition } from '../lib/core-app/scoringNotes'
import { extractScoringSettings } from '../lib/projections/leagueScoring'
import { loadLeagueIdpVorp } from '../lib/idp-projections/leagueIdpVorp'
import { normalizedPlayerValue } from '../lib/trade-value/valueEngine'

const prisma = new PrismaClient()

function slots(settings: unknown): string[] {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions as unknown) ?? (s.rosterPositions as unknown)
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : []
}

async function main() {
  const leagues = (
    await prisma.league.findMany({ select: { id: true, name: true, settings: true, leagueType: true } })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))

  for (const l of leagues.slice(0, 3)) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId: l.id },
      select: { playerData: true },
    })
    const ids: string[] = []
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      const arr = pd.players
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v !== '0') ids.push(v)
    }
    const isDynasty = (l.leagueType ?? '').toLowerCase().includes('dynasty')
    const res = await loadLeagueIdpVorp({
      prisma,
      leagueId: l.id,
      rosterPositions: slots(l.settings),
      rosterPlayerIds: ids,
      numTeams: rosters.length,
      isDynasty,
    })

    const rows = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: [...res.valueBySleeperId.keys()] } },
      select: { sleeperId: true, name: true, position: true },
    })
    const nameOf = new Map<string, string>()
    const posOf = new Map<string, string | null>()
    for (const r of rows) {
      if (r.sleeperId && !nameOf.has(r.sleeperId)) {
        nameOf.set(r.sleeperId, r.name)
        posOf.set(r.sleeperId, r.position)
      }
    }

    const ranked = [...res.valueBySleeperId.entries()]
      .map(([id, value]) => ({ id, value, rank: res.positionRankBySleeperId.get(id) ?? 0 }))
      .sort((a, b) => b.value - a.value)

    console.log(`\n--- ${l.name} (${rosters.length} teams, ${isDynasty ? 'dynasty' : 'redraft'}) ---`)
    console.log(`  defenders priced: ${ranked.length}`)
    console.log('  trade value BEFORE (generic PPR projection) vs AFTER (league IDP value):')
    for (const e of ranked.slice(0, 6)) {
      const pos = posOf.get(e.id) ?? '?'
      // The generic PPR line a defender actually arrives with.
      const before = normalizedPlayerValue({ projection: 0.3, position: pos, marketValue: null })
      const after = normalizedPlayerValue({
        projection: 0.3,
        position: pos,
        marketValue: null,
        idpValue: e.value,
      })
      console.log(
        `    ${pos.padEnd(3)} ${(nameOf.get(e.id) ?? e.id).padEnd(24)} rank ${String(e.rank).padStart(3)}  ` +
          `${String(before).padStart(5)} -> ${String(after).padStart(5)}`,
      )
    }
    if (!isIdpPosition(posOf.get(ranked[0]?.id) ?? null)) console.log('  ⚠ top asset is not an IDP position')
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
