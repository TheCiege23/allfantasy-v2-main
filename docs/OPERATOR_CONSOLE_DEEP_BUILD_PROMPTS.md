# Operator Console — Deep-Build Prompts

One prompt per section that isn't already fully live. **Run after cutover.** Do **one section per
session/PR** — they're independent.

**How to use:** paste the **Shared header** first, then that section's block directly beneath it.

**Already live (no prompt needed):** Overview, Attention, Platform OS, Chimmy, Users, Data Providers,
Sports Data, Communications, Subscriptions, Tokens. The **14 below** are the ones with real build work
left.

---

## Shared header — paste above every section prompt

```
You are deep-building ONE section of the AllFantasy operator console
(app/admin/operator/). The shell, nav, auth gate, and honesty primitives already
exist — you are filling in one section's body with real functionality. Rules for
every section:

REUSE, DON'T REBUILD
- The console already reuses existing admin data services and panels. Before
  writing anything, find the service(s) and DB models that back this section
  (search lib/admin-dashboard/, components/admin/, prisma/schema, /api/admin/*).
  Wire to those. Do not create a parallel data layer.

HONESTY OVER FAKE GREEN (non-negotiable)
- Render REAL data, or render "Not configured" / "Unknown" — never a green 0 or
  a fabricated metric. If a number isn't actually measured, say so.
- Update this section's status in lib/admin-dashboard/operatorNav.ts ONLY to
  match reality: promote planned->partial or partial->live only when the body
  genuinely renders real data. If gaps remain, keep it "partial" and LABEL the
  gaps in the UI.

INTEGRATION
- Keep the same server-side auth gate (getAdminAccessState) — signed-out /
  non-admin must still hit the neutral "Access denied" screen with zero leak.
- Match the existing operator UI primitives (components/admin/operator/) and the
  env-badge / attention-queue behavior. Don't fork the design.

VERIFY BEFORE FINISHING
- Zero NEW tsc errors over the repo's ~15-error pre-existing baseline (two
  unrelated WIP files). Run the full typecheck and confirm the delta is zero.
- Route compiles and serves with no console/runtime errors.
- Dev-server gotcha: other sessions run dev servers on ports 3000/3100 against
  the shared tree/.next — do NOT start a second `next dev` on a shared distDir;
  use the isolated next-dev-myteam config (AF_NEXT_DIST_DIR, .next-myteam-3100)
  or point the browser at an already-running server.
- Show me the diff before finalizing, and state honestly what's real vs. still
  stubbed.

THE SECTION TO BUILD IS BELOW.
```

---

# Partial sections — finish the labeled gaps

## Leagues
```
SECTION: Leagues (currently "partial").
Goal: a real league operations view — search/lookup a league, then see its
detail (sport, members, status, health, recent activity) and any per-league
problems.
Wire to: AdminLeagueManagementService and getActiveLeaguesBySport (confirm the
exact APIs).
HONESTY CONSTRAINT (important): PlatformOsOperatorPanel deliberately never
auto-discovers leagues. Do NOT fabricate an "all leagues" global feed if the
platform can't cheaply enumerate them. Prefer real search/lookup by league ID or
name, plus the real per-sport active counts you can actually compute. If a full
listing isn't backed by a real query, mark it as a labeled gap.
Done when: an operator can find a real league and see real detail; counts match
the old /admin; no fabricated global list.
```

## Imports
```
SECTION: Imports (currently "partial").
Goal: an import operations center — real import job history with status
(queued/running/succeeded/failed), timestamps, source, and row counts; retry or
inspect a job where a real action exists.
Wire to: whatever import/sync job infra exists (check AdminSportsSyncService,
provider import routes, and any job/queue tables in prisma/schema).
Done when: real recent import jobs render with real statuses; failed jobs are
visible; any action button maps to a real endpoint (or is omitted, not faked).
```

## Decision OS
```
SECTION: Decision OS (currently "partial").
Goal: surface the real Decision OS controls/telemetry. FIRST discover what
Decision OS actually is in this codebase (search for "decision" services,
routes, panels) and what an operator is meant to do with it.
Wire to: the real Decision OS service(s) you find.
Done when: the section shows real Decision OS state/controls; anything not yet
backed by real logic stays a labeled placeholder, not a mock.
```

## Automation
```
SECTION: Automation (currently "partial").
Goal: a real cron/automation registry — each scheduled job with last-run,
next-run (if known), last status, and failure surfacing. The overview's
Attention Queue already derives "cron gaps," so reuse that signal source.
Wire to: the cron/automation definitions and run history (search for the cron
registry, scheduled jobs, and the code that feeds cron-gap detection).
Done when: real jobs list with real last-run/status; stale or failed jobs are
flagged; no invented "next run" times you can't actually compute (mark Unknown).
```

## Payments
```
SECTION: Payments (currently "partial").
Goal: real payment operations — recent transactions/charges, refunds, disputes,
and failures, plus payment-processor health.
Wire to: the real payment layer (Stripe integration + PaymentTokenHealthPanel;
confirm what's actually integrated).
HONESTY: MRR / revenue rollups were flagged as "not configured" — do NOT render
a fake MRR. Show only what's actually queryable; label the rest.
Done when: real transactions/refunds/disputes render; processor health is real;
no fabricated revenue metric.
```

