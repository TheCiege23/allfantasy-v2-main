# Chimmy Assistant — Trust, Safety & Money Audit

**Status:** discovery only, no code changes made · **Prepared:** 2026-07-16 · **Branch:** `claude/chimmy-rebrand-discovery-audit`

Every finding is traced to exact file:line with a concrete failure scenario. Findings marked **[verified directly]** were read and confirmed personally in this pass. Findings marked **[agent-sourced, spot-checked]** came from four parallel investigations dispatched to extend reach without duplicating direct tracing; the two most severe new claims from those investigations were independently re-read and confirmed before inclusion. Ranked by real-world consequence: data exposure and money first, honesty/error-handling after.

## 0. Locate — architecture summary

There isn't one Chimmy backend — there are at least **four** related routes:

- **`app/api/chimmy/route.ts`** — "the canonical Chimmy route alias" (its own header comment) — what a correctly-wired frontend calls. Branches to `postChatChimmy` (below) for non-JSON/non-Anthropic requests, or to a separate `runAgentPipeline`/`streamAgentPipeline` (`lib/agents/anthropic-pipeline`) with **its own independent token-charge/refund implementation** when the Anthropic path is enabled.
- **`app/api/chat/chimmy/route.ts`** (2190 lines) — the real primary implementation. PECR orchestration, a real anti-hallucination guard, real staleness/freshness mechanics, ~15 per-game-mode context builders.
- **`app/api/ai/chat/route.ts`** — an older, independent implementation (direct OpenAI call, own system prompt, own legacy-context lookup). Confirmed live and reachable via `hooks/useAIChat.ts`'s no-league-context fallback — but `useAIChat` itself has zero component consumers anywhere in the codebase.
- **`app/api/ai/chimmy/route.ts`** — a fourth, distinct route (agent-sourced) that also charges tokens and calls `runUnifiedOrchestration`, with no refund path anywhere in the file and no league-membership check on its `leagueId`, unlike its siblings.

Token deduction: `lib/tokens/TokenSpendService.ts` (`spendTokensForRule`). Entitlement gating: `lib/subscription/entitlement-middleware.ts` (`requireFeatureEntitlement`). At least 11 separate routes call these independently (full list in Finding 4).

Conversation storage: `ChatConversation` / `ChatHistory` models (`prisma/schema.prisma:2428-2460`) — **no FK/relation to the account at the schema level**; `lib/ai-memory/chat-history-store.ts` is the only application-code gate, and it doesn't enforce ownership either (Finding 2).

Chimmy Context Engine (`lib/chimmy-context/**`): confirmed **safe by construction** — every provider independently re-validates the requester's own membership/ownership regardless of what `leagueId`/`userId` it's handed, even though the engine's own docstring says the caller "must" pre-guard. A genuine positive example (see Finding 10).

B2B/multi-tenant infrastructure: confirmed **does not exist as a live, reachable surface** today. `tenantId` columns are fixed-default provenance tags on 5 analytics models, never a query filter. The one "Widget SDK" scaffold explicitly documents itself as contract-shape-validation-only with auth deferred to a boundary that isn't wired to any real endpoint yet. Not a current risk; worth re-checking if/when that boundary is built.

Existing tests found (`chat-chimmy-route-contract.test.ts`, `chimmy-alias-route-contract.test.ts`, `entitlement-token-resolver-routes-contract.test.ts`, `chimmy-language-prompt.test.ts`, and contract tests for waiver-ai/trade-evaluator/trade-analyzer-ai) do not assert on cross-user identifier scoping or charge-ordering — none of this audit's findings are covered by existing coverage.

---

## Ranked findings

### 1. [DATA EXPOSURE — most severe, zero relationship required] `app/api/waiver-ai/grok/route.ts` leaks any team's roster and any league's settings to any authenticated user — **[verified directly]**

