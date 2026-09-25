# Live Certification Follow-Up

## Confirmed

- Prior release #841 deployed successfully on Railway as ef52150def64c54e25852f00b218a06f86b8ea6d.
- Signed-in production sidebar showed both teams' scores for World Football League.
- Its update timestamp advanced from 11:12 PM to 11:13 PM without a page reload.
- At 2026-09-14 03:13 UTC, Sleeper's Guillotine League 26 ($30) returned 94.84 points,
  rank 13 of 18, and 37.72 above the lowest score. Production displayed the same
  values rounded to one decimal: 94.8, 13th of 18, +37.7.
- Discord's normal consent screen loads with the expected application, production
  callback, and identify/email scopes. This is not token-exchange certification.

## Changes In Release #844

- Callback failures distinguish cancellation, expired state, invalid credentials,
  expired authorization, provider failure, encryption failure, and profile-save failure.
- Provider requests have deadlines; network and encryption errors are caught.
- Diagnostics log only stage, reason, and HTTP status, not raw provider/Prisma errors.
- Nineteen focused OAuth tests pass across two suites. The existing invalid-user
  binding contract now expects session-expired and still verifies no provider call.
- Corrected production Huddle's misleading public-feed disclosure. Group conversations
  remain membership-gated; this change does not widen access.
- PR: https://github.com/TheCiege23/allfantasy-v2-main/pull/844. All required checks passed.
  Merged as 6ab5bd901bf12268ba63ac94ef5252096d7cf0e4 and deployed to Railway as
  44747f8d-6095-4ca4-a5bb-2c7310c49e2f with SUCCESS and a passing health check.
  Public health returned 200, anonymous score access 401, and anonymous Discord
  callback redirected to login. Production Huddle tooltip and panel now explicitly
  say only Huddle members can read the messages, verified in the signed-in browser.

## Still Open

- After explicit user approval, the production Discord client-credential check
  returned HTTP 401 / invalid_client from Discord's official token endpoint.
  The configured client ID is numeric and the secret is present without surrounding
  whitespace, but Discord rejected the pair. No token was issued or needed revocation.
  The matching application secret must be corrected securely in Railway; fresh user
  OAuth authorization and callback verification remain required afterward.
- After explicit cost approval, created private Railway bucket af-chat-private in
  production, region iad, ID 9cf46de7-02de-40ad-9f22-020aa557fcdb. A separate bucket-info
  read confirmed zero objects and zero bytes. App upload integration and access-control
  certification remain open; provisioned storage is not yet a working upload flow.
- Mobile tab interaction worked, but a screenshot timed out. The viewport override
  was reset. Full mobile visual certification remains open.
- Broader local communications redesign, media/storage integration, private Discord
  channel creation integration, and Chimmy changes are not all included in #844.
  The shared working tree contains extensive unrelated work; it was not deployed wholesale.
