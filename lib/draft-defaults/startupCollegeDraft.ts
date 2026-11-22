/**
 * A Devy or C2C league's startup draft: two drafts by default, one merged draft when the
 * commissioner turns it on (owner's rule, 2026-11-22: "c2c and devy league drafts should give the
 * commissioner the option to draft twice and should be on by default — the pro draft and the
 * college or devy draft. The commish can turn on a merged draft for both to run together, drafting
 * pro and college players in the same draft, but not by default").
 *
 *   separate (default)  the PRO draft runs first: every round pro-only. When it completes, the COLLEGE
 *                       draft opens: every round college-only, same order, same draft type. The league's
 *                       season starts after the college draft, not between the two.
 *   merged              one draft, as before this change: a Devy draft takes any player in any round; a
 *                       C2C draft keeps its college rounds at the end.
 *
 * HOW. The draft engine already restricts a round by `DraftSession.devyConfig.devyRounds` /
 * `c2cConfig.collegeRounds` (lib/live-draft-engine/PickValidation.ts): a listed round is college-only,
 * an unlisted one pro-only. So the pro draft lists no rounds and the college draft lists all of them,
 * and no pick rule changes. The draft pool takes its side from the session's `draftModeLabel`
 * (`startup_pro` / `college`, lib/draft-room/getResolvedDraftPoolForLeague.ts), so the board and
 * auto-pick only offer players the round accepts.
 *
 * ONLY WHERE THE POOL SEPARATES. The pool splits pro from college for NFL and NBA leagues
 * (`mergeCollegePool`); a league whose sport is NCAAF or NCAAB keeps one draft, unchanged.
 *
 * The plan lives on `League.settings.startupCollegeDraft` from creation until the college draft opens.
 */

export type StartupDraftMode = 'separate' | 'merged'

/** The first of the two drafts. Not a follow-up: it builds the lineup like any startup draft. */
export const STARTUP_PRO_DRAFT_LABEL = 'startup_pro'
/** The second: a follow-up draft, whose players are ADDED to the rosters the pro draft built. */
export const STARTUP_COLLEGE_DRAFT_LABEL = 'college'

export const STARTUP_COLLEGE_DRAFT_SETTINGS_KEY = 'startupCollegeDraft'

export type StartupCollegeDraftState = {
  mode: StartupDraftMode
  format: 'devy' | 'c2c'
  /** Rounds in the college draft, in separate mode. */
  collegeRounds: number
  /** C2C: the college-only rounds at the end of a MERGED draft (0 for Devy, whose merged draft has none). */
  mergedCollegeRounds: number
  /** pending → the college draft opens when the pro draft completes; open → it has been created. */
  status: 'pending' | 'open'
}

/** Sports whose draft pool keeps pro and college players apart. */
const SEPARABLE_SPORTS = new Set(['NFL', 'NBA'])

export function supportsSeparateStartupDrafts(format: string | null | undefined, sport: string | null | undefined): boolean {
  const f = String(format ?? '').toLowerCase()
  return (f === 'devy' || f === 'c2c') && SEPARABLE_SPORTS.has(String(sport ?? '').toUpperCase())
}

const clampRounds = (n: unknown, fallback: number) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 30) : fallback
}

export function readStartupCollegeDraft(settings: unknown): StartupCollegeDraftState | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[STARTUP_COLLEGE_DRAFT_SETTINGS_KEY] : null
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const mode = r.mode === 'merged' ? 'merged' : r.mode === 'separate' ? 'separate' : null
  const format = r.format === 'c2c' ? 'c2c' : r.format === 'devy' ? 'devy' : null
  if (!mode || !format) return null
  const merged = Math.round(Number(r.mergedCollegeRounds))
  return {
    mode,
    format,
    collegeRounds: clampRounds(r.collegeRounds, 4),
    mergedCollegeRounds: format === 'c2c' && Number.isFinite(merged) && merged >= 0 ? Math.min(merged, 30) : 0,
    status: r.status === 'open' ? 'open' : 'pending',
  }
}

export type StartupDraftPlan = {
  state: StartupCollegeDraftState
  /** The first (or only) draft's shape. */
  first: {
    rounds: number
    draftModeLabel: string | null
    devyConfig: Record<string, unknown> | null
    c2cConfig: Record<string, unknown> | null
  }
}

const roundList = (count: number) => Array.from({ length: count }, (_, i) => i + 1)
const withoutRoundList = (config: Record<string, unknown> | null | undefined) => {
  if (!config) return null
  const { devyRounds: _devyRounds, ...rest } = config
  return rest
}

