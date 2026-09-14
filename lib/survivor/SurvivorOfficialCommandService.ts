import { prisma } from '@/lib/prisma'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { resolvePlayerNamesForSport, normalizePlayerLookupToken } from '@/lib/roster/resolvePlayerNames'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'
import { getCouncil } from './SurvivorTribalCouncilService'
import { parseSurvivorCommand, looksLikeOfficialCommand } from './SurvivorCommandParser'
import { applyIdolPower, getActiveIdolsForRoster } from './SurvivorIdolRegistry'
import { resolveSurvivorCurrentWeek } from './SurvivorTimelineResolver'
import { submitVote as submitCouncilVote } from './survivorVoteService'
import { submitChallengeAnswer, getCurrentOpenChallengesForWeek, getChallengeById } from './SurvivorChallengeEngine'
import { getFinaleState, submitJuryVote } from './SurvivorFinaleEngine'
import { getTribeForRoster } from './SurvivorTribeService'
import { getMinigameDef } from './SurvivorMiniGameRegistry'
import { parseTribeIdFromSource } from './constants'
import { isSurvivorLeague } from './SurvivorLeagueConfig'
import {
  applySurvivorSitOutToMiniGames,
  getEligibleSitOutCandidates,
  nominateSurvivorSitOut,
} from './SurvivorSitOutEngine'
import type { SurvivorChallengeType } from './types'

interface SurvivorRosterDisplayContext {
  rosterDisplayNames: Record<string, string>
  rosterAliasLookup: Record<string, string>
  /** rosterId → the manager's app user id (Roster.platformUserId). */
  rosterUserIds: Record<string, string>
}

export interface SurvivorOfficialCommandInput {
  leagueId: string
  userId: string
  command: string
  source?: string | null
  councilId?: string | null
  challengeId?: string | null
  week?: number | null
}

export interface SurvivorOfficialCommandResult {
  handled: boolean
  ok: boolean
  status?: number
  intent?: string
  message?: string
  error?: string
}

function normalizeRequestedWeek(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.floor(value))
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, parsed)
    }
  }
  return null
}

function addAlias(lookup: Record<string, string>, alias: string | null | undefined, rosterId: string): void {
  const normalized = normalizePlayerLookupToken(alias)
  if (!normalized || lookup[normalized]) return
  lookup[normalized] = rosterId
}

async function buildRosterDisplayContext(leagueId: string): Promise<SurvivorRosterDisplayContext> {
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true },
  })
  if (rosters.length === 0) {
    return { rosterDisplayNames: {}, rosterAliasLookup: {}, rosterUserIds: {} }
  }

  const map = await getRosterTeamMap(leagueId)
  const teamIds = [...new Set(rosters.map((roster) => map.rosterIdToTeamId.get(roster.id)).filter((teamId): teamId is string => Boolean(teamId)))]
  const teams = teamIds.length
    ? await prisma.leagueTeam.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, teamName: true, ownerName: true },
      })
    : []
  const users = await prisma.appUser.findMany({
    where: { id: { in: [...new Set(rosters.map((roster) => roster.platformUserId).filter(Boolean))] } },
    select: { id: true, username: true, displayName: true },
  })

  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]))
  const userById = Object.fromEntries(users.map((user) => [user.id, user]))
  const rosterDisplayNames: Record<string, string> = {}
  const rosterAliasLookup: Record<string, string> = {}
  const rosterUserIds: Record<string, string> = {}
  for (const roster of rosters) {
    if (roster.platformUserId) rosterUserIds[roster.id] = roster.platformUserId
    const teamId = map.rosterIdToTeamId.get(roster.id)
    const team = teamId ? teamById[teamId] : null
    const user = roster.platformUserId ? userById[roster.platformUserId] : null
    const primaryName =
      team?.teamName?.trim() ||
      team?.ownerName?.trim() ||
      user?.displayName?.trim() ||
      user?.username?.trim() ||
      roster.id

    rosterDisplayNames[roster.id] = primaryName
    addAlias(rosterAliasLookup, primaryName, roster.id)
    addAlias(rosterAliasLookup, team?.ownerName, roster.id)
    addAlias(rosterAliasLookup, user?.displayName, roster.id)
    addAlias(rosterAliasLookup, user?.username, roster.id)
    addAlias(rosterAliasLookup, roster.id, roster.id)
  }

  return { rosterDisplayNames, rosterAliasLookup, rosterUserIds }
}

