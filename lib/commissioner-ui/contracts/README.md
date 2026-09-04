# Commissioner OS Platform Contracts

The single source of truth for cross-module communication shapes.
`CONTRACT_VERSION` (currently `1.0.0`) bumps on any breaking change.

## Repository discovery findings

`types/platform-shared.ts` (`PlatformNotification`, `PlatformChatThread`,
etc.) and `types/platform-service-map.ts` (`PlatformServiceMap`) already
exist — but both are scoped to the existing app's cross-product surfaces
(wallet, chat, the existing `shared/app/bracket/legacy` product taxonomy),
not Commissioner OS. Same pattern as `lib/commissioner`, `lib/shell`'s
`ProductId`, and `lib/feature-toggle`'s `FEATURE_KEYS` from earlier
phases: same general word, different owner and content. Isolated, not
extended — Commissioner OS's notification and service types use this
platform's own severity vocabulary and module taxonomy instead.

`lib/search`'s result-category pattern was reused as direct structural
inspiration for `searchResults.ts` specifically, since that system is the
real, intended integration target for Commissioner OS's eventual Search
work (see `lib/commissioner-os/platform/README.md`).

## Strategy: re-export, don't move

Rather than relocating the type definitions already living in
`lib/commissioner-os/navigation/moduleNav.ts`, `featureFlags.ts`,
`platform/events.ts`, and `platform/serviceRegistry.ts` — which would
touch already-tested Phase 0.2/0.3 code for no functional gain — this
directory **re-exports** them. The dependency runs one direction only
(contracts depends on the implementation files' type exports; nothing in
those files imports from `contracts/`), so this satisfies "avoid circular
dependencies" without any regression risk to working code.

## What's genuinely new here

- `errors.ts` — a platform-wide error shape every interface returns
  instead of throwing untyped errors.
- `response.ts` — the standard response envelope, including a `source:
  'live' | 'stub'` field — the mechanism that makes stub-versus-real data
  checkable in code, not just documented in a comment. Mission Control
  uses this directly.
- `metadata.ts` — formalizes the four-tier confidence vocabulary
  (Recommendations Center §9) as a shared type.
- `notifications.ts`, `activity.ts` — payload contracts for the future
  Notification Center and Activity Stream, sharing one severity
  vocabulary between them.
- `searchResults.ts` — shaped for future compatibility with `lib/search`.
- `moduleRegistration.ts` — ties a module's id, route, and flag key
  together, plus a documented (not enforced) provider naming convention.
