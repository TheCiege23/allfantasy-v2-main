# CFP and NBA Cup Bracket Leagues

This feature uses the existing playoff challenge tables for pools, entries, invites, picks, and standings. Each pool is sport- and season-scoped.

## Player flow

- From `/brackets`, create a College Football Playoff or NBA Cup Bracket League.
- Invite members with the existing pool link or code.
- After the official field and all game start times are published, create entries and pick each winner. Picks save through the existing playoff pick route and cascade when an earlier selection changes.
- Each game locks at its published start time. The server rejects missing-field, missing-schedule, and late picks.
- Share an entry's read-only link. The share page reveals a pick only after that pick's game has started; private leagues require membership.
- Pool standings use the existing scorer. CFP round points are 1, 2, 4, 8; NBA Cup points are 1, 2, 4.

## Tournament shapes

- CFP: 12 teams, four first-round games, four quarterfinals, two semifinals, one championship. The repository's existing fixed 11-game graph is used.
- NBA Cup: eight qualifiers, four quarterfinals, two semifinals, one championship. East and West remain separate until the final. The Cup is stored as `nba_cup`, distinct from `nba` playoff pools.

## Admin launch sequence

1. For CFP, publish the 12 committee seeds at `/admin/cfp-seeding`.
2. For NBA Cup, publish East and West four-team knockout seeds at `/admin/knockout-brackets` after group play is final.
3. At `/admin/knockout-brackets`, publish all 11 CFP or seven NBA Cup game start times as timezone-qualified timestamps. A single schedule updates every matching pool. New pools inherit the published field and schedule.
4. After each game is final, enter its home and away scores by pool ID and game number on the same page. Results are audited, scored on read, and advance official winners in the bracket projection. Identical repeat submissions are safe. A changed final is rejected for separate support review.

The admin result route is an intentional manual result path. The existing playoff provider sync is limited to NBA/NHL/MLB and must not be used for CFP or NBA Cup until its event mappings are verified. Automatic result ingestion is a later integration.

## Verification before merge

- Run `npm run typecheck` and `npx vitest run __tests__/playoff-nba-cup-bracket.test.ts __tests__/playoff-cfp-template.test.ts __tests__/playoff-cfp-seeding.test.ts`.
- In staging, create each sport's private pool before and after field publication. Verify the initial pending state, field replacement, schedule propagation, 11/7 entries, cascade, lock at game start, share privacy, scoring, and leaderboard rank.
- Verify the admin result form against a staging database, including the no-correction response for an already final game.
- Confirm all bracket hub cards link to the playoff create API and never fall into the legacy bracket league flow.

## Format sources

- [CFP confirms 12 teams for 2026-27](https://collegefootballplayoff.com/news/2026/1/23/2627-format)
- [NBA Cup 2026 knockout format](https://www.nba.com/news/nba-cup-101)
