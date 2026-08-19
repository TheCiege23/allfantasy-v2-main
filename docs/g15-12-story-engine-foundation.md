# G15.12 — Story Engine Foundation

**Status:** complete (backend narrative infrastructure only). Builds the AllFantasy **Story Engine**
on top of the G15 Commissioner Intelligence read models. Deterministic narrative drafts today;
LLM-ready (but not LLM-calling) prompt output for later.

**Explicitly NOT in this phase:** Story UI, auto-post to league chat, write actions, event-architecture
changes, raw provider/payload access, external SDK/licensing. None added.

---

## 1. Architecture & service boundary

```
IntelligenceQueryService (G15.4 read models)        ← the ONLY data source
        │  getLeagueActivitySummary
        │  getLeagueHealthSnapshot
        │  getCommissionerActionItems
        │  getLeagueAuditFeed
        ▼
StoryDataSource (Pick<> of the 4 read methods)       lib/story/storyContextBuilder.ts
        ▼
buildStoryContext()  → privacy-safe StoryContext     (strips PII, never throws)
        ▼
generateStoryDraft(type, ctx)  → StoryDraft          lib/story/storyGenerator.ts  (pure, deterministic)
buildStoryPrompt(type, ctx)    → StoryPrompt          (LLM-ready; does NOT call a model)
        ▼
StoryEngine facade                                   lib/story/StoryEngine.ts
  generateStory / generateAllStories / buildPrompt
```

The engine depends on a narrow `StoryDataSource` interface (`Pick` of the four read methods), **not**
on Prisma, providers, the event bus, or raw payloads. This keeps the boundary future-safe: any
read model that implements those methods can feed it. The barrel (`lib/story/index.ts`) is free of
`server-only`-tainted imports, so it is safe to import from scripts/tests as well as server code.

## 2. Story types (initial)

| Type | id | What it tells |
|---|---|---|
| Weekly League Recap | `weekly_recap` | Activity volume, engagement, recent highlights |
| Commissioner Summary | `commissioner_summary` | Health + action items needing attention |
| League Activity Report | `activity_report` | Totals, breakdown by type, open items |
| What Happened Recently | `what_happened_recently` | The recent audit-feed timeline |
| League Health Narrative | `health_narrative` | Overall health, participation, cautious notes |

Each is a **pure function of the context** → deterministic, fully testable, identical output for
identical input. The `StoryDraft` carries `title`, `headline`, `sections[]`, `bullets[]`, a flat
`text` rendering, and an `empty` flag.

## 3. Context fields (`StoryContext`)

All fields are counts / scores / labels / pre-summarized strings — **never** raw rows:
- `status`: `ok | empty | restricted`
- `leagueId`, `sport`, `leagueConcept`, `generatedAt`
- `activity`: `totalEvents`, `firstEventAt`, `lastActivityAt`, `openTradeProposals`, `counts` (by category)
- `health`: `score`, `status`, `activeManagers`, `totalManagers`, `daysSinceLastActivity`
- `actionItems[]`: `{ kind, severity, message }` — **`meta` stripped** (it can hold league-internal user ids)
- `recent[]`: `{ type, summary, occurredAt }` — from the already-sanitized audit feed

## 4. Safety / privacy rules (enforced)

- **No raw event payloads** — only the read-model aggregates are read.
- **No private user ids / names** — action-item `meta` is dropped at the builder; verified by tests
  that inject a secret user id and assert it never appears in context, draft, or prompt output.
- **No provider tokens, no raw chat content** — not reachable from the `StoryDataSource`.
- **Cautious, non-accusatory language** — `STORY_SAFETY_NOTE` ("observations, not accusations; no
  claims of collusion, tanking, or bad faith; inactivity described as *appears inactive based on
  recorded activity*") is baked into drafts and the LLM system prompt.
- **Never throws** — feature-gate/access errors → `restricted`; no activity → `empty`; any other
  error → `empty`. A story request can never break a caller.

## 5. Deterministic first, LLM-ready second

Per the objective, the **deterministic** generator is the primary implementation — stories render
with **no** model dependency, so the engine works offline, in tests, and at zero marginal cost.
`buildStoryPrompt` additionally emits a privacy-safe `{ system, user }` pair for a future LLM pass,
but **G15.12 does not call any LLM** (consistent with keeping AI calls opt-in and out of this
backend-only phase). The prompt body is the same privacy-safe context (no payloads/ids).

## 6. Files

**Added**
- `lib/story/types.ts` — `STORY_TYPES`, `StoryContext`, `StoryDraft`, `StoryPrompt`, etc.
- `lib/story/storyContextBuilder.ts` — `buildStoryContext`, `StoryDataSource` (privacy-safe, never-throws)
- `lib/story/storyGenerator.ts` — `generateStoryDraft`, `buildStoryPrompt`, `STORY_SAFETY_NOTE`
- `lib/story/StoryEngine.ts` — `StoryEngine` facade
- `lib/story/index.ts` — barrel
- `__tests__/story/story-engine.test.ts` — context / empty / restricted / privacy / per-type / prompt / facade
- `docs/g15-12-story-engine-foundation.md` — this doc

**Modified:** none (purely additive).

## 7. Tests

- `__tests__/story`: **13 passed** (context construction, empty-state, restricted access, never-throws,
  privacy no-leak, each of the 5 story types, empty-state per type, LLM-ready prompt, engine facade).
- Regression: `__tests__/story` + `__tests__/intelligence` + `__tests__/events` → **103 passed, 10
  skipped** (the 10 are DB integration tests gated behind `RUN_EVENT_DB_IT=1`).

## 8. Future plan (NOT built here)

- **UI:** a Story surface in the Commissioner Hub (read-only first), consuming `StoryDraft` via a
  future `/api/v1/intelligence/.../stories` route — same contract-only pattern as G15.6.
- **Auto-post:** opt-in posting of a recap to league chat on a schedule (commissioner-gated; an
  explicit, separately-approved write action — not in this phase).
- **LLM pass:** route `buildStoryPrompt` through the existing AI pipeline behind a flag for richer
  prose, keeping the deterministic draft as the always-available fallback.
- **HeyGen / video script:** the deterministic `StoryDraft.text` (privacy-safe) is the natural
  source for a future video-script/HeyGen avatar narration step; the engine already produces clean,
  citation-bounded narrative text with no PII, so a script adapter can consume it without touching
  raw data. External SDK/licensing remains out of scope until separately approved.

## 9. Boundaries honored
No UI, no auto-post, no write actions, no event-architecture changes, no raw provider/payload
access, no external SDK/licensing, no LLM call. Additive + never-throw; read-models-only data source.
