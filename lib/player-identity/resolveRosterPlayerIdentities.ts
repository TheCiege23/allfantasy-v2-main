import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveSleeperRosterPlayers } from './resolveSleeperRosterPlayers'
import { crosswalkToSleeperIds } from '@/lib/core-app/rosterIdCrosswalk'
import { lookupProviderIdentityNames } from '@/lib/core-app/providerIdentityNames'

/**
 * A roster id → who it is, for ANY platform.
 *
 * 🛑 THE ONE RULE THAT WAS ONLY EVER WRITTEN FOR SLEEPER, ON A PATH EVERY LEAGUE USES.
 *
 * `Roster.playerData` stores the PROVIDER's own ids — deliberately, per the schema note on
 * `WeeklyScore.playerId`: resolving at ingestion would silently discard everyone who fails to
 * bridge, so the id is kept and resolution happens at read time. Every read therefore has to know
 * WHICH id space it is holding, and `RosterContextProvider` — the roster Chimmy grounds every
 * answer on — did not. It called `getCanonicalPlayersBySleeperIds` unconditionally, which queries
 * `PlayerProviderIdentity where provider = 'sleeper'`.
 *
 * For a Sleeper league that is right, because the roster id IS the Sleeper id. For every other
 * platform it matches nothing, for the same reason a French dictionary fails on German: the lookup
 * is fine and the input was never in that language.
 *
 * Measured on the user's own Fantrax NCAAF dynasty league (Cream Bowl, 2026-09-18): 39 roster
 * spots, 0 names. The grounding packet did exactly what it should with that — `withResolvedIdentity`
 * in `lib/decision-os/grounding/packet.ts` raised `unresolved_identity` and Chimmy said "the roster
 * is synced but not readable" rather than guessing. The refusal was correct; the input to it was
 * not. The names were one join away the whole time, in the column
 * `lib/devy/ingestFantraxPlayerIdentities.ts` fills weekly.
 *
 * ⚠ SO THE VISIBLE SYMPTOM WAS "THE ASSISTANT IS STUPID", AND NOTHING WAS BROKEN ANYWHERE IT WOULD
 * BE LOOKED FOR. No error, no failed sync, no red test — `/core` renders the same roster with names
 * because `lib/core-app/connectedRoster.ts` already knew about Fantrax. Two readers of one roster
 * disagreed about who was on it, and only one of them was ever shown a name.
 *
 * ── What this returns, and what it refuses to ────────────────────────────────────────────────
 *
 * 🛑 A MISS IS `null`, NEVER THE ID BACK AGAIN. An unresolved id is absent from the map and the
 * caller decides what that means: `/core` paints "Player 06k5m" because a list has to render
 * something, and grounding leaves it null because a model asked to reason about a roster must be
 * able to see the gap. Baking either choice in here would force the other caller to live with it —
 * that is how `name: id` reached production once already (see the note on the inverted test in
 * `__tests__/chimmy-context/providers/RosterContextProvider.test.ts`).
 *
 * ⚠ PARTIAL COVERAGE IS EXPECTED AND STAYS VISIBLE. `ingestFantraxPlayerIdentities` linked 4,210 of
 * 16,904 Fantrax CFB ids on its first real run — the bottleneck is the NCAAF identity registry, not
 * the matching (`ambiguous: 0` across that run). So a college roster resolves in part, and the part
 * it cannot resolve is reported rather than filled in.
 */

export type RosterPlayerIdentity = {
  name: string | null
  position: string | null
  team: string | null
  /**
   * Provider ids carried through for callers that need a headshot. Populated only on the Fantrax
   * path, where the image lives under a DIFFERENT provider's id than the roster holds.
   *
   * ⚠ HERE SO THE FANTRAX LOOKUP STAYS ONE QUERY. `connectedRoster` needs name AND image from the
   * same `PlayerIdentityMap` row; splitting them would mean reading that table twice per roster to
   * gain nothing. Grounding ignores this field.
   */
  rollingInsightsId: string | null
  cfbdId: string | null
  /** `SportsPlayer.imageUrl`, on the Sleeper-keyed path only. */
  imageUrl: string | null
}

/** Platforms whose roster ids already ARE Sleeper ids, so no translation applies. */
const DIRECT_SLEEPER_PLATFORMS = new Set(['sleeper', 'allfantasy'])

/**
 * The sport key the identity tables use.
 *
 * `League.sport` is the `LeagueSport` enum (NCAAF), but imports and callers spell college football
 * several ways. `PlayerIdentityMap.sport` and `SportsPlayer.sport` both hold `NCAAF`.
 */
export function normalizeIdentitySport(sport: string | null | undefined): string {
  const s = String(sport ?? '').trim()
  if (!s) return 'NFL'
  return ['cfb', 'ncaafb', 'college', 'ncaa_fb'].includes(s.toLowerCase()) ? 'NCAAF' : s.toUpperCase()
}

const EMPTY: RosterPlayerIdentity = {
  name: null,
  position: null,
  team: null,
  rollingInsightsId: null,
  cfbdId: null,
  imageUrl: null,
}

