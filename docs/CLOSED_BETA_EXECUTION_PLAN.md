# Closed Beta Execution Plan

## Scope

This plan covers the production-ready AllFantasy NFL Redraft closed beta only.

Excluded from this phase:

- Decision OS
- Commissioner OS
- Manager OS
- World Cup
- Tournament
- new fantasy features
- architecture redesigns

This is a beta execution and operations document, not a new engineering roadmap.

## Beta Readiness Summary

Current classification:

- Ready for Closed Beta Deployment

What is already true:

- NFL Redraft runtime, provider orchestration, premium contracts, and operational safety gates have already passed RC2, RC3, and RC4.
- Commissioner controls, invite acceptance, premium enforcement, score sync, and provider validation all have passing targeted verification coverage.
- User-facing error handling exists for key invite, draft-control, and protected-route flows.

Main beta-execution risks are operational, not architectural:

- incomplete telemetry on some user actions
- operator/env setup discipline
- support workflow clarity
- normal closed-beta UX confusion from first-time commissioners/managers

## Launch Checklist

### Closed Beta Launch Checklist

- `[ ]` Production env vars verified
- `[ ]` Provider credentials verified
- `[ ]` `CRON_SECRET` / `LEAGUE_CRON_SECRET` verified
- `[ ]` `NEXTAUTH_SECRET` / `AUTH_SECRET` verified
- `[ ]` Stripe mode verified for intended environment
- `[ ]` staging DB safety check run before production deploy workflow
- `[ ]` migrations applied
- `[ ]` provider validation dashboard reviewed
- `[ ]` premium route checked for auth + entitlement behavior
- `[ ]` commissioner draft controls smoke-checked
- `[ ]` score-sync cron smoke-checked
- `[ ]` waiver-process cron smoke-checked
- `[ ]` support owner assigned
- `[ ]` bug triage owner assigned
- `[ ]` rollback contact + deployment owner assigned

### Beta Invitation Checklist

- `[ ]` beta cohort defined
- `[ ]` commissioner invite list approved
- `[ ]` manager invite expectations written
- `[ ]` known limitations shared before access
- `[ ]` support channel shared
- `[ ]` bug report template shared
- `[ ]` premium expectations explained honestly
- `[ ]` provider freshness/fallback behavior explained

### Commissioner Onboarding Checklist

- `[ ]` create league
- `[ ]` review scoring and roster settings
- `[ ]` confirm invite flow
- `[ ]` confirm placeholder/team claim behavior
- `[ ]` open mock or live draft room
- `[ ]` understand start, pause, resume, undo, reset timer controls
- `[ ]` understand draft pool warmup / readiness
- `[ ]` understand waiver schedule and trade approval behavior
- `[ ]` understand standings/playoff progression
- `[ ]` know where to find premium shells and provider status signals

### Manager Onboarding Checklist

- `[ ]` sign up / sign in
- `[ ]` accept invite or join by code
- `[ ]` claim correct team
- `[ ]` enter draft room
- `[ ]` review roster and matchup tabs
- `[ ]` save lineup
- `[ ]` submit waiver claim
- `[ ]` review / respond to trade
- `[ ]` check standings and playoff position
- `[ ]` know how premium locked states work

## Known Limitations

These should be communicated proactively during closed beta:

1. Provider-backed enhancement data can degrade gracefully.
   - Rolling Insights is the backbone.
   - Other providers may fall back to cache or unavailable states.
   - Missing enhancements should not break league runtime.

2. Local Windows build repeatability is still noisy.
   - This affected validation ergonomics during release gating.
   - It is not currently classified as an NFL Redraft shipping blocker.

3. Some user journeys are better observed through audit/runtime data than product analytics today.
   - This is most visible in joins, lineup saves, waiver claim submission, and premium usage detail.

4. Beta users may encounter honest unavailable states.
   - weather
   - valuations
   - media/news
   - premium evidence freshness

5. Premium beta should be positioned as facts-first.
   - no OS advice
   - no recommendation engine
   - no automated decisioning

## Support Process

### Support Workflow

1. Intake
   - User reports issue through designated beta channel or bug form.
   - Collect league ID, user ID/email, page/route, timestamp, screenshot, and repro steps.

2. Classification
   - `P0` service outage / commissioner blocked / draft blocked / scoring corruption
   - `P1` major workflow degradation with workaround
   - `P2` confusing UX / partial feature issue / stale provider surface
   - `P3` polish / backlog item

