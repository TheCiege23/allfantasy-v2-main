# Your Week: connected X publishing

The first connected integration publishes reviewed text to the user's verified X account. The PNG card remains a download/native sharing flow.

## Server setup

Configure the existing X app as a Web App / confidential OAuth 2.0 client with read and write permission.

Register this exact callback URL in X's Developer Console:

`https://www.allfantasy.ai/api/core/week/x/callback`

On the AllFantasy production web service, set:

- `X_OAUTH_CLIENT_ID` — the OAuth 2.0 client ID.
- `X_OAUTH_CLIENT_SECRET` — the confidential client secret.
- `X_OAUTH_REDIRECT_URI` — the exact callback URL above.

The existing `LEAGUE_AUTH_ENCRYPTION_KEY` must remain available. Do not rotate it as part of this setup: existing league credentials use it too. Do not use the server-wide `X_PUBLISH_ACCESS_TOKEN` for user posts.

No schema migration is needed. Connection credentials are encrypted in `AuthAccount` under provider `x-weekly-publish`; they are separate from sign-in providers. OAuth verifier state is encrypted, session-bound and consumed once.

The requested scopes are `tweet.read tweet.write users.read`. This release does not request offline access. X's access tokens expire (normally after two hours); the user reconnects when prompted. Local disconnect prevents further AllFantasy publishing; the user can also revoke the app in X's connected apps settings.

## User workflow

Open Share and export my week → X → Connect X. Finish X authorization personally. Return to Your Week, edit the caption, check the review checkbox, and press Publish now on X.

Nothing publishes on account connection or on opening the page. A successful post shows a link to the exact X post. Request IDs prevent automatic duplicate retries; an uncertain response requires checking X before another attempt. The browser remembers uncertain attempts within the session, including after closing/reopening the sharing section.

## Validation still requiring external setup

Complete an actual user connection after server credentials are configured. Publish a specific reviewed test caption only with the user's authorization for that actual public post. Unit tests use mocked X responses; they do not establish that the app has live API write entitlement.

Official reference: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
