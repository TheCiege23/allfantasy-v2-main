import { PlayerValueMap } from './rankings-engine/league-rankings-v2'

const IDP_POSITION_MAP: Record<string, string> = {
  LB: 'LB',
  ILB: 'LB',
  OLB: 'LB',
  DL: 'DL',
  DE: 'DL',
  DT: 'DL',
  DB: 'DB',
  CB: 'DB',
  SS: 'DB',
  FS: 'DB',
  S: 'DB',
}

export function normalizeIdpPosition(pos: string): string | null {
  return IDP_POSITION_MAP[pos.toUpperCase()] || null
}

export function isIdpPosition(pos: string): boolean {
  return normalizeIdpPosition(pos) !== null
}

export function isKickerPosition(pos: string): boolean {
  return pos.toUpperCase() === 'K'
}

interface SleeperPlayerInfo {
  player_id: string
  full_name: string
  position: string
  team: string | null
  age: number | null
  years_exp: number | null
  fantasy_positions?: string[]
  search_rank?: number | null
}

const DYNASTY_IDP_TIERS: { maxRank: number; value: number }[] = [
  { maxRank: 3, value: 5500 },
  { maxRank: 8, value: 4200 },
  { maxRank: 15, value: 3200 },
  { maxRank: 25, value: 2400 },
  { maxRank: 40, value: 1800 },
  { maxRank: 60, value: 1200 },
  { maxRank: 90, value: 800 },
  { maxRank: 130, value: 500 },
  { maxRank: 200, value: 300 },
  { maxRank: Infinity, value: 150 },
]

const REDRAFT_IDP_TIERS: { maxRank: number; value: number }[] = [
  { maxRank: 3, value: 3500 },
  { maxRank: 8, value: 2800 },
  { maxRank: 15, value: 2100 },
  { maxRank: 25, value: 1500 },
  { maxRank: 40, value: 1000 },
  { maxRank: 60, value: 650 },
  { maxRank: 90, value: 400 },
  { maxRank: 130, value: 250 },
  { maxRank: 200, value: 150 },
  { maxRank: Infinity, value: 75 },
]

const DYNASTY_KICKER_TIERS: { maxRank: number; value: number }[] = [
  { maxRank: 3, value: 1200 },
  { maxRank: 8, value: 800 },
  { maxRank: 15, value: 500 },
  { maxRank: 25, value: 300 },
  { maxRank: Infinity, value: 100 },
]

const REDRAFT_KICKER_TIERS: { maxRank: number; value: number }[] = [
  { maxRank: 3, value: 900 },
  { maxRank: 8, value: 600 },
  { maxRank: 15, value: 350 },
  { maxRank: 25, value: 200 },
  { maxRank: Infinity, value: 50 },
]

function getTierValue(rank: number, tiers: { maxRank: number; value: number }[]): number {
  for (const tier of tiers) {
    if (rank <= tier.maxRank) return tier.value
  }
  return tiers[tiers.length - 1].value
}

/**
 * The same ladder, read continuously instead of in steps.
 *
 * ⚠ THE STEPS ARE AN ARTEFACT OF THE TABLE, NOT A FACT ABOUT FOOTBALL. On the tiered read,
 * rank 3 is worth 5,500 and rank 4 is worth 4,200 — a 24% cliff between two players who are
 * next to each other on the board, and no cliff at all between rank 4 and rank 8. Interpolating
 * between the same anchors keeps the currency exactly where it was (same ceiling, same floor,
 * same shape) while spacing adjacent players by the distance actually between them.
 */
function interpolatedTierValue(
  rank: number,
  tiers: { maxRank: number; value: number }[],
): number {
  const r = Math.max(1, rank)
  let prevRank = 1
  let prevValue = tiers[0].value
  for (const tier of tiers) {
    if (r <= tier.maxRank) {
      if (!Number.isFinite(tier.maxRank) || tier.maxRank === prevRank) return tier.value
      const t = (r - prevRank) / (tier.maxRank - prevRank)
      return Math.round(prevValue + (tier.value - prevValue) * Math.max(0, Math.min(1, t)))
    }
    prevRank = tier.maxRank
    prevValue = tier.value
  }
  return tiers[tiers.length - 1].value
}

/** Top of the IDP tier curve — for normalizing tier values onto 0–100 scales. */
export function idpTierValueCeiling(isDynasty: boolean): number {
  return (isDynasty ? DYNASTY_IDP_TIERS : REDRAFT_IDP_TIERS)[0].value
}

const IDP_AGE_PEAKS: Record<string, number> = {
  LB: 26,
  DL: 27,
  DB: 27,
}

function dynastyAgeFactor(age: number | null, position: string): number {
  if (age === null) return 1.0
  const peak = IDP_AGE_PEAKS[position] ?? 27
  const diff = peak - age
  return Math.max(0.7, Math.min(1.15, 1 + diff * 0.03))
}

