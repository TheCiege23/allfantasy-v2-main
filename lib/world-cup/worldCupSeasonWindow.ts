/**
 * When the World Cup bracket product stops accepting NEW pools.
 *
 * `WorldCupBracketCreateModal` hardcoded `seasonYear: 2026` and nothing anywhere expressed that
 * the tournament had ended, so the create flow kept opening pools for a competition that finished
 * in July. This is that missing concept, in one place.
 *
 * 🛑 THIS CLOSES CREATION ONLY. Existing challenges stay fully readable, joinable and scorable —
 * there are pools in production and a date constant must never retroactively hide them.
 *
 * The default matches `WC_CRON_CUTOFF_UTC` in `.github/workflows/wc-cron.yml`, which is the point
 * the World Cup cron self-disabled. Keeping the two in step means "the crons stopped" and "you can
 * no longer enter" describe the same moment rather than drifting apart.
 *
 * Pure and client-safe on purpose: no prisma, no `server-only`, no secrets. The modal and the API
 * route both read it, so the button and the endpoint can never disagree about whether entry is open.
 */

export const WORLD_CUP_SEASON_YEAR = 2026

/** Keep in step with `WC_CRON_CUTOFF_UTC` in .github/workflows/wc-cron.yml. */
const DEFAULT_ENTRIES_CLOSE_AT = '2026-07-20T06:00:00Z'

/**
 * Override for reopening a season without a code change — set it to a future instant, or to an
 * empty string to disable the gate entirely. Public because the client needs the same answer;
 * it is a date, not a secret.
 */
function configuredCloseAt(): string | null {
  const raw = process.env.NEXT_PUBLIC_WORLD_CUP_ENTRIES_CLOSE_AT
  if (raw == null) return DEFAULT_ENTRIES_CLOSE_AT
  const trimmed = raw.trim()
  if (!trimmed) return null // explicitly disabled
  return trimmed
}

/** The instant entries close, or null when no gate applies. Invalid config fails OPEN. */
export function worldCupEntriesCloseAt(): Date | null {
  const configured = configuredCloseAt()
  if (!configured) return null
  const parsed = new Date(configured)
  // An unparseable override must not lock everyone out of a live tournament.
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** True while new pools may still be created. */
export function isWorldCupCreationOpen(now: Date = new Date()): boolean {
  const closeAt = worldCupEntriesCloseAt()
  if (!closeAt) return true
  return now.getTime() < closeAt.getTime()
}

/** Machine-readable code the client uses to tell "closed" apart from an auth failure. */
export const WORLD_CUP_ENTRIES_CLOSED_CODE = 'world_cup_entries_closed' as const

export function worldCupEntriesClosedMessage(): string {
  return `The ${WORLD_CUP_SEASON_YEAR} World Cup has finished, so new bracket pools are closed. Your existing pools are still here.`
}
