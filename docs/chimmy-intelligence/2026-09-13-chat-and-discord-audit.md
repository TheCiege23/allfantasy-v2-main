# Chimmy, Communications, and Discord Audit

Date: September 13, 2026

Subsequent implementation is tracked in [Communications Remediation Status](./2026-09-13-communications-remediation-status.md). The observations below describe the original audit, not the remediated working tree.

## Verdict

Not ready to certify against the requested experience. The foundation includes league-aware tools, trade grounding, authenticated chat routes, rich-message components, and a Discord league bridge. However, live questions failed, important chat surfaces have different capabilities, and the Discord outbound relay has an authorization defect.

This is an audit, not a remediation release. Application code was not changed. The workspace contains pre-existing changes, including changes to Chimmy; source findings describe the inspected working tree, while browser observations describe the deployed site. They are not assumed to be the same revision.

## Evidence Levels

- **Live:** reproduced in the signed-in production browser on AllFantasy, using a new audit tab.
- **Source:** traced through the local implementation; not exploited against production.
- **Tests:** focused existing automated tests, generally with mocked data/providers.
- **Unverified:** requires a controlled account, real device, configured external service, or additional test data.

## Prioritized Findings

### 1. P1: Discord outbound relay lacks league and message authorization

**Source:** [outbound route](F:/allfantasy-v2-main/app/api/discord/sync/outbound/route.ts:30), [relay implementation](F:/allfantasy-v2-main/lib/discord/sync-outbound.ts:40).

The endpoint accepts any authenticated session or an internal secret. For a session request, it does not check target-league membership, message ownership, message-to-league association, or message privacy. Author name, avatar, text, and GIF URL come from the request. The relay only reads the stored message's `sourceDiscord` flag; even a missing message does not stop the external post. Posting happens before the message-link database write.

When a bot and outbound mapping are configured, this permits unauthorized or impersonated posts to a mapped league channel. A later database failure does not undo the Discord post. No exploit was sent during this audit.

**Fix:** make the endpoint internal-only or authorize the actor and load the canonical message, author, league, and privacy state server-side. Reject missing/mismatched/private messages before external calls. Add non-member, forged-author, cross-league, missing-message, private-message, and replay tests.

### 2. P1: Legitimate sports questions are rejected as off-topic

**Live:** `How many TDs did David Montgomery have last year?` was rejected as not a fantasy sports question. `Who is the coach of the Jets?` was rejected as not a fantasy sports question tied to AllFantasy data.

**Source:** [domain gate](F:/allfantasy-v2-main/app/api/chat/chimmy/route.ts:1344). There are multiple routing layers; the two live deflections are differently worded and should both be regression-tested.

**Fix:** recognize sports entities, abbreviations, staff questions, and conversational context. General sports knowledge must not require a fantasy league. Unsupported data and off-topic intent are different outcomes.

### 3. P1: Injury matching hijacks waiver questions

**Live:** `Who should I add off waivers this week in KBFL, and who should I drop? Check actual availability and my FAAB.` returned a general cached NFL injury report. It did not answer adds, drops, league availability, or FAAB.

**Source:** [injury trigger](F:/allfantasy-v2-main/lib/ai/deterministic.ts:186), [early injury dispatch](F:/allfantasy-v2-main/lib/ai/deterministic.ts:829). The word `availability` triggers an injury answer before the league-aware workflow can complete.

**Fix:** resolve the primary task before running individual fact builders. A waiver request should combine roster, unrostered candidates, claim eligibility, settings, budget, and projections; injury information is supporting evidence, not a replacement answer.

### 4. P1: Current bubble cannot authorize the live-search fallback

**Source:** [bubble request](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:368), [live-search eligibility](F:/allfantasy-v2-main/app/api/chat/chimmy/route.ts:1439), [paid-path confirmation](F:/allfantasy-v2-main/app/api/chat/chimmy/route.ts:2150), [default flags](F:/allfantasy-v2-main/lib/chimmy-chat/feature-flags.ts:42).

The bubble sends message, scope, home signals, and recent conversation, but never `confirmTokenSpend`. The search fallback requires that field even when enabled. Other paid paths can return a confirmation-required response, but this surface has no confirmation flow. The fallback also defaults off; production flag values were not inspected.

**Live:** the explicit NFL/today Montgomery question reached a missing-data refusal, not a sourced answer. This is consistent with the source limitation, but does not independently prove production flag values.

