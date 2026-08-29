import { NextResponse } from 'next/server'
import { getInjuryReport } from '@/lib/data/players'
import { prisma } from '@/lib/prisma'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { uiKeyToDataSport } from '@/lib/startSit/shared'

export const dynamic = 'force-dynamic'

function isUnknownPlayerName(name: string | null | undefined): boolean {
  const normalized = String(name ?? '').trim().toLowerCase()
  return !normalized || normalized === 'unknown' || normalized === 'unknown player'
}

/**
 * How much a designation should outrank another for a START/SIT decision.
 *
 * ⚠ THE PROVIDER FEED IS NOT ALL INJURIES. Measured on the rows this panel could
 * serve for NFL: Questionable 475 (41.4%), **Active 452 (39.4%)**, IR 156, Out 23,
 * Suspension 5, Doubtful 1. "Active" rows are practice and transaction notes ESPN
 * mixes into the same feed ("the Dolphins signed Bennett", "played 18 snaps"), and
 * because they are published constantly they are always the newest thing in the
 * table. Ordered by recency alone they filled all 14 slots and buried 475
 * Questionable and 156 IR players — the panel was newest-first, not most-relevant.
 *
 * Rank is by what the manager has to DECIDE, so tier beats recency; recency only
 * breaks ties inside a tier.
 */
function designationRank(status: string | null | undefined): number {
  const s = String(status ?? '').trim().toLowerCase()
  if (!s) return 1
  // Cannot play. Nothing outranks these.
  if (/\b(out|ir|injured reserve|suspend|suspension|pup|nfi|doubtful)\b/.test(s)) return 4
  // Genuinely in doubt — the actual start/sit question.
  if (/\b(questionable|game.?time|day.?to.?day|limited|probable)\b/.test(s)) return 3
  // "Active"/"Healthy" is the ABSENCE of an injury. It is news, not a designation,
  // and it ranks below a row with no stated status at all — which is at least a row
  // the provider bothered to file about someone's availability.
  if (/\b(active|healthy|cleared|full)\b/.test(s)) return 0
  return 2
}

function severityFromStatus(status: string | null | undefined): 'high' | 'medium' | 'low' {
  const rank = designationRank(status)
  if (rank >= 4) return 'high'
  if (rank === 0) return 'low' // "Active" is not a medium-severity injury; it is not one.
  return 'medium'
}

/**
 * This panel answers "who is hurt for THIS slate", so a report older than three
 * weeks does not belong in it at any staleness caveat — a genuinely injured player
 * gets re-reported inside that window, and anything that does not is describing a
 * different week.
 *
 * ⚠ IT MUST BE APPLIED TO EVERY PATH BELOW, NOT JUST THE PORT. The fallbacks read
 * `injuryReportRecord` via getInjuryReport, which has NO recency filter of its own
 * (it returns the newest 250 by reportDate whatever their age) and a second fallback
 * queries sportsInjury directly with none either. Filtering only the primary would
 * have swapped the three 2020/2022 college rows for nine from April and looked fixed.
 */
const SLATE_REPORT_HORIZON_HOURS = 21 * 24

function withinSlateHorizon(when: Date | string | null | undefined, now: Date): boolean {
  if (!when) return false
  const t = new Date(when).getTime()
  if (!Number.isFinite(t)) return false
  return now.getTime() - t <= SLATE_REPORT_HORIZON_HOURS * 3_600_000
}

