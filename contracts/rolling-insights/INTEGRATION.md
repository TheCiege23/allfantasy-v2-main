# Rolling Insights Integration Map

**Companion to:** `ENDPOINTS.yaml` (normative contract) · `schema.sql` (DDL) · `README.md` (the no-probe rule)

---

## ⚠️ Correction to earlier guidance

I previously told you Rolling Insights' `304` response was a built-in conditional-polling feature and that you should architect change detection around it.

**That was wrong, and the vendor's own documentation says so.** Their agent-skill repo states plainly:

> "Treat `304` as a cache problem, not a success."

Their troubleshooting guide prescribes *defeating* it: send `Cache-Control: no-cache, no-store`, `Pragma: no-cache`, and a fresh millisecond-epoch cache-buster `&_=` on every call, then retry once on 304. The 304 comes from intermediary caching, not a designed conditional-GET protocol — there is no ETag or update-marker contract you can build on.

**Consequence for the architecture:** change detection is **payload hashing in your own database** (`raw_response.payload_sha256`), not HTTP semantics. That's why `poll_job.last_hash` exists. Slightly more work, and it's the reliable version.

---

## 1. Why you keep re-probing, and the fix

The re-probing loop isn't a discipline problem — it's a **missing artifact** problem. Three things make an agent uncertain enough to re-check:

| Cause | Fix |
|---|---|
| No committed record of the endpoint surface | `ENDPOINTS.yaml` — normative, versioned |
| No committed record of actual response shapes | `fixtures/` — one real capture per endpoint × sport |
| **Empty responses are ambiguous** — `data.NFL: []` on a Tuesday looks broken but is correct | `contract_probe_log` + `GAPS.md` record *known* absences so empty ≠ unknown |

That third one is the real culprit and the least obvious. An agent that gets `[]` cannot distinguish "no games today" from "wrong sport code" from "endpoint doesn't exist for this sport," so it probes again with variations. Recording the support matrix and the probe history removes the ambiguity permanently.

**The rule to put in `CLAUDE.md`:**

```
Do not call the Rolling Insights API to determine response shape.
Read contracts/rolling-insights/ENDPOINTS.yaml and fixtures/.
Unknowns go in GAPS.md — do not probe to resolve them.
```

**Fixtures are the durable half.** Capture once per endpoint × sport with `scripts/probe.sh`, commit the JSON, never call again for shape questions. A committed fixture is worth more than any amount of documentation because it's ground truth.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  INGESTION WORKER  (the ONLY process holding RSC_TOKEN)          │
│                                                                   │
│  scheduler → fetch → land raw → parse → upsert facts → detect     │
│                                                                   │
│  • HTTPS only. Token in env var. Redacted from all logs.          │
│  • Cache-busted every call. 304 → retry once.                     │
│  • Hash payload; skip downstream work if hash unchanged.           │
└──────────────────────────────────────────────────────────────────┘
                              ↓ writes
┌──────────────────────────────────────────────────────────────────┐
│  POSTGRES  (schema `ri`)                                          │
│  L0 raw_response  →  L1 dim_*  →  L2 fact_*  →  L3 event_game     │
└──────────────────────────────────────────────────────────────────┘
                              ↓ reads only
┌──────────────────────────────────────────────────────────────────┐
│  APPLICATION                                                      │
│  • Reads ri.v_* views. NEVER calls the vendor.                    │
│  • Does not hold RSC_TOKEN at all.                               │
│  • Push to clients via SSE/WebSocket from event_game.             │
└──────────────────────────────────────────────────────────────────┘
```

**The boundary is the point.** One process holds the token, one process knows the vendor's quirks, and the app has exactly one dependency: your own database. That's also what makes the vendor swappable — if you later add CollegeFootballData for CFB play-by-play, only the worker changes.

---

## 3. Request construction — the five rules

```python
BASE = "https://rest.datafeeds.rolling-insights.com/api/v1"   # HTTPS. Never http.

def build(endpoint_path: str, sport: str, league: str | None = None, **params):
    # 1. Normalize the sport code FIRST. NCAAF -> NCAAFB, "NCAA BB" -> NCAABB.
    sport = normalize_sport(sport)

    # 2. Soccer takes league as a QUERY param, never a path segment.
    if sport == "SOCCER":
        assert league in ("EPL", "LALIGA", "SERIEA"), "league required for SOCCER"
        params["league"] = league

    # 3. Cache-buster on EVERY call, millisecond precision.
    params["_"] = int(time.time() * 1000)
    params["RSC_token"] = os.environ["RSC_TOKEN"]

    # 4. No-cache headers on every call.
    headers = {
        "Accept": "application/json",
        "Cache-Control": "no-cache, no-store",
        "Pragma": "no-cache",
    }
    return f"{BASE}{endpoint_path}", params, headers


