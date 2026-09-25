import { toImageUrl } from '@/lib/media/imageUrl'

/**
 * Player image priority (see lib/players/README.md): sport-specific chains in
 * `resolveHeadshotCandidates` — RI headshot first, then official / ESPN / Sleeper.
 */

export type EnrichedPlayer = {
  sleeper_id: string
  ri_id?: string
  espn_id?: string
  nba_id?: string
  mlb_id?: string
  nhl_id?: string
  pga_id?: string
  full_name: string
  position: string
  team: string
  sport: string
  headshot_url?: string
  espn_url?: string
  sleeper_url?: string
  official_url?: string
}

/** Normalize dashboard / league sport strings to headshot routing keys. */
export function normalizeHeadshotSport(sport: string): string {
  const u = sport.toUpperCase()
  if (u === 'NCAAF') return 'NCAAFB'
  if (u === 'NCAAB') return 'NCAABB'
  if (u === 'EPL' || u === 'MLS') return 'SOCCER'
  return u
}

export function espnHeadshotUrl(espnId: string, sportUpper: string): string | null {
  const s = normalizeHeadshotSport(sportUpper)
  const pathBySport: Record<string, string> = {
    NFL: 'nfl',
    NBA: 'nba',
    MLB: 'mlb',
    NHL: 'nhl',
    NCAAFB: 'college-football',
    NCAABB: 'mens-college-basketball',
    PGA: 'golf',
    SOCCER: 'soccer',
  }
  const path = pathBySport[s]
  if (!path) return null
  return `https://a.espncdn.com/i/headshots/${path}/players/full/${espnId}.png`
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls.filter(Boolean))]
}

function nflChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  if (p.sleeper_id) {
    out.push(`https://sleepercdn.com/content/nfl/players/thumb/${p.sleeper_id}.jpg`)
  }
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'NFL')
    if (u) out.push(u)
  }
  return out
}

function nbaChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  const nbaKey = p.nba_id || p.ri_id
  if (nbaKey) {
    out.push(`https://cdn.nba.com/headshots/nba/latest/260x190/${nbaKey}.png`)
  }
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'NBA')
    if (u) out.push(u)
  }
  if (p.sleeper_id) {
    out.push(`https://sleepercdn.com/content/nba/players/thumb/${p.sleeper_id}.jpg`)
  }
  return out
}

function mlbChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  const mlbKey = p.mlb_id || p.ri_id
  if (mlbKey) {
    out.push(
      `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${mlbKey}/headshot/67/current`,
    )
  }
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'MLB')
    if (u) out.push(u)
  }
  return out
}

function nhlChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  const nhlKey = p.nhl_id || p.ri_id
  if (nhlKey) {
    out.push(`https://assets.nhle.com/mugs/nhl/latest/${nhlKey}.png`)
  }
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'NHL')
    if (u) out.push(u)
  }
  return out
}

function ncaaFbChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'NCAAFB')
    if (u) out.push(u)
  }
  return out
}

function ncaaBbChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'NCAABB')
    if (u) out.push(u)
  }
  return out
}

function pgaChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'PGA')
    if (u) out.push(u)
  }
  return out
}

function soccerChain(p: EnrichedPlayer): string[] {
  const out: string[] = []
  if (p.headshot_url) out.push(p.headshot_url)
  if (p.espn_id) {
    const u = espnHeadshotUrl(p.espn_id, 'SOCCER')
    if (u) out.push(u)
  }
  return out
}

/** Ordered URLs for PlayerImage to try on each onError (highest quality first). */
export function resolveHeadshotCandidates(player: EnrichedPlayer): string[] {
  const s = normalizeHeadshotSport(player.sport)
  let chain: string[] = []
  switch (s) {
    case 'NFL':
      chain = nflChain(player)
      break
    case 'NBA':
      chain = nbaChain(player)
      break
    case 'MLB':
      chain = mlbChain(player)
      break
    case 'NHL':
      chain = nhlChain(player)
      break
    case 'NCAAFB':
      chain = ncaaFbChain(player)
      break
    case 'NCAABB':
      chain = ncaaBbChain(player)
      break
    case 'PGA':
      chain = pgaChain(player)
      break
    case 'SOCCER':
      chain = soccerChain(player)
      break
    default:
      chain = nflChain(player)
      break
  }
  // A provider placeholder ("contact_support") is not a URL — see lib/media/imageUrl.ts.
  return dedupe(chain).filter((url) => toImageUrl(url) != null)
}

export function resolveHeadshot(player: EnrichedPlayer): string {
  const c = resolveHeadshotCandidates(player)
  return c[0] ?? ''
}

export function buildEnrichedPlayer(input: {
  sleeper_id: string
  full_name: string
  position: string
  team: string
  sport: string
  espn_id?: string
  ri_id?: string
  nba_id?: string
  mlb_id?: string
  nhl_id?: string
  pga_id?: string
  headshot_url?: string
}): EnrichedPlayer {
  const sportNorm = normalizeHeadshotSport(input.sport)
  const espn =
    input.espn_id && espnHeadshotUrl(input.espn_id, sportNorm)
      ? espnHeadshotUrl(input.espn_id, sportNorm) ?? undefined
      : undefined

  const sleeperNfl =
    sportNorm === 'NFL'
      ? `https://sleepercdn.com/content/nfl/players/thumb/${input.sleeper_id}.jpg`
      : undefined
  const sleeperNba =
    sportNorm === 'NBA'
      ? `https://sleepercdn.com/content/nba/players/thumb/${input.sleeper_id}.jpg`
      : undefined

  return {
    sleeper_id: input.sleeper_id,
    ri_id: input.ri_id,
    espn_id: input.espn_id,
    nba_id: input.nba_id,
    mlb_id: input.mlb_id,
    nhl_id: input.nhl_id,
    pga_id: input.pga_id,
    full_name: input.full_name,
    position: input.position,
    team: input.team,
    sport: sportNorm,
    headshot_url: toImageUrl(input.headshot_url) ?? undefined,
    espn_url: espn,
    sleeper_url: sleeperNfl ?? sleeperNba,
  }
}
