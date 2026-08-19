# G15.10 — Live Chimmy Commissioner Grounding Pass-Through

**Status:** complete. Wires the live Chimmy chat pipeline so commissioner-intelligence grounding
(G15.9) **auto-attaches** to commissioner/league-health questions. Pass-through integration only —
no Story Engine, write actions, Hub UI, event-architecture changes, or raw provider/payload access.
The chat route is **not** rewritten; changes are minimal + additive + best-effort.

---

## 1. Live pipeline integration point
- **Resolver:** `lib/intelligence/chimmy/resolveChimmyGrounding.ts` —
  `resolveChimmyCommissionerGrounding({ userId?, leagueId?, question?, commissionerFlag? }, deps?)`.
  Gates the request, builds the privacy-safe grounding text (via the G15.9 adapter → Query
  Service only), and **never throws** (returns `null` on any miss). Deps are injectable for tests.
- **Route** (`app/api/chimmy/route.ts`), both execution paths:
  - **Legacy forwarded path:** `buildForwardedRequest(req, data, commissionerGrounding)` appends a
    `commissionerGrounding` field to the forwarded `FormData` (the external Chimmy service uses it;
    ignored harmlessly if not).
  - **Anthropic path:** `anthropicContext.commissionerGrounding = await resolveChimmyCommissionerGrounding(...)`.
- **Agent pipeline** (`lib/agents/anthropic-pipeline.ts`): `UserContext` gains an additive
  `commissionerGrounding?: string | null`; `buildRuntimeSystemPrompt` appends it under a
  `## COMMISSIONER INTELLIGENCE` section when present. (2-line additive change — no streaming/token/
  cap flow touched.)

## 2. Gating rules (grounding attaches only when ALL hold)
1. a `leagueId` is present, **and**
2. the question matches commissioner/league-health **intent** (G15.9 `detectCommissionerIntelligenceIntent`) **or** an explicit `commissionerFlag`, **and**
3. the requester is a **league commissioner** (`assertLeagueCommissioner`), **and**
4. the **feature gate** allows it (enforced inside `buildCommissionerGrounding`).

Otherwise → `null` → the chat proceeds exactly as before. The gate also short-circuits **before**
any DB work for non-commissioner-intent questions (no added latency on ordinary chats).

## 3. Fallback behavior
- Any failure (no league, no intent, not a commissioner, feature denied, DB error) → `null` →
  **no grounding attached, chat continues normally**. The resolver is wrapped in try/catch and can
  never break a chat turn. Empty-but-allowed leagues return the adapter's "not enough data yet"
  text so Chimmy can say so safely.

## 4. Privacy
Grounding text comes from the G15.9 adapter: counts/scores/labels + cautious, non-accusatory
framing; **no** raw payloads, chat content, provider tokens, or user ids/names (action-item `meta`
is stripped). Verified by the G15.9 + resolver tests.

## 5. Before / after forwarded payload shape
```
# before (ordinary or non-commissioner question)
FormData{ message, messages?, sport?, leagueName?, leagueId?, sessionId?, … }

# after (commissioner question, by a commissioner, league present)
FormData{ …same…, commissionerGrounding: "COMMISSIONER INTELLIGENCE (read-only…)\nLeague activity:\n- total recorded events: 42\n…" }
```
Anthropic path: the same grounding text is appended to the system prompt under
`## COMMISSIONER INTELLIGENCE`. Non-commissioner / ordinary questions: **unchanged** (no field, no
section).

## 6. Tests
- `resolve-chimmy-grounding.test.ts` — gating: commissioner-intent attaches; ordinary question
  gates out (no DB calls); explicit flag bypasses intent; null when no league / not commissioner /
  no user / restricted; **never throws** on error.
- `chimmy-pipeline-wiring.test.ts` — source contract: route invokes the resolver in both paths;
  `buildForwardedRequest` appends grounding **and preserves** existing fields (regression guard);
  pipeline `UserContext` + `buildRuntimeSystemPrompt` include the grounding.
- G15.9 adapter tests (privacy/empty/restricted) still hold; event + commissioner-hub suites pass.

## 7. Known limitations
- The legacy path forwards `commissionerGrounding` to the external Chimmy service; whether that
  service injects it into the model is owned by that service (the field is provided, used if read).
  The Anthropic path consumes it directly via the system prompt.
- Read models populate only once the relay runs in prod (G15.8) — until then the resolver returns
  the safe "not enough data" grounding (or null).
- Feature gate is allow-all today; the `restricted` path (→ null) already handles future premium
  denial.
- Live browser/chat proof not run here (would need the deployed app + a relay-populated commissioner
  league); covered by unit + source-contract tests and the G15.7 hub browser proof of the data path.
