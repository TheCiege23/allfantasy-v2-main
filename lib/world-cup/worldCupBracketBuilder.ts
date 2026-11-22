import type { WorldCupMatchSpec, WorldCupRound, WorldCupScoringValues, WorldCupSlotSpec } from "./types"

/** NCAA-style doubling defaults for new World Cup scoring profiles. */
export const DEFAULT_WORLD_CUP_SCORING: WorldCupScoringValues = {
  roundOf32Points: 10,
  roundOf16Points: 20,
  quarterFinalPoints: 40,
  semiFinalPoints: 80,
  finalPoints: 160,
  championBonusPoints: 320,
  thirdPlacePoints: 4,
}
const POINT_KEY: Record<WorldCupRound, keyof WorldCupScoringValues> = { round_of_32: "roundOf32Points", round_of_16: "roundOf16Points", quarterfinal: "quarterFinalPoints", semifinal: "semiFinalPoints", third_place: "thirdPlacePoints", final: "finalPoints" }
const R32: Array<[string, string, string, string]> = [
  ["A1", "Group A Winner", "B2", "Group B Runner-up"], ["C1", "Group C Winner", "D3", "Best 3rd Place Team 1"], ["E1", "Group E Winner", "F2", "Group F Runner-up"], ["G1", "Group G Winner", "H3", "Best 3rd Place Team 2"],
  ["I1", "Group I Winner", "J2", "Group J Runner-up"], ["K1", "Group K Winner", "L3", "Best 3rd Place Team 3"], ["B1", "Group B Winner", "A2", "Group A Runner-up"], ["D1", "Group D Winner", "C3", "Best 3rd Place Team 4"],
  ["F1", "Group F Winner", "E2", "Group E Runner-up"], ["H1", "Group H Winner", "G3", "Best 3rd Place Team 5"], ["J1", "Group J Winner", "I2", "Group I Runner-up"], ["L1", "Group L Winner", "K3", "Best 3rd Place Team 6"],
  ["C2", "Group C Runner-up", "D2", "Group D Runner-up"], ["G2", "Group G Runner-up", "H2", "Group H Runner-up"], ["K2", "Group K Runner-up", "L2", "Group L Runner-up"], ["TBD1", "Best 3rd Place Team 7", "TBD2", "Best 3rd Place Team 8"],
]
export function getWorldCupRoundPoints(round: WorldCupRound, scoring?: Partial<WorldCupScoringValues> | null) { return Number(({ ...DEFAULT_WORLD_CUP_SCORING, ...(scoring ?? {}) })[POINT_KEY[round]] ?? 0) }
function slotMeta(slotKey: string, displayName: string) {
  const m = displayName.match(/^Group ([A-L]) (Winner|Runner-up)$/)
  if (m) return { sourceGroup: m[1], sourceRank: m[2] === "Winner" ? "winner" : "runner_up" }
  if (displayName.startsWith("Best 3rd")) return { sourceGroup: null, sourceRank: "best_third" }
  return { sourceGroup: slotKey.startsWith("TBD") ? null : slotKey[0] ?? null, sourceRank: "tbd" }
}
export function generateWorldCupBracketTemplate(params?: { includeThirdPlace?: boolean }): { slots: WorldCupSlotSpec[]; matches: WorldCupMatchSpec[]; requiredPickCount: number } {
  const slots: WorldCupSlotSpec[] = [], matches: WorldCupMatchSpec[] = []
  R32.forEach(([hs, hn, as, an], i) => {
    const n = i + 1, region = n <= 8 ? "Left" : "Right"
    ;([[hs, hn], [as, an]] as Array<[string, string]>).forEach(([slotKey, displayName]) => slots.push({ slotKey, round: "round_of_32", region, ...slotMeta(slotKey, displayName), displayName, isPlaceholder: true }))
    matches.push({ matchNumber: n, round: "round_of_32", roundIndex: n, homeSlotKey: hs, awaySlotKey: as, homeTeamName: hn, awayTeamName: an, nextMatchNumber: 17 + Math.floor(i / 2), nextMatchSlot: i % 2 === 0 ? "home" : "away" })
  })
  for (let i = 0; i < 8; i++) matches.push({ matchNumber: 17 + i, round: "round_of_16", roundIndex: i + 1, homeSlotKey: `W-M${i * 2 + 1}`, awaySlotKey: `W-M${i * 2 + 2}`, homeTeamName: `Winner Match ${i * 2 + 1}`, awayTeamName: `Winner Match ${i * 2 + 2}`, nextMatchNumber: 25 + Math.floor(i / 2), nextMatchSlot: i % 2 === 0 ? "home" : "away" })
  for (let i = 0; i < 4; i++) matches.push({ matchNumber: 25 + i, round: "quarterfinal", roundIndex: i + 1, homeSlotKey: `W-M${17 + i * 2}`, awaySlotKey: `W-M${18 + i * 2}`, homeTeamName: `Winner Match ${17 + i * 2}`, awayTeamName: `Winner Match ${18 + i * 2}`, nextMatchNumber: 29 + Math.floor(i / 2), nextMatchSlot: i % 2 === 0 ? "home" : "away" })
  for (let i = 0; i < 2; i++) matches.push({ matchNumber: 29 + i, round: "semifinal", roundIndex: i + 1, homeSlotKey: `W-M${25 + i * 2}`, awaySlotKey: `W-M${26 + i * 2}`, homeTeamName: `Winner Match ${25 + i * 2}`, awayTeamName: `Winner Match ${26 + i * 2}`, nextMatchNumber: 31, nextMatchSlot: i === 0 ? "home" : "away" })
  matches.push({ matchNumber: 31, round: "final", roundIndex: 1, homeSlotKey: "W-M29", awaySlotKey: "W-M30", homeTeamName: "Winner Semifinal 1", awayTeamName: "Winner Semifinal 2" })
  if (params?.includeThirdPlace) matches.push({ matchNumber: 32, round: "third_place", roundIndex: 1, homeSlotKey: "L-M29", awaySlotKey: "L-M30", homeTeamName: "Loser Semifinal 1", awayTeamName: "Loser Semifinal 2" })
  return { slots, matches, requiredPickCount: matches.length }
}
export const buildWorldCupBracketTemplate = generateWorldCupBracketTemplate
type LockMatchLike = {
  round?: string | null
  startsAt?: Date | string | null
  status?: string | null
  apiStatusShort?: string | null
}
type LockChallengeLike = {
  pickLockStrategy?: string | null
  pickLockAt?: Date | string | null
  status?: string | null
  isTestMode?: boolean | null
  settings?: { testMode?: boolean | null } | null
  sourcePayload?: unknown
}
type WorldCupChallengeLockReason = "manual_lock" | "tournament_started" | "entry_locked" | "none"
type WorldCupChallengeLockState = {
  locked: boolean
  reason: WorldCupChallengeLockReason
  lockAt?: Date | string | null
}