function resolveRosterIdFromDisplayName(
  displayName: string | null | undefined,
  rosterContext: SurvivorRosterDisplayContext
): string | null {
  const normalized = normalizePlayerLookupToken(displayName)
  if (!normalized) return null
  return rosterContext.rosterAliasLookup[normalized] ?? null
}

function extractPlayerAliasesFromPlayerData(playerData: unknown): Array<{ playerId: string; label: string }> {
  const aliases: Array<{ playerId: string; label: string }> = []
  const buckets = Array.isArray(playerData)
    ? [playerData]
    : playerData && typeof playerData === 'object'
      ? [((playerData as Record<string, unknown>).players ?? []) as unknown[], ((playerData as Record<string, unknown>).roster ?? []) as unknown[]]
      : []

  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const playerEntry = entry as Record<string, unknown>
      const playerId =
        typeof playerEntry.id === 'string'
          ? playerEntry.id
          : typeof playerEntry.player_id === 'string'
            ? playerEntry.player_id
            : null
      const label =
        typeof playerEntry.fullName === 'string'
          ? playerEntry.fullName
          : typeof playerEntry.full_name === 'string'
            ? playerEntry.full_name
            : typeof playerEntry.playerName === 'string'
              ? playerEntry.playerName
              : typeof playerEntry.name === 'string'
                ? playerEntry.name
                : null
      if (playerId && label?.trim()) {
        aliases.push({ playerId, label: label.trim() })
      }
    }
  }

  return aliases
}

function getRosterPlayerIdsForLookup(playerData: unknown): string[] {
  const fromPlayers = getRosterPlayerIds(playerData)
  if (fromPlayers.length > 0) return dedupePlayerIds(fromPlayers)

  if (playerData && typeof playerData === 'object' && !Array.isArray(playerData)) {
    const rawRoster = (playerData as Record<string, unknown>).roster
    if (Array.isArray(rawRoster)) {
      return dedupePlayerIds(
        rawRoster.map((entry) => {
          if (typeof entry === 'string') return entry
          if (entry && typeof entry === 'object') {
            const playerEntry = entry as Record<string, unknown>
            return typeof playerEntry.id === 'string'
              ? playerEntry.id
              : typeof playerEntry.player_id === 'string'
                ? playerEntry.player_id
                : ''
          }
          return ''
        })
      )
    }
  }

  return []
}

async function buildRosterPlayerLookup(
  leagueId: string,
  rosterIds: string[]
): Promise<{
  playerNameMap: Map<string, string>
  rosterPlayerLookup: Record<string, Record<string, string>>
}> {
  const uniqueRosterIds = [...new Set(rosterIds.filter(Boolean))]
  if (uniqueRosterIds.length === 0) {
    return { playerNameMap: new Map(), rosterPlayerLookup: {} }
  }

  const [league, rosters] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true },
    }),
    prisma.roster.findMany({
      where: { leagueId, id: { in: uniqueRosterIds } },
      select: { id: true, playerData: true },
    }),
  ])

  const playerIds = dedupePlayerIds(rosters.flatMap((roster) => getRosterPlayerIdsForLookup(roster.playerData)))
  const playerNameMap = await resolvePlayerNamesForSport(playerIds, league?.sport ?? 'NFL')
  const rosterPlayerLookup: Record<string, Record<string, string>> = {}

  for (const roster of rosters) {
    const lookup: Record<string, string> = {}
    const rosterPlayerIds = getRosterPlayerIdsForLookup(roster.playerData)
    for (const playerId of rosterPlayerIds) {
      const resolvedName = playerNameMap.get(playerId) ?? playerId
      addAlias(lookup, resolvedName, playerId)
      addAlias(lookup, playerId, playerId)
    }
    for (const alias of extractPlayerAliasesFromPlayerData(roster.playerData)) {
      addAlias(lookup, alias.label, alias.playerId)
    }
    rosterPlayerLookup[roster.id] = lookup
  }

  return { playerNameMap, rosterPlayerLookup }
}

