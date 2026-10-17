# League workspace navigation

## Shipped scope

The intelligence dashboard and operational league workspace remain separate views of the same league. Open League is available in the Core league tab bar and My Leagues cards. It opens the existing /league/[id] route, using the format's default landing without creation flags. Connected franchise hubs retain their existing shared-hub action.

The workspace has explicit return links to the selected league dashboard and the all-league dashboard. The all-league return uses /core?view=all so the optional league-first setting cannot immediately send the user back into a league.

The workspace uses the existing AF Core theme bridge. Its side rails start collapsed, with expansion controls retained; a previously saved right-rail preference still wins. Embedded views render only the center workspace. Specialty atmospheres remain supported.

Native leagues are labeled Hosted on AllFantasy · Beta. Imported leagues name their host and disclose that local lineup, trade and waiver changes do not reach it. Official platform links use the existing allowlisted source-link resolver and provider ids. Native leagues do not get an external host link or an import label.

## Verification

- Navigation and hosting regression tests cover native and imported leagues, unavailable dashboard data, encoded ids, first-run flags, return paths, source links, unknown providers, and Spanish mode copy.
- Existing Core tabs, league screen mapping, header, phone layout and write-authority tests remain part of the targeted check.
- Browser verification checks the actual navigation component with AF Core styles at 390px and 1280px, including horizontal overflow and 44px touch targets.

## Next release

Audit one NFL redraft ruleset through creation, membership, drafting, finalizing rosters, lineup locks, scoring, waivers, trades, advancing weeks, playoffs and archival. Verify user ownership and commissioner recovery actions at each step. This navigation release does not certify a full season or introduce new league-engine behavior.

Before offering a practice-league product, build an isolated copy with its own writes and reset behavior. Existing imported shadow edits are local changes to AllFantasy data; they must not be marketed as an isolated sandbox. A practice copy must survive source sync without changing the imported snapshot or the source league.

## Rollback

Revert this release commit if workspace links fail, the league context is lost on return, or a hosting label claims an imported move reaches the provider. No schema migration or production league mutation is part of this change.
