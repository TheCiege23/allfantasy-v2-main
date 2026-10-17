import type { LeagueSport } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { indexBySleeperId, sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import type { LineupsActionThresholds } from '@/lib/lineup-actions/thresholds'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import { isSleeperPlayerLegalInSlot } from '@/lib/lineup-actions/sleeperSlotUtils'
import { isForeignIdSpace } from '@/lib/core-app/rosterIdSpace'
import { designationSeverity, resolveCurrentInjuryDesignations } from '@/lib/injuries/currentInjuryDesignations'

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x === 'string' && x.trim()) out.push(x.trim())
  }
  return out
}

/**
 * The starter's row in the persisted `lineup_sections` snapshot — for his NAME, POSITION and TEAM only.
 *
 * 🛑 ITS `status` IS NOT READ (2026-10-11). It is a snapshot taken whenever the league was last
 * imported, of whatever the platform called status — for a Sleeper-seeded pool, Sleeper's ROSTER
 * status ("Active"). Preferring it put an Out starter in the lineup as "Active" for as long as the
 * snapshot lived. The designation comes from the injury feed (`resolveCurrentInjuryDesignations`).
 */
function readLineupSectionPlayer(
  sections: Record<string, unknown> | undefined,
  playerId: string
): { position: string; name: string | null; team: string | null } | null {
  const starters = sections?.starters
  if (!Array.isArray(starters)) return null
  for (const row of starters) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : typeof o.player_id === 'string' ? o.player_id : null
    if (id !== playerId) continue
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : typeof o.full_name === 'string' && o.full_name.trim() ? o.full_name.trim() : null
    const team = typeof o.team === 'string' && o.team.trim() ? o.team.trim() : null
    return {
      position: String(o.position ?? 'UTIL').toUpperCase(),
      name,
      team,
    }
  }
  return null
}

function parseLockFromGameTime(raw: unknown): Date | null {
  if (raw == null) return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'string') {
    const t = Date.parse(raw)
    if (!Number.isNaN(t)) return new Date(t)
  }
  return null
}

export type NativeLineupScanArgs = {
  leagueId: string
  leagueName: string
  sport: LeagueSport
  platform: string
  bestBallMode: boolean | null
  playerData: Prisma.JsonValue | null
  thresholds: LineupsActionThresholds
}