def fetch(url, params, headers, retried=False):
    r = httpx.get(url, params=params, headers=headers, timeout=10)

    # 5. 304 is a cache artifact, NOT "nothing changed". Retry once, fresh buster.
    if r.status_code == 304 and not retried:
        params["_"] = int(time.time() * 1000)
        return fetch(url, params, headers, retried=True)

    return r
```

**Logging:** every HTTP logger, error handler, and trace exporter must redact `RSC_token`. It's in the query string, which means naive URL logging leaks a long-lived credential into your log store. Add a redaction filter before you write the first request.

### Response parsing

```python
def extract(payload: dict, sport: str, league: str | None) -> list:
    data = payload.get("data") or {}
    # ⚠️ SOCCER is keyed by LEAGUE, not by the path segment you requested.
    key = league if sport == "SOCCER" else sport
    rows = data.get(key)
    if rows is None:
        return []                     # legitimately empty — see support matrix
    return rows if isinstance(rows, list) else [rows]
```

That soccer asymmetry is the highest-risk trap in the API: you request `SOCCER`, you parse `data.EPL`. A parser keyed off the request path silently returns empty for all soccer forever.

---

## 4. Polling schedule

Your requirement is 30–45s on game days. Vendor guidance is a ≥5s floor, no hard rate limit. **35s sits comfortably in your window and well above their floor.**

| Job | Condition | Interval |
|---|---|---|
| `live` | game `inprogress` | **35s** |
| `play_by_play` | game `inprogress`, sport ∈ {MLB, NBA, NFL} | **35s** |
| `injuries` | any game today | **35s** |
| `live` | game scheduled, kickoff < 30 min | 60s |
| `schedule` | daily | 06:00 local + hourly on game days |
| `injuries` | no games today | hourly |
| `depth_charts` | — | daily |
| `team_info`, `player_info` | — | daily |
| `team_stats`, `player_stats` | in-season / offseason | daily / weekly |
| **reconcile** | `finalized_at` set, `reconciled_at` null | hourly for 12h |

### Call-volume math

Per active game: one `live` + one `play_by_play` = 2 calls / 35s ≈ **206 calls/hour/game**.

A 13-game NFL Sunday, ~7 concurrent across a 9-hour window:
- live + PBP: ~13,000 calls
- injuries (one league-wide call per 35s): ~925
- **≈ 14,000 calls on a peak Sunday.** No documented quota, and vendor markets "no hidden rate limits," so this is fine — but confirm during the trial.

**Optimization worth taking:** `/live/{date}/{SPORT}` without `game_id` returns *all* games for that date in one response. Prefer one league-wide poll over N per-game polls — that turns 7 concurrent games into **1 call per 35s instead of 7**, a ~85% reduction. Only fall back to per-game polling if payload size becomes a problem.

### The 12-hour reconcile pass

Vendor reprocesses stat corrections for ~12 hours after a game ends. Ingestion must:

1. On `status → final`, set `finalized_at`, keep `is_provisional = true`.
2. Re-poll hourly for 12h; bump `correction_count` on each payload-hash change.
3. After 12h, set `reconciled_at` and `is_provisional = false`.
4. **If a correction changes a scored stat, emit a notification.** Silently mutating a score the user already saw is the fastest way to lose their trust.

---

## 5. Event detection

### Path A — play-by-play (MLB, NBA, NFL only) → confidence `HIGH`

```
for play in new_plays_since(last_seq):
    if play.yards >= 20:      emit BIG_PLAY
    if is_touchdown(play):    emit TOUCHDOWN(unit=OFF|DEF|ST)
    if is_sack(play):         emit SACK
    if is_interception(play): emit INTERCEPTION
