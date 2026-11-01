# Engagement notification delivery

Implemented locally on October 19, 2026. Deployment and real-device acceptance have not been performed.

## Changes

- The existing notification relay runs every minute and also drives sport-aware game alerts. No additional scheduler slot is required; the registry remains within its 60-job ceiling.
- Injury imports, regular news imports, and imported-trade sweeps run every two minutes. The separate paid X-news enrichment schedule is unchanged.
- Game alerts cover halftime, close late games, finals, provider-identified scoring plays, and selected big plays. The audience is explicit sport interests plus members of leagues in that sport. Existing category preferences, quiet hours, and per-league mutes apply.
- Game polling includes NFL, NCAAF, NBA, NCAAB, NHL, MLB, soccer, WNBA, and college baseball. Live-only sports use explicit sport interests rather than querying unsupported league enum values.
- Football big plays use individual provider plays of at least 20 yards, not cumulative yardage guesses. Basketball includes scoring plays, steals and blocks; baseball includes scoring at-bats, home runs and triples; hockey and soccer include scoring events supplied by the feed.
- Injury notifications resolve canonical athletes within a sport and current roster ownership across native and imported leagues. Unavailable starters receive an actionable lineup alert. The old five-player notification cap and fire-and-forget injury sends are removed.
- Push and email handoffs persist before delivery in the existing notification outbox. Stable event, user and channel identities prevent repeat handoffs. Failures retry; abandoned sending leases recover. A recipient's current settings are checked again when retrying.
- Push begins before email retries, is awaited, sends to devices concurrently, has an eight-second socket timeout, and requests high urgency. Partial device failures remain retryable. Expired subscriptions are removed. Scoring-play, big-play and close-game push messages have a five-minute retention period, and those queued live alerts expire rather than replaying after a long outage. Final scores retain the longer delivery window.
- Performance and lineup categories are now push eligible. Play emails follow the user's email switch. Sports, injury and news events do not send texts; SMS controls are shown for league-operation categories only.
- Standard draft warnings include “on the clock in 3 picks,” respect snake turns and traded pick ownership, and carry an event identity for deduplication.
- Native trade acceptance notices include the offer's frozen server market grades when coverage is complete. Missing evidence is labeled unavailable. The existing imported-trade notification service already includes grades in its email and push subject; its detection cadence is shortened.

## Coverage and operational limits

This work does not certify every upstream sporting event or push display on every device. The app still depends on polling, the host scheduler, available provider coverage, user consent and valid delivery credentials. The current soccer scoreboard maps to MLS; global soccer competition coverage is a separate provider expansion. Existing injury ingestion explicitly has no comprehensive soccer injury feed, and college injury coverage is limited. WNBA and college baseball have game alerts here; they do not gain new injury feeds or fantasy-league support.

Upcoming games are initialized within 30 minutes of their scheduled start so the first scoring play can be detected. A game's first successful observation establishes a baseline and does not blast historical events. If its first play summary is unavailable, the first available summary is also baselined. Subsequent provider-identified plays remain independently eligible; there is no blanket player cooldown on the new game-event path. Halftime can be recovered after a missed polling interval when the provider supplies period scores. A missing score is never invented as zero.

Existing NFL player-specific alerts and new sport-interest game alerts have different audiences and categories. Users can adjust “Scoring plays & big plays” separately from game scores. Cross-provider play identities are not universally joinable; this is not an exactly-once guarantee across all legacy and new sources.

The outbox is an at-least-once transport: a crash after a provider accepts a send but before its receipt is saved can cause a retry. Stable push tags reduce duplicate device cards; email-provider idempotency is not claimed. Provider acceptance is not proof that a device displayed or a person read an alert.

SMS remains opt-in with phone verification. Authentication and verification codes remain separate from engagement alerts. This change does not create a new contact-invitation UI or send invitations to anyone.

## Verification

195 focused regression checks passed across 20 files, and the scoped TypeScript check and scheduler budget check passed. `tsconfig.notifications.json` preserves the focused compilation scope.

Focused regression suites cover sport-specific close games, halftime recovery, first-poll baselines, scoring-play identities, persisted cursor failure behavior, more than five injured starters, imported lineup shapes, durable handoffs and retries, SMS policy, saved trade grades, and traded draft picks.

The broader regression run found one unrelated existing failure in `cron-heartbeat-route-contracts.test.ts`: the waiver route now returns additional Survivor Guillotine results, while its fixture expects the older response. That route was already modified in the workspace and was left untouched.

Before production acceptance, deploy the code and scheduler registry together, confirm the minute relay and two-minute imports are executing, inspect `cron-sports-engagement` telemetry and pending/failed outbox rows, and exercise opted-in email and installed-phone push with controlled events. Check each sport's feed coverage explicitly; missing upstream events cannot be recovered by a delivery worker.

## Research

The [web-push library documentation](https://github.com/web-push-libs/web-push) documents urgency, socket timeout and message retention options used by the sender. [Sportradar's push-feed guidance](https://developer.sportradar.com/football/docs/ncaafb-ig-push) describes continuous event streaming plus REST recovery after disconnects. That is the next infrastructure step if broadcast-speed, complete play coverage is required beyond the existing polling feeds.
