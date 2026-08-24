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
