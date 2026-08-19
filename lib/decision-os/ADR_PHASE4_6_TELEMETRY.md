# ADR Phase 4.6 — Stage 1 Telemetry Dashboard + Alerts

**Date:** 2026-06-30
**Status:** Accepted
**Author:** TheCiege23
**Phase:** 4.6 — Observability (prerequisite for any Stage 1 production flag)

---

## Context

All four Decision OS slices (Commissioner / Trade / Waiver / Lineup) are Stage 1-ready with kill
switches (`DECISION_OS_{SLICE}_LIVE=true`). Before any kill switch is enabled in production, the
team must be able to observe whether Decision OS is operating safely — specifically:

- Are shadow parity checks passing or failing?
- Is the enrichment path working (decisionOs field present in responses)?
- What is the latency overhead?
- Is the shadow error rate within bounds?

Without this observability, there is no safe way to evaluate the 7-day soak criteria defined in
`ADR_PHASE4_5_STAGE1_ACTIVATION_READINESS.md`.

---

## Changes Made

### 1. Fixed Production Telemetry Blackhole (`lib/decision-os/core/telemetry.ts`)

**Before:**
```ts
else if (process.env.NODE_ENV !== 'production') console.debug('[decision-os]', JSON.stringify(payload))
```

**After:**
```ts
else console.log('[decision-os]', JSON.stringify(payload))
```

**Problem:** `console.debug` is dropped by Vercel in production (`NODE_ENV=production`). Additionally,
the env guard explicitly skipped production. All Decision OS telemetry was silently dropped in prod.

**Fix:** `console.log` is captured by Vercel's log drain in all environments. The `[decision-os]`
prefix makes every event filterable in log queries. The sink path (test/infra) is unchanged.

### 2. Added `decision.live_enrichment` Event Type

Added to `DecisionTelemetryEventName` union and `emitLiveTelemetry` function in
`lib/decision-os/core/parity/telemetry.ts`. Emitted by each Stage 1 LIVE block with:

```ts
{
  event: 'decision.live_enrichment',
  decision_type: 'lineup.set' | 'waiver.claim' | 'trade.value' | 'commissioner.league.health',
  decision_id?: string,   // present when enriched=true
  flags: {
    enriched: boolean,    // true = decisionOs was added to the response
    reason?: string,      // 'shadow_no_result' | 'exception' (when enriched=false)
    latency_ms: number,   // wall-clock time for the entire LIVE path
    leagueId?: string,    // present for waiver/lineup/trade
    source?: string,      // lineup only: 'redraft_native' | 'canonical_world'
    // commissioner batch summary only:
    enriched_count?: number,
    total_db_source?: number,
  },
  at: string              // ISO timestamp
}
```

### 3. Wired Timing + Telemetry to All 4 LIVE Blocks

Each LIVE block now:
1. Captures `liveStart = Date.now()` before the shadow call
2. Emits `decision.live_enrichment` with `enriched: true + latency_ms + decisionId` on success
3. Emits `decision.live_enrichment` with `enriched: false + reason + latency_ms` on no-result or exception

Commissioner hub (batch pattern) additionally:
1. Accumulates `enrichedCount` across the `Promise.all` map
2. Emits a single summary event after the `Promise.all` with `enriched_count` and `total_db_source`

### 4. Gate-Check Script (`scripts/decision-os-telemetry-gate.ts`)

Reads `[decision-os]` JSON events from stdin, evaluates parity gate thresholds, exits 0 (PASS)
or 1 (BLOCKED). Handles both plain log lines and Vercel log drain JSON format.

```sh
# From Vercel CLI:
vercel logs --json | npx tsx scripts/decision-os-telemetry-gate.ts

# From saved export:
cat logs.txt | npx tsx scripts/decision-os-telemetry-gate.ts
```

---

## Event Taxonomy

Every `[decision-os]` log line is a single JSON object with this structure:

```json
{
  "event": "decision.shadow_parity",
  "decision_type": "lineup.set",
  "decision_id": "do_abc123",
  "flags": { "parity_passed": true, "diffs": 0 },
  "at": "2026-06-30T12:00:00.000Z"
}
```

### Event names