**Fix:** use a shared consent-aware Chimmy client, show the actual cost, and provide a deliberate confirmation action. Do not fix this by silently charging users or bypassing consent.

### 5. P1: Exact date and historical statistics are not covered by the live-stat path

**Source:** [player answer builder](F:/allfantasy-v2-main/lib/ai/deterministic.ts:699), [rolling statistics](F:/allfantasy-v2-main/lib/live/playerStatLeaders.ts).

This builder reads up to 200 events from approximately six hours. It does not query the requested day, week, or season. If a player matches, it answers with a rolling-window total and a disclaimer, even when the user asked about a different period. That answer can prevent further retrieval. The supported statistic families are also limited.

**Live:** `How many touchdowns did NFL player David Montgomery have today?` returned an explicit unavailable-data response. Honest refusal is preferable to fabrication, but it does not meet the requested capability.

**Fix:** resolve player ID, sport, season, date/week, timezone, and stat category; query authoritative game/season totals. Show source, period, freshness, and provisional/final status. Treat missing data as unknown, not zero. Add today/this week/last year tests, postponed games, multiple games, and scoring corrections.

### 6. P1: Discord privacy promises exceed enforced channel restrictions

**Source:** [privacy copy](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:124), [category/channel creation](F:/allfantasy-v2-main/lib/discord/bot.ts:53).

