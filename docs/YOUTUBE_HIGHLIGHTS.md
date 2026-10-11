# NFL highlights

The shared /core player card offers Find highlights below Latest. My Team offers
My Team Highlights with full roster, starters and bench filters. Discovery is on demand.
Videos open their original YouTube watch pages in a new tab; no iframe is loaded.

## Hosted playback decision

On October 11, 2026, the actual player-card component was deployed to
https://highlights-preview-highlights-preview.up.railway.app with public NFL metadata
(other card data was explicitly marked as fixtures). Deployment
95495875-4c83-4ad0-a643-931f1d597e39 succeeded. The NFL's Christian Watson clip
rmTuH0nGkBc reported embeddable=true in the API, but the hosted player stated:
"NFL, who has blocked it from display on this website or application".
The original YouTube watch link opened successfully, and playback advanced from
0:00 to 0:14 of the 18-second clip. The feature therefore uses watch links instead of
shipping the failed embedded experience. Publisher availability can still change.

## Configuration and quota

YOUTUBE_API_KEY is server-only, restricted to YouTube Data API v3; no OAuth,
new dependency, schema migration, worker or video storage is needed. Credentials
travel in X-Goog-Api-Key, never query strings or client bundles.

The provider resolves @NFL and caches its official channel/uploads playlist for 24h.
It reads up to 100 recent uploads, verifies channel ownership, public/processed status,
embeddability, non-live status and publication within 30 days. Region-restricted videos
are excluded conservatively. Original title, channel and publish date remain visible.

The common catalog uses existing SportsDataCache with a 15-minute TTL, process memory
and an in-flight promise. Four list calls typically refresh a warm channel cache;
there are no search calls per player. Provider failures have a 60-second cooldown.
The existing hourly reap-sync-runs cron purges expired api: cache entries.

Player matching requires a full name in a highlight/play title. Recaps require
mascot + vs + highlights and are explicitly labeled as team context. This bounded
catalog does not guarantee every player or every game has a clip.

## API and privacy

GET /api/core/player-card/highlights accepts sport and externalId or sleeperId.
Names and teams come from canonical SportsPlayer rows, never caller search strings.
The public metadata route is limited to 30 requests/minute/IP.

POST /api/core/my-team/highlights requires a signed-in session and at most 60 playerIds.
The client takes IDs from the existing authorized My Team roster snapshot. The route
looks up only public NFL identities, reads no league/other user's roster, stores no
roster, shares the same catalog and deduplicates clips with related-player attribution.
Responses are private/no-store and limited to 10 requests/minute/user/IP. Client filters
reuse the result without provider calls. Switching roster or league aborts discovery
and clears old results. Empty and failed states are explicit and retryable.

Privacy and Terms disclose YouTube API Services, thumbnails, external watch links,
Google's privacy policy and YouTube's terms. Only the revised Privacy/Terms stamps
change; other documents retain their existing effective dates.

## Validation

Targeted tests cover matching, source/status filtering, one shared provider fetch,
canonical identities, authentication, limits, duplicate recaps, click-to-discover,
watch links, roster filtering and abort/reset behavior. Run the player-highlights*
and team-highlights* tests plus player-card and My Team regressions. The hosted
fixture preview proves component rendering/link playback, not production API/database
integration; production health and API responses must also be checked after release.