| Event | When emitted | Key flags |
|-------|-------------|-----------|
| `decision.shadow_parity` | Each shadow run | `parity_passed`, `shadow_error`, `diffs` |
| `decision.validator_parity` | Validator agreement check | `parity_passed`, `validator_count` |
| `decision.live_enrichment` | Each Stage 1 LIVE call | `enriched`, `reason`, `latency_ms` |
| `decision.issued` | Decision Object created | (lifecycle) |
| `decision.adopted` | Decision adopted by route | (lifecycle) |
| `decision.resolved` | Decision resolved | (lifecycle) |

---

## Dashboard Specifications

### Dashboard 1: Parity Health (prerequisite for Stage 1 activation)

**Filter:** `[decision-os]` AND `event=decision.shadow_parity`

| Panel | Query | Alert threshold |
|-------|-------|-----------------|
| Parity passed/failed (per slice, 7d) | `flags.parity_passed = true/false GROUP BY decision_type` | Any `parity_failed` → page |
| Shadow error rate (7d) | `flags.shadow_error = true / total` | > 1% → page |
| Parity passed totals (gate check) | `COUNT WHERE parity_passed=true GROUP BY decision_type` | Commissioner < 100 → warn; others < 500 → warn |

### Dashboard 2: Enrichment Quality (Stage 1 soak monitoring)

**Filter:** `[decision-os]` AND `event=decision.live_enrichment`

| Panel | Query | Alert threshold |
|-------|-------|-----------------|
| Enriched rate (per slice, rolling 24h) | `enriched=true / total GROUP BY decision_type` | < 95% → warn |
| LIVE path p95/p99 latency | `flags.latency_ms percentile 95/99 GROUP BY decision_type` | p99 > 2× baseline → warn |
| Failure reasons | `enriched=false GROUP BY flags.reason` | `reason=exception` spike → investigate |
| Commissioner enriched_count / total_db_source | Commissioner summary events | `enriched_count=0 AND total_db_source>0` → warn |

---

## Vercel Log Setup

### Enabling the log drain

1. Vercel Dashboard → Project → Settings → Log Drains
2. Add a drain endpoint (e.g., Axiom, Datadog, or a custom webhook)
3. Select "Function Logs" as the source type
4. Filter prefix: `[decision-os]` (if the provider supports message filtering)

### Vercel built-in log queries (Log Dashboard)

Vercel's built-in log search supports filtering by log content. Use:
```
[decision-os]
```
to see all Decision OS events. Then:
```
[decision-os] {"event":"decision.shadow_parity"
[decision-os] {"event":"decision.live_enrichment"
```

### Axiom APL queries (if using Axiom drain)

```apl
// Parity gate check (last 7 days)
['vercel-logs']
| where _time > now() - 7d
| where message contains "[decision-os]"
| extend event = parse_json(extract(@'\[decision-os\] (.+)', 1, message))
| where event.event == "decision.shadow_parity"
| summarize
    passed = countif(tobool(event.flags.parity_passed) == true),
    failed = countif(tobool(event.flags.parity_passed) == false),
    errors = countif(tobool(event.flags.shadow_error) == true)
  by tostring(event.decision_type)

// Enrichment quality (last 24h)
['vercel-logs']
| where _time > now() - 24h
| where message contains "[decision-os]"
| extend event = parse_json(extract(@'\[decision-os\] (.+)', 1, message))
| where event.event == "decision.live_enrichment"
| summarize
    enriched = countif(tobool(event.flags.enriched) == true),
    total = count(),
    p95_latency = percentile(toint(event.flags.latency_ms), 95),
    p99_latency = percentile(toint(event.flags.latency_ms), 99)
  by tostring(event.decision_type)
```

---

## Alert Configurations

All alerts should fire to Slack `#decision-os-alerts` (or PagerDuty for `parity_failed`).

### Alert 1: parity_failed (P1 — page immediately)
```
Trigger: any event WHERE event="decision.shadow_parity" AND flags.parity_passed=false
Severity: P1 (immediate page)
Message: "Decision OS parity FAILED for {decision_type} — league {leagueId}, diff: {diff}"
Action: Investigate the decision object diff. Do NOT activate Stage 1 for this slice.
```

