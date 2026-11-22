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

/**
 * My Team's bench check — "start X over Y" (lib/core-app/myTeam.ts), the app's designated start/sit
 * answer — recorded for the advice ledger since 2026-11-14. AllFantasy's rule-based call, not
 * Chimmy's, and kept OUT of every existing reader (Receipts, the decision record, Chimmy's learning
 * loop): the store's reads skip it, and this predicate says no. It is graded by the ledger report
 * (scripts/advice-ledger-report.mjs) until a user-facing place for it is decided.
 */
export const MY_TEAM_BENCH_SURFACE = 'my_team_bench' as const

/**
 * The waiver panel's #1 pickup (components/waivers/AIWaiverRecommendationsPanel → /api/ai/waivers/recommend)
 * — the waiver engine's call, recorded for the advice ledger since 2026-11-15. Ledger-only, like My Team's.
 */
export const WAIVER_PANEL_SURFACE = 'waiver_panel' as const

/**
 * The waiver engine's #1 claim, recorded by the scheduled weekly run (lib/decision-os/waiver/weeklyEngineCalls.ts)
 * since 2026-11-20 so the engine is graded whether or not anyone opened the panel. NOBODY WAS SHOWN IT: it is
 * the weakest row there is, so any other surface recording the same pick takes it over
 * (lib/chimmy-advice/adviceStore.ts), and it only ever updates its own rows. Ledger-only.
 */
export const WAIVER_ENGINE_SURFACE = 'waiver_engine' as const

/**
 * Surfaces recorded for the advice ledger only: AllFantasy's own engines, never Chimmy. Every existing
 * reader skips them, and each one's upsert touches only its OWN rows (lib/chimmy-advice/adviceStore.ts) —
 * plus an unshown `waiver_engine` row for the same pick, which the advice actually shown replaces.
 */
export const LEDGER_ONLY_SURFACES: readonly string[] = [MY_TEAM_BENCH_SURFACE, WAIVER_PANEL_SURFACE, WAIVER_ENGINE_SURFACE]

export const isChimmyAdvice = (a: { surface: string }): boolean =>
  a.surface !== AF_TIP_SURFACE && !LEDGER_ONLY_SURFACES.includes(a.surface)