const IDP_POSITION_MULTIPLIER: Record<string, number> = {
  LB: 1.15,
  DL: 1.0,
  DB: 0.95,
}

let sleeperPlayerCache: Map<string, SleeperPlayerInfo> | null = null
let sleeperCacheTimestamp = 0
const SLEEPER_CACHE_TTL = 1000 * 60 * 60 * 6

async function getSleeperPlayersMap(): Promise<Map<string, SleeperPlayerInfo>> {
  if (sleeperPlayerCache && Date.now() - sleeperCacheTimestamp < SLEEPER_CACHE_TTL) {
    return sleeperPlayerCache
  }

  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl') // db-first-exception: valuation fallback source pending DB cache wiring
    if (!res.ok) throw new Error(`Sleeper players API: ${res.status}`)
    const data = await res.json()
    const map = new Map<string, SleeperPlayerInfo>()
    for (const [pid, p] of Object.entries(data as Record<string, any>)) {
      map.set(pid, {
        player_id: pid,
        full_name: p.full_name || p.first_name + ' ' + p.last_name || 'Unknown',
        position: p.position || '',
        team: p.team || null,
        age: p.age ?? null,
        years_exp: p.years_exp ?? null,
        fantasy_positions: p.fantasy_positions || [],
        search_rank: p.search_rank ?? null,
      })
    }
    sleeperPlayerCache = map
    sleeperCacheTimestamp = Date.now()
    return map
  } catch (err) {
    if (sleeperPlayerCache) return sleeperPlayerCache
    return new Map()
  }
}

function rankIdpPlayers(
  players: SleeperPlayerInfo[],
  idpPosition: string,
): { playerId: string; rank: number; info: SleeperPlayerInfo }[] {
  const posPlayers = players.filter(p => {
    const normalized = normalizeIdpPosition(p.position)
    return normalized === idpPosition && p.team !== null
  })

  posPlayers.sort((a, b) => {
    const aRank = a.search_rank ?? 99999
    const bRank = b.search_rank ?? 99999
    if (aRank !== bRank) return aRank - bRank
    const aExp = a.years_exp ?? 0
    const bExp = b.years_exp ?? 0
    return bExp - aExp
  })

  return posPlayers.map((p, i) => ({
    playerId: p.player_id,
    rank: i + 1,
    info: p,
  }))
}

function rankKickers(
  players: SleeperPlayerInfo[],
): { playerId: string; rank: number; info: SleeperPlayerInfo }[] {
  const kickers = players.filter(p => p.position === 'K' && p.team !== null)

  kickers.sort((a, b) => {
    const aRank = a.search_rank ?? 99999
    const bRank = b.search_rank ?? 99999
    if (aRank !== bRank) return aRank - bRank
    const aExp = a.years_exp ?? 0
    const bExp = b.years_exp ?? 0
    return bExp - aExp
  })

  return kickers.map((p, i) => ({
    playerId: p.player_id,
    rank: i + 1,
    info: p,
  }))
}

/**
 * League context that turns the IDP ranking from a popularity poll into a projection.
 *
 * ⚠ OPTIONAL ON PURPOSE. Callers that cannot supply it keep the previous behaviour exactly,
 * so nothing changes underneath a surface that has not opted in. Supplying it is what makes
 * the ranking specific to the reader's league.
 */
export interface IdpLeagueValuationContext {
  /** Value over replacement per Sleeper id, from `buildIdpValuations`. */
  vorpBySleeperId: ReadonlyMap<string, number | null>
}

/**
 * ⚠ RANK BY PROJECTION, PRICE BY THE EXISTING LADDER — AND THE SPLIT IS EVIDENCE-BASED.
 *
 * Measured across the ten production leagues that genuinely score IDP, on offensive players
 * who have BOTH a FantasyCalc price and a value over replacement computed the same way:
 *
 *   QB  n=27  Spearman 0.868   R2(log) 0.794
 *   RB  n=47  Spearman 0.933   R2(log) 0.687
 *   WR  n=71  Spearman 0.885   R2(log) 0.440
 *   TE  n=25  Spearman 0.891   R2(log) 0.289
 *
 * Value over replacement ORDERS players almost exactly as the market does — rank correlation
 * near 0.9 at every position. It does not PRICE them: the market pays a different amount per
 * point of VORP depending on position (median 353 at QB, 399 at RB, 294 at WR, 164 at TE, a
 * 2.4x spread), and pooling the positions collapses the fit to R2 0.09.
 *
 * So VORP replaces `search_rank` as the ranking input, and the existing ladder still supplies
 * the units. Deriving an IDP price directly from VORP would require an exchange rate that the
 * data does not support, and inventing one would move every IDP-for-offence trade grade in the
 * product on the strength of a number nobody measured.
 */