function dedupePlayerIds(playerIds: string[]): string[] {
  return [...new Set(playerIds.map((playerId) => playerId?.trim()).filter((playerId): playerId is string => Boolean(playerId)))]
}

function resolvePlayerIdFromDisplayName(
  displayName: string | null | undefined,
  playerLookup: Record<string, string>
): string | null {
  const normalized = normalizePlayerLookupToken(displayName)
  if (!normalized) return null
  if (playerLookup[normalized]) return playerLookup[normalized]

  const fuzzyMatches = [...new Set(
    Object.entries(playerLookup)
      .filter(([alias]) => alias.includes(normalized) || normalized.includes(alias))
      .map(([, playerId]) => playerId)
  )]
  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null
}

function isChallengeLocked(lockAt: Date | null): boolean {
  return Boolean(lockAt && new Date() >= lockAt)
}

export async function processSurvivorOfficialCommand(
  input: SurvivorOfficialCommandInput
): Promise<SurvivorOfficialCommandResult> {
  const { leagueId, userId, source } = input
  const rawCommand = input.command.trim()
  if (!rawCommand) {
    return { handled: false, ok: false }
  }

  const survivorLeague = await isSurvivorLeague(leagueId)
  if (!survivorLeague) {
    return { handled: false, ok: false }
  }

  if (!looksLikeOfficialCommand(rawCommand)) {
    return { handled: false, ok: false }
  }

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!myRosterId) {
    return { handled: true, ok: false, status: 403, error: 'You have no roster in this league' }
  }

  const parsed = parseSurvivorCommand(rawCommand)
  if (parsed.intent === 'unknown') {
    return {
      handled: true,
      ok: false,
      status: 400,
      error: 'Unknown command. Use @Chimmy vote [manager], @Chimmy jury vote [finalist], @Chimmy play idol [idol], @Chimmy sit out [manager], @Chimmy play idol steal_player on [manager] pick [player], @Chimmy play idol swap_starter swap [bench] for [starter], @Chimmy submit challenge [choice], or @Chimmy confirm tribe decision [choice].',
    }
  }

  const requestedWeek = normalizeRequestedWeek(input.week)
  const week = await resolveSurvivorCurrentWeek(leagueId, requestedWeek)

  if (parsed.intent === 'sit_out_nominate') {
    const sourceTribeId = parseTribeIdFromSource(source ?? null)
    if (!sourceTribeId) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: 'Sit-out nominations must be submitted from your tribe chat.',
      }
    }

    const myTribe = await getTribeForRoster(leagueId, myRosterId)
    if (!myTribe || myTribe.id !== sourceTribeId) {
      return {
        handled: true,
        ok: false,
        status: 403,
        error: 'You can only nominate a sit-out from your own tribe chat.',
      }
    }

    const rosterContext = await buildRosterDisplayContext(leagueId)
    const targetRosterId = resolveRosterIdFromDisplayName(parsed.targetDisplayName, rosterContext)
    if (!targetRosterId) {
      const eligibleCandidates = await getEligibleSitOutCandidates(leagueId, myTribe.id, week)
      const eligibleList = eligibleCandidates.map((candidate) => candidate.displayName).join(', ')
      return {
        handled: true,
        ok: false,
        status: 400,
        error: eligibleList
          ? `Could not find manager: ${parsed.targetDisplayName ?? 'Unknown manager'}. Eligible right now: ${eligibleList}.`
          : `Could not find manager: ${parsed.targetDisplayName ?? 'Unknown manager'}. No eligible sit-out candidates right now.`,
      }
    }

    const nomination = await nominateSurvivorSitOut({
      leagueId,
      week,
      nominatorUserId: userId,
      nominatorRosterId: myRosterId,
      tribeId: myTribe.id,
      nominatedRosterId: targetRosterId,
      command: rawCommand,
    })
    if (!nomination.ok) {
      const eligibleList = nomination.eligibleCandidates?.map((candidate) => candidate.displayName).join(', ')
      return {
        handled: true,
        ok: false,
        status: 400,
        error: eligibleList ? `${nomination.error} Eligible right now: ${eligibleList}.` : nomination.error,
      }
    }

    return {
      handled: true,
      ok: true,
      status: 200,
      intent: parsed.intent,
      message: `${nomination.nominatedDisplayName} was nominated to sit out. This only becomes official if they click Yes.`,
    }
  }

  if (parsed.intent === 'jury_vote') {
    const [rosterContext, finaleState] = await Promise.all([
      buildRosterDisplayContext(leagueId),
      getFinaleState(leagueId, week),
    ])
    if (!finaleState.open) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: finaleState.closed ? 'The Survivor winner has already been crowned' : 'Final jury voting is not open right now',
      }
    }

    const targetRosterId = resolveRosterIdFromDisplayName(parsed.targetDisplayName, rosterContext)
    if (!targetRosterId) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: `Could not find finalist: ${parsed.targetDisplayName ?? 'Unknown finalist'}`,
      }
    }

    if (!finaleState.finalists.includes(targetRosterId)) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: `${rosterContext.rosterDisplayNames[targetRosterId] ?? targetRosterId} is not an eligible finalist right now`,
      }
    }

    const result = await submitJuryVote({
      leagueId,
      jurorRosterId: myRosterId,
      finalistRosterId: targetRosterId,
      week,
      source: source ?? null,
      command: rawCommand,
    })
    if (!result.ok) {
      return { handled: true, ok: false, status: 400, error: result.error ?? 'Final jury vote failed' }
    }

    const crownedWinnerId = result.state?.winnerRosterId ?? null
    const crownedMessage = crownedWinnerId
      ? ` ${rosterContext.rosterDisplayNames[crownedWinnerId] ?? crownedWinnerId} has been crowned the Survivor winner.`
      : ''

    return {
      handled: true,
      ok: true,
      status: 200,
      intent: parsed.intent,
      message: `Final jury vote recorded for ${rosterContext.rosterDisplayNames[targetRosterId] ?? targetRosterId}.${crownedMessage}`,
    }
  }

  if (parsed.intent === 'vote') {
    // The same ballot service as the Tribal Council panel's "Submit vote" (survivorVoteService). It
    // records the voter and target user ids and the target's name (what the panel's "You voted" line
    // reads), enforces the league's vote-change policy and late-vote rules, and writes the private
    // audit entry. It votes in the league's active council.
    const rosterContext = await buildRosterDisplayContext(leagueId)
    const targetRosterId = resolveRosterIdFromDisplayName(parsed.targetDisplayName, rosterContext)
    const targetUserId = targetRosterId ? rosterContext.rosterUserIds[targetRosterId] : undefined
    if (!targetRosterId || !targetUserId) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: `Could not find manager: ${parsed.targetDisplayName ?? 'Unknown manager'}`,
      }
    }

    const result = await submitCouncilVote(leagueId, userId, targetUserId)
    if (!result.ok) {
      return { handled: true, ok: false, status: result.status, error: result.error }
    }

    const targetName = result.targetName ?? rosterContext.rosterDisplayNames[targetRosterId] ?? targetRosterId
    return {
      handled: true,
      ok: true,
      status: 200,
      intent: parsed.intent,
      message: `Vote recorded for ${targetName}. ${result.message}`,
    }
  }

  if (parsed.intent === 'play_idol') {
    const councilId = input.councilId ?? (await getCouncil(leagueId, week))?.id ?? null
    const activeIdols = await getActiveIdolsForRoster(leagueId, myRosterId)
    const hint = parsed.idolId?.trim().toLowerCase()
    const idol = hint
      ? activeIdols.find((item) => item.id.toLowerCase() === hint || item.powerType.toLowerCase() === hint)
      : activeIdols[0]
    if (!idol) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: 'No eligible idol found. Specify idol id or power type, e.g. @Chimmy play idol protect_self',
        }
    }

    const rosterContext = parsed.targetDisplayName ? await buildRosterDisplayContext(leagueId) : null
    const targetRosterId = parsed.targetDisplayName
      ? resolveRosterIdFromDisplayName(parsed.targetDisplayName, rosterContext ?? { rosterDisplayNames: {}, rosterAliasLookup: {}, rosterUserIds: {} })
      : null
    if (parsed.targetDisplayName && !targetRosterId) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: `Could not find manager: ${parsed.targetDisplayName}`,
      }
    }
    if (idol.powerType === 'vote_nullifier' && !targetRosterId) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: 'Specify whose vote to nullify, e.g. @Chimmy play idol vote_nullifier on Team Alpha',
      }
    }
    if (idol.powerType === 'freeze_waivers' && !targetRosterId) {
      return {
        handled: true,
        ok: false,
        status: 400,
        error: 'Specify whose waivers to freeze, e.g. @Chimmy play idol freeze_waivers on Team Alpha',
      }
    }

    const idolContext: Record<string, unknown> = {
      councilId,
      week,
      source: source ?? null,
      command: rawCommand,
    }
    const affectedRosterId = targetRosterId ?? myRosterId

    if (idol.powerType === 'steal_player') {
      if (!targetRosterId) {
        return {
          handled: true,
          ok: false,
          status: 400,
          error: 'Specify whose player to steal, e.g. @Chimmy play idol steal_player on Team Alpha pick Saquon Barkley',
        }
      }
      if (!parsed.playerDisplayName) {
        return {
          handled: true,
          ok: false,
          status: 400,
          error: 'Specify which player to steal, e.g. @Chimmy play idol steal_player on Team Alpha pick Saquon Barkley',
        }
      }

      const { playerNameMap, rosterPlayerLookup } = await buildRosterPlayerLookup(leagueId, [myRosterId, targetRosterId])
      const stolenPlayerId = resolvePlayerIdFromDisplayName(parsed.playerDisplayName, rosterPlayerLookup[targetRosterId] ?? {})
      if (!stolenPlayerId) {
        return {
          handled: true,
          ok: false,
          status: 400,
          error: `Could not find player on ${rosterContext?.rosterDisplayNames[targetRosterId] ?? targetRosterId}: ${parsed.playerDisplayName}`,
        }
      }
      idolContext.targetRosterId = targetRosterId
      idolContext.playerId = stolenPlayerId
      idolContext.playerDisplayName = playerNameMap.get(stolenPlayerId) ?? parsed.playerDisplayName
    } else if (idol.powerType === 'swap_starter') {
      if (!parsed.playerDisplayName || !parsed.secondaryPlayerDisplayName) {
        return {
          handled: true,
          ok: false,
          status: 400,
          error: 'Specify both players to swap, e.g. @Chimmy play idol swap_starter swap Deebo Samuel for Amon-Ra St. Brown',
        }
      }

      const { playerNameMap, rosterPlayerLookup } = await buildRosterPlayerLookup(leagueId, [affectedRosterId])
      const playerLookup = rosterPlayerLookup[affectedRosterId] ?? {}
      const benchPlayerId = resolvePlayerIdFromDisplayName(parsed.playerDisplayName, playerLookup)
      if (!benchPlayerId) {
        return {
          handled: true,
          ok: false,
          status: 400,
          error: `Could not find bench player on ${(rosterContext?.rosterDisplayNames[affectedRosterId] ?? affectedRosterId)}: ${parsed.playerDisplayName}`,
        }
      }
      const starterPlayerId = resolvePlayerIdFromDisplayName(parsed.secondaryPlayerDisplayName, playerLookup)
      if (!starterPlayerId) {
        return {
          handled: true,
          ok: false,
          status: 400,
          error: `Could not find starter on ${(rosterContext?.rosterDisplayNames[affectedRosterId] ?? affectedRosterId)}: ${parsed.secondaryPlayerDisplayName}`,
        }
      }
      idolContext.targetRosterId = affectedRosterId
      idolContext.benchPlayerId = benchPlayerId
      idolContext.starterPlayerId = starterPlayerId
      idolContext.benchPlayerDisplayName = playerNameMap.get(benchPlayerId) ?? parsed.playerDisplayName
      idolContext.starterPlayerDisplayName = playerNameMap.get(starterPlayerId) ?? parsed.secondaryPlayerDisplayName
    } else if (idol.powerType === 'protect_self' || idol.powerType === 'protect_self_plus_one') {
      idolContext.protectedRosterId = targetRosterId ?? myRosterId
    } else if (idol.powerType === 'vote_nullifier' && targetRosterId) {
      idolContext.nullifiedVoterRosterId = targetRosterId
    } else if (targetRosterId) {
      idolContext.targetRosterId = targetRosterId
    }

    const result = await applyIdolPower(leagueId, idol.id, myRosterId, idolContext)
    if (!result.ok) {
      return { handled: true, ok: false, status: 400, error: result.error ?? 'Idol play failed' }
    }

    return {
      handled: true,
      ok: true,
      status: 200,
      intent: parsed.intent,
      message:
        idol.powerType === 'steal_player'
          ? `Idol played: stole ${String(idolContext.playerDisplayName ?? 'that player')} from ${rosterContext?.rosterDisplayNames[targetRosterId ?? ''] ?? targetRosterId ?? 'that manager'}.`
          : idol.powerType === 'swap_starter'
            ? `Idol played: swapped ${String(idolContext.benchPlayerDisplayName ?? 'your bench player')} in for ${String(idolContext.starterPlayerDisplayName ?? 'your starter')}.`
            : `Idol played: ${idol.powerType.replace(/_/g, ' ')}.`,
    }
  }

  if (parsed.intent === 'challenge_pick' || parsed.intent === 'confirm_minigame') {
    const challenge =
      (input.challengeId ? await getChallengeById(input.challengeId) : null) ??
      (await getCurrentOpenChallengesForWeek(leagueId, week)).find((candidate) => {
        const definition = getMinigameDef(candidate.challengeType as SurvivorChallengeType)
        if (!definition) return true
        if (parsed.intent === 'confirm_minigame') {
          return definition.submissionScope === 'tribe' || definition.submissionScope === 'both'
        }
        return true
      }) ??
      null

    if (!challenge) {
      return { handled: true, ok: false, status: 400, error: 'No open Survivor challenge is available right now' }
    }
    if (challenge.leagueId !== leagueId) {
      return { handled: true, ok: false, status: 400, error: 'Challenge does not belong to this Survivor league' }
    }
    if (isChallengeLocked(challenge.lockAt)) {
      return { handled: true, ok: false, status: 400, error: 'This challenge is locked' }
    }

    const definition = getMinigameDef(challenge.challengeType as SurvivorChallengeType)
    const myTribe = await getTribeForRoster(leagueId, myRosterId)
    const sourceTribeId = parseTribeIdFromSource(source ?? null)
    const choice = String(parsed.payload?.pick ?? parsed.payload?.choice ?? '').trim()
    if (!choice) {
      return { handled: true, ok: false, status: 400, error: 'Challenge choice is required' }
    }

    let rosterId: string | null = myRosterId
    let tribeId: string | null = null

    if (definition?.submissionScope === 'tribe' || (parsed.intent === 'confirm_minigame' && myTribe)) {
      if (!myTribe) {
        return { handled: true, ok: false, status: 400, error: 'You are not in an active tribe for this challenge' }
      }
      if (!sourceTribeId || sourceTribeId !== myTribe.id) {
        return { handled: true, ok: false, status: 400, error: 'Tribe decisions must be submitted from your tribe chat' }
      }
      rosterId = null
      tribeId = myTribe.id
    } else if (definition?.submissionScope === 'both' && sourceTribeId && myTribe && sourceTribeId === myTribe.id) {
      rosterId = null
      tribeId = myTribe.id
    }

    const miniGameGuard = await applySurvivorSitOutToMiniGames({
      leagueId,
      week,
      rosterId: myRosterId,
    })
    if (miniGameGuard.blocked) {
      return {
        handled: true,
        ok: false,
        status: 403,
        error: `${miniGameGuard.reason ?? 'Sit-out is active for this week.'} Eligibility reason: sit-out accepted and locked.`,
      }
    }

    const result = await submitChallengeAnswer(challenge.id, rosterId, tribeId, {
      pick: choice,
      confirmed: parsed.intent === 'confirm_minigame',
      source: source ?? null,
      submittedByRosterId: myRosterId,
    })
    if (!result.ok) {
      return { handled: true, ok: false, status: 400, error: result.error ?? 'Challenge submission failed' }
    }

    return {
      handled: true,
      ok: true,
      status: 200,
      intent: parsed.intent,
      message: tribeId
        ? `Tribe decision recorded for ${challenge.challengeType.replace(/_/g, ' ')}.`
        : `Challenge submission recorded for ${challenge.challengeType.replace(/_/g, ' ')}.`,
    }
  }

  return { handled: true, ok: false, status: 400, error: 'Command not implemented for this context' }
}
