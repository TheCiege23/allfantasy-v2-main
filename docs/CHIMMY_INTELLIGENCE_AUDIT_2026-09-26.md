# Chimmy intelligence and communications audit — September 26, 2026

## Outcome

The product has considerably more than a basic chatbot underneath it: league snapshots, analyst tools, Decision OS packets, conversation persistence, privacy boundaries and advice tracking exist. The gap is consistent delivery of that intelligence through every entry point, with visible evidence and reliable chat continuity. This is the first audit and repair batch, not a declaration that the entire engine is complete or ready to charge for every answer.

The two supplied Word documents were read as historical handoff material. Their merge/deployment instructions were not executed. Several older claims are superseded by current code: trade activity tooling and draft persistence already exist. The working tree contained extensive unrelated changes; this work preserves them.

## Live Chrome coverage

| Feature | Observed result | Remaining coverage |
| --- | --- | --- |
| Communications bubble | Opens unified League, Chimmy, Huddle, DMs and Discord tabs | Reload/navigation stress test |
| Private Chimmy | Privacy notice and allowance displayed; dedicated chat returned an actual price answer | Paid allowance exhaustion, retries and model outages |
| Global price question | A bare dynasty value question returned league-derived 1QB/team-count settings while the UI showed Global / All leagues | Verify the local routing fix after release |
| League selection | Searchable league selector and empty message state loaded | Cross-league message delivery |
| DMs | Recipient search and disabled/enabled Start states exercised; no DM sent | Delivery, unread counts, access isolation |
| Huddle | Participant picker, privacy copy and initial disabled Start observed | Group creation and delivery |
| Discord | League selection showed an unconfigured bridge and setup link; two-way/private-DM boundary explained | OAuth, bridge setup, inbound/outbound sync, deduplication and retry |
| Emoji | Search returned football options; selection inserted the football emoji into the composer | Mobile focus and keyboard navigation |
| Mentions | Composer entry attempted; source and regression tests reviewed | Live member/player suggestions and actual private Chimmy response |
| GIF / poll / voice / photo / video / search / draft room | Controls observed; GIF action attempted | These are not verified end to end |

Repeated Chrome control calls timed out during mention/GIF/Discord inspection; recovery eventually returned `Debugger unattached`. This blocks full live coverage. It does not establish whether the site, extension or browser connection caused the timeout. No messages were sent to league-mates, no media was uploaded, and no Discord permissions or channels were changed. Only a routine private Chimmy question was submitted.

Restored chat history also displayed duplicate questions, old generic fallback outputs and raw deterministic-context wording. Those historical records are useful warning signs but are not new reproductions of current server behavior.

## Repairs in this batch

1. **Separate general prices from personal decisions.** Bare dynasty/redraft/market-price questions no longer require private league grounding. Explicit team/source context and personal decisions retain grounding requirements. Generic FantasyCalc pricing honors requested dynasty and superflex formats rather than silently defaulting to redraft 1QB. League-derived deterministic price answers now expose league-grounding metadata to the UI.
2. **Keep decision questions out of factual shortcuts.** Probability, odds, recommendations and trade-block questions yield before deterministic score/schedule/value shortcuts. These facts can support analysis but cannot substitute for it.
3. **Connect existing Decision OS evidence to the main tool loop.** The route already built a packet but the primary loop ignored it. Claude and Grok now receive it with league identity and missing-data limits, outside shared cached instructions. The existing feature flag and membership checks remain. This is evidence delivery, not proof of complete runtime authority enforcement.
4. **Retry history hydration after navigation cancellation.** A scope is marked hydrated only after a successful, non-cancelled fetch. Quickly leaving and returning to a chat can now retry instead of permanently suppressing history loading for that session.
5. **Prevent stale mention suggestions.** Autocomplete requests are aborted on scope/query changes and late responses are ignored. Older member/player results cannot overwrite the current search.
6. **Clear pending media when conversation scope changes.** Attachments, GIFs, polls and picker state reset on league/thread/chat type/account changes, avoiding accidental carryover into another chat. A delayed send failure cannot restore the old media into a different conversation; the sender is directed to reopen the previous conversation and re-enter the message and media. The release preserves the current production composer’s draft behavior.

These changes are local and have not been deployed. Production Chrome observations describe the deployed site, not the modified checkout.

## What must make Chimmy worth paying for

Current [FantasyPros MCP positioning](https://www.fantasypros.com/mcp/) distinguishes free facts from premium roster-synced advice; its [official tool inventory](https://support.fantasypros.com/hc/en-us/articles/55238312588571-What-tools-are-available-in-the-FantasyPros-MCP-Server) shows the breadth users can expect. The product implication is that generic chat and player prices alone are a weak subscription proposition. [Sleeper's notification documentation](https://support.sleeper.com/en/articles/1876026-how-do-notifications-work-on-sleeper) also establishes concrete chat behavior users expect. A recent [community complaint about ads in chats](https://www.reddit.com/r/SleeperApp/comments/1w14n70/sleeper_dont_place_ads_in_our_chats/) is one directional signal about preserving communication quality, not representative market research.

| Priority | Capability | User/business value | Effort and acceptance gate |
| --- | --- | --- | --- |
| P0 | One evidence and authority contract across bubble, full chat, private mentions and public league advice | Users trust the same answer regardless of entry point; commissioners and organizations can rely on consistent privacy | High. Recommendation output references the authorized engine result; missing inputs produce an actionable gap, never fabricated certainty |
| P0 | Complete chat/Discord delivery audit with two test accounts and a disposable bridge | Protects league community workflow and B2B confidence | Medium. Verify mentions, unread state, attachments, polls, bridge deduplication, membership removal and private/public boundaries |
| P0 | Billing tied to a useful completed answer | Makes token purchases defensible | Medium. Verify retries/idempotency, outage/no-answer behavior, confirmation and displayed remaining allowance |
| P1 | Decision cards for lineup, waiver and trade advice | Converts prose into an understandable decision | High. Show named league, settings, source time, alternatives, engine confidence and explicit missing data; measured outcomes link back to the original advice |
| P1 | Personalized proactive recommendations | Provides recurring value beyond asking questions | High. Opt-in actionable alerts tied to a roster change, injury or available improvement, with deduplication and current evidence |
| P1 | Commissioner and organization action workflows | Extends subscriptions beyond individual player research | High. Advice prepares a reviewable league action; permissions and confirmation precede consequential execution |

The private mention reply path still differs from the main analyst loop and has a narrower context. That deserves a shared authenticated service, rather than another independent prompt. Passing the Decision OS packet is only the first repair: output authority validation and behavioral evaluations are still required before claiming that every recommendation is engine-authorized.

## Validation

The expanded regression run covered 693 tests across 10 files: 692 passed and one source-wiring assertion failed because it required adjacent prompt fields. That assertion was updated to accommodate the evidence field and explicitly verify its wiring; all 69 tests in its rerun passed. Thus all 693 tests passed across the expanded run and corrected-file rerun. Earlier focused runs passed 587 tests and 84 tests respectively. The changed-file whitespace check passed.

Full TypeScript checking ran for more than ten minutes without diagnostics or completion and was stopped. A full typecheck/build is still required before release; no clean typecheck is claimed.

Added behavioral coverage includes market versus personal routing, dynasty/superflex defaults, analysis bypassing factual shortcuts, cancelled hydration retry, stale autocomplete responses and uncached Claude evidence delivery. Both pending-media scope tests passed, including a delayed send failure; the companion mention-composer tests also passed (five tests in that final run). Across the expanded suite, corrected-file rerun and added media tests, all 695 distinct tests passed. Live media validation remains outstanding.