The UI says the bot can see only the linked channel and nothing else in the server. Channel/category creation supplies no explicit permission overwrites, so this code does not enforce that promise or league-member-only visibility. Actual access depends on existing guild roles and channel permissions. Discord documents guild permissions and per-channel overwrites separately: [official permissions documentation](https://docs.discord.com/developers/topics/permissions).

**Fix:** define the intended audience, enforce and verify channel permissions, and report the actual boundary accurately. Test with an unrelated server member and the bot account before advertising a private bridge.

### 7. P2: DM and Huddle polls cannot be voted on through the current UI

**Source:** [poll serialization](F:/allfantasy-v2-main/components/core-app/comms/ThreadPanel.tsx:207), [message POST](F:/allfantasy-v2-main/components/core-app/comms/ThreadPanel.tsx:238), [read-only rendering](F:/allfantasy-v2-main/components/core-app/comms/ThreadPanel.tsx:413), [server message type](F:/allfantasy-v2-main/app/api/shared/chat/threads/[threadId]/messages/route.ts:204).

The composer supplies a nested poll but omits `messageType: poll`; the endpoint defaults to text. `RichMessage` is rendered without voting/closing callbacks or viewer identity. Anonymous selection is dropped from this serialization. The current league panel has voting callbacks, so passing league-poll tests does not certify DM/Huddle polls.

**Fix:** use one canonical poll contract across chat types, preserve anonymity, and wire voting, closing, expiration, counts, and permission checks. Test two users from creation through reload.

### 8. P2: Switching tabs loses the Chimmy conversation

**Live:** after four questions, switching to DMs and back to Chimmy showed `Nothing asked yet.`

**Source:** [local conversation/request state](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:352), [drawer unmount](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:1601). The current panel uses local state rather than the persisted conversation flow available elsewhere.

**Fix:** persist messages and drafts by user/conversation/scope, retain them through tab switches and closing, and avoid mixing league contexts. Test reload, interrupted requests, mobile backgrounding, and switching leagues.

### 9. P2: League selection hides most leagues

**Live:** the signed-in account had 65 leagues, but Chimmy offered six scope chips. KBFL could be resolved by name in text but was not a selectable chip.

**Source:** [Chimmy truncation](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:526), [league picker truncation](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:1104), [Discord picker truncation](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:1433). Pickers truncate to six or eight without a complete searchable list.

**Fix:** searchable league picker with season and platform disambiguation. Keep recent leagues as shortcuts, not the only choices. Preserve selected scope in the Discord setup link; the live link opened an unscoped setup page asking for a league again.

### 10. P2: Starter and trade answers are only partially grounded

**Live:** a KBFL start recommendation resolved the league and listed roster status, but explicitly said no projections or scoring details were available. It did not provide a complete scoring-aware starting lineup.

**Live:** a hypothetical Montgomery-for-2027-second trade produced a dynasty value and roster commentary, but said stored scoring rules were unavailable and did not value the received pick. This is not a complete, independently verified trade evaluation. The returned roster identities and values were not cross-checked against the source platform in this audit.

**Source:** [available tools](F:/allfantasy-v2-main/lib/chimmy/tools/chimmyTools.ts:72). Roster, available-player, value, and projection tools exist, but tool presence is not proof that an answer uses all required evidence.

**Fix:** require task-specific evidence completeness: scoring, eligible slots, roster ownership, matchups/projections, lock state, and injuries for start/sit; both trade sides, pick year/round assumptions, format, and roster impact for trades. Make missing evidence visible and ask a targeted follow-up instead of presenting a complete recommendation.

### 11. P2: Waiver history is categorically declared unavailable

**Source:** [waiver grounding](F:/allfantasy-v2-main/lib/chimmy/waiverGrounding.ts:120).

This builder always injects a statement that there are zero available claims/transactions for every league and limits answers to rules questions. It does not establish that claim by querying league-specific transaction availability. Separately, `get_available_players` identifies unrostered players, not verified claim eligibility.

**Fix:** connect actual transaction/claim coverage when available and state per-league limitations. Separate unrostered, free agent, pending waivers, locked, and ineligible. Never invent failed claims, winning bids, or remaining budget.

### 12. P2: Older bubble and current communications drawer do not provide the same chat features

**Source:** [older bubble](F:/allfantasy-v2-main/components/decide/ChimmyBubble.tsx), [older panel](F:/allfantasy-v2-main/app/dashboard/components/LeftChatPanel.tsx), [older league renderer](F:/allfantasy-v2-main/app/dashboard/components/LeagueChatInPanel.tsx:694), [current thread renderer](F:/allfantasy-v2-main/components/core-app/comms/ThreadPanel.tsx:413).

Older DM/Huddle composers are text-only. The older league composer can prepare richer payloads, but its message rendering shows text/GIF rather than the full attachment/poll experience. The current core Chimmy panel is itself text-only even though a richer standalone Chimmy shell exists elsewhere.

**Fix:** converge on shared conversation, composer, and message-renderer contracts. Validate every actual mount point on desktop and mobile, not just the newest component in isolation.

### 13. P2: Private chat uploads are stored as public blobs

**Source:** [upload storage](F:/allfantasy-v2-main/app/api/chat/upload/route.ts:162).

Upload authorization checks league/thread membership, which is good. However, storage uses `access: public`; download access is not tied to current thread membership. Anyone possessing the URL can retrieve the attachment, including after removal from a private thread. This is a bearer-link privacy limitation, not a claim that attachments are publicly searchable.

**Fix:** decide and document the privacy policy; for private chats, use protected retrieval or short-lived authorized URLs and enforce access revocation. Also reconcile the image limit accepted by the route with the limit described by its error message.

### 14. P2: Requested Discord DM/server creation is not implemented by the league bridge

**Live:** the drawer instructed the user to create a server in Discord, invite the bot, then link a channel. The selected league had no linked channel.

**Source:** [channel setup](F:/allfantasy-v2-main/app/api/discord/channels/create/route.ts:20), [bridge scopes](F:/allfantasy-v2-main/lib/core-app/discordBridge.ts). Setup creates a channel inside an already linked guild. The bridge intentionally excludes DMs; it does not implement private DM server creation or mirroring.

**Fix:** define separate products clearly: Discord account connection, commissioner league-channel bridge, guided server setup, and optional private-group integration. Do not imply that a private AllFantasy DM automatically has a Discord server or mirror.

### 15. P2: Discord media parity and delivery reliability are incomplete

**Source:** [inbound polling](F:/allfantasy-v2-main/app/api/discord/poll-messages/route.ts:78), [outbound relay](F:/allfantasy-v2-main/lib/discord/sync-outbound.ts), [poll fetch limit](F:/allfantasy-v2-main/lib/discord/bot.ts:200).

Inbound polling skips empty-text messages, including attachment-only messages. Outbound supports text and GIF, not equivalent attachment/poll/reaction behavior. Polling reads at most ten messages per call; backlog handling needs a burst test. A scheduled invocation for this route was not found in the tracked schedule files inspected; externally configured scheduling was not verified. Fire-and-forget outbound failures do not provide a durable retry guarantee.

**Fix:** define supported mirrored content explicitly, add idempotent delivery/retry tracking and backlog pagination, and monitor scheduled ingestion. Test bursts, outages, duplicates, reconnects, attachment-only messages, and loop prevention.

### 16. P2: Huddle audience labeling is misleading

**Live/source:** the tab says `Everyone on AllFantasy` and describes a public feed, while it presents member-selected group threads. [Privacy copy](F:/allfantasy-v2-main/components/core-app/comms/CommsDrawer.tsx:116), [thread implementation](F:/allfantasy-v2-main/components/core-app/comms/ThreadPanel.tsx).

**Fix:** choose public-feed versus private-group semantics and use the same audience model in UI and authorization. Show the actual audience before sending.

### 17. P2: Accessibility and mobile comfort need work; visual sign-off remains open

**Live:** emoji selection inserted an emoji into an unsent draft. The GIF gallery loaded 24 images successfully. However, the GIF choices appeared as unnamed buttons in the accessibility tree. Poll fields and some picker search fields were also unnamed there.

**Source:** [GIF buttons](F:/allfantasy-v2-main/app/dashboard/components/chat/GifPicker.tsx:175) use empty image alt text without a button label.

**Responsive measurements:** checked actual CSS viewports approximately 390x844, 520x1125, and 1440x900. Browser zoom affected initial requested dimensions, so measurements use actual `innerWidth`/`innerHeight`. The outer drawer stayed within the measured viewport and document width. At phone width, toolbar actions measured about 27x26 pixels, send 26x26, close 24x24, and poll-duration buttons about 30x23. These are cramped for touch. The tabs were 44 pixels high. This is not a blanket accessibility-conformance result.

**Limit:** browser screenshot capture timed out twice, so no pixel-level visual sign-off was possible. Real iOS/Android keyboards, safe areas, orientation, and background/reconnect behavior were not tested. Viewport overrides were reset.

**Fix:** meaningful accessible names, visible focus, keyboard traversal, announced errors/results, larger touch targets, and real-device keyboard checks. Recheck focus trapping/return and picker placement with screenshots before release.

## Verification Performed

### Live questions

| Question | Observed outcome |
| --- | --- |
| Montgomery TDs last year | Off-topic rejection |
| Coach of the Jets | Off-topic rejection |
| Montgomery touchdowns today, explicitly naming NFL | Missing-data refusal |
| KBFL starters using roster/scoring | League resolved; roster-status answer, no projections/scoring |
| KBFL waiver adds/drops with availability and FAAB | Unrelated general injury report |
| KBFL hypothetical player-for-future-pick trade | Partial value/roster commentary; incomplete scoring/pick valuation |

### Automated tests

260 tests passed across 24 focused files in two runs (144 + 116). These do not certify live data quality or two-user delivery.

Coverage included Chimmy live-question routing, league resolution, waiver grounding, described trades, player projections, upload thread access, poll storage/voting/anonymity, reactions, DM thread creation, thread and league reply round-trips, Discord bot callback linking, rich-message rendering, scope notices, live-stat fallback, Chimmy route/client contracts, failed-send draft restoration, and emoji services.

Several route tests intentionally mocked missing telemetry delegates or token-preview failures and logged those paths while passing. No production database fixtures were written by these test runs.

### Safe interaction boundaries

- Opened the live drawer, its tabs, league scope, Discord setup, and media/poll controls.
- Asked only private Chimmy audit questions; did not send public league messages or messages to other people.
- Emoji draft was cleared. No league poll was published.
- Did not upload a file to live storage, authorize a new Discord installation, create a guild/channel, or change external permissions.
- Did not exploit the relay defect, read credentials, or assert that OAuth/token configuration works solely from source.

## Remaining Release Gates

1. Fix the relay authorization defect and verify private-channel access with controlled Discord roles.
2. Make all six live-question scenarios answer the requested task with traceable, period-correct evidence, or a precise missing-data explanation and useful next step.
3. Add controlled two-account DM/Huddle/league tests: create, send, receive, reply, reconnect, unread/read status, block, membership removal, upload/download, GIF, emoji/reaction, and poll create/vote/close/anonymity.
4. Complete Discord OAuth, bot installation, per-league setup, permissions, two-way delivery, disconnect/reconnect, and failure/retry tests in a disposable server.
5. Finish desktop screenshot review and real iOS/Android testing with keyboards open, long league names, long messages, media failures, and slow networks.

The appropriate promise is broad sports/fantasy coverage with reliable retrieval and explicit uncertainty, not a guarantee that every arbitrary question always has an answer. Correct routing, source completeness, privacy, and delivery must be established before a visual redesign can be called complete.
