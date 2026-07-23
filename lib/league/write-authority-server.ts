/**
 * Server-side Write Authority resolution — the DB half of `./write-authority`.
 *
 * Split from that module so the pure predicate + copy builders stay client-safe (no
 * `@/lib/prisma` import), matching the constraint documented in
 * `lib/dashboard/platform-label.ts`.
 */

import { prisma } from '@/lib/prisma'
import {
  buildWriteAuthorityEnvelope,
  type WriteAuthorityAction,
  type WriteAuthorityEnvelope,
} from './write-authority'

/**
 * `League.platform` for a league id, or null when the league does not exist.
 *
 * Kept as a narrow single-column read so mutation routes can add it without inflating an
 * existing `select` (several of them deliberately select the minimum).
 */
export async function getLeaguePlatform(leagueId: string): Promise<string | null> {
  const row = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true },
  })
  return row?.platform ?? null
}

/**
 * Write Authority envelope for a league, for a given mutation.
 *
 * Never throws: an unreadable league falls back to a null platform, which resolves to NATIVE.
 * That fallback is safe here because every caller has already authorized and performed (or is
 * about to perform) the write — this call only decides how to *describe* it, and a route that
 * cannot read its own league row has a bigger problem than copy. The disclosure obligation is
 * still met for the real case: an imported league always has a platform string.
 */
export async function resolveWriteAuthorityEnvelope(
  leagueId: string,
  action: WriteAuthorityAction,
): Promise<WriteAuthorityEnvelope> {
  const platform = await getLeaguePlatform(leagueId).catch(() => null)
  return buildWriteAuthorityEnvelope(action, platform)
}
