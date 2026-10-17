import { getAllPlayers, type SleeperPlayer } from '@/lib/sleeper-client'
import { positionGroupsAgree } from '@/lib/player-match/authoritativePlayerRow'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { getTeamInfo, normalizePositionForSport } from '@/lib/team-abbrev'

type SleeperPlayerEntry = Pick<
  SleeperPlayer,
  'full_name' | 'first_name' | 'last_name' | 'position' | 'team' | 'age'
> & {
  /** Present on Sleeper's payload though not on `SleeperPlayer`; two-way players list both sides. */
  fantasy_positions?: string[] | null
}

/** One dictionary entry as a match candidate, positions folded to one NFL vocabulary (PK→K, DST→DEF). */
type SleeperCandidate = {
  id: string
  name: string
  position: string | null
  /** `position` plus every folded `fantasy_positions` entry. */
  positions: string[]
  team: string | null
}

export type SleeperIdLookup = {
  name: string
  /** Strongly recommended: without it, any name shared by two dictionary entries is refused. */
  position?: string | null
  /** NFL club only. Never pass a college team — "Tennessee" folds to TEN. */
  team?: string | null
}

let playersDict: Record<string, SleeperPlayerEntry> | null = null
let nameIndex: Map<string, SleeperCandidate[]> | null = null
let nameIndexFor: Record<string, SleeperPlayerEntry> | null = null
let cacheTs = 0
const CACHE_TTL = 6 * 60 * 60 * 1000

export async function getSleeperPlayersDict(): Promise<Record<string, SleeperPlayerEntry>> {
  const now = Date.now()
  if (playersDict && now - cacheTs < CACHE_TTL) return playersDict
  try {
    const data = await getAllPlayers()
    playersDict = data
    cacheTs = now
    return data
  } catch {
    return playersDict || {}
  }
}

const foldPosition = (raw: string | null | undefined) => normalizePositionForSport('NFL', raw)
const foldTeam = (raw: string | null | undefined) => getTeamInfo(raw)?.canonical ?? null

/**
 * 🛑 THIS WAS A FIRST-WINS name→id MAP OVER THE WHOLE SLEEPER DICTIONARY — retired players, free
 * agents and offensive linemen included — and callers had no way to say which Josh Allen they
 * meant. Measured in prod `draft_pool_cache` (2026-10-12): QB Josh Allen BUF carried 2212 (Josh
 * Allen, G, FA), WR DJ Moore a CB's id, RB Kenneth Walker a WR's (4634), devy WR Mike Matthews a
 * retired C's; 19 active skill players lost to a namesake and wore that namesake's CDN headshot.
 *
 * Collisions are now kept (`buildNameIndex`) and bound only through `resolveVerifiedMatch`, which
 * refuses an ambiguous name. No id is a gap; the wrong id is somebody else's face.
 *
 * Keyed on the dictionary object, so a refreshed dictionary rebuilds the index.
 */
function getNameIndex(dict: Record<string, SleeperPlayerEntry>): Map<string, SleeperCandidate[]> {
  if (nameIndex && nameIndexFor === dict) return nameIndex
  const rows: SleeperCandidate[] = []
  for (const [id, p] of Object.entries(dict)) {
    if (!p || typeof p !== 'object') continue
    // DEF entries are keyed by club (id "BUF", position DEF) with first/last "Buffalo"/"Bills".
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ')
    if (!name) continue
    const position = foldPosition(p.position)
    const positions = [position, ...(Array.isArray(p.fantasy_positions) ? p.fantasy_positions : []).map(foldPosition)]
      .filter((x): x is string => Boolean(x))
    rows.push({ id, name, position, positions, team: foldTeam(p.team) })
  }
  nameIndex = buildNameIndex(rows)
  nameIndexFor = dict
  return nameIndex
}

function resolveOne(index: Map<string, SleeperCandidate[]>, lookup: SleeperIdLookup): string | null {
  const position = foldPosition(lookup.position)
  const result = resolveVerifiedMatch(index, { name: lookup.name, position, team: foldTeam(lookup.team) })
  const match = result.match
  if (!match) return null
  /*
   * A NAME UNIQUE IN SLEEPER'S NFL DICTIONARY IS NOT THE SAME PLAYER WHEN THE POSITION DISAGREES.
   * `resolveVerifiedMatch` binds a lone candidate without reading position, and the dictionary
   * holds no college players: devy WR Mike Matthews (Tennessee) bound to 3544, Mike Matthews, C —
   * the only Mike Matthews Sleeper has. Same side of the ball, so `refuseContradictedSingle` would
   * not catch it. When both sides state a position, the bound entry must agree on it — the same
   * holds for a collision narrowed by TEAM alone after no candidate shared the position.
   * Agreement is by position GROUP (feeds split DE/LB/DL), and `fantasy_positions` counts, so a
   * two-way WR/CB is not refused for either label.
   */
  if (position && match.positions.length > 0 && !match.positions.some((p) => positionGroupsAgree(p, position))) {
    return null
  }
  return match.id
}

/**
 * Name-only resolution. A name shared by two or more dictionary entries is REFUSED (no id), never
 * guessed — use `resolveSleeperIdsBatch` with positions wherever the caller has them.
 */
export async function resolveSleeperIds(names: string[]): Promise<Record<string, string>> {
  const index = getNameIndex(await getSleeperPlayersDict())
  const result: Record<string, string> = {}
  for (const name of names) {
    const id = resolveOne(index, { name })
    if (id) result[name] = id
  }
  return result
}

/**
 * Position/team-verified resolution. Results are ALIGNED WITH THE INPUT rather than keyed by name,
 * so QB Josh Allen and LB Josh Allen in one pool cannot overwrite each other.
 */
export async function resolveSleeperIdsBatch(players: SleeperIdLookup[]): Promise<Array<string | null>> {
  const index = getNameIndex(await getSleeperPlayersDict())
  return players.map((p) => resolveOne(index, p))
}

export function sleeperAvatarUrl(avatarId?: string | null): string {
  if (!avatarId) return ''
  return `https://sleepercdn.com/avatars/thumbs/${avatarId}`
}