`app/api/waiver-ai/grok/route.ts:265-289`:
```
const sleeperUserId = body.sleeperUserId || body.platformUserId;
...
if (leagueId && (userId || sleeperUserId)) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, include: { rosters: true } });
  ...
  const lookupId = sleeperUserId || userId;
  const userRoster = league.rosters.find((r) => r.platformUserId === lookupId);
  ...
  rosterData = JSON.stringify(userRoster.playerData);
  leagueSettings = `... ${JSON.stringify(league.settings)}`;
```
Three separate gaps stack here: `leagueId` is fetched by ID alone with no membership check at all (unlike the sibling `waiver-ai/engine/route.ts`, which does call `assertLeagueMember`); `lookupId` **explicitly prefers the client-supplied `sleeperUserId`/`platformUserId` over the session's own `userId`** even when both are present; and the matched roster's full `playerData` plus the league's full `settings` are serialized directly into the LLM prompt and returned in the response.

**Concrete failure scenario:** an authenticated user supplies any `leagueId` (their own or not) and any other team's `platformUserId` (visible on public standings/rosters pages in a fantasy product) and receives that team's complete roster and the league's full settings, synthesized into a "waiver wire analysis" — for a league they may have zero membership in whatsoever. This requires no relationship to the target league or team at all, which is why it ranks above the conversation-history and legacy-context leaks below.

### 2. [DATA EXPOSURE — reaches real conversation content, 3 entry points] Chat history/memory is keyed by a client-supplied, deterministic conversation ID with no ownership check — **[agent-sourced, spot-checked]**

`lib/ai-memory/chat-history-store.ts`: `getRecentChatHistory(conversationId, 12)` queries the `chat_history` table by `conversationId` alone — no `userId` predicate anywhere in the query. `buildChimmyConversationId` returns the caller-supplied `explicitConversationId` **verbatim** whenever present, instead of deriving `chimmy:${userId}:${leagueId}` — and that derived default format is itself deterministic and guessable from a `userId` (visible via roster/owner IDs, league member lists).

Three confirmed live entry points forward a client-supplied `conversationId` into this same unguarded read/write path: `app/api/chat/chimmy/route.ts` (form field `conversationId`, line 881/920 → 1044-1048 → 1196-1204), `app/api/ai/chimmy/route.ts` (JSON field, line 132-139 → 160-182 read, 242-259 write), and `app/api/chimmy/route.ts` (the "canonical alias," which forwards `userContext.conversationId` into the same form field, line 405-406).

`ChatConversation`/`ChatHistory` (`prisma/schema.prisma:2428-2460`) have **no FK/relation to the account at the schema level** — this is purely an application-code contract, and the application code doesn't enforce it on this path.

**Concrete failure scenario:** a user who knows (or guesses, from the derivable `chimmy:{userId}:{leagueId}` format) another user's conversation ID can pull up to 12 of that user's actual past chat turns into their own Chimmy context — real conversation content, not just stats — and their own message/response gets appended into the victim's conversation record too, contaminating it and bumping its `messageCount`/`lastMessageAt`.

**Positive control, for contrast:** the dedicated "saved conversations" CRUD API (`app/api/chimmy/conversations/[id]/route.ts`) correctly checks `conversation.userId !== session.user.id → 403` on every operation — the correct pattern is known and used elsewhere in the same feature area, just not applied to the live in-chat memory-recall path.

### 3. [DATA EXPOSURE — original finding] Cross-user legacy-context leak in `app/api/ai/chat/route.ts` — **[verified directly]**

`context_scope.sleeper_username` (line 305-306) comes directly from the request body and flows into `getLegacyContext(sleeperUsername)` (line 82) → `prisma.legacyUser.findUnique({ where: { sleeperUsername } })` (line 83-93) with no check against `session.user.id`. The result (career record, championships, archetype, strengths/weaknesses, league history) is injected into the system prompt as "USER LEGACY CONTEXT" with the instruction to personalize responses using it. The correct pattern exists and isn't used: `AppUser.legacyUser` is a real schema relation (`legacyUserId` FK) that would let the route derive the caller's own username from `session.user.id` instead.

**Reachability, precisely:** the only frontend caller, `hooks/useAIChat.ts:183-194` (its no-`leagueId` fallback branch), has zero import sites in any component anywhere in the repo — not click-reachable in today's UI, but still a live, authenticated, directly-callable API route.

