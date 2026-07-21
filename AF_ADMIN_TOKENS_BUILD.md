# AF_ADMIN_TOKENS_BUILD — Per-admin API tokens (fix the audit blind spot)

_Decision: per-admin tokens (Jul 19, 2026). Closes the gap where bearer admin calls log `shared-secret` instead of who acted — the hole in the audit logging the admin-audit branch just built._

## Goal
Replace the shared `ADMIN_PASSWORD` bearer path with per-admin API tokens that carry identity, so `requireAdminOrBearer` calls record WHO acted, and support rotation + per-person revocation. **Do NOT widen access** — a token inherits only its owner's existing admin authority.

## Current state (verified reading adminAuth.ts)
- `requireAdminOrBearer` accepts a shared `ADMIN_PASSWORD` and returns no identity → admin audit rows record a `shared-secret` sentinel.
- `requireAdmin` = `ADMIN_EMAILS` allowlist + `isSiteAdmin` (BROAD — memory flags it also grants paywall bypass; do not over-grant).

## The change — two-phase, so nothing breaks mid-migration

### Phase 1 — add tokens alongside the shared secret
1. **`AdminApiToken` model**: `id`, `label`, `tokenHash` (store a HASH only — sha256/bcrypt, never the raw token), `ownerAdminId` (or ownerEmail — must be an existing admin), `createdAt`, `lastUsedAt`, `revokedAt`, optional `scopes`. Prisma migration.
2. **Issue flow**: an admin-panel action (or CLI) creates a token → shows the raw value ONCE → stores only the hash. Owner must already be an admin; the token never exceeds the owner's authority.
3. **`requireAdminOrBearer`**: on a bearer call, hash the presented token, look up a non-revoked `AdminApiToken`, resolve to the owner identity, bump `lastUsedAt`, and RETURN that identity so audit rows record who. Keep `ADMIN_PASSWORD` as a deprecated fallback behind a flag.

### Phase 2 — retire the shared secret
4. Migrate any real automated callers to per-admin tokens.
5. Remove the `ADMIN_PASSWORD` fallback + the `shared-secret` sentinel path.

## Migration path (prod-safe — Neon `ep-curly-block/neondb`)
Prod schema changes go through **Prisma Migrate**, NEVER `db push` (which can drop data). The repo already has ~130 ordered migrations in `prisma/migrations/` applied via `migrate deploy`. Recipe:
1. Add the `AdminApiToken` model to `prisma/schema.prisma`.
2. `prisma migrate dev --name add_admin_api_tokens` locally → generates an ADDITIVE migration (CREATE TABLE + indexes only).
3. Review the generated SQL: confirm zero `DROP` / destructive `ALTER`. Optionally mirror as an idempotent `supabase_ensure_admin_api_tokens.sql` per repo convention.
4. Claude Code generates + reviews the migration file; **applying to prod is a deploy step the user runs** (`prisma migrate deploy` via the established pipeline — confirm the exact command first). Never `db push`.

## Admin UI (checklist item 1)
Admin-panel section: list tokens (label, owner, last used, created, revoked), "Create token" (one-time reveal + copy), "Revoke" (with confirm). Never re-display a raw token.

## Guardrails
- A token must never grant more than its owner. Re-check the owner is still an admin at call time (losing admin revokes effectively).
- Store only hashes; treat raw tokens like passwords — never log them.
- The issue/revoke endpoints are gated by `requireAdmin` (NOT bearer), so a token can't mint tokens. Each issue/revoke is itself audit-logged.

## Build checklist (all 7)
1. **Visuals** — token-management UI in the admin panel.
2. **Backend** — model + migration + verify path + issue/revoke endpoints.
3. **UI/UX** — one-time reveal + copy; revoke confirmation; last-used timestamps.
4. **Delete old code** — shared `ADMIN_PASSWORD` fallback + `shared-secret` sentinel (phase 2).
5. **Fixes/gaps** — audit rows now record identity on bearer calls; blind spot closed.
6. **SEO/ASO** — n/a (internal admin).
7. **Brand** — internal tooling; no customer-facing copy.

## Verification
- Unit: valid token → resolves owner identity; revoked → 401; unknown → 401; owner-not-admin → 401; audit row records owner id, not `shared-secret`.
- Phase 1: shared-secret fallback still works with the flag on; Phase 2: it's gone.
- Add tests to the CI vitest job (once it exists) as a required check.

## Claude Code prompt
`implement Phase 1 of AF_ADMIN_TOKENS_BUILD.md` (schema + issue/verify + UI; keep the ADMIN_PASSWORD fallback). Do Phase 2 only after confirming which automated callers need migrating first.
