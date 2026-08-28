import 'server-only'

import { prisma } from '@/lib/prisma'
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { apiChain } from '@/lib/workers/api-chain'
import { ingest, injuryAlert } from '@/lib/notification-engine'
import { ownersByPlayerId } from '@/lib/live/bigPlayNotifier'

const UPSERT_BATCH_SIZE = 100

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * The player id for a row, or null when the provider gave us none.
 *
 * ⚠ `playerId` IS PART OF THE UPSERT'S UNIQUE KEY — (sport, playerId,
 * reportDate, status). Defaulting a missing one to `''` did not merely store a
 * bad id: every unresolved player sharing a sport, date and status collapsed
 * onto ONE row, and because the upsert's `update` overwrites `playerName`, each
 * collision erased the previous player's identity.
 *
 * Measured on production 2026-08-27: 1,047 of 1,358 rows held `playerId: ''`
 * with `playerName: 'Unknown Player'`. That is NOT 1,047 players — it is an
 * unknown and larger number compressed into 1,047 slots, and the identities
 * were never stored. No backfill recovers them; only refusing the write stops
 * the loss continuing.
 *
 * So an unidentifiable row is dropped, for exactly the reason the mapper below
 * stopped inventing a status: a row we cannot identify is not a row.
 */
export function resolvePlayerId(injury: { playerId?: unknown; externalId?: unknown }): string | null {
  for (const candidate of [injury.playerId, injury.externalId]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate)
  }
  return null
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
}): Promise<{
  imported: number
  sports: string[]
  priorityWindow: boolean
  /**
   * Rows that stated a designation but carried no resolvable player id, so were
   * refused rather than written under an empty key. Surfaced so the loss is
   * visible: this number going up means a provider stopped sending ids, which
   * previously showed as silent growth in 'Unknown Player' rows.
   */
  skippedNoId: number
}> {
  const sports = Array.from(
    new Set((options?.sports?.length ? options.sports : SUPPORTED_SPORTS).map((sport) => normalizeToSupportedSport(sport)))
  )
  const week = options?.week ?? inferCurrentWeek()
  const priorityWindow = isNflPriorityInjuryWindow()
  let imported = 0
  let skippedNoId = 0

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
    }> = []

    const response = await apiChain.fetch({
      sport,
      dataType: 'injuries',
      query: { week, season: String(new Date().getFullYear()) },
    })

    if (Array.isArray(response.data) && response.data.length > 0) {
      /*
       * ⚠ NOTHING HERE IS INVENTED ANY MORE. This mapper used to default a
       * missing status to 'questionable' (an invented designation attached to
       * a real name) and stamp practice='limited' on EVERY player during the
       * Wed–Sat window (no provider we ingest carries practice participation
       * at all — the Player Finder documents exactly that). A row with no
       * stated designation is dropped, not decorated.
       */
      const stated = response.data.filter(
        (injury: any) => typeof injury.status === 'string' && injury.status.trim().length > 0,
      )
      const identified = stated.filter((injury: any) => resolvePlayerId(injury) !== null)
      skippedNoId += stated.length - identified.length

      rows = identified
        .map((injury: any) => ({
          sport,
          playerId: resolvePlayerId(injury) as string,
          playerName: String(injury.playerName ?? injury.player ?? 'Unknown Player'),
          team: normalizeTeamAbbrev(injury.team) ?? injury.team ?? 'FA',
          status: String(injury.status),
          bodyPart: typeof injury.bodyPart === 'string' ? injury.bodyPart : null,
          notes: typeof injury.notes === 'string' ? injury.notes : null,
          practice: null,
          gameStatus: injury.status,
          reportDate: injury.reportDate ? new Date(injury.reportDate) : new Date(),
          week,
        }))
    } else {
      const legacyRows = await prisma.sportsInjury.findMany({
        where: { sport },
        orderBy: { fetchedAt: 'desc' },
        take: 1000,
      })

      // Same two rules as the live branch: no stated designation, no row; and
      // no resolvable id, no row. This path had no `?? ''`, so an unidentified
      // row reached the upsert as null rather than empty string — a different
      // shape, the same corruption of the unique key.
      const legacyStated = legacyRows.filter(
        (injury) => typeof injury.status === 'string' && injury.status.trim().length > 0,
      )
      const legacyIdentified = legacyStated.filter((injury) => resolvePlayerId(injury) !== null)
      skippedNoId += legacyStated.length - legacyIdentified.length

      rows = legacyIdentified
        .map((injury) => ({
          sport,
          playerId: resolvePlayerId(injury) as string,
          playerName: injury.playerName,
          team: injury.team ?? 'FA',
          status: injury.status as string,
          bodyPart: injury.type ?? null,
          notes: injury.description ?? null,
          practice: null,
          gameStatus: injury.status,
          reportDate: injury.date ?? injury.fetchedAt,
          week: injury.week ?? week,
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

      // Fire notifications for high-severity injuries (out, IR, suspended).
      // Recipients are resolved the way big-play alerts resolve them — through
      // PlayerIdentityMap to the managers who actually roster the player. An
      // event with neither userIds nor leagueId is a guaranteed no-op inside
      // ingest() ('no_target_users'), which is exactly what this loop used to
      // be. Rows whose playerId has no identity mapping are skipped, not
      // guessed at. Email/SMS are skipped on purpose: the in-app row (with the
      // engine's 60-minute per-user cooldown) is the alert; injury email
      // belongs to the digest, not a per-report blast.
      const highSeverity = batch.filter((r) =>
        ['out', 'ir', 'injured reserve', 'suspended'].includes(r.status.toLowerCase())
      )
      const capped = highSeverity.slice(0, 5)
      if (capped.length > 0) {
        const owners = await ownersByPlayerId(
          Array.from(new Set(capped.map((r) => r.playerId).filter(Boolean)))
        ).catch(() => new Map<string, string[]>())
        for (const row of capped) {
          const userIds = owners.get(row.playerId)
          if (!userIds || userIds.length === 0) continue
          void ingest({
            ...injuryAlert({
              playerName: row.playerName,
              team: row.team,
              status: row.status,
              sport: row.sport,
              userIds,
            }),
            skipChannels: { email: true, sms: true },
          })
        }
      }
    }
  }

  if (skippedNoId > 0) {
    console.warn(`[injury-importer] skipped ${skippedNoId} row(s) with no resolvable player id`)
  }

  return { imported, sports, priorityWindow, skippedNoId }
}