### 4. [MONEY — systemic, affects 11+ routes] Token is charged before the paid action completes, and 5 of those routes have no refund path at all — **[verified directly for the core pattern + agent-sourced breadth, spot-checked]**

**The brief's most-precise ask, answered precisely:** no, a token charge does not happen strictly after the underlying action completes successfully. `TokenSpendService.spendTokensForRule` (`lib/tokens/TokenSpendService.ts:643-772`) is implemented correctly and safely in isolation — a real atomic Prisma `$transaction`, idempotency-checked, with a conditional `updateMany` (`balance: { gte: tokenCost }`) that prevents any double-spend race. The gap is architectural, not in that function: every route that uses it commits the charge **before** calling the paid LLM action, and treats the refund as a separate, later, non-atomic call wrapped in `.catch(() => null)` — so a failed refund attempt is silently swallowed with no logging, retry, or alert anywhere.

**Confirmed same shape (charge → paid action → refund-on-catch, refund itself swallowed):** `app/api/ai/chat/route.ts:513-530`, `app/api/chat/chimmy/route.ts:1497-1585`, `app/api/chimmy/route.ts:577-605` (Anthropic path), `app/api/waiver-ai/engine/route.ts:193-210`, `app/api/trade-evaluator/route.ts:415-432`, `app/api/draft/recommend/route.ts:52-74`, `app/api/leagues/[leagueId]/ai-commissioner/chat/route.ts:50-66`, `app/api/leagues/[leagueId]/ai-commissioner/run/route.ts:45-61`, `app/api/player-comparison/insight/route.ts:134-150`, `app/api/trade-analyzer/ai/route.ts:71-88`, `app/api/leagues/[leagueId]/big-brother/ai/route.ts`, `server/api-route-modules/league-survivor/ai/route.ts`.

**Confirmed worse — token charged, zero refund path anywhere in the file even on total failure:**
- `app/api/ai/chimmy/route.ts:205-223` — spends, then calls `runUnifiedOrchestration` with no surrounding try/catch and no refund call anywhere in the 333-line file.
- `app/api/simulation/matchup/route.ts:102-126` — charges when `includeInsights` is set; the outer catch has no refund, and the AI call's own failure is separately swallowed with no refund either.
- `app/api/leagues/[leagueId]/drama/tell-story/route.ts`, `app/api/leagues/[leagueId]/power-rankings/commentary/route.ts`, `app/api/leagues/[leagueId]/story/create/route.ts` — **all three also hardcode `confirmTokenSpend: true`** (Finding 5) — confirmed directly: `drama/tell-story/route.ts:41` reads literally `confirmTokenSpend: true`, not derived from the request at all. On these three, a token is charged with no cost ever shown and no refund path if the generation fails — a double failure in the same three routes.

**The fix pattern already exists in this codebase and is shipping today** — this is the single most useful fact for prioritizing a follow-up: every World Cup AI route (`app/api/brackets/world-cup/[challengeId]/chat/route.ts`, `.../commissioner-brain/route.ts`, `.../entries/[entryId]/explain/route.ts`, `.../entries/[entryId]/ai/matchup/route.ts`) uses a shared `prepareWorldCupAiTokenFallback()` (`lib/world-cup/worldCupAiTokenFallback.ts:79-147`) that only **previews** the cost up front and returns a `commitTokenSpend()` closure — the charge is only committed **after** the LLM call succeeds. `lib/world-cup/worldCupChimmyPrivateReply.ts:611-654` states the rule explicitly in its own code comment: *"Charge after validation, not before" is the fairness rule.* If a fix is scoped, this is the template to copy, not a design problem to solve from scratch.

### 5. [MONEY — spec §18 violated on 4 confirmed routes] Token cost is never shown to the user before at least 4 routes charge — **[agent-sourced, spot-checked]**

The server contract for disclosure exists and works correctly in the common case: `lib/subscription/entitlement-middleware.ts:61-77` returns a 409 `token_confirmation_required` with the exact cost whenever `!confirmTokenSpend`, and the main Chimmy chat widget (`app/components/ChimmyChat.tsx:427-461`, via `lib/tokens/client-confirm.ts:12-47`) correctly previews cost and shows a real confirmation dialog before spending.

