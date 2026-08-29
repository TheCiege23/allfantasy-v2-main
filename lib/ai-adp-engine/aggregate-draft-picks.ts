/**
 * Universal draft pick aggregation from DraftPick (live) and MockDraft.results.
 * Produces raw (overall, playerName, position, team) per segment for ADP calculation.
 */

import { prisma } from '@/lib/prisma'
import { resolveAiAdpSegmentContext } from './segment-resolver'

export type SegmentKey = { sport: string; leagueType: string; formatKey: string }

export interface RawPick {
  overall: number
  playerName: string
  position: string
  team: string | null
}

export interface SegmentPicks {
  segment: SegmentKey
  picks: RawPick[]
  draftCount: number
  source?: {
    liveDraftCount: number
    mockDraftCount: number
    liveDraftPicks: number
    mockDraftPicks: number
  }
}

/** Fetch all completed live draft picks (DraftPick) with league context and group by segment. */
export async function aggregateLiveDraftPicks(
  since?: Date
): Promise<SegmentPicks[]> {
  const whereSession: any = { status: 'completed' }
  if (since) whereSession.updatedAt = { gte: since }

  /*
   * 🛑 `source: 'auto'` PICKS ARE NOT A MARKET. 18 completed sessions in production are
   * exactly 50 picks each, 100% autopicked, all created 2026-05-07 — seeded fixtures, not
   * managers drafting. Averaging them into an ADP publishes a bot's board as though people
   * had chosen it, and the segment counts it inflates are what make a thin board look
   * sampled. Real human drafts carry `sleeper-mirror` and other sources.
   *
   * Excluded at the QUERY, not in the reducer, so the pick never reaches the sample count
   * either — a filter applied after aggregation still lets `draftCount` claim the draft.
   */
  const picks = await prisma.draftPick.findMany({
    where: { session: whereSession, source: { not: 'auto' } },
    include: {
      session: {
        include: {
          league: {
            select: { sport: true, isDynasty: true, settings: true },
          },
        },
      },
    },
    orderBy: [{ sessionId: 'asc' }, { overall: 'asc' }],
  })

  const bySegment = new Map<string, { segment: SegmentKey; picks: RawPick[]; draftIds: Set<string> }>()

  for (const p of picks) {
    const league = (p.session as any).league
    if (!league) continue
    const settings = (league.settings as Record<string, unknown>) ?? {}
    const segment = resolveAiAdpSegmentContext({
      sport: league.sport,
      isDynasty: league.isDynasty,
      settings,
    })
    const sport = segment.sport
    const leagueType = segment.leagueType
    const formatKey = segment.formatKey
    const key = `${sport}|${leagueType}|${formatKey}`
    if (!bySegment.has(key)) {
      bySegment.set(key, {
        segment: { sport, leagueType, formatKey },
        picks: [],
        draftIds: new Set(),
      })
    }
    const seg = bySegment.get(key)!
    seg.draftIds.add(p.sessionId)
    seg.picks.push({
      overall: p.overall,
      playerName: p.playerName,
      position: p.position,
      team: p.team ?? null,
    })
  }

  return Array.from(bySegment.values()).map(({ segment, picks: p, draftIds }) => ({
    segment,
    picks: p,
    draftCount: draftIds.size,
    source: {
      liveDraftCount: draftIds.size,
      mockDraftCount: 0,
      liveDraftPicks: p.length,
      mockDraftPicks: 0,
    },
  }))
}

/** Fetch all completed mock draft results and group by segment. */
export async function aggregateMockDraftResults(
  since?: Date
): Promise<SegmentPicks[]> {
  const where: any = { status: 'completed' }
  if (since) where.updatedAt = { gte: since }

  const mocks = await prisma.mockDraft.findMany({
    where,
    select: { id: true, results: true, metadata: true },
  })

  const bySegment = new Map<string, { segment: SegmentKey; picks: RawPick[]; draftIds: Set<string> }>()

  for (const m of mocks) {
    const results = Array.isArray(m.results) ? (m.results as any[]) : []
    const meta = (m.metadata as Record<string, unknown>) ?? {}
    const segment = resolveAiAdpSegmentContext({
      sport: String(meta.sport ?? 'NFL'),
      leagueType: String(meta.leagueType ?? ''),
      settings: meta,
    })
    const sport = segment.sport
    const leagueType = segment.leagueType
    const formatKey = segment.formatKey
    const key = `${sport}|${leagueType}|${formatKey}`

    if (!bySegment.has(key)) {
      bySegment.set(key, {
        segment: { sport, leagueType, formatKey },
        picks: [],
        draftIds: new Set(),
      })
    }
    const seg = bySegment.get(key)!
    seg.draftIds.add(m.id)
    for (const r of results) {
      const overall = r.overall ?? r.pickNumber ?? 0
      const playerName = r.playerName ?? r.name ?? ''
      const position = r.position ?? ''
      const team = r.team ?? null
      if (playerName && overall > 0) {
        seg.picks.push({ overall, playerName, position, team })
      }
    }
  }

  return Array.from(bySegment.values()).map(({ segment, picks: p, draftIds }) => ({
    segment,
    picks: p,
    draftCount: draftIds.size,
    source: {
      liveDraftCount: 0,
      mockDraftCount: draftIds.size,
      liveDraftPicks: 0,
      mockDraftPicks: p.length,
    },
  }))
}

/** Merge segment picks from live and mock; one SegmentPicks per segment with combined picks. */
export function mergeSegmentPicks(
  live: SegmentPicks[],
  mock: SegmentPicks[]
): SegmentPicks[] {
  const map = new Map<string, SegmentPicks>()
  for (const s of live) {
    const key = `${s.segment.sport}|${s.segment.leagueType}|${s.segment.formatKey}`
    map.set(key, { ...s })
  }
  for (const s of mock) {
    const key = `${s.segment.sport}|${s.segment.leagueType}|${s.segment.formatKey}`
    const existing = map.get(key)
    if (existing) {
      existing.picks = existing.picks.concat(s.picks)
      existing.draftCount += s.draftCount
      existing.source = {
        liveDraftCount:
          (existing.source?.liveDraftCount ?? 0) + (s.source?.liveDraftCount ?? 0),
        mockDraftCount:
          (existing.source?.mockDraftCount ?? 0) + (s.source?.mockDraftCount ?? 0),
        liveDraftPicks:
          (existing.source?.liveDraftPicks ?? 0) + (s.source?.liveDraftPicks ?? 0),
        mockDraftPicks:
          (existing.source?.mockDraftPicks ?? 0) + (s.source?.mockDraftPicks ?? 0),
      }
    } else {
      map.set(key, { ...s })
    }
  }
  return Array.from(map.values())
}
