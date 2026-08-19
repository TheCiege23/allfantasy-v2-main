# OS-B Architecture Audit (pre-OS-B5)

A short, targeted review requested before adding multi-channel delivery (OS-B5), run against the
current `g15-event-foundation` state (PR #185 — the `CommissionerAttentionQueue.tsx` test-id fix — was
still open/unmerged at audit time; nothing in this audit depends on that fix). Zero code changes made.

## 1. Is there exactly one canonical path per model?

Confirmed via direct source inspection (not memory) — each model has exactly one type definition site:

| Model | Canonical definition | Canonical derivation/composition |
| --- | --- | --- |
| `DecisionOsAttentionSignal` | `lib/decision-os/attentionSignals.ts:46` | `deriveLeagueAttentionSignals` + `sortAttentionSignals` (same file) |
| `DailyBrief` | `lib/decision-os/dailyBrief.ts:58` | `composeDailyBrief` (same file) |
| `DecisionOsNotification` | `lib/decision-os/notifications.ts:49` | `composeNotificationFeed` (same file) |

Every other reference across the codebase is a `type`/`import` re-export, not a redefinition. **Clean.**

## 2. Are there duplicate resolver chains or parallel composition logic?

Each model has exactly TWO orchestration entry points (not composition logic — orchestration, i.e. how
inputs get fetched before being handed to the one canonical function above):

- **Attention signals**: `attentionQueue.ts` (`resolveAttentionQueueSnapshot`, standalone, own fetches)
  and `commissionerCommandCenter.ts` (inline, reuses its own already-fetched Mission Control snapshot).
- **Daily Brief**: `dailyBriefResolver.ts` (`resolveDailyBrief`, standalone) and
  `CommissionerCommandCenterSection.tsx` (client-side, zero-fetch composition from data already on the
  page).
- **Notifications**: `notificationResolver.ts` (`resolveNotificationFeed`, standalone) and
  `CommissionerCommandCenterSection.tsx` (client-side, zero-fetch).

Each pair is explicitly documented, in both files, as a deliberate tradeoff to avoid double-fetching
Mission Control on the same page load — not organic drift. Traced `attentionQueue.ts`'s per-league loop
against `commissionerCommandCenter.ts`'s per-league loop line-by-line: both feed `deriveLeagueAttentionSignals`
identical inputs for the same underlying Mission Control/League Context/draft-date data — **no
behavioral divergence found.**

**One real, minor duplication**: `resolveFinancialContextSafely` (a 6-line try/catch wrapper around
`resolveLeagueFinancialContext`) is copy-pasted verbatim, module-private, in both `attentionQueue.ts`
and `commissionerCommandCenter.ts`. Small enough to not be worth a standalone fix, but a real instance
of the pattern asked about — if it grows any more callers, it should move into `leagueContext.ts` itself
as a shared, exported helper.

**No other duplication found.** `TodaysBriefCard.tsx` and `NotificationCenter.tsx` only reference
`composeDailyBrief`/`composeNotificationFeed` in doc comments — confirmed via grep they never call
those functions themselves (purely presentational, as designed).

## 3. Can Manager OS / Platform OS reuse the same models without Commissioner-specific assumptions?

**The models themselves: yes, cleanly.** `deriveLeagueAttentionSignals`, `composeDailyBrief`,
`composeNotificationFeed`, and all three standalone resolvers take a plain `leagueIds: readonly string[]`
— no Commissioner-specific naming, auth, or coupling anywhere in their type signatures or bodies. The
"which leagues" question is answered entirely by the CALLER (today, only
`app/api/decision-os/commissioner-command-center/route.ts`, which filters
`getDashboardLeagueListForUser` to `isCommissioner === true` — that filtering lives in the route, not
in any Decision OS composition). A Manager OS or Platform OS caller could supply its own differently-
sourced `leagueIds` list to the exact same functions today.

**Manager OS (`userOs.ts`) is a clean slate.** It has zero existing "attention"/"recommended action"
concept (confirmed via grep — no matches for `recommendedActions`, `urgentAction`, `interventionQueue`,
or any of the new OS-B model names). It could adopt the Attention Signal / Daily Brief / Notification
models directly with no migration debt.

**Platform OS (`platformOs.ts`) does NOT currently consume these models — a real finding.** It has its
own, older `PlatformOsInterventionEntry` concept (`{leagueId, urgentActionCount, sampleMessage}`),
built directly by filtering `snapshot.recommendedActions` for `priority === 'urgent'` — predating
`attentionSignals.ts` (Platform OS is Phase D Increment 4; the Attention Signal model is OS-B2, much
later). This duplicates a SUBSET of what the `league_requires_review` signal type already does, and is
missing the other 4 signal types entirely (`draft_approaching`, `league_context_incomplete`,
`low_league_health`, `high_league_health`). Not a bug in either module — Platform OS simply hasn't been
migrated onto the newer, richer model yet. Worth resolving before OS-B5 adds a delivery layer on top of
signals Platform OS doesn't yet see the full picture of.

**Minor naming inconsistency, not a functional blocker**: `CommissionerAttentionQueue.tsx` has
"Commissioner" in its component name despite a fully generic props contract (`entries`,
`leagueNameById`) — unlike its siblings `TodaysBriefCard.tsx`/`NotificationCenter.tsx`, which are
named generically. All three already live under the shared `components/decision-os/` directory (not a
Commissioner-specific one), so this is cosmetic, not architectural.

## Recommendation

Before OS-B5 (multi-channel delivery), consider a small increment to migrate `platformOs.ts`'s
`interventionQueue` onto `resolveAttentionQueueSnapshot`/`DecisionOsAttentionSignal` — this would let
Platform OS surface the same 5 real signal types Commissioner OS already sees, instead of only the
`league_requires_review` subset, and would mean OS-B5's delivery layer has a single consistent signal
source across every OS role rather than two divergent ones. Not a blocker for OS-B5 itself (the
delivery layer can be built against the existing, correct Commissioner-side models regardless), but
worth doing before Platform OS grows its own delivery expectations on top of the older model.
