/**
 * READ-ONLY check that IDP replacement level actually varies by league. Never writes.
 *
 * The claim being tested is the one the whole valuation rests on: that the same defender is
 * worth materially more in a league that starts six linebackers than in one that starts three,
 * and that this falls out of `roster_positions` rather than being asserted. If every league
 * produces the same replacement level, the module is decoration.
 */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring, isIdpPosition } from '../lib/core-app/scoringNotes'
import { loadIdpProjections } from '../lib/idp-projections/loadIdpProjections'
import { buildIdpValuations, parseIdpSlots } from '../lib/idp-projections/idpValuation'
import { computeLeagueProjectedPoints, extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()

/** `roster_positions` lives under a couple of spellings depending on the importer. */
function rosterSlots(settings: unknown): string[] | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw =
    (s.roster_positions as unknown) ??
    (s.rosterPositions as unknown) ??
    ((s.rosterSettings as Record<string, unknown> | undefined)?.roster_positions as unknown)
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : null
}

async function main() {
  const season = (
    await prisma.playerGameStat.aggregate({ where: { sportType: 'NFL' }, _max: { season: true } })
  )._max.season!
  const week =
    ((
      await prisma.playerGameStat.aggregate({
        where: { sportType: 'NFL', season },
        _max: { weekOrRound: true },
      })
    )._max.weekOrRound ?? 0) + 1
  console.log(`projecting season ${season} week ${week}\n`)

  const leagues = (
    await prisma.league.findMany({ select: { id: true, name: true, settings: true } })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))

  /** Same player across leagues, to show the value is league-specific and not a player trait. */
  const crossLeague = new Map<string, Array<{ league: string; vorp: number | null; rank: number }>>()

  for (const league of leagues) {
    const scoring = extractScoringSettings(league.settings)!
    const slots = rosterSlots(league.settings)
    const parsed = parseIdpSlots(slots)
    const totalSlots = parsed.dedicated.LB + parsed.dedicated.DL + parsed.dedicated.DB + parsed.flex

    const rosters = await prisma.roster.findMany({
      where: { leagueId: league.id },
      select: { playerData: true },
    })
    const ids = new Set<string>()
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      for (const k of ['starters', 'players']) {
        const arr = pd[k]
        if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v !== '0') ids.add(v)
      }
    }
    if (ids.size === 0) continue

    const rows = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: [...ids] } },
      select: { sleeperId: true, name: true, position: true },
    })
    const seen = new Set<string>()
    const defenders: Array<{ sleeperId: string; position: string | null; name: string }> = []
    for (const p of rows) {
      if (!p.sleeperId || seen.has(p.sleeperId) || !isIdpPosition(p.position)) continue
      seen.add(p.sleeperId)
      defenders.push({ sleeperId: p.sleeperId, position: p.position, name: p.name })
    }
    if (defenders.length === 0) continue

    const { bySleeperId } = await loadIdpProjections({
      prisma,
      season,
      week,
      players: defenders.map((d) => ({ sleeperId: d.sleeperId, position: d.position })),
    })

    const nameOf = new Map(defenders.map((d) => [d.sleeperId, d.name]))
    const valuationInput = defenders.map((d) => {
      const outcome = bySleeperId.get(d.sleeperId)
      const scored =
        outcome?.ok ? computeLeagueProjectedPoints(outcome.statLine, scoring)?.points ?? null : null
      return { playerId: d.sleeperId, position: d.position, projectedPoints: scored }
    })

    const teamCount = rosters.length
    const val = buildIdpValuations({
      players: valuationInput,
      rosterSlots: slots,
      numTeams: teamCount,
    })

    console.log(`--- ${league.name} (${teamCount} teams) ---`)
    console.log(
      `  slots: ${parsed.dedicated.LB} LB / ${parsed.dedicated.DL} DL / ` +
        `${parsed.dedicated.DB} DB / ${parsed.flex} FLEX  (total ${totalSlots})`,
    )
    if (!val.ok) {
      console.log(`  REFUSED: ${val.reason} — ${val.detail}\n`)
      continue
    }

    for (const g of ['LB', 'DL', 'DB'] as const) {
      const r = val.replacement[g]
      const rep = r.replacementPoints
      console.log(
        `  ${g}: pool ${String(r.pool).padStart(3)}  starters ${String(r.startersLeagueWide).padStart(3)}  ` +
          `replacement ${rep == null ? '—' : rep.toFixed(2).padStart(6)}` +
          `${r.replacementPlayerId ? ` (${nameOf.get(r.replacementPlayerId) ?? r.replacementPlayerId})` : ''}`,
      )
    }

    const top = val.players
      .filter((p) => p.vorp != null)
      .sort((a, b) => (b.vorp ?? 0) - (a.vorp ?? 0))
      .slice(0, 5)
    for (const p of top) {
      console.log(
        `    ${p.group} ${(nameOf.get(p.playerId) ?? p.playerId).padEnd(24)} ` +
          `proj ${p.projectedPoints.toFixed(2).padStart(6)}  VORP ${(p.vorp ?? 0).toFixed(2).padStart(6)}`,
      )
    }
    console.log()

    for (const p of val.players) {
      const name = nameOf.get(p.playerId)
      if (!name) continue
      const arr = crossLeague.get(name) ?? []
      arr.push({ league: league.name ?? league.id, vorp: p.vorp, rank: p.positionRank })
      crossLeague.set(name, arr)
    }
  }

  console.log('='.repeat(78))
  console.log('The same player, priced by each league that rosters him')
  console.log('='.repeat(78))
  const spread = [...crossLeague.entries()]
    .filter(([, v]) => v.length >= 3 && v.every((x) => x.vorp != null))
    .map(([name, v]) => {
      const vals = v.map((x) => x.vorp as number)
      return { name, v, spread: Math.max(...vals) - Math.min(...vals) }
    })
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 6)

  for (const s of spread) {
    console.log(`\n${s.name}  (spread ${s.spread.toFixed(2)} pts of VORP)`)
    for (const e of s.v.slice(0, 6)) {
      console.log(`   ${(e.league ?? '').slice(0, 34).padEnd(36)} VORP ${(e.vorp ?? 0).toFixed(2).padStart(6)}  (rank ${e.rank})`)
    }
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
