## Pre-Deploy Gate: Draft Pool Data-Quality

Run before every production deploy that touches draft, player identity, or pool-related code:

```powershell
npm run draft-pool:sweep-multi-league
```

Exits non-zero on any failure — safe to add to CI pre-deploy step.
Automated nightly check: `.github/workflows/draft-pool-data-quality-nightly.yml` (runs 10:00 UTC daily, opens issue on failure).

**Status as of 2026-04-27:** 4/4 leagues PASS, 11/11 checks clean  
`dupPlayerIds=0  dupSleeperIds=0  pairCollisions=0  missingHeadshots=0  missingTeamLogos=0  missingProjections=0  identityMissingSleeperForward=0  rookieSignalPct=99.16%`

## Pre-Deploy Gate: AI Result Cache Wiring

Run before deploys that touch AI routes/cache helpers:

```powershell
npx prisma validate
npm run ai-result-cache:regression
npm run ai-result-cache:audit
```

Expected:

1. Prisma schema valid.
2. Regression suite PASS (cache wiring + helper round trip).
3. Audit command completes and reports feature row health.

### Smoke-Provider Route Proof Policy

Authenticated smoke-provider two-call route proof (`source: smoke-provider` then `source: ai-result-cache`) is a manual release check, not default CI:

1. Requires authenticated browser context.
2. Requires temporary Sleeper fixture lifecycle management.
3. May interact with mutable daily limiter state (power-rankings).

Use for release evidence when AI route behavior changes materially.

---

# Same-Day Rollout: trade/league-analyze AI Migration

> **Historical (2026-09-30):** both `/api/ai/trade/league-analyze` and `/api/legacy/trade/league-analyze` were removed (commit `1b2e29ca4`) — nothing rendered their result, so the page no longer calls them and `NEXT_PUBLIC_USE_AI_TRADE_ANALYZE` has no reader. The queries and rollback steps below describe the April rollout only; do not run them expecting live traffic.
**Deployment Time:** 2026-04-21
**Feature:** `NEXT_PUBLIC_USE_AI_TRADE_ANALYZE=true`
**Route:** `/api/ai/trade/league-analyze` (new) ← `/api/legacy/trade/league-analyze` (fallback)

---

## Deployment Status

- Build: **IN PROGRESS**
- Deployment: **PENDING** (awaiting build success)
- Monitoring: **ACTIVE** (ready to execute)
- Rollback: **PREPARED** (1-line env var flip)

---

## Real-Time Monitoring Queries

### Query 1: Success Rate (T+5, T+15, T+30, T+60min)
```sql
SELECT 
  DATE_TRUNC('minute', bucketStart) as minute,
  COUNT(*) as total_requests,
  SUM(okCount) as successful_requests,
  ROUND(100.0 * SUM(okCount) / COUNT(*), 1) as success_rate_pct
FROM ApiUsageRollup
WHERE endpoint = '/api/ai/trade/league-analyze'
  AND bucketStart > now() - interval '90 minutes'
GROUP BY minute
ORDER BY minute DESC
LIMIT 15;
```
**Target:** >95% | **Alert:** <90% in first 30min → ROLLBACK

---

### Query 2: Degradation Rate (T+10, T+30, T+60min)
```sql
SELECT 
  DATE_TRUNC('minute', timestamp) as minute,
  COUNT(*) as total_requests,
  SUM(CASE WHEN response_meta->>'aiDegraded' = 'true' THEN 1 ELSE 0 END) as degraded_responses
FROM response_logs
WHERE endpoint = '/api/ai/trade/league-analyze'
  AND timestamp > now() - interval '90 minutes'
GROUP BY minute
ORDER BY minute DESC
LIMIT 15;
```
**Target:** <5% | **Alert:** >10% → Check OpenAI availability → Consider ROLLBACK

---

### Query 3: Latency (P95) (T+15, T+30, T+60min)
```sql
SELECT 
  DATE_TRUNC('minute', bucketStart) as minute,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95_latency_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) as p99_latency_ms,
  MAX(response_time_ms) as max_latency_ms
FROM request_timings
WHERE endpoint = '/api/ai/trade/league-analyze'
  AND bucketStart > now() - interval '90 minutes'
GROUP BY minute
ORDER BY minute DESC
LIMIT 15;
```
**Target:** P95 <35s | **Alert:** P95 >60s → ROLLBACK

---

### Query 4: Timeout Events (T+10, T+30, T+60min)
```bash
# Check logs for timeout events
grep -c '\[trade-league-analyze\] Timeout' app_logs.log

# Show timeline
grep '\[trade-league-analyze\] Timeout' app_logs.log | tail -20
```
**Target:** 0-1 per 10min | **Alert:** >2 in short window → ROLLBACK

---

### Query 5: Error Rate (T+15, T+30, T+60min)
```sql
SELECT 
  DATE_TRUNC('minute', timestamp) as minute,
  status_code,
  COUNT(*) as count
FROM response_logs
WHERE endpoint = '/api/ai/trade/league-analyze'
  AND timestamp > now() - interval '90 minutes'
GROUP BY minute, status_code
ORDER BY minute DESC, count DESC;
```
**Target:** <1% 5xx errors | **Alert:** >3% → Check error logs

---

### Query 6: Telemetry Tags (T+30, T+60min)
```sql
SELECT 
  tool,
  endpoint,
  COUNT(*) as request_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct_of_total
FROM ApiUsageRollup
WHERE tool IN ('AiTradeLeagueAnalyze', 'LegacyTradeLeagueAnalyze')
  AND bucketStart > now() - interval '5 minutes'
GROUP BY tool, endpoint
ORDER BY request_count DESC;
```
**Expected:** 
- `AiTradeLeagueAnalyze` from `/api/ai/trade/league-analyze`: ~95%+
- `LegacyTradeLeagueAnalyze` from `/api/legacy/trade/league-analyze`: ~5% or less

