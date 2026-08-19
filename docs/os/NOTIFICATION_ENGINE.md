# Phase OS-B4 — Notification Engine Foundation

"Decision OS owns intelligence. Daily Brief owns digest composition. Notification Engine owns
delivery-ready notification objects. Commissioner OS only displays them." This phase establishes the
notification layer as a clean consumer of Attention Signals and Daily Briefs — not a new intelligence
engine, and (per its own explicit exclusion) not a delivery system either.

## 1. What was built

- **`lib/decision-os/notifications.ts`** — the reusable Notification model. Pure, zero-I/O —
  `notificationFromSignal`/`notificationFromDailyBrief`/`sortNotifications`/`composeNotificationFeed`
  transform already-produced `DecisionOsAttentionSignal[]`/`DailyBrief` into `DecisionOsNotification[]`.
  Never recomputes severity, title, or body — every field is reused verbatim from its source.
- **`lib/decision-os/notificationResolver.ts`** — the standalone `resolveNotificationFeed(leagueIds, now)`
  for a future consumer with no existing fetched signals/brief (a push/email delivery job, a mobile
  client, Platform OS).
- **`components/decision-os/NotificationCenter.tsx`** — the in-app Notification Center. Purely
  presentational over a `DecisionOsNotification[]` prop, with session-local (`useState`, not persisted)
  read/dismiss state.
- **`components/decision-os/CommissionerCommandCenterSection.tsx`** (modified) — composes the
  notification feed from data it already fetched/composed for its sibling cards (the snapshot's
  `attentionQueue` and the already-composed `brief`), zero additional request. Renders
  `<NotificationCenter>` after the Attention Queue / Recent Changes grid.
- **`components/decision-os/DecisionOsCardPrimitives.tsx`** (modified) — added a shared
  `SEVERITY_DOT_CLASS` export (and its own local `DecisionOsSeverityLabel` type, kept independent of
  `attentionSignals.ts` to keep this shared UI-primitives file free of business-domain imports). This is
  the third component needing the exact same severity-color mapping
  (`CommissionerAttentionQueue`/`TodaysBriefCard`/`NotificationCenter`) — the point at which
  consolidating it stopped being premature. `TodaysBriefCard.tsx` was refactored to use the shared
  export instead of its own local copy.

## 2. The `DecisionOsNotification` shape

| Field | Notes |
| --- | --- |
| `id` | Deterministic: `notification:{signal.id}` or `notification:daily_brief:{brief.generatedAt}` |
| `type` | `attention_signal` \| `daily_brief` \| `league_context_incomplete` \| `draft_approaching` \| `low_league_health` \| `high_league_health` |
| `severity` / `surfacePolicy` | Reused from the source signal, or the highest severity among a brief's own `topPriorityItems` |
| `source` | The exact signal id or `daily_brief:{generatedAt}` this notification was derived from — a real, traceable reference |
| `leagueId` | `null` for a `daily_brief` notification (summarizes across leagues, doesn't belong to one) |
| `title` / `body` / `recommendedAction` | Reused verbatim from the source — never rewritten |
| `createdAt` | The source signal's own `timestamp`, or the brief's own `generatedAt` |
| `expiresAt` | Always `null` — no expiry rule exists anywhere in this codebase; left honestly unset |

**Deliberately stateless — no `read`/`dismissed` fields.** This phase's own instructions suggested
those as model fields, but also explicitly asked for "session-local: mark read, dismiss... do not add
database persistence." Read/dismissed status is inherently per-viewer, per-session — the SAME
notification object is correct for every viewer; whether a given person has read or dismissed it is
UI-layer state, not something a deterministic, provider-agnostic Decision OS engine can decide. Built as
`useState` inside `NotificationCenter.tsx` instead. Same category of deliberate field-list deviation as
OS-B1/OS-B2 dropping "league name" from the Attention Signal model for an analogous reason.

**Type mapping.** Four signal types (`league_context_incomplete`, `draft_approaching`,
`low_league_health`, `high_league_health`) map directly onto identically-named notification types — no
translation logic needed, it's a literal reuse of the signal's own `type` string. `league_requires_review`
— the one signal type without a dedicated name in this phase's own instructions — maps to the generic
`attention_signal` bucket.

**Daily Brief notification is conditional, not scheduled.** `notificationFromDailyBrief` returns `null`
for a fully empty/healthy brief — nobody needs a notification whose only content would be "you have
nothing to be told." It fires only when the brief actually has a priority item, positive highlight, or
league highlight. Its severity is the highest real severity already present among `topPriorityItems`
(falling back to `informational` only when the brief has content but nothing above that).

## 3. Delivery policy (deterministic, per this phase's own explicit rule)

| Severity | Surface policy |
| --- | --- |
| `critical` | `immediate` |
| `high` | `prominent` |
| `medium` | `center` |
| `low` | `inbox` |
| `informational` | `inbox` |

No scheduling, no background job decides WHEN a notification is surfaced — `surfacePolicy` is a static
label a future delivery consumer (OS-B5) would read to decide its own behavior; nothing in this phase
acts on it.

## 4. Deduplication

`composeNotificationFeed` dedupes strictly by the notification's own deterministic `id` (a `Map` keyed
on `id`, first occurrence wins) — no fuzzy matching, no heuristics, per this phase's own explicit rule.
Because every notification's id is derived directly from its source signal/brief id, two calls over the
same underlying data always produce the same feed.