/**
 * The startup draft(s) a new Devy or C2C league gets.
 *
 * `rounds` and the configs are what the league's defaults produce for ONE draft. `collegeDraftRounds`
 * is the college draft's length in separate mode (Devy: its DEVY seats; C2C: its college draft rounds).
 */
export function planStartupDrafts(input: {
  format: 'devy' | 'c2c'
  rounds: number
  devyConfig: Record<string, unknown> | null | undefined
  c2cConfig: Record<string, unknown> | null | undefined
  collegeDraftRounds: number | null | undefined
  merged: boolean
}): StartupDraftPlan {
  const c2cListed = Array.isArray((input.c2cConfig as { collegeRounds?: unknown } | null)?.collegeRounds)
    ? ((input.c2cConfig as { collegeRounds: unknown[] }).collegeRounds.length)
    : 0
  const collegeRounds = clampRounds(input.collegeDraftRounds, input.format === 'c2c' ? c2cListed || 6 : 4)
  const mergedCollegeRounds = input.format === 'c2c' ? c2cListed : 0
  if (input.merged) {
    return {
      state: { mode: 'merged', format: input.format, collegeRounds, mergedCollegeRounds, status: 'open' },
      first: {
        rounds: input.rounds,
        draftModeLabel: null,
        devyConfig: input.devyConfig ?? null,
        c2cConfig: input.c2cConfig ?? null,
      },
    }
  }
  // A C2C draft's listed college rounds move to the college draft; a Devy draft listed none.
  const proRounds = input.format === 'c2c' ? Math.max(1, input.rounds - c2cListed) : input.rounds
  return {
    state: { mode: 'separate', format: input.format, collegeRounds, mergedCollegeRounds, status: 'pending' },
    first: {
      rounds: proRounds,
      draftModeLabel: STARTUP_PRO_DRAFT_LABEL,
      devyConfig: input.format === 'devy' ? { ...(input.devyConfig ?? {}), enabled: true, devyRounds: [] } : null,
      c2cConfig: input.format === 'c2c' ? { ...(input.c2cConfig ?? {}), enabled: true, collegeRounds: [] } : null,
    },
  }
}

/** The college draft's round restriction: every round college-only. */
export function collegeDraftRoundConfig(format: 'devy' | 'c2c', rounds: number, base: Record<string, unknown> | null | undefined) {
  return format === 'devy'
    ? { devyConfig: { ...(base ?? {}), enabled: true, devyRounds: roundList(rounds) }, c2cConfig: null }
    : { devyConfig: null, c2cConfig: { ...(base ?? {}), enabled: true, collegeRounds: roundList(rounds) } }
}

/** The pool side a startup draft's label calls for, or null for any other draft. */
export function poolTypeForStartupDraftLabel(
  label: string | null | undefined,
  league: { isC2C: boolean; isDevy: boolean },
): 'startup_pro' | 'startup_vet' | 'startup_college' | 'devy' | null {
  const l = String(label ?? '').toLowerCase()
  if (l === STARTUP_PRO_DRAFT_LABEL) return league.isC2C ? 'startup_pro' : league.isDevy ? 'startup_vet' : null
  if (l === STARTUP_COLLEGE_DRAFT_LABEL) return league.isC2C ? 'startup_college' : league.isDevy ? 'devy' : null
  return null
}

type SessionRow = {
  id: string
  draftModeLabel: string | null
  draftType: string
  teamCount: number
  slotOrder: unknown
  timerSeconds: number | null
  thirdRoundReversal: boolean
  sportType: string | null
  cpuAutoPick: boolean
  aiAutoPick: boolean
  devyConfig: unknown
  c2cConfig: unknown
}

type Tx = {
  league: {
    findUnique: (args: { where: { id: string }; select: { settings: true } }) => Promise<{ settings: unknown } | null>
    update: (args: { where: { id: string }; data: { settings: object } }) => Promise<unknown>
  }
  draftSession: {
    count: (args: { where: Record<string, unknown> }) => Promise<number>
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
  }
}

/**
 * When a separate-mode league's PRO draft completes, open its COLLEGE draft. Inside the completion
 * transaction, so a crash cannot leave the league with neither the next draft nor a season.
 *
 * Returns the new session's id, or null when this is not that moment (any other draft, merged mode,
 * already opened). The caller holds the season's lifecycle back while it returns an id.
 */
