import { prisma } from '@/lib/prisma'
import {
  suggestLeagueType,
  type SuggestedType,
  type TypeSuggestion,
} from '@/lib/career/leagueTypeSuggestion'

/**
 * Read and confirm a league's format.
 *
 * ⚠ CONFIRMATION IS STORED IN `League.settings`, NOT A NEW COLUMN. This database
 * is production, migrations here are applied as direct SQL, and the value of a
 * dedicated column over a JSON key is not worth that operation. `settings` is
 * already the league's own settings blob.
 *
 * ⚠ THE STORED `leagueType` IS NOT EVIDENCE OF ANYTHING. Every guillotine and
 * zombie label in the database was set from the league's NAME. The column tells
 * you what someone guessed, not what anyone verified — so a rank must read the
 * confirmation record, never the column.
 */

const KEY = 'leagueTypeConfirmation'

export type LeagueTypeConfirmation = {
  type: SuggestedType
  confirmedByUserId: string
  confirmedAt: string
  /** What the suggester proposed at the time, kept so drift is visible later. */
  suggestedAtConfirmation: SuggestedType | null
  /** Buy-in the user confirmed, if any. Feeds the paid-league bump. */
  buyIn: number | null
}

export type LeagueTypeState = {
  leagueId: string
  leagueName: string | null
  /** What the column says. Possibly a guess from a name. */
  storedType: string | null
  /** What we would propose, with reasons to show the user. */
  suggestion: TypeSuggestion
  /** Present only when a human has confirmed. */
  confirmation: LeagueTypeConfirmation | null
  /**
   * ⚠ THE ONLY FIELD A RANKING MAY READ. Null until confirmed, which means an
   * unconfirmed specialty league scores as an ordinary one — understated rather
   * than inflated, which is the right direction to be wrong in.
   */
  rankableType: SuggestedType | null
}

function readConfirmation(settings: unknown): LeagueTypeConfirmation | null {
  if (!settings || typeof settings !== 'object') return null
  const raw = (settings as Record<string, unknown>)[KEY]
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.type !== 'string' || typeof c.confirmedByUserId !== 'string') return null
  return {
    type: c.type as SuggestedType,
    confirmedByUserId: c.confirmedByUserId,
    confirmedAt: typeof c.confirmedAt === 'string' ? c.confirmedAt : '',
    suggestedAtConfirmation:
      typeof c.suggestedAtConfirmation === 'string'
        ? (c.suggestedAtConfirmation as SuggestedType)
        : null,
    buyIn: typeof c.buyIn === 'number' ? c.buyIn : null,
  }
}

/** Current state for one league — what is stored, what we suggest, what is confirmed. */
export async function leagueTypeState(leagueId: string): Promise<LeagueTypeState | null> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: {
        id: true, name: true, leagueType: true, isDynasty: true,
        guillotineMode: true, settings: true,
      },
    })
    .catch(() => null)
  if (!league) return null

  const suggestion = suggestLeagueType({
    name: league.name,
    isDynasty: league.isDynasty,
    guillotineMode: league.guillotineMode,
    currentType: league.leagueType,
  })
  const confirmation = readConfirmation(league.settings)

  return {
    leagueId: league.id,
    leagueName: league.name,
    storedType: league.leagueType,
    suggestion,
    confirmation,
    rankableType: confirmation?.type ?? null,
  }
}

export type ConfirmResult =
  | { ok: true; state: LeagueTypeState }
  | { ok: false; reason: 'not-found' | 'invalid-type' | 'write-failed' }

const VALID: ReadonlySet<string> = new Set([
  'redraft', 'dynasty', 'guillotine', 'zombie', 'tournament', 'survivor',
])

/**
 * Record a human's decision about what this league is.
 *
 * ⚠ CALLERS MUST GATE ON LEAGUE ACCESS FIRST. This function does not check who
 * is asking — it is a data operation, and the route that exposes it is
 * responsible for authorisation. Anyone able to call this can change what a
 * league's results are worth in the ranking.
 *
 * The buy-in is accepted from the caller rather than trusted from the name.
 * A "$20" in a league title is good enough to PREFILL a prompt and not good
 * enough to award the paid-league bonus on its own.
 */
export async function confirmLeagueType(input: {
  leagueId: string
  type: string
  userId: string
  buyIn?: number | null
}): Promise<ConfirmResult> {
  if (!VALID.has(input.type)) return { ok: false, reason: 'invalid-type' }

  const before = await leagueTypeState(input.leagueId)
  if (!before) return { ok: false, reason: 'not-found' }

  const confirmation: LeagueTypeConfirmation = {
    type: input.type as SuggestedType,
    confirmedByUserId: input.userId,
    confirmedAt: new Date().toISOString(),
    // Kept so a later disagreement between suggester and human is visible
    // rather than silently overwritten.
    suggestedAtConfirmation: before.suggestion.suggested,
    buyIn:
      typeof input.buyIn === 'number' && Number.isFinite(input.buyIn) && input.buyIn > 0
        ? input.buyIn
        : null,
  }

  try {
    const existing = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { settings: true },
    })
    const merged = {
      ...((existing?.settings as Record<string, unknown> | null) ?? {}),
      [KEY]: confirmation,
    }
    /*
     * `leagueType` is updated too, so the rest of the app sees the corrected
     * format. But the confirmation record stays the authority for ranking —
     * the column can be overwritten by any future importer that guesses again.
     */
    await prisma.league.update({
      where: { id: input.leagueId },
      data: { settings: merged as never, leagueType: input.type },
    })
  } catch {
    return { ok: false, reason: 'write-failed' }
  }

  const after = await leagueTypeState(input.leagueId)
  return after ? { ok: true, state: after } : { ok: false, reason: 'write-failed' }
}

/**
 * Leagues a user should be asked about — a specialty format we suspect but
 * nobody has confirmed.
 *
 * Deliberately excludes low-confidence and non-competitive matches, so the
 * prompt is short and every row in it is worth a person's attention.
 */
export async function pendingTypeConfirmations(leagueIds: string[]): Promise<LeagueTypeState[]> {
  const out: LeagueTypeState[] = []
  for (const id of leagueIds) {
    const state = await leagueTypeState(id)
    if (!state || state.confirmation) continue
    const s = state.suggestion
    if (!s.suggested || s.suggested === 'redraft') continue
    if (s.looksNonCompetitive) continue
    out.push(state)
  }
  return out
}
