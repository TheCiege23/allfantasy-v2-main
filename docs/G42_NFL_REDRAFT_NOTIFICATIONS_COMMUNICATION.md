# G42 NFL Redraft Notifications Communication

## Architecture

G42 adds a scoped communication runtime for NFL redraft leagues. Canonical league runtime events are converted into a communication plan, then persisted through the existing platform notification table, league event feed, league chat, and best-effort Discord bridge.

The runtime entry point is `buildNflRedraftCommunicationPlan`. Persistence is handled by `persistNflRedraftCommunicationForEvent`, with commissioner announcements using `createNflRedraftCommissionerAnnouncement`.

## Notification Model

Each generated notification includes:

- league ID and user ID
- optional team ID
- canonical runtime event type
- title, body, priority, unread state, and created timestamp
- delivery channels
- action link and action label
- source key for idempotent inserts
- related canonical runtime event metadata
- optional expiration timestamp

Rows are written with `sourceKey` so repeated event processing skips duplicate notifications.

## Event Mapping

The runtime covers draft scheduling and picks, auto-picks, draft completion, lineup issues, player locks, waiver submissions and processing, free agent additions, trade proposals and outcomes, scoring updates, matchup finals, standings updates, playoff bracket generation, champion announcements, commissioner announcements, and league chat events.

Events are normalized through `leagueRuntimeEvents.ts`, including G42 aliases for commissioner announcements and league chat messages.

## League Chat Integration

Important league events mirror into league chat as system messages. G42 adds chat notice labels for draft, lineup, scoring, matchup, playoff, champion, and chat communication message types. Chat rows use a G42 subtype and a dedupe key so the runtime does not create duplicate conversations.

## Commissioner Announcements

Commissioner announcements are exposed through `/api/redraft/communication/announcements`. The route checks authentication and commissioner permissions before creating a canonical `commissioner.announcement.created` event. Supported announcement types are league, draft reminder, waiver reminder, and playoff reminder.

## Discord Status

Discord is optional and best-effort. The bridge reuses the existing outbound league-chat sync. Missing configuration returns `not_configured`, and failures are captured without blocking notification, feed, or chat persistence.

## APIs

G42 adds redraft-scoped APIs for notifications, mark-all-read, league communication feed, chat read/post, commissioner announcements, and event ingestion. Shared notification endpoints also accept an optional `leagueId` query parameter for scoped notification center reads.

## UI

The NFL redraft home dashboard now includes a communication panel with unread badge, recent notifications, system feed rows, commissioner announcement form, league chat composer, empty/error/loading states, and responsive layout hooks for mobile verification.

## Consumed And Emitted Events

Consumed events are canonical league runtime events. G42 extends the canonical event catalog with:

- `commissioner.announcement.created`
- `league.chat.message`
- `league.chat.system_message`

The runtime emits persisted platform notifications, league feed rows, league chat system messages, and optional Discord outbound sync attempts.

## Known Limitations

- Email and push are represented as delivery channel placeholders only.
- Discord announcements require existing league Discord channel configuration.
- Browser proof is limited to the scoped communication panel and API contracts unless a seeded local league is available.
- Full repository typecheck has previously timed out in this worktree, so G42 relies on focused tests, targeted lint, and targeted parse checks.

## Future OS Integration Points

The canonical event metadata and action links are ready for future Decision OS, Commissioner OS, and Manager OS consumers, but G42 intentionally does not build those downstream systems.
