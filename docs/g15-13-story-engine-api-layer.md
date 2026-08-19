# G15.13 — Story Engine API Layer

**Status:** complete (backend API only). Exposes the G15.12 Story Engine through stable,
versioned, privacy-safe API contracts that can later power Commissioner Hub story cards, a League
Network feed, Chimmy story summaries, HeyGen/video scripts, and external licensing.

**Explicitly NOT in this phase:** Story UI, auto-post to chat, LLM calls, write actions,
event-architecture changes. None added.

---

## 1. Routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/stories/leagues/[leagueId]/types` | member | List supported story types + access levels |
| GET | `/api/v1/stories/leagues/[leagueId]/preview?type=<storyType>` | per-type | Privacy-safe preview of one story |

Route files are **thin wrappers** ([types](../app/api/v1/stories/leagues/[leagueId]/types/route.ts),
[preview](../app/api/v1/stories/leagues/[leagueId]/preview/route.ts)) that call the handler cores
with real deps. All story logic lives in [`lib/story/api/handlers.ts`](../lib/story/api/handlers.ts);
the only data call is `StoryEngine.generateStory` — **no raw events, no provider data, no
duplicated generation logic** in routes.

## 2. Permission model

Access is resolved with the existing league-access helpers (`assertLeagueMember` /
`assertLeagueCommissioner`) — the same pattern as the G15.5 intelligence API.

| Story type | Access |
|---|---|
| What Happened Recently (`what_happened_recently`) | member |
| League Activity Report (`activity_report`) | member |
| Weekly League Recap (`weekly_recap`) | member |
| Commissioner Summary (`commissioner_summary`) | commissioner |
| League Health Narrative (`health_narrative`) | commissioner |

Weekly Recap is member-readable because its draft exposes only activity counts + engagement
ratios + the public timeline — it does **not** surface commissioner-only action items (those are
the Commissioner Summary / Health Narrative, both commissioner-gated).

Status codes: `401` unauthenticated · `403` not a member / not a commissioner · `404` league not
found · `400` unknown or missing `type`.

## 3. Feature-gate model

A story entitlement seam ([`lib/story/featureGate.ts`](../lib/story/featureGate.ts)) mirrors the
G15.4 intelligence gate: one feature key per story type (`story.<type>`), an `IStoryFeatureGate`
port, and a default **allow-all** implementation. The preview handler asks the gate before
generating; non-`allow` decisions map to:

- `upgrade_required` → **402** `{ error: 'feature_unavailable', feature, decision }`
- `deny` → **403** `{ error: 'feature_unavailable', feature, decision }`

Default behavior is unchanged (everything allowed). A later phase can swap a Stripe-backed gate in
at this single boundary to make specific story types premium.

## 4. Privacy-safe DTOs

`StoryPreviewDTO` is an **allow-listed** projection — only:
`type`, `title`, `summary`, `sections`, `safetyNote`, `status`, `empty`, `generatedAt`,
`sourceFreshness`. No raw payloads, private ids, provider tokens, raw chat content, or hidden
metadata. `sourceFreshness` is the last recorded league activity timestamp (freshness hint only).
A test injects a leaked id-bearing field into the engine result and asserts the DTO mapping drops
it.

### Response examples

`GET …/types` →
```json
{ "data": [
  { "type": "what_happened_recently", "title": "What Happened Recently", "access": "member" },
  { "type": "activity_report", "title": "League Activity Report", "access": "member" },
  { "type": "weekly_recap", "title": "Weekly League Recap", "access": "member" },
  { "type": "commissioner_summary", "title": "Commissioner Summary", "access": "commissioner" },
  { "type": "health_narrative", "title": "League Health Narrative", "access": "commissioner" }
]}
```

`GET …/preview?type=activity_report` →
```json
{ "data": {
  "type": "activity_report",
  "title": "League Activity Report",
  "summary": "12 recorded action(s); 2 open trade(s).",
  "sections": [
    { "heading": "Totals", "body": "12 recorded action(s) since 2026-06-01T00:00:00.000Z." },
    { "heading": "By type", "body": "• trade: 4\n• waiver: 3\n• scoring: 2\n• lineup: 2\n• draft: 1" },
    { "heading": "Open items", "body": "2 open trade proposal(s). Last activity: 2026-06-26T00:00:00.000Z." }
  ],
  "safetyNote": "Derived from recorded in-app activity only. Observations, not accusations …",
  "status": "ok",
  "empty": false,
  "generatedAt": "2026-06-28T00:00:00.000Z",
  "sourceFreshness": "2026-06-26T00:00:00.000Z"
}}
```

Empty-state preview returns `200` with `empty: true` and the safe "not enough recorded activity"
copy. Feature-denied returns `402`/`403`.

## 5. Tests

- `__tests__/story/story-api.test.ts` (12): types listing + access labels; auth (401/403);
  successful preview DTO + allow-listed key set; unknown/missing type (400); empty-state 200;
  member vs commissioner enforcement per type; feature-gate deny (403) / upgrade (402) / default
  allow; privacy no-leak; "engine is the only data call".
- `__tests__/story/story-engine.test.ts` (13): G15.12 engine suite (still green).
- Regression `story + intelligence + events`: **115 passed, 10 skipped** (the 10 are DB integration
  tests gated behind `RUN_EVENT_DB_IT=1`).

## 6. Future plan (NOT built here)

- **UI:** Commissioner Hub story cards + a League Network feed consuming these contracts (read-only,
  same contract-only pattern as G15.6).
- **Auto-post:** opt-in posting of a recap to league chat (commissioner-gated write action —
  separately approved phase).
- **LLM:** route `StoryEngine.buildPrompt` output through the existing AI pipeline behind a flag for
  richer prose; deterministic draft remains the always-available fallback.
- **HeyGen/video + licensing:** `StoryPreviewDTO` (privacy-safe) is the natural input for a
  video-script/HeyGen step and for future external licensing; both remain out of scope until
  separately approved.

## 7. Boundaries honored
No UI, no auto-post, no LLM call, no write actions, no event-architecture changes, no raw
event/provider access. Additive; StoryEngine is the sole data source; DTOs are allow-listed.
