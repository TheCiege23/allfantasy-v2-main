# Production Deployment Findings (Phase 24)

**Status: real evidence gathered from the live production site. Inconclusive on the specific instance-sharing question — disclosed honestly, not papered over.**

## Available evidence tiers, and what was actually used

Per Phase 23 and this phase's own instruction to use "the best available evidence" and distinguish observed/inferred/unknown:

| Tier | Available this phase? |
|---|---|
| Vercel MCP deployment/function inspection | **No** — connector not authorized in this session (`plugin:vercel:vercel` requires interactive OAuth, unavailable in this non-interactive context) |
| Vercel CLI | **No** — not installed in this environment |
| New preview deployment of the Phase 21-24 branch | **Not attempted** — deploying code (even to preview) is a real, consequential action; this session has neither the tooling (no CLI/MCP) nor was it asked to push/deploy this uncommitted branch |
| **Real production site, read-only public HTTP requests** | **Yes — used** |
| Local `next build`/`next start` (Phase 23) | Yes — already used in Phase 23, referenced here for context |

## Observed: real production site evidence

The project's own `.env` file defines the real production URL (`NEXT_PUBLIC_APP_URL=https://www.allfantasy.ai`) — not guessed, taken directly from this repo's own configuration. Made safe, read-only `GET`/`HEAD` requests to two of the guarded routes (`player-search`, `player-detail`) — ordinary public traffic, no mutation, no flag changes, no load.

**Observed facts** (both routes, multiple requests):
- Both routes are live, respond correctly (200/404 as expected for the test inputs used).
- `Server: Vercel` confirms real Vercel-hosted deployment.
- `X-Vercel-Id` present on every response, format `iad1::iad1::<token>-<timestamp>-<hash>` — both routes resolved to region **`iad1`** (US East) consistently across all requests.

**Observed and important**: the `<token>` segment of `X-Vercel-Id` was **different on every single request**, including 3 rapid-succession requests to the exact same route (`sm7b9`, `n5rzg`, `6hjd4`). This proves `X-Vercel-Id` is a **per-request trace identifier**, not a stable function/instance identifier — it cannot be used to determine whether two requests (same route or different routes) were served by the same underlying process or function instance.

## Conclusion: the specific instance-sharing question remains unresolved by direct observation

This is stated plainly rather than glossed over: **the safe, available evidence-gathering method (public header inspection) was inconclusive for the specific "does one process serve both routes" question.** Answering it definitively would require either (a) live Vercel deployment/function configuration data (blocked — no MCP/CLI access), or (b) deploying the Phase 21-24 branch's own `coordinatorInstanceId` instrumentation to a real Vercel environment and comparing values across routes (not attempted — a real deploy action outside this phase's authority to take unprompted).

## What IS known, stated precisely

- **Observed**: real production deployment exists, is healthy, both relevant routes are live, both in the same Vercel region (`iad1`).
- **Observed (Phase 23)**: the coordinator's dedup/cooldown logic is 100% correct wherever it runs in a shared process (real `next build`/`next start` test, `coordinatorInstanceId` matched across routes).
- **Unknown**: whether Vercel's actual production topology places `player-search` and `player-detail` (and the other guarded routes) in a shared process or separate ones.
- **Inferred, not observed**: Vercel's standard, documented Next.js deployment behavior typically creates per-route serverless functions by default — cited as informed platform-architecture reasoning, not measured this phase, consistent with Phase 23's own labeling discipline.

## Why this does not block a readiness decision

See [`FANTASY_OS_PRODUCTION_READINESS_REPORT.md`](FANTASY_OS_PRODUCTION_READINESS_REPORT.md) for the full reasoning: the unresolved topology question does not affect the guardrail's primary, already-proven goal (customers never wait for the importer), and its worst-case consequence if unresolved unfavorably is bounded, non-customer-facing resource amplification — not a correctness or safety failure. The honest epistemic state here (real uncertainty, clearly labeled) is exactly what supports monitored production enablement as the appropriate next validation step, rather than continuing to search for certainty through means this session doesn't have access to.