function isWorldCupTestModeChallenge(challenge: LockChallengeLike): boolean {
  if (challenge.isTestMode === true) return true
  if (challenge.settings?.testMode === true) return true

  const payload = challenge.sourcePayload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false

  const root = payload as Record<string, unknown>
  if (root.testMode === true) return true

  const settings = root.settings
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    if ((settings as Record<string, unknown>).testMode === true) return true
  }

  const simulation = root.simulation
  if (simulation && typeof simulation === "object" && !Array.isArray(simulation)) {
    if ((simulation as Record<string, unknown>).isTestMode === true) return true
  }

  return false
}

/** Earliest scheduled kickoff for the challenge; used when pickLockStrategy is tournament_start and pickLockAt is unset. */
function inferWorldCupTournamentLockAt(matches: LockMatchLike[]): Date | null {
  let best: Date | null = null
  for (const m of matches) {
    if (!m.startsAt) continue
    const t = new Date(m.startsAt)
    if (Number.isNaN(t.getTime())) continue
    if (!best || t.getTime() < best.getTime()) best = t
  }
  return best
}

export function resolveWorldCupEffectivePickLockAt(input: {
  pickLockStrategy?: string | null
  pickLockAt?: Date | string | null
  matches?: LockMatchLike[]
}): Date | null {
  const explicit = input.pickLockAt ? new Date(input.pickLockAt) : null
  if (explicit && !Number.isNaN(explicit.getTime())) return explicit
  if (input.pickLockStrategy === "tournament_start" && input.matches?.length) {
    return inferWorldCupTournamentLockAt(input.matches)
  }
  return null
}

