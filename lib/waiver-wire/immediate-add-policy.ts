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
        dailyPolicy?: DailyPolicySnapshot | null
      }
    | null
    | undefined,
): boolean {
  if (settings?.dailyPolicy) return settings.dailyPolicy.immediateAddsAllowed
  // 'daily' unlock (NBA/MLB/NHL default): non-waiver players are first-come; the server refuses a
  // player still on waivers with WAIVER_REQUIRED and the page falls back to the claim form.
  return (
    settings?.waiverType === 'fcfs' ||
    settings?.instantFaAfterClear === true ||
    settings?.freeAgentUnlockBehavior === 'daily'
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
