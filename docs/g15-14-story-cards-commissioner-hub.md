# G15.14 — Story Cards in Commissioner Hub (read-only UI)

**Status:** complete (read-only UI only). Adds a **League Stories** section to the Commissioner
Intelligence Hub that renders the G15.12/G15.13 deterministic story drafts via the versioned story
API. No write actions, no auto-post to chat, no LLM call, no event-architecture changes, no raw
DB/provider/payload access.

---

## 1. What was added
- `components/commissioner-intelligence/CommissionerIntelligenceHub.tsx`:
  - `StoryCard` — fetches `GET /api/v1/stories/leagues/[leagueId]/preview?type=<type>` and renders
    title, summary, sections (heading + body, line breaks preserved), and the safety note.
  - `StoriesModule` — a "League Stories" card rendering one `StoryCard` per story type in a grid.
  - Wired into the hub between Action Items and the Activity Timeline.
- Local contract types only (`StoryPreview`, `StorySection`) — the client bundle never imports
  server-only story modules; it consumes the API contract just like the existing modules.

## 2. Story types shown
Member-readable: **Weekly League Recap**, **What Happened Recently**, **League Activity Report**.
Commissioner-only: **Commissioner Summary**, **League Health Narrative** (these render a clean
"Commissioner only" card for non-commissioners — the API returns 403 and no content leaks).

## 3. State handling (each card owns its state)
Reuses the hub's `useResource` + `StateMessage` pattern:
- **loading** → "Loading…"
- **ok + content** → summary + sections + safety note
- **ok + empty** → the API's safe empty headline ("Not enough recorded league activity yet…")
- **401/403/404** → "Commissioner only" (commissioner types) / "Not available" — never content
- **402** → "Premium feature — upgrade required" (story feature-gate is allow-all today; the path is ready)
- **error** → "Could not load. Try again."

## 4. Safety / privacy
- Read-only: no buttons that mutate, no posting, no LLM trigger — the API is deterministic.
- The card renders only allow-listed DTO fields (`title`, `summary`, `sections`, `safetyNote`,
  `generatedAt`, `sourceFreshness`); no payloads, ids, or tokens are present in the contract.
- The G15.12 cautious/non-accusatory `safetyNote` is shown on every populated card.

## 5. Tests
`__tests__/commissioner-intelligence/hub.test.tsx` (extended): member story cards render content +
safety note; commissioner-only types render restricted (no content leak); safe empty-state;
upgrade (402) state. Full suite **10 passed**.

## 6. Verification
- RTL renders the real component DOM across all Story Card states (passing).
- The hub's data path + empty-state rendering were proven live on the `g15-event-foundation`
  preview deploy (G15 smoke); Story Cards use the identical fetch/contract pattern.
- A local dev-server render is not meaningful here — `/league/[id]/intelligence` is auth-gated
  (middleware redirects unauthenticated requests to login).

## 7. Future plan (NOT built here)
- Per-type expand/refresh controls; a League Network feed surface.
- Opt-in auto-post of a recap to league chat (commissioner-gated write action — separate phase).
- LLM-enriched prose behind a flag (deterministic draft stays the fallback).
- HeyGen/video script + external licensing (separate, approved later).

## 8. Boundaries honored
No write actions, no auto-post, no LLM call, no event-architecture changes, no raw
DB/provider/payload access. Additive, contract-only consumption, privacy-safe.
