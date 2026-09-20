/**
 * Thresholds shared between the week board's LOADER and its SCREEN.
 *
 * ⚠ THIS FILE EXISTS BECAUSE `weekBoard.ts` IS `server-only`, AND A CLIENT
 * COMPONENT CANNOT IMPORT A VALUE FROM IT. `YourWeek.tsx` needs the coin-flip
 * threshold to explain the grouping to the reader, and importing the constant
 * from the loader pulled `server-only` — and therefore prisma — into the client
 * bundle. That fails at BUILD time with "You're importing a component that needs
 * server-only", and it took the whole `/core` catch-all down with it, not just
 * `/core/week`: every screen behind that route shares one bundle.
 *
 * ⚠ TSC CANNOT CATCH THIS. `import { COIN_FLIP_POINTS } from './weekBoard'`
 * typechecks perfectly — the module boundary is a bundler rule, not a type rule.
 * The same trap is documented in `lib/trade-intel/tradeGradeEmail.ts`, which
 * marks one of its imports TYPE-ONLY for exactly this reason and notes that
 * vitest stubs `server-only`, so a test suite stays green while the module
 * becomes unusable in a client context.
 *
 * So: anything both sides need is a plain value in a plain module. No
 * 'server-only', no prisma, no imports at all.
 */

/**
 * The handoff's own threshold: two teams projected within this many points are
 * a "coin flip" and lead the screen. Stated wherever the grouping is explained,
 * which is why the screen needs the number and not just the grouping.
 */
export const COIN_FLIP_POINTS = 12

/**
 * Below this many completed weeks a roster gets no projection, and its matchup
 * lands in `WeekBoard.unprojected`.
 *
 * ⚠ MOVED HERE FROM `weekBoard.ts`, NOT COPIED. `WeekBoard.tsx` now lists those
 * matchups and tells the reader how close each one is to being projectable
 * ("2 of 3 weeks"), so the screen needs the number. A second literal in the
 * component is the "two implementations of one rule" shape this repo has been
 * bitten by: the loader's threshold and the screen's sentence would then be free
 * to disagree, and the sentence is the one people read.
 *
 * The loader imports it from here. That direction is safe — this module has no
 * imports at all, which is the whole reason it exists (see the header).
 */
export const MIN_WEEKS_FOR_PROJECTION = 3
