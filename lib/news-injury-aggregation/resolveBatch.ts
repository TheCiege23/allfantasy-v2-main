import 'server-only'

import type { AppPrismaClient } from '@/lib/sports-data-normalization/appPrismaClient'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { fetchNewsContext } from '@/lib/upstream-apis'
import { mergeInjuryNewsLayer } from '@/lib/news-injury-aggregation/mergeLayer'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type {
  InjuryNewsBatchPlayerInput,
  InjuryNewsSourceRow,
  NormalizedPlayerInjuryNewsLayer,
} from '@/lib/news-injury-aggregation/types'

function subDays(d: number): Date {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000)
}

/**
 * Single shared injury + news resolution for AI tools. Uses DB-backed injury/news rows
 * and optional News API / ESPN fallbacks via `fetchNewsContext` (cached upstream).
 * Does not call live Grok on every request — persisted `PlayerStatusEvent` rows include
 * aggregated signals when AutoCoach / importers have run.
 */
export async function resolvePlayerInjuryNewsBatch(args: {
  prisma: AppPrismaClient
  sport: SupportedSport | string
  players: InjuryNewsBatchPlayerInput[]
  /** When true, skips live News API / ESPN fetch (DB + cache only). Default false. */
  skipNewsContext?: boolean
}): Promise<Map<string, NormalizedPlayerInjuryNewsLayer | null>> {
  const sport = normalizeToSupportedSport(String(args.sport))
  const unique = new Map<string, InjuryNewsBatchPlayerInput>()
  for (const p of args.players) {
    const n = p.playerName.trim()
    if (!n) continue
    const k = n.toLowerCase()
    if (!unique.has(k)) unique.set(k, { playerName: n, playerId: p.playerId, teamAbbrev: p.teamAbbrev })
  }

  const list = [...unique.values()]
  const out = new Map<string, NormalizedPlayerInjuryNewsLayer | null>()
  if (list.length === 0) return out

  const names = [...new Set(list.map((p) => p.playerName))]
  const nameOr = names.map((n) => ({ playerName: { equals: n, mode: 'insensitive' as const } }))
  const ids = [...new Set(list.map((p) => p.playerId).filter((x): x is string => Boolean(x)))]

  const sinceInj = subDays(21)
  const sinceSi = subDays(14)
  const sinceNews = subDays(7)
  const sinceEv = subDays(10)

  const [injuryReports, sportsInjuries, playerNews, statusEvents] = await Promise.all([
    args.prisma.injuryReportRecord.findMany({
      where: {
        sport,
        reportDate: { gte: sinceInj },
        OR: [
          ...(ids.length ? [{ playerId: { in: ids } }] : []),
          ...(nameOr.length ? [{ OR: nameOr }] : []),
        ],
      },
      orderBy: { reportDate: 'desc' },
      take: 600,
    }),
    args.prisma.sportsInjury.findMany({
      where: {
        sport,
        updatedAt: { gte: sinceSi },
        OR: [
          ...(ids.length ? [{ playerId: { in: ids } }] : []),
          ...(nameOr.length ? [{ OR: nameOr }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 600,
    }),
    args.prisma.playerNewsRecord.findMany({
      where: {
        sport,
        publishedAt: { gte: sinceNews },
        OR: [
          ...(ids.length ? [{ playerId: { in: ids } }] : []),
          ...(nameOr.length ? [{ OR: nameOr }] : []),
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 400,
    }),
    ids.length
      ? args.prisma.playerStatusEvent.findMany({
          where: {
            sport,
            externalId: { in: ids },
            detectedAt: { gte: sinceEv },
          },
          orderBy: { detectedAt: 'desc' },
          take: 400,
        })
      : Promise.resolve([]),
  ])

  let newsItems: Awaited<ReturnType<typeof fetchNewsContext>>['items'] = []
  if (!args.skipNewsContext && list.length <= 28) {
    const teamAbbrevs = [
      ...new Set(list.map((p) => p.teamAbbrev?.trim().toUpperCase()).filter((x): x is string => Boolean(x))),
    ]
    const nc = await fetchNewsContext(
      { prisma: args.prisma },
      {
        playerNames: names.slice(0, 18),
        teamAbbrevs,
        sport,
        hoursBack: 72,
        limit: 24,
      },
    ).catch((): { items: typeof newsItems } => ({ items: [] }))
    newsItems = nc.items ?? []
  }

  const irByName = new Map<string, typeof injuryReports>()
  for (const r of injuryReports) {
    const k = r.playerName.toLowerCase()
    const arr = irByName.get(k) ?? []
    arr.push(r)
    irByName.set(k, arr)
  }
  const irByPid = new Map<string, typeof injuryReports>()
  for (const r of injuryReports) {
    const arr = irByPid.get(r.playerId) ?? []
    arr.push(r)
    irByPid.set(r.playerId, arr)
  }

  const siByName = new Map<string, typeof sportsInjuries>()
  for (const r of sportsInjuries) {
    const k = r.playerName.toLowerCase()
    const arr = siByName.get(k) ?? []
    arr.push(r)
    siByName.set(k, arr)
  }
  const siByPid = new Map<string, typeof sportsInjuries>()
  for (const r of sportsInjuries) {
    if (r.playerId) {
      const arr = siByPid.get(r.playerId) ?? []
      arr.push(r)
      siByPid.set(r.playerId, arr)
    }
  }

  const pnByName = new Map<string, typeof playerNews>()
  for (const r of playerNews) {
    const k = r.playerName.toLowerCase()
    const arr = pnByName.get(k) ?? []
    arr.push(r)
    pnByName.set(k, arr)
  }
  const pnByPid = new Map<string, typeof playerNews>()
  for (const r of playerNews) {
    if (r.playerId) {
      const arr = pnByPid.get(r.playerId) ?? []
      arr.push(r)
      pnByPid.set(r.playerId, arr)
    }
  }

  const evByExt = new Map<string, typeof statusEvents>()
  for (const r of statusEvents) {
    const arr = evByExt.get(r.externalId) ?? []
    arr.push(r)
    evByExt.set(r.externalId, arr)
  }

  /*
   * 🛑 AN ID MATCH COUNTS ONLY WHEN THE NAME AGREES. `playerId` on these tables is whatever id the
   * writing provider uses — Rolling Insights, ESPN, Sleeper, API-Sports, canonical — and the caller's
   * id is in its own platform's space, so a bare id match is routinely a different person: Sleeper
   * and RI share a numeric range (Sleeper 8394 is Percy Butler, RI 8394 is Rome Odunze). Measured
   * 2026-10-11, the same join on redraft rosters attached 5,515 RI injury rows to the wrong player.
   * Same-name rows already arrive through the name maps, so this drops only the impostors.
   */
  const sameName = (a: string | null | undefined, b: string) => {
    const x = normalizePlayerName(a)
    return x !== '' && x === normalizePlayerName(b)
  }

  for (const p of list) {
    const key = p.playerName.toLowerCase()
    const rows: InjuryNewsSourceRow[] = []
    const extraHeadlines: string[] = []

    const pid = p.playerId ?? null
    const irList = [...(pid ? (irByPid.get(pid) ?? []).filter((r) => sameName(r.playerName, p.playerName)) : []), ...(irByName.get(key) ?? [])]
    const seenIr = new Set<string>()
    for (const r of irList) {
      const dedupe = `${r.playerId}|${r.reportDate.toISOString()}|${r.status}`
      if (seenIr.has(dedupe)) continue
      seenIr.add(dedupe)
      rows.push({
        kind: 'injury_report_record',
        label: 'injury_reports',
        statusRaw: r.status,
        atIso: r.reportDate.toISOString(),
        detail: r.notes,
        practice: r.practice,
        gameStatus: r.gameStatus ?? r.status,
        confidence: 0.92,
      })
    }

    const siList = [...(pid ? (siByPid.get(pid) ?? []).filter((r) => sameName(r.playerName, p.playerName)) : []), ...(siByName.get(key) ?? [])]
    const seenSi = new Set<string>()
    for (const r of siList) {
      const dedupe = `${r.externalId}|${r.updatedAt.toISOString()}`
      if (seenSi.has(dedupe)) continue
      seenSi.add(dedupe)
      rows.push({
        kind: 'sports_injury',
        label: r.source || 'sports_injury',
        statusRaw: r.status ?? 'unknown',
        atIso: r.updatedAt.toISOString(),
        detail: r.description,
        confidence: 0.85,
      })
    }

    const pnList = [...(pid ? (pnByPid.get(pid) ?? []).filter((r) => sameName(r.playerName, p.playerName)) : []), ...(pnByName.get(key) ?? [])]
    const seenPn = new Set<string>()
    for (const r of pnList.slice(0, 8)) {
      const dedupe = `${r.headline}|${r.publishedAt.toISOString()}`
      if (seenPn.has(dedupe)) continue
      seenPn.add(dedupe)
      extraHeadlines.push(r.headline)
      if (
        r.fantasyRelevant &&
        /\b(out|questionable|doubtful|probable|injury|injured|ir\b|suspended|active)\b/i.test(
          `${r.headline} ${r.body ?? ''}`,
        )
      ) {
        rows.push({
          kind: 'player_news',
          label: r.source,
          statusRaw: r.headline,
          atIso: r.publishedAt.toISOString(),
          detail: r.body?.slice(0, 280) ?? null,
          confidence: 0.52,
        })
      }
    }

    if (pid) {
      for (const ev of (evByExt.get(pid) ?? []).filter((e) => sameName(e.playerName, p.playerName)).slice(0, 4)) {
        rows.push({
          kind: 'player_status_event',
          label: ev.source,
          statusRaw: ev.newStatus,
          atIso: ev.detectedAt.toISOString(),
          detail: ev.statusReason ?? ev.sourceRawText,
          confidence: Math.min(1, Math.max(0.2, ev.confidence)),
        })
      }
    }

    const playerNewsItems = newsItems.filter(
      (it) =>
        it.title.toLowerCase().includes(key) ||
        (it.playerName?.toLowerCase() === key && Boolean(it.playerName)),
    )

    if (rows.length === 0 && extraHeadlines.length === 0 && playerNewsItems.length === 0) {
      out.set(key, null)
      continue
    }

    const layer = mergeInjuryNewsLayer({
      sport,
      playerName: p.playerName,
      playerId: pid,
      teamAbbrev: p.teamAbbrev ?? null,
      sources: rows,
      extraNewsHeadlines: extraHeadlines,
      newsContextItems: playerNewsItems,
    })
    out.set(key, layer)
  }

  return out
}
