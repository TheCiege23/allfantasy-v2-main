# Imported league alerts (Sleeper)

In Settings > Notifications > Imported league alerts, enable Scoring, Lineup changes,
Completed trades, or Draft activity, choose in-app/push/email delivery, then save.
These four categories start disabled (email also starts off) and do not change native AF categories.
They also appear in the existing per-league mute controls and notification test selector.
Scoring and lineup personalization requires a linked Sleeper user ID matching the league roster owner.

The existing successful scheduled/manual connected-league sync calls the producer with its memoized
normalized payload. No new cron job, upstream writes, additional provider polling, database schema
migration, or email inbox access is needed. The Sleeper fetch retains draft lifecycle metadata and
trade status update times from requests it already performs; failures remain visible as fetch warnings.

Supported events:

- Current-period matchup score changes, including opponent updates and stat corrections.
- Changes to the linked manager's starting lineup, including empty slot counts.
- Newly completed league trades, timestamped by status update rather than proposal creation.
- Draft start/completion and a summary of picks observed since the previous sync.

Delivery follows the existing AF dispatcher, durable email/push outbox, device subscription,
global/category switches, per-league mutes, email unsubscribe, device choices, and quiet hours. Source labels and league links
appear alongside existing notifications. This is sync-based activity detection, not live
play-by-play, pending private trade offers, deadline reminders, or on-the-clock notification delivery.
ESPN and Fantrax remain outside this initial producer.

The first successful observation establishes a quiet baseline. Baselines live in SportsDataCache
under an account- and league-scoped imported-alerts:v1:sleeper key, extended for one year on each
successful observation. Expired/missing baselines and gaps over 48 hours rebaseline without replay.
Incomplete/failed syncs do not advance alert state. A per-league automation lease prevents overlapping
alert processors; older observations are ignored. Dispatch failures preserve the baseline for retry;
intentional preference suppression consumes the event so enabling a category does not replay history.
Stable event keys deduplicate in-app rows and durable transports across retries.

Verification uses synthetic Sleeper fixtures, mocked database/transports, the real normalization
adapter, settings rendering, preference merge/resolver, push gate, and sync runner wiring.
It does not contact real devices or send production emails.
