/**
 * Client-safe decision for the waiver wire's "Add" button: instant first-come add vs. the claim flow.
 *
 * With a per-day waiver schedule (lib/waivers/dailyWaiverSchedule.ts) TODAY's mode decides, the way
 * Sleeper's Custom Daily Waivers does: a free-agent day (or a waivers → free agents day after the run
 * has cleared) is an instant add even in a rolling/FAAB/reverse league. Without a schedule the league's
 * own type decides, unchanged. The server re-checks either way; a recently dropped player still on
 * waivers comes back as WAIVER_REQUIRED and the page falls back to the claim form.
 */
import type { DailyWaiverMode } from '@/lib/waivers/dailyWaiverSchedule'
import type { WaiverPhasePolicy } from './season-phase-policy'

export type DailyPolicySnapshot = {
  mode: DailyWaiverMode
  claimsAllowed: boolean
  immediateAddsAllowed: boolean
  immediateRefusal: string | null
}

export function isImmediateAddAllowedToday(
  settings:
    | {
        waiverType?: string | null
        instantFaAfterClear?: boolean | null
        freeAgentUnlockBehavior?: string | null
        freeAgencyMode?: string | null
        dailyPolicy?: DailyPolicySnapshot | null
        phasePolicy?: WaiverPhasePolicy | null
      }
    | null
    | undefined,
): boolean {
  // The season phase (lib/waiver-wire/season-phase-policy.ts) decides first when it changes anything:
  // a closed offseason or locked playoffs allow no add, a first-come offseason allows every add.
  if (settings?.phasePolicy?.code) return settings.phasePolicy.immediateAddsAllowed
  if (settings?.dailyPolicy) return settings.dailyPolicy.immediateAddsAllowed
  // 'daily' unlock (NBA/MLB/NHL default): non-waiver players are first-come; the server refuses a
  // player still on waivers with WAIVER_REQUIRED and the page falls back to the claim form.
  // 'after_run' (Sleeper-style, after-run-free-agency.ts): an unclaimed player is an instant add once
  // a run has cleared; before it, or after his game starts, the server answers WAIVER_REQUIRED.
  return (
    settings?.waiverType === 'fcfs' ||
    settings?.instantFaAfterClear === true ||
    settings?.freeAgentUnlockBehavior === 'daily' ||
    settings?.freeAgencyMode === 'after_run'
  )
}

const MODE_LABELS: Record<DailyWaiverMode, string> = {
  waivers: 'Waivers',
  rolling: 'Waivers (rolling)',
  reverse_standings: 'Waivers (reverse standings)',
  faab: 'Waivers (FAAB)',
  waivers_then_fa: 'Waivers → Free agents',
  free_agents: 'Free agents — instant adds',
  locked: 'Locked — no moves',
}

export function dailyModeLabel(policy: DailyPolicySnapshot): string {
  if (policy.mode === 'waivers_then_fa' && policy.immediateAddsAllowed) return 'Free agents — waivers cleared'
  return MODE_LABELS[policy.mode] ?? policy.mode
}

/**
 * A player on waivers after a drop (`onWaiversUntil`, lib/waiver-wire/dropped-player-waivers.ts) needs a
 * claim even on a day free agents are instant adds — unless the offseason is first-come, where no
 * waiver period applies. Null = no hold; else the time he clears.
 */
export function playerWaiverHoldUntil(
  player: { onWaiversUntil?: string | null } | null | undefined,
  settings: { phasePolicy?: WaiverPhasePolicy | null } | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (settings?.phasePolicy?.firstComeAdds) return null
  const raw = player?.onWaiversUntil
  if (!raw) return null
  const until = new Date(raw)
  return Number.isFinite(until.getTime()) && until > now ? until : null
}

/** The date in "On waivers until Tue 3:00 PM", in the viewer's own time zone and language. */
export function onWaiversUntilDate(until: Date, locale?: string): string {
  return until.toLocaleString(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/**
 * "On waivers until Tue 3:00 PM" in the viewer's own time zone. Pass the page's `tInterpolate` and
 * language to get the translated label (`waiverClaim.onWaiversUntil`, «En reclamos hasta …» in Spanish);
 * without them it stays English for callers that have no language context.
 */
export function onWaiversUntilLabel(
  until: Date,
  i18n?: { tInterpolate: (key: string, vars: Record<string, string>) => string; language?: string } | null,
): string {
  if (!i18n) return `On waivers until ${onWaiversUntilDate(until)}`
  return i18n.tInterpolate('waiverClaim.onWaiversUntil', { date: onWaiversUntilDate(until, i18n.language) })
}

/**
 * The date in "Processes after …" on a pending claim for a player still on waivers: his claim runs at
 * the first waiver run after this, in the viewer's own time zone and language.
 */
export function claimProcessesAfterDate(until: Date, locale?: string): string {
  return until.toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** The phase's blocking reason for the waiver screen, when no claim and no add is possible. */
export function phaseMoveBlockReason(settings: { phasePolicy?: WaiverPhasePolicy | null } | null | undefined): string | null {
  const p = settings?.phasePolicy
  if (!p?.code) return null
  return p.reason
}