## Moderation
```
SECTION: Moderation (currently "partial").
Goal: a working moderation queue — real flagged/reported items with context, and
moderator actions (approve/remove/escalate) where a real action endpoint exists,
plus recent moderation history.
Wire to: AdminModerationBridge (confirm its API and which actions it supports).
Done when: the real queue renders; actions map to real endpoints (or are omitted,
not faked); history is real.
```

## Security
```
SECTION: Security (currently "partial").
Goal: a real security overview for operators — the admin allowlist / isSiteAdmin
state, active admin sessions, recent admin sign-ins, and any failed-access or
suspicious-access signals the platform records.
Wire to: getAdminAccessState / requireAdmin internals, the admin_session model,
and any access-audit records (AdminAuditLog may cover admin actions).
HONESTY: only show security signals actually recorded. Don't invent
"threats blocked" style metrics.
Done when: real allowlist + session + recent-admin-activity data render; gaps
labeled.
```

## Audit Logs
```
SECTION: Audit Logs (currently "partial", backed by the real AdminAuditLog model).
Goal: a full audit-log explorer — a paginated table of real AdminAuditLog events
with filters (by actor, action type, date range) and CSV export.
Wire to: the AdminAuditLog model directly (confirm its columns).
Done when: real events paginate and filter; export produces a real CSV; the
empty-filter state is honest (no fake rows).
```

## Feature Flags
```
SECTION: Feature Flags (currently "partial", backed by getPlatformConfigSnapshot).
Goal: view AND toggle real feature flags — grouped, with current values from
getPlatformConfigSnapshot, a real write path to flip a flag, and an audit entry
written on change.
Wire to: getPlatformConfigSnapshot (read) + the underlying feature-toggle/config
store (write). Confirm a safe write path exists before enabling toggles.
HONESTY: if a flag is read-only or environment-locked, show it as read-only —
don't render a toggle that silently no-ops. Make env scope explicit (a PROD flag
change must be unmistakable).
Done when: real flags render with real values; toggles that write actually
persist + audit; read-only flags are labeled.
```

## Support Tools
```
SECTION: Support Tools (currently "partial").
Goal: real operator support utilities — look up a user/account, view their key
state, and perform real support actions that already exist (e.g. resend a token
or email, inspect a subscription, reset a specific stuck state).
Wire to: existing user-management + email/token services (AdminUserManagement*,
AdminEmailCenter*, token services). Only expose actions with a real backing
endpoint.
Done when: real lookup works; each tool maps to a real action; no button that
does nothing.
```

## System Settings
```
SECTION: System Settings (currently "partial").
Goal: real platform configuration — view current config (from the same snapshot
source as feature flags) and edit the settings that have a safe write path, with
an audit entry on change and explicit environment scoping.
Wire to: getPlatformConfigSnapshot + the config store's write path.
HONESTY: read-only / derived settings must be labeled read-only. A PROD-affecting
change must be unmistakable and confirmed.
Done when: real config renders; editable settings persist + audit; read-only ones
are clearly marked.
```

---

# Planned sections — build from scratch, honestly

## Draft Operations
```
SECTION: Draft Operations (currently "planned" — honest placeholder only).
Goal: a real draft-monitoring view — active/scheduled/completed drafts, per-draft
status and health, and any stuck-draft signals.
FIRST: discover whether draft infra + queryable draft state exists (search for
draft services/models/routes).
- If real draft state exists: wire it and promote to partial/live.
- If it does NOT: keep an honest placeholder stating drafts aren't yet
  instrumented for operator view — do NOT build a mock dashboard of zeros.
Done when: either real draft data renders, or the section honestly states the
gap. No fabricated draft feed.
```

## Legacy & Rankings
```
SECTION: Legacy & Rankings (currently "planned").
Goal: an operator view over the legacy data + rankings surface — e.g. the legacy
read path (there is a /api/legacy/* surface) and ranking data health/counts.
FIRST: discover the real legacy + rankings data sources (search /api/legacy/*,
rankings services/models).
Wire to: those real sources — show real counts/health (e.g. legacy players
served, rankings freshness).
HONESTY: show only real, queryable figures; label anything not yet wired.
Done when: real legacy/rankings figures render; gaps labeled.
```

## Incidents
```
SECTION: Incidents (currently "planned"; "Open Incidents" currently renders
"Not configured").
Goal: a real incident tracker. FIRST decide the honest source of truth:
- If the platform already has an error/incident source (a Sentry integration,
  error-log tables, an existing status/incident store), wire to it.
- If nothing exists, either (a) build a minimal PERSISTED incident model
  (create/list/resolve incidents, stored in the DB) and wire the UI to it, or
  (b) keep the honest "Not configured" placeholder.
Do NOT render a fake incident dashboard. If you add a model, keep it real:
incidents an operator actually creates/resolves, persisted and audited.
CONFIRM the chosen approach with the owner before creating a new DB model.
Done when: either a real incident source drives the section, or a real persisted
tracker does, or the section honestly stays "Not configured." No fabrication.
```

---

## Enhancing the 10 live sections (optional, later)
Overview, Attention, Platform OS, Chimmy, Users, Data Providers, Sports Data, Communications,
Subscriptions, and Tokens are already real. To deepen one (filters, bulk actions, drill-in views),
ask for a targeted prompt — they don't need one now.
