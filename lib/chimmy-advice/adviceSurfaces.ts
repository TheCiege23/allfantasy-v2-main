/**
 * Where a piece of stored advice came from — pure, client-safe, and deliberately NOT in
 * `adviceStore.ts`: suites mock that module wholesale, and a helper living there would be undefined
 * under every such mock (the "a test double that stopped doubling anything" trap in CLAUDE.md).
 *
 * `triage_swap` is the home triage card's "swap in X" (lib/core-app/lineupCover.ts) — AllFantasy's
 * rule-based tip, NOT Chimmy's advice. It is stored beside Chimmy's so it gets a receipt like any
 * call, but it must never be counted as Chimmy's: the outcome loop and Chimmy's track record
 * exclude it, and the Receipts card shows it under its own heading.
 */
export const AF_TIP_SURFACE = 'triage_swap' as const

export const isChimmyAdvice = (a: { surface: string }): boolean => a.surface !== AF_TIP_SURFACE
