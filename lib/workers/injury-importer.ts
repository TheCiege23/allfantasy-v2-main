import 'server-only'

import { prisma } from '@/lib/prisma'
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { apiChain } from '@/lib/workers/api-chain'
import { notifySyncedInjuries } from '@/lib/engagement-alerts/injuryAlerts'

const UPSERT_BATCH_SIZE = 100

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function inferCurrentWeek(): number | null {
  const day = new Date().getUTCDate()
  return Math.max(1, Math.min(18, Math.ceil(day / 7)))
}

export function isNflPriorityInjuryWindow(date: Date = new Date()): boolean {
  const day = date.getUTCDay()
  return day >= 3 && day <= 6
}

export async function runInjuryImporter(options?: {
  sports?: string[]
  week?: number
}): Promise<{ imported: number; sports: string[]; priorityWindow: boolean }> {
  const sports = Array.from(
    new Set((options?.sports?.length ? options.sports : SUPPORTED_SPORTS).map((sport) => normalizeToSupportedSport(sport)))
  )
  const week = options?.week ?? inferCurrentWeek()
  const priorityWindow = isNflPriorityInjuryWindow()
  let imported = 0

  for (const sport of sports) {
    let rows: Array<{
      sport: string
      playerId: string
      playerName: string
      team: string
      status: string
      bodyPart?: string | null
      notes?: string | null
      practice?: string | null
      gameStatus?: string | null
      reportDate: Date
      week?: number | null
      /** `playerId` is known to be a Rolling Insights id — the only id the alert lookups below speak. */
      riKeyed: boolean
    }> = []

    const response = await apiChain.fetch({
      sport,
      dataType: 'injuries',
      query: { week, season: String(new Date().getFullYear()) },
    })

    if (Array.isArray(response.data) && response.data.length > 0) {
      // Only a provider-chain answer from Rolling Insights itself carries RI ids. 'cache' is
      // `SportsInjury` rows of every source (ESPN, Sleeper, RI) with no source on the row.
      const riKeyed = response.source === 'rolling_insights'
      /*
       * ⚠ NOTHING HERE IS INVENTED ANY MORE. This mapper used to default a
       * missing status to 'questionable' (an invented designation attached to
       * a real name) and stamp practice='limited' on EVERY player during the
       * Wed–Sat window (no provider we ingest carries practice participation
       * at all — the Player Finder documents exactly that). A row with no
       * stated designation is dropped, not decorated.
       */
      rows = response.data
        .filter((injury: any) => typeof injury.status === 'string' && injury.status.trim().length > 0)
        .map((injury: any) => ({
          sport,
          playerId: String(injury.playerId ?? injury.externalId ?? ''),
          playerName: String(injury.playerName ?? injury.player ?? 'Unknown Player'),
          team: normalizeTeamAbbrev(injury.team) ?? injury.team ?? 'FA',
          status: String(injury.status),
          bodyPart: typeof injury.bodyPart === 'string' ? injury.bodyPart : null,
          notes: typeof injury.notes === 'string' ? injury.notes : null,
          practice: null,
          gameStatus: injury.status,
          reportDate: injury.reportDate ? new Date(injury.reportDate) : new Date(),
          week,
          riKeyed,
        }))
    } else {
      /*
       * Live rows only (`expiresAt > now`), the rule every other `SportsInjury` reader applies
       * (injuryReadPort). Without it a months-expired row — 2,953 retired `api_sports` NFL rows,
       * last fetched 2026-07-24 — could be re-reported as today's news.
       */
      const legacyRows = await prisma.sportsInjury.findMany({
        where: { sport, expiresAt: { gt: new Date() } },
        orderBy: { fetchedAt: 'desc' },
        take: 1000,
      })

      rows = legacyRows
        // Same rule as the live branch: no stated designation, no row.
        .filter((injury) => typeof injury.status === 'string' && injury.status.trim().length > 0)
        .map((injury) => ({
          sport,
          playerId: injury.playerId ?? injury.externalId,
          playerName: injury.playerName,
          team: injury.team ?? 'FA',
          status: injury.status as string,
          bodyPart: injury.type ?? null,
          notes: injury.description ?? null,
          practice: null,
          gameStatus: injury.status,
          reportDate: injury.date ?? injury.fetchedAt,
          week: injury.week ?? week,
          // ESPN rows have no playerId (externalId is ESPN's); `sleeper_live` ids are Sleeper's.
          riKeyed: injury.source === 'rolling_insights' && Boolean(injury.playerId),
        }))
    }

    for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
      await prisma.$transaction(
        batch.map((row) =>
          prisma.injuryReportRecord.upsert({
            where: {
              uniq_injury_reports_player_report_status: {
                sport: row.sport,
                playerId: row.playerId,
                reportDate: row.reportDate,
                status: row.status,
              },
            },
            update: {
              playerName: row.playerName,
              team: row.team,
              bodyPart: row.bodyPart,
              notes: row.notes,
              practice: row.practice,
              gameStatus: row.gameStatus,
              week: row.week ?? null,
            },
            create: {
              sport: row.sport,
              playerId: row.playerId,
              playerName: row.playerName,
              team: row.team,
              status: row.status,
              bodyPart: row.bodyPart,
              notes: row.notes,
              practice: row.practice,
              gameStatus: row.gameStatus,
              reportDate: row.reportDate,
              week: row.week ?? null,
            },
          })
        )
      )
      imported += batch.length


    }
    await notifySyncedInjuries(sport)
  }

  return { imported, sports, priorityWindow }
}
