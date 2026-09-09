# Chimmy Intelligence — step 1 source reconciliation

Brief: `Chimmy_Intelligence_Claude_Build_Brief.md` (prepared 2026-09-09).
Reconciled against `main` @ `6f49ff959` on 2026-09-09. The brief cites
`2236dd68089a…`; that object exists in this clone, so the deltas below are
against current `main`, not against the brief's snapshot.

**This is an inventory, not a certification.** Every row is what source says.
Nothing here was confirmed by a live request or a deployed flag.

## Verdicts

| Area | Verdict | Evidence |
| --- | --- | --- |
| Chat route | **done (large)** | `app/api/chat/chimmy/route.ts`, 3,127 lines. Decision OS packet, orchestration, PECR, token spend, hallucination guard, personalization, quality analytics all wired. |
| Specialty context injection | **partial** | 15 `build*ContextForChimmy` imports in the route (tournament, big brother, idp, survivor, redraft, zombie, devy, guillotine, c2c, salary cap, dynasty, dynasty war room, keeper, best ball, guillotine war room). |
| Non-league questions | **done** | `requiresLeagueGrounding()` route.ts:636 has a `hasGlobalSportContext` escape hatch and returns false by default. A historical question does not demand a league id. |
| Rule catalog | **MISSING** | No versioned concept catalog anywhere. `lib/sport-rules-engine` is sport rules (scoring), not league-concept rules. |
| Format classification reaching Chimmy | **MISSING** | `readFormatRules` (`lib/trade-intel/leagueFormatRules.ts:137`) is the classification authority for concept vs modifier. **The chat route never imports it.** Verified: `grep leagueFormatRules\|readFormatRules\|conceptAliasTags app/api/chat/chimmy/route.ts` → no match. |
| Screenshot extraction | **partial** | `parseScreenshotWithVision()` route.ts:864 asks gpt-4o for "a concise plain-text summary". No structured fields, no per-field confidence, no injection defense. Matches the brief's own observation. |
| Conversation memory | **partial** | `lib/ai-memory/{ai-memory-store,chat-history-store,chimmy-memory-context}.ts` persist and retrieve. |
| Memory user controls | **MISSING** | Only `app/api/ai/memory/quality/route.ts` exists. No view/delete surface for ordinary conversation memory. |
| Live research | **partial** | `LIVE_SEARCH_SOURCE` fires only on a deterministic *refusal*, and only behind `getChimmyFeatureFlags().liveSearchFallback`. Not a general research path. |
| Action handlers | **present, unaudited** | `lib/chimmy-actions/` has registry, permission guard, execution validator, server validation, logger, analytics. |

## The concept census — three sources that disagree

The brief warns not to assume its list is exhaustive. It is not, and the three
in-repo authorities do not agree with each other:

| Concept | `specialty-league/registry.ts` | `specialty-automation/handlers/registry.ts` | `leagueFormatRules.ts` `LeagueConcept` | `*ContextForChimmy` |
| --- | --- | --- | --- | --- |
| guillotine | ✅ | ✅ | ✅ | ✅ |
| survivor | ✅ | ✅ | ✅ | ✅ |
| zombie | ✅ | ✅ | ✅ | ✅ |
| big_brother | ✅ | ✅ | ❌ | ✅ |
| tournament | ✅ | ✅ | ✅ | ✅ |
| devy | ✅ | ✅ | ✅ | ✅ |
| merged_devy_c2c | ✅ | ✅ (`c2c`) | ✅ | ✅ |
| idp | ✅ | ❌ | modifier | ✅ |
| **king_of_the_hill** | ❌ | ✅ | ✅ | **❌** |
| **pirate_vampire** | ❌ | ✅ | ✅ (`pirate`) | **❌** |
| **royal** | ❌ | ✅ | ❌ | **❌** |
| salary_cap | ✅ (type only) | ❌ | ❌ | ✅ |
| keeper | ✅ (type only) | ❌ | ✅ | ✅ |
| **Survivor All-Stars Guillotine** | ❌ | ❌ | ❌ | **❌** |

Three findings that matter:

