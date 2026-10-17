import { getDecryptedAuth } from '@/lib/league-sync-core'
import type { EspnImportPayload, EspnImportTeam } from '@/lib/league-import/adapters/espn/types'
import { buildEspnMemberDirectory, resolveEspnOwners, resolveEspnCommissionerTeamIds,
  resolveEspnViewerTeamId, parseEspnSettings, parseEspnScheduleForTest,
  EspnImportConnectionError, EspnImportLeagueNotFoundError, type EspnFetchOptions } from './EspnLeagueFetchService'
import { parseEspnMlbSource } from './EspnMlbSource'

// Evidence: contracts/espn/ENDPOINTS.yaml and fantasy-league.MLB.2026 fixture.
export const ESPN_MLB_SLOTS: Record<number, string> = {
  0:'C',1:'1B',2:'2B',3:'3B',4:'SS',5:'OF',6:'MI',7:'CI',8:'LF',9:'CF',10:'RF',11:'DH',
  12:'UTIL',13:'P',14:'SP',15:'RP',16:'BE',17:'IR',19:'IF',
}
export const ESPN_MLB_POSITIONS: Record<number, string> = {
  1:'SP',2:'C',3:'1B',4:'2B',5:'3B',6:'SS',7:'LF',8:'CF',9:'RF',10:'DH',11:'RP',
}
const TEAMS: Record<number, string> = {0:'FA',1:'BAL',2:'BOS',3:'LAA',4:'CWS',5:'CLE',6:'DET',7:'KC',8:'MIL',9:'MIN',10:'NYY',11:'ATH',12:'SEA',13:'TEX',14:'TOR',15:'ATL',16:'CHC',17:'CIN',18:'HOU',19:'LAD',20:'WSH',21:'NYM',22:'PHI',23:'PIT',24:'STL',25:'SD',26:'SF',27:'COL',28:'MIA',29:'ARI',30:'TB'}
const num = (v: unknown, fallback = 0): number => typeof v === 'number' && Number.isFinite(v) ? v : fallback

