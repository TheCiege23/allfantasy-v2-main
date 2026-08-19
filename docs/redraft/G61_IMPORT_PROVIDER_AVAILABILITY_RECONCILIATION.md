# G61 — Import Provider Availability Reconciliation

`lib/league-import/provider-ui-config.ts` gates `ImportProviderSelector.tsx`, the real,
authenticated provider dropdown on `/startup-dynasty` (`disabled={!opt.available}`). Until this
pass, all 6 registered providers were marked `available: true` on the strength of
`hasFullAdapter()` (`lib/league-import/LeagueImportRegistry.ts`) — but that function only checks
whether an adapter *class* is registered, which was true for all 6 regardless of whether a real
user could actually complete an import. This doc records the end-to-end audit that found 3 of the
6 couldn't, and the resulting `available` values now enforced by
`__tests__/league-import/provider-availability-reconciliation.test.ts`.

## Sleeper, ESPN — real, working, unaffected

Both wired end-to-end, both in real (if pre-launch) use. No change.

## Yahoo — real, working, kept `available: true`

Real OAuth token exchange/refresh, real HTTP calls to `fantasysports.yahooapis.com`, real
parsing/normalization. The connect step lives on `/leagues` ("Connect Yahoo Account"), not on
`/import` or `/settings` directly — those two pages currently just link to each other rather than
to the actual connect button — but a determined user can reach it, and a real, selectable Yahoo
tab already exists in `ImportProviderSelector.tsx`. Two disclosed gaps, neither a launch blocker:
no test exercises the raw Yahoo JSON-parsing layer, and no real user has ever completed either
OAuth flow in production. Left `available: true` because the path genuinely works today; the
`/leagues` ↔ `/settings` circular-link UX is a separate, smaller follow-up if it's worth doing.

## MFL — real backend, flipped to `available: false`

`FantraxLeagueFetchService`-equivalent MFL adapter code is real and substantial. But no UI
anywhere lets a user enter an MFL League ID + API key (the credential a private league requires) —
there is no MFL equivalent of `EspnCookieConnection.tsx`. A user selecting MFL in the real
selector today has no way to ever authenticate a private league. The project's own certification
docs disclose zero real-world validation has ever occurred. Flipped `available: false` until a
credential-entry UI exists; building that UI is separate, scoped follow-up work, not part of this
reconciliation pass.

## Fleaflicker — real backend, flipped to `available: false`

`fleaflicker` is an `OPEN_READ_PROVIDER` (`lib/league-import/commissionerGate.ts`) — no OAuth
token is required at all, only a commissioner attestation in place of unverifiable membership
proof. The adapter and mappers are real. But the only clearly-confirmed reachable entry point is
one orphaned page, `app/import/c2c/C2CImportClient.tsx`, with no inbound links from any nav or
other flow. Whether `ImportProviderSelector.tsx`'s generic provider-select-then-enter-ID path
(which lists Fleaflicker as clickable, since it needs no credential) already works end-to-end for
it was **not fully re-confirmed** before this pass closed — a second, apparently newer
`components/league-creation-wizard/LeagueSourceSection.tsx` surface also touches this config and
wasn't traced to a live page either. Flipped `available: false` as the conservative default until
that's resolved, consistent with MFL.

## Fantrax — real plumbing, flipped to `available: false`, additional fix pending

Real CSV-snapshot pipeline (`FantraxLeagueFetchService.ts`, `FantraxAdapter.ts` + 5 mappers) —
substantial, not a stub. But it is currently broken end-to-end, independent of this reconciliation:

- `prisma/schema.prisma`'s `FantraxLeague.appUserId` was added specifically as "the actual
  security boundary" for ownership (see the field's doc comment), with reads meant to fail closed
  when null.
- `FantraxLeagueFetchService.ts`'s import gate does exactly that: rejects any row where
  `appUserId !== userId`.
- But the only code path that creates/updates `FantraxLeague` rows —
  `server/api-route-modules/legacy/fantrax/route.ts` — never sets `appUserId`, and has no
  authentication of any kind on either its POST (upload) or GET (read) handler. Confirmed directly
  (not just via audit): read all 208 lines, and its only wrapper (`withApiUsage`,
  `lib/telemetry/usage.ts`) is pure request timing/logging, no auth.
- Net effect: every fresh Fantrax upload gets `appUserId: null` forever, so the import
  pipeline's own gate rejects it as "not found" — including to the user who just uploaded it.
  `docs/redraft/FANTRAX_IMPORT_PRODUCT_DECISION.md` claims this was fixed; only the read-gate half
  landed, not the write side.

Flipping `available: false` fully contains the misleading-selector problem and stops new
`appUserId: null` rows from being created via the redraft-import path. It does **not** by itself
close the unauthenticated-endpoint exposure, because `server/api-route-modules/legacy/fantrax/route.ts`
is *also* the sole backend for a second, unrelated, currently-live feature — the AF Legacy
trophy-case tool (`app/af-legacy/page.tsx`), which appears to be an intentionally public,
no-login, username-keyed lookup tool (no session/auth guard found anywhere on that page). The
write side of that shared route — anyone can upload CSV data attributed to any username, with no
proof of ownership — is a real data-integrity gap independent of the redraft-import reconciliation
this doc covers, and disabling the route outright to close it would break that live, unrelated
feature. Left as an open, explicitly flagged follow-up rather than acted on unilaterally.

## What changed here

- `lib/league-import/provider-ui-config.ts`: `fantrax`, `mfl`, `fleaflicker` → `available: false`;
  corrected the file's doc comment (previously claimed sync with `hasFullAdapter()`, which cannot
  express this).
- `__tests__/league-import/provider-availability-reconciliation.test.ts`: new — asserts the exact
  availability list above, so a future silent flip requires touching this test consciously.