---

## UI Regression Check

### Manual Test (T+10, T+30min)
```
1. Open: https://allfantasy.ai/app/af-legacy
2. Login as test user
3. Navigate to Trade Finder / League Analysis
4. Click "Analyze Trades" button
5. Wait for response (~15-30s typical)
6. Verify:
   - Response loads without error
   - No browser console errors (F12)
   - UI shows suggestions (or "Analysis unavailable" if degraded)
   - Response shape: {suggestions: [], managerCount: N, dataQuality: "fresh"}
```

---

## Monitoring Checkpoint Timeline

### T+5min: Initial Health Check
```
✓ Build completed successfully
✓ Deployment successful
✓ Requests routing to /api/ai/trade/league-analyze
✓ No immediate errors in logs
```
**Decision:** Continue monitoring

---

### T+10min: Early Warning Check
```
✓ Success rate still >95%
✓ Degradation rate <5%
✓ UI test: Trade analysis loads
✓ No timeout events yet
```
**Decision:** Continue monitoring

---

### T+15min: Latency Baseline
```
✓ P95 latency <35s (or verify <60s at minimum)
✓ Error rate <1%
✓ No cascading failures
```
**Decision:** Continue monitoring

---

### T+30min: First Major Checkpoint
```
IF all metrics stable for 30 minutes:
  ✅ CONTINUE - System performing as expected
ELSE IF success rate <90% OR degradation >10% OR latency >60s:
  ⚠️ EVALUATE - Investigate root cause
  - Check OpenAI availability
  - Check FantasyCalc status
  - Review error logs
ELSE IF issues persist:
  ❌ ROLLBACK - Switch NEXT_PUBLIC_USE_AI_TRADE_ANALYZE=false
```

**Rollback Command (if needed):**
```bash
NEXT_PUBLIC_USE_AI_TRADE_ANALYZE=false npm run build && deploy
# Expected: Traffic returns to /api/legacy/trade/league-analyze
# Verify: Metrics return to baseline within 3-5min
```

---

### T+60min: Final Rollout Decision
```
IF all metrics remained stable 30-60min:
  ✅ SUCCESS - Mark rollout complete
  → Keep AI route enabled
  → Continue monitoring for 24 hours
  → Schedule decommission of legacy route (in 48-72h)
ELSE IF metrics degraded but stable:
  ⚠️ ACCEPTABLE - Continue with caution
  → Monitor next 24 hours closely
  → Document degradation patterns
  → Plan optimization for next week
ELSE IF critical issues:
  ❌ ROLLBACK - Already executed earlier
```

---

## Early Rollback Triggers (First 30min)

**Automatic rollback if any of these occur:**

1. **Success Rate < 90%**
   ```
   Action: ROLLBACK IMMEDIATELY
   Reason: >10% requests failing indicates system issue
   ```

2. **Degradation Rate > 10%**
   ```
   Action: Investigate OpenAI first, ROLLBACK if confirmed down
   Reason: >10% indicates consistent external failure
   ```

3. **P95 Latency > 60 seconds**
   ```
   Action: Check FantasyCalc/Sleeper status, ROLLBACK if unresponsive
   Reason: Consistent latency >60s unusual for trade analysis
   ```

4. **Repeated Timeout Events (3+)**
   ```
   Action: ROLLBACK IMMEDIATELY
   Reason: withTimeout() guard firing = external API hanging
   ```

5. **Visible UI Regression**
   ```
   Action: Investigate console errors, ROLLBACK if not quickly solvable
   Reason: UI breakage = user-facing impact
   ```

6. **Cascading Errors in Logs**
   ```
   Action: ROLLBACK IMMEDIATELY
   Reason: Error patterns indicate systemic issue
   ```

---

## Rollback Execution (Step-by-Step)

If any rollback trigger activates:

```bash
# Step 1: Set environment variable to disable AI route
export NEXT_PUBLIC_USE_AI_TRADE_ANALYZE=false

# Step 2: Rebuild with fallback
npm run build

# Step 3: Deploy
deploy

# Step 4: Verify traffic shift
# (Wait 2-3 minutes for traffic to settle)
# Query: Check ApiUsageRollup for LegacyTradeLeagueAnalyze > 95%

# Step 5: Monitor baseline metrics return
# - Success rate should return to pre-deployment baseline
# - Latency should drop immediately
# - Degradation should drop to previous levels
```

**Expected time to rollback:** 2-5 minutes total

---

## Post-Rollout Success Path (if T+60 all green)

1. **Hour 2-6:** Continue normal monitoring
   - Run queries every 30 minutes
   - Document any anomalies

2. **Hour 6-24:** Periodic spot checks
   - Run queries every 2 hours
   - Verify no degradation overnight

3. **Day 2 (if still stable):**
   - Mark migration as **SUCCESSFUL**
   - Update telemetry dashboards (dual tags now expected)
   - Plan `/api/legacy/trade/league-analyze` decommission (72h from now)

---

## Contact & Escalation

**If critical issues arise:**
- Check real-time logs: `tail -f app_logs.log`
- Verify external API status (OpenAI, FantasyCalc, Sleeper)
- Execute rollback if unsure
- Page on-call engineer if rollback doesn't stabilize metrics

---

**Deployment prepared by:** AI Migration Assistant
**Status:** READY FOR EXECUTION
**Risk Level:** LOW (feature flag + instant rollback available)