export function isWorldCupChallengeLocked(input: {
  challenge: LockChallengeLike
  matches?: LockMatchLike[]
  entry?: { isLocked?: boolean | null } | null
  now?: Date
}): WorldCupChallengeLockState {
  const now = input.now ?? new Date()
  const c = input.challenge
  if (["final", "locked"].includes(c.status ?? "")) {
    return { locked: true, reason: "manual_lock", lockAt: c.pickLockAt ?? null }
  }

  const strategy = c.pickLockStrategy ?? "per_match"
  const testMode = isWorldCupTestModeChallenge(c)
  const explicitLockAt = c.pickLockAt ? new Date(c.pickLockAt) : null
  const validExplicitLockAt =
    explicitLockAt && !Number.isNaN(explicitLockAt.getTime()) ? explicitLockAt : null
  const at = testMode
    ? validExplicitLockAt
    : resolveWorldCupEffectivePickLockAt({
        pickLockStrategy: strategy,
        pickLockAt: c.pickLockAt,
        matches: input.matches,
      })
  if (at && now >= at) {
    return { locked: true, reason: "tournament_started", lockAt: at }
  }
  if (input.entry?.isLocked) {
    return { locked: true, reason: "entry_locked", lockAt: at ?? c.pickLockAt ?? null }
  }
  return { locked: false, reason: "none", lockAt: at ?? c.pickLockAt ?? null }
}

export function isWorldCupMatchLocked(input: {
  challenge?: LockChallengeLike
  match?: LockMatchLike
  matches?: LockMatchLike[]
  pickLockStrategy?: string | null
  pickLockAt?: Date | string | null
  startsAt?: Date | string | null
  status?: string | null
  now?: Date
}) {
  const challenge = input.challenge ?? input
  const match: LockMatchLike = input.match ?? (input as LockMatchLike)
  const now = input.now ?? new Date()
  const strategy = challenge.pickLockStrategy ?? "per_match"
  const apiStatus = (match.apiStatusShort ?? "").trim().toUpperCase()
  const challengeLock = isWorldCupChallengeLocked({ challenge, matches: input.matches, now })
  if (challengeLock.locked) return true
  const start = match.startsAt ? new Date(match.startsAt) : null
  if (["live", "halftime", "final"].includes(match.status ?? "") && apiStatus !== "SIM" && apiStatus !== "TEST") return true
  if (strategy === "per_match" && start && now >= start) {
    if (apiStatus === "SIM" || apiStatus === "TEST") return false
    return true
  }
  return false
}

const WORLD_CUP_KNOCKOUT_EDIT_ROUNDS = new Set([
  "round_of_32",
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "third_place",
  "final",
])

function isWorldCupKnockoutRound(round?: string | null): boolean {
  return WORLD_CUP_KNOCKOUT_EDIT_ROUNDS.has(String(round ?? ""))
}

/**
 * Lock check used only by the paid commissioner post-lock knockout override.
 * It ignores the pool-level tournament-start lock, but still blocks non-knockout,
 * live/final, final-status, and per-match-started picks.
 */
export function isWorldCupMatchLockedForPostLockKnockoutOverride(input: {
  challenge?: LockChallengeLike
  match?: LockMatchLike
  matches?: LockMatchLike[]
  pickLockStrategy?: string | null
  startsAt?: Date | string | null
  status?: string | null
  round?: string | null
  now?: Date
}) {
  const challenge = input.challenge ?? input
  const match: LockMatchLike = input.match ?? (input as LockMatchLike)
  if (!isWorldCupKnockoutRound(match.round)) return true
  if (challenge.status === "final") return true

  const now = input.now ?? new Date()
  const strategy = challenge.pickLockStrategy ?? "per_match"
  const apiStatus = (match.apiStatusShort ?? "").trim().toUpperCase()
  const start = match.startsAt ? new Date(match.startsAt) : null
  if (["live", "halftime", "final"].includes(match.status ?? "") && apiStatus !== "SIM" && apiStatus !== "TEST") {
    return true
  }
  if (strategy === "per_match" && start && now >= start) {
    if (apiStatus === "SIM" || apiStatus === "TEST") return false
    return true
  }
  return false
}

/** True when bracket picks cannot be edited (tournament-start lock, challenge locked, or live/final match). */
export function isWorldCupBracketChallengePicksLocked(input: {
  challenge: LockChallengeLike
  matches: LockMatchLike[]
  now?: Date
}) {
  return isWorldCupChallengeLocked({
    challenge: input.challenge,
    matches: input.matches,
    now: input.now,
  }).locked
}
