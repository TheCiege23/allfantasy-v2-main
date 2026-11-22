/**
 * Avatar rehosting: imported LeagueTeam.avatarUrl values point at
 * source-provider CDNs (Sleeper, ESPN, Yahoo, Fantrax) that can 404 when
 * those leagues are deleted upstream. After a successful import, mirror
 * those avatars to our own storage and swap the URL on LeagueTeam.
 *
 * Pluggable upload: `uploadImpl` defaults to a no-op until a storage
 * adapter is wired. Callers can inject a concrete uploader in tests.
 */

import { lookup } from 'node:dns/promises'
import { prisma } from '@/lib/prisma'
import { assertSafeWebhookUrl, type DnsResolver } from '@/lib/domain/webhooks'

/*
 * 🛑 AN IMPORTED avatarUrl IS WRITTEN BY WHOEVER RUNS THE SOURCE LEAGUE, NOT BY US.
 * Fetching it server-side unguarded let a league owner point us at cloud metadata or an
 * internal Railway host. Every fetch now goes through the same guard outbound webhooks
 * use (https only, no credentials, every resolved address public) and never follows a
 * redirect — a redirect is how a public URL hands the request on to a private one.
 */
const resolveAll: DnsResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address)

export type AvatarUploader = (args: {
  leagueId: string
  teamId: string
  bytes: Uint8Array
  contentType: string
  sourceUrl: string
}) => Promise<string | null>

/** Default uploader — no-op; replace when Supabase/S3 storage is wired. */
const noopUpload: AvatarUploader = async () => null

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

async function fetchAvatar(
  url: string,
  resolve: DnsResolver = resolveAll,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const safe = await assertSafeWebhookUrl(url, resolve)
    if (!safe.ok) return null
    const res = await fetch(url, { redirect: 'manual' })
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) return null
    return { bytes: new Uint8Array(buf), contentType }
  } catch {
    return null
  }
}

export interface MirrorAvatarsResult {
  mirrored: number
  skipped: number
  failed: number
}

/**
 * Iterate every LeagueTeam in `leagueId` with an external avatarUrl and
 * try to mirror it. Failures are swallowed — mirroring is best-effort.
 */
export async function mirrorImportAvatars(
  leagueId: string,
  uploadImpl: AvatarUploader = noopUpload,
  resolve: DnsResolver = resolveAll,
): Promise<MirrorAvatarsResult> {
  // Nothing would be stored, so fetching is pure outbound traffic to URLs a stranger chose.
  if (uploadImpl === noopUpload) return { mirrored: 0, skipped: 0, failed: 0 }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId, avatarUrl: { not: null } },
    select: { id: true, avatarUrl: true },
  })
  let mirrored = 0
  let skipped = 0
  let failed = 0

  for (const team of teams) {
    const src = team.avatarUrl ?? ''
    if (!src || src.startsWith('/') || src.includes('allfantasy')) {
      skipped++
      continue
    }
    const fetched = await fetchAvatar(src, resolve)
    if (!fetched) {
      failed++
      continue
    }
    const hostedUrl = await uploadImpl({
      leagueId,
      teamId: team.id,
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      sourceUrl: src,
    })
    if (!hostedUrl) {
      skipped++
      continue
    }
    await prisma.leagueTeam
      .update({ where: { id: team.id }, data: { avatarUrl: hostedUrl } })
      .then(() => {
        mirrored++
      })
      .catch(() => {
        failed++
      })
  }
  return { mirrored, skipped, failed }
}
