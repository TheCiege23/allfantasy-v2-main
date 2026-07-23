/**
 * MyFantasyLeague connection endpoint — DISABLED by Import Certification Phase A.
 *
 * Why this route is gated rather than "fixed in place":
 *
 * 1. It was completely unauthenticated. There was no session check of any kind, so any
 *    anonymous caller could POST a username/password, cause this server to authenticate
 *    against MFL, and write a row to `MFLConnection`.
 * 2. It wrote the wrong credential to the wrong table. It stored MFL's `MFL_USER_ID`
 *    login token as `MFLConnection.mflCookie`, in plaintext. The league importer does
 *    not read that table at all — it reads an ENCRYPTED `LeagueAuth.apiKey` row via
 *    `getDecryptedAuth(userId, 'mfl')` (`lib/league-sync-core.ts`). So even a fully
 *    successful login here could never enable an MFL import.
 * 3. `MFLConnection` has no user linkage. It is keyed on `mflUsername` alone
 *    (`prisma/schema.prisma` → `model MFLConnection`), with no `userId`/`appUserId`
 *    column, so a write cannot be safely scoped to the authenticated account. Adding
 *    that linkage is a schema change, deliberately out of scope for this PR.
 *
 * The secure path already exists: `POST /api/league/auth` accepts
 * `{ platform: 'mfl', apiKey }`, requires a session, encrypts the value, and writes the
 * exact `LeagueAuth` row the importer reads. What is missing is a UI that calls it with
 * an MFL API key. Until that exists, MFL stays `available: false` in
 * `lib/league-import/provider-ui-config.ts` and this endpoint accepts nothing.
 *
 * DATA PRESERVATION: no `MFLConnection` rows are read, written, or deleted here, and the
 * model is untouched. Existing rows remain exactly as they were for a future migration.
 */

import { withApiUsage } from '@/lib/telemetry/usage'
import { NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'

/**
 * Stable machine-readable code so the client can distinguish "temporarily unavailable"
 * from "your credentials were wrong" — the latter must never be implied again, because
 * no credential is evaluated at all.
 */
export const MFL_CONNECTION_DISABLED_CODE = 'mfl_connection_unavailable'

export const MFL_CONNECTION_DISABLED_MESSAGE =
  'Connecting an MFL account is temporarily unavailable. MFL imports require an API key, ' +
  'and signing in with an MFL username and password is not supported.'

export const POST = withApiUsage({ endpoint: '/api/auth/mfl', tool: 'AuthMfl' })(async () => {
  // Authenticate FIRST and return before touching the request body, so an anonymous
  // caller can neither reach the disabled-path response nor have any credential they
  // sent read, forwarded, logged, or stored.
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  return NextResponse.json(
    {
      error: MFL_CONNECTION_DISABLED_MESSAGE,
      code: MFL_CONNECTION_DISABLED_CODE,
      connected: false,
    },
    { status: 503 },
  )
})