But this is bypassed, confirmed on 4 routes:
- `hooks/useAIChat.ts:183-194` (the same no-`leagueId` fallback from Finding 3) hardcodes `confirmTokenSpend: true` on its `/api/ai/chat` call — no preview, no dialog, ever, on this path.
- `app/api/leagues/[leagueId]/drama/tell-story/route.ts:41`, `app/api/leagues/[leagueId]/power-rankings/commentary/route.ts:99`, `app/api/leagues/[leagueId]/story/create/route.ts:56` — all pass a literal `confirmTokenSpend: true` to `requireFeatureEntitlement`, not derived from the request at all, so the 409 flow can never fire regardless of what the client sends. Their real UI call sites (`components/app/power-rankings/AICommentary.tsx`, `components/app/league/LeagueDramaWidget.tsx`, `components/league-story/LeagueStoryModal.tsx`) confirm none of them import the shared `client-confirm.ts` helper — a single button click silently spends a token with zero cost disclosure anywhere in the stack, and (per Finding 4) two of these three have no refund path if the generation then fails.

### 6. [MONEY/HONESTY — confirmed] A cache hit is charged the same as a fresh completion and is indistinguishable to the user — **[agent-sourced, spot-checked]**

`lib/ai-cost-control/AICostControlService.ts`'s `runCostControlledOpenAIText` already computes a `source: 'ai' | 'cache' | 'deterministic'` field internally (cache-hit path vs. `'ai_success'`) — the information exists. `app/api/ai/chat/route.ts:646-660` calls this with `cacheTtlMs: 30_000` but only reads `completion.text`/`completion.ok`/`completion.model` — `completion.source` is never read, and the JSON returned to the client carries no cache indicator at all. The user pays the same token cost whether the answer is fresh or up to 30 seconds stale, with no way to tell which. `server/api-route-modules/league-survivor/ai/route.ts` has the same property with a much longer 30-minute cache TTL, also with no `cached`/`stale` field surfaced.

**Contrast, showing the codebase already knows how to do this correctly:** World Cup's edge-report route returns `coachingFromCache`/`billing.coachingCached` explicitly, and its chat serializer surfaces a `dataSourceTier`/`dataSourceDisplay` "freshness chip" (the code's own inline comment) to the client.

### 7. [ACCESS CONTROL — confirmed for 1 of ~15 identical call sites in the primary live route] Unvalidated `leagueId` reaches per-game-mode context builders — **[verified directly]**

`app/api/chat/chimmy/route.ts` correctly verifies league membership once, via `loadLeagueSnapshotForUser(userId, leagueId)` (`lib/chimmy/chimmy-league-snapshot.ts:27-68`, a properly-scoped `OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }]` query that returns `null` for a non-member). But the route never checks whether `leagueSnapshot` came back `null` and stops — it continues on with the original, client-supplied `leagueId` into ~15 `build*ContextForChimmy(leagueId, userId)` calls regardless (lines 1637-1767).

Directly verified one: `buildTournamentContextForChimmy(leagueId, userId)` (`lib/tournament-mode/ai/tournamentContextForChimmy.ts:16-40`) fetches the tournament's config/name/status/settings using `leagueId` alone — `userId` is only used later for an unrelated per-participant lookup, never as a membership gate.

**Not independently verified:** the other ~14 functions sharing this exact call signature (dynasty, keeper, best ball, guillotine, survivor, IDP, Big Brother, zombie, devy, C2C, salary cap, redraft, dynasty war room, guillotine war room, trade) may share this gap or may each self-guard — unverified either way pending a dedicated pass.

**Separately, agent-sourced and flagged ambiguous rather than confirmed:** `app/api/ai/chimmy/route.ts` (the fourth route, Finding 4) reads `leagueId` from the body with no `assertLeagueMember` call anywhere, unlike every sibling route — the investigating agent could not conclusively trace a downstream query that leaks another user's data solely on this raw `leagueId` within its time budget, so this is flagged as a real inconsistency worth a follow-up trace, not a confirmed leak.

