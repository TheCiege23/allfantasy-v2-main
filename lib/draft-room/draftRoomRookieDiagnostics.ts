/**
 * Dev-oriented diagnostics for rookie filter / pool metadata gaps (no invented rookies).
 */

import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { normalizeCollegeClass } from '@/lib/draft-room/collegeClass'
import {
  isDraftRoomRookie,
  poolRowHasRookieSignals,
  resolveNflRookieDiagnosticSource,
  type DraftRoomRookiePlayerLike,
} from '@/lib/draft-room/draftPlayerRookie'

export type RookieSignalDiagnosticsSampleRow = {
  playerId: string | null
  name: string
  position: string
  team: string | null
  isRookie?: boolean
  rookie?: boolean
  yearsExperience?: number | null
  experience?: number | null
  draftYear?: number | null
  nflDraftYear?: number | null
  metadataKeysMatching: string[]
  rookieSource?: string
}

export type RookieSignalDiagnostics = {
  totalPlayers: number
  sport: string
  seasonYear: number
  rookieSignalCount: number
  draftYearSignalCount: number
  experienceZeroCount: number
  sample: RookieSignalDiagnosticsSampleRow[]
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function collectMetadataKeyHints(player: DraftRoomRookiePlayerLike): string[] {
  const out = new Set<string>()
  const scan = (obj: Record<string, unknown> | null | undefined) => {
    if (!obj) return
    for (const k of Object.keys(obj)) {
      const kl = k.toLowerCase()
      if (
        kl.includes('rookie') ||
        kl.includes('draft') ||
        kl.includes('experience') ||
        kl === 'exp' ||
        kl.includes('year')
      ) {
        out.add(k)
      }
    }
  }
  scan(player.metadata as Record<string, unknown> | undefined)
  scan(player.display?.metadata as Record<string, unknown> | undefined)
  return [...out].slice(0, 24)
}

function rowHasDraftYearSignal(player: DraftRoomRookiePlayerLike): boolean {
  if (player.draftYear != null && Number.isFinite(Number(player.draftYear))) return true
  if (player.nflDraftYear != null && Number.isFinite(Number(player.nflDraftYear))) return true
  const dm = player.display?.metadata as Record<string, unknown> | undefined
  if (dm && typeof dm === 'object') {
    if (num(dm.draftYear) != null || num(dm.nflDraftYear) != null) return true
  }
  return false
}

function rowHasExperienceZero(player: DraftRoomRookiePlayerLike): boolean {
  const ye = num(player.yearsExp)
  if (ye === 0) return true
  const ex = num(player.experience)
  if (ex === 0) return true
  const dm = player.display?.metadata as Record<string, unknown> | undefined
  if (dm && typeof dm === 'object') {
    const y2 = num(dm.years_exp) ?? num(dm.yearsExp) ?? num(dm.experience) ?? num(dm.exp)
    if (y2 === 0) return true
  }
  return false
}

/** Prefer normalized entry + display.metadata fallbacks (DB rows sometimes only populate nested metadata). */
export function coalesceYearsExpFromNormalizedEntry(e: NormalizedDraftEntry): number | null {
  if (e.yearsExp != null && Number.isFinite(Number(e.yearsExp))) return Number(e.yearsExp)
  const dm = e.display?.metadata as Record<string, unknown> | undefined
  if (!dm) return null
  for (const key of ['years_exp', 'yearsExp', 'experience', 'exp']) {
    const v = dm[key]
    const n = num(v)
    if (n != null) return n
  }
  return null
}

export function playerEntryFromNormalizedForRookieDiagnostics(
  e: NormalizedDraftEntry,
): DraftRoomRookiePlayerLike {
  const yearsExp = coalesceYearsExpFromNormalizedEntry(e)
  const base: DraftRoomRookiePlayerLike = {
    ...e,
    yearsExp,
    isRookie: e.isRookie,
    display: e.display ?? null,
  }
  return base
}

export function buildRookieSignalDiagnostics(
  players: DraftRoomRookiePlayerLike[],
  sport: string,
  seasonYear: number,
): RookieSignalDiagnostics {
  let rookieSignalCount = 0
  let draftYearSignalCount = 0
  let experienceZeroCount = 0

  for (const p of players) {
    if (poolRowHasRookieSignals(p)) rookieSignalCount += 1
    if (rowHasDraftYearSignal(p)) draftYearSignalCount += 1
    if (rowHasExperienceZero(p)) experienceZeroCount += 1
  }

  const sample: RookieSignalDiagnosticsSampleRow[] = players.slice(0, 10).map((p) => {
    const dm = p.display?.metadata as Record<string, unknown> | undefined
    return {
      playerId:
        (p.display?.playerId != null ? String(p.display.playerId) : null) ??
        (typeof (p as { playerId?: string }).playerId === 'string'
          ? (p as { playerId?: string }).playerId!
          : null),
      name: String((p as { name?: string }).name ?? p.display?.displayName ?? ''),
      position: String((p as { position?: string }).position ?? ''),
      team: (p as { team?: string | null }).team ?? null,
      isRookie: p.isRookie,
      rookie: p.rookie as boolean | undefined,
      yearsExperience: num(p.yearsExp) ?? num(dm?.years_exp) ?? num(dm?.yearsExp),
      experience: num(p.experience) ?? num(dm?.experience),
      draftYear: num(p.draftYear) ?? num(dm?.draftYear),
      nflDraftYear: num(p.nflDraftYear) ?? num(dm?.nflDraftYear),
      metadataKeysMatching: collectMetadataKeyHints(p),
      rookieSource: resolveNflRookieDiagnosticSource(p),
    }
  })

  return {
    totalPlayers: players.length,
    sport,
    seasonYear,
    rookieSignalCount,
    draftYearSignalCount,
    experienceZeroCount,
    sample,
  }
}

export type NcaaFootballClassFilterDiagnostics = {
  totalPlayers: number
  playersWithClass: number
  classCounts: Record<string, number>
  sampleClassValues: string[]
  sampleMissingClassRows: Array<{ name: string; position: string; team: string | null }>
}

/**
 * When NCAA football freshman/class filters look empty, inspect class coverage on pool rows.
 * Uses `display.metadata.class` / `collegeClass` — align ingestion with Rolling Insights `class`.
 */
export function buildNcaaFootballClassFilterDiagnostics(
  players: DraftRoomRookiePlayerLike[],
): NcaaFootballClassFilterDiagnostics {
  const classCounts: Record<string, number> = {}
  const sampleClassValues: string[] = []
  const seen = new Set<string>()
  const sampleMissingClassRows: NcaaFootballClassFilterDiagnostics['sampleMissingClassRows'] = []
  let playersWithClass = 0

  for (const p of players) {
    const dm = p.display?.metadata as Record<string, unknown> | undefined
    const nested =
      dm && typeof dm.metadata === 'object' && dm.metadata
        ? (dm.metadata as Record<string, unknown>).class
        : undefined
    const raw =
      dm?.collegeClass ?? dm?.class ?? nested
    const cls =
      typeof raw === 'string'
        ? raw.trim()
        : raw != null && raw !== ''
          ? String(raw).trim()
          : ''

    if (cls) {
      playersWithClass += 1
      const bucket = normalizeCollegeClass(cls)
      classCounts[bucket] = (classCounts[bucket] ?? 0) + 1
      if (seen.size < 16 && !seen.has(cls)) {
        seen.add(cls)
        sampleClassValues.push(cls)
      }
    } else if (sampleMissingClassRows.length < 12) {
      sampleMissingClassRows.push({
        name: String((p as { name?: string }).name ?? ''),
        position: String((p as { position?: string }).position ?? ''),
        team: (p as { team?: string | null }).team ?? null,
      })
    }
  }

  return {
    totalPlayers: players.length,
    playersWithClass,
    classCounts,
    sampleClassValues,
    sampleMissingClassRows,
  }
}

export function rookieHelperTrueWhenNflDraftYearMatchesSeason(args: {
  sport: string
  seasonYear: number
  nflDraftYear: number
}): boolean {
  const player: DraftRoomRookiePlayerLike = {
    name: 'Diag',
    display: {
      metadata: { nflDraftYear: args.nflDraftYear },
    },
  }
  return isDraftRoomRookie(player, { sport: args.sport, seasonYear: args.seasonYear })
}
