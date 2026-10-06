# Team delivery and AutoSubs acceptance release

League injury/deadline alerts and verified native AutoSubs receipts now record per-channel storage, suppression, provider acceptance, partial push acceptance and failure in the existing automation audit. The owner can see recent delivery attempts inside the league alert panel; native AutoSubs includes the associated notification receipt. Reads use session identity, canonical league membership or roster ownership, and private no-store responses. Provider identifiers, addresses, credentials and raw provider content are never returned in these receipts.

Email/SMS delivery is reconciled with read-only provider lookups: at most two lookups per sweep, a three-second admission window with 1.5-second request timeouts, a 15-minute cooldown and a 48-hour horizon. A compare-and-swap claims each check before fetching. A restricted or unavailable provider API leaves verification explicitly unavailable. Email delivery means recipient-server acceptance; SMS delivery means the carrier report. Push service acceptance does not prove on-device display or reading. No automatic resend or new cron schedule is introduced.

Native AutoSubs now has a read-only owner preview and explicit off, paused, waiting and eligible explanations in English/Spanish. Eligibility gates are shared with execution: current bench membership/slot eligibility, trusted status freshness, confirmed inactivity, available backup and known unlocked games. Manual lineup changes, disabled commissioner policy, owner opt-out, league move locks and elimination have explicit explanations. Preview reads submit no lineup; execution still rechecks authorization and locks inside the existing atomic transaction.

Verification results will be recorded after test and browser acceptance completion. Physical-device and signed-in production acceptance are separate from local synthetic-account emulation; see team-device-acceptance-2026-10-06.md.

Research: https://resend.com/docs/api-reference/emails/retrieve-email documents last_event; https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ documents installed Home Screen web-app push requirements.