async function readIdentityBackedInjuries(dataSport: string, now: Date) {
  const sourceRows = await prisma.sportsInjury.findMany({
    where: {
      sport: dataSport,
      // Same slate horizon as every other path here. This query had no recency
      // filter at all, and it is the one that resurfaced the 2020/2022 college
      // rows even when the primary read had already excluded them. A null `date`
      // is kept — it is judged by fetchedAt instead, as in the read port.
      OR: [
        { date: null },
        { date: { gte: new Date(now.getTime() - SLATE_REPORT_HORIZON_HOURS * 3_600_000) } },
      ],
      NOT: [
        { playerName: { equals: 'Unknown', mode: 'insensitive' } },
        { playerName: { equals: 'Unknown Player', mode: 'insensitive' } },
      ],
    },
    orderBy: { date: 'desc' },
    take: 250,
    select: {
      playerId: true,
      playerName: true,
      team: true,
      position: true,
      status: true,
      description: true,
      date: true,
      updatedAt: true,
    },
  })

  const playerIds = Array.from(new Set(sourceRows.map((row) => String(row.playerId ?? '').trim()).filter(Boolean)))

  const [sportsPlayers, identityRows] = await Promise.all([
    playerIds.length > 0
      ? prisma.sportsPlayerRecord.findMany({
          where: {
            sport: dataSport,
            id: { in: playerIds },
          },
          select: {
            id: true,
            name: true,
            team: true,
            position: true,
          },
        })
      : Promise.resolve([]),
    playerIds.length > 0
      ? prisma.playerIdentityMap.findMany({
          where: {
            sport: dataSport,
            OR: [
              { sleeperId: { in: playerIds } },
              { apiSportsId: { in: playerIds } },
              { fantasyCalcId: { in: playerIds } },
              { rollingInsightsId: { in: playerIds } },
              { espnId: { in: playerIds } },
              { clearSportsId: { in: playerIds } },
            ],
          },
          select: {
            sleeperId: true,
            apiSportsId: true,
            fantasyCalcId: true,
            rollingInsightsId: true,
            espnId: true,
            clearSportsId: true,
            canonicalName: true,
            currentTeam: true,
            position: true,
          },
        })
      : Promise.resolve([]),
  ])

  const sportsPlayerById = new Map(sportsPlayers.map((row) => [row.id, row]))
  const identityByAnyExternalId = new Map<string, (typeof identityRows)[number]>()
  for (const row of identityRows) {
    for (const key of [row.sleeperId, row.apiSportsId, row.fantasyCalcId, row.rollingInsightsId, row.espnId, row.clearSportsId]) {
      const normalized = String(key ?? '').trim()
      if (normalized) {
        identityByAnyExternalId.set(normalized, row)
      }
    }
  }

  return sourceRows
    // Same ranking as the other two paths — designation first, then report date.
    .slice()
    .sort((a, b) => {
      const byRank = designationRank(b.status) - designationRank(a.status)
      if (byRank !== 0) return byRank
      return new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()
    })
    .slice(0, 14)
    .map((row) => {
    const playerId = String(row.playerId ?? '').trim()
    const sportsPlayer = playerId ? sportsPlayerById.get(playerId) : undefined
    const identity = playerId ? identityByAnyExternalId.get(playerId) : undefined
    const playerName =
      (!isUnknownPlayerName(row.playerName) && row.playerName) ||
      sportsPlayer?.name ||
      identity?.canonicalName ||
      'Unknown Player'
    const team = String(row.team ?? '').trim() || sportsPlayer?.team || identity?.currentTeam || null
    const position = String(row.position ?? '').trim() || sportsPlayer?.position || identity?.position || null

    const detailParts = [row.status, row.description].filter(Boolean)
    if (team || position) {
      detailParts.unshift([position, team].filter(Boolean).join(' '))
    }

    return {
      player: playerName,
      source: 'Injury report DB',
      // Report date, falling back to our row timestamp — never `updatedAt` alone,
      // which is when WE touched the row and is always ~now.
      time: new Date(row.date ?? row.updatedAt).toLocaleDateString(),
      severity: severityFromStatus(row.status),
      text: detailParts.join(' — ').slice(0, 220),
    }
  })
}

