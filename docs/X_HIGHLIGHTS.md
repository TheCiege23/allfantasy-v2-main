# X roster clips pilot

Player cards show recent caption matches. My Team combines its NFL roster. The Core My Leagues card shows one recent match per claimed league (up to five visible leagues), merging shared posts into one card with multiple league badges. Existing YouTube recaps remain available.

## Credentials and operation
- Server only: X_BEARER_TOKEN (or X_HIGHLIGHTS_BEARER_TOKEN), X_HIGHLIGHTS_ENABLED=true. Configure both the web service and the cron worker. The worker can reference the web credential with Railway service-variable references; do not duplicate the secret in source or documentation.
- X OAuth publishing settings, xAI/Grok keys and RapidAPI credentials are not substitutes for an official X read bearer token.
- X_HIGHLIGHTS_DAILY_REQUEST_LIMIT defaults to 24 (allowed 1–100).
- GET/POST /api/cron/import-news?clips=1 uses the existing CRON_SECRET authentication helper for manual clip-only refreshes. The established hourly full-news pass refreshes clips with failure isolation; no new cron slot is added.
- At most one shared recent-search request per UTC hour, ten results per request, no pagination or automatic retries. No spending occurs on page loads. Failed attempts consume a reservation.
- A serializable SportsDataCache transaction reserves quota before calling X. Database failure prevents the paid call. Disable the flag to halt ingestion and hide the UI.
- Request caps are not currency caps. Configure an additional spending limit in the X developer console. User/media expansions may affect provider billing.
- Catalog stores only public IDs, captions, accounts, timestamps and a caption-based category. No raw video URLs or credentials. Posts are shown for at most 24 hours; deleted/unavailable embeds retain a Watch on X fallback until they age out.
- This is an hourly pilot, not an instant or exhaustive play feed: busy source accounts can publish more than ten videos between searches.

## Identity and privacy
A full canonical NFL player name, or a manually reviewed handle, must occur in the caption. No surname-only, fuzzy, team-only or inferred-handle matching. Matching a mention does not verify who is visible in the video. Interviews/commentary are labeled separately from plays; labels are caption heuristics, not human verification.

Roster and league membership are joined inside AllFantasy. Only a fixed allowlist of public sports accounts is sent to X. League requests read only the signed-in user's claimed teams and use the existing provider-to-Sleeper crosswalk. Unmapped foreign IDs are skipped. Responses are private/no-store and authenticated/rate limited.

The client shows original captions as plain text, with source and date. It loads official X widgets only after the user clicks Load X post, with dnt=true and no autoplay. Publisher restrictions may require Watch on X. No media scraping, downloads, rehosting or automated messages.

## Rollout and next measurement
Verify player, team and league views on the hosted fixture preview; fixture roster labels must remain explicit. Require passing CI before rollout. Set configuration with skipDeploys=true before the release builds so it becomes active with the successful releases. Verify both the web deployment and the worker deployment: the scheduler targets allfantasy-v2-worker, which tracks worker-release and normally advances daily. For this rollout, run the existing Advance worker-release workflow after the web release, once the previous worker build is finished. Trigger one authenticated clip-only refresh and verify the catalog and personalized UI; check the worker with the same clip-only route so the next hourly pass can refresh the shared catalog. Track discovery, load-post clicks, source fallbacks, and game-day return visits before adding notifications. Do not count an embed load as successful video playback.

Sources: https://docs.x.com/x-api/posts/search-recent-posts and https://help.x.com/en/using-x/how-to-embed-a-post .


## Engagement report
Open `/admin#highlight-analytics` and expand **Highlight Engagement**. The admin-only, private/no-store `/api/admin/highlight-analytics` endpoint reports a rolling 28-day window. No new vendor SDK, provider call, migration, scheduler, or notification is required.

The `engagement.highlights.*` vocabulary contains `surface_view`, `load_requested`, `embed_ready`, `embed_error`, and `source_open`. An exposure is the section header at least 50% visible continuously for one second while the document is visible, or an explicit clip action. Offscreen, unfinished, aborted, and disabled requests do not count. Empty, unavailable, and request-error states do count when visible. Filtering does not create a new exposure; changing the player/roster/league request or retrying creates a new mounted request. Browsers without IntersectionObserver record explicit actions only.

Metadata is restricted server-side to surface, random per-mount view UUID, availability/count/visibility for exposures, and caption category for actions. Post IDs, captions, player names/IDs, league names/IDs, roster membership, raw URLs, and client-supplied identities are rejected or discarded. Authentication supplies user identity for aggregate return reporting. The report returns no individual records. Client events are observational and may be blocked, duplicated, or lost: aggregates deduplicate exposure UUIDs and count actions as exposures containing the action. A user can count in more than one surface; do not sum surface user counts.

Availability is exposures with clips / all exposures. Load intent is exposures with a load action / exposures with clips. Embed ready is exposures with at least one ready result / exposures with a load action; a single exposure may contain both ready and failed clips. These are not per-video rates. X rendering does not establish playback, watch duration, or completion. Those metrics remain unavailable. Some publishers require Watch on X, as described in X's [embedding guidance](https://help.x.com/en/using-x/how-to-embed-a-post).

Seven-day game-day return uses each authenticated user's first observed highlight exposure **within the report window**, not their lifetime first exposure. Only cohorts with seven full 24-hour days of follow-up enter the denominator. A return is another highlight exposure on a later America/New_York date within seven days that has an NFL game in stored SportsGame start times. Cancelled/postponed rows are excluded; all scheduled weekdays qualify. UTC timestamp-without-time-zone columns are converted explicitly to ET. This measures return to highlight sections, not all app visits; missing/stale game rows and blocked beacons can undercount or misclassify. With no game dates, no observations, or no mature cohort, rates are null with an explicit status, not fabricated 0%. No causal retention claim or alerts decision should be made from this observational sample alone.

Before adding opt-in alerts, inspect availability and failures by surface, then collect at least two full weeks with mature cohorts and report the sample size. If coverage is sparse, improve discovery/matching first. If coverage and usage are healthy, design a controlled, opt-in alert experiment and measure incremental returns; don't treat raw return rate as uplift.

Validation: `scripts/verify-highlight-report-fixtures.ts` runs SELECT-only synthetic PostgreSQL fixtures inside a READ ONLY transaction. It shadows both table names with CTEs and covers ET midnight, Monday/Thursday games, mature cohorts, duplicate deliveries, anonymous/wrong-tool exclusion, orphan actions, and cancelled/postponed games. It never reads or writes application rows.