### 8. [TRUST/HONESTY — mixed, precise] Anti-hallucination coverage is real, but each active route uses a narrower guard than a more complete one already sitting unused nearby — **[verified directly + agent-sourced, spot-checked]**

`lib/chimmy-chat/hallucination-guard.ts`'s `checkChimmyHallucination()` runs before the response reaches the client in `app/api/chat/chimmy/route.ts:1971` (line 1995 can replace the answer entirely). Real, deterministic, regex-based checks against the actual grounding text: ungrounded numeric tokens, invented W-L records, suspicious "#N" rankings — with a real severity policy (2+ hard issues → replace with a fallback message; 1 hard or 2+ soft → prepend a disclaimer; otherwise pass through). This is a genuine backstop, not aspirational copy. Its own header comment describes a 4th check category — "invented player names" — that is **not actually implemented** (only 3 check functions exist).

`app/api/ai/chat/route.ts` has no equivalent at all: `runCostControlledOpenAIText` (`lib/ai-cost-control/AICostControlService.ts:86-177`) and `lib/openai-client.ts` do nothing but cache/dedupe and return `response.choices[0].message.content` verbatim — no inspection of the model's claims anywhere, confirmed by reading every function in both files. On the streaming branch this isn't just unimplemented, it's architecturally impossible as written — chunks stream straight to the client as OpenAI emits them, before any full response exists to check.

**More significant: a materially more complete validator already exists in this codebase and isn't wired into either chat route.** `lib/ai/responseValidator.ts` (`validateAIResponse`/`applyValidationPipeline`) checks five categories — `score_invention`, `live_data_overclaim`, `odds_without_data`, `plan_gate_violation`, `private_info_exposure` — and can either BLOCK (replace with a deterministic fallback) or WARN (regex-sanitize). Its only callers, confirmed via grep, are `lib/ai/engine/engine.ts` (the shared engine behind pool/pick'em-style features: AEW, EPL, March Madness, MLB, NBA, NHL, pick'em, survivor, UFC, World Cup, NFL pool, War Room) and the World Cup service files directly. Neither `app/api/ai/chat/route.ts` nor `app/api/chat/chimmy/route.ts` imports it. This is the same shape as the billing gap in Finding 4: a stronger, already-built safeguard exists, just not applied to the flagship Chimmy chat surfaces.

### 9. [TRUST/HONESTY — refined: exists, but not wired to either chat route] Guarantee-language prohibition exists in this codebase, just not in the pipeline that reaches the user — **[verified directly for the negative + agent-sourced for the positive, spot-checked against my own Q9 read]**

The only rule-enforcement mechanism actually wired into the Chimmy response pipeline (`checkBehaviorRules`/`BEHAVIOR_RULES`, `lib/ai/behavior-rules.ts:35-85`) is a set of **code-generation conduct rules** — "Protect working code," "Verify referenced files," "Prefer minimal scope," "Avoid invented APIs," "Avoid scope creep" — that read like an AI *coding* assistant's own operating rules, not fantasy-sports domain safety rules. None of them meaningfully apply to a fantasy chat answer, and none prohibit phrasing like "this trade will win your league." Even where a hard rule violation *is* detected, the second, final check after the answer is fully built (`app/api/chat/chimmy/route.ts:2002-2022`) only logs it (`console.warn`) — it doesn't block or modify the response; only the earlier, PECR-internal check can trigger an actual retry.

**But the prohibition itself already exists, unused by either main route:** `lib/chimmy-interface/ChimmyPromptStyleResolver.ts:22,27` lists "Absolute guarantees for uncertain outcomes" as a trait to avoid and instructs using "projection language for uncertain outcomes." Its only confirmed consumers are `lib/ai-orchestration/orchestration-service.ts` and `lib/ai-product-layer/AIConsistencyGuard.ts` — neither imported by `app/api/ai/chat/route.ts` or `lib/chimmy-context/**`. Separately, dedicated fact-guard modules with real guarantee-word regexes (`/\b(guaranteed|100%|certain(ly)?)\b/i` or similar) exist for other features: `lib/unified-ai/AIFactGuard.ts`, `lib/league-story-creator/StoryFactGuard.ts`, `lib/chimmy-trade/answerPolicy.ts`, `lib/ai/bracket-orchestrator.ts` ("You DO NOT promise wins, guarantees, or locks."). None of these are confirmed wired into either primary chat route. An admin-configurable `aICustomRule` DB table also exists and could theoretically hold a guarantee-language rule, but nothing in the code guarantees this, and its live contents weren't inspected in this pass (no safe read-only DB access was available in this environment — see Finding 15).

