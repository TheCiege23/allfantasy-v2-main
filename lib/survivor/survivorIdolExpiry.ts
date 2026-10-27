import type { SurvivorIdolExpiryMode } from './survivorSettings'

/**
 * ONE rule for when a hidden idol stops being playable (owner's call, 2026-10-20), replacing three
 * unconnected mechanisms: `idolInvalidRemainingPlayers` checks, a per-idol random `expiresAtMerge`,
 * and `expiresAtWeek`. The rule is read from the league's foundation settings, written onto every
 * seeded idol row, checked at play time, and shown to the holder in the reveal DM and the vault.
 * Pure and client-safe.
 */

export type SurvivorIdolExpiryRule = { mode: SurvivorIdolExpiryMode; playersLeft: number; week: number }

type ExpirySettings = {
  idolExpiryMode?: SurvivorIdolExpiryMode | string | null
  idolExpiryRemainingPlayers?: number | null
  idolExpiryWeek?: number | null
  /** Legacy: invalid once this many remain. Used only when the newer fields are absent. */
  idolInvalidRemainingPlayers?: number | null
}

const MERGED_PHASES = new Set(['merge', 'merged', 'post_merge', 'jury', 'finale', 'final', 'complete', 'completed'])

export function survivorIdolExpiryRule(settings: ExpirySettings | null | undefined): SurvivorIdolExpiryRule {
  const mode: SurvivorIdolExpiryMode =
    settings?.idolExpiryMode === 'merge' || settings?.idolExpiryMode === 'week' || settings?.idolExpiryMode === 'players_left'
      ? settings.idolExpiryMode
      : 'players_left'
  const fromLegacy = typeof settings?.idolInvalidRemainingPlayers === 'number' ? settings.idolInvalidRemainingPlayers + 1 : 5
  const playersLeft = Math.max(2, Math.round(typeof settings?.idolExpiryRemainingPlayers === 'number' ? settings.idolExpiryRemainingPlayers : fromLegacy))
  const week = Math.max(1, Math.round(typeof settings?.idolExpiryWeek === 'number' ? settings.idolExpiryWeek : 10))
  return { mode, playersLeft, week }
}

/** The sentence the holder reads: in the reveal DM, the arrival DM and the vault. */
export function survivorIdolExpiryText(rule: SurvivorIdolExpiryRule): string {
  if (rule.mode === 'merge') return 'Play it before the tribes merge; it expires at the merge.'
  if (rule.mode === 'week') return `Play it by week ${rule.week}; it expires after that week.`
  return `Play it while at least ${rule.playersLeft} managers remain; it expires once fewer are left.`
}

/** Short label for settings and cards. */
export function survivorIdolExpiryLabel(rule: SurvivorIdolExpiryRule): string {
  if (rule.mode === 'merge') return 'At the merge'
  if (rule.mode === 'week') return `After week ${rule.week}`
  return `Fewer than ${rule.playersLeft} managers left`
}

export function isSurvivorIdolExpired(
  rule: SurvivorIdolExpiryRule,
  state: { activePlayerCount?: number | null; week?: number | null; phase?: string | null },
): boolean {
  if (rule.mode === 'merge') return MERGED_PHASES.has(String(state.phase ?? '').toLowerCase())
  if (rule.mode === 'week') return typeof state.week === 'number' && state.week > rule.week
  return typeof state.activePlayerCount === 'number' && state.activePlayerCount < rule.playersLeft
}

export function survivorIdolExpiredMessage(rule: SurvivorIdolExpiryRule): string {
  if (rule.mode === 'merge') return 'Idols expired at the merge.'
  if (rule.mode === 'week') return `Idols expired after week ${rule.week}.`
  return `Idols are invalid once fewer than ${rule.playersLeft} managers remain.`
}

/** What a seeded idol row stores so legacy readers (merge sweep, week check) agree with the rule. */
export function survivorIdolRowExpiry(rule: SurvivorIdolExpiryRule): { expiresAtMerge: boolean; expiresAtWeek: number | null; validUntilPhase: string } {
  if (rule.mode === 'merge') return { expiresAtMerge: true, expiresAtWeek: null, validUntilPhase: 'merge' }
  // The play check treats `council.week >= expiresAtWeek` as expired, so "playable through week W" is W + 1.
  if (rule.mode === 'week') return { expiresAtMerge: false, expiresAtWeek: rule.week + 1, validUntilPhase: `week_${rule.week}` }
  return { expiresAtMerge: false, expiresAtWeek: null, validUntilPhase: `final_${rule.playersLeft}` }
}

/**
 * The commissioner's idol play cutoff (`idolPlayCutoffHours`): idols must be in this many hours
 * before votes close, so the last-minute scramble is votes only. Votes themselves, including an
 * Extra Vote's ballot, still run to the close. 0 = idols can be played right up to the close.
 */
export function survivorIdolPlayDeadline(council: { voteDeadlineAt: Date }, cutoffHours: number | null | undefined): Date {
  const hours = typeof cutoffHours === 'number' && cutoffHours > 0 ? cutoffHours : 0
  return hours ? new Date(council.voteDeadlineAt.getTime() - hours * 3_600_000) : council.voteDeadlineAt
}

/** The sentence for the cutoff, or null when there is none. */
export function survivorIdolPlayCutoffText(cutoffHours: number | null | undefined): string | null {
  if (typeof cutoffHours !== 'number' || cutoffHours <= 0) return null
  return `Idols must be played at least ${cutoffHours} hour${cutoffHours === 1 ? '' : 's'} before votes close.`
}
