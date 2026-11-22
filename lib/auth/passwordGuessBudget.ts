/**
 * Per-account password guess budget — the account lockout.
 *
 * WHY ONE BUDGET. Every place that compares a typed password against an
 * account's hash is a way to guess that password: sign-in, but also "change
 * password" and "change email", which re-check the current password. Before
 * this module only sign-in counted, so someone holding a stolen session could
 * grind the current-password check on the settings routes with no limit and
 * learn the password itself. All three now spend from ONE per-account budget,
 * so a guess costs the same wherever it is made.
 *
 * HOW. `consumeSharedRateLimit` (Upstash Redis, shared across replicas and
 * deploys, with an in-process floor) — spent BEFORE the compare, so a parallel
 * burst cannot all get a guess in. Past the limit every attempt is refused,
 * including a correct password, until the window lapses. A successful check
 * clears the count, so a user's own typos do not accumulate.
 *
 * The key is unchanged from the original sign-in budget (`signin-account:<id>`)
 * so counters already in flight keep meaning the same thing.
 */
import { clearSharedRateLimit, consumeSharedRateLimit } from "@/lib/security/sharedRateLimit"

/** Wrong passwords allowed per account per window before it locks. */
export const PASSWORD_GUESS_MAX = 10
/** Lock window, in seconds. */
export const PASSWORD_GUESS_WINDOW_S = 15 * 60

export function passwordGuessKey(userId: string): string {
  return `signin-account:${userId}`
}

/** Spend one guess for `userId`. `false` means the account is locked: do not compare. */
export async function spendPasswordGuess(userId: string): Promise<boolean> {
  const result = await consumeSharedRateLimit(passwordGuessKey(userId), PASSWORD_GUESS_MAX, PASSWORD_GUESS_WINDOW_S)
  return result.success
}

/** Forget `userId`'s spent guesses after a correct password. Never throws. */
export async function clearPasswordGuesses(userId: string): Promise<void> {
  await clearSharedRateLimit(passwordGuessKey(userId)).catch(() => undefined)
}
