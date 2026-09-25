# League chat and trade intelligence follow-up

Implemented locally, not deployed.

- Softer rounded drawer and multiline Chimmy composer. Enter sends; Shift+Enter adds a line. Screenshot paste works in Chimmy and the shared league/DM/Huddle composer.
- Conversation storage cannot overwrite another account's saved conversation on sign-in changes. Delayed answers stay with their originating league; delayed failures do not display against a different selected league.
- New league trade intelligence disclosure reads accessible native redraft proposals, including outgoing proposals, with paginated retrieval. Pending offers are participant-only; accepted/approved/completed/executed trades are league-visible. Raw snapshot payloads and owner identifiers are not returned.
- Proposal grades are explicitly historical fairness snapshots. Thin or absent valuation evidence withholds the letter. Completed Sleeper trades use existing realized grades under league scoring, with per-side point explanations; trades without realized evidence remain ungraded. Imported provider ledgers retain their missing-scoring explanation.
- Chimmy's tool loop can now retrieve the selected league's trade block, incoming proposal context and completed trade history. Tool arguments cannot override the authenticated user or league. Every trade lookup also retrieves the authenticated viewer roster and league rules in the same call.
- Discord setup offers existing-server linking and a link to Discord's server creation instructions. Creating a server remains a step in Discord, followed by connecting it in AllFantasy.

## Verification

218 tests passed across 20 suites: conversation isolation, trade feed access, tool scoping/failure handling, existing mentions, rich messages, emojis, polls, upload authorization, Discord permissions/channel creation/install state, live stat corrections, sports fallback and route wiring. Two initial worker startup timeouts were rerun successfully. These are mocked regression tests, not authenticated production certification.

Live read-only GIF search succeeded with three Giphy results after allowing network access. GIF search now tries the next configured provider after failure/empty results and has a four-second timeout per provider.

Local fixture preview inspected at desktop and 390 × 844. Trade disclosure opens with grade/explanation; changing league resets the old trade panel. No live messages or trade actions were sent.

Full TypeScript check completed with 125 diagnostics in other repository paths. None in the changed implementation paths. Full build is not certified.

## Remaining limitations

- Local configuration has no `CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN`. Private chat uploads cannot succeed until a private store is configured. No public storage fallback was introduced.
- Credentials are configured locally for Discord, GIF search and AI providers, but this does not establish successful authenticated two-account chat delivery, Discord synchronization, or answer accuracy against real league data.
- External private proposals and trade-block listings are limited to what each provider exposes/imports. This change cannot promise all external offers are available. The new native proposal panel reads RedraftTradeProposal; generic AfLeagueTrade and draft-room proposal records are not aggregated into it yet.
- Tool context remains bounded: the existing incoming-proposal context includes at most three proposals and completed-history context is a recent window. A displayed older trade's follow-up may require additional specific retrieval; the UI list alone does not expand that context window.
- No deployment, billing changes, migrations, or real server/channel/message creation occurred.

References: [Sleeper API](https://docs.sleeper.com/), [Discord server creation](https://support.discord.com/hc/en-us/articles/204849977-How-do-I-create-a-server).

