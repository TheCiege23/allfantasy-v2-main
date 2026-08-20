# AllFantasy Route Consolidation Audit & Consolidation Plan
**Date:** May 11, 2026  
**Current Status:** 2052 routes (2048 limit exceeded by 4)  
**Goal:** Consolidate routes to stay under 2048 and prevent future explosions as AI features and concept leagues grow.

---

## PART 1: CURRENT ROUTE COUNT ANALYSIS

### Overall Statistics
| Metric | Count |
|--------|-------|
| Page routes (page.tsx) | 253 |
| API routes (route.ts) | 1,443 |
| Total static routes | 1,696 |
| **Vercel limit** | **2,048** |
| **Currently over by** | **~4 routes** |
| **Build script disables** | ~50+ routes |

> **Note:** Vercel only counts routes that survive the build. The `scripts/vercel-next-build.cjs` script temporarily moves routes to `.next-build-disabled-routes/` during build to stay under 2048. This means the route explosion happens during build analysis, not at runtime.

### Top 20 API Route Consumers
```
1. leagues                348  (24.1% of all API routes) — [leagueId] dynamic routes
2. legacy                  88  (6.1%) — legacy bracket system
3. bracket                 65  (4.5%) — bracket operations  
4. commissioner            61  (4.2%) — commissioner tools
5. ai                      60  (4.2%) — AI features
6. draft                   56  (3.9%) — draft operations
7. tournament              45  (3.1%) — tournament system
8. league                  41  (2.8%) — generic league operations
9. shared                  39  (2.7%) — shared utilities
10. brackets               36  (2.5%) — new world-cup/playoffs
11. mock-draft             32  (2.2%) — mock draft simulations
12. auth                   32  (2.2%) — authentication
13. user                   31  (2.1%) — user operations
14. redraft                21  (1.5%) — redraft league type
15. devy                   15  (1.0%) — devy league type
16. guillotine             15  (1.0%) — guillotine league type
17. bestball               14  (1.0%) — bestball league type
18. keeper                 14  (1.0%) — keeper league type
19. ai-tools               11  (0.8%) — AI tools/providers
20. creators               11  (0.8%) — creator marketplace

**Critical Issue:** Remaining ~400 API directories have only 1-4 routes each.
```

### Page Route Breakdown
- **Active user-facing pages:** ~170  
- **Disabled for build:** ~83 (e2e, admin, dev, zombie, survivor, etc.)
- **Aliases/redirects:** ~0 (handled via next.config.js redirects)

---

## PART 2: ROUTE BLOAT IDENTIFICATION

### Category 1: Already-Disabled Routes (Safe - Build Script Handles)
Routes that are automatically excluded by `vercel-next-build.cjs`:

| Path | Type | Routes | Status |
|------|------|--------|--------|
| app/e2e/ | Page + API | ~15 | Disabled (test harnesses) |
| app/api/dev/ | API | ~5 | Disabled (dev-only) |
| app/api/e2e/ | API | ~5 | Disabled (e2e test routes) |
| app/api/admin/ | API | ~18 (2 kept) | Mostly disabled |
| app/api/cron/ | API | ~26 (1 kept) | Mostly disabled |
| app/zombie/ | Page | ~20 | Disabled (game mode deferred) |
| app/api/zombie/ | API | ~40 | Disabled (game mode deferred) |
| app/survivor/ | Page | ~15 | Disabled (game mode deferred) |
| app/api/survivor/ | API | ~25 | Disabled (game mode deferred) |
| app/tools/*-harness/ | Page | ~2 | Disabled (internal tools) |

**Total disabled:** ~171 routes  
**These are correctly being excluded by build script but still need to be reviewed for cleanup.**

### Category 2: Fragmented [leagueId] Routes (MAJOR BLOAT - 348 Routes)
The `/api/leagues/[leagueId]/` directory has 348 separate route files for league-specific features:

**Feature families under [leagueId]:**
- **Draft operations:** ~50 routes (pick, queue, settings, auction, etc.)
- **AI Commissioner:** ~10 routes (run, config, chat, alerts, etc.)
- **Devy system:** ~21 routes (promotion, config, admin actions)
- **Dispersal draft:** ~8 routes (pick, pass, start, etc.)
- **Big Brother:** ~23 routes (hoh, vote, finale, etc.)
- **Awards system:** ~8 routes (run, config, etc.)
- **Finance:** ~8 routes (payout, entry, settings, etc.)
- **Hall of Fame:** ~8 routes (entries, moments, etc.)
- **Trade proposals:** ~8 routes (respond, review, etc.)
- **Merged Devy C2C:** ~15 routes (hybrid league operations)
- **Tournament:** ~10 routes
- **Other features:** ~180 routes (legacy-score, integrity, matchup-center, media, etc.)

**Problem:** Each [leagueId] nested route counts as an individual route. With 348 of them, this alone consumes 24% of the Vercel budget.

### Category 3: Duplicate/Legacy Bracket Systems (65 + 36 = 101 routes)
Two bracket systems exist in parallel:
- **app/api/bracket/** (65 routes) — legacy: ai, auto-fill, chaos, chat, discover, donate, entries, feed, global-rankings, intelligence, leaderboard, leagues, live, my-leagues, popularity, providers, public-pools, social, stripe, tournament, tournaments, workers
- **app/api/brackets/** (36 routes) — new: world-cup, playoffs

**Problem:** The legacy bracket system is massive. Need to determine if it's still used or can be consolidated into the new brackets system.

### Category 4: Scattered AI Routes (60+ routes)
- **app/api/ai/** (60 direct routes)
- **Plus AI nested under:** leagues[leagueId]/ai-*, draft/ai-*, commissioner/ai-*, etc.
- **Total AI surface:** ~80+ routes scattered across domains

**Problem:** No unified AI route structure. Each feature area adds its own AI endpoints rather than routing through a consolidated AI dispatcher.

### Category 5: Concept League Routes Scattered (100+ routes)
- **Devy:** 15 routes + 21 routes under leagues[leagueId]/devy + 15 under merged-devy-c2c = ~51 routes
- **Guillotine:** 15 routes
- **Bestball:** 14 routes
- **Keeper:** 14 routes
- **Big Brother:** 4 routes + 23 routes under leagues[leagueId]/big-brother = ~27 routes
- **Survivor:** ~40+ routes (disabled but not yet cleaned up)
- **Zombie:** ~40+ routes (disabled but not yet cleaned up)

**Problem:** Each concept league has its own scattered route structure. No unified concept league dispatcher.

### Category 6: One-Off Routes (200+ directories with 1-2 routes each)
Examples of single/double-route directories:
- app/api/submit-league/ (1 route)
- app/api/schedule/ (1 route)
- app/api/rivals-engine/ (1 route)
- app/api/trade-analyzer/ (1 route)
- app/api/achievement-s/ (1 route)
- app/api/recommendations/ (1 route)
- ... and ~190 more

**Problem:** Excessive fragmentation. Could be consolidated under domain dispatchers or removed if unused.

---

## PART 3: IMMEDIATE SAFE REDUCTION OPPORTUNITIES

### Safe Removals & Exclusions

**1. Clean Up Already-Disabled Routes (10-15 Routes)**
- Delete zombie/universe/, zombie/[leagueId]/ from app/ (not from components/)
- Delete survivor/[leagueId]/ from app/ (not from components/)
- Delete app/api/zombie/ directory entirely
- Delete app/api/survivor/ directory entirely
- Delete app/api/dev/, app/api/e2e/ entirely
- Delete app/e2e/ directory entirely
- Delete app/admin/ directory

**Result:** Cleans up ~50 routes that are already being excluded.

**2. Consolidate Disabled Admin/Cron Routes (5-10 Routes)**
The build script keeps only 2 admin routes and 1 cron route. All others could be moved to a separate `app/api/admin-internal/` directory that's excluded from build.

**Current kept routes:**
- app/api/admin/automation/health/route.ts
- app/api/admin/automation/waivers/run/route.ts
- app/api/cron/waivers/route.ts

**Move to excluded directory:**
- All other app/api/admin/ routes
- All other app/api/cron/ routes (except waivers)

**Result:** Cleans up ~40 routes that are already disabled.

**3. Remove Unused Legacy Bracket Routes (20-30 Routes)**
The new app/api/brackets/ system (world-cup, playoffs) seems to be the path forward. The old app/api/bracket/ system (65 routes) may have unused or deprecated routes.

**Candidates for removal:**
- Legacy bracket chaos, chat-upload, discover endpoints if superseded by new system
- Duplicate tournament routes if already in tournaments/ directory

**Result:** Could eliminate 20-30 legacy routes.

**4. Consolidate Single-Route Directories (50 Routes)**
Many directories exist with only 1-2 routes. These could be consolidated into parent domains or removed if unused:
- app/api/submit-league/route.ts → app/api/leagues/submit/route.ts
- app/api/rivals-engine/route.ts → app/api/game-theory/rivals/route.ts
- app/api/trade-analyzer/route.ts → app/api/trade/analyzer/route.ts
- app/api/player-card-analytics/route.ts → app/api/analytics/player-card/route.ts
- etc.

**Result:** Reduce fragmentation by ~50 routes without losing functionality.

**5. Deactivate Experimental/Lab Routes (5-10 Routes)**
- app/ai-lab/ directory (if not in production use)
- app/lab/ directory (if not in production use)
- app/bracket-review/ directory (if not in production use)
- app/api/lab/ directory
- app/api/simulation-lab/ directory

**Result:** ~20-30 routes.

**Safe Removal Total: 170-220 Routes** ✅

---

## PART 4: LONG-TERM CONSOLIDATION PLAN

### Consolidated Route Architecture

#### 1. **League Resource Dispatcher** (Replace 348 routes)
```
POST/GET/PUT/DELETE /api/leagues/[leagueId]/[resource]/[action]

Parameters:
  - leagueId: UUID
  - resource: ai-commissioner | awards | big-brother | devy | draft | finance | 
              hall-of-fame | imports | integrity | matchups | media | settings | ...
  - action: get | create | update | delete | run | config | validate | etc.

Query params vary by resource:
  ?operation=review, ?operation=commit, etc.

Validation strategy:
  - Route handler dispatches to service layer based on resource + action
  - Authentication at route level (all league routes protected)
  - Authorization delegated to service layer (commissioner-only, etc.)

Service files:
  - lib/leagues/services/[resource]Service.ts
  - lib/leagues/dispatch.ts (router logic)

Current: 348 separate route.ts files
Consolidated: 1 dynamic route handler
Estimated reduction: 300+ routes
```

#### 2. **AI Route Consolidator** (Replace 80+ routes)
```
POST /api/ai/[domain]/[action]
GET /api/ai/[domain]/[query]

Domains:
  - agents (orchestration, actions)
  - waivers (waiver intelligence)
  - draft (draft assistance)
  - trades (trade intelligence)
  - coaching (coaching plans)
  - opponents (scouting)
  - analytics (insights)
  - memory (user memory)
  - simulation (what-if analysis)
  - rankings (AI rankings)

Actions:
  - analyze, predict, generate, execute, explain, recommend, etc.

Service files:
  - lib/ai/services/[domain]Service.ts
  - lib/ai/dispatch.ts (router)

Current: 60 direct routes + 20+ nested under league/draft/commissioner
Consolidated: 1 dynamic route handler
Estimated reduction: 50+ routes
```

#### 3. **Concept League Dispatcher** (Replace 100+ routes)
```
GET/POST /api/concept-leagues/[leagueId]/[concept]/[action]

Concepts:
  - devy (keeper dynasty variants)
  - guillotine (elimination format)
  - bestball (auto-roster)
  - keeper (keeper format)
  - big-brother (social format)
  - survivor (elimination reality)
  - zombie (undead format)
  - redraft (seasonal format)

Allowed actions per concept vary. Router enforces contract.

Service files:
  - lib/concepts/[concept]Service.ts
  - lib/concepts/dispatch.ts

Current: 100+ scattered under leagues[leagueId] + standalone directories
Consolidated: 1-2 dynamic route handlers
Estimated reduction: 60+ routes
```

#### 4. **Cron Jobs Consolidator** (Reduce 26 routes to 1)
```
POST /api/cron/[job]?schedule=true

Jobs:
  - import-players
  - waivers
  - import-injuries
  - import-schedules
  - adp-refresh
  - import-news
  - sync-playoff-brackets
  - etc. (all 26 jobs)

Vercel cron triggers the endpoint, router dispatches.

Service files:
  - lib/cron/[job]Job.ts
  - lib/cron/dispatch.ts

Current: 26 separate route.ts files
Consolidated: 1 dynamic route handler
Estimated reduction: 20+ routes

Kept routes (for backward compatibility):
  - /api/cron/waivers (if UI depends on it)
```

#### 5. **Admin Operations Dispatcher** (Reduce scattered admin routes)
```
POST /api/admin/[area]/[action]?apiKey=xxx

Areas:
  - health
  - automation
  - reporting
  - governance
  - data-integrity

Current: Scattered across app/api/admin/ + app/api/*/admin/ subdirectories
Consolidated: 1-2 dynamic route handlers
Estimated reduction: 15-20 routes
```

### Consolidation Roadmap

**Phase 1 (Week 1): Cleanup & Consolidation Foundation**
1. Delete zombie/, survivor/, app/e2e/, app/admin/ entirely
2. Move disabled cron/admin routes to app/api/admin-internal/
3. Create lib/dispatch/ infrastructure for routing
4. Add safe-list of routes that MUST NOT be consolidated
5. **Estimated route savings: 100-150 routes**

**Phase 2 (Week 2): AI Route Consolidation**
1. Create /api/ai/[domain]/[action] dispatcher
2. Migrate all app/api/ai/* routes to use dispatcher
3. Update frontend callers to use new endpoint structure
4. Keep old routes temporarily as compatibility redirects
5. **Estimated route savings: 40-50 routes**

**Phase 3 (Week 3): Concept League Consolidation**
1. Create /api/concept-leagues/[leagueId]/[concept]/[action] dispatcher
2. Migrate devy, guillotine, bestball, keeper routes to dispatcher
3. Migrate big-brother, survivor, zombie to dispatcher
4. **Estimated route savings: 50-70 routes**

**Phase 4 (Week 4): League Resource Consolidation (LARGEST IMPACT)**
1. Create /api/leagues/[leagueId]/[resource]/[action] dispatcher
2. Migrate 348 routes to dispatcher routing
3. Update all frontend callers
4. **Estimated route savings: 250-300 routes**

**Phase 5 (Ongoing): Monitor & Consolidate New Routes**
1. Establish policy: NO new direct routes under /api/leagues/[leagueId]/[feature]
2. All new league features must go through dispatcher
3. All new AI features must go through dispatcher
4. All new concept league features must go through dispatcher

---

## PART 5: DETAILED DISPATCHER DESIGN

### League Resource Dispatcher Example
**File:** `app/api/leagues/[leagueId]/[resource]/[action]/route.ts`

```typescript
// Pseudo-code
import { leagueDispatch } from '@/lib/leagues/dispatch'
import { auth } from '@/auth'