```

### Path B — box-score diff (NHL, NCAAFB, NCAABB, SOCCER) → confidence `LOW`

No PBP exists for these. Diff `fact_player_game` against `fact_player_game_prev`:

```
Δ passing_touchdowns   > 0  → TOUCHDOWN (offense, passing)
Δ rushing_touchdowns   > 0  → TOUCHDOWN (offense, rushing)
Δ defense_touchdowns   > 0  → TOUCHDOWN (defense)
Δ kick_return_tds      > 0  → TOUCHDOWN (special teams)
Δ sacks                > 0  → SACK
Δ defense_interceptions> 0  → INTERCEPTION
rushing_long crossed 20     → BIG_PLAY
```

> ### ⚠️ The limitation you must surface, not hide
>
> **`rushing_long` is monotonic** — it's "longest so far," and it rises once then stays. A 25-yard run *after* a 40-yard run is invisible to the diff.
>
> **Box-score diffing detects the first big play per player per game, not all of them.**
>
> Label these events `detection_confidence = LOW` in the DB and say so in the UI ("big-play alerts for college football are partial"). Do not present partial detection as complete — that's exactly the failure mode the rest of this system is built to avoid.
>
> **For complete NCAAFB play-level data, use CollegeFootballData** — $5–30/mo with commercial use explicitly permitted, and it has real play-by-play. Rolling Insights for CFB box scores + CFBD for CFB plays is the correct combination.

### Idempotency

```
dedupe_key = sha256(f"{sport}:{game_id}:{player_id}:{kind}:{stat_value}:{period}")
```

`UNIQUE (dedupe_key)` on `event_game`. Polling plus retries **will** re-emit; the constraint makes double-notification impossible rather than unlikely.

### Notification defaults

| Setting | Default | Why |
|---|---|---|
| `scope` | `MY_PLAYERS` | A 13-game Sunday produces hundreds of qualifying plays |
| `max_per_hour` | 15 | Uncapped feeds get notifications disabled permanently |
| `quiet_hours` | on | |
| `min_confidence` | `LOW` (labeled) | Show partial detection, but mark it |

The binding constraint on this feature is user attention, not technical capability.

---

## 6. Multi-sport rollout, ordered by cost-effectiveness

Pricing is **additive per sport** — Live Feed is $600/mo each for NFL/NBA/MLB/Soccer, $400/mo each for NHL/NCAAFB/NCAABB.

| Everything you asked for | Monthly |
|---|---|
| NFL only | $600 |
| NFL + NCAAFB | $1,000 |
| NFL + NBA + NHL + MLB + NCAAFB + NCAABB | **$3,200** |
| …plus Euro Soccer | **$3,800** |

> ### 💡 Do this before paying anything
>
> **The Breakaway Accelerator starts at $60/month** (rolling-insights.com/breakaway-accelerator/) — a one-year startup program. That's $60 vs $3,800. It is by far the highest-leverage action available on this integration, and it costs an email.
>
> There's also a **30-day fully functional trial, no credit card.** Use it to measure actual live latency before committing — the vendor self-describes as "medium-latency" and never quantifies it.

**Suggested order:** NFL (your core) → NCAAFB (+CFBD for plays) → NBA → NHL/MLB → Soccer. Add a sport only when the DB and event pipeline are proven on the previous one; the schema is already multi-sport so each addition is config plus a fixture, not new code.

---

## 7. What Rolling Insights does *not* cover

Plan around these rather than discovering them later:

| Gap | Consequence | Mitigation |
|---|---|---|
| No PBP for NCAAFB/NHL | Partial big-play detection | CollegeFootballData for CFB |
| No injuries for NCAAFB/NCAABB | No college injury feature | Omit with explicit flag |
| No soccer player season stats | Limited soccer fantasy depth | Reassess before building soccer |
| No odds, no projections | — | Build projections yourself (see values-pipeline spec) |
| `DK_fantasy_points` is DraftKings-only | Useless for custom scoring | Your own scoring engine over raw stats |
| No practice-report granularity | No DNP/Limited/Full grid | Parse official NFL injury reports |
| Bundesliga, Ligue 1, UCL, MLS | Not covered at all | Different vendor if needed |
| No SLA; accuracy disclaimed | Data can be wrong | Feed-health monitoring + `v_feed_health` |

---

## 8. Two open items that need a human

**1. The competitive-use clause.** Their ToS grants commercial use explicitly:

> "This licence includes the right to use the DataFeeds data outputs for internal and commercial purposes."

But it also bars using the service to "build or support or assist a third party in ... products or services competitive to ours" — and **Rolling Insights sells SportWise, a consumer fantasy analytics product.** A fantasy analytics platform could arguably fall under that clause. **Get written confirmation before you build on this.** It's the largest legal unknown in the integration, and it's a single email.

**2. Actual live latency.** "Medium-latency" is their own term and they never put a number on it. They're an unofficial provider collecting from public sources — fine for fantasy, and materially different from an official low-latency feed. **Measure it during the trial** with a stopwatch against a broadcast before you promise users real-time alerts.

I'm not a lawyer; item 1 is a flag for counsel, not advice.

---

## 9. Build order

| Phase | Scope |
|---|---|
| 0 | Trial key. Apply to Breakaway Accelerator. Ask about the competitive clause. |
| 1 | `schema.sql`. Token redaction in logging. HTTPS enforced. |
| 2 | Fetch layer: normalization, cache-busting, 304 retry, raw landing + hashing. |
| 3 | `scripts/probe.sh` → capture fixtures for every endpoint × sport → commit → fill `GAPS.md`. **This is what stops the re-probing.** |
| 4 | NFL parsers → `dim_*`, `fact_*`. Scheduler with the §4 cadences. |
| 5 | Event detection (PBP path), `event_game`, dedupe. |
| 6 | Reconcile pass + provisional→final transitions + correction notifications. |
| 7 | App read views, SSE/WebSocket push, `v_feed_health` in the UI. |
| 8 | Add NCAAFB (box diff, labeled LOW) + CFBD for plays. |
| 9 | Remaining sports, one at a time. |

Phase 3 is the one that solves the problem you actually asked about. Everything before it is plumbing; everything after it depends on it.
