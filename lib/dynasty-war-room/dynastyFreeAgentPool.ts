/**
 * DYNASTY FREE-AGENT POOL — real, sport-isolated, deterministic.
 *
 * Available = dynasty-ADP-ranked players for the league's sport+season
 * (AllFantasyAdpSnapshot, leagueType='dynasty') MINUS rostered players, filtered
 * to real fantasy positions. Mirrors the redraft pool but uses the DYNASTY ADP
 * context (long-term value), not redraft. NFL/NCAAF never mix. No fabrication.
 *
 * NHL dynasty also lists free Fantrax prospects AFTER the ADP pool, unranked
 * (`fetchDynastyNhlProspectFreeAgents` below). Every other sport and league type is the ADP pool alone.
 */
import { prisma } from '@/lib/prisma'
import { buildPlayerKey, collapseStoredAdpRows } from '@/lib/adp/computeAllFantasyAdp'
import type { NhlProspectDb } from '@/lib/player-identity/nhlFantraxProspects'
import {
  loadNhlProspectFreeAgents,
  NHL_PROSPECT_WIRE_SOURCE,
  offersNhlProspectFreeAgency,
  type ProspectFreeAgencyLeague,
} from '@/lib/waiver-wire/nhlProspectFreeAgency'
import type { NhlProspectListMeta } from '@/lib/waiver-wire/prospectFreeAgentDisplay'
import { fantasyPositionsForSport, positionInSet } from './dynastySportCatalog'
import type { DynastyPlayerFact } from './types'

export interface DynastyFreeAgent {
  playerKey: string
  playerName: string
  position: string
  adp: number
  adpRank: number
}

const FANTASY_POSITIONS = new Set([
  'QB', 'RB', 'FB', 'HB', 'WR', 'TE', 'K', 'PK',
  'DST', 'DEF', 'D/ST', 'DEF/ST',
  'DL', 'DE', 'DT', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB',
  'DB', 'CB', 'S', 'FS', 'SS',
])

/**
 * Is `position` a real fantasy position for `sport`?
 *
 * 🛑 THE SET ABOVE IS NFL + IDP ONLY. It used to filter every sport's pool, so an NBA/MLB/NHL
 * league's PG/SP/LW/D free agents were all dropped and the panel read "free-agent pool
 * unavailable". NBA/MLB/NHL now use the positions their own slot catalog accepts (multi-eligible
 * "PG/SG"-style tokens included); NFL and every other sport keep the exact set above.
 */
export function isDynastyFantasyPosition(sport: string, position: string | null | undefined): boolean {
  const sportSet = fantasyPositionsForSport(sport)
  if (sportSet) return positionInSet(position, sportSet)
  return FANTASY_POSITIONS.has((position ?? '').trim().toUpperCase())
}

function sportVariants(sport: string): string[] {
  const s = String(sport ?? '').trim()
  return [s, s.toUpperCase(), s.toLowerCase()]
}

export function dynastyRosteredKeys(players: Array<{ playerName: string; position: string }>): Set<string> {
  const set = new Set<string>()
  for (const p of players) set.add(buildPlayerKey(p.playerName, p.position))
  return set
}

/** Dynasty ADP value lookup keyed by name|pos (for enriching rostered players). */
export async function fetchDynastyValueByKey(sport: string, season: number): Promise<Map<string, number>> {
  const rows = await prisma.allFantasyAdpSnapshot
    .findMany({
      where: { sport: { in: sportVariants(sport) }, leagueType: 'dynasty', season: String(season) },
      select: { playerKey: true, averageOverallPick: true, sampleSize: true, contextHash: true, draftMode: true },
      orderBy: { averageOverallPick: 'asc' },
      take: 4000,
    })
    .catch(() => [])
  // Best ADP across contexts, after collapsing stored spelling variants (see redraftFreeAgentPool).
  const map = new Map<string, number>()
  for (const r of collapseStoredAdpRows(rows)) {
    const prev = map.get(r.playerKey)
    if (prev == null || r.averageOverallPick < prev) map.set(r.playerKey, r.averageOverallPick)
  }
  return map
}

