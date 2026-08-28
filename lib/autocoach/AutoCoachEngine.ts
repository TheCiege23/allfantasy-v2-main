import 'server-only'

// AutoCoach: AI lineup guardian for AF Pro subscribers.
// Runs PREGAME ONLY — once any game in a slate starts, no swaps are made.
// Does NOT apply to Best Ball leagues.

import type { LeagueSport, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getStarterSlotLabels } from '@/lib/league/rosterSlots'
import {
  buildPlayerDataFromSections,
  getNormalizedLineupSections,
  type RosterSectionKey,
} from '@/lib/roster/LineupTemplateValidation'
import { BESTBALL_VARIANTS, isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { getNotificationsQueue } from '@/lib/queues/bullmq'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { parseAutoCoachUserPreferences } from '@/lib/autocoach/autoCoachPreferences'
import { getPlayerGameLockStateForAutoCoach } from '@/lib/autocoach/playerGameLock'
import { pickBestBenchReplacementForAutoCoach } from '@/lib/autocoach/pickBestBenchReplacement'
import { getServerNowUTC } from '@/lib/time-engine/serverClock'
import type { AutoCoachSwapResult } from '@/lib/autocoach/types'
import { findSportsPlayerByLeagueId, findSportsPlayersByLeagueIds } from '@/lib/player-identity/findSportsPlayerByLeagueId'

export { BESTBALL_VARIANTS, isBestBallLeague }

/** Canonical inactive tokens that trigger AutoCoach (aligned with status intelligence worker). */
export const AUTOCOACH_SWAP_STATUSES = new Set([
  'OUT',
  'IR',
  'INJURED_RESERVE',
  'INACTIVE',
  'SCRATCHED',
  'SCRATCH',
  'DNP',
  'DL',
  'IL',
  'COVID',
  'SUSPENDED',
  'RULED_OUT',
  'INJURED',
  'PUP',
  'NFI',
  'PHYSICALLY_UNABLE_TO_PERFORM',
  'RESERVE',
  'G_LEAGUE',
  'TWO_WAY',
  'BEREAVEMENT',
  'PATERNITY',
  'RESTRICTED',
  '60_DAY_IL',
  '10_DAY_IL',
  'LTIR',
  'SB',
  'NRSE',
  'NOT_ROSTER_ELIGIBLE',
  'DISMISSED',
  'ACADEMIC',
  'RED_CARD_SUSPENSION',
  'INTERNATIONAL_DUTY',
])

/** User-managed / game-time — never auto-swap on these. */
export const AUTOCOACH_UNCERTAIN_STATUSES = new Set([
  'QUESTIONABLE',
  'DOUBTFUL',
  'PROBABLE',
  'GTD',
  'GAME_TIME_DECISION',
  'DAY_TO_DAY',
  'GAME_TIME',
  'GAMETIME',
])

export function normalizeStatusToken(status: string): string {
  return status.toUpperCase().replace(/\s+/g, '_')
}

export function isUncertainStatusForSwap(status: string): boolean {
  const t = normalizeStatusToken(status)
  if (AUTOCOACH_UNCERTAIN_STATUSES.has(t)) return true
  const lower = status.toLowerCase()
  if (
    /questionable|doubtful|probable|game\s*-?\s*time|gtd|day\s*-?\s*to\s*-?\s*day|game\s*time\s*decision/i.test(
      lower
    )
  ) {
    return true
  }
  return false
}

export function isSwapEligibleStatus(status: string): boolean {
  if (!status?.trim()) return false
  if (isUncertainStatusForSwap(status)) return false
  return AUTOCOACH_SWAP_STATUSES.has(normalizeStatusToken(status))
}

function leagueSportToPlayerSport(sport: LeagueSport): string {
  return String(sport)
}

function positionFitsSlot(slotLabel: string, playerPos: string): boolean {
  const slot = slotLabel.replace(/[0-9]/g, '').toUpperCase()
  const p = playerPos.toUpperCase()
  if (slot.includes('SUPER') && slot.includes('FLEX')) {
    return ['QB', 'RB', 'WR', 'TE'].includes(p)
  }
  if (slot === 'FLEX' || slot === 'FLX' || (slot.includes('FLEX') && !slot.includes('SUPER'))) {
    return ['RB', 'WR', 'TE'].includes(p)
  }
  if (slot === 'DST' || slot === 'DEF') return p === 'DEF' || p === 'DST'
  return slot === p
}

async function enqueueSwapNotification(
  userId: string,
  leagueId: string,
  leagueName: string,
  playerOutName: string,
  playerInName: string,
  status: string,
  swapLogId: string
): Promise<void> {
  const queue = getNotificationsQueue()
  if (!queue) return

  try {
    await queue.add(
      'autocoach_swap',
      {
        userIds: [userId],
        category: 'autocoach',
        type: 'autocoach_swap',
        title: '⚡ AI Auto Start/Sit Protection',
        body: `${playerOutName} (${status}) → ${playerInName} · ${leagueName}`,
        severity: 'low',
        actionHref: `/league/${leagueId}?tab=team`,
        actionLabel: 'View lineup',
        meta: { leagueId, swapLogId },
      },
      { removeOnComplete: true }
    )
  } catch (e) {
    console.warn('[AutoCoachEngine] enqueueSwapNotification failed:', e)
  }
}

export async function executeAutoCoachSwap(
  rosterId: string,
  userId: string,
  leagueId: string,
  leagueName: string,
  slotPosition: string,
  playerOut: { id: string; name: string; status: string },
  playerIn: { id: string; name: string; position: string },
  statusSource: string,
  gameStartsAt: Date | null,
  detectedAt: Date,
  decisionMeta?: {
    confidence: number
    expectedPointsDelta: number | null
    decisionNotes: string | null
    statusFreshnessAt: Date | null
    preferenceInfluenced: boolean
    decisionEngine: string
  },
): Promise<AutoCoachSwapResult> {
  const roster = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { playerData: true, leagueId: true },
  })
  if (!roster || roster.leagueId !== leagueId) {
    throw new Error('Roster not found')
  }

  const sections = getNormalizedLineupSections(roster.playerData)
  const si = sections.starters.findIndex((p) => String(p.id) === playerOut.id)
  if (si < 0) {
    throw new Error('Player to remove not in starters')
  }
  const bi = sections.bench.findIndex((p) => String(p.id) === playerIn.id)
  if (bi < 0) {
    throw new Error('Replacement not on bench')
  }

  const next: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: [...sections.starters],
    bench: [...sections.bench],
    ir: [...sections.ir],
    taxi: [...sections.taxi],
    devy: [...sections.devy],
  }

  const outRow = next.starters[si]!
  const inRow = next.bench[bi]!
  next.starters[si] = { ...inRow, position: String(inRow.position ?? playerIn.position) }
  next.bench[bi] = { ...outRow, position: String(outRow.position ?? playerOut.id) }

  const nextPlayerData = buildPlayerDataFromSections(roster.playerData, next)

  const decidedAt = getServerNowUTC()
  const swapLog = await prisma.autoCoachSwapLog.create({
    data: {
      userId,
      leagueId,
      rosterId,
      slotPosition,
      playerOutId: playerOut.id,
      playerOutName: playerOut.name,
      playerOutStatus: playerOut.status,
      playerInId: playerIn.id,
      playerInName: playerIn.name,
      playerInPosition: playerIn.position,
      statusSource,
      statusDetectedAt: detectedAt,
      gameStartsAt,
      wasPreGame: true,
      confidence: decisionMeta?.confidence,
      expectedPointsDelta: decisionMeta?.expectedPointsDelta ?? undefined,
      decisionNotes: decisionMeta?.decisionNotes ?? undefined,
      statusFreshnessAt: decisionMeta?.statusFreshnessAt ?? undefined,
      serverDecidedAt: decidedAt,
      preferenceInfluenced: decisionMeta?.preferenceInfluenced ?? false,
      decisionEngine: decisionMeta?.decisionEngine ?? 'start_sit_projection_v1',
    },
  })

  await prisma.roster.update({
    where: { id: rosterId },
    data: { playerData: nextPlayerData as object },
  })

  await prisma.autoCoachSetting.update({
    where: { userId_leagueId: { userId, leagueId } },
    data: {
      lastSwapAt: new Date(),
      totalSwapsMade: { increment: 1 },
    },
  })

  await enqueueSwapNotification(
    userId,
    leagueId,
    leagueName,
    playerOut.name,
    playerIn.name,
    playerOut.status,
    swapLog.id
  )

  return {
    rosterId,
    userId,
    leagueId,
    slotPosition,
    playerOutId: playerOut.id,
    playerOutName: playerOut.name,
    playerInId: playerIn.id,
    playerInName: playerIn.name,
    swapLogId: swapLog.id,
  }
}