export async function GET(req: Request) {
  const sport = new URL(req.url).searchParams.get('sport') || 'nfl'
  const dataSport = uiKeyToDataSport(sport)
  const now = new Date()

  try {
    // Slice 18 follow-on — PRIMARY source is the canonical injury read port
    // (live, TTL-respected, one row per player, freshest source wins). The
    // previous primary (`getInjuryReport` → injuryReportRecord) was measured
    // 103.8 days stale in prod on 2026-08-10, so this panel was rendering
    // three-month-old reports as if current.
    /*
     * ⚠ THE LIMIT HAS TO BE WIDE ENOUGH TO RANK WITHIN.
     *
     * listInjuryFacts sorts by report recency and then slices to `limit`, so asking
     * for 50 and ranking afterwards would only ever reorder the 50 NEWEST rows —
     * and the newest rows are exactly the "Active" transaction notes that caused
     * this bug. Ranking has to happen over the whole slate, so the port is asked
     * for the slate and this route picks the 14 that matter.
     */
    const factList = await listInjuryFacts({
      sport: dataSport,
      limit: 400,
      maxReportAgeHours: SLATE_REPORT_HORIZON_HOURS,
    }).catch(() => null)
    const portInjuries = (factList?.facts ?? [])
      .filter((f) => !isUnknownPlayerName(f.playerName))
      // Designation first, then most recently reported. See designationRank.
      .sort((a, b) => {
        const byRank = designationRank(b.status) - designationRank(a.status)
        if (byRank !== 0) return byRank
        return new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime()
      })
      .slice(0, 14)
      .map((f) => {
        const detailParts = [f.status, f.description].filter(Boolean) as string[]
        const posTeam = [f.position, f.team].filter(Boolean).join(' ')
        if (posTeam) detailParts.unshift(posTeam)
        // Staleness reported, not hidden — a stale designation is a claim
        // that can no longer be stood behind.
        if (f.stale) detailParts.push(`reported ${Math.round(f.ageHours / 24)}d ago`)
        return {
          player: f.playerName,
          source: 'Injury report DB',
          /*
           * The REPORT date, not the fetch date. This showed `fetchedAt`, so every
           * item carried today's date regardless of when it was actually reported —
           * the college panel displayed "8/28/2026" on reports from 2020 and 2022.
           */
          time: new Date(f.reportedAt).toLocaleDateString(),
          severity: severityFromStatus(f.status),
          text: detailParts.join(' — ').slice(0, 220),
        }
      })
    if (portInjuries.length > 0) {
      return NextResponse.json({ injuries: portInjuries })
    }

    // Fallback: legacy normalized table, then the identity-backed DB join.
    const rows = await getInjuryReport(dataSport)
    let injuries = rows
      // getInjuryReport applies no recency filter of its own — see the note on
      // SLATE_REPORT_HORIZON_HOURS. Without this, NCAAF served nine April rows.
      .filter((r) => withinSlateHorizon(r.reportDate, now))
      // Same ranking as the primary path, so a fallback does not silently reorder
      // the panel into newest-first practice notes.
      .sort((a, b) => {
        const byRank = designationRank(b.status) - designationRank(a.status)
        if (byRank !== 0) return byRank
        return new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
      })
      .slice(0, 14)
      .map((r) => ({
        player: r.playerName,
        source: 'Injury report DB',
        time: new Date(r.reportDate).toLocaleDateString(),
        severity: severityFromStatus(r.status),
        text: [r.status, r.notes].filter(Boolean).join(' — ').slice(0, 220),
      }))

    // If the active normalized table is present but identity fields are degraded,
    // backfill from the DB injury table that carries player names.
    if (injuries.length > 0 && injuries.every((row) => isUnknownPlayerName(row.player))) {
      const identityBacked = await readIdentityBackedInjuries(dataSport, now)
      if (identityBacked.some((row) => !isUnknownPlayerName(row.player))) {
        injuries = identityBacked
      }
    }

    if (injuries.length === 0) {
      // ⚠ EMPTY, NEVER DEMO. This used to return createDemoInjuries — invented
      // practice reports naming a real player ("Tyreek Hill — Limited practice
      // Thu"), labelled "Sports ingest", whenever the feed was empty. An empty
      // report is an answer; a fabricated one is a lie with a real name on it.
      return NextResponse.json({ injuries: [], note: 'No injury designations on file for this slate.' })
    }
    return NextResponse.json({ injuries })
  } catch (e) {
    console.warn('[start-sit/injuries]', e)
    return NextResponse.json({ injuries: [], note: 'Injury feed unavailable right now.' })
  }
}
