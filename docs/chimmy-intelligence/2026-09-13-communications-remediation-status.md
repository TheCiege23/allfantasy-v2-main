# Communications Remediation Status

Date: September 13, 2026

## Follow-Up Certification

- **Live Discord bot delivery passed.** Created the dedicated [af-certification-private channel](https://discord.com/channels/1180313285313167390/1548845145447731331) in TheCiege1011's server. Verified exact permission overwrites denying @everyone and allowing the owner and bot. Posted and read back a labeled test message and PNG attachment. Repeating a message with the same nonce returned the same message ID. Discord administrators retain access. No real league messages, trades, roster edits or settings changes were made.
- **App bridge remains unverified.** The production read showed no DiscordGuildLink, league-channel mapping or connected owner profile for this server. Bot-level delivery is not an authenticated, two-account, end-to-end league synchronization test.
- **Storage is blocked by billing.** The dedicated private storage variable is absent locally and from Railway's reported variable names. Creating allfantasy-chat-private in the linked Vercel team failed with HTTP 402: account suspended, valid payment method required. No new store was created and no billing settings were changed. Existing public files were not migrated or deleted.
- **Authorization fixes are local, not deployed.** Server linking now verifies the OAuth-connected human's owner/Manage Server/administrator permissions; reinstalling cannot transfer another account's link. Bot-install callbacks validate state and initiating account. Channel creation applies private member overwrites, reuses mappings and cleans up a newly created duplicate or failed-to-save channel. Enabling sync rechecks human authority and targets only league_chat mappings. Disabling remains available to the commissioner.
- **Focused verification:** 21 tests passed for human authority, callback state and identical-engine recovery; 7 channel-creation tests passed; 12 sync-toggle and upload-access tests passed. Installation-flow and callback tests then passed 12 tests, adding 3 distinct installation tests. Total for this follow-up: 43 distinct passing tests. An earlier worker-start failure ran no tests, and a permission-bit fixture typo was corrected before the passing rerun. Older batches below overlap other runs.
- **Client generation passed.** Prisma 5.22 generated successfully after adding a Windows-only identical-engine copy guard. The guard recovers only a locked temporary copy targeting this workspace's exact query engine when both files have identical bytes; it does not bypass a changed engine version or arbitrary filesystem errors.

## Decision

Huddle remains a private, membership-gated group conversation. The provided communications HTML is a visual reference, not authorization to create a public feed. Existing conversations are not converted to public posts.

## Implemented Locally

- Second visual pass removes nested message frames, softens navigation and composer shapes, and fixes the welcome area being automatically scrolled out of view. Rechecked at 390 x 844 and 1280 x 800 without horizontal overflow.
- League AI shortcuts now open the private Chimmy tab. The previous shortcut falsely labeled responses public while using the private answer service.
- Discord outbound sends now persist an AutomationJob before delivery, use a worker claim and bounded retries, and recheck stored content, privacy and destination at delivery time. Stable Discord nonces reduce short-window duplicates; this is not an exactly-once guarantee.
- Inbound polling pauses when the bot identity cannot be confirmed and selects only league-chat bridges.
- Live stat aggregation now accepts newer downward corrections, including zero, deduplicates per game and stat, and sums distinct games within the available feed window.

- Restyled the communications launcher and drawer using the supplied dark/teal reference, including mobile insets, touch targets, focus handling, keyboard-height adaptation and clearer tool icons.
- Connected the league page's desktop bubble and mobile sheet to the shared drawer. Other dashboard uses of LeftChatPanel still exist and need separate parity verification.
- Replaced truncated league chips with searchable selection covering all supplied leagues.
- Retained private Chimmy conversations by user and league in session storage. Preserved private thread text drafts across tab switches. Screenshot selection and paid-answer consent reset on scope changes.
- Added explicit paid-answer consent; unavailable prices disable that consent. Quick prompts populate the composer without automatically sending a paid question.
- Broadened sports-question recognition, routed period-specific statistics and coaching questions away from inappropriate cached answers, and enabled the consent-gated sourced-search fallback by default. No promise that every question can be answered is warranted.
- Enriched roster-tool context with normalized scoring, lineup and waiver settings. Removed the false blanket claim that no waiver history can ever be retrieved. The bounded tool loop allows four provider turns.
- Wired DM/Huddle poll voting and author close controls. Poll writes use optimistic concurrency, reject deleted/expired polls and enforce membership. Anonymous voter identities are redacted; new polls cannot import client-supplied votes.
- Added private-thread reaction controls and typing writes. Protected against a late message response replacing a different conversation.
- New chat uploads use private blob storage and an authenticated retrieval URL. Downloads recheck current membership and disable public caching. Voice uploads now carry the private thread ID.
- Restricted the Discord outbound endpoint to an internal secret. The relay resolves stored message content and identity, rejects cross-league/private/tribe messages and avoids resending an already recorded delivery.
- Increased inbound Discord retrieval to 100 messages, retained supported attachment metadata and added the polling job to cron-schedule.json. This does not guarantee retry durability or automatic scheduler installation.

## Verification

- Latest focused stat/security batch: 2 files, 33 tests passed. New outbound job suite: 7 tests passed, covering durable enqueue order, competing claims, failures, destination changes, privacy changes and retry limits.
- Broader follow-up: 61 of 63 tests passed initially; the first route import timed out and the following rate-limit assertion failed. An isolated rerun of the route and scope suites passed all 25 tests, including authentication, rate limiting and the new private-shortcut regression. Do not count overlapping batches as unique tests.
- Confirmed the configured bot can list TheCiege1011's server (1180313285313167390). This is read-only connectivity evidence, not proof of message delivery, private channel permissions or two-way synchronization.

- Main focused regression batch: 17 files, 167 tests passed.
- Additional composer/reaction/typing tests: 6 files, 46 tests passed.
- Final attachment/composer subset: 4 files, 28 tests passed, including revoked-member download denial, private caching headers and traversal rejection. These batches overlap; do not add them as unique coverage.
- Local browser preview inspected at 390 x 844 and 1280 x 800. No horizontal document overflow. Private Huddle labels, poll creation controls and draft retention checked through the visible interface.
- The preview uses explicit fixtures and does not send real messages or call paid providers. Its screenshots do not establish production provider accuracy or delivery.
- Full TypeScript checking still reports repository errors. A filtered rerun reported no diagnostics in the changed communications, upload, Discord, Chimmy-tool, league-bubble or preview paths. The whole build is not certified clean.

## Deployment Requirements

1. Configure CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN for an actual private Vercel Blob store. Without it new chat uploads intentionally return an unavailable response, rather than storing private messages publicly.
2. Migrate existing public chat blobs and message URLs, then revoke/delete the old public objects with an approved migration. This work has not been performed; existing public URLs are not retroactively protected.
3. Configure the existing AI provider keys, spending policy and feature flags. Validate paid consent, unavailable data and the requested sports questions against real league data in staging.
4. Ensure the deployment scheduler actually executes cron-schedule.json, and configure the Discord bot, internal relay secret, guild access and channel permissions. Validate with two test accounts and a controlled Discord server.

## Still Open

- Outbound retries are implemented locally and unit tested but not live certified. Burst pagination, full attachment mirroring and edit/delete synchronization remain incomplete. Discord's short nonce window does not eliminate every crash-related duplicate-delivery scenario.
- New channels now start with explicit private membership permissions. Existing channel permissions and later member additions/removals still need reconciliation and live revocation testing. Discord server owners and administrators retain access. Private AllFantasy DMs remain separate from Discord.
- Ordinary apps cannot use the retired guild-creation endpoint. Users must create a Discord server themselves, then authorize and connect its channel. Discord documents the July 15, 2025 removal in its [official change log](https://docs.discord.com/developers/change-log#deprecating-guild-creation-by-apps).
- Exact historical totals and current coaching answers depend on successful, properly sourced provider retrieval. Correction-aware aggregation is implemented, but the rolling feed is not a complete historical-stat engine or guaranteed full-day total.
- Starter/trade/waiver advice needs production evaluation for each supported sport and league format. Richer context and prompt changes alone do not prove factual accuracy.
- Live GIF search, real private image/video/voice uploads, two-account polling/reactions, physical-device keyboard behavior and authenticated end-to-end league-page testing remain to be verified.

This is a local implementation checkpoint, not a deployment or a claim that every original audit finding is resolved.

## Build Environment

The effective local database points at production. No broad database migration was run. The Windows query-engine DLL lock is resolved and client generation passed. JSON type-boundary corrections reuse the existing Prisma helpers; they do not add runtime validation or certify unrelated modules.

The follow-up 6 GB full typecheck exhausted its heap. A subsequent resource-contended 8 GB attempt was stopped; it is not a passing check. A final full check is tracked separately below. The local preview server remains available at http://127.0.0.1:5190/.

The final 8 GB typecheck completed with **116 TypeScript diagnostics** just before cancellation was requested. The result is recorded in communications-typecheck-final.log. No diagnostics were reported in the changed communications, Discord or chat-upload files. Remaining failures include Chimmy context contracts, AI chat session typing, draft component contracts, playoff types, World Cup services and Decision OS enrichment types. This is a **failed full-project check**, not a clean build. A production bundle was not built or deployed in this follow-up. The earlier incomplete-status update is superseded by this completed diagnostic result.

### Required Next Steps

1. Restore the linked [Vercel team's billing](https://vercel.com/teams/cafeconchimmy/settings/billing), then create a private store and configure CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN without replacing unrelated public-store credentials.
2. Connect the server owner's Discord account through AllFantasy Settings > Connected Accounts. Complete bot linking and a league connection through the authenticated app after the local security fixes are deployed. Do not manufacture an OAuth identity or account link in the database.
3. Resolve the 116 reported full-project type errors, then repeat typechecking and production-bundle verification on a stable working-tree snapshot with sufficient available resources. Do not treat Next's existing ignoreBuildErrors setting, a compiler timeout, or the focused tests as a passing full build.
4. Verify app-level private uploads, revoked-member access, two-account delivery and inbound/outbound league synchronization after those prerequisites. The successful bot-only test does not substitute for these checks.