### 10. [ACCESS CONTROL — confirmed good, positive example] The Chimmy Context Engine is safe by construction — **[agent-sourced, spot-checked against my own earlier `loadLeagueSnapshotForUser` read]**

`lib/chimmy-context/ChimmyContextEngine.ts`'s providers each independently re-validate the requester's own access regardless of what `leagueId` they're handed — `LeagueContextProvider` filters by `OR:[{userId},{redraftMembers:{some:{userId}}},{teams:{some:{claimedByUserId:userId}}}]` (a non-member `leagueId` just fails to match and falls back safely, no error, no leak); `RosterContextProvider` resolves the viewer's own team row and yields an empty roster for a non-member. This holds even though the engine's own docstring says callers "must" guard access before calling it — the providers don't actually depend on that being true. A genuine defense-in-depth example, in contrast to Finding 7.

### 11. [ACCESS CONTROL — confirmed good] Commissioner-facing Chimmy surfaces are properly scoped; no reachable B2B/tenant surface exists — **[agent-sourced, spot-checked against my own read of the schema's tenantId usage]**

Every commissioner-facing Chimmy route (`ai-commissioner/route.ts`, `.../chat/route.ts`, `.../explain/route.ts`, `.../run/route.ts`, `.../unified/route.ts`) is gated by `assertCommissioner`/`assertLeagueMember` on the session's own `userId`, and everything they touch is `leagueId`-filtered aggregate/reputation/dispute data — no path found into an individual manager's private conversation history or token balance. Separately, no `B2BClient`/`Tenant` model exists in the schema; `tenantId` columns are fixed-`"allfantasy"`-default provenance tags on 5 analytics models, never a query filter, and the one "Widget SDK" scaffold is an explicitly-documented no-auth/no-DB sandbox with zero live routes wired to it.

### 12. [TRUST/HONESTY — confirmed real, but only in one route, and only via one of two mechanisms] Freshness timestamps are genuinely backed by real data — when they reach the user at all — **[verified directly + agent-sourced, spot-checked]**

`buildChimmyStalenessWarning` (`app/api/chat/chimmy/route.ts:1071-1074`) computes staleness from `leagueSnapshot?.lastSyncedAt`, a real DB timestamp, and the resulting warning is **programmatically appended** to the display text by the server (line 1965-1967) — not merely requested via prompt instruction, so it survives even if the model ignores the "always include this" directive. `chimmySportDigestFreshness` (real per-source ingest timestamps) is separately surfaced in the response's `meta.syncFreshness` field, confirmed by the route's own test.

`app/api/ai/chat/route.ts`'s Chimmy Context Engine path has the *raw data* for the same kind of mechanism but doesn't use it: `ProviderResult.fetchedAt`/`cached`/`durationMs` (`lib/chimmy-context/types.ts:22-33`) are real, computed-at-fetch-time values (e.g. `RankingContextProvider.ts:47`, `new Date().toISOString()` captured at the start of `load()`) — but none of the `render*Section` functions in `lib/chimmy-context/prompt/sections.ts` render them into the text the model sees, and a repo-wide search of `app/`/`components/` for `chimmy_context`/`chimmyContextMeta` found no UI that renders this telemetry to a user either. It exists in the raw JSON response and in an internal `chimmy_context_runs` telemetry table, never as visible text.

### 13. [ERROR HANDLING — mixed, confirmed both ways] Some routes are honest about failure, others silently degrade — **[verified directly for the two primary routes + agent-sourced for the breadth check]**