export async function openStartupCollegeDraftInTransaction(tx: Tx, leagueId: string, completed: SessionRow): Promise<string | null> {
  if (String(completed.draftModeLabel ?? '').toLowerCase() !== STARTUP_PRO_DRAFT_LABEL) return null
  const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const state = readStartupCollegeDraft(league?.settings)
  if (!state || state.mode !== 'separate' || state.status !== 'pending') return null
  const existing = await tx.draftSession.count({ where: { leagueId, draftModeLabel: STARTUP_COLLEGE_DRAFT_LABEL } })
  if (existing > 0) return null
  const base = (state.format === 'devy' ? completed.devyConfig : completed.c2cConfig) as Record<string, unknown> | null
  const restrict = collegeDraftRoundConfig(state.format, state.collegeRounds, base)
  const created = await tx.draftSession.create({
    data: {
      leagueId,
      status: 'pre_draft',
      draftType: completed.draftType === 'auction' ? 'snake' : completed.draftType,
      rounds: state.collegeRounds,
      teamCount: completed.teamCount,
      timerSeconds: completed.timerSeconds,
      slotOrder: completed.slotOrder ?? [],
      sportType: completed.sportType,
      sessionKind: 'live',
      thirdRoundReversal: completed.thirdRoundReversal,
      cpuAutoPick: completed.cpuAutoPick,
      aiAutoPick: completed.aiAutoPick,
      draftModeLabel: STARTUP_COLLEGE_DRAFT_LABEL,
      ...(restrict.devyConfig ? { devyConfig: restrict.devyConfig } : {}),
      ...(restrict.c2cConfig ? { c2cConfig: restrict.c2cConfig } : {}),
    },
  })
  const settings = league?.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {}
  await tx.league.update({
    where: { id: leagueId },
    data: { settings: { ...settings, [STARTUP_COLLEGE_DRAFT_SETTINGS_KEY]: { ...state, status: 'open' } } },
  })
  return created.id
}

/**
 * The commissioner's switch between two drafts and one merged draft, before the startup draft has
 * a pick. Rewrites the pending draft's rounds and round restriction:
 *
 *   separate → merged   the college rounds join the draft (C2C: as its last rounds, college-only;
 *                       Devy: any player, any round, as a merged Devy draft always was)
 *   merged → separate   the draft becomes pro-only and the college draft is queued for afterwards
 *
 * Pure: takes the draft as it stands, returns what to write.
 */
export function switchStartupDraftMode(
  state: StartupCollegeDraftState,
  draft: { rounds: number; devyConfig: Record<string, unknown> | null; c2cConfig: Record<string, unknown> | null },
  to: StartupDraftMode,
): { state: StartupCollegeDraftState; rounds: number; draftModeLabel: string | null; devyConfig: Record<string, unknown> | null; c2cConfig: Record<string, unknown> | null } | null {
  if (state.mode === to) return null
  if (to === 'merged') {
    const added = state.format === 'c2c' ? state.mergedCollegeRounds : 0
    const rounds = Math.min(50, draft.rounds + added)
    return {
      state: { ...state, mode: 'merged', status: 'open' },
      rounds,
      draftModeLabel: null,
      devyConfig: state.format === 'devy' ? withoutRoundList(draft.devyConfig) : draft.devyConfig,
      c2cConfig:
        state.format === 'c2c'
          ? { ...(draft.c2cConfig ?? {}), enabled: true, collegeRounds: Array.from({ length: added }, (_, i) => rounds - added + 1 + i) }
          : draft.c2cConfig,
    }
  }
  const listed = Array.isArray((draft.c2cConfig as { collegeRounds?: unknown } | null)?.collegeRounds)
    ? (draft.c2cConfig as { collegeRounds: unknown[] }).collegeRounds.length
    : 0
  return {
    state: { ...state, mode: 'separate', status: 'pending', mergedCollegeRounds: state.format === 'c2c' ? listed : 0 },
    rounds: state.format === 'c2c' ? Math.max(1, draft.rounds - listed) : draft.rounds,
    draftModeLabel: STARTUP_PRO_DRAFT_LABEL,
    devyConfig: state.format === 'devy' ? { ...(draft.devyConfig ?? {}), enabled: true, devyRounds: [] } : draft.devyConfig,
    c2cConfig: state.format === 'c2c' ? { ...(draft.c2cConfig ?? {}), enabled: true, collegeRounds: [] } : draft.c2cConfig,
  }
}