export async function runAutoCoachForLeague(leagueId: string): Promise<AutoCoachSwapResult[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      sport: true,
      season: true,
      settings: true,
      leagueVariant: true,
      bestBallMode: true,
      autoCoachEnabled: true,
      starters: true,
    },
  })

  if (!league) return []

  if (isBestBallLeague(league.leagueVariant, league.bestBallMode)) {
    return []
  }

  if (league.autoCoachEnabled === false) {
    return []
  }

  const sport = leagueSportToPlayerSport(league.sport)

  const settingsRows = await prisma.autoCoachSetting.findMany({
    where: {
      leagueId,
      enabled: true,
      blockedByCommissioner: false,
    },
  })

  const resolver = new EntitlementResolver()
  const results: AutoCoachSwapResult[] = []

  const rosterPositions = Array.isArray(league.starters) ? (league.starters as string[]) : []
  const slotLabels = getStarterSlotLabels(rosterPositions)

  for (const setting of settingsRows) {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: setting.userId },
      select: { autoCoachGlobalEnabled: true, autoCoachPreferences: true },
    })
    if (profile?.autoCoachGlobalEnabled === false) continue

    const prefs = parseAutoCoachUserPreferences(profile?.autoCoachPreferences ?? null)

    const ent = await resolver.resolveForUser(setting.userId, 'pro_autocoach')
    if (!ent.hasAccess) continue

    const rosterFound = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: setting.userId },
      select: { id: true, playerData: true },
    })
    if (!rosterFound) continue
    let workingRoster = rosterFound

    await prisma.autoCoachSetting.update({
      where: { userId_leagueId: { userId: setting.userId, leagueId } },
      data: { lastRunAt: new Date() },
    })

    for (let pass = 0; pass < 16; pass++) {
      const sections = getNormalizedLineupSections(workingRoster.playerData)
      const starters = sections.starters
      const bench = sections.bench
      const starterIds = starters.map((s) => String(s.id))
      if (starterIds.length === 0) break

      /*
       * ⚠ THESE ARE ROSTER IDS, SO THEY ARE SLEEPER IDS, AND THIS DECIDES WHO GETS BENCHED.
       * Matched against `externalId` they hit Rolling Insights rows for other players — 42,032
       * bare ids collide with a Sleeper id and 42,031 are a different person. The row carries
       * `status`, so a collision benched a healthy starter on a stranger's injury. The map is
       * keyed by the roster id, which is what the swap logic below reads it back with.
       */
      const statusById = await findSportsPlayersByLeagueIds(sport, starterIds)

      let swapped = false
      for (let i = 0; i < starters.length; i++) {
        const st = starters[i]!
        const pid = String(st.id)
        const row = statusById.get(pid)
        const rawStatus = row?.status ?? ''
        if (!rawStatus || !isSwapEligibleStatus(rawStatus)) continue

        const lock = await getPlayerGameLockStateForAutoCoach({
          sport,
          teamAbbr: row?.team,
          leagueSeason: league.season,
          leagueSettings: league.settings,
        })
        if (lock.lockedBecauseGameStarted) continue

        const slotPos = slotLabels[i] ?? String(st.position ?? 'FLEX')

        const benchCandidates = bench.filter((b) => {
          const bid = String(b.id)
          if (starterIds.includes(bid)) return false
          const pos = String(b.position ?? '')
          if (!positionFitsSlot(slotPos, pos)) return false
          return true
        })

        const eligibleBench: { id: string; name: string; position: string }[] = []
        for (const b of benchCandidates) {
          const bid = String(b.id)
          // Same Sleeper-id hazard as the starter read above: a collision here would call a
          // healthy bench player unavailable and skip him as a replacement.
          const pRow = await findSportsPlayerByLeagueId(sport, bid)
          const stB = pRow?.status ?? ''
          if (stB && isSwapEligibleStatus(stB)) continue

          eligibleBench.push({
            id: bid,
            name: pRow?.name ?? String(b.id),
            position: String(pRow?.position ?? b.position ?? 'UNK'),
          })
        }

        if (eligibleBench.length === 0) continue

        const ranked = await pickBestBenchReplacementForAutoCoach({
          userId: setting.userId,
          leagueId,
          sport,
          playerOut: {
            id: pid,
            name: row?.name ?? pid,
            position: String(row?.position ?? st.position ?? 'UNK'),
          },
          benchCandidates: eligibleBench,
        })

        const pick = ranked.pick
        if (!pick) continue

        const swap = await executeAutoCoachSwap(
          workingRoster.id,
          setting.userId,
          leagueId,
          league.name ?? 'League',
          slotPos,
          { id: pid, name: row?.name ?? pid, status: rawStatus },
          { id: pick.id, name: pick.name, position: pick.position },
          'sports_player_db',
          lock.nextKickoffUtc,
          row?.updatedAt ?? new Date(),
          {
            confidence: ranked.confidence,
            expectedPointsDelta: ranked.expectedPointsDelta,
            decisionNotes: [
              ranked.decisionNotes,
              lock.scheduleKnown ? `lock:${lock.reason}` : 'lock:schedule_missing_used_status_only',
            ]
              .filter(Boolean)
              .join(' · '),
            statusFreshnessAt: row?.updatedAt ?? null,
            preferenceInfluenced: Boolean(prefs.learnTendencies),
            decisionEngine: 'start_sit_projection_v1',
          },
        )
        results.push(swap)
        swapped = true

        const fresh: { id: string; playerData: Prisma.JsonValue } | null = await prisma.roster.findUnique({
          where: { id: workingRoster.id },
          select: { id: true, playerData: true },
        })
        if (fresh) workingRoster = fresh
        break
      }
      if (!swapped) break
    }
  }

  return results
}