1. **King of the Hill, Pirate/Vampire and Royal have automation handlers and
   trade pricing but no Chimmy grounding at all.** Ask Chimmy about a KOTH
   league today and it sees `redraft`, because that is what
   `normalizeConcept.ts:38` flattens it to. The alias that carries the real
   format is in `conceptRules.extensions.aliasTags` and the chat route never
   reads it.

2. **Survivor All-Stars Guillotine is fully specified and completely
   unreachable from chat.** `lib/trade-intel/survivorGuillotine.ts` documents a
   real format — 22 teams / two tribes, elimination by lowest score not vote,
   $1000 season FAAB, **no trades**, and a starting lineup that *grows* on a
   published schedule (8 starters wk1 → 12 by wk14, SUPERFLEX arriving wk9).
   The brief's instruction — trace it to its actual combination of mechanics,
   do not infer from either name — is satisfiable from that file. Nothing does.

3. **`aliasTags` is overloaded and only one reader resolves it correctly.**
   `leagueFormatRules.ts` documents the measurement: 183 of 271 production
   leagues carry `['idp']`, and taking `alias[0]` would reprice 110 of 271
   (41%) — including 97 dynasty leagues demoted to redraft by a *scoring* flag.
   `FORMAT_ALIASES` / `MODIFIER_ALIASES` is the split. Any new consumer must go
   through `readFormatRules`, never re-derive.

## What step 3 has to be

The brief: *"The catalog is an index and explanation layer over the runtime
rules, not a second independently maintained engine."* Given finding 3, that is
not a style preference — a second classifier is precisely the 110-league bug.
The catalog therefore **delegates** classification to `readFormatRules` and
`readConceptAliasTags` and adds only what does not exist: rule version,
lifecycle phases, legal actions, elimination/tiebreak text, and provenance.

## Found while building — two things the census did not predict

### 1. Every league row carries a keeper policy nobody chose

`prisma/schema.prisma`, `model League`:

```
keeperCount        Int?    @default(3)
keeperCostSystem   String? @default("round_based")
keeperRoundPenalty Int?    @default(1)
```

So a league whose commissioner never configured keepers still arrives with
`keeperCount=3, keeperCostSystem="round_based"`. Reading the column and calling
it the league's setting states an invented rule about essentially every league in
the database, in the same voice as a real one.

**Handled** by a fourth provenance value, `schema_default` — the value is
printed, and so is the fact that nobody is known to have chosen it. The
alternative, folding it into `unknown`, would have been wrong the other way: a
commissioner who genuinely chose `round_based` is indistinguishable from the
default, and hiding the value would leave Chimmy unable to answer at all.

### 2. 🛑 UNRESOLVED, AND IT MOVES TRADE PRICING — not just wording

`readFormatRules` (`lib/trade-intel/leagueFormatRules.ts:185`):

```
: raw === 'keeper' || (raw === 'redraft' && keeperCount > 0)
    ? 'keeper'
```

Combined with `keeperCount @default(3)`, **an untouched `redraft` row classifies
as a `keeper` league.** Measured directly against the resolver: a row of
`{leagueType:'redraft', keeperCount:3}` returns `concept: 'keeper'` and emits the
full keeper trade note.

The import path does not close this. `ImportedLeagueCommitService` writes the
column through `setIfNum('keeperCount', l.max_keepers)`, which only fires when
the platform reported `max_keepers` **as a number**. Any league whose platform
reported nothing keeps the default and reads as a keeper league.

**Not fixed here, deliberately.** Changing that branch alters `FormatRules` for
every consumer, including trade pricing — `keeperSurplus` and `keeperDriftNote`
both key off it. That is a product decision about live leagues, not a refactor.

Pinned instead by
`__tests__/league-rules/conceptCatalog.test.ts` → *"PINS AN UPSTREAM EXPOSURE"*,
which asserts the current behaviour and states that it **should go red** when the
decision is made.

**The open question for the user:** should an untouched `keeperCount=3` be read
as "3 keepers" or as "we were never told"? A `@default(0)` on the column, or a
`keeperCount != null && keeperCount > 0 && explicitlySet` predicate, are the two
obvious shapes — but both change what existing leagues price as.
