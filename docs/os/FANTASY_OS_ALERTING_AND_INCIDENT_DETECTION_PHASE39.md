# Alerting and Incident Detection Audit (Phase 39, Part 7)

## The central finding

**No outbound/proactive alerting mechanism exists anywhere in this codebase.** A targeted search (as part of the delegated audit, cross-checked directly) for Slack webhooks, PagerDuty, Opsgenie, alert-email sending, SMS/paging integrations, or any other push-based notification-on-failure mechanism found zero real code. This is a confirmed absence, not an inference from silence.

## What DOES exist: pull-based visibility only

| Mechanism | Real? | Nature |
|---|---|---|
| `prisma.syncJobRun` (via `withSyncJobRun()`) | Yes, real | Cron/import job outcomes (success/failure) are durably written to this table. A human can query it, but nothing pushes its contents anywhere. |
| Vercel function logs (`vercel logs`) | Yes, real | Every request/cron invocation's console output lands here, including well-structured JSON (e.g. the World Cup cron failure log from Part 5). Requires a human to actively run the CLI or open the dashboard. |
| `lib/production-health/ProductionHealthService.ts` + `app/admin/production-health/page.tsx` | Yes, real | An admin-only, human-visited dashboard aggregating health signals. **Per this Part's own guidance: "An analytics dashboard that nobody monitors is not an alerting system."** This is exactly that — a real, working dashboard with no confirmed viewing cadence, no escalation path, and no push notification of its own findings. |

## Direct proof this gap is not theoretical

The World Cup cron sync failure documented in Part 5 (Deployment Reality Audit) — real, live, recurring roughly every 5 minutes in production — would be **completely invisible** to anyone not actively running `vercel logs` or manually visiting `/admin/production-health`. It has, as far as this phase's evidence shows, been failing silently. The same is true for the 28 dead cron routes (Finding 1 of Part 5): each 404 is logged by Vercel, and nothing surfaces it.

## Classification

| Signal | Verified operational | Absent |
|---|---|---|
| Push/outbound alerting (Slack, PagerDuty, email, SMS) | | ✅ |
| Pull-based DB job-outcome visibility (`syncJobRun`) | ✅ (durable, queryable) | |
| Pull-based admin health dashboard | ✅ (exists, real) — but not an alerting system per this Part's own definition | |
| Automatic detection-and-notification of a live production failure | | ✅ |

## What this Part did not do

Building outbound alerting (a Slack webhook, an email-on-failure path, etc.) is explicitly the kind of "large observability vendor" or new cross-cutting mechanism this phase's guardrails caution against introducing without evidence/approval. This audit stops at documenting the real gap and its real, live-observed consequence (the undetected World Cup cron failures); it does not implement alerting this phase. This is the single highest-value recommendation carried into the Controlled Rollout Plan and the Observability Readiness Assessment.
