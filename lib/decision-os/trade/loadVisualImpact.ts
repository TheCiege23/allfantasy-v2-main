import 'server-only'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'
import { leagueWeekBasis, isLeagueWeekRefusal, priceLeagueWeek } from './leagueWeekPricing'
import { computeRosterImpact } from './rosterImpact'
import { summarizeRosterImpact, LEAGUE_WEEK_UNIT, type LineupImpactSummary } from './rosterImpactSummary'
import { retrospectiveRoster } from './visualHistory'
export type VisualImpactResult = {impact:LineupImpactSummary|null;reason:string|null;moved:string[];returned:string[];evaluatedAt:string;rostersSyncedAt:string|null;rostersStale:boolean;season:string|null}
/** Both modes use today's roster and this league's weekly scoring. Completed mode compares to an explicit hypothetical undo. */
export async function loadVisualImpact(args:{leagueId:string;userId:string;sent:string[];received:string[];completed?:boolean;unresolved?:boolean}):Promise<VisualImpactResult> {
  const empty:VisualImpactResult = {impact:null,reason:null,moved:[],returned:[],evaluatedAt:new Date().toISOString(),rostersSyncedAt:null,rostersStale:true,season:null}
  const [world,viewer] = await Promise.all([resolveCanonicalWorld(args.leagueId),resolveViewerLeagueRoster(args.leagueId,args.userId)])
  if (!world || !viewer.ok) return {...empty,reason:'Your current roster could not be identified. Claim your team and sync this league.'}
  const team = world.teams.find(t=>t.source.sourceTeamId===viewer.team.externalId)
  const roster = world.rosters.find(r=>r.rosterId===viewer.roster.id) ?? world.rosters.find(r=>team && r.teamId===team.teamId)
  const result = {...empty,rostersSyncedAt:world.provenance.freshness.lastSyncedAt,rostersStale:world.provenance.freshness.isStale}
  const provider = String(world.provenance.provider ?? 'native').toLowerCase()
  if (!['native','allfantasy','sleeper'].includes(provider)) return {...result,reason:'Weekly impact needs verified Sleeper roster identities; this provider’s roster mapping is not supported yet.'}
  if (!roster || !world.league.rosterSettings.starterSlots?.length) return {...result,reason:'Current roster or starting slots are missing.'}
  if (args.unresolved) return {...result,reason:'Some traded players lack verified roster identities; no lineup change is estimated.'}
  if (!args.sent.length && !args.received.length) return {...result,reason:'This trade has no original player swap to simulate. Weekly effects of picks and FAAB are not estimated.'}
  const undo = retrospectiveRoster(roster.playerIds,args.sent,args.received)
  if (args.completed && !undo.withoutTrade) return {...result,reason:'Later roster moves prevent a clean comparison. The original acquired assets must still be held and sent assets must not have returned.',moved:undo.moved,returned:undo.returned}
  const basis = await leagueWeekBasis(world.league)
  if (isLeagueWeekRefusal(basis)) return {...result,reason:basis.detail}
  // Never use a different season's feed to describe this team's current week.
  if (world.league.season && String(world.league.season)!==basis.week.season) return {...result,reason:'The latest projection feed does not match this league’s season.'}
  const ids = [...new Set([...roster.playerIds,...args.sent,...args.received])]
  const priced = await priceLeagueWeek(basis,ids,new Map())
  const player = (id:string) => priced.get(id) ?? {playerId:id,position:'',projectedPoints:null}
  const impact = computeRosterImpact({roster:(args.completed ? undo.withoutTrade! : roster.playerIds).map(player),slots:world.league.rosterSettings.starterSlots,incoming:args.received.map(player),outgoingPlayerIds:args.sent})
  return {...result,season:basis.week.season,impact:summarizeRosterImpact({...impact,unit:LEAGUE_WEEK_UNIT,week:basis.week.week})??null,reason:impact.blockedReason}
}