3. Triage
   - Check provider validation dashboard
   - Check premium route behavior if premium-related
   - Check league audit logs for lifecycle/commissioner actions
   - Check cron/provider freshness if scoring or waiver related

4. Response
   - acknowledge within beta support SLA
   - provide workaround when available
   - escalate production-severity issues immediately

5. Resolution
   - confirm user-visible outcome
   - log whether issue was product bug, provider outage, env misconfig, or user confusion

### Bug Reporting Workflow

Required bug report fields:

- summary
- leagueId
- userId or account email
- role: commissioner or manager
- page / route
- exact action attempted
- expected result
- actual result
- timestamp with timezone
- screenshot or screen recording if possible

Recommended labels:

- `beta-blocker`
- `commissioner`
- `manager`
- `draft`
- `waiver`
- `trade`
- `score-sync`
- `playoffs`
- `premium`
- `provider`
- `env`
- `support-content`

## Beta v1 Release Notes

### What Beta Users Get

- full NFL Redraft league lifecycle
- commissioner setup and draft controls
- roster, waivers, trades, matchups, standings, playoffs
- provider-backed canonical player/game/live data
- premium facts-only service shells
- provider validation and fallback-aware runtime

### What Is Intentionally Not In Scope

- AI recommendations
- automated commissioner/manager agents
- OS products
- non-redraft league launch quality

### Beta Positioning

AllFantasy Closed Beta v1 is focused on proving that an NFL Redraft league can run cleanly from setup through championship using canonical runtime data, provider-backed enrichment, and premium facts-only surfaces.

## Analytics And Observability Review

## What Is Tracked Well

### League creation

Good coverage exists:

- client + server create-league funnel events in `lib/analytics/eventNames.ts`
- server persistence via `recordProductEvent(...)` in canonical league creation flow
- league creation audit logging via `server/services/auditService.ts`

### Draft lifecycle

Good coverage exists:

- draft-room client beacons:
  - draft start
  - picks
  - queue actions
  - search/sort/filter
  - invite copy
  - commissioner auto-pick controls
- engine events and sampled draft telemetry
- draft completion engagement event

### Trade processing

Good coverage exists:

- `ENGAGEMENT.TRADE_PROCESSED`
- trade audit/logging paths
- premium/provider certification coverage

### Waiver processing

Moderate coverage exists:

- waiver processing runtime is covered
- cron/process behavior is verified
- waiver run completion event exists

Gap:

- claim submission/user intent telemetry is less explicit than final waiver-run telemetry

### Premium routes / premium usage

Moderate coverage exists:

- premium auth, enforcement, and observability are covered
- provider evidence observability is covered

Gap:

- premium usage is not yet described as a simple business-facing funnel by service and tier in the current closed-beta docs

## Gaps To Note Before Inviting Users

### Join / invite telemetry

Partial coverage:

- invite engine records invite events
- `/join/[token]` emits `engagement.join_invite.team_claim`

Gap:

- generic join-by-code success/failure for all join paths is not obviously unified into one product analytics stream

### Lineup saves

Gap:

- lineup save behavior exists in runtime/event mapping, but closed-beta monitoring is not yet documented as a first-class product metric

### Playoff advancement

Gap:

- playoff runtime exists and is verified
- explicit product-facing telemetry for playoff advancement/champion completion is not clearly surfaced as a beta dashboard metric

### Commissioner / manager success funnel

Gap:

- there is not yet one explicit closed-beta KPI view for:
  - league created
  - invite accepted
  - draft completed
  - lineup saved
  - waiver claim submitted
  - trade processed
  - playoffs advanced

## Recommended Beta Telemetry Priority

### Critical

- league created
- join accepted
- draft started
- draft completed
- lineup saved
- waiver claim submitted
- waiver process completed
- trade submitted
- trade processed
- playoff bracket generated
- playoff round advanced
- champion crowned

### Important

- commissioner settings save
- invite copy
- premium service opened by service type
- premium access denied by tier
- premium response with stale/fallback warnings

### Nice-to-have

- empty-state impressions
- retry-after-error actions
- support CTA clicks

## Error Handling Review

## Good Enough For Beta

### Invite acceptance

The dedicated invite accept flow provides:

- invalid invite state
- expired/full state
- sign-in requirement messaging
- redirect feedback after success

