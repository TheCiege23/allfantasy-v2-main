# Zombie release acceptance — October 29, 2026

Scope: isolated Railway Zombie staging. Production is excluded. Original NFL/NBA/NHL/MLB leagues remain setup, week 0, with unstarted drafts.

## Automated acceptance

The opt-in disposable-Postgres Zombie lane exercises:
- Four sports through native create, draft activation, settlement and once-only league reports.
- A second signed-in manager cannot change commissioner settings or record prizes.
- Recorded external weekly prizes and internal winnings remain unchanged when a result-changing correction requires review, independently for all four sports.
- Historical recorded-provider scoring remains a separate replay.
- Four sport universes with three levels each: native season standings, configurable movement counts, actual adjacent level labels, unplayed/ambiguous standing refusal, finished-season and correction gates, owner-only execution, concurrent retry and idempotency.

Movement execution currently records approved next-level allocations. It does **not** renew the universe, create next-season drafts or transfer managers into new league seats. Those remain release work. Current-season rosters and player holdings must not be moved by recording an allocation.

## NFL market ADP exception

The existing FFC reader requests the documented format, 12-team size and season with no application row cap. Its saved current-year samples contain:
- half-PPR: 54 players; last draft date September 14.
- standard: 118; September 15.
- PPR: 29; September 25.
- 2-QB: 131; October 8.

These are historical sample dates, not October observations. Re-fetching the same sample does not refresh its evidence. New imports preserve the sample end date, cron responses report freshness by format, and current/forward-season draft reads reject stale or undated FFC samples under the existing seven-day policy. Existing rows formerly stamped at import time are also checked against stored sample metadata. Scoring formats are never blended to manufacture coverage.

A fuller current licensed observed-draft board is required to close this gap. The existing admin import validates exact scoring context, sample size, canonical identity, observation date and licensed use. No new provider API was probed.

FFC documentation: https://help.fantasyfootballcalculator.com/article/42-adp-rest-api

## Physical iPhone acceptance — awaiting owner result

Use the four separate QA draft rooms already sent, not the original leagues. Record:
- iPhone model and iOS version.
- Cold and repeat opening time until the player list is usable.
- Search with keyboard open, position filters, numeric stats, ADP availability/order.
- Add/reorder queue, start one QA draft, pick, pause, reopen.
- Portrait/landscape, safe areas, text scaling, clipped or inaccessible actions.

Automated WebKit at phone dimensions does not close this item.

## Live-calendar multi-manager beta — awaiting participants and a real scoring window

Use separate staging beta leagues. Record consented manager accounts, sport, scoring period and provider data freshness before starting. Complete drafts and lineup checks before lock. Let normal ingestion/finalization run through the actual scoring window. Review infections, item awards/consumption/transfers, permanent Whisperer trade bans, Zombie trade bans, prize status and once-only chat updates. Do not replace a live score with a synthetic value to make the week complete.

Keep historical replay, controlled completed-season fixtures and live-calendar results clearly identified. No external funds are transferred by these tests.

## Other open provider exceptions

Verified missing portraits, the unprofiled NBA identity and undocumented NHL goalie season wins/shutouts remain visible exceptions. No guessed images, roles or stat values may fill them.

Daily staging maintenance reports stale or undated FFC boards as partial work even when provider row counts are positive. The draft shows a market-ADP-unavailable message when no usable ranks exist. This does not assert that a licensed replacement board has been supplied.
