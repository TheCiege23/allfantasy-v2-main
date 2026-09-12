/**
 * The Trade Center walkthrough fixture's IDENTIFIERS, and nothing else.
 *
 * 🛑 THIS FILE EXISTS SO A PLAYWRIGHT SPEC CAN IMPORT THEM WITHOUT IMPORTING
 * PRISMA, AND BOTH HALVES OF THAT ARE LOAD-BEARING.
 *
 * `seed-redraft-trade-walkthrough.ts` does `new PrismaClient()` at module scope,
 * and importing `@prisma/client` populates `process.env` from `.env` — which in
 * this repo is PRODUCTION. A spec importing the seed module therefore reaches the
 * production connection string during test COLLECTION, in every lane, whether or
 * not it ever intends to touch a database.
 *
 * ⚠ AND A DYNAMIC `await import()` IS NOT THE WAY ROUND IT. That was tried and
 * failed in CI with `SyntaxError: Cannot use import statement outside a module`:
 * Playwright transpiles a spec's STATIC imports, but a runtime dynamic import of a
 * `.ts` file goes to Node's own loader, which sees raw TypeScript.
 *
 * ⚠ `redraft-trade-walkthrough.spec.ts` KEEPS A LOCAL COPY OF THESE VALUES, and
 * that duplication was not an oversight — it is how its author worked around this
 * exact constraint before this file existed. It can now import from here instead.
 * Worth remembering generally: existing duplication sometimes encodes a limit, and
 * "two implementations of one rule is the bug" is a rule about intent, not a
 * licence to merge them without asking why they are apart.
 */
export const TC_TRADE_SEED = {
  password: 'Password123!',
  commissionerUserId: 'tc-commish-user',
  commissionerLogin: 'tc_commish',
  managerUserIds: ['tc-mgr-1-user', 'tc-mgr-2-user', 'tc-mgr-3-user', 'tc-mgr-4-user'],
  managerLogins: ['tc_mgr_1', 'tc_mgr_2', 'tc_mgr_3', 'tc_mgr_4'],
  leagues: {
    nfl: { leagueId: 'tc-nfl-league', seasonId: 'tc-nfl-season' },
    ncaaf: { leagueId: 'tc-ncaaf-league', seasonId: 'tc-ncaaf-season' },
  },
} as const