function cleanIds(rawIds: readonly unknown[]): string[] {
  return [...new Set(rawIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
}

/**
 * Fantrax ids → `PlayerIdentityMap`, refusing anything that is not one-to-one.
 *
 * 🛑 `fantraxId` IS NOT UNIQUE ON THAT TABLE. Two rows sharing one id are two different athletes,
 * and taking whichever the database returned first puts a stranger on somebody's roster — then
 * prices him, projects him, and feeds him to a start/sit answer. The same guard, for the same
 * reason, is written out at length in `lib/core-app/crosswalkRules.ts`.
 *
 * ⚠ STRICTER THAN `reduceCrosswalk` ON PURPOSE. That helper forgives a repeated row with an
 * identical target, because two id links stating the same fact twice is one fact. Here the rows are
 * whole identities, so "the same target twice" is not a thing that can be checked cheaply — two
 * rows means two people until proven otherwise, and refusing costs a gap where guessing costs a
 * wrong name.
 */
async function resolveFantraxIdentities(
  sport: string,
  ids: string[],
): Promise<Map<string, RosterPlayerIdentity>> {
  const out = new Map<string, RosterPlayerIdentity>()
  const rows = await prisma.playerIdentityMap
    .findMany({
      where: { sport, fantraxId: { in: ids } },
      select: {
        fantraxId: true,
        canonicalName: true,
        position: true,
        currentTeam: true,
        rollingInsightsId: true,
        cfbdId: true,
      },
    })
    .catch(() => [])

  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = row.fantraxId?.trim()
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const row of rows) {
    const id = row.fantraxId?.trim()
    if (!id || counts.get(id) !== 1) continue
    out.set(id, {
      name: row.canonicalName?.trim() || null,
      position: row.position?.trim() || null,
      team: row.currentTeam?.trim() || null,
      rollingInsightsId: row.rollingInsightsId ?? null,
      cfbdId: row.cfbdId ?? null,
      imageUrl: null,
    })
  }
  return out
}

/**
 * `rosterId` → who that is, for the ids this app can resolve.
 *
 * Never throws and never invents: an id this app cannot bridge is simply absent from the map. A
 * roster that cannot be read is the state this exists to improve, never a reason to fail the
 * caller.
 */
export async function resolveRosterPlayerIdentities(
  platform: string | null | undefined,
  sport: string | null | undefined,
  rawIds: readonly unknown[],
): Promise<Map<string, RosterPlayerIdentity>> {
  const out = new Map<string, RosterPlayerIdentity>()
  const ids = cleanIds(rawIds)
  if (ids.length === 0) return out

  const provider = String(platform ?? '').trim().toLowerCase()
  const identitySport = normalizeIdentitySport(sport)

  /*
   * ⚠ THE SLEEPER CROSSWALK CANNOT SERVE FANTRAX, AND THAT IS STRUCTURAL RATHER THAN A COVERAGE
   * GAP. Measured on production 2026-08-31: 0 of 73,883 NCAAF `SportsPlayer` rows carry a
   * `sleeperId`, because those rows are Rolling-Insights / TheSportsDB keyed. Translating a Fantrax
   * id into a Sleeper id and looking THAT up would return nothing however good the matching gets,
   * which is why this branch reads the registry directly instead.
   */
  if (provider === 'fantrax') {
    return resolveFantraxIdentities(identitySport, ids)
  }

  const direct = DIRECT_SLEEPER_PLATFORMS.has(provider)
  const crosswalk = direct
    ? new Map<string, string>()
    : await crosswalkToSleeperIds(provider, identitySport, ids)
  const sleeperIds = direct ? ids : [...crosswalk.values()]
  const players = sleeperIds.length
    ? await resolveSleeperRosterPlayers(sleeperIds, identitySport)
    : new Map()

  for (const id of ids) {
    const hit = players.get(direct ? id : (crosswalk.get(id) ?? ''))
    if (!hit) continue
    out.set(id, {
      ...EMPTY,
      name: hit.name?.trim() || null,
      position: hit.position?.trim() || null,
      team: hit.team?.trim() || null,
      imageUrl: hit.imageUrl ?? null,
    })
  }

  /*
   * A NAME AND NOTHING ELSE, for the ids no bridge reached.
   *
   * ⚠ ONLY FOR WHAT IS STILL MISSING. `connectedRoster` asked for every id and used the answer as a
   * fallback; asking only for the unresolved remainder is the same result for strictly less work,
   * and skips the query entirely on a roster that fully resolved.
   *
   * These rows carry no position and no team (0 of 1,257 sampled ESPN rows had either), so both
   * stay null rather than being inferred from the name. Naming him is a fact the row supports;
   * pricing him is not.
   */
  if (!direct) {
    const unresolved = ids.filter((id) => !out.has(id))
    if (unresolved.length > 0) {
      const names = await lookupProviderIdentityNames(provider, identitySport, unresolved)
      for (const [id, value] of names) out.set(id, { ...EMPTY, name: value.name })
    }
  }

  return out
}
