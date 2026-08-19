# Rolling Insights API Contract — READ THIS FIRST

## Purpose: stop re-probing the API

This directory is the **single source of truth** for the Rolling Insights DataFeeds API.

> ### 🛑 Rule for all agents and developers
>
> **Never call the Rolling Insights API to find out what an endpoint returns.**
>
> The endpoint surface is in `ENDPOINTS.yaml`. Real captured response bodies are in `fixtures/`.
> If the answer isn't in those two places, it is a **gap to be recorded**, not a reason to probe live.
>
> Probing is allowed **only** via `scripts/probe.sh`, and only when adding a *new* endpoint/sport
> combination — and the result must be committed to `fixtures/` in the same change.

### Why this exists

Live probing to rediscover response shapes is slow, burns quota, leaks the token into logs, and —
worst — produces *different* answers on different days depending on whether games are in progress.
An endpoint that returns `data.NFL: []` on a Tuesday looks broken but isn't. That ambiguity is what
makes agents re-check endlessly.

A committed contract plus committed fixtures removes the ambiguity permanently.

---

## Files

| File | What it is | Authority |
|---|---|---|
| `ENDPOINTS.yaml` | Endpoint × sport registry, params, envelope rules, quirks | **Normative** |
| `fixtures/` | Real captured responses, one per endpoint × sport | **Normative for shape** |
| `INTEGRATION.md` | DB-first architecture, polling, event detection | Design |
| `schema.sql` | Database DDL | Normative |
| `scripts/probe.sh` | One-time fixture capture. Not for runtime. | Tooling |
| `GAPS.md` | Known-unknowns. Append here instead of probing. | Living |

---

## Add this to your root `CLAUDE.md`

```markdown
## Rolling Insights API

The API contract is committed at `contracts/rolling-insights/`.

- **Do not call the Rolling Insights API to determine response shape.**
  Read `contracts/rolling-insights/ENDPOINTS.yaml` and `contracts/rolling-insights/fixtures/`.
- Unknowns are listed in `contracts/rolling-insights/GAPS.md`. If you need something not
  covered, append to GAPS.md and ask — do not probe.
- The app **never** calls Rolling Insights directly. Only the ingestion worker does.
  Application code reads from Postgres. See `INTEGRATION.md` §3.
- `RSC_token` is a secret. It must never appear in logs, error messages, or client
  responses. Redact it in every HTTP logger.
```

---

## The five facts that break naive implementations

1. **`304` is a bug, not a cache hit.** Send cache-busting headers and a fresh `&_=` timestamp on
   every live call. Treat 304 as retry-once. (Vendor's own guidance — see `ENDPOINTS.yaml`.)
2. **Soccer's response key is the league, not the sport.** You request `/live/{date}/SOCCER?league=EPL`
   and parse `data.EPL`. Not `data.SOCCER`. This is the single highest-risk parsing trap in the API.
3. **Play-by-play exists for MLB, NBA, NFL only.** Not NHL. Not NCAAFB. Not NCAABB.
4. **No injuries or depth charts for NCAAFB, NCAABB, SOCCER, DARTS, PGA.**
5. **Stat corrections re-run for ~12 hours after a game ends.** Final is not final at the whistle.
   Ingestion must include a reconcile pass.

---

## Provenance

Derived from:
- Vendor Notion docs (index: `DataFeeds-by-Rolling-Insights-API-Developer-Documentation-a2570205b6324bd9869c38860b1e5634`)
- Vendor's official agent-skill repo, **`production` branch**:
  `github.com/Rolling-Insights/sports-datafeeds-by-rolling-insights-skill`
- Vendor pricing and ToS pages

⚠️ **The skill repo is a more accurate integration reference than the Notion pages**, which contain
stale `http://` URLs and 2019-era sample payloads. Pin the `production` branch when re-checking.
