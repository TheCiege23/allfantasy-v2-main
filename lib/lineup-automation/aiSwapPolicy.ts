/**
 * AI swap — every automation that moves a HUMAN manager's starters asks this one question.
 *
 * Owner's rules, 2026-11-23:
 *   1. AI swap is for AF Pro and AF Supreme subscribers only (`pro_autocoach`).
 *   2. It is OFF until the subscriber turns it on. Paying does not turn it on; a paid user with it off
 *      gets no automatic swaps. After a purchase the checkout screen asks once (AiSwapOptInDialog).
 *   3. A commissioner can switch AI swaps off for the whole league (`League.autoCoachEnabled`), which
 *      beats every manager's own setting.
 *   4. An AI-managed or unclaimed seat is not a person: nobody can set its lineup, so automation always
 *      runs for it (`isAiSeat`). The commissioner switch governs managers, not empty seats.
 *
 * 🛑 BEFORE THIS, FOUR FEATURES MOVED STARTERS UNDER FOUR DIFFERENT RULES. Native AutoSubs checked no
 * plan at all; auto-switch-injured was turned on by the commissioner and only turned off by the owner;
 * auto-bench-bye and fill-empty-starters were free (fill-empty on by default); and the commissioner's
 * AutoCoach switch reached only imported leagues. Each now asks `aiSwapAllowedForOwner`.
 *
 * The choice is stored in `UserProfile.corePreferences.ai_swap` (lib/core-app/teamPreferenceStore.ts),
 * not in `autoCoachPreferences`, whose zod parse would drop an unknown key on the next save.
 */
import 'server-only'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { readTeamPreference, saveTeamPreference } from '@/lib/core-app/teamPreferenceStore'

export const AI_SWAP_FEATURE = 'pro_autocoach' as const
export const AI_SWAP_PREF_KEY = 'ai_swap'

export type AiSwapPreference = { on: boolean; decidedAt: string; version?: number }

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** An AI-managed or unclaimed seat: an orphan / ai-manager / open-slot placeholder, or a seat marked aiManaged. */
export function isAiSeat(roster: { platformUserId?: string | null; settings?: unknown }): boolean {
  if (isSeatPlaceholderUserId(roster.platformUserId ?? null)) return true
  return asRecord(roster.settings).aiManaged === true
}

/** The stored choice. Absent means the user has never been asked, and counts as OFF. */
export function readAiSwapChoice(raw: unknown): { on: boolean; decided: boolean } {
  const r = asRecord(raw)
  return { on: r.on === true, decided: typeof r.decidedAt === 'string' }
}

/** The commissioner's league-wide switch. Only an explicit false turns AI swaps off. */
export function leagueAllowsAiSwap(league: { autoCoachEnabled?: boolean | null } | null | undefined): boolean {
  return league?.autoCoachEnabled !== false
}

export async function userHasAiSwapPlan(userId: string | null | undefined): Promise<boolean> {
  if (!userId || isSeatPlaceholderUserId(userId)) return false
  try {
    return Boolean((await new EntitlementResolver().resolveForUser(userId, AI_SWAP_FEATURE)).hasAccess)
  } catch {
    return false
  }
}

export async function readAiSwapPreference(userId: string): Promise<{ on: boolean; decided: boolean }> {
  return readAiSwapChoice(await readTeamPreference<AiSwapPreference>(userId, AI_SWAP_PREF_KEY).catch(() => null))
}

/** Save the user's choice. Retries once on a concurrent write (optimistic version in the store). */
export async function setAiSwapPreference(userId: string, on: boolean): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readTeamPreference<AiSwapPreference>(userId, AI_SWAP_PREF_KEY)
    const version = typeof current?.version === 'number' ? current.version : 0
    if (await saveTeamPreference(userId, AI_SWAP_PREF_KEY, version, { on, decidedAt: new Date().toISOString() })) return
  }
  throw new Error('AI swap setting changed while saving. Try again.')
}

export type AiSwapDecision =
  | { allowed: true; reason: 'ai_seat' | 'owner_opted_in' }
  | { allowed: false; reason: 'league_off' | 'no_owner' | 'owner_off' | 'owner_not_pro' }

/**
 * May automation move this team's starters? AI seats: always. A person: only with the plan, their own
 * switch on, and the commissioner's switch not off.
 */
export async function aiSwapAllowedForTeam(args: {
  roster: { platformUserId?: string | null; settings?: unknown }
  league: { autoCoachEnabled?: boolean | null }
}): Promise<AiSwapDecision> {
  if (isAiSeat(args.roster)) return { allowed: true, reason: 'ai_seat' }
  if (!leagueAllowsAiSwap(args.league)) return { allowed: false, reason: 'league_off' }
  const owner = args.roster.platformUserId ?? null
  if (!owner) return { allowed: false, reason: 'no_owner' }
  const choice = await readAiSwapPreference(owner)
  if (!choice.on) return { allowed: false, reason: 'owner_off' }
  if (!(await userHasAiSwapPlan(owner))) return { allowed: false, reason: 'owner_not_pro' }
  return { allowed: true, reason: 'owner_opted_in' }
}
