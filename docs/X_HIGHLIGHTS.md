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

