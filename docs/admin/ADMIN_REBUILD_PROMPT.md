# Admin Rebuild — Execution Prompt

**This prompt is for AllFantasy only — the repo at `F:\allfantasy-v2-main` (package.json name `allfantasy-ai`).** Do not run it in any other repository. Start the session rooted in that folder:

```
cd F:\allfantasy-v2-main
claude
```

Then paste everything in the block below into **Claude Code, running on that repo** (desktop app → *Run this task → On your computer*, so edits to tracked files persist and `typecheck`/`build`/`git` run locally). It fixes the audit findings (F1–F20), wires in the already-delivered traffic/globe/API-health features, and rebuilds the admin visually as a tabbed console.

---

```
REPO GUARD — STOP AND VERIFY BEFORE YOU DO ANYTHING
This prompt is ONLY for the AllFantasy repo (a fantasy-sports / OS platform) at
F:\allfantasy-v2-main. Before writing a single file, confirm ALL of these landmarks in the
CURRENT working directory. If ANY of them fails, STOP immediately, write NOTHING, create no
branch, and tell me you are in the wrong repo — do NOT adapt this prompt to a different app:
  - package.json "name" is "allfantasy-ai"
  - app/admin/page.tsx exists and is ~1,800+ lines (the monolith this prompt rebuilds)
  - these already-delivered files exist (I created them in a prior session):
      lib/admin-dashboard/VisitorAnalyticsService.ts
      lib/admin-dashboard/ApiHealthService.ts
      app/api/admin/visitor-analytics/route.ts
      app/api/admin/api-health/route.ts
      components/admin/VisitorAnalyticsPanel.tsx
      components/admin/VisitorGlobePanel.tsx
      components/admin/ApiHealthPanel.tsx
      lib/analytics/recordSiteVisit.ts
  - dependencies present in package.json: recharts, react-simple-maps, cmdk, @sentry/nextjs
  - the source tree contains fantasy/commissioner/waiver/sports-os domain code
    (e.g. components/admin/PlatformOsOperatorPanel.tsx, lib/sports-os/*, platform-backend/)
This is fantasy-sports/OS specific. If you are in a meditation app, a different admin, or any
repo missing the landmarks above, it is the WRONG repo — refuse and stop.

ROLE
You are rebuilding the AllFantasy admin panel. The app has pivoted from fantasy-sports
leagues to an OS platform (Decision/Commissioner/Fantasy OS) on a partner API (/api/v1).
The current admin is a single 1,822-line app/admin/page.tsx that is strong on sports-data
QA but has no OS/API surface, a binary auth model, no admin audit log, and no traffic
charts, globe, or API-health view. Fix that and rebuild it visually into a tabbed console.

GROUND RULES (follow exactly)
- BASELINE FIRST — the tree is NOT clean. Expect ~700 uncommitted paths on branch
  fix/access-tier-and-landing (or similar), and docs/admin is untracked. Before changing
  anything:
    1. Run `npm run typecheck` and `npm run build` and RECORD the result. This is your baseline.
    2. If the baseline is already red, capture the exact pre-existing errors. Those do NOT count
       against your work — NEVER chase pre-existing breakage to force a gate green. A phase is
       "green" if it introduces NO NEW typecheck/build errors beyond the recorded baseline.
    3. Branch from here: `git checkout -b feat/admin-rebuild`. It will carry the existing
       uncommitted files — that is expected; do not try to revert or "clean" them.
    4. Commit this prompt + the delivered docs so a stray `git clean` can't lose them:
       `git add docs/admin && git commit -m "docs(admin): rebuild prompt + wiring guide"`.
- Commit in small, focused sets with `git add <specific files>` only — the tree has many
  unrelated uncommitted paths; never `git add -A`.
- After EVERY phase, `npm run typecheck` && `npm run build` must show NO NEW errors beyond the
  recorded baseline (a red baseline stays exactly as red — you fixed nothing and broke nothing).
  Where tests exist for a touched area, run them. Do not start the next phase until this holds.
- REUSE, don't rip out. Keep the working services in lib/admin-dashboard/* and
  lib/sports-os/*, the getAdminCommandCenterMetrics pipeline, adminAuth, FeatureGate,
  the existing data-mode design tokens in app/globals.css + tailwind.config.js, and the
  white-label/tenant theming. This is re-skin + restructure + new panels, not greenfield.
- No new npm dependencies are required. recharts, react-simple-maps,
  @types/topojson-specification, and @sentry/nextjs are already in package.json.
- Preserve behavior of the degraded/failure fallback and admin access gating.
- Privacy: never render or send raw IP addresses to the client.

ALREADY DELIVERED — WIRE THESE IN FIRST (they already exist in the repo)
- lib/admin-dashboard/VisitorAnalyticsService.ts  (time-bucketed unique/total + globe points)
- app/api/admin/visitor-analytics/route.ts         (GET ?window=6h|12h|24h|7d|1mo|6mo|12mo)
- lib/admin-dashboard/ApiHealthService.ts           (DB ping + self-checks + readiness→errors)
- app/api/admin/api-health/route.ts
- components/admin/VisitorAnalyticsPanel.tsx         (recharts total-vs-unique combo chart)
- components/admin/VisitorGlobePanel.tsx             (react-simple-maps orthographic globe)
- components/admin/ApiHealthPanel.tsx                (service table + latency chart + errors)
- lib/analytics/recordSiteVisit.ts                  (hashed-IP per-hit logger)
- docs/admin/VISITOR_ANALYTICS_AND_API_HEALTH.md    (the exact wiring + migration steps)

===========================================================================
PHASE 1 — Traffic charts, globe, API health (wire the delivered files)
===========================================================================
1. Add the SiteVisit model to prisma/schema.prisma (see the doc above), create + run the
   migration (`npx prisma migrate dev --name add_site_visit`), regenerate the client, and
   add SITE_VISIT_SALT to .env / .env.example / staging / prod env.
2. In app/api/track-visitor/route.ts, import recordSiteVisit and call
   `void recordSiteVisit(ip, { path: request.headers.get("referer") })` after `ip` is resolved.
3. Render VisitorAnalyticsPanel, VisitorGlobePanel, and ApiHealthPanel in the admin (for now,
   as AccordionSections right after the existing TrafficGeoPanel — they get moved into tabs
   in Phase 2). Confirm: window switcher 6h→12mo works; bars=total, line=unique; globe spins
   and shows bubbles + top countries; API health lists services, latency chart, and errors.
4. Verify typecheck + build. Commit.

===========================================================================
PHASE 2 — Restructure into a tabbed, role-aware console (F1, F2, F3, F17)
===========================================================================
Split the monolith app/admin/page.tsx into a shared shell + route segments. Do NOT lose any
existing panel — move each into the right tab.
- Create app/admin/layout.tsx with a persistent left rail (or top tabs) + the AF shield,
  access-source chip, "generated at", and global search box. Mobile: collapsible.
- Create these segments, each its own page.tsx that fetches only its own data with per-section
  <Suspense> so one failing dependency can't grey out the page:
    /admin                 → ① Overview  (cross-cutting KPIs + unified attention queue + recent admin activity)
    /admin/growth          → ② Growth & Users (signups/DAU/MAU trends, user search, traffic + GLOBE)
    /admin/monetization    → ③ Subscriptions, payments, tokens, + tier→entitlement matrix (Phase 4)
    /admin/os              → ④ OS Operations (Phase 3)
    /admin/api             → ⑤ Partners & API (Phase 3)
    /admin/tenants         → ⑥ B2B tenants (Phase 4)
    /admin/data            → ⑦ Sports Data (identity/image health, provider recon, import matrix, freshness, sync)
    /admin/platform        → ⑧ Platform & Reliability (env/cron, API HEALTH, outbox/queue, Sentry/SLO, feature flags)
    /admin/trust           → ⑨ Trust & Safety (integrity/fraud, moderation, duplicate-verify, admin audit log)
- Extract the ~20 inline panel components and ~15 helpers out of page.tsx into
  components/admin/* and lib/admin-dashboard/* modules so no file exceeds ~400 lines.
- Gate each tab + each destructive action by permission (see Phase 5 RBAC). Until RBAC lands,
  stub a single `can(permission)` that returns true for admins so the wiring is in place.
- Verify + commit per segment.

===========================================================================
PHASE 3 — OS Operations + Partners & API (the pivot, F8–F15)
===========================================================================
④ OS Operations (/admin/os): one row per OS — Decision, Commissioner, Trade, Waiver, Draft,
  Manager, League, Platform. Columns: adoption (users+leagues, 7/30d), invocations/day trend,
  p50/p95 latency, error rate, token spend, entitlement tier + preview→upgrade conversion,
  data-readiness (reuse SportsOperatingSystem readiness signal). Fold in the existing
  PlatformOsOperatorPanel as the league drill-down, decision-os/telemetry as Decision OS's
  live numbers, and the Chimmy intent routes sub-panel. Add a Commissioner-OS aggregate
  (leagues on it, automation runs/failures, health-alert volume).
⑤ Partners & API (/admin/api): partner directory (name, plan, status, sandbox vs prod);
  API key lifecycle (issue/rotate/revoke + scopes; promote sandbox/partner/test-key-metadata to
  managed keys); per-partner usage & quotas; /api/v1 endpoint health (volume, p50/p95, 4xx/5xx
  per route); rate-limit/abuse view + block/allow; version adoption + deprecation feed; widget/
  embed usage; billable-call CSV export (reuse lib/admin-dashboard/CsvExport.ts).
Build the read services first (real data where it exists; clearly-labeled "not tracked yet"
where it doesn't — never fabricate numbers). Verify + commit each.

===========================================================================
PHASE 4 — Monetization, entitlements/flags, tenants (F9, F10, F16)
===========================================================================
- ③ Add a tier→entitlement matrix viewer (Free/Pro/Commissioner/War Room/Supreme + Tokens),
  per-user/tenant entitlement override, and MRR/churn trend charts (recharts).
- ⑧ Add a feature-flag admin so gates like FANTASY_OS_SPORTS_DATA_OBSERVABILITY_ENABLED can be
  toggled without a deploy (DB-backed flags with an env fallback).
- ⑥ Tenants: directory + onboarding + per-tenant KPIs (DAU/MAU, retention, churn, league
  health), branding config, entitlement assignment. Reuse resolveTenantBrand + Fantasy OS.
- Add 7/30-day trend sparklines to the headline KPIs everywhere (F16).
Verify + commit.

===========================================================================
PHASE 5 — Foundations: RBAC + admin audit + guarded actions (F4, F5, F6, F7)
===========================================================================
- RBAC: extend platform-backend/contracts/permissions.ts + core/permission-guard.ts to admin.
  Roles: support, finance, data-ops, partner-ops, super-admin. Replace the stub `can()` with
  real checks; gate every tab and every mutation.
- Admin audit log: write an immutable record (actor, action, target, before/after, timestamp,
  correlationId) on every admin mutation; render a searchable feed in ⑨ Trust & Safety.
- Guarded actions: convert the copy/paste "POST this JSON" panels (sports sync, email
  broadcast, reputation recompute, world-cup actions, key revocation) into typed forms with
  dry-run ON by default, an "affects N" preview, explicit confirm, and a result toast.
- Replace the shared ADMIN_PASSWORD/BRACKET_ADMIN_SECRET machine auth with scoped, rotatable
  keys — the same key system built for partners in Phase 3.
Verify + commit.

===========================================================================
PHASE 6 — Reliability, backend, and the full VISUAL rebuild (F14, F18, F19, F20)
===========================================================================
- ⑧ Platform-backend observability: outbox lag (af_domain_events age/count), worker heartbeats
  (workers/job-topology), dead-letter + replay, idempotent-replay rate, correlation-id trace lookup.
- ⑧ Reliability: Sentry error rate + top exceptions + deep links; simple SLO burn view.
- Global search (F20): command-palette (cmdk is already a dep) across users, leagues, tenants,
  partners, API keys, transactions.
- Rename all "AI" wording → Intelligence / Chimmy / OS (F18).

VISUAL SYSTEM (apply across every tab — this is the "rebuild visually" part):
- One design system, reusing the existing data-mode tokens (--bg/--panel/--border/--text/
  --muted/--purple/--cyan/--blue + AF shield in public/brand). Add any missing LIGHT-mode
  parity so both themes look right; keep white-label overrides winning.
- Consistent primitives: MetricCard (with optional trend sparkline), Panel/Section, StatusPill
  (operational/degraded/down/unknown + ready/partial/missing use ONE shared color scale),
  DataTable (sticky header, zebra hover, horizontal scroll), Chart wrappers (dark tooltip,
  muted grid, cyan/emerald/amber series) — extract to components/admin/ui/*.
- All charts use recharts with the shared theme (see VisitorAnalyticsPanel/ApiHealthPanel as
  the reference style). All status colors come from the shared scale — no ad-hoc hex per panel.
- Responsive down to mobile; every interactive target min-h 44px; keyboard-focus rings; the
  left rail collapses. Respect prefers-reduced-motion (pause globe auto-spin).
- Keep the dark command-deck aesthetic (radial-glow background, rounded-3xl glass panels) but
  make it consistent everywhere instead of per-panel one-offs.

FINAL VERIFICATION
- npm run typecheck && npm run build both green.
- Load every /admin/* tab in light AND dark; confirm no panel crashes the page when its data
  source is empty (each degrades with a labeled empty state).
- Confirm no raw IPs anywhere in client payloads.
- Open a short PR summary listing which findings (F1–F20) each commit closed.

DELIVERY
Report back with: the branch name, the commit list mapped to findings, anything you couldn't
complete and why, and any decisions you made that I should confirm (e.g., final tier→entitlement
mapping, which endpoints count as "core" for API health).
```

---

## How to use it

Run it **on your computer**, in a session rooted at `F:\allfantasy-v2-main` (desktop app → *Run this task → On your computer*), so the tracked-file edits stick and `typecheck`/`build`/`git` work. The REPO GUARD at the top makes the agent verify it's in the AllFantasy repo — `name: "allfantasy-ai"`, the 1,800-line admin monolith, the eight delivered files, and the fantasy/OS domain — and refuse if it's anywhere else (e.g. the ChimAura meditation app at `F:\ai-meditation-app-main`). It's phased on purpose — you can stop after any phase and still have a shippable improvement. Phase 1 alone gives you the charts, globe, and API health you just asked for; Phases 2–6 do the full visual rebuild and the OS/API pivot.

If you'd rather keep it lighter, tell the agent to run **Phases 1–2 only** (features + tabbed visual rebuild) and skip the deeper pivot/RBAC work for later.
