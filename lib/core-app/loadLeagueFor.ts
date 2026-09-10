import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'

/**
 * The only way a `lib/core-app` module may read a League row.
 *
 * 🛑 WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED. `?league=` is one query
 * parameter driving a dozen loaders, and every one of them opened with
 * `prisma.league.findUnique({ where: { id: leagueId } })` — no `userId` clause —
 * then used `userId` only to locate the viewer's own team. So a signed-in
 * non-member got the whole screen with "your team" degraded to a shrug.
 *
 * Two real sessions against a real server, 2026-09-10. User B was registered
 * seconds earlier and had no `League.userId`, no `RedraftLeagueMember`, no
 * `Roster` and no claimed `LeagueTeam` — a non-member under all four canonical
 * paths. Requesting user A's league id, counting occurrences of A's real league
 * name in the HTML:
 *
 *   /core            0 hits   <- already gated
 *   /core/my-team    1 hit
 *   /core/matchup    2 hits
 *   /core/standings  2 hits
 *   /core/trades     5 hits
 *   /core/waivers    2 hits
 *
 * All HTTP 200, 37–43KB of rendered league. Gating one loader closed one door of
 * six, which is why the fix is a chokepoint rather than six more hand-placed
 * checks — the seventh loader is the one that forgets.
 *
 * ⚠ THE GATE RUNS BEFORE THE READ, AND THE READ IS NOT THE CALLER'S TO MAKE.
 * An earlier draft took a `read()` callback so each loader could keep its own
 * query. That is worse than useless here: the callback body still contains
 * `prisma.league.findUnique`, sitting in the loader's own file, so
 * `scripts/check-core-app-league-reads.mjs` could not tell a gated read from an
 * ungated one and the guard would have been decoration. This function owns the
 * query; callers pass only a `select`.
 *
 * ⚠ NULL MERGES "NO SUCH LEAGUE" WITH "NOT YOUR LEAGUE", deliberately. A caller
 * that could tell them apart could enumerate which league ids exist by watching
 * which answer came back. Callers that need the distinction — `getLeagueHomeData`
 * is the only one — run `resolveLeagueMembership` themselves and map it to their
 * own result type.
 *
 * ⚠ NO ADMIN BYPASS. `resolveLeagueMembership` has none and this adds none.
 */
export async function loadLeagueFor<S extends Prisma.LeagueSelect>(
  userId: string,
  leagueId: string,
  select: S,
): Promise<Prisma.LeagueGetPayload<{ select: S }> | null> {
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return null

  return prisma.league.findUnique({
    where: { id: leagueId },
    select,
  }) as Promise<Prisma.LeagueGetPayload<{ select: S }> | null>
}

/**
 * The provider-side ids of every league this viewer belongs to.
 *
 * 🛑 FOR THE READS THAT ARE NOT A LOOKUP BY `League.id`. `loadLeagueFor` gates a
 * single league the caller already names. Some reads instead SPAN leagues —
 * `loadTrades` on the player card resolves names for every league that traded a
 * player — so there is no id to gate, and without the viewer's own set they
 * return everybody's.
 *
 * Measured 2026-09-10 on a 290-league database, signed out, no cookies at all:
 * `GET /api/core/player-card?sport=NFL&sleeperId=6813` returned three trades
 * carrying the real names of three private leagues (redacted — this repo is
 * public) — plus who moved for whom and the
 * platform's transaction id. The route's own docblock already called that
 * league-member data; only the implementation disagreed.
 *
 * ⚠ THE FOUR PATHS MIRROR `resolveLeagueMembership` EXACTLY AND MUST KEEP DOING
 * SO. Two narrower copies of this rule already exist here — `leagueNameForTitle`
 * and `listAccessibleLeagues`, both owner-and-claimed-team only — so both
 * silently exclude the roster-backed population that `lib/league-access.ts`
 * calls the largest one. A third divergent copy is how this goes wrong in a new
 * direction; if the canonical predicate gains a path, it is added here too.
 *
 * ⚠ RETURNS `platformLeagueId`, NOT `League.id`. `LeagueTradeHistory` keys the
 * provider's id under the name `sleeperLeagueId`; joining on our uuid matches
 * nothing and reads as a league with no trades.
 */
export async function memberLeaguePlatformIdsFor(
  userId: string | null | undefined,
): Promise<string[]> {
  if (!userId) return []

  const rows = await prisma.league.findMany({
    where: {
      OR: [
        { userId },
        { redraftMembers: { some: { userId } } },
        { rosters: { some: { platformUserId: userId } } },
        { teams: { some: { claimedByUserId: userId } } },
      ],
    },
    select: { platformLeagueId: true },
  })

  return [...new Set(rows.map((r) => r.platformLeagueId).filter((id): id is string => !!id))]
}

/**
 * The OWNER-only sibling of `loadLeagueFor`.
 *
 * 🛑 A SECOND CHOKEPOINT, NOT A NARROWER FLAG ON THE FIRST. `loadLeagueFor`
 * admits all four canonical membership paths, which is right for a screen a
 * manager reads and wrong for one a manager configures. The Discord bridge
 * decides what relays into a public channel; routing it through the member-wide
 * helper would hand those controls to everyone in the league. Two predicates,
 * two functions, both in this file so neither drifts unwatched.
 *
 * 🛑 THE NULLISH GUARD IS THE HALF PRISMA WOULD THROW AWAY. Prisma DROPS a
 * `where` field whose value is `undefined`, so `where: { id, userId: undefined }`
 * degrades to `where: { id }` and returns the row to ANY caller —
 * `strictUndefinedChecks` is not enabled (the generator block in schema.prisma
 * declares no `previewFeatures`), so nothing reports it. Scoping into the query
 * is therefore strictly WEAKER than a read-then-compare on exactly that input,
 * which is how `getDiscordBridge` briefly regressed on 2026-09-10: the
 * equivalence probe that cleared it tested the empty string, the case that
 * agrees, and not `undefined`, the case that diverges.
 *
 * ⚠ 195 HAND-ROLLED OWNER-ONLY READS ACROSS 165 FILES still exist outside this
 * helper, in two mutually inconsistent shapes (106 scope `userId` into the
 * `where`, 89 read then compare). This function is the place to converge them,
 * and the co-commissioner question — `League.userId` is owner-only, so a
 * co-commissioner is refused — is a product decision that then has ONE
 * implementation to change rather than 165.
 *
 * ⚠ NULL MERGES "NO SUCH LEAGUE" WITH "NOT YOUR LEAGUE", as above: a caller that
 * could tell them apart could enumerate which league ids exist.
 */
export async function loadLeagueForOwner<S extends Prisma.LeagueSelect>(
  userId: string | null | undefined,
  leagueId: string,
  select: S,
): Promise<Prisma.LeagueGetPayload<{ select: S }> | null> {
  if (!userId) return null

  return prisma.league.findFirst({
    where: { id: leagueId, userId },
    select,
  }) as Promise<Prisma.LeagueGetPayload<{ select: S }> | null>
}
