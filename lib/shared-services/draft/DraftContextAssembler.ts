/**
 * Draft Context Assembler — Draft OS foundation, Phase 8.
 *
 * Assembles the real RecommendationEngine input (RecommendationInput —
 * lib/draft-helper/RecommendationEngine.ts, the canonical engine reused by
 * every real live draft-recommendation caller confirmed during the audit:
 * the human draft assistant, the War Room route, Live Draft Brain, need-based
 * autopick, and Draft Intelligence's queue suggestions) from real, already-
 * persisted data.
 *
 * IMPORTANT, VERIFIED FACT (not assumed): the real live route
 * (app/api/draft/recommend/route.ts) receives `available`/`teamRoster` from
 * the REQUEST BODY, not a server-side DB read — the draft-room UI already
 * holds live draft state via its own sync channel and posts it directly.
 * There is therefore no pre-existing server-side "assemble draft context"
 * function to reuse; this assembler is a genuinely new (but schema-verified)
 * reconstruction from real Prisma rows, built for shadow-mode re-evaluation
 * and backtesting, where no live client state exists to reuse.
 *
 * Real data sources, each independently verified before use:
 *  - DraftSession + DraftPick (prisma/schema.prisma) — the live draft's real
 *    state and pick history.
 *  - lib/adp/readSnapshotForLeague.ts's readAllFantasyAdpForLeague() — the
 *    real, already-canonical AllFantasy ADP snapshot ("NEVER falls back to
 *    external/market ADP", per that file's own docstring).
 *  - lib/multi-sport/RosterTemplateService.ts's getRosterTemplate() — the
 *    real roster-slot template resolver (commissioner-customized or
 *    sport-default), same source lib/roster/LineupTemplateValidation.ts's
 *    getSlotLimitsFromTemplate() already consumes.
 *  - lib/sport-teams/SportPlayerPoolResolver.ts's getPlayerPoolForLeague() —
 *    the same sport-scoped player pool Waiver OS's WaiverContextAssembler.ts
 *    (Phase 7) already reuses. Used here ONLY to fill in `team`/player-id gaps
 *    the ADP snapshot itself doesn't carry (its own type docs: "team isn't
 *    stored in the snapshot") — never to replace the ADP number itself.
 *
 * Unlike Trade OS, and like Waiver OS, this module never calls
 * runImportedLeagueNormalizationPipeline — natively-created leagues are fully
 * assemblable.
 */

import { prisma } from '@/lib/prisma'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { readAllFantasyAdpForLeague } from '@/lib/adp/readSnapshotForLeague'
import { getRosterTemplate } from '@/lib/multi-sport/RosterTemplateService'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { getBudgetsFromSession } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { isIdpLeague } from '@/lib/idp'
import type { LeagueSport } from '@prisma/client'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import type { RecommendationInput } from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resolveTeamByeWeeks } from '@/lib/schedule/teamByeWeeks'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { picksUntilNextTurn, type ScoringWindow } from '@/lib/draft-helper/draftContextSignals'

/**
 * Real keeper-lock extraction (Phase 30) from DraftSession.keeperSelections
 * (a Json? field, shape: KeeperSelection[] from lib/live-draft-engine/keeper/types.ts).
 * Never throws: malformed/absent data degrades to an empty array, matching this
 * whole pipeline's established "honest, non-fabricating" fallback discipline.
 */