## 5. Architectural decisions

- **No double-fetch on the page Commissioner Hub already renders.** `NotificationCenter` does not
  self-fetch — `CommissionerCommandCenterSection.tsx` composes the feed from `snapshot.attentionQueue`
  and the already-composed `brief`, zero additional request. Same discipline OS-B2/OS-B3 already
  established twice.
- **The standalone `notificationResolver.ts` accepts a THIRD documented, accepted double-fetch
  tradeoff in this same chain.** It calls `resolveAttentionQueueSnapshot` (for the full signal list) AND
  `resolveDailyBrief` (for the one brief-level notification) — and `resolveDailyBrief` itself already
  calls `resolveAttentionQueueSnapshot` internally (OS-B3), so Mission Control ends up fetched more than
  once across this resolver's own execution. Accepted for the same reason OS-B2/OS-B3 accepted their own
  versions: this resolver targets background-job callers with no page-load context to reuse, not a
  request stacked onto an already-fetched page. It is not called by the Commissioner Hub UI.

## 6. A real bug found and fixed during this phase

`NotificationCenter.tsx`'s list item `data-testid` was initially keyed on severity alone
(`notification-center-item-${severity}`) — this collides whenever two notifications share a severity, a
completely normal case (e.g. a signal and its own derived `daily_brief` notification both landing on
`high`). A test with exactly that shape (`commissioner-command-center-section.test.tsx`) caught it via a
real "multiple elements found" failure. Fixed by keying the test-id on the notification's own unique
`id` instead, with a separate `data-severity` attribute for severity-based querying/styling.
`CommissionerAttentionQueue.tsx` (OS-B2) has the IDENTICAL pattern/bug — flagged as a separate,
out-of-scope task rather than fixed here, since this phase wasn't scoped to touch that component.

## 7. Verification

- **35 new tests**: 24 pure-model tests (`notifications.test.ts` — signal-to-notification field reuse,
  type mapping, severity→policy mapping, daily-brief conditional creation and severity fallback,
  deterministic ordering, non-mutation, feed composition, dedup, empty feed) + 4 resolver tests
  (`notification-resolver.test.ts` — feed composition, brief-notification inclusion, exact argument
  passthrough, empty-input degradation) + 7 component tests (`notification-center.test.tsx` — empty
  state, real rendering, non-colliding test-ids for same-severity items, `leagueId: null` fallback,
  mark-read, dismiss, unread-count accuracy). `__tests__/decision-os` went from 2898 → **2933/2933
  passing**, zero regressions.
- **158/158 baseline typecheck errors unchanged, zero new errors** — confirmed via a direct diff
  against the OS-B3 baseline log (byte-identical error set).
- **Live browser verification**: not run this phase — fixture/component-test verification only, same
  as OS-B3. No new server-side I/O boundary was introduced.

## 8. Boundaries honored

Did not implement: email sending, push notifications, cron/scheduled jobs, notification database
persistence, new Decision OS signal generation, LeagueSafe/FanCred integration, or provider-specific
behavior. Read/dismiss state is genuinely session-local (`useState`), not persisted anywhere.

## 9. Recommended next phase

**OS-B5 — Multi-channel delivery.** `resolveNotificationFeed` (`notificationResolver.ts`) is the
standalone entry point a real delivery job (email/push/mobile) would call to get "what notifications
exist right now," without owning any composition or intelligence logic itself. `surfacePolicy` on each
notification is already the deterministic signal a delivery layer would read to decide urgency-driven
behavior (e.g. `immediate` → push now, `inbox` → next digest only).
