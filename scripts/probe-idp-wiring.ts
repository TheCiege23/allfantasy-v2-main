/** READ-ONLY. Does the wired path return real values via the id space the caller uses? Never writes. */
import { PrismaClient } from '@prisma/client'

import { loadLeagueIdpVorp } from '../lib/idp-projections/leagueIdpVorp'
import { hasIdpScoring } from '../lib/core-app/scoringNotes'
import { extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()

function rosterPositions(settings: unknown): string[] {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions as unknown) ?? (s.rosterPositions as unknown)
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : []
}

async function main() {
  const leagues = (
    await prisma.league.findMany({
      select: { id: true, name: true, settings: true, platformLeagueId: true, platform: true },
    })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))

  console.log(`IDP leagues: ${leagues.length}\n`)
  for (const l of leagues.slice(0, 6)) {
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

    // The rankings engine passes the PLATFORM id, so that is what is exercised here.
    const key = l.platformLeagueId ?? l.id
    const res = await loadLeagueIdpVorp({
      prisma,
      leagueId: key,
      rosterPositions: rosterPositions(l.settings),
      rosterPlayerIds: ids,
      numTeams: rosters.length,
    })
    const vals = [...res.vorpBySleeperId.values()].filter((v): v is number => v != null)
    vals.sort((a, b) => b - a)
    console.log(
      `${(l.name ?? l.id).slice(0, 30).padEnd(32)} key=${key === l.platformLeagueId ? 'platform' : 'uuid'} ` +
        `skipped=${res.skipped ?? '—'} defenders=${res.coverage.defenders} ` +
        `projected=${res.coverage.projected} priced=${res.coverage.priced}` +
        (vals.length ? `  top VORP ${vals.slice(0, 3).map((v) => v.toFixed(2)).join(', ')}` : ''),
    )
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
