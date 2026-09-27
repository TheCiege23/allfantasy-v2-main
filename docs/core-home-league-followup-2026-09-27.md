# Core home and league overview follow-up

Observed in authenticated production Chrome:

- A multi-player decision named a Monday starter but displayed the earliest flagged starter's Sunday deadline. Group decisions now name the affected starter count and explicitly label the earliest kickoff. Single-player decisions retain their direct lineup anchor.
- The account-paused inactive league supplied the oldest timestamp to every home freshness footer. Active connection freshness now excludes account-paused connections and states how many were excluded. Unknown pause reads retain the conservative original behavior; active unread connections still warn. Paused history remains available.
- Injury replacement actions searched for the injured player's name without league context, and were hidden below 640px. Each verified starting league now links to its waiver pool, names the destination, and exposes a minimum 44px touch target on phones. Unknown slots offer Player Finder without claiming a free-agent pool.
- Defense IDP For Life's overview said its draft board was not captured, while Draft HQ displayed 64 picks across four rounds for 2026. The overview now reads a database aggregate over imported DraftFact records alongside native draft metadata. Independent draft reads begin before the trade feed finishes; full pick resolution and grading remain in Draft HQ.

Validation: 105 tests passed across eight files, including route destination checks, real home streaming behavior, decision sorting and kickoff labels, pause freshness, draft summary failure handling, and a deferred trade-feed check. The initial broad four-worker Core run timed out in unchanged trade and source-scan tests; both passed in the focused single-worker run. Required release CI and production browser verification are pending.

These fixes do not certify every consequential form submission or guarantee zero whole-page latency. Provider refresh and live-game parity retain the prior audit's fixture-specific limits.
