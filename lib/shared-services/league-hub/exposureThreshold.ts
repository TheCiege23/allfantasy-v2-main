/**
 * The overexposure rule, shared by the server engine and the client table.
 *
 * ⚠ NO IMPORTS, AND THAT IS THE ENTIRE POINT. The constant used to live in
 * `crossLeaguePlayerPortfolio.ts`, which imports `prisma` on line 41 and has no
 * `server-only` guard to make the mistake loud. Importing it from the 12b table —
 * a `'use client'` component — would have pulled Prisma and the whole decision-os
 * world graph into the browser bundle, and nothing would have stopped it at
 * type-check time. Same reasoning as `lib/integrity/sensitivity.ts`: when a rule
 * has to be true in two runtimes, it lives in a module that depends on neither.
 *
 * If this file ever grows an import, the client bundle grows with it.
 */

/**
 * Share of a user's connected leagues at which a player counts as overexposed.
 *
 * ⚠ THIS IS ONLY HALF THE RULE. The other half — `leagueCount > 1` — is not
 * optional and not a detail: owning a player in your ONLY league is not a
 * concentration you chose, and reporting it as one makes the whole audit look
 * like it does not understand the user's situation. Both clauses live together
 * in `isOverexposed()`; never apply this threshold on its own.
 */
export const OVEREXPOSED_THRESHOLD = 0.5
