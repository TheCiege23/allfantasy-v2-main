import 'server-only'

import type { AppPrismaClient } from '@/lib/sports-data-normalization/appPrismaClient'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { fetchNewsContext } from '@/lib/upstream-apis'
import { mergeInjuryNewsLayer } from '@/lib/news-injury-aggregation/mergeLayer'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { createInjuryRowMatcher, foldInjuryTeam, injuryClaimAsOf } from '@/lib/injuries/matchInjuryRows'
import { INJURY_STALE_AFTER_HOURS } from '@/lib/injuries/injuryRecency'
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

  /*
   * 🛑 THE TWO LOG TABLES ARE BOUNDED TO THE STALE WINDOW, AND `SportsInjury` TO ROWS A FEED STILL
   * CARRIES (2026-10-11). This read used to take three weeks of `injury_reports`, two weeks of
   * `SportsInjury` by `updatedAt` with no `expiresAt`, and ten days of status events, and the merge
   * then kept the WORST status among them. A player who was Out last week and cleared this morning
   * read Out, and the trade analyzer multiplied his projection by 0.05. A live `SportsInjury` row is
   * the feed's current word whatever its age; a log row with no expiry says nothing about today once
   * it is older than the window every other injury reader uses.
   */
  const now = new Date()
  const sinceLog = new Date(now.getTime() - INJURY_STALE_AFTER_HOURS * 3_600_000)
  const sinceNews = subDays(7)

  const [injuryReports, sportsInjuries, playerNews, statusEvents] = await Promise.all([
    args.prisma.injuryReportRecord.findMany({
      where: {
        sport,
        reportDate: { gte: sinceLog },
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
        expiresAt: { gt: now },
        OR: [
          ...(ids.length ? [{ playerId: { in: ids } }] : []),
          ...(nameOr.length ? [{ OR: nameOr }] : []),
        ],
      },
      select: {
        playerName: true,
        playerId: true,
        team: true,
        position: true,
        status: true,
        description: true,
        source: true,
        date: true,
        fetchedAt: true,
      },
      orderBy: { fetchedAt: 'desc' },
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
            detectedAt: { gte: sinceLog },
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

  /*
   * Both injury tables bind through the shared matcher: by name, verified by team, a lone namesake
   * refused. A name join alone handed the Browns LB Justin Jefferson's row to the Vikings WR. Rows
   * reached only through a colliding provider id never match, because the matcher reads the name.
   * `injury_reports` writes "UNKNOWN" for a team it could not read; that is no team, not a club.
   */
  const matchReport = createInjuryRowMatcher(
    injuryReports.map((r) => ({ ...r, team: r.team?.trim().toUpperCase() === 'UNKNOWN' ? null : r.team })),
    sport,
  )
  const matchLive = createInjuryRowMatcher(sportsInjuries, sport)
  const rowsFor = <R,>(res: { rows: R[] } | { ambiguous: true } | null): R[] =>
    res && 'rows' in res ? res.rows : []

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
    const lookup = { name: p.playerName, team: p.teamAbbrev ?? null }
    const seenIr = new Set<string>()
    for (const r of rowsFor(matchReport(lookup))) {
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

    // Stamped with the CLAIM time, not `updatedAt`: Rolling Insights re-pulls Friday's report every
    // 30 minutes, and that must not make it newer than ESPN's "Active" from Sunday morning.
    for (const r of rowsFor(matchLive(lookup))) {
      rows.push({
        kind: 'sports_injury',
        label: r.source || 'sports_injury',
        statusRaw: r.status ?? 'unknown',
        atIso: injuryClaimAsOf(r).toISOString(),
        detail: r.description,
        confidence: 0.85,
      })
    }

    /*
     * A story or feed item on ANOTHER club is a namesake's, not this player's. The summary line is
     * built from these, and "Justin Jefferson (CLE) — Out" sat in the Vikings receiver's summary.
     * Only a stated team that disagrees drops a row; no team on either side keeps it.
     */
    const ownTeam = foldInjuryTeam(p.teamAbbrev, sport)
    const sameTeam = (team: string | null | undefined) => {
      const t = foldInjuryTeam(team, sport)
      return !ownTeam || !t || t === ownTeam
    }

    const pnList = [...(pid ? (pnByPid.get(pid) ?? []).filter((r) => sameName(r.playerName, p.playerName)) : []), ...(pnByName.get(key) ?? [])]
      .filter((r) => sameTeam(r.team))
    const seenPn = new Set<string>()
    for (const r of pnList.slice(0, 8)) {
      const dedupe = `${r.headline}|${r.publishedAt.toISOString()}`
      if (seenPn.has(dedupe)) continue
      seenPn.add(dedupe)
      /*
       * A headline is NOT a designation. It used to be pushed as a status row and read by regex:
       * "Nacua returns from IR, will start" became IR and "Waddle out of walking boot" became Out.
       * Headlines feed the summary only; designations come from the injury feeds above.
       */
      extraHeadlines.push(r.headline)
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
        (it.title.toLowerCase().includes(key) ||
          (it.playerName?.toLowerCase() === key && Boolean(it.playerName))) &&
        sameTeam(it.team),
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