export async function fetchDynastyFreeAgentPool(input: {
  sport: string
  season: number
  rosteredKeys: Set<string>
  scoringFormat?: string
  limit?: number
}): Promise<DynastyFreeAgent[]> {
  const storedRows = await prisma.allFantasyAdpSnapshot
    .findMany({
      where: { sport: { in: sportVariants(input.sport) }, leagueType: 'dynasty', season: String(input.season) },
      select: {
        playerKey: true,
        playerName: true,
        scoringFormat: true,
        averageOverallPick: true,
        sampleSize: true,
        contextHash: true,
        draftMode: true,
      },
      orderBy: { averageOverallPick: 'asc' },
      take: 4000,
    })
    .catch(() => [])
  // Re-key stored rows so they meet `rosteredKeys` — see computeAllFantasyAdp.buildPlayerKey.
  const rows = collapseStoredAdpRows(storedRows)
  if (rows.length === 0) return []

  const preferred = String(input.scoringFormat ?? '').trim().toLowerCase()
  const best = new Map<string, { playerName: string; scoringFormat: string; adp: number }>()
  for (const r of rows) {
    if (!r.playerKey) continue
    const prev = best.get(r.playerKey)
    if (!prev) {
      best.set(r.playerKey, { playerName: r.playerName, scoringFormat: r.scoringFormat, adp: r.averageOverallPick })
      continue
    }
    const prevPref = preferred && prev.scoringFormat?.toLowerCase() === preferred
    const curPref = preferred && r.scoringFormat?.toLowerCase() === preferred
    if (curPref && !prevPref) best.set(r.playerKey, { playerName: r.playerName, scoringFormat: r.scoringFormat, adp: r.averageOverallPick })
    else if (curPref === prevPref && r.averageOverallPick < prev.adp)
      best.set(r.playerKey, { playerName: r.playerName, scoringFormat: r.scoringFormat, adp: r.averageOverallPick })
  }

  const available: DynastyFreeAgent[] = []
  for (const [playerKey, v] of best) {
    if (input.rosteredKeys.has(playerKey)) continue
    const [, posRaw] = playerKey.split('|')
    if (!isDynastyFantasyPosition(input.sport, posRaw)) continue
    available.push({ playerKey, playerName: v.playerName, position: (posRaw ?? '').toUpperCase(), adp: v.adp, adpRank: 0 })
  }
  available.sort((a, b) => a.adp - b.adp)
  available.forEach((fa, i) => (fa.adpRank = i + 1))
  return available.slice(0, input.limit ?? 60)
}

/**
 * How many free NHL prospects the War Room lists after the real free agents. The rest are counted
 * (`NhlProspectListMeta.total`) and found by name in the league's own free-agent list, which carries
 * up to 750 and searches the remainder.
 */
export const DYNASTY_WAR_ROOM_PROSPECT_LIMIT = 40

export type DynastyNhlProspectFreeAgents = {
  prospects: DynastyPlayerFact[]
  meta: NhlProspectListMeta
}

/**
 * Fantrax-only NHL prospects (AHL, junior, unsigned) who are free in an NHL DYNASTY league, as War
 * Room free agents. The rule is #3063's, not re-derived here: `offersNhlProspectFreeAgency` decides
 * WHERE (NHL leagues in the dynasty family only) and `loadNhlProspectFreeAgents` decides WHO (the
 * DB-first stored universe, minus every id rostered in the league). No provider call.
 *
 * Null (and the pool stays exactly the ADP pool) for every other sport and league type, and when
 * the stored universe cannot be read.
 *
 * ⚠ A prospect has no value, ADP, age or projection (contracts/fantrax/GAPS.md F-15). His fact says
 * so (`dynastyValue: null`, `adp: null`, `hasNoValueSignal: true`) rather than carrying a zero, and
 * every ranking reader (the waiver engine, the prompt) drops him with `isNhlProspectWireRow`
 * (lib/waiver-wire/prospectFreeAgentDisplay.ts): he is listed, never advised.
 */
export async function fetchDynastyNhlProspectFreeAgents(
  db: NhlProspectDb,
  input: {
    league: ProspectFreeAgencyLeague
    /** Every player id on any roster in the league. */
    rosteredIds: ReadonlySet<string>
    /** `identityNameKey` names of the real free agents listed, so no same-named pro appears twice. */
    poolNames?: ReadonlySet<string>
    limit?: number
  },
): Promise<DynastyNhlProspectFreeAgents | null> {
  if (!offersNhlProspectFreeAgency(input.league)) return null
  const loaded = await loadNhlProspectFreeAgents(db, {
    rosteredIds: input.rosteredIds,
    poolNames: input.poolNames,
    limit: input.limit ?? DYNASTY_WAR_ROOM_PROSPECT_LIMIT,
  }).catch((err: unknown) => {
    console.warn('[dynasty-war-room] NHL Fantrax prospects unavailable', err instanceof Error ? err.message : String(err))
    return null
  })
  if (!loaded) return null
  const prospects: DynastyPlayerFact[] = loaded.prospects.map((p) => ({
    playerId: p.playerId,
    playerName: p.name,
    position: p.position,
    team: p.orgTeam,
    slotType: 'free_agent',
    isStarterSlot: false,
    age: null,
    dynastyValue: null,
    adp: null,
    injuryStatus: null,
    weekProjection: null,
    hasNoValueSignal: true,
    prospectSource: NHL_PROSPECT_WIRE_SOURCE,
  }))
  return { prospects, meta: { total: loaded.total, listed: prospects.length } }
}