export function extractKeeperLockedPlayers(keeperSelectionsJson: unknown): Array<{ playerName: string; position: string }> {
  try {
    if (!Array.isArray(keeperSelectionsJson)) return []
    const out: Array<{ playerName: string; position: string }> = []
    for (const raw of keeperSelectionsJson) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Record<string, unknown>
      const playerName = typeof entry.playerName === 'string' ? entry.playerName : null
      const position = typeof entry.position === 'string' ? entry.position : null
      if (playerName && position) out.push({ playerName, position })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Real auction budget context (Phase 30) for one target roster. Reuses
 * getBudgetsFromSession() (lib/live-draft-engine/auction/AuctionEngine.ts) --
 * the exact real function AuctionEngine's own bid validation already uses --
 * rather than a reimplemented parse. Only computed for real auction drafts
 * (session.draftType === 'auction'); returns undefined otherwise, which the
 * engine treats as "no auction adjustment" (snake/linear drafts unaffected).
 */
export function resolveAuctionContext(
  session: { draftType: string | null; auctionBudgetPerTeam: number | null; auctionBudgets: unknown; slotOrder: unknown; rounds?: number | null },
  targetRosterId: string,
  rosterSlots: string[],
  teamRosterCount: number
): { remainingBudget: number; rosterSlotsRemaining: number } | undefined {
  if (session.draftType !== 'auction') return undefined
  try {
    const budgets = getBudgetsFromSession(session)
    const remainingBudget = budgets[targetRosterId] ?? session.auctionBudgetPerTeam ?? 200
    /*
     * ⚠ OPEN SLOTS ARE THE DRAFT'S ROUNDS, NOT THE STARTING SLOTS (fixed 2026-11-14). The bid engine
     * (AuctionEngine) counts open slots as `session.rounds − picks`; `rosterSlots` is starters only,
     * so this used to report ~7 open slots where the bid engine saw ~15 and misjudged affordability.
     */
    const totalSlots = session.rounds != null && session.rounds > 0 ? session.rounds : rosterSlots.length
    const rosterSlotsRemaining = Math.max(0, totalSlots - teamRosterCount)
    return { remainingBudget, rosterSlotsRemaining }
  } catch {
    return undefined
  }
}

/**
 * The league's draft roster shape — starting slots plus superflex/2QB — from the SAME rules
 * `buildDraftDecisionContext` uses (`resolveLeagueScoringFlags`, `isIdpLeague`, `getRosterTemplate`).
 * For callers that need the engine's need model without the whole decision context, e.g. the queue
 * reorder. Fails closed to the sport defaults (empty slots, no flags) rather than throwing.
 */
export async function resolveDraftRosterShape(
  leagueId: string,
  league: { sport: string; settings: unknown; starters: unknown },
): Promise<{ rosterSlots: string[]; isSF: boolean; is2QB: boolean }> {
  try {
    const { isSF, is2QB } = resolveLeagueScoringFlags(league.settings, league.starters)
    const rosterFormatType = (await isIdpLeague(leagueId)) ? 'IDP' : 'standard'
    const template = await getRosterTemplate(league.sport as LeagueSport, rosterFormatType, leagueId)
    const rosterSlots = template.slots.flatMap((slot) => Array(Math.max(0, slot.starterCount)).fill(slot.slotName))
    return { rosterSlots, isSF, is2QB }
  } catch {
    return { rosterSlots: [], isSF: false, is2QB: false }
  }
}

export interface BuildDraftDecisionContextInput {
  leagueId: string
  rosterId: string
  mode?: 'bpa' | 'needs'
}

export interface DraftDecisionContext {
  leagueId: string
  rosterId: string
  sessionId: string | null
  /** League.platform — 'native' or a real ImportProvider value. */
  platform: string
  sport: string
  isDynasty: boolean
  isSF: boolean
  /** Real 2QB flag (Phase 31), mutually exclusive with isSF — see resolveLeagueScoringFlags(). */
  is2QB: boolean
  round: number
  /** Overall pick number in the draft (DraftSession.nextOverallPick) — unchanged meaning. */
  pick: number
  /**
   * Pick within the round (1..totalTeams) — what the ENGINE's `pick` means. Added 2026-11-14; the
   * engine input now gets this, not `pick`. `pick` keeps its overall meaning so consumers on the
   * decision-boundary backlog (DraftShadowService) are untouched.
   */
  pickInRound: number
  /** The weeks this draft scores, for a tournament-stage league; null for a season-long one. */
  scoringWindow: ScoringWindow | null
  totalTeams: number
  status: string | null
  draftType: string | null
  isDevy: boolean
  /** Roster.platformUserId — used as the Knowledge Graph manager key, same convention as Waiver OS. */
  managerKey: string | null
  assembledAt: string
  engineInput: RecommendationInput
  /** name|position (lowercased) -> resolved sport-pool player_id, when a real match was found. Used for KG PlayerExposure lookups and the legacy grader adapter — never fabricated when absent. */
  playerIdByKey: Map<string, string>
  dataCompleteness: {
    availablePoolSize: number
    adpSampleTotal: number
    rosterPickCount: number
    unresolvedPlayerIdCount: number
  }
}

export function playerKey(name: string, position: string): string {
  return `${name.trim().toLowerCase()}|${position.trim().toLowerCase()}`
}

/**
 * Real PPR (points-per-reception) value lookup (Phase 29). Reuses the exact
 * raw-settings-key pattern already confirmed in real use by
 * lib/agents/anthropic-pipeline.ts's buildLeagueScoringSettings() --
 * `settings.ppr` / `settings.points_per_reception` -- rather than the
 * structured `ScoringSettingsSlice.format` field, which has zero confirmed
 * real callers anywhere in the codebase (checked this phase).
 */
function resolveScoringFormat(settingsJson: unknown): 'standard' | 'half_ppr' | 'ppr' {
  try {
    const settings = (settingsJson ?? {}) as Record<string, unknown>
    const raw = settings.ppr ?? settings.points_per_reception
    const ppr = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(ppr) || ppr <= 0) return 'standard'
    if (ppr >= 1) return 'ppr'
    return 'half_ppr'
  } catch {
    return 'standard'
  }
}

/**
 * Real starter-slot counter (Phase 31) for League.starters -- the raw
 * provider position array/object (e.g. Sleeper's roster_positions), a
 * DIFFERENT column from League.settings. Mirrors the parsing shape of
 * lib/agents/anthropic-pipeline.ts's countStarterSlots() (not exported from
 * that file, so reimplemented here rather than imported) -- the only other
 * real, already-in-production parser of this exact field. Handles both
 * shapes seen in real data: an array of position-code strings, or an
 * object of {SLOT: count}.
 */
function parseStarterSlotCounts(startersJson: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (Array.isArray(startersJson)) {
    for (const slot of startersJson) {
      if (typeof slot !== 'string') continue
      const key = slot.toUpperCase()
      out[key] = (out[key] ?? 0) + 1
    }
  } else if (startersJson && typeof startersJson === 'object') {
    for (const [key, value] of Object.entries(startersJson as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key.toUpperCase()] = value
    }
  }
  return out
}

/**
 * Real TE Premium value (Phase 31): reads the same settings.te_premium /
 * settings.tePremium field lib/agents/anthropic-pipeline.ts's
 * buildLeagueScoringSettings() already reads for AI chat context -- reused,
 * not invented. Honest disclosure: a direct .env.test query found 0/65 real
 * leagues populate this field (see FANTASY_OS_TE_PREMIUM_AUDIT_PHASE31.md).
 */
function resolveTePremiumValue(settingsJson: unknown): number | null {
  try {
    const settings = (settingsJson ?? {}) as Record<string, unknown>
    const raw = settings.te_premium ?? settings.tePremium
    const value = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Real Superflex/2QB disambiguation (Phase 31), replacing a confirmed bug:
 * the prior isSF check (rosterSettings.starterSlots.QB >= 2, from
 * League.settings) never fired for a single one of the 65 real leagues in
 * .env.test -- a direct query found real Superflex leagues instead carry a
 * SUPER_FLEX/SFLEX/OP slot key on League.starters (4 real leagues confirmed:
 * QB:1 + SUPER_FLEX:1), the same real slot-key vocabulary
 * lib/multi-sport/RosterTemplateService.ts's FLEX_SLOT_NAMES and
 * lib/agents/anthropic-pipeline.ts's buildLeagueScoringSettings() already
 * use. True 2QB (two dedicated QB-only slots, no flex slot) had zero real
 * occurrences in .env.test but is a real, structurally distinct, mutually
 * exclusive shape (0 real leagues carry both signals at once) -- so isSF and
 * is2QB are computed as mutually exclusive, with a real superflex slot/flag
 * taking precedence.
 */
export function resolveLeagueScoringFlags(
  settingsJson: unknown,
  startersJson?: unknown
): { isSF: boolean; is2QB: boolean; scoringFormat: 'standard' | 'half_ppr' | 'ppr'; tePremiumValue: number | null } {
  try {
    const settings = (settingsJson ?? {}) as Record<string, unknown>
    const starterCounts = parseStarterSlotCounts(startersJson)
    const hasSuperflexSlot = Boolean(
      starterCounts.SUPER_FLEX || starterCounts.SFLEX || starterCounts.OP || starterCounts.SUPERFLEX
    )
    const superflexSettingFlag = settings.superflex === true || settings.is_superflex === true
    const isSF = hasSuperflexSlot || superflexSettingFlag

    const snap = parseSettingsSnapshot(settingsJson ?? null)
    const snapshotStarterSlots = (snap?.rosterSettings?.starterSlots ?? {}) as Record<string, unknown>
    const snapshotQbSlots = Number(snapshotStarterSlots.QB ?? snapshotStarterSlots.qb ?? 1)
    const qbCount = starterCounts.QB ?? (Number.isFinite(snapshotQbSlots) ? snapshotQbSlots : 1)
    const is2QB = !isSF && Number.isFinite(qbCount) && qbCount >= 2

    return { isSF, is2QB, scoringFormat: resolveScoringFormat(settingsJson), tePremiumValue: resolveTePremiumValue(settingsJson) }
  } catch {
    return { isSF: false, is2QB: false, scoringFormat: 'standard', tePremiumValue: null }
  }
}

export interface DraftPickRow {
  rosterId: string
  position: string | null
  team: string | null
  byeWeek: number | null
  playerName: string | null
  /** Overall pick number and draft slot, when the caller has them (live context; not backtests). */
  overall?: number | null
  slot?: number | null
}

export interface AssembleEngineInputParams {
  /** All picks already made, as of the point in time being evaluated — the exclusion/roster source. Live: every pick in the in-progress session. Backtest: every pick with overall < the historical pick being replayed. */
  picksSoFar: DraftPickRow[]
  targetRosterId: string
  /**
   * Other ids the target's picks may be filed under. A draft mirrored from Sleeper stores the
   * SLEEPER USER ID in `DraftPick.rosterId` (lib/draft/sleeperSync.ts), so matching on the AF
   * `Roster.id` alone found none of the user's own picks and every mirrored draft scored an empty
   * roster. See `resolveTargetRosterAliases`.
   */
  targetRosterAliases?: readonly string[]
  adpEntries: Array<{ playerName: string; position: string; team: string | null; adp: number }>
  poolByKey: ReadonlyMap<string, PoolPlayerRecord>
  rosterSlots: string[]
  round: number
  pick: number
  totalTeams: number
  sport: string
  isDynasty: boolean
  isSF: boolean
  /** Real 2QB flag (Phase 31), mutually exclusive with isSF — see resolveLeagueScoringFlags(). */
  is2QB?: boolean
  mode: 'bpa' | 'needs'
  /**
   * Real keeper locks (Phase 30), from DraftSession.keeperSelections. A kept player
   * already materialized as a real DraftPick row (source: 'keeper') is already excluded
   * via picksSoFar -- this covers the real, disclosed gap KeeperAutomationService.ts
   * leaves open: a player locked into a FUTURE keeper round, not yet materialized, who
   * would otherwise still appear as "available" and could be wrongly recommended to a
   * different team even though they're guaranteed to become the keeping team's pick.
   */
  keeperLockedPlayers?: Array<{ playerName: string; position: string }>
  /** Real league scoring format (Phase 29), from resolveLeagueScoringFlags(). Defaults to 'standard' if omitted. */
  scoringFormat?: 'standard' | 'half_ppr' | 'ppr'
  /** Real auction budget context (Phase 30), from resolveAuctionContext(). Omitted entirely for non-auction drafts. */
  auctionContext?: { remainingBudget: number; rosterSlotsRemaining: number }
  /** Real TE Premium points-per-reception value (Phase 31), from resolveLeagueScoringFlags(). Null when the real league settings don't populate it. */
  tePremiumValue?: number | null
  /** Team abbreviation → bye week for the league's season (lib/schedule/teamByeWeeks.ts). */
  byeByTeam?: ReadonlyMap<string, number>
  /** The weeks this draft's rosters score, when it is an in-season / tournament-stage draft. */
  scoringWindow?: ScoringWindow | null
  /** This draft's most recent pick positions, oldest first. */
  recentPickPositions?: string[]
  /** Positions drafted so far by each team picking before the target's next turn. */
  teamsAheadPositions?: string[][]
}

export interface AssembledEngineInput {
  engineInput: RecommendationInput
  playerIdByKey: Map<string, string>
  dataCompleteness: {
    availablePoolSize: number
    rosterPickCount: number
    unresolvedPlayerIdCount: number
  }
}

/**
 * Pure assembly core shared by the live (current-state) assembler below and
 * the backtest's point-in-time reconstruction (HistoricalDraftLoader.ts) — no
 * I/O, so both real use cases stay consistent without duplicating the
 * ADP-exclusion / player-id-resolution logic.
 */
export function assembleEngineInputFromPicks(params: AssembleEngineInputParams): AssembledEngineInput {
  const draftedKeys = new Set(params.picksSoFar.map((p) => playerKey(p.playerName ?? '', p.position ?? '')))
  for (const locked of params.keeperLockedPlayers ?? []) {
    draftedKeys.add(playerKey(locked.playerName, locked.position))
  }
  const ownIds = new Set([params.targetRosterId, ...(params.targetRosterAliases ?? [])].filter(Boolean))
  const byeFor = (team: string | null | undefined): number | null => {
    if (!team || !params.byeByTeam) return null
    return params.byeByTeam.get(normalizeTeamAbbrev(team) ?? team.toUpperCase()) ?? params.byeByTeam.get(team.toUpperCase()) ?? null
  }
  const teamRoster = params.picksSoFar
    .filter((p) => ownIds.has(p.rosterId))
    .map((p) => ({ position: p.position ?? '', team: p.team ?? null, byeWeek: p.byeWeek ?? byeFor(p.team) }))

  const playerIdByKey = new Map<string, string>()
  let unresolvedPlayerIdCount = 0

  const available = params.adpEntries
    .filter((e) => !draftedKeys.has(playerKey(e.playerName, e.position)))
    .map((e) => {
      const key = playerKey(e.playerName, e.position)
      const poolMatch = params.poolByKey.get(key)
      if (poolMatch) {
        playerIdByKey.set(key, poolMatch.player_id)
      } else {
        unresolvedPlayerIdCount += 1
      }
      return {
        name: e.playerName,
        position: e.position,
        team: poolMatch?.team_abbreviation ?? poolMatch?.team ?? e.team ?? null,
        adp: e.adp,
        // The schedule-derived bye for the player's team; null when the team or schedule is unknown.
        byeWeek: byeFor(poolMatch?.team_abbreviation ?? poolMatch?.team ?? e.team ?? null),
        // Phase 29: real age, already resolved by the shared player pool
        // resolver (PoolPlayerRecord.age) -- reused directly, not refetched.
        age: poolMatch?.age ?? null,
      }
    })

  const engineInput: RecommendationInput = {
    available,
    teamRoster,
    rosterSlots: params.rosterSlots,
    round: params.round,
    pick: params.pick,
    totalTeams: params.totalTeams,
    sport: params.sport,
    scoringFormat: params.scoringFormat ?? 'standard',
    auctionContext: params.auctionContext,
    tePremiumValue: params.tePremiumValue ?? null,
    isDynasty: params.isDynasty,
    isSF: params.isSF,
    is2QB: params.is2QB ?? false,
    mode: params.mode,
    scoringWindow: params.scoringWindow ?? null,
    recentPickPositions: params.recentPickPositions,
    teamsAheadPositions: params.teamsAheadPositions,
  }

  return {
    engineInput,
    playerIdByKey,
    dataCompleteness: {
      availablePoolSize: available.length,
      rosterPickCount: teamRoster.length,
      unresolvedPlayerIdCount,
    },
  }
}

/**
 * The ids a roster's draft picks can be filed under, beyond its AF `Roster.id`: the roster's own
 * `platformUserId`, and — for a draft mirrored from Sleeper, which files picks by Sleeper user id —
 * the Sleeper user id linked to the AF user who holds the roster (`UserProfile.sleeperUserId`).
 * Fails closed to what it already has: a lookup error never blocks the decision.
 */
export async function resolveTargetRosterAliases(args: {
  platformUserId: string | null
  isSleeperMirror: boolean
}): Promise<string[]> {
  const aliases = new Set<string>()
  if (args.platformUserId) aliases.add(args.platformUserId)
  if (args.isSleeperMirror && args.platformUserId) {
    try {
      const profile = await prisma.userProfile.findUnique({
        where: { userId: args.platformUserId },
        select: { sleeperUserId: true },
      })
      if (profile?.sleeperUserId) aliases.add(profile.sleeperUserId)
    } catch {
      // Keep the ids already known.
    }
  }
  return [...aliases]
}

/**
 * The NFL weeks a league's draft scores, when the league is a tournament-stage league
 * (TournamentLeague → TournamentRound.weekStart/weekEnd — the KBI calendar drafts a redraft stage
 * in week 10 and scores from week 11). Null for an ordinary season-long league, whose byes are then
 * not scored. Fails closed to null.
 */
export async function resolveDraftScoringWindow(leagueId: string): Promise<ScoringWindow | null> {
  try {
    const row = await prisma.tournamentLeague.findUnique({
      where: { leagueId },
      select: {
        round: { select: { roundNumber: true, weekStart: true, weekEnd: true } },
        tournament: { select: { name: true } },
      },
    })
    const round = row?.round
    if (!round || !Number.isFinite(round.weekStart) || round.weekStart < 1) return null
    const endWeek = Number.isFinite(round.weekEnd) && round.weekEnd >= round.weekStart ? round.weekEnd : null
    const label = `${row?.tournament?.name ? `${row.tournament.name} ` : ''}round ${round.roundNumber}`
    return { startWeek: round.weekStart, endWeek, label }
  } catch {
    return null
  }
}

/**
 * The positions each team picking before the target's next turn has drafted so far — read off this
 * draft's picks by DRAFT SLOT, so it works for a draft mirrored from Sleeper, whose pick rows carry a
 * Sleeper user id rather than an AF roster id. The target's slot is the slot of its own first pick;
 * with no own pick yet there is nothing to anchor on and the list is empty. PURE.
 */
export function teamsAheadFromPicks(args: {
  picks: ReadonlyArray<{ rosterId: string; position: string | null; overall?: number | null; slot?: number | null }>
  ownIds: ReadonlySet<string>
  currentOverall: number
  totalTeams: number
  snake: boolean
}): string[][] {
  const teams = Math.max(1, args.totalTeams)
  const own = args.picks.find((p) => args.ownIds.has(p.rosterId) && p.slot != null)
  if (!own || own.slot == null) return []
  const ahead = picksUntilNextTurn({ currentOverall: args.currentOverall, targetSlot: own.slot, totalTeams: teams, snake: args.snake })
  const slots: number[] = []
  for (let overall = args.currentOverall; overall < args.currentOverall + ahead; overall++) {
    const round = Math.ceil(overall / teams)
    const inRound = ((overall - 1) % teams) + 1
    const slot = args.snake && round % 2 === 0 ? teams - inRound + 1 : inRound
    if (slot !== own.slot && !slots.includes(slot)) slots.push(slot)
  }
  return slots.map((slot) =>
    args.picks.filter((p) => p.slot === slot && p.position).map((p) => String(p.position).toUpperCase()),
  )
}

export async function buildDraftDecisionContext(input: BuildDraftDecisionContextInput): Promise<DraftDecisionContext> {
  const assembledAt = new Date().toISOString()

  const [league, session, targetRoster] = await Promise.all([
    prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { sport: true, platform: true, isDynasty: true, settings: true, starters: true, season: true },
    }),
    prisma.draftSession.findFirst({ where: { leagueId: input.leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER }),
    prisma.roster.findUnique({ where: { id: input.rosterId }, select: { platformUserId: true } }),
  ])

  if (!league) throw new Error(`League not found: ${input.leagueId}`)
  if (!session) throw new Error(`No DraftSession exists for league: ${input.leagueId}`)
  if (!targetRoster) throw new Error(`Roster not found: ${input.rosterId}`)

  const picks = await prisma.draftPick.findMany({
    where: { sessionId: session.id },
    select: { rosterId: true, position: true, team: true, byeWeek: true, playerName: true, overall: true, slot: true },
    orderBy: { overall: 'asc' },
  })

  const { isSF, is2QB, scoringFormat, tePremiumValue } = resolveLeagueScoringFlags(league.settings, league.starters)
  // Phase 32: resolve the real roster-template format instead of a hardcoded
  // 'standard' -- previously this made RosterTemplateService.ts's real IDP
  // branch (gated on formatType === 'IDP') permanently unreachable from
  // Draft OS, even for a real IDP league. Reuses isIdpLeague() (lib/idp),
  // the same real detector lib/league/getEffectiveLeagueRosterTemplate.ts
  // already establishes as the canonical way to check IDP status.
  const rosterFormatType = (await isIdpLeague(input.leagueId)) ? 'IDP' : 'standard'

  const isFootball = league.sport === 'NFL' || league.sport === 'NCAAF'
  const [adpResult, template, pool, byeByTeam, scoringWindow] = await Promise.all([
    readAllFantasyAdpForLeague(input.leagueId),
    getRosterTemplate(league.sport, rosterFormatType, input.leagueId),
    getPlayerPoolForLeague(input.leagueId, league.sport as LeagueSport, { limit: 800 }).catch(() => []),
    // Byes and the scoring window (2026-11-14): the specifics that separate this draft from a generic one.
    isFootball ? resolveTeamByeWeeks(league.sport, league.season).catch(() => new Map<string, number>()) : Promise.resolve(new Map<string, number>()),
    resolveDraftScoringWindow(input.leagueId),
  ])

  const poolByKey = new Map(pool.map((p) => [playerKey(p.full_name, p.position), p]))
  const rosterSlots = template.slots.flatMap((slot) => Array(Math.max(0, slot.starterCount)).fill(slot.slotName))

  const totalTeams = session.teamCount ?? Math.max(1, new Set(picks.map((p) => p.rosterId)).size || 1)
  /*
   * 🛑 THE ENGINE'S `pick` IS THE PICK WITHIN THE ROUND, NOT THE OVERALL PICK (fixed 2026-11-14).
   * `computeDraftPlayerRankings` computes `overall = (round - 1) * totalTeams + pick`, and the draft
   * room posts `pick: currentPick.slot`. This passed `nextOverallPick`, so round 4 pick 64 of a
   * 16-team draft was scored as pick 112: every ADP edge, reach/value warning and VORP horizon in the
   * Decision OS card was ~a round and a half late.
   */
  const overallPick = Math.max(1, session.nextOverallPick ?? 1)
  const round = session.currentRoundNum ?? Math.ceil(overallPick / Math.max(1, totalTeams))
  const pickInRound = ((overallPick - 1) % Math.max(1, totalTeams)) + 1
  const keeperLockedPlayers = extractKeeperLockedPlayers(session.keeperSelections)
  const targetRosterAliases = await resolveTargetRosterAliases({
    platformUserId: targetRoster.platformUserId ?? null,
    isSleeperMirror: Boolean(session.sleeperDraftId),
  })
  const ownPickIds = new Set([input.rosterId, ...targetRosterAliases])
  const targetRosterPickCount = picks.filter((p) => ownPickIds.has(p.rosterId)).length
  const auctionContext = resolveAuctionContext(session, input.rosterId, rosterSlots, targetRosterPickCount)

  const assembled = assembleEngineInputFromPicks({
    picksSoFar: picks,
    targetRosterId: input.rosterId,
    targetRosterAliases,
    byeByTeam,
    scoringWindow,
    recentPickPositions: picks.map((p) => p.position ?? '').filter(Boolean).slice(-Math.max(6, totalTeams)),
    teamsAheadPositions: teamsAheadFromPicks({
      picks,
      ownIds: ownPickIds,
      currentOverall: overallPick,
      totalTeams,
      snake: (session.draftType ?? 'snake') !== 'linear',
    }),
    adpEntries: adpResult.entries,
    poolByKey,
    rosterSlots,
    round,
    pick: pickInRound,
    totalTeams,
    sport: league.sport,
    isDynasty: league.isDynasty,
    isSF,
    is2QB,
    scoringFormat,
    tePremiumValue,
    keeperLockedPlayers,
    auctionContext,
    mode: input.mode ?? 'needs',
  })

  return {
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    sessionId: session.id,
    platform: league.platform,
    sport: league.sport,
    isDynasty: league.isDynasty,
    isSF,
    is2QB,
    round,
    pick: overallPick,
    pickInRound,
    scoringWindow,
    totalTeams,
    status: session.status,
    draftType: session.draftType ?? null,
    isDevy: Boolean(session.devyConfig),
    managerKey: targetRoster.platformUserId ?? null,
    assembledAt,
    engineInput: assembled.engineInput,
    playerIdByKey: assembled.playerIdByKey,
    dataCompleteness: {
      availablePoolSize: assembled.dataCompleteness.availablePoolSize,
      adpSampleTotal: adpResult.totalDrafts,
      rosterPickCount: assembled.dataCompleteness.rosterPickCount,
      unresolvedPlayerIdCount: assembled.dataCompleteness.unresolvedPlayerIdCount,
    },
  }
}
