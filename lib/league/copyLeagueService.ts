/**
 * Copy leagues, part 1 — the database half of ./copyLeague.ts.
 *
 * - `readCopyLeagueForViewer`: the league's copy-league state as the viewer may act on it.
 * - `changeCopyLeague`: turn it on or off (commissioner), take or let go of a real team (a manager, for
 *   the team they claimed, until the draft starts), or assign / swap any team (commissioner, any time).
 *
 * The name and avatar a real team brings are written the way a commissioner's rename is
 * (app/api/commissioner/leagues/[leagueId]/teams/route.ts): the LeagueTeam row, and the CURRENT season's
 * RedraftRoster that standings, matchups and trades read. A past season keeps the name it had.
 *
 * AllFantasy leagues only: an imported league's team names come from its host on every sync.
 * Postgres only; no provider call.
 */
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { draftHasStarted } from '@/lib/league-join/postDraftJoinLock'
import {
  changeCopyTeam,
  copyLeagueAvailable,
  copyLeagueTeams,
  disableCopyLeague,
  readCopyLeague,
  withCopyLeague,
  type CopyLeagueState,
  type CopyLeagueTeam,
  type IdentityWrite,
} from './copyLeague'

export type CopyLeagueView = {
  /** This league's sport has a verified team table and the league is hosted on AllFantasy. */
  available: boolean
  enabled: boolean
  /** The draft has started: managers can no longer change their team; the commissioner still can. */
  locked: boolean
  canManage: boolean
  /** The league team this viewer claimed, if any. */
  myLeagueTeamId: string | null
  teams: Array<{ leagueTeamId: string; teamName: string; ownerName: string | null; code: string | null }>
  catalog: CopyLeagueTeam[]
}

type Refusal = { ok: false; status: number; code: string; message: string }

async function load(leagueId: string) {
  const [league, teams, draft] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, sport: true, platform: true, settings: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true, teamName: true, avatarUrl: true, ownerName: true, claimedByUserId: true },
      orderBy: { externalId: 'asc' },
    }),
    prisma.draftSession.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { status: true } }),
  ])
  return { league, teams, locked: draftHasStarted(draft?.status ?? null) }
}

export async function readCopyLeagueForViewer(leagueId: string, userId: string): Promise<CopyLeagueView | null> {
  const { league, teams, locked } = await load(leagueId)
  if (!league) return null
  const native = isNativePlatform(String(league.platform ?? '').trim().toLowerCase() || 'manual')
  const state = readCopyLeague(league.settings, league.sport)
  return {
    available: native && copyLeagueAvailable(league.sport),
    enabled: state.enabled,
    locked,
    canManage: await canCommissionerAct(leagueId, userId, 'league'),
    myLeagueTeamId: teams.find((t) => t.claimedByUserId === userId)?.id ?? null,
    teams: teams.map((t) => ({ leagueTeamId: t.id, teamName: t.teamName, ownerName: t.ownerName ?? null, code: state.teams[t.id] ?? null })),
    catalog: copyLeagueTeams(league.sport),
  }
}

export type CopyLeagueAction =
  | { action: 'enable' }
  | { action: 'disable' }
  | { action: 'pick'; code: string | null }
  | { action: 'assign'; leagueTeamId: string; code: string | null }

export async function changeCopyLeague(leagueId: string, userId: string, a: CopyLeagueAction): Promise<{ ok: true } | Refusal> {
  const { league, teams, locked } = await load(leagueId)
  if (!league) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'League not found.' }
  if (!isNativePlatform(String(league.platform ?? '').trim().toLowerCase() || 'manual')) {
    return { ok: false, status: 409, code: 'IMPORTED_LEAGUE', message: 'This league is imported, so its team names come from the platform it lives on.' }
  }
  if (!copyLeagueAvailable(league.sport)) {
    return { ok: false, status: 409, code: 'SPORT_UNSUPPORTED', message: 'Copy leagues are available for NFL leagues.' }
  }
  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  const state = readCopyLeague(league.settings, league.sport)
  const rows = teams.map((t) => ({ id: t.id, teamName: t.teamName, avatarUrl: t.avatarUrl ?? null }))

  let next: CopyLeagueState
  let writes: IdentityWrite[] = []
  if (a.action === 'enable' || a.action === 'disable') {
    if (!commissioner) return { ok: false, status: 403, code: 'COMMISSIONER_ONLY', message: 'Only the commissioner can turn copy league on or off.' }
    if (a.action === 'enable') next = { ...state, enabled: true }
    else ({ state: next, writes } = disableCopyLeague(state))
  } else {
    let leagueTeamId: string
    if (a.action === 'pick') {
      const mine = teams.find((t) => t.claimedByUserId === userId)
      if (!mine) return { ok: false, status: 403, code: 'NO_TEAM', message: 'You need a team in this league to take a real team.' }
      if (locked) return { ok: false, status: 409, code: 'LOCKED', message: 'Teams are locked once the draft starts. Ask your commissioner to change yours.' }
      leagueTeamId = mine.id
    } else {
      if (!commissioner) return { ok: false, status: 403, code: 'COMMISSIONER_ONLY', message: 'Only the commissioner can assign teams.' }
      leagueTeamId = a.leagueTeamId
    }
    const change = changeCopyTeam({ state, teams: rows, leagueTeamId, code: a.code, swap: a.action === 'assign' })
    if (!change.ok) return { ok: false, status: change.code === 'TAKEN' ? 409 : 400, code: change.code, message: change.message }
    next = change.state
    writes = change.writes
  }

  const currentSeason = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  const byId = new Map(teams.map((t) => [t.id, t]))
  const rosterLinks = writes.length
    ? await prisma.roster.findMany({
        where: { leagueId, id: { in: writes.map((w) => byId.get(w.leagueTeamId)?.externalId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, redraftRosterId: true },
      })
    : []
  const redraftByExternal = new Map(rosterLinks.map((r) => [r.id, r.redraftRosterId]))

  await prisma.$transaction(async (tx) => {
    // Read-modify-write so a concurrent settings save to another key is not lost.
    const fresh = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    await tx.league.update({ where: { id: leagueId }, data: { settings: withCopyLeague(fresh?.settings, next) as object } })
    for (const w of writes) {
      const data = { teamName: w.teamName, avatarUrl: w.avatarUrl }
      await tx.leagueTeam.update({ where: { id: w.leagueTeamId }, data })
      const redraftId = redraftByExternal.get(byId.get(w.leagueTeamId)?.externalId ?? '')
      if (currentSeason && redraftId) {
        await tx.redraftRoster.updateMany({ where: { id: redraftId, leagueId, seasonId: currentSeason.id }, data })
      }
    }
  })

  await logAction({
    leagueId,
    userId,
    actionType: 'copy_league_change',
    entityType: 'league',
    entityId: leagueId,
    beforeState: { enabled: state.enabled, teams: state.teams },
    afterState: { enabled: next.enabled, teams: next.teams },
    metadata: { action: a.action, writes: writes.length },
  }).catch(() => {})
  return { ok: true }
}
