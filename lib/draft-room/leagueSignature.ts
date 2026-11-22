/**
 * Room v2 league signatures (2026-11): what a drafted tile says beyond name, position and team,
 * decided by the league's concept. One short chip at most — the tile's info line is ~84–100px wide
 * and already carries injury, auction price and the ADP gap.
 *
 *   dynasty, keeper, devy, c2c, efl   the player's age ("24y"): the number a long-horizon league
 *                                     drafts on. A "Rookie" tag would sit on every tile of a rookie
 *                                     draft and say nothing.
 *   a college pick in devy or c2c     the class year ("JR"), which is that player's clock.
 *   every other concept               nothing; a redraft tile stays as it was.
 *
 * Signatures that need in-season data (a Head of Household, chopped teams, Zombie statuses) do not
 * exist at draft time and are not drawn here. Survivor's tribe colours live on the board's columns
 * (`DraftBoard`), not on the tile.
 */
import type { LeagueConceptType } from '@/lib/league/leagueConceptOptions'

export type TileSignatureChip = {
  kind: 'age' | 'class'
  /** What the tile prints. */
  text: string
  /** Spelled out for the title and screen readers. */
  title: string
}

const AGE_CONCEPTS = new Set<LeagueConceptType>(['dynasty', 'keeper', 'devy', 'c2c', 'efl'])
const COLLEGE_CONCEPTS = new Set<LeagueConceptType>(['devy', 'c2c'])

const CLASS_NAMES: Record<string, string> = {
  FR: 'Freshman',
  SO: 'Sophomore',
  JR: 'Junior',
  SR: 'Senior',
  GR: 'Graduate',
}

/** The pool fields a signature reads, as `NormalizedDraftEntry` carries them. */
export type SignaturePoolEntry = {
  age?: number | string | null
  classYearLabel?: string | null
  isDevy?: boolean
  poolType?: 'college' | 'pro' | string | null
  display?: { metadata?: { age?: number | null; classYearLabel?: string | null } | null } | null
}

function readAge(entry: SignaturePoolEntry): number | null {
  const raw = entry.age ?? entry.display?.metadata?.age ?? null
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw
  // Ages outside a playing career are bad data, not a 4-year-old quarterback.
  return typeof n === 'number' && Number.isFinite(n) && n >= 16 && n <= 50 ? Math.floor(n) : null
}

function readClass(entry: SignaturePoolEntry): string | null {
  const raw = String(entry.classYearLabel ?? entry.display?.metadata?.classYearLabel ?? '').trim()
  if (!raw) return null
  const key = raw.toUpperCase()
  // Short labels as the devy workers write them; anything longer would break the tile's line.
  return key.length <= 4 ? key : null
}

function isCollegeEntry(entry: SignaturePoolEntry): boolean {
  return entry.isDevy === true || entry.poolType === 'college'
}

export function tileSignatureChip(
  concept: LeagueConceptType | null | undefined,
  entry: SignaturePoolEntry | null | undefined,
): TileSignatureChip | null {
  if (!concept || !entry) return null
  if (COLLEGE_CONCEPTS.has(concept) && isCollegeEntry(entry)) {
    const cls = readClass(entry)
    if (cls) return { kind: 'class', text: cls, title: CLASS_NAMES[cls] ?? `Class ${cls}` }
    return null
  }
  if (!AGE_CONCEPTS.has(concept)) return null
  const age = readAge(entry)
  return age == null ? null : { kind: 'age', text: `${age}y`, title: `Age ${age}` }
}

type SignaturePoolRow = SignaturePoolEntry & {
  playerId?: string | null
  name?: string | null
  position?: string | null
  team?: string | null
  display?: (SignaturePoolEntry['display'] & { playerId?: string | null }) | null
}

type SignaturePick = {
  overall: number
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
}

function trimmed(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : ''
}

function nameKey(name?: string | null, position?: string | null, team?: string | null): string {
  return `${trimmed(name)}|${trimmed(position)}|${trimmed(team)}`
}

/**
 * Each made pick's chip, keyed by overall — the shape the board already takes for the ADP gap.
 * A pick finds its pool player as `fillPickHeadshotsFromPool` does: id first, then exact name +
 * position + team (auto picks outside the NFL can carry an id the pool spells differently).
 */
export function tileSignatureChipsByOverall(
  concept: LeagueConceptType | null | undefined,
  picks: ReadonlyArray<SignaturePick>,
  entries: ReadonlyArray<SignaturePoolRow>,
): Record<number, TileSignatureChip> {
  const out: Record<number, TileSignatureChip> = {}
  if (!concept || (!AGE_CONCEPTS.has(concept) && !COLLEGE_CONCEPTS.has(concept))) return out
  if (picks.length === 0 || entries.length === 0) return out
  const byId = new Map<string, SignaturePoolRow>()
  const byName = new Map<string, SignaturePoolRow>()
  for (const entry of entries) {
    for (const id of [trimmed(entry.playerId), trimmed(entry.display?.playerId)]) {
      if (id && !byId.has(id)) byId.set(id, entry)
    }
    const nk = nameKey(entry.name, entry.position, entry.team)
    if (!byName.has(nk)) byName.set(nk, entry)
  }
  for (const pick of picks) {
    if (!trimmed(pick.playerName)) continue
    const id = trimmed(pick.playerId)
    const entry = (id ? byId.get(id) : undefined) ?? byName.get(nameKey(pick.playerName, pick.position, pick.team))
    const chip = tileSignatureChip(concept, entry)
    if (chip) out[pick.overall] = chip
  }
  return out
}
