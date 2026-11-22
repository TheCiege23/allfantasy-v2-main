/**
 * The team statuses a commissioner may set by hand (the "Override status" tool), shared by the route and the panel.
 *
 * 🛑 "ELIMINATED" IS NOT ONE, AND OFFERING IT BROKE THE SEASON. No zombie engine has an eliminated state — a zombie
 * league has no elimination; the infected keep playing. The override offered it anyway, and the 2025 NFL settlement
 * reads a team's status as survivor, zombie or whisperer and throws `ZOMBIE_WINNINGS_STATUS_REQUIRED` on anything
 * else (lib/zombie/beta2025Winnings.ts `role`), outside the try that would hold the week for review — so one click
 * made every later weekly settlement fail. "Eliminated" survives only as display text for old rows.
 *
 * Revived counts as a survivor in settlement (same `role`), so it stays. Whisperer has its own NFL rule in the route.
 */
export const OVERRIDABLE_ZOMBIE_STATUSES = ['Survivor', 'Zombie', 'Whisperer', 'Revived'] as const

/** A week in these states is being settled or is held for review; changing a status under it changes its inputs. */
export const STATUS_OVERRIDE_BLOCKING_RESOLUTIONS = ['resolving', 'review_required'] as const
