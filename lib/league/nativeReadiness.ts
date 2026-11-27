import type { Prisma } from '@prisma/client'
import { importedPlatformLabel, isNativePlatform } from '@/lib/dashboard/platform-label'
import { readImportedPlayerMetadata } from '@/lib/league-import/importedPlayerMetadata'
import { planImportedRosterLayout, savedInAllFantasy, sportScoringStore } from '@/lib/league/nativeScaffolding'
import {
  asRecord,
  checkImportedSource,
  ImportedLeagueCarryoverError,
  importedOwnedPlayerIds,
  matchImportedRoster,
  readImportedSource,
  translateImportedPlayerIds,
  type ImportedRoster,
} from '@/lib/league-creation/canonical/importedIdentityPlan'

/**
 * Could this imported league switch to running on AllFantasy, and if not, what is in the way?
 *
 * The read-only half of the in-place switchover (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md
 * §7 step 1 and §9 gap 3). It runs the same checks the switch will refuse on, through the same planner
 * the copy flow uses (`importedIdentityPlan.ts`), and it writes nothing — so a commissioner can see in
 * July what would block them in March, before any write path exists.
 *
 * ⚠ IT LISTS EVERY PROBLEM, NOT THE FIRST. The planner refuses on the first thing wrong, which is right
 * for a write and useless for a checklist: fix one, recheck, find the next. So each check here runs on
 * its own and catches the planner's refusal, and player translation uses the non-throwing
 * `translateImportedPlayerIds`.
 *
 * ⚠ A READY REPORT IS NOT A PROMISE. The switch re-runs these checks inside its transaction against
 * locked rows; a sync can change a roster between this read and that one.
 */

type Db = Prisma.TransactionClient

export type NativeReadinessCode =
  | 'duplicate_copies'
  | 'provider_draft_live'
  | 'season_in_progress'
  | 'source_unsupported'
  | 'scoring_unconvertible'
  | 'team_without_roster'
  | 'shared_roster'
  | 'lineup_player_missing'
  | 'duplicate_ownership'
  | 'unmatched_players'
  | 'ambiguous_players'
  | 'unmapped_future_picks'
  | 'stale_sync'
  | 'roster_unreadable'
  | 'scoring_not_carried'
  | 'scoring_inexact'

export type NativeReadinessItem = {
  code: NativeReadinessCode
  /** A blocker stops the switch; a heads-up does not. */
  severity: 'blocker' | 'heads_up'
  title: string
  /** What the commissioner should do — or that there is nothing for them to do yet. */
  action: string
  /** Who or what it is about: team names, player names. Capped; `more` counts the rest. */
  names?: string[]
  more?: number
}

export type NativeReadinessReport = {
  leagueId: string
  status: 'native' | 'ready' | 'blocked'
  /** "Sleeper", "ESPN"… null for a native league. */
  platformLabel: string | null
  items: NativeReadinessItem[]
  teamCount: number
  playerCount: number
  checkedAt: string
}

const NAME_CAP = 8
const STALE_SYNC_MS = 24 * 60 * 60 * 1000
/** Provider draft statuses the Sleeper mirror still rewrites (lib/draft/mirrorActiveSleeperDrafts.ts). */
const LIVE_DRAFT_STATUSES = ['in_progress', 'paused']
const IN_SEASON = new Set(['in_season', 'playoffs'])

