/**
 * REDRAFT FREE-AGENT POOL — real, sport-isolated, deterministic.
 *
 * The native redraft free-agent pool is the fantasy-relevant player set for the
 * league's sport+season (ranked by AllFantasyAdpSnapshot ADP) MINUS the players
 * already rostered this season. ADP is the real value/ranking signal available
 * for redraft (projections/weekly-scores are populated per-league only after a
 * provider sync / seed). NFL and NCAAF pools never mix — the sport filter is
 * applied to the ADP query itself.
 *
 * This module performs DB reads only and never fabricates values. When no ADP
 * rows exist for the sport/season, it returns an empty pool and the caller flags
 * `waiverPool: 'missing'` (truthful provider-limited state).
 */
import { prisma } from '@/lib/prisma'
import { buildPlayerKey, collapseStoredAdpRows } from '@/lib/adp/computeAllFantasyAdp'

export interface RedraftFreeAgent {
  playerKey: string
  playerName: string
  position: string
  team: string | null
  /** Average overall pick (lower = more valued). */
  adp: number
  /** 1-based rank within the returned pool by ADP. */
  adpRank: number
}

function normSport(sport: string): string[] {
  const s = String(sport ?? '').trim()
  return [s, s.toUpperCase(), s.toLowerCase()]
}

/**
 * Real fantasy player positions (offense + kicker + team defense + IDP). The ADP
 * source can contain non-player rows (e.g. coaches); restrict the free-agent pool
 * to actual rosterable positions so the War Room never surfaces a coach as an add.
 */
const FANTASY_POSITIONS = new Set([
  'QB', 'RB', 'FB', 'HB', 'WR', 'TE', 'K', 'PK',
  'DST', 'DEF', 'D/ST', 'DEF/ST',
  'DL', 'DE', 'DT', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB',
  'DB', 'CB', 'S', 'FS', 'SS',
])

function isFantasyPosition(pos: string): boolean {
  return FANTASY_POSITIONS.has((pos ?? '').trim().toUpperCase())
}

export interface FetchFreeAgentPoolInput {
  sport: string
  season: number
  /** playerKeys (buildPlayerKey(name, position)) already rostered — excluded from the pool. */
  rosteredKeys: Set<string>
  /** Scoring format hint ('ppr' | 'half_ppr' | 'standard'); used to prefer the matching ADP rows. */
  scoringFormat?: string
  limit?: number
}

/**
 * Returns ADP-ranked available free agents for the sport, excluding rostered players.
 * Dedupes by playerKey (keeps the lowest/best ADP across scoring/context rows).
 */
export async function fetchRedraftFreeAgentPool(
  input: FetchFreeAgentPoolInput,
): Promise<RedraftFreeAgent[]> {
  const seasonStr = String(input.season)
  const storedRows = await prisma.allFantasyAdpSnapshot
    .findMany({
      where: {
        sport: { in: normSport(input.sport) },
        leagueType: 'redraft',
        season: seasonStr,
      },
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
  // Stored keys predate the suffix-insensitive `buildPlayerKey`; re-key them so they meet
  // `rosteredKeys` (built by the same function) — see computeAllFantasyAdp.buildPlayerKey.
  const rows = collapseStoredAdpRows(storedRows)

  if (rows.length === 0) return []

  const preferredScoring = String(input.scoringFormat ?? '').trim().toLowerCase()

  // Dedupe by playerKey: keep the best (lowest) ADP, preferring the league's
  // scoring format when multiple context rows exist for the same player.
  const best = new Map<string, { playerName: string; scoringFormat: string; adp: number }>()
  for (const r of rows) {
    if (!r.playerKey) continue
    const prev = best.get(r.playerKey)
    if (!prev) {
      best.set(r.playerKey, {
        playerName: r.playerName,
        scoringFormat: r.scoringFormat,
        adp: r.averageOverallPick,
      })
      continue
    }
    const prevPreferred = preferredScoring && prev.scoringFormat?.toLowerCase() === preferredScoring
    const curPreferred = preferredScoring && r.scoringFormat?.toLowerCase() === preferredScoring
    if (curPreferred && !prevPreferred) {
      best.set(r.playerKey, { playerName: r.playerName, scoringFormat: r.scoringFormat, adp: r.averageOverallPick })
    } else if (curPreferred === prevPreferred && r.averageOverallPick < prev.adp) {
      best.set(r.playerKey, { playerName: r.playerName, scoringFormat: r.scoringFormat, adp: r.averageOverallPick })
    }
  }

  const available: RedraftFreeAgent[] = []
  for (const [playerKey, v] of best) {
    if (input.rosteredKeys.has(playerKey)) continue
    const [, posRaw] = playerKey.split('|')
    if (!isFantasyPosition(posRaw ?? '')) continue
    available.push({
      playerKey,
      playerName: v.playerName,
      position: (posRaw ?? '').toUpperCase(),
      team: null,
      adp: v.adp,
      adpRank: 0,
    })
  }

  available.sort((a, b) => a.adp - b.adp)
  available.forEach((fa, i) => {
    fa.adpRank = i + 1
  })

  const limit = input.limit ?? 60
  return available.slice(0, limit)
}

/** Build the rostered playerKey set from roster players for free-agent exclusion. */
export function rosteredPlayerKeys(
  players: Array<{ playerName: string; position: string }>,
): Set<string> {
  const set = new Set<string>()
  for (const p of players) set.add(buildPlayerKey(p.playerName, p.position))
  return set
}

/** Map ADP rows for the sport/season into a name|pos → adp lookup (for enriching rostered players). */
export async function fetchAdpByPlayerKey(sport: string, season: number): Promise<Map<string, number>> {
  const rows = await prisma.allFantasyAdpSnapshot
    .findMany({
      where: { sport: { in: normSport(sport) }, leagueType: 'redraft', season: String(season) },
      select: { playerKey: true, averageOverallPick: true, sampleSize: true, contextHash: true, draftMode: true },
      orderBy: { averageOverallPick: 'asc' },
      take: 4000,
    })
    .catch(() => [])
  // Best ADP across contexts, as before — after collapsing stored spelling variants per context.
  const map = new Map<string, number>()
  for (const r of collapseStoredAdpRows(rows)) {
    const prev = map.get(r.playerKey)
    if (prev == null || r.averageOverallPick < prev) map.set(r.playerKey, r.averageOverallPick)
  }
  return map
}
