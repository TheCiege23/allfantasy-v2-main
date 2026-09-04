# Commissioner OS Shared Platform Infrastructure

Phase 0.3 foundation — the common infrastructure Search, Notifications,
Activity Stream, and Help Center were all built on top of (all four are
now implemented; see each one's own README linked below). No service
behavior is implemented here.

## Repository discovery findings that shaped this

- **`lib/search/` already exists** — `UniversalSearchService`,
  `SearchOverlayController`, `QuickActionsService`, a real command-palette
  keyboard shortcut, query normalization, and result grouping, for the
  existing app's leagues/players/pages/tools. This is structurally the
  same kind of infrastructure the Global Search & Command Palette
  blueprint describes, just scoped to different content. The blueprint's
  own framing — "owns search experience, command execution, navigation
  shortcuts... does not own recommendations/analytics/etc... only
  provides fast access" — already anticipated this; the search placeholder
  contract here (`serviceRegistry.ts`) was deliberately minimal so a future
  phase could align it with `lib/search`'s real types rather than
  reconciling two incompatible shapes.
  **Update (Phase 1.8):** that future phase confirmed `lib/search`'s
  overlay/`ResponsiveNavSystem` is never mounted anywhere under
  `app/commissioner-os/` — there is no existing keyboard-shortcut or
  overlay instance on Commissioner OS routes to extend. Commissioner
  OS built its own self-contained command palette instead (on
  `components/ui/command.tsx`, per Phase 0.4's own note that it was
  "directly relevant to the future Search integration"), rather than
  modifying `lib/search`'s shared, whole-app files to special-case
  Commissioner OS content. See
  [Global Search's README](../../../components/commissioner-os/search/README.md)
  for the full reasoning — the two systems are deliberately separate
  today, not yet reconciled.
- **`lib/logging/structured.ts` already exists** — a clean, documented,
  PII-conscious structured logger. Any future platform-service logging
  reuses this; nothing new was built for it.
- **No event bus, message bus, or state-management library exists.** The
  event bus and platform context in this phase are genuinely new
  infrastructure, not duplicates of anything found.
- **A real, separate toast delivery mechanism (`sonner`) is already used
  in a couple of places elsewhere in the app.** **Update (Phase 1.9):**
  Notification Center did not integrate with it — `sonner` is ephemeral,
  fire-and-forget toast popups, while Notification Center's entire remit
  is a *persistent* read/unread inbox (history, categories, preferences).
  These answer different questions; forcing them together would have been
  the same kind of unwarranted merge Phase 1.8 avoided with `lib/search`.
  See [Notification Center's README](../../../components/commissioner-os/notifications/README.md).

## What's here

- `events.ts` — type-level cross-module event contracts. No producers or
  consumers yet.
- `eventBus.ts` — a minimal, typed publish/subscribe bus. Deliberately
  **not** a runtime service locator: modules still import each other's
  public interfaces statically, which is what the Engineering Conformance
  Gates' import-graph checks depend on being true.
- `serviceRegistry.ts` — a static, type-level registry of the four
  platform services (Search, Notifications, Activity Stream, Help
  Center), each marked with whether it has a dedicated blueprint.

## An honest gap, not a decision (closed in Phase 1.11)

**Help Center had no grounding anywhere in the architecture series** — it
did not appear in the Product Requirements Document, the Architecture
Index, or the Decision Ownership Matrix. It was included here only because
Phase 0.3's task explicitly requested a placeholder for it. This gap was
treated exactly as prescribed: Phase 1.11 began with a Discovery Report
that confirmed the gap was real rather than assuming it away, then an
ADR-equivalent blueprint (`lib/commissioner-os/help/BLUEPRINT.md`) was
authored and approved *before* any implementation — see
[Help & Knowledge Center's README](../../../components/commissioner-os/help/README.md)
for what was actually built from it.

## Provider composition

`CommissionerPlatformProvider` (in `components/commissioner-os/providers/`)
holds which platform service overlay is currently open (at most one at a
time) and exposes the shared event bus via `useCommissionerPlatform()`.
Composed into `CommissionerOSProviders` alongside the Phase 0.2
navigation/layout/feature-flag providers.

**Update (Phases 1.8–1.9):** `openServiceId`/`openService`/`closeService`
— placeholder infrastructure with no consumer when this file was
written — now genuinely gates two real overlays:
[Global Search's palette](../../../components/commissioner-os/search/README.md)
(`openServiceId === 'search'`) and
[Notification Center's panel](../../../components/commissioner-os/notifications/README.md)
(`openServiceId === 'notifications'`), each mounted once in
`app/commissioner-os/layout.tsx`.

**Update (Phase 1.10):** [Universal Activity Stream](../../../components/commissioner-os/activity/README.md)
is now implemented, but it did **not** join `openServiceId`'s two overlays.
Repository discovery found `'activity'` was already a real
`CommissionerModuleId` with its own sidebar entry and placeholder route —
concrete scaffolding this phase followed rather than retrofitting Activity
Stream into the header-overlay pattern. `serviceRegistry.ts`'s listing of
`'activity-stream'` as a platform service remains accurate at the
type/registry level (Activity Stream genuinely is shared, cross-module
infrastructure other modules feed into), it just isn't reached the same
way Search and Notifications are.

**Update (Phase 1.11):** [Help & Knowledge Center](../../../components/commissioner-os/help/README.md)
is now implemented — the last of the four services this file originally
listed as placeholders, and the one flagged above as "has no grounding
anywhere in the architecture series at all." Because that grounding was
genuinely absent (confirmed by an exhaustive Discovery Report, not
assumed), implementation did not proceed directly from this file the way
Search/Notifications/Activity Stream's phases did — a blueprint
(`lib/commissioner-os/help/BLUEPRINT.md`) was authored and approved first.
Like Activity Stream, Help Center followed the header-overlay-vs-real-module
fork toward "real module": `'help'` is a real `CommissionerModuleId` with
its own sidebar entry, never an `openServiceId` overlay. All four
placeholder services from this phase's original scope are now real.