export async function scanNativeLeagueLineup(args: NativeLineupScanArgs): Promise<{ actions: LineupActionItem[] }> {
  const { leagueId, leagueName, sport, platform, bestBallMode, playerData, thresholds } = args

  if (thresholds.bestBallSkipManual && bestBallMode === true) {
    return { actions: [] }
  }

  const pd =
    playerData && typeof playerData === 'object' && !Array.isArray(playerData)
      ? (playerData as Record<string, unknown>)
      : {}
  const lineupSections =
    pd.lineup_sections && typeof pd.lineup_sections === 'object' && !Array.isArray(pd.lineup_sections)
      ? (pd.lineup_sections as Record<string, unknown>)
      : undefined

  const starters = toStringArray(pd.starters)
  const template = await getRosterTemplateForLeague(sport, 'standard', leagueId).catch(() => null)
  const starterSlots = template
    ? template.slots
        .filter((slot) => slot.starterCount > 0)
        .flatMap((slot) => Array.from({ length: slot.starterCount }, () => String(slot.slotName).toUpperCase()))
    : starters.map((_id, index) => (index === 0 ? 'QB' : 'FLEX'))

  const required = Math.max(starterSlots.length, 1)
  const filled = starters.filter(Boolean).length
  const actions: LineupActionItem[] = []

  if (filled < required) {
    const gap = required - filled
    for (let g = 0; g < gap; g++) {
      actions.push({
        leagueId,
        leagueName,
        sport,
        platform,
        teamId: null,
        slotIndex: filled + g,
        slotId: `native:missing:${g}`,
        slotLabel: starterSlots[filled + g] ?? 'START',
        playerId: null,
        playerName: null,
        reasonType: 'native_starter_gap',
        urgency: 'urgent',
        lockTime: null,
        recommendedAction: 'Assign a starter for this slot.',
        suggestedReplacementPlayerId: null,
        confidence: null,
        expectedGain: null,
        sourceModule: 'lineup_scan',
        message:
          gap === 1 && g === 0
            ? 'At least one starting slot is empty'
            : `Missing ${gap} starter slot(s) vs roster template`,
        severity: 'critical',
      })
    }
  }

  /*
   * A foreign league's ids (Fleaflicker, MFL, ...) collide with real Sleeper ids, and imported
   * `lineup_sections` hold bare ids, so a DB row here would name a stranger and flag HIS slot or
   * injury. Not looked up: the starters still count toward the slot gap above, unnamed.
   */
  const ids = isForeignIdSpace(platform) ? [] : starters.slice(0, starterSlots.length).filter(Boolean)
  /*
   * 🛑 And the ids that ARE looked up are Sleeper-space, so by Sleeper id only — never against
   * `externalId`, where Rolling Insights keeps its own colliding numbers (Sleeper 9228 is Bryce
   * Young; RI 9228 is an offensive tackle). The same stranger-naming the foreign-league guard above
   * prevents, reached from inside a Sleeper-space league. See externalIdNamespace.ts.
   */
  const rows = await prisma.sportsPlayer.findMany({
    where: sleeperIdWhere(ids, sport),
    orderBy: { fetchedAt: 'desc' },
    select: { sleeperId: true, source: true, name: true, position: true, team: true, status: true },
  })
  const by = new Map<string, { name: string | null; position: string | null; team: string | null; rosterStatus: string | null }>()
  for (const [sleeperId, r] of indexBySleeperId(rows)) {
    // Only Sleeper's own row carries a ROSTER status; another provider's `status` is its own vocabulary.
    by.set(sleeperId, { name: r.name, position: r.position, team: r.team ?? null, rosterStatus: r.source === 'sleeper' ? r.status ?? null : null })
  }

  /*
   * 🛑 THE INJURY DESIGNATION IS THE INJURY FEED'S, BY VERIFIED NAME + TEAM + POSITION (2026-10-11) —
   * never `SportsPlayer.status` (Sleeper's ROSTER status: "Active" for an Out starter) and never the
   * imported snapshot's status. A roster absence ("Injured Reserve") still counts when no fresh feed
   * fact contradicts it.
   */
  const starterIdsInSlots = starters.slice(0, starterSlots.length).filter(Boolean)
  const designations = await resolveCurrentInjuryDesignations({
    sport,
    players: starterIdsInSlots.map((pid) => {
      const fromSection = readLineupSectionPlayer(lineupSections, pid)
      const fromDb = by.get(pid)
      return {
        key: pid,
        name: fromSection?.name ?? fromDb?.name ?? null,
        team: fromDb?.team ?? fromSection?.team ?? null,
        position: fromSection?.position ?? fromDb?.position ?? null,
        rosterStatus: fromDb?.rosterStatus ?? null,
      }
    }),
  })

  for (let i = 0; i < starterSlots.length && i < starters.length; i++) {
    const pid = starters[i]
    if (!pid) continue
    const slotLabel = starterSlots[i] ?? 'START'
    const fromSection = readLineupSectionPlayer(lineupSections, pid)
    const fromDb = by.get(pid)
    const name = fromSection?.name ?? fromDb?.name ?? null
    const pos = fromSection?.position ?? fromDb?.position ?? null
    const designation = designations.get(pid)?.status ?? null
    const severity = designationSeverity(designation)

    const sectionRow = lineupSections?.starters
    let gameTime: unknown
    if (Array.isArray(sectionRow)) {
      for (const row of sectionRow) {
        if (!row || typeof row !== 'object') continue
        const o = row as Record<string, unknown>
        const id = typeof o.id === 'string' ? o.id : typeof o.player_id === 'string' ? o.player_id : null
        if (id === pid) {
          gameTime = o.gameTime ?? o.game_time
          break
        }
      }
    }
    const lock = parseLockFromGameTime(gameTime)
    const now = Date.now()
    const withinUrgent =
      lock != null && lock.getTime() - now <= thresholds.urgentLockWindowMinutes * 60_000 && lock.getTime() > now - 60_000

    if (!isSleeperPlayerLegalInSlot(slotLabel, pos)) {
      actions.push({
        leagueId,
        leagueName,
        sport,
        platform,
        teamId: null,
        slotIndex: i,
        slotId: `native:${i}`,
        slotLabel,
        playerId: pid,
        playerName: name,
        reasonType: 'illegal_slot',
        urgency: 'urgent',
        lockTime: lock?.toISOString() ?? null,
        recommendedAction: 'Move player to an eligible slot.',
        suggestedReplacementPlayerId: null,
        confidence: null,
        expectedGain: null,
        sourceModule: 'lineup_scan',
        message: `${name ?? 'Player'} is not eligible for ${slotLabel}`,
        severity: 'critical',
      })
      continue
    }

    if (severity === 'unavailable') {
      actions.push({
        leagueId,
        leagueName,
        sport,
        platform,
        teamId: null,
        slotIndex: i,
        slotId: `native:${i}`,
        slotLabel,
        playerId: pid,
        playerName: name,
        reasonType: 'injured_starter',
        urgency: 'urgent',
        lockTime: lock?.toISOString() ?? null,
        recommendedAction: 'Replace inactive starter.',
        suggestedReplacementPlayerId: null,
        confidence: null,
        expectedGain: null,
        sourceModule: 'lineup_scan',
        message: `${name ?? 'Starter'} is not available (${designation})`,
        severity: 'critical',
      })
      continue
    }

    if (severity === 'doubtful' && thresholds.countDoubtfulAsAction) {
      actions.push({
        leagueId,
        leagueName,
        sport,
        platform,
        teamId: null,
        slotIndex: i,
        slotId: `native:${i}`,
        slotLabel,
        playerId: pid,
        playerName: name,
        reasonType: 'doubtful_starter',
        urgency: withinUrgent ? 'urgent' : 'soon',
        lockTime: lock?.toISOString() ?? null,
        recommendedAction: 'Consider a safer starter before lock.',
        suggestedReplacementPlayerId: null,
        confidence: null,
        expectedGain: null,
        sourceModule: 'lineup_scan',
        message: `${name ?? 'Player'} is Doubtful`,
        severity: 'warning',
      })
      continue
    }

    if (severity === 'questionable' && thresholds.countQuestionableAsAction) {
      actions.push({
        leagueId,
        leagueName,
        sport,
        platform,
        teamId: null,
        slotIndex: i,
        slotId: `native:${i}`,
        slotLabel,
        playerId: pid,
        playerName: name,
        reasonType: 'questionable_starter',
        urgency: withinUrgent ? 'soon' : 'normal',
        lockTime: lock?.toISOString() ?? null,
        recommendedAction: 'Monitor injury report.',
        suggestedReplacementPlayerId: null,
        confidence: null,
        expectedGain: null,
        sourceModule: 'lineup_scan',
        message: `${name ?? 'Player'} is Questionable`,
        severity: 'warning',
      })
    }
  }

  return { actions }
}
