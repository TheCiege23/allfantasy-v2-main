# ESPN Site API Contract — READ THIS FIRST

> ### 🛑 Rule for all agents and developers
>
> **Never call the ESPN API to find out what an endpoint returns.**
>
> The endpoint surface is in `ENDPOINTS.yaml`. Real captured response bodies are in `fixtures/`.
> If the answer isn't in those two places, it is a **gap to be recorded** in `GAPS.md`, not a
> reason to probe live.
>
> Probing is allowed **only** via `scripts/probe.sh`, and only when adding a *new*
> endpoint/sport combination — and the result must be committed to `fixtures/` in the same
> change. An uncommitted probe gets repeated.

## Why this exists

ESPN publishes **no API, no documentation and no rate limits**. The host has already moved once
under us (`site.api.espn.com` → `site.web.api.espn.com`, 2026-08-22, Akamai 403 on every path —
see `lib/providers/espnUrls.ts`). An undocumented surface that changes without notice is exactly
where committed fixtures pay off: they record what it returned on a known date, so nobody has to
guess or re-ask.

This contract was started for **college basketball headshots** — the one sport with no roster
source that carries images (Rolling Insights sends none; TheSportsDB has no NCAAB rosters). Its
scope is deliberately narrow: two endpoints, one sport.

## Scope — what this contract does NOT cover

ESPN is already called from many places that predate this contract and are not described here:
injuries (`lib/injuries/espnInjuries.ts`), standings (`lib/standings/espnStandings.ts`), scores
(`lib/scores/gameScoreProviders.ts`, `lib/sports-live-scores-service.ts`), news, NFL rosters
(`lib/espn-data.ts`), NFL athlete identities (`lib/espn/`). Bringing any of them under contract
means probing and committing a fixture for it — not copying shapes out of that code.

## Owner decisions (2026-10-01)

- ESPN headshots may be hotlinked for NCAAB, on the same basis as college football (`GAPS.md` E-05).
- Phase 2 attaches photos only to existing Rolling Insights rows matched on school + name + jersey;
  it creates no ESPN-sourced player rows (`GAPS.md` E-06).

## Rules specific to ESPN

- **No credential exists.** Send `Accept: application/json` and nothing that imitates a browser.
- 🛑 **A 403 is a stop, not a puzzle.** Record it in `GAPS.md`. Spoofing bot detection
  circumvents a control ESPN put up on purpose.
- Build URLs from `ESPN_SITE_API_BASE` in `lib/providers/espnUrls.ts`, never a literal. The
  DB-first guard tracks that identifier (`DATA_API_IDENTIFIERS`), so a runtime call must live in
  an ingestion module or an allowlisted adapter.
- Headshot CDN URLs (`a.espncdn.com`) are images, not data; the guard does not monitor them.

## Files

| File | What it is | Authority |
|---|---|---|
| `ENDPOINTS.yaml` | Endpoint × sport registry, params, envelope, measured counts | **Normative** |
| `fixtures/` | Real captured responses | **Normative for shape** |
| `scripts/probe.sh` | One-time fixture capture. Not for runtime. | Tooling |
| `GAPS.md` | Known-unknowns, and measurements against our own data | Living |

Large captures are trimmed with `contracts/fleaflicker/scripts/trim-fixture.mjs` (key-union
cover; refuses to drop a key path) rather than a second copy of that tool.

## Three facts that break a naive implementation

1. **`headshot` is omitted, not null,** when there is no photo — and the derived CDN URL then
   404s with a 1-byte HTML body. Check content-type and size, never status alone.
2. **`jersey` is a string;** our `SportsPlayer.number` is an int.
3. **Rolling Insights NCAAB `ACT` is not "current roster"** (`GAPS.md` M-01). Match ESPN athletes
   against RI rows on the same school by name AND jersey — never by name alone, never across
   schools — or a former player's row inherits a current player's face.