### Alert 2: shadow_error rate > 1% (P2 — Slack warn)
```
Trigger: shadow_error events / total shadow events > 1% (rolling 1h)
Severity: P2 (Slack warn)
Message: "Decision OS shadow error rate {rate}% for {decision_type} (threshold 1%)"
Action: Check shadow runner logs for root cause. Shadow errors don't block the route.
```

### Alert 3: enriched_rate < 95% (P3 — Slack warn, Stage 1 only)
```
Trigger: enriched=true events / total LIVE events < 95% (rolling 1h)
Severity: P3 (Slack info)
Message: "Decision OS enriched rate {rate}% for {decision_type} (min 95%) — reason: {top_reason}"
Action: Check for leagueId missing from requests or shadow runner returning ran=false.
```

### Alert 4: LIVE p99 latency > 2× baseline (P3 — Slack warn, Stage 1 only)
```
Trigger: p99(latency_ms) for any slice > 2× the slice's established baseline
Severity: P3 (Slack warn)
Action: Profile the enrichment path. The LIVE path is fully isolated — no route impact.
```

---

## Gate-Check Script Usage

The `scripts/decision-os-telemetry-gate.ts` script is the canonical pre-activation check.

Run it against a 7-day log export before enabling any Stage 1 flag:

```sh
# Save 7 days of prod logs:
vercel logs --json --since 7d > /tmp/decision-os-logs.txt

# Run the gate:
cat /tmp/decision-os-logs.txt | npx tsx scripts/decision-os-telemetry-gate.ts
```

Expected output when all gates pass:
```
Decision OS Telemetry Gate Check
Reading [decision-os] events from stdin...

Lines read: 14200  |  Decision OS events parsed: 847

✅ LINEUP.SET
   parity_passed:  523 / 500 required  ✅
   parity_failed:  0 (must be 0)  ✅
   shadow_error:   3 / 523 (0.6%, max 1%)  ✅
   enriched_rate:  no LIVE events seen (Stage 1 not yet active for this slice)

✅ WAIVER.CLAIM
   ...

DECISION_OS_TELEMETRY_GATE_OK
```

---

## Pre-Activation Checklist (one-time, per-slice)

Before enabling `DECISION_OS_{SLICE}_LIVE=true` in Vercel:

- [ ] Vercel log drain is configured and ingesting `[decision-os]` events
- [ ] Both dashboards (Parity Health + Enrichment Quality) are live
- [ ] `parity_failed` alert is armed
- [ ] `shadow_error` alert is armed
- [ ] Gate script passes: `DECISION_OS_TELEMETRY_GATE_OK`
- [ ] Parity gate threshold met (Commissioner ≥ 100, others ≥ 500 `parity_passed` events)
- [ ] 0 `parity_failed` events in the last 7 days
- [ ] ≤ 1% shadow error rate in the last 7 days
- [ ] For Trade/Waiver: prod ADP cron confirmed GREEN (`AdpDataRecord` rows < 7 days old)

**Activation order:** Commissioner → Trade → Waiver → Lineup (rationale in ADR_PHASE4_5).

---

## 7-Day Soak Pass Criteria (per slice, after Stage 1 activation)

Per `ADR_PHASE4_5_STAGE1_ACTIVATION_READINESS.md`:

| Metric | Threshold |
|--------|-----------|
| `parity_failed` events | 0 |
| `shadow_error` rate | ≤ 1% of total shadow runs |
| `decisionOs` present rate (`enriched=true / total LIVE`) | ≥ 95% |
| LIVE path p99 latency | ≤ baseline (pre-Stage-1 p99 for that route) |
| Legacy fields unchanged | Verified by source-contract tests |

All criteria must hold for a continuous 7-day window. Any `parity_failed` event resets the clock.

---

## Invariants Preserved

- Architecture Freeze: no new decision logic, no new Decision Objects, no schema migrations
- No cutover: legacy response fields unchanged in all 4 routes
- No writes: telemetry is log-only (`console.log`); no DB writes
- Kill switch rollback: unsetting `DECISION_OS_{SLICE}_LIVE` stops all Stage 1 behavior instantly
- Telemetry isolation: `emitLiveTelemetry` is wrapped in try/catch inside every LIVE block