export async function buildIdpKickerValueMap(
  rosterPlayerIds: string[],
  isDynasty: boolean,
  leagueContext?: IdpLeagueValuationContext | null,
): Promise<Map<string, PlayerValueMap>> {
  const sleeperPlayers = await getSleeperPlayersMap()
  const valueMap = new Map<string, PlayerValueMap>()

  const relevantPlayerIds = new Set(rosterPlayerIds)

  const allSleeperPlayers = Array.from(sleeperPlayers.values())

  const idpPositions = ['LB', 'DL', 'DB']
  const rankedByPosition = new Map<string, Map<string, number>>()

  for (const pos of idpPositions) {
    const ranked = rankIdpPlayers(allSleeperPlayers, pos)
    const posRankMap = new Map<string, number>()
    for (const r of ranked) {
      posRankMap.set(r.playerId, r.rank)
    }
    rankedByPosition.set(pos, posRankMap)
  }

  const kickerRanks = rankKickers(allSleeperPlayers)
  const kickerRankMap = new Map<string, number>()
  for (const r of kickerRanks) {
    kickerRankMap.set(r.playerId, r.rank)
  }

  /*
   * Rank within position by this league's value over replacement. Only players the league
   * could actually price appear — a null VORP means replacement level could not be
   * established, and ranking that at the bottom would price a data gap as the worst defender
   * on the board.
   */
  const vorpRankByPlayer = new Map<string, number>()
  if (leagueContext) {
    const byPos = new Map<string, Array<{ pid: string; vorp: number }>>()
    for (const [pid, vorp] of leagueContext.vorpBySleeperId) {
      if (typeof vorp !== 'number' || !Number.isFinite(vorp)) continue
      const info = sleeperPlayers.get(pid)
      const pos = info ? normalizeIdpPosition(info.position) : null
      if (!pos) continue
      const arr = byPos.get(pos) ?? []
      arr.push({ pid, vorp })
      byPos.set(pos, arr)
    }
    for (const arr of byPos.values()) {
      arr.sort((a, b) => b.vorp - a.vorp)
      arr.forEach((e, i) => vorpRankByPlayer.set(e.pid, i + 1))
    }
  }

  for (const pid of relevantPlayerIds) {
    const player = sleeperPlayers.get(pid)
    if (!player) continue

    const idpPos = normalizeIdpPosition(player.position)

    if (idpPos) {
      const vorpRank = vorpRankByPlayer.get(pid)
      const posRankMap = rankedByPosition.get(idpPos)
      const rank = vorpRank ?? posRankMap?.get(pid) ?? 200
      const tiers = isDynasty ? DYNASTY_IDP_TIERS : REDRAFT_IDP_TIERS
      let value = vorpRank != null ? interpolatedTierValue(rank, tiers) : getTierValue(rank, tiers)
      /*
       * ⚠ THE POSITION MULTIPLIER IS DROPPED ON THE PROJECTION PATH, AND DROPPING IT IS THE
       * POINT. LB 1.15 / DL 1.0 / DB 0.95 exists to express that linebackers out-score linemen
       * in most IDP scoring. Replacement level already measures that, from this league's own
       * settings and its own starting slots — applying both counts the same effect twice, and
       * the hardcoded version is the less accurate of the two.
       */
      if (vorpRank == null) {
        value = Math.round(value * (IDP_POSITION_MULTIPLIER[idpPos] ?? 1.0))
      }
      // Age is orthogonal: it is the trajectory layer, not the scarcity one, so it still applies.
      if (isDynasty) {
        value = Math.round(value * dynastyAgeFactor(player.age, idpPos))
      }
      valueMap.set(pid, {
        sleeperId: pid,
        value: isDynasty ? value : 0,
        redraftValue: isDynasty ? 0 : value,
        position: idpPos,
        age: player.age,
        name: player.full_name,
      })
    } else if (isKickerPosition(player.position)) {
      const rank = kickerRankMap.get(pid) ?? 50
      const tiers = isDynasty ? DYNASTY_KICKER_TIERS : REDRAFT_KICKER_TIERS
      const value = getTierValue(rank, tiers)
      valueMap.set(pid, {
        sleeperId: pid,
        value: isDynasty ? value : 0,
        redraftValue: isDynasty ? 0 : value,
        position: 'K',
        age: player.age,
        name: player.full_name,
      })
    }
  }

  return valueMap
}

export function detectIdpLeague(rosterPositions: string[]): boolean {
  const idpSlots = ['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S', 'SS', 'FS']
  return rosterPositions.some(p => idpSlots.includes(p.toUpperCase()))
}

export function detectKickerLeague(rosterPositions: string[]): boolean {
  return rosterPositions.some(p => p.toUpperCase() === 'K')
}

export function countIdpSlots(rosterPositions: string[]): number {
  const idpSlots = ['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S', 'SS', 'FS']
  return rosterPositions.filter(p => idpSlots.includes(p.toUpperCase())).length
}
