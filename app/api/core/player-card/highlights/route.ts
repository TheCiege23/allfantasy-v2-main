import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { getPlayerHighlights } from '@/lib/highlights/youtube'
import { selectAuthoritativePlayerRow, selectRowForExternalRef } from '@/lib/player-match/authoritativePlayerRow'

export const dynamic = 'force-dynamic'

const query = z.object({
  sport: z.string().min(2).max(16).transform((sport) => sport.toUpperCase()),
  externalId: z.string().trim().min(1).max(64).optional(),
  sleeperId: z.string().trim().min(1).max(64).optional(),
  source: z.string().trim().regex(/^[a-z0-9_-]+$/i).max(64).optional(),
}).refine((value) => value.externalId || value.sleeperId)

/**
 * A Sleeper id names whoever its `source = 'sleeper'` row names. The newest row used to
 * win, and TheSportsDB's rows (which carry Sleeper ids matched by name) are usually
 * newest — so the Vikings CB Byron Murphy was searched as the Seahawks DT, and TE E.J.
 * Jenkins as "Elgton Jenkins". See lib/player-match/authoritativePlayerRow.ts.
 */
async function resolveBySleeperId(sport: string, sleeperId: string) {
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport: { equals: sport, mode: 'insensitive' }, sleeperId: { equals: sleeperId, mode: 'insensitive' } },
    orderBy: [{ fetchedAt: 'desc' }],
    select: { name: true, sport: true, team: true, position: true, source: true, sleeperId: true, fetchedAt: true },
  })
  const picked = selectAuthoritativePlayerRow(rows)?.row
  return picked ? { name: picked.name, sport: picked.sport, team: picked.team } : null
}

/**
 * An externalId names a player only together with the feed that minted it. Measured on
 * production 2026-10-12: NFL `2135` is a backfill "Josh Allen QB BUF" row AND rolling_insights'
 * Josh Hines-Allen, and "newest row wins" searched YouTube for Hines-Allen from Josh Allen's
 * card. With `source` the lookup is that row; without it, an id whose rows describe different
 * men is refused (404) rather than guessed (see selectRowForExternalRef).
 */
async function resolveByExternalId(sport: string, externalId: string, source: string | undefined) {
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport: { equals: sport, mode: 'insensitive' }, externalId },
    orderBy: [{ fetchedAt: 'desc' }],
    take: 20,
    select: { name: true, sport: true, team: true, position: true, source: true, sleeperId: true, fetchedAt: true },
  })
  const picked = selectRowForExternalRef(rows ?? [], source)
  return picked ? { name: picked.name, sport: picked.sport, team: picked.team } : null
}

export async function GET(req: Request) {
  const rl = consumeRateLimit({
    scope: 'players', action: 'highlights', ip: getClientIp(req), includeIpInKey: true,
    maxRequests: 30, windowMs: 60_000,
  })
  if (!rl.success) return NextResponse.json(buildRateLimit429({ message: 'Please slow down and try again.', rl }), {
    status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) },
  })
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'A sport and player ID are required.' }, { status: 400 })
  const { sport, externalId, sleeperId, source } = parsed.data
  if (sport !== 'NFL') return NextResponse.json(await getPlayerHighlights({ sport, name: '', team: null }))
  try {
    // Public catalog only. Names come from canonical player identity, never a caller's search string.
    const player = externalId
      ? await resolveByExternalId(sport, externalId, source)
      : await resolveBySleeperId(sport, sleeperId!)
    if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 })
    return NextResponse.json(await getPlayerHighlights(player), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Highlights are temporarily unavailable.' }, { status: 503 })
  }
}
