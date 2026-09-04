# Decision OS Adapter Layer

The single door every Commissioner OS UI module reaches Decision OS
through. No page imports a per-module `decision-os-client` or Demo Mode's
`resolveServerDataMode()` directly anymore — only
`lib/commissioner-os/adapter`.

Twelve namespaces currently compose behind it: Mission Control, League
Health, Manager Intelligence, Recommendations Center,
[Workspace](../../../components/commissioner-os/workspace/README.md),
[Automation Center](../../../components/commissioner-os/automations/README.md),
[League Analytics](../../../components/commissioner-os/analytics/README.md),
[Reports](../../../components/commissioner-os/reports/README.md),
[Search](../../../components/commissioner-os/search/README.md),
[Notification Center](../../../components/commissioner-os/notifications/README.md),
[Universal Activity Stream](../../../components/commissioner-os/activity/README.md),
and [Help & Knowledge Center](../../../components/commissioner-os/help/README.md)
— each added the same way: extend `CommissionerDecisionOSAdapter` with one
more namespace and one more `buildXAdapter` function, no change to the
adapter's existing pipeline. Automation Center's `getExecutionHistory`
is the first adapter method to take an argument — `wrapMethod` still
applies uniformly, just invoked from inside a small arrow function that
forwards the parameter instead of being passed as a bare reference.
Reports', Notification Center's, Activity Stream's, and Help Center's
`buildXAdapter` functions need no custom per-field normalizer at all —
their methods all pass through the adapter's generic envelope
normalization untouched.

**Search and Notifications are the two namespaces that aren't business
modules** — neither has a `CommissionerModuleId` of its own (both are
platform services, per their own placeholder framing — see
[Search's README](../../../components/commissioner-os/search/README.md)
and [Notification Center's README](../../../components/commissioner-os/notifications/README.md)).
`wrapMethod`'s `moduleId` parameter (and `normalizeErrorContract` /
`errorFromException` / `CommissionerAdapterLogEvent` alongside it) is
typed `CommissionerErrorAttributableId` — a small, additive
`CommissionerModuleId | 'search' | 'notifications'` union in Platform
Contracts' `errors.ts` — specifically so both namespaces flow through the
identical pipeline as the other eight without a type-level lie, rather
than forcing either string into a `CommissionerModuleId` union they were
deliberately never part of. **Activity Stream and Help Center needed no
such widening** — unlike Search and Notifications, `'activity'` and
`'help'` are already real `CommissionerModuleId`s (each has its own
sidebar entry and route), so `buildActivityAdapter` and `buildHelpAdapter`
pass them to `wrapMethod` as plain `CommissionerModuleId`s like the other
ten business modules.

## What it is not

It is not business logic, and it does not own any module's intelligence.
League Health's fixtures still live in `league-health/decision-os-client/`,
Recommendations Center's in `recommendations/decision-os-client/`, and so
on — this layer composes those four existing clients behind one import
and applies uniform normalization, validation, and logging around every
call. Nothing here recomputes a score, a severity, or a recommendation;
it only guarantees the shape of what those modules already produced.

## Responsibilities

- **Response/error/timestamp normalization** — every envelope's `error`
  and `timestamp` fields are guaranteed well-formed even if a future live
  implementation returns something malformed or partial
  (`normalizeErrorContract`, `normalizeTimestamp`).
- **Evidence normalization** — League Health's evidence points are
  trimmed and defensively guaranteed non-null (`normalizeEvidencePoints`).
  `normalizeEvidenceMetadata` normalizes Platform Contracts'
  `CommissionerEvidenceMetadata` shape (confidence/asOf/sourceModuleId)
  for the first module that attaches it — no current module does yet,
  so this is proven by tests and ready for Workspace's related-evidence
  links, not retrofitted onto today's shapes.
- **Confidence/severity normalization** — any confidence or severity
  value flowing through the adapter (recommendations, League Health's
  tier and risk severities, Workspace task priority, Automation health)
  is checked against the real enum and coerced to a safe fallback
  (`moderate` / `standard`) if invalid, rather than letting a bad value
  reach a component that switches on it. **Event severity** (Notifications'
  and Activity Stream's separate `CommissionerNotificationSeverity`
  vocabulary — informational/success/warning/critical) gets the identical
  treatment via `normalizeEventSeverity`, added during the Phase 2
  production-hardening adapter audit: both namespaces' own demo/stub data
  always already satisfied this vocabulary (built via an exhaustive
  switch), so the gap had no practical effect until now, but a future live
  backend returning untyped JSON over the wire has no such guarantee.
- **Demo/Live switching** — `resolveServerDataMode()` is now called once
  per request, here, instead of once per module. `buildDecisionOSAdapter(mode)`
  is the pure, directly unit-testable half (no `cookies()` call);
  `getDecisionOSAdapter()` is the thin async wrapper Server Components
  call.
- **Contract validation** — `isWellFormedResponse` structurally checks
  every envelope (never a schema library — this program has never used
  one, and a hand-rolled guard matching Platform Contracts' own existing
  `isCommissionerResponseOk` style was the smaller, consistent choice).
  A failed check is logged, not thrown — the adapter always returns its
  best-effort normalized envelope rather than crashing a page.
- **Logging hooks** — `setCommissionerAdapterLogger` / `resetCommissionerAdapterLogger`
  make every call's success/error observable. Defaults to a no-op in
  production and `console.debug`/`console.error` in development, mirroring
  `DataModeIndicator`'s existing dev-only gate — no new visibility
  convention introduced.

## How a page uses it

```ts
import { getDecisionOSAdapter } from '@/lib/commissioner-os/adapter'

export default async function SomePage() {
  const adapter = await getDecisionOSAdapter()
  const response = await adapter.leagueHealth.getHealthDetail()
  // adapter.mode is 'stub' | 'demo' | 'live' — the same value every
  // page previously got from its own separate resolveServerDataMode() call.
}
```

## Swapping in a real Decision OS later

Nothing about this layer's public surface changes. Each module's own
`live.ts` (currently an honest placeholder returning a typed
`upstream_unavailable` error) is where the real HTTP/RPC call gets added —
the adapter will normalize, validate, and log whatever that call returns
exactly the same way it already does for stub and demo, with zero changes
to `lib/commissioner-os/adapter/` itself or to any page.

**Phase 3.0** built the reusable transport a real `live.ts` calls through
— [`adapter/transport/`](transport/README.md) (retry, timeout, auth,
error normalization, all reusing existing app infrastructure) and
[`lib/commissioner-os/liveReadiness.ts`](../LIVE_INTEGRATION_FOUNDATION.md)
(a per-namespace kill switch). Repository discovery for that phase found
no real Decision OS backend exists anywhere in this repository or on
`main` — see `LIVE_INTEGRATION_FOUNDATION.md` §1 for the full finding.
Neither addition changes anything in this file or in `types.ts`.

## Files

- `types.ts` — `CommissionerDecisionOSAdapter`, namespaced by module,
  re-using each module's own client interface (no duplicated method
  signatures).
- `normalize.ts` — the normalization primitives described above.
- `validate.ts` — `isWellFormedResponse`.
- `logging.ts` — the pluggable logging hook.
- `index.ts` — `buildDecisionOSAdapter(mode)` (pure) and
  `getDecisionOSAdapter()` (resolves Demo Mode, then delegates).

## Tests

`__tests__/commissioner-os-adapter.test.ts` — normalization primitives,
validation, logging pluggability, full stub/demo/live parity through the
adapter for all twelve namespaces, and a static check that none of the
Commissioner OS page files import a per-module client or Demo Mode
directly.
