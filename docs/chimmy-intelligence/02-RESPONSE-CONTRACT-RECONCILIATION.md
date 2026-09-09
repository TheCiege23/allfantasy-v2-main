# Chimmy Intelligence — Step 2 reconciliation

Written **before** implementation, against branch `chimmy-rule-catalog-batch1` @
`bfde6d435`. Everything below is read off source.

**Conclusion up front: do not build a parallel Decision OS.** Four response
contracts already exist and one of them —
`lib/decision-os/grounding/packet.ts` — is close to what Step 2 asks for. The
envelope composes the two strongest rather than replacing either.

## The four competing contracts

| Contract | Where | Carries | Missing for Step 2 |
| --- | --- | --- | --- |
| **`DecisionOsGroundingPacket`** | `lib/decision-os/grounding/packet.ts` | per-slice `present`/`asOf`/`servedFrom`/`confidence`/`conclusive`/`gap` with a **remedy**; 7 typed gap reasons | intent, sport, temporal scope, citations, refusal, actions, versioning |
| **`AIToolResponseContract`** | `lib/ai-tool-registry/contracts.ts` | `aiExplanation`, `actionPlan`, `alternatePath`, `confidence` + `confidenceReason`, `traceId`, `providerResults` | scope, authorization, freshness per fact, citations |
| **`DeterministicContextEnvelope` / `NormalizedToolOutput`** | `lib/ai-context-envelope/schema.ts` | `EvidenceItem{source,label,value,unit}`, `Confidence{scorePct,label,reason,cappedByData,capReason}` | no temporal/context scope, no league authorization |
| **`ChimmyAnswerContract`** | `lib/chimmy-chat/response-contract.ts` | Zod-validated answer shape, `ConfidenceSchema` | same |

**The packet is the strongest and it says why in its own header:** *"A bundle
answers 'what do we know'. A grounding packet answers 'what may we SAY, and if
not, why not, and what would fix it'."* Its shape was derived from all fifteen
context providers rather than designed fresh. Step 2 extends it.

## Fields whose meanings conflict

🛑 **`confidence` means three different things on three contracts.**

| Contract | Scale | Null meaning |
| --- | --- | --- |
| `AIToolResponseContract.confidence` | **0–100** | optional |
| `GroundedSlice.confidence` | **0..1** | "producer does not express one" — explicitly *never* 0-as-unknown |
| `ConfidenceSchema.scorePct` | **0–100** | required |

Anything reading two of these and comparing them is off by 100×. The envelope
therefore carries **one** confidence, on **one** scale (0..1, the packet's, which
is the only one with a documented null semantic), plus a required basis.

`evidence` also conflicts: `AIToolResponseContract.evidence` is `string[]` (prose),
while `EvidenceItemSchema` is structured `{source,label,value,unit}`. Citations
need structure, so the envelope uses the structured form.

## Duplicated intent classification — six classifiers, two sharing a name

| Function | Module | Taxonomy |
| --- | --- | --- |
| `classifyChimmyIntent` | `lib/chimmy-orchestration/intent-classifier.ts` | 14 intents — **the one the route uses** |
| `classifyChimmyIntent` | `lib/chimmy-context/intent/IntentClassifier.ts` | 13 intents, different set — **same exported name, not used by the route** |
| `classifyPecrIntent` | inline in `route.ts:607` | returns a bare `string` |
| `classifyTradeIntent` | `lib/chimmy-trade/intent.ts` | trade sub-intents |
| `classifyWorldCupChimmyIntent` | `lib/world-cup/…` | soccer-specific |
| `classifyRedraftQuestionForModel` | `lib/ai/modelRouting.ts` | model routing |

Neither `classifyChimmyIntent` covers Step 2's required taxonomy: **no
`historical_fact`, no `live_fact`, no `upcoming_schedule`, no
`unsupported_non_sports`, no `action_request`.** So the resolver needs a
taxonomy, and it **maps onto** the orchestration classifier rather than replacing
it — that one feeds `buildOrchestrationPromptSection` and rewiring it would
change answers.

## League ID: one entry, but the authorized result is not the authority

`leagueId` enters once, at `route.ts:1102` (`formData.get('leagueId')`) — a
client claim. It is authorized by `loadLeagueGroundingForUser` at ~1231, and the
rule grounding added in batch 1 correctly reads `leagueSnapshot`.

🛑 **BUT THE REFUSAL IS CONDITIONAL, AND THREE CONSUMERS READ THE RAW ID.**
The refusal at `route.ts:1241` fires only when `leagueGroundingRequired` is true,
and `requiresLeagueGrounding` returns true for `insightType` of **trade, waiver,
dynasty** only. `InsightType` has **six** values.

So for `insightType` of **`matchup`, `playoff` or `draft`**, with no `teamId` and
a message that trips none of the phrase patterns:

```
route.ts:1585   leagueId && insightType     ← the only guard
                  ↓
getInsightBundle(leagueId, insightType, …)
lib/ai-simulation-integration/AIInsightRouter.ts:17
```

`getInsightBundle` **takes no `userId` and the file contains zero occurrences of
one.** It reads matchup predictions, playoff odds, warehouse summaries and
`leagueSettingsSummary` for whatever league id it is handed, and the result is
placed in the prompt.

**This is a cross-user league data exposure, it pre-dates this work, and closing
it is squarely Step 2's job** — "never use an unauthorized client-supplied league
ID" is the resolver's whole contract. The fix is that consumers read the
*resolved authorized identity*, never the raw field.

⚠ A second consumer, `readStrategy({ userId, leagueId })`, at least takes a
`userId`. It belongs to another session's uncommitted value-v2 work and is **out
of scope** here; noted only so the next reader does not think it was missed.

## Routes returning prose without evidence, and silent defaults

- The chat route's failure paths return `CHIMMY_GENERIC_ERROR_MESSAGE` — prose,
  no evidence, no gap. Batch 1 fixed this for *rule grounding* specifically
  (`buildRuleGroundingGap`); the pattern is not yet general.
- `getInsightBundle(...).catch(() => undefined)` — a failed insight becomes
  "no insight", indistinguishable from a league that has none. Same shape as the
  empty `catch` batch 1 removed.
- `tryDeterministicAnswerDetailed` → `LIVE_SEARCH_SOURCE` fires only on a
  deterministic **refusal**, behind `getChimmyFeatureFlags().liveSearchFallback`
  (default **false**). That is the historical/live hook Step 4 will populate; Step
  2 defines the port and does not implement it.

## Action requests mixed with informational requests

There is no field anywhere in the four contracts distinguishing "explain this"
from "do this". `lib/chimmy-actions/` has a registry, a permission guard and an
execution validator, but nothing in the *response* shape says whether an action
is available, whether the league is imported (read-only) or AllFantasy-created,
or whether confirmation is required. Step 2 adds that as **description only** —
no execution.

## What Step 2 builds, given all of the above

1. **`DecisionResponseEnvelopeV1`** — composes the packet (facts, gaps,
   freshness, conclusiveness) and the tool contract (explanation, alternates,
   trace). One confidence scale. Structured citations. Never replaces either.
2. **One context resolver** — the single authority for "which league, and is it
   authorized", with the required precedence, plus the 13-intent taxonomy that
   maps onto the existing orchestration classifier.
3. Focused modules, not another block in the 3,127-line route.