function capped(names: string[]): Pick<NativeReadinessItem, 'names' | 'more'> {
  const unique = [...new Set(names)]
  return unique.length > NAME_CAP ? { names: unique.slice(0, NAME_CAP), more: unique.length - NAME_CAP } : { names: unique }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The name the provider gave a player, when the import kept it; otherwise the bare id. */
function playerLabel(id: string, rosters: ImportedRoster[], platform: string): string {
  for (const roster of rosters) {
    const meta = readImportedPlayerMetadata(roster.playerData, platform, id)
    if (meta?.name) return meta.name
    const players = asRecord(roster.playerData).players
    if (Array.isArray(players)) {
      for (const row of players) {
        const obj = asRecord(row)
        const name = obj.name ?? obj.full_name ?? obj.playerName
        if (String(obj.id ?? obj.player_id ?? '') === id && typeof name === 'string' && name.trim()) return name.trim()
      }
    }
  }
  return `Player ${id}`
}

function refusalMessage(error: unknown): string | null {
  return error instanceof ImportedLeagueCarryoverError ? error.message : null
}

export async function checkNativeReadiness(db: Db, leagueId: string, now: Date = new Date()): Promise<NativeReadinessReport | null> {
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, platformLeagueId: true, season: true, sport: true, status: true, lifecycleState: true, lastSyncedAt: true, leagueType: true, settings: true, taxiSlots: true, irSlots: true },
  })
  if (!league) return null
  const checkedAt = now.toISOString()
  if (isNativePlatform(league.platform)) {
    return { leagueId, status: 'native', platformLabel: null, items: [], teamCount: 0, playerCount: 0, checkedAt }
  }
  const platform = String(league.platform)
  const label = importedPlatformLabel(platform) ?? platform
  const sport = String(league.sport)
  const items: NativeReadinessItem[] = []

  const [read, otherCopies, liveDraft, futurePicks] = await Promise.all([
    readImportedSource(db, leagueId),
    db.league.count({
      where: { id: { not: leagueId }, platform: league.platform, platformLeagueId: league.platformLeagueId, season: league.season },
    }),
    db.draftSession.findFirst({
      where: { leagueId, sleeperDraftId: { not: null }, status: { in: LIVE_DRAFT_STATUSES } },
      select: { id: true },
    }),
    db.futureDraftPick.findMany({
      where: { leagueId, status: 'active' },
      select: { originalRosterId: true, currentOwnerId: true },
    }),
  ])
  const { teams, rosters } = read

  if (otherCopies > 0) {
    items.push({
      code: 'duplicate_copies', severity: 'blocker',
      title: `${plural(otherCopies, 'other copy', 'other copies')} of this league ${otherCopies === 1 ? 'is' : 'are'} on AllFantasy`,
      action: 'Other members imported the same league on their own. Ask AllFantasy support to merge the copies into this one.',
    })
  }
  if (liveDraft) {
    items.push({
      code: 'provider_draft_live', severity: 'blocker',
      title: `Your ${label} draft is still running`,
      action: `Finish the draft on ${label} first.`,
    })
  }
  const lifecycle = String(league.lifecycleState ?? '').toLowerCase()
  const status = String(league.status ?? '').toLowerCase()
  if (status !== 'complete' && (IN_SEASON.has(lifecycle) || IN_SEASON.has(status))) {
    items.push({
      code: 'season_in_progress', severity: 'blocker',
      title: 'The season is still being played',
      action: `Switch in the offseason, once your last game on ${label} is final.`,
    })
  }

  let sourceCheck: ReturnType<typeof checkImportedSource> | null = null
  try {
    sourceCheck = checkImportedSource(read.source, { sport, acceptWeeklyLineups: true })
  } catch (error) {
    const message = refusalMessage(error)
    if (!message) throw error
    items.push(/sport must match/.test(message)
      ? { code: 'source_unsupported', severity: 'blocker', title: `${label} ${sport} leagues can't switch yet`, action: 'Nothing to do yet. AllFantasy has to add support for this league type first.' }
      : { code: 'scoring_unconvertible', severity: 'blocker', title: "Your scoring rules can't be copied exactly", action: message })
  }

  // Native settings the switch writes (nativeScaffolding.ts). A roster layout AllFantasy cannot place would leave the
  // league on default slots the moment it switches, so it blocks — and saving a layout in AllFantasy unblocks it.
  const roster = planImportedRosterLayout({ sport, platform, leagueType: league.leagueType, settings: league.settings, taxiSlots: league.taxiSlots, irSlots: league.irSlots })
  if (roster.kind === 'unreadable') {
    items.push({
      code: 'roster_unreadable', severity: 'blocker',
      title: `We can't read your roster spots from ${label}`,
      action: `Set your roster spots in Settings → Roster, then check again. ${roster.reason}`,
    })
  }
  if (sourceCheck && !savedInAllFantasy(sportScoringStore(league.settings, sport))) {
    const carried = sport === 'NFL' ? sourceCheck.nflScoring : sport === 'MLB' ? sourceCheck.mlbScoring : null
    if (!carried) {
      items.push({
        code: 'scoring_not_carried', severity: 'heads_up',
        title: `Your ${label} scoring rules won't carry over`,
        action: `The league will use AllFantasy's standard ${sport} scoring. Set your own in Settings → Scoring, before or after switching.`,
      })
    } else if (sport === 'NFL' && sourceCheck.nflScoring && (sourceCheck.nflScoring.notScored.length || sourceCheck.nflScoring.approximated.length)) {
      const nfl = sourceCheck.nflScoring
      items.push({
        code: 'scoring_inexact', severity: 'heads_up',
        title: `${plural(nfl.notScored.length + nfl.approximated.length, 'scoring rule')} won't match ${label} exactly`,
        action: 'Review them in Settings → Scoring after switching.',
        ...capped([...nfl.notScored, ...nfl.approximated].map(String)),
      })
    }
  }

  // Rosters, one team at a time, so every team that fails is named rather than only the first.
  const unmatchedTeams: string[] = []
  const matched: Array<{ teamName: string; roster: ImportedRoster }> = []
  for (const team of teams) {
    try {
      matched.push({ teamName: team.teamName, roster: matchImportedRoster(team, rosters) })
    } catch (error) {
      if (!refusalMessage(error)) throw error
      unmatchedTeams.push(team.teamName)
    }
  }
  if (unmatchedTeams.length) {
    items.push({ code: 'team_without_roster', severity: 'blocker', title: `We can't find the roster for ${plural(unmatchedTeams.length, 'team')}`, action: `Refresh the import from ${label}, then check again.`, ...capped(unmatchedTeams) })
  }
  const byRoster = new Map<string, string[]>()
  for (const { teamName, roster } of matched) byRoster.set(roster.id, [...(byRoster.get(roster.id) ?? []), teamName])
  const sharing = [...byRoster.values()].filter((names) => names.length > 1).flat()
  if (sharing.length) {
    items.push({ code: 'shared_roster', severity: 'blocker', title: `${plural(sharing.length, 'team')} point to the same roster`, action: `Refresh the import from ${label}, then check again.`, ...capped(sharing) })
  }

  const lineupBroken: string[] = []
  const ownerByPlayer = new Map<string, string[]>()
  for (const { teamName, roster } of matched) {
    let ids: string[]
    try {
      ids = importedOwnedPlayerIds(roster.playerData)
    } catch (error) {
      if (!refusalMessage(error)) throw error
      lineupBroken.push(teamName)
      continue
    }
    for (const id of ids) ownerByPlayer.set(id, [...(ownerByPlayer.get(id) ?? []), teamName])
  }
  if (lineupBroken.length) {
    items.push({ code: 'lineup_player_missing', severity: 'blocker', title: `${plural(lineupBroken.length, 'lineup')} list a player who isn't on the roster`, action: `Refresh the import from ${label}, then check again.`, ...capped(lineupBroken) })
  }
  const doubled = [...ownerByPlayer].filter(([, owners]) => owners.length > 1).map(([id]) => playerLabel(id, rosters, platform))
  if (doubled.length) {
    items.push({ code: 'duplicate_ownership', severity: 'blocker', title: `${plural(doubled.length, 'player is', 'players are')} on more than one team`, action: `Refresh the import from ${label}, then check again.`, ...capped(doubled) })
  }

  const sourceIds = [...ownerByPlayer.keys()]
  const translated = await translateImportedPlayerIds(db, { sport, platform, sourceIds })
  if (!translated.supported) {
    if (!items.some((item) => item.code === 'source_unsupported')) {
      items.push({ code: 'source_unsupported', severity: 'blocker', title: `${label} ${sport} players can't be matched yet`, action: 'Nothing to do yet. AllFantasy has to add player matching for this platform first.' })
    }
  } else {
    if (translated.unresolved.length) {
      items.push({
        code: 'unmatched_players', severity: 'blocker',
        title: `${plural(translated.unresolved.length, 'player isn’t', 'players aren’t')} matched to AllFantasy yet`,
        action: 'Nothing for you to do. AllFantasy matches new players in its regular player updates. If these are still here in a few days, contact support.',
        ...capped(translated.unresolved.map((id) => playerLabel(id, rosters, platform))),
      })
    }
    const confusing = [...translated.ambiguous.map((id) => playerLabel(id, rosters, platform)),
      ...translated.collisions.map((nativeId) => translated.playerDetails.get(nativeId)?.name ?? `Player ${nativeId}`)]
    if (confusing.length) {
      items.push({ code: 'ambiguous_players', severity: 'blocker', title: `${plural(confusing.length, 'player matches', 'players match')} more than one AllFantasy player`, action: 'Contact AllFantasy support to fix the match.', ...capped(confusing) })
    }
  }

  const seats = new Set(teams.map((team) => team.externalId))
  const strayPicks = futurePicks.filter((pick) => !seats.has(pick.originalRosterId) || !seats.has(pick.currentOwnerId)).length
  if (strayPicks) {
    items.push({ code: 'unmapped_future_picks', severity: 'blocker', title: `${plural(strayPicks, 'future draft pick')} ${strayPicks === 1 ? 'names' : 'name'} a team we can't find`, action: `Refresh the import from ${label}, then check again.` })
  }

  const syncedAt = league.lastSyncedAt?.getTime() ?? null
  if (syncedAt == null || now.getTime() - syncedAt > STALE_SYNC_MS) {
    const days = syncedAt == null ? null : Math.floor((now.getTime() - syncedAt) / STALE_SYNC_MS)
    items.push({
      code: 'stale_sync', severity: 'heads_up',
      title: days == null ? `This league hasn't been refreshed from ${label} yet` : `Last refreshed from ${label} ${plural(days, 'day')} ago`,
      action: 'Refresh the import before you switch, so AllFantasy starts from your latest rosters.',
    })
  }

  return {
    leagueId,
    status: items.some((item) => item.severity === 'blocker') ? 'blocked' : 'ready',
    platformLabel: label,
    items,
    teamCount: teams.length,
    playerCount: sourceIds.length,
    checkedAt,
  }
}
