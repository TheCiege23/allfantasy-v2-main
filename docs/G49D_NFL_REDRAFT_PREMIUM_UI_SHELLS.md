# G49D NFL Redraft Premium UI Shells

## Purpose

G49D adds production-ready NFL Redraft premium UI shells for the facts-only G49C premium service contract.

The shells prepare AF Pro, AF Commissioner, AF Supreme, and AF War Room surfaces for product packaging without creating Decision OS, Manager OS, Commissioner OS, LLM reasoning, recommendations, generated announcements, provider payload exposure, or checkout changes.

## Surfaces Wired

The reusable shell components live in:

- `components/redraft-premium/NflRedraftPremiumServiceShell.tsx`
- `components/redraft-premium/NflRedraftPremiumSurfaceSlots.tsx`

Surface shells are mounted in:

- `app/league/[leagueId]/tabs/RedraftTab.tsx`

Mounted areas:

- League dashboard / Redraft tab
- Team page
- Matchup page
- Waiver area
- Trade Center

Exported slots are also available for:

- Draft Room / Draft Prep area
- Player cards

Each slot renders the appropriate premium service shells:

- Basic Runtime Facts
- AF War Room
- AF Commissioner Digest
- AF Manager Brief
- Matchup Prep
- Waiver Report
- Trade Review
- Draft Prep

## Tier Display Behavior

The UI uses only the G49C response fields:

- `serviceName`
- `requiredTier`
- `accessStatus`
- `evidenceCounts`
- `freshnessWarnings`
- `staleDataWarnings`
- `fallbackWarnings`
- `missingDataWarnings`
- `unavailableDataMessages`
- `eligibleSurfaces`
- `factualCategoryLabels`

When `accessStatus.allowed` is false, the shell displays a locked state naming the required AllFantasy tier. It does not start checkout, add Stripe wiring, or infer entitlement beyond the route response.

## Facts-Only Boundary

React components call only:

```text
POST /api/redraft/premium-services
```

Requests contain canonical identifiers only:

- `leagueId`
- `teamId`
- `managerId`
- `matchupId`
- `playerId`
- `week`
- `season`
- `serviceType`
- `serviceVariant`
- `requestedTier`

The UI never accepts or displays raw provider payloads, provider-specific IDs, raw evidence facts, or direct provider responses.

## States Covered

The shell supports:

- Loading state
- Access allowed state
- Locked/paywall state
- Empty canonical evidence state
- Stale data warning state
- Fallback data warning state
- Missing data warning state
- Unavailable data message state
- Safe route error state

## Intentionally Excluded

G49D excludes:

- start/sit recommendations
- waiver recommendations
- trade recommendations
- collusion conclusions
- AI explanations
- natural-language LLM summaries
- generated announcements
- raw provider payloads
- provider-specific IDs in UI
- Stripe/payment changes
- full app redesign

## Remaining G49E Work

G49E should finish production placement for draft-room and player-card contexts, connect authenticated entitlement resolution, enforce league membership, and attach production canonical evidence sources. Any recommendation, OS, or automation behavior remains out of scope until an explicit later milestone.
