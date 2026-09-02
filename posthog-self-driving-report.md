# PostHog Self-driving setup report

_Last updated 2026-08-31 (this run)_

## Summary

PostHog Self-driving is fully configured for AllFantasy. All three products (Session Replay, Error Tracking, Support) were already enabled; six native signal sources and the GitHub integration were already in place. This run connected **GitHub Issues** as a warehouse source, disabled the idle feature-flags scout (0 active flags), created a custom **waiver-wire** scout, and updated the two Replay Vision scanners with expanded query coverage and product-specific vocabulary. Findings will start appearing at [https://us.posthog.com/project/586899/inbox](https://us.posthog.com/project/586899/inbox) within ~30 minutes.

---

## AI data processing

**Approved.** Organization-level AI data processing consent was granted before this run.

---

## GitHub

**Already connected** (integration ID 260664, TheCiege23, connected 2026-08-31 at 14:13 UTC). Self-driving can research findings against the `TheCiege23/allfantasy-v2-main` repository and open draft PRs for fixable issues.

---

## Products enabled (step 3b)

| Product | Action | Notes |
|---|---|---|
| Session Replay | **already enabled** | `posthog.init` has no `disable_session_recording` override — server flip effective |
| Error Tracking | **already enabled** | `posthog.init` has `capture_exceptions: true` — client and server both active |
| Support (Conversations) | **already enabled** | Tickets reach the inbox only once an inbound channel is connected — see Follow-ups |

---

## Signal sources (step 4)

All native sources were already enabled before this run. No writes were needed.

| source_product | source_type | Action | Notes |
|---|---|---|---|
| `signals_scout` | `cross_source_issue` | **on by default** | Scout gate is always on; no config row needed |
| `health_checks` | `health_issue` | **already enabled** | id: 01a0582c-b1e6-7efc-8468-ef5f60459908 |
| `error_tracking` | `issue_created` | **already enabled** | id: 01a0582c-b7b7-760f-a1ef-1fded531128a |
| `error_tracking` | `issue_reopened` | **already enabled** | id: 01a0582c-b9e7-7c6f-ab91-5b668399fefd |
| `error_tracking` | `issue_spiking` | **already enabled** | id: 01a0582c-bcdc-730c-bf70-27e10f69854f |
| `session_replay` | `session_analysis_cluster` | **already enabled** | id: 01a0582c-c2a4-75af-8761-b905e403cf74 |
| `conversations` | `ticket` | **already enabled** | id: 01a0582c-c525-7292-b8a9-7649143be442; dormant until a support channel is connected |
| `github` | `issue` | **enabled this run** | id: 01a05876-5e0e-7499-9a66-ac4c3266f77d; feeds issues from TheCiege23/allfantasy-v2-main |
| `llm_analytics` | — | **skipped** | Internal-only responder |
| `logs` | — | **skipped** | Not a v1 responder |
| `replay_vision` | — | **skipped** | Self-authorizing via `emits_signals` on each scanner (step 6c) |

---

## Connected tools (step 5)

| Tool | Class | Notes |
|---|---|---|
| **GitHub Issues** | **Connected by this run** | Warehouse source id: 01a05876-406f-0000-9b55-a2b7a667f965; syncing `issues` table from `TheCiege23/allfantasy-v2-main`; first sync started automatically. Additional tables (PRs, releases) can be enabled in the PostHog data warehouse UI. |
| Sentry | **not used** | Detected in package.json but not selected |
| Linear, Jira, Zendesk | **not used** | Not selected |

---

## Scout troop (step 6)

**Run budget:** 100 runs/day (max 3 per tick), 5 used today.  
_Banner: "Scouts are in early access. Each project gets up to 100 scout runs a day. Contact team-self-driving@posthog.com if you need more."_

### Enabled (5 scouts — 4 built-in + 1 custom)

| Scout | What it watches |
|---|---|
| `signals-scout-general` | Cross-product correlations and any surface the specialists don't cover |
| `signals-scout-ai-observability` | LLM traces (Anthropic + OpenAI SDKs confirmed) for cost, latency, and error regressions |
| `signals-scout-product-analytics` | Funnels, retention, lifecycle, and stickiness flows for conversion regressions |
| `signals-scout-revenue-analytics` | Stripe sync health and revenue goal tracking — Stripe SDK confirmed in package.json |
| `signals-scout-waiver-wire` *(custom, created this run)* | `waiver_claim_submitted` event — weekly cliff in distinct users claiming = broken flow signal |

### Disabled (23 scouts)

| Scout | Reason disabled |
|---|---|
| `signals-scout-error-tracking` | Covered by native error tracking source — would duplicate |
| `signals-scout-session-replay` | Covered by native session replay source — would duplicate |
| `signals-scout-feature-flags` | **Disabled this run** — 0 active feature flags; re-enable when flags are in active use |
| `signals-scout-surveys` | No surveys in use. Re-enable if surveys are added |
| `signals-scout-web-analytics` | No UTM/referrer tracking confirmed active. Re-enable if web analytics is wired up |
| `signals-scout-experiments` | No active A/B experiments. Re-enable when experiments start |
| `signals-scout-logs` | PostHog logs product not in use |
| `signals-scout-csp-violations` | No CSP reporting configured |
| `signals-scout-customer-analytics` | No group/accounts analytics confirmed |
| `signals-scout-data-pipelines` | No CDP destinations or hog flows confirmed |
| `signals-scout-data-warehouse` | No additional warehouse imports active beyond GitHub Issues |
| `signals-scout-anomaly-detection` | Not needed alongside current specialist set |
| `signals-scout-replay-vision` | No accumulated scanner observations yet — enable once Replay Vision has history |
| `signals-scout-inbox-validation` | Fresh setup — no shipped fixes to validate yet |
| `signals-scout-observability-gaps` | Covered by general scout on a fresh project |
| `signals-scout-health-checks` | Covered by health_checks native source |
| `signals-scout-conversations` | Support just enabled — no ticket data yet |
| `signals-scout-apm` | No OpenTelemetry spans confirmed |
| `signals-scout-mcp-tool-calls` | No `$mcp_tool_call` events confirmed |
| `signals-scout-insight-alerts` | No configured insight alerts yet |
| `signals-scout-tasks` | No PostHog Tasks workflow in use |
| `signals-scout-skills-store` | Not needed for this product setup |
| `signals-scout-web-vitals` | Re-enable once `$web_vitals` events appear in the event stream |

---

## Custom scouts (step 6b)

**Gap analysis performed against confirmed instrumented events:** `waiver_claim_submitted`, `user_signed_up`, `user_logged_in`.

| Candidate surface | Outcome |
|---|---|
| **Waiver wire claim cliff** (`waiver_claim_submitted`) | **Created** — `signals-scout-waiver-wire` |
| Signup health (`user_signed_up`) | Proposed; declined this run — revisit once baseline data exists |
| League import funnel | Ruled out: no named import PostHog events found in codebase |
| Fantasy OS sync health | Ruled out: no `posthog.capture` calls in the sync pipeline |
| LLM generation quality | Already covered by `signals-scout-ai-observability` |

**`signals-scout-waiver-wire` — created this run**

- **Surface:** `waiver_claim_submitted` event — the weekly waiver wire claim flow unique to this fantasy sports product
- **Discriminator:** cliff in *distinct users* submitting claims (≥ 40% week-over-week), not raw count — one user going quiet is noise; ten users going silent is the finding
- **Why not covered by built-ins:** no built-in scout watches domain-specific fantasy events; `signals-scout-product-analytics` covers saved funnels, which this point event is not
- **Explore patterns:** weekly distinct-user comparison, hourly density (detects mid-week silence), user-level distribution breakdown
- **Disqualifiers:** NFL offseason low-volume months, early-week waiver deadline gaps, single-user drops

**Noise escape hatch:** set `emit: false` on any scout's config in PostHog to switch it to dry-run — it keeps running and logging without writing to the inbox.

---

## Replay Vision scanners (step 6c)

Replay Vision scanners are LLMs that watch individual session recordings on a schedule and push what they find directly to the Self-driving inbox. Findings arrive at half weight; two independent corroborating findings are needed before a report is promoted. This is the only part of this setup that spends Replay Vision quota. No recordings existed at setup time — both scanners are armed and start working the day recordings arrive.

Both scanners existed from a prior run and were **updated in place** this run with improved product vocabulary and an expanded query scope.

| Scanner | Type | Query scope | Sampling rate | Credits est./month | Status |
|---|---|---|---|---|---|
| AllFantasy import and waiver breakage | monitor | `$current_url` regex `/(import\|waiver-wire\|commissioner-hub)` | 0.5 | 0 (no recordings yet) | **updated (v2)** |
| AllFantasy user frustration | monitor | `$rageclick` events (whole product) | 1.0 | 0 (no recordings yet) | **updated (v2)** |

**Breakage monitor:** Scoped to three URL patterns covering AllFantasy's key completion flows — the league import wizard (`/import`), waiver wire submission (`/waiver-wire`), and commissioner hub (`/commissioner-hub`). This run expanded the prior scanner's `/import`-only scope to all three. Watches for: import wizard stalls, OAuth steps doing nothing, import confirming success but league never appearing, waiver player list failures, and commissioner actions with no visible result.

**Frustration monitor:** Gated on `$rageclick` across the whole product (no URL scope, per the disjointness rule). Watches for: hammering the Connect League button, retrying platform OAuth, waiver claim submit with no feedback, hunting for leagues after multi-platform import, and commissioner controls that appear interactive but produce no change.

---

## Follow-ups

- [ ] **Connect a support channel** — Conversations is enabled but the `conversations/ticket` source is dormant until an inbound channel (email, inbox, or Slack) is connected in PostHog → [Integrations settings](https://us.posthog.com/project/586899/settings/environment-integrations)
- [ ] **Instrument LLM calls with `$ai_*` events** — `signals-scout-ai-observability` is enabled; wire Anthropic and OpenAI calls through PostHog's LLM observability wrapper or emit `$ai_generation` events so the scout has traces to watch
- [ ] **Connect Stripe revenue data** — `signals-scout-revenue-analytics` is enabled; connect a Stripe warehouse source or capture revenue events so the scout has data → [New data source](https://us.posthog.com/project/586899/pipeline/new/source)
- [ ] **Enable `signals-scout-feature-flags`** in PostHog when feature flags are in active use → [Inbox settings](https://us.posthog.com/project/586899/inbox)
- [ ] **Enable `signals-scout-experiments`** when A/B experiments start running
- [ ] **Enable `signals-scout-replay-vision`** once Replay Vision scanners have accumulated enough observations for trend analysis
- [ ] **Add more GitHub Issues sync tables** (PRs, releases) in the PostHog data warehouse UI if needed — only the `issues` table is syncing now
- [ ] **Revisit `signals-scout-signup-health`** — proposed this run but declined; add once `user_signed_up` baseline data is established

---

## What happens next

- The scout coordinator picks up fresh configs within ~30 minutes and fires the first runs
- Each scout run draws from the project's **100-run daily budget** (early access default)
- Findings cluster into reports in the [Self-driving inbox](https://us.posthog.com/project/586899/inbox)
- Immediately-actionable reports can auto-start a coding task — Self-driving opens a draft PR for each fix it judges automatable ($15 each, your review required before merge)
- Replay Vision scanners start running the moment the first session recordings arrive
