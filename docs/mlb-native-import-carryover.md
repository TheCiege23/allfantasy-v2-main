# MLB native imports and season carryover

## Entry points

- Create League offers Import a League and a commissioner-scoped list of existing imports.
- The import completion screen offers Make this league native to AllFantasy.
- Conversion creates a native league and retains the source import. It does not overwrite the source or create external manager accounts.
- The review shows source/target season and exact baseball points weights before creation.

## Preserved data

Native creation atomically copies current teams, verified rosters, claimed AllFantasy memberships, FAAB balance and waiver priority. Unclaimed managers keep their named teams and must claim seats.

Available LeagueSeason, LeagueDynastySeason, SeasonResult, matchup/draft/transaction/standing facts and historical roster snapshots are copied as archives. New IDs are assigned to archive rows; source provenance is retained. Historical results are never inserted into the live native matchup schedule or rescored. Chat remains in the source import. History arriving in the source after conversion is not automatically copied.

Baseball points imports use a complete zero-based rule set in engine, commissioner UI, template overrides and scoring snapshots. Missing player identities, unresolved weights and unsupported roster constraints refuse creation and roll back the transaction. Bootstrap does not overwrite imported baseball settings.

## Season behavior

The existing MLB creation calendar chooses the upcoming season after the regular-season end. Imported roster ownership is recorded as an imported-rosters snapshot; historical draft facts retain their source seasons. The league remains post_draft and the native season stays in setup before its recorded opener, allowing the commissioner to create an annual draft. Archived history remains separate. The week roller activates completed carried rosters at the opener and leaves a new unfinished draft alone. Unknown opening dates never activate the league. Creating a new annual draft remains an explicit commissioner action; conversion itself preserves the imported rosters. Subsequent commissioner scoring and roster edits update the live engine configuration.

## Verified provider scope

Fantrax MLB roster sport detection now includes the MLB player map, with ambiguity refused. Public read evidence captured October 3, 2026 is in tests/fixtures/fantrax/mlb-points-public.json. The source is a 2023 public points league; the capture date does not make it a 2026 league. Seven of the eight sampled roster IDs remain in the current player map; unresolved identities cannot enter a native roster.

The fixture verifies hitting/pitching category codes, per-team roster constraints, and player-reference shapes. The public source was read without credentials and was not written to production.

ESPN MLB is not enabled: the current ESPN import service is football specific. Yahoo remains unavailable pending provider access approval. Fantrax category formats can be imported for source-platform research/history, but native points scoring cannot reproduce those formats and conversion refuses them. Private-provider access has not been verified in this task; the owner has no external MLB league to supply.

No database schema migration is required.