Both primary routes return explicit errors ("No response from AI," Chimmy's generic error message) on an outright LLM failure — no evidence of silently substituting fabricated content there. But sampling other Chimmy-adjacent routes found real, inconsistent divergence: `app/api/ai/coaching/plan/route.ts` returns HTTP 200 with a heuristic fallback plan on failure, disclosed only via a `usedFallback` flag a naive client integration might not check; `server/api-route-modules/league-survivor/ai/route.ts` silently serves a 30-minute-stale cached result with no `cached`/`stale` marker; `app/api/player-comparison/insight/route.ts` silently falls back to a canned template string when all three providers fail, returned as the top-level recommendation field with HTTP 200. For direct contrast, `app/api/ai/tools/long-term-coaching/route.ts` and `app/api/draft/ai/draft-recap/route.ts` both return honest non-200 errors on the identical failure mode — this is inconsistent within the same codebase, not a single systemic gap.

### 14. [ACCESS CONTROL — ambiguous, needs a product decision] `privateMode`/`targetUsername` has no visible permission gate — **[verified directly]**

`app/api/chat/chimmy/route.ts` accepts `privateMode`/`targetUsername` fields and injects `PRIVATE MODE TARGET: {targetUsername}` directly into the model's prompt with no check that the requester has any relationship to that target — not even a shared-league check. `targetUsername` does not appear to feed any actual data-fetch (narrowing this from a data leak to "Chimmy could be steered into making unfounded claims about a named real person"). Needs a product decision: is this meant to let a user ask about a specific other manager at all, and if so, what should gate it?

### 15. [Explicitly could not verify — disclosed, not guessed] Sampling real logged Chimmy responses for confident-unsupported claims

The brief asked to sample real logged responses for hallucination risk. `AiOutput` (`prisma/schema.prisma:2313-2332`) is written on every `/api/ai/chat` call with the raw model output verbatim (`lib/ai/output-logger.ts:20-41`, consistent with Finding 8's "no validation gate" finding for that route). No `DATABASE_URL` was available in this environment, and no existing safe read-only script targets this table (one careful read-only pattern exists, `scripts/manager-intelligence/validate-nonprod-readonly.ts`, but it targets unrelated Redraft models). Per this audit's own no-new-DB-code constraint, this step was correctly skipped rather than worked around. A human with DB credentials should run something like `prisma.aiOutput.findMany({ where: { taskType: 'ai_chat' }, orderBy: { createdAt: 'desc' }, take: 20 })` to close this gap.

---

## What the confirmed-correct patterns tell us

This is the most useful pattern across the whole audit: for every category of gap found, **a correct, already-shipped version of the fix exists elsewhere in this same codebase** — nothing here requires inventing a new approach.

| Gap | Where it's broken | Where it's already done correctly |
|---|---|---|
| Charge before vs. after success | 11+ routes (Finding 4) | World Cup AI routes — `prepareWorldCupAiTokenFallback()`, "charge after validation, not before" |
| League-membership re-validation | `build*ContextForChimmy` (Finding 7) | Chimmy Context Engine providers (Finding 10) |
| Response fact-checking | Both primary chat routes have only a narrow or no guard (Finding 8) | `lib/ai/responseValidator.ts` — 5-category block/warn pipeline, used by pool/pick'em features + World Cup |
| Guarantee-language prohibition | Not in either chat route's pipeline (Finding 9) | `ChimmyPromptStyleResolver.ts`, `AIFactGuard.ts`, `StoryFactGuard.ts`, `bracket-orchestrator.ts` |
| Cache/staleness disclosure | `/api/ai/chat`, Survivor AI (Finding 6) | World Cup's `coachingFromCache`/`dataSourceTier` freshness chip |
| Cross-conversation ownership check | In-chat memory recall (Finding 2) | `/api/chimmy/conversations/[id]/route.ts` CRUD API |

The pattern strongly suggests these are not "nobody knows how to build this safely" gaps — they're "the flagship Chimmy chat surfaces were built on a separate track from the safety infrastructure that already exists for adjacent features," and closing them is a wiring problem more than a design problem.

## Explicitly out of scope (per the brief)

Feature-integration completeness, personalization/memory UX, notifications, analytics, tone/brand consistency (tracked separately in `docs/CHIMMY_REBRAND_DISCOVERY_AUDIT.md`). No fixes were applied in this pass.