export async function POST(req: Request, { params }) {
  const { leagueId, resource, action } = params
  const session = await auth()
  
  // Validate parameters
  if (!leagueId || !resource || !action) {
    return Response.json({ error: 'Invalid parameters' }, { status: 400 })
  }
  
  // Dispatch to service layer
  try {
    const result = await leagueDispatch({
      leagueId,
      resource,
      action,
      session,
      req: await req.json(),
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }
}
```

**File:** `lib/leagues/dispatch.ts`

```typescript
// Pseudo-code
import * as draftService from './services/draftService'
import * as aiCommissionerService from './services/aiCommissionerService'
// ... more services

const resources = {
  'draft': {
    'pick': (params) => draftService.makePick(params),
    'queue': (params) => draftService.getQueue(params),
    'settings': (params) => draftService.getSettings(params),
    // ...
  },
  'ai-commissioner': {
    'run': (params) => aiCommissionerService.runAutoCommissioner(params),
    'config': (params) => aiCommissionerService.getConfig(params),
    // ...
  },
  // ... more resources
}

export async function leagueDispatch({ leagueId, resource, action, session, req }) {
  const handler = resources[resource]?.[action]
  if (!handler) {
    throw new Error(`Unknown resource/action: ${resource}/${action}`)
  }
  return handler({ leagueId, session, req })
}
```

**Benefits:**
- Routes are now parameterized
- Same endpoint handles multiple actions
- Service layer is decoupled from route structure
- Easier to add new actions without new routes
- Single place to enforce authentication/authorization

---

## PART 6: BACKWARD COMPATIBILITY STRATEGY

### Option A: Lightweight Redirects (Recommended for Phase 1-2)
Keep old route structure but make them lightweight shims:

```typescript
// app/api/draft/[leagueId]/pick/route.ts (OLD)
// Redirect to new dispatcher
export async function POST(req: Request, { params }) {
  const { leagueId } = params
  const response = await fetch(
    `${process.env.INTERNAL_URL}/api/leagues/${leagueId}/draft/pick`,
    { method: 'POST', body: await req.text(), headers: req.headers }
  )
  return response
}
```

**Advantages:**
- Frontend doesn't need immediate updates
- Can migrate callers gradually
- Easy to test new dispatcher in parallel
- Can delete old routes after all callers updated

**Disadvantages:**
- Adds one hop to request chain
- Still counts as routes during migration (temporary issue)

### Option B: Direct Deprecation (Phase 4+)
Once all callers updated:
1. Remove old routes entirely
2. All traffic goes through dispatcher
3. No backward compatibility layer needed

### Safe Routes to Keep Unchanged
These routes have high caller coupling and should not be consolidated yet:
- /api/auth/* (40+ routes) — auth is coupled to session
- /api/user/* (30+ routes) — user profile system
- /api/draft/[leagueId]/pick (heavily used, should consolidate last)
- /api/league/* (generic league operations)
- /api/bracket/* (if legacy bracket UI still depends on it)

---

## PART 7: RISK ASSESSMENT & MITIGATION

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Breaking frontend callers** | HIGH | Use lightweight redirects; update callers gradually |
| **Dispatcher becomes monolithic** | MEDIUM | Split by domain; keep services in separate files |
| **Debugging becomes harder** | MEDIUM | Add structured logging; trace action flows |
| **Database query N+1 problems** | MEDIUM | Use services to batch/cache queries |
| **Authorization bypass in dispatch** | HIGH | Implement strict ACL matrix; test thoroughly |
| **New routes added outside dispatcher** | MEDIUM | Code review policy + test coverage |
| **Vercel route counting during migration** | LOW | Use redirects; old routes count only temporarily |

---

## PART 8: RECOMMENDED EXECUTION PLAN

### Week 1: Foundation & Cleanup
**Goal:** Free up 100-150 routes safely

Tasks:
1. [ ] Delete zombie/, survivor/, e2e/, admin/ page directories
2. [ ] Delete app/api/zombie/, app/api/survivor/ API directories
3. [ ] Move non-essential cron/admin routes to app/api/admin-internal/
4. [ ] Verify build script still works
5. [ ] Test production build locally
6. [ ] Commit: "Remove disabled game mode and internal routes"

**Expected route reduction:** 120 routes  
**Risk level:** LOW (already disabled by build script)

### Week 2: Consolidation Infrastructure
**Goal:** Build dispatcher framework

Tasks:
1. [ ] Create lib/dispatch/ base infrastructure
2. [ ] Create lib/leagues/dispatch.ts skeleton
3. [ ] Create lib/ai/dispatch.ts skeleton
4. [ ] Create lib/concepts/dispatch.ts skeleton
5. [ ] Write dispatcher tests
6. [ ] Document dispatcher contract
7. [ ] Commit: "Add dispatch infrastructure"

**Expected route reduction:** 0 (infrastructure only)  
**Risk level:** LOW (no breaking changes)

### Week 3: Prove Dispatcher Pattern
**Goal:** Consolidate 1-2 low-risk feature areas

Tasks:
1. [ ] Consolidate app/api/ai/* into /api/ai/[domain]/[action]
2. [ ] Update frontend AI callers (or use redirects)
3. [ ] Add test coverage
4. [ ] Monitor real usage
5. [ ] Commit: "Consolidate AI routes through dispatcher"

**Expected route reduction:** 40-50 routes  
**Risk level:** MEDIUM (frontend changes needed)

### Week 4: Consolidate Concept Leagues
**Goal:** Consolidate devy, big-brother, guillotine, etc.

Tasks:
1. [ ] Create /api/concept-leagues/[leagueId]/[concept]/[action] dispatcher
2. [ ] Consolidate devy routes
3. [ ] Consolidate big-brother routes
4. [ ] Consolidate guillotine/bestball/keeper routes
5. [ ] Update frontend callers
6. [ ] Commit: "Consolidate concept league routes"

**Expected route reduction:** 60 routes  
**Risk level:** MEDIUM (multiple feature areas)

### Week 5-6: League Resource Consolidation (MAIN EVENT)
**Goal:** Consolidate 348 league routes into dispatcher

Tasks:
1. [ ] Create /api/leagues/[leagueId]/[resource]/[action] dispatcher
2. [ ] Test with low-traffic resources first (awards, hall-of-fame, etc.)
3. [ ] Gradually migrate high-traffic resources (draft, finance, etc.)
4. [ ] Update frontend callers or use redirects
5. [ ] Load test with real volume
6. [ ] Commit: "Consolidate league resources through dispatcher"

**Expected route reduction:** 250+ routes  
**Risk level:** HIGH (large scope, many callers)

### Ongoing: Policy & Monitoring
1. [ ] Code review policy: ALL new league features use dispatcher
2. [ ] Monitor new route additions
3. [ ] Quarterly consolidation reviews

---

## PART 9: FILES THAT WOULD CHANGE

### New Files Created
```
lib/dispatch/base.ts (dispatcher base class)
lib/leagues/dispatch.ts (league dispatcher)
lib/leagues/services/airCommissionerService.ts (moved from route handlers)
lib/leagues/services/awardService.ts
... (40+ service files extracted from routes)
lib/ai/dispatch.ts
lib/ai/services/agentsService.ts
... (other AI service files)
lib/concepts/dispatch.ts
lib/concepts/services/devyService.ts
... (concept services)
app/api/leagues/[leagueId]/[resource]/[action]/route.ts
app/api/ai/[domain]/[action]/route.ts
app/api/concept-leagues/[leagueId]/[concept]/[action]/route.ts
app/api/cron/[job]/route.ts
__tests__/dispatch*.test.ts (new tests)
```

### Files Deleted
```
app/api/leagues/[leagueId]/ai-commissioner/*/route.ts (→ dispatcher)
app/api/leagues/[leagueId]/awards/*/route.ts (→ dispatcher)
... (340+ current league routes)
app/api/ai/*/route.ts (→ dispatcher, ~60 routes)
... (many more)
app/zombie/* (entire directory)
app/survivor/* (entire directory)
app/api/zombie/* (entire directory)
app/api/survivor/* (entire directory)
... (40+ routes)
```

### Files Modified
```
next.config.js (update redirects)
vercel.json (update if needed)
scripts/vercel-next-build.cjs (may simplify once cleanup done)
Frontend components calling old routes (update URLs)
... (50-100+ frontend files)
```

---

## PART 10: ESTIMATED IMPACT

### Route Reduction Summary
| Phase | Action | Routes Freed | Total Remaining |
|-------|--------|--------------|-----------------|
| Current | Baseline | - | 2,052 (over limit) |
| Phase 1 | Cleanup | -120 | 1,932 |
| Phase 2 | Infrastructure | 0 | 1,932 |
| Phase 3 | AI consolidation | -40 | 1,892 |
| Phase 4 | Concept consolidation | -70 | 1,822 |
| Phase 5 | League consolidation | -300 | 1,522 |
| **Target** | **Full consolidation** | **-530** | **1,522** |

### Safety Margins
- **Current:** 4 routes over (2,052 vs 2,048)
- **After Phase 1:** 200 routes under (1,932 vs 2,048)
- **After full consolidation:** 526 routes under (1,522 vs 2,048)
- **Growth headroom:** 25%+ capacity for new features

### Performance Impact
- **Positive:** Fewer files to load, single dispatcher logic, easier caching
- **Neutral:** Request handling time unchanged (logic moved, not removed)
- **Risk:** Dispatcher could become bottleneck (mitigated by service layer separation)

---

## PART 11: IMMEDIATE NEXT STEPS

### This Week (No Breaking Changes)
1. **✅ Audit Complete** — Document findings (this file)
2. [ ] Review disabled routes — confirm all are truly unused
3. [ ] List all zombie/survivor route files — prepare for deletion
4. [ ] Create memory note with consolidation strategy
5. [ ] Estimate effort: 4-6 weeks to full consolidation

### Action Items for Product/Design
1. [ ] Confirm zombie/survivor game modes are truly deferred (not launching soon)
2. [ ] Get sign-off on route consolidation strategy
3. [ ] Prioritize which concepts to consolidate first (devy, big-brother, etc.)
4. [ ] Plan frontend update timeline

### Action Items for Development
1. [ ] Schedule Phase 1 cleanup (low-risk deletions)
2. [ ] Create dispatcher infrastructure framework
3. [ ] Build comprehensive test strategy
4. [ ] Plan rollout with monitoring/alerts

---

## SUMMARY: ROUTE CONSOLIDATION STATUS

**Current Problem:** 2,052 routes (4 over limit)  
**Root Cause:** 348 league routes + 60 AI routes + 100+ concept routes are ungrouped  
**Safe Quick Win:** 120-150 routes by deleting disabled features  
**Full Solution:** 530+ routes freed by consolidation through dispatchers  
**Outcome:** 1,522 routes (26% under limit) + 25% growth headroom  
**Effort:** 4-6 weeks execution  
**Risk:** Medium (large refactor, gradual frontend updates)  
**Benefit:** Prevention of future route explosions, unified patterns for new features