export function parseEspnMlbPayload(raw: any, sourceInput: string, swid: string | null = null): EspnImportPayload {
  const { leagueId, season } = parseEspnMlbSource(sourceInput)
  if (Number(raw?.seasonId) !== season || String(raw?.id) !== leagueId || !Array.isArray(raw?.teams))
    throw new EspnImportLeagueNotFoundError('ESPN returned a different league or season.')
  const settings = parseEspnSettings(raw)
  if (settings) settings.lineupSlotCounts = settings.lineupSlotCounts.map(s => ({ ...s, slot: ESPN_MLB_SLOTS[s.slotId] ?? `SLOT_${s.slotId}` }))
  const members = buildEspnMemberDirectory(raw.members)
  const teams: EspnImportTeam[] = raw.teams.map((t: any) => {
    const ids: string[] = [], starters: string[] = [], reserve: string[] = []
    const playerMap: EspnImportTeam['playerMap'] = {}
    for (const entry of t.roster?.entries ?? []) {
      const p = entry.playerPoolEntry?.player
      if (p?.id == null) throw new Error('ESPN MLB roster entry has no player identity.')
      const id = String(p.id); ids.push(id)
      if (entry.lineupSlotId === 17) reserve.push(id)
      else if (entry.lineupSlotId !== 16 && entry.lineupSlotId !== 19) starters.push(id)
      playerMap[id] = { name: p.fullName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
        position: ESPN_MLB_POSITIONS[p.defaultPositionId] ?? 'UNKNOWN', team: TEAMS[p.proTeamId] ?? 'UNKNOWN' }
    }
    const record = t.record?.overall ?? {}
    return { teamId: String(t.id), ...resolveEspnOwners(t, members),
      teamName: t.name || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || `Team ${t.id}`,
      logoUrl: t.logo ?? null, wins: num(record.wins), losses: num(record.losses), ties: num(record.ties),
      rank: t.rankCalculatedFinal ?? t.playoffSeed ?? null, pointsFor: num(record.pointsFor), pointsAgainst: record.pointsAgainst ?? null,
      divisionId: t.divisionId == null ? null : String(t.divisionId),
      faabRemaining: settings?.acquisitionBudget == null ? null : Math.max(0, settings.acquisitionBudget - num(t.transactionCounter?.acquisitionBudgetSpent)),
      waiverPriority: t.waiverRank ?? null, rosterPlayerIds: ids, starterPlayerIds: starters, reservePlayerIds: reserve, playerMap }
  })
  if (!teams.length) throw new EspnImportLeagueNotFoundError('No ESPN MLB teams were available.')
  const players = Object.assign({}, ...teams.map(t => t.playerMap)) as EspnImportTeam['playerMap']
  const draftPicks = (raw.draftDetail?.picks ?? []).map((p: any) => ({
    round: num(p.roundId), pickNumber: num(p.roundPickNumber), overallPickNumber: num(p.overallPickNumber),
    teamId: String(p.teamId), playerId: String(p.playerId), playerName: players[String(p.playerId)]?.name ?? null,
    position: players[String(p.playerId)]?.position ?? null, team: players[String(p.playerId)]?.team ?? null,
    sourceDraftId: `MLB:${leagueId}:${season}`, bidAmount: p.bidAmount ?? null, isKeeper: Boolean(p.keeper),
  }))
  const currentWeek = raw.status?.currentMatchupPeriod ?? null
  return { sourceInput, league: { leagueId: `MLB:${leagueId}`, name: raw.settings?.name ?? `ESPN MLB ${leagueId}`,
    sport:'MLB', season, size: raw.settings?.size ?? teams.length, currentWeek,
    isFinished: raw.status?.isActive === false || (num(raw.status?.finalScoringPeriod) > 0 && num(raw.scoringPeriodId) > num(raw.status.finalScoringPeriod)),
    playoffTeamCount: settings?.playoffTeamCount ?? null, regularSeasonLength: settings?.regularSeasonMatchupCount ?? null },
    settings, teams, schedule: parseEspnScheduleForTest(raw, season, currentWeek), draftPicks,
    transactions: [], transactionsFetched: false, draftFetched: raw.draftDetail != null,
    previousSeasons: (Array.isArray(raw.status?.previousSeasons) ? raw.status.previousSeasons : []).filter((y: unknown)=>Number.isInteger(y) && Number(y)>=2010 && Number(y)<season).map((y:number)=>({season:String(y),sourceLeagueId:`MLB:${leagueId}`})),
    viewerTeamId: resolveEspnViewerTeamId(raw, swid), commissionerTeamIds: resolveEspnCommissionerTeamIds(raw) }
}

export async function fetchEspnMlbLeagueForImport(userId: string, input: string, _options: EspnFetchOptions = {}): Promise<EspnImportPayload> {
  const { leagueId, season } = parseEspnMlbSource(input)
  const auth = await getDecryptedAuth(userId, 'espn')
  const headers: Record<string, string> = { Accept:'application/json' }
  if (auth?.espnSwid && auth.espnS2) headers.Cookie = `SWID=${auth.espnSwid}; espn_s2=${auth.espnS2}`
  // Exactly the captured view combination; no unverified activity/history fan-out.
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/${season}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster&view=mSettings&view=mMatchup&view=mDraftDetail` // db-first-exception: authorized league import ingestion; persists source data before runtime reads
  const response = await fetch(url, { headers, cache:'no-store', signal:AbortSignal.timeout(12000) })
  if (response.status === 401 || response.status === 403)
    throw new EspnImportConnectionError('Connect or reconnect ESPN in Settings > Connected Accounts using a desktop browser to import this private baseball league.')
  if (response.status === 404) throw new EspnImportLeagueNotFoundError(`ESPN MLB league was not found for ${season}.`)
  if (!response.ok) throw new Error(`ESPN MLB request failed (${response.status}).`)
  const payload=parseEspnMlbPayload(await response.json(), input, auth?.espnSwid ?? null)
  payload.previousSeasons = _options.includePreviousSeasons === false ? [] : payload.previousSeasons.filter(p=>Number(p.season)>=(_options.minSeason ?? 2010)).sort((a,b)=>Number(b.season)-Number(a.season)).slice(0,_options.maxPreviousSeasons ?? 6)
  return payload
}
