---
description: "Use when implementing, reviewing, or fixing OAuth or credential-based auth flows for fantasy platform providers: Discord, Yahoo, ESPN, Fantrax, MFL, Fleaflicker, and Sleeper. Enforces DB-first token storage and NextAuth custom provider patterns."
name: "Fantasy Provider OAuth"
applyTo: "app/api/auth/discord/**, app/api/auth/yahoo/**, app/api/auth/espn/**, app/api/auth/fantrax/**, app/api/auth/mfl/**, app/api/auth/fleaflicker/**, app/api/auth/sleeper*/**, lib/auth/providers/**"
---

# Fantasy Provider OAuth Patterns

## Provider classification

Fantasy platform providers are **identity + import providers**, not general social logins. They serve two purposes:
1. Authenticate the user (verify they own that account)
2. Grant access to import league/roster data from that platform

Treat them as **custom credentials providers** in NextAuth, not as standard OAuth social buttons.

## DB-first token rule

**Never call a fantasy platform API directly from a user-facing route on every request.**

The correct flow:
1. Exchange authorization code or credentials for a token during the auth callback — **once**.
2. Persist the token (and `token_expires_at`) to the `accounts` table or a dedicated `linked_platforms` table in Prisma.
3. On subsequent requests, read the stored token from DB.
4. Refresh the token in a background sync/ingestion job when it nears expiry — not inline in a user request.

Annotate any unavoidable exception with `// db-first-exception: <reason>` on the exact line.

## Required fields when storing a provider token

```ts
{
  userId: string;           // foreign key to users table
  provider: string;         // 'discord' | 'yahoo' | 'espn' | 'fantrax' | 'mfl' | 'fleaflicker' | 'sleeper'
  providerAccountId: string; // platform's user ID
  accessToken: string;      // encrypted at rest
  refreshToken?: string;    // encrypted at rest
  tokenExpiresAt?: Date;
  scope?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Tokens must be **encrypted at rest** — never store raw OAuth tokens in plaintext columns.

## NextAuth custom provider shape

```ts
{
  id: 'espn',               // lowercase, kebab-case
  name: 'ESPN',
  type: 'credentials',      // or 'oauth' if standard OAuth2 flow
  credentials: { ... },
  authorize: async (credentials) => {
    // 1. Validate credentials with platform API (one-time exchange only)
    // 2. Upsert user in DB via Prisma
    // 3. Store/update token in DB
    // 4. Return NextAuth user object: { id, email, name, image }
    // DO NOT return raw tokens in the NextAuth user object
  }
}
```

Wire the provider into `lib/auth.ts` `providers` array. Do not create standalone session handling outside NextAuth.

## Account linking

When an authenticated user connects a fantasy platform account:
- Use `SocialAccountLinkingService` — do not duplicate linking logic inline.
- The linking operation must be idempotent: re-linking the same platform account updates the token, does not create a duplicate record.
- If the platform account is already linked to a **different** AllFantasy user, return a `409 Conflict` — do not silently reassign.

## Provider-specific notes

| Provider | Flow type | Notes |
|---|---|---|
| Sleeper | Credentials (username lookup) | Server-side `lookupSleeperUser` in `lib/sleeper/user-lookup.ts`. Do NOT add a public lookup route for it: the old `app/api/auth/sleeper-lookup` was an unthrottled Sleeper proxy and was removed 2026-09-27. Any public Sleeper read needs rate limits and must go through `lib/api-cache/SleeperCacheLayer.ts` (see `/api/sleeper-check`, PR #1426). |
| Discord | Standard OAuth2 | Route skeleton exists at `app/api/auth/discord/`; wire to `UnifiedAuthService` |
| Yahoo | OAuth1/OAuth2 hybrid | Route skeleton at `app/api/auth/yahoo/`; verify active before expanding |
| ESPN | Credential/cookie-based | No standard OAuth; may require session cookie exchange; treat carefully |
| Fantrax | OAuth2 | Implement following Discord pattern once credentials are available |
| MFL | Token-based | API key per user; store as `accessToken` in same schema |
| Fleaflicker | OAuth2 | Implement following Discord pattern once credentials are available |

## Callback route pattern

All provider callbacks must:
1. Validate the `state` parameter (CSRF) before exchanging the code.
2. Exchange code for token server-side only — never in client-side code.
3. Upsert user and token in a single Prisma transaction.
4. Redirect to `/auth/provider-pending` if profile completion is required, otherwise to `/dashboard`.
5. Return a structured error and redirect to `/auth/error?error=<code>` on failure — do not expose stack traces.

## What not to do

- DO NOT call platform APIs from `getServerSideProps`, `getStaticProps`, or client components directly.
- DO NOT store `accessToken` or `refreshToken` in the NextAuth session object returned to the client.
- DO NOT skip state/CSRF validation in callbacks.
- DO NOT create a new provider pattern diverging from `UnifiedAuthService` without updating the service to handle the new provider type.
