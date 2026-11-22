# Zombie creation capacity and universes

New Zombie leagues default to **20 managers** for all seven sports. Every supported size is even, starting at four. The NFL range is 4–20; NBA, NHL, MLB, NCAAF and NCAAB offer 4–32; Soccer offers 4–40.

The shared policy is `lib/zombie/creationPolicy.ts`. Both creation wizards, the options catalog, canonical validation and Zombie metadata creation read it. Switching into Zombie selects 20; revisiting the same format preserves a commissioner's chosen size.

## Season planning

Manager count is independent of the scoring calendar. Infections and revivals can affect several teams in one period, so adding two managers to a season's period count cannot guarantee Survivors remain through the final period. Review player-pool depth before using large fields.

Current platform profiles are NFL 18, NBA 25, NHL 28, MLB 27, NCAAF 15, NCAAB 18 and Soccer 38 scoring periods. These are default platform profiles, not a claim that every competition or future season uses that calendar. Soccer competitions in particular need their calendar checked. The wizard shows an optional planning reference of periods + 2, rounded up to an even number. The default stays 20.

New Zombie native seasons use the full profile with playoff start after the last scoring period. Existing materialized seasons are returned unchanged. Matchweek numbers do not skip international-break calendar gaps a second time.

## Creating a universe

The current wizard offers every count from one through six. One creates a normal standalone league. Two through six create an owned commissioner universe, with identical sport, roster, scoring, draft, privacy, free-agency and automation choices. Names, invite tokens and tier identifiers are distinct. The established three-league Beta/Beta/Gamma and six-league Alpha/Beta/Beta/Gamma/Gamma/Gamma layouts remain; two, four and five use intermediate tier layouts.

All canonical shells, entry slots, invites, levels, Zombie metadata and hub links are written in one PostgreSQL transaction. A failed child rolls back the batch. Post-create initialization runs for every child and preserves the links already committed. The response retains the primary `league`, adds `universeId` and `leagueIds`, and redirects to `/zombie/universe/:id`. Draft shells remain unstarted. Imported rosters carry into one league, rather than being duplicated into a universe.

## Verification

- Capacity tests cover all seven sports, allowed sizes, rejected sizes/counts, and full-profile season lengths.
- UI tests cover the 20-manager format transition, four-manager choice, six-league selector, seat totals, and import restriction.
- Handler and submit tests cover catalog acceptance, one batch request and the hub redirect.
- Pipeline tests check initialization of every child and no post-create actions on transaction failure.
- Opt-in local PostgreSQL tests create six 20-manager leagues, compare shared settings and ownership, verify unique invitations and unstarted drafts, and force a fourth-league failure to prove rollback.

Run the database tests only against a disposable local database, with `RUN_ZOMBIE_CREATION_DB=1` and explicit `DATABASE_URL` and `DIRECT_URL`. The suite refuses remote hosts and cleans up only its own generated identifiers.