### Join-by-code flow

The join flow provides:

- empty code prompt
- password-protected join handling
- preview error state
- generic fallback for creator-league join
- retry copy

### Commissioner draft actions

`useCommissionerActions` provides:

- specific success banners
- actionable network retry copy
- `POOL_NOT_READY` explanation
- confirm dialogs for destructive-ish actions like undo/reset

## Beta Issues To Watch

### Critical

- none verified in this review pass

### Important

- some failures still collapse to generic copy like `Something went wrong`
- some routes return raw error strings from service layers, which is acceptable for beta but worth watching for clarity/consistency
- telemetry is stronger for background jobs than for all first-class user actions

### Nice-to-have

- more explicit success confirmations after lineup-save / waiver-claim submission in every surface
- richer empty-state instrumentation

## First-Time User Experience Review

## First-Time Commissioner

### Strengths

- create league and commissioner controls are grounded in canonical flows
- draft controls have explicit confirmations and success messaging
- provider/premium contracts are honest about fallback and freshness

### Confusing / high-friction areas

#### Important

- draft pool readiness / warmup may be surprising without onboarding copy
- provider freshness/fallback concepts may be obvious to us and not obvious to commissioners
- invite behavior spans multiple paths (`/join`, `/invite/accept`, claim-team flows), which may create support confusion

#### Nice-to-have

- a concise “first 5 things to do” commissioner checklist should be shared before access

## First-Time Manager

### Strengths

- invite accept and join pages have reasonable messaging
- manager journey routes are already part of the validated redraft shell/runtime

### Confusing / high-friction areas

#### Important

- manager may not understand difference between accepting an invite, joining by code, and claiming a team placeholder
- premium locked states need expectation-setting so users do not assume broken features

#### Nice-to-have

- a one-screen “how to get started in your league” support article would reduce avoidable tickets

## Closed Beta Documentation Pack

## Required User-Facing Docs

### Commissioner docs

- how to create a league
- how to invite managers
- how the draft room works
- how to start/pause/resume/reset a draft
- how waivers and trades are processed
- how playoffs advance
- how premium facts-only surfaces work

### Manager docs

- how to accept an invite
- how to claim the correct team
- how to set a lineup
- how to submit waivers
- how trades work
- where to look for matchup, standings, and playoff context

### Troubleshooting / FAQ

- invite link invalid / expired
- already in league
- league full
- draft pool warming / not ready
- provider data unavailable / stale
- premium feature locked
- score/waiver update timing expectations

## Suggested Internal Doc Set

- this execution plan
- RC4 operational readiness section in `ENGINEERING_STABILIZATION_REPORT.md`
- staging / env / migration check docs already in repo
- provider validation dashboard usage notes

## Beta Success Criteria

## Core Success Metrics

- at least one commissioner completes league creation without operator intervention
- at least one commissioner completes a full live draft
- invited managers successfully join and claim teams
- managers successfully save lineups
- users successfully submit waiver claims
- at least one trade reaches processed/finalized state
- standings update correctly after scoring sync
- playoff qualification/bracket generation completes
- playoff advancement completes through champion crowning
- provider refresh jobs complete without production-severity fallout
- premium routes return stable, facts-only packets for entitled users
- zero production-severity data corruption issues

## Operational Success Metrics

- no `P0` incidents during beta week one
- no unresolved commissioner-blocking defects at end of beta week one
- support can classify incoming issues using the workflow above
- provider outages degrade gracefully rather than crash league runtime

## Production Launch Criteria

Recommend production launch only after closed beta demonstrates:

1. commissioners can create, draft, and operate leagues without staff hand-holding
2. managers can join, set lineups, and use core season flows without severe confusion
3. telemetry gaps for key actions are either filled or replaced by reliable manual/audit reporting
4. no scoring, standings, waiver, trade, or playoff corruption incidents occur
5. provider fallback behavior is understood and supportable
6. premium entitlements remain correct under real-user traffic

## Recommended Next Steps Before Invites Go Out

1. Assign named beta owner, support owner, and deployment owner.
2. Share commissioner and manager onboarding checklists as part of invite messaging.
3. Decide which telemetry gaps are acceptable for beta and which need manual monitoring.
4. Stand up a single beta issue tracker with the labels above.
5. Run one final production-like smoke on invite, draft start, waiver process, score sync, and premium access.
