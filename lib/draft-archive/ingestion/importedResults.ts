import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { draftArchiveCatalog } from '../catalog';
import { resultsReport, type AnalysisSelection } from '../analysisModel';
import { referenceStorageKey } from '../references';
import { normalizePickNumber } from '@/lib/league-import/sleeper/sleeperDraftPickIdentity';
import type { ImportedWeeklyEvidence } from '../importedWeeklyModel';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const id = (v: unknown) => typeof v === 'number' && Number.isInteger(v) ? String(v) : typeof v === 'string' && v ? v : null;
const storageKey = (leagueId: string, key: string) => referenceStorageKey(leagueId + ':' + key);
async function read(path: string) {
  const response = await fetch('https://api.sleeper.app/v1/' + path, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!response.ok) throw new Error('Historical results unavailable');
  return await response.json() as unknown;
}
import type { ImportedResultsObservation } from '../importedResults';
/** Commissioner-triggered provider reads; never run in page render. */
export async function captureImportedResults(leagueId: string, key: string, apply = true) {
  const catalog = await draftArchiveCatalog([leagueId],{key,limit:1}), choice = catalog.choices[0];
  if (!choice || choice.source !== 'imported' || choice.sport !== 'NFL' || !choice.season || !/^\d+$/.test(choice.sourceId)) throw new Error('Choose a verified imported NFL draft');
  const league = await prisma.league.findUnique({ where:{id:leagueId},select:{platform:true} });
  if (league?.platform?.toLowerCase() !== 'sleeper') throw new Error('Unsupported result provider');
  const facts = await prisma.draftFact.findMany({where:{leagueId,sport:'NFL',season:choice.season,metadata:{path:['sourceDraftId'],equals:choice.sourceId}},take:10001});
  if (!facts.length || facts.length > 1000) throw new Error('Result source bound exceeded');
  const sourceIds = new Set(facts.map(f=>id(object(f.metadata).sourceLeagueId)));
  if (sourceIds.size !== 1) throw new Error('Unverified historical source league');
  const sourceLeagueId = [...sourceIds][0];
  if (!sourceLeagueId || !/^\d+$/.test(sourceLeagueId)) throw new Error('Invalid historical source league');
  const [leagueRaw,draftRaw,picksRaw] = await Promise.all([read('league/'+sourceLeagueId),read('draft/'+choice.sourceId),read('draft/'+choice.sourceId+'/picks')]);
  const provider = object(leagueRaw), draft = object(draftRaw);
  if (provider.league_id !== sourceLeagueId || Number(provider.season) !== choice.season || draft.league_id !== sourceLeagueId || draft.draft_id !== choice.sourceId || !Array.isArray(picksRaw) || picksRaw.length > 10000) throw new Error('Historical source mismatch');
  const selections: AnalysisSelection[] = facts.map(f=>{const meta=object(f.metadata), player=object(meta.playerSnapshot);return {playerId:f.playerId,rosterId:id(meta.selectionRosterId),playerName:typeof player.name==='string'?player.name:'Player '+f.playerId,position:typeof player.position==='string'?player.position:'Unknown',keeper:meta.isKeeper===true};});
  const identities = facts.map(f=>`${f.round}:${f.pickNumber}:${f.playerId}`), sourceIdentities = picksRaw.map((raw,i)=>{const p=object(raw);return `${p.round}:${normalizePickNumber(p,i+1)}:${p.player_id}`;});
  const completeDraft = identities.length === sourceIdentities.length && new Set(identities).size === identities.length && identities.every(i=>sourceIdentities.includes(i));
  for (const fact of facts) {
    const source = picksRaw.map(object).filter((p,i)=>Number(p.round)===fact.round && normalizePickNumber(p,i+1)===fact.pickNumber && p.player_id===fact.playerId);
    if (source.length!==1 || id(source[0].roster_id)!==id(object(fact.metadata).selectionRosterId)) throw new Error('Recorded selection ownership differs from provider');
  }
  const rosterIds = Object.values(object(draft.slot_to_roster_id)).map(id).filter((v):v is string=>!!v);
  if (rosterIds.length < 2 || rosterIds.length > 32 || new Set(rosterIds).size !== rosterIds.length) throw new Error('Complete draft roster inventory required');
  const teams = rosterIds.map(rosterId=>({rosterId,name:'Team '+rosterId}));
  if (new Set(selections.map(p=>p.playerId)).size!==selections.length||selections.some(p=>!p.playerId||!p.rosterId||!rosterIds.includes(p.rosterId))) throw new Error('Unambiguous recorded player and team identities required');
  const scored = Number(object(provider.settings).last_scored_leg);
  if (!Number.isInteger(scored) || scored < 1 || scored > 18) throw new Error('Provider has not confirmed scored weeks');
  const games = await prisma.sportsGame.findMany({where:{sport:'NFL',season:choice.season,seasonType:'regular',week:{gte:1,lte:scored}},take:1001,select:{week:true,startTime:true}});
  if (games.length > 1000 || typeof draft.start_time !== 'number' || !Number.isFinite(draft.start_time)) throw new Error('Verified draft and schedule dates required');
  const startTime = draft.start_time;
  const weeks = Array.from({length:scored},(_,i)=>i+1).filter(week=>games.some(g=>g.week===week) && games.filter(g=>g.week===week).every(g=>g.startTime && g.startTime.getTime() > startTime));
  const rows: ImportedWeeklyEvidence['rows'] = [], coveredWeeks: number[] = [];
  const deadline = Date.now()+45000;
  for (let offset=0;offset<weeks.length;offset+=3) {
    if (Date.now()>deadline) throw new Error('Result refresh time bound exceeded');
    const batch=await Promise.all(weeks.slice(offset,offset+3).map(async week=>({week,data:await read(`league/${sourceLeagueId}/matchups/${week}`)})));
    for (const {week,data} of batch) {
      if (!Array.isArray(data) || data.length!==teams.length) continue;
      const matchups=data.map(object), ids=matchups.map(m=>id(m.roster_id));
      if (new Set(ids).size!==teams.length || !teams.every(t=>ids.includes(t.rosterId))) continue;
      if (matchups.some(m=>!Array.isArray(m.players)||!Array.isArray(m.starters)||m.players.length>100||m.starters.length>100||new Set(m.players).size!==m.players.length||new Set((m.starters as unknown[]).filter(p=>p!=='0')).size!==(m.starters as unknown[]).filter(p=>p!=='0').length||m.starters.some(p=>typeof p!=='string'||(p!=='0'&&!(m.players as unknown[]).includes(p)))||m.players.some(p=>typeof p!=='string'))) continue;
      const ownedIds=matchups.flatMap(m=>m.players as string[]);
      if (new Set(ownedIds).size!==ownedIds.length) continue;
      let complete=true; const weekRows: typeof rows=[];
      for (const team of teams) {
        const m=matchups.find(m=>id(m.roster_id)===team.rosterId)!;
        for (const pick of selections.filter(p=>p.rosterId===team.rosterId)) {
          if (!pick.playerId) {complete=false;continue;}
          const owned=(m.players as string[]).includes(pick.playerId), value=object(m.players_points)[pick.playerId];
          if (owned && (typeof value!=='number'||!Number.isFinite(value))) {complete=false;continue;}
          weekRows.push({rosterId:team.rosterId,playerId:pick.playerId,week,points:owned ? value as number : 0,isStarter:owned&&(m.starters as string[]).includes(pick.playerId),held:owned});
        }
      }
      rows.push(...weekRows); if (complete) coveredWeeks.push(week);
    }
  }
  if (rows.length>10000) throw new Error('Result evidence bound exceeded');
  const report=resultsReport(selections,teams,rows,weeks);
  report.provisional=true;
  report.coverage='Provider-reported scored weeks, retrieved at the displayed observation time. Production is counted only while a drafted player is held by the original team; exhaustive weekly rosters establish zero original-team contribution after departure. These are provisional usage ranks, not NFL production totals or draft-decision grades.';
  if (!completeDraft || coveredWeeks.length !== weeks.length) {report.state=report.teams.some(t=>t.coveredPicks)?'partial':'unavailable';for(const team of report.teams)team.rank=null;}
  const observation: ImportedResultsObservation={version:'draft-results-v2',leagueId,key,observedAt:new Date().toISOString(),sourceLeagueId,sourceDraftId:choice.sourceId,report,weekly:{selections:selections.map(p=>({playerId:p.playerId!,rosterId:p.rosterId!})),expectedWeeks:weeks,rows,completeDraft}};
  const fingerprint=createHash('sha256').update(JSON.stringify(observation)).digest('hex');
  if (apply) {
    const aggregate:ImportedResultsObservation={version:'draft-results-v1',leagueId,key,observedAt:observation.observedAt,sourceLeagueId,sourceDraftId:choice.sourceId,report};
    await prisma.$transaction([
      prisma.aiAdpSnapshotHistory.create({data:{id:'hqr2-'+fingerprint.slice(0,40),sport:'NFL',leagueType:'draft_results',formatKey:storageKey(leagueId,key+':weekly-v2'),computedAt:new Date(observation.observedAt),snapshotData:observation as unknown as Prisma.InputJsonValue,totalDrafts:1,totalPicks:selections.length}}),
      prisma.aiAdpSnapshotHistory.create({data:{id:'hqr1-'+fingerprint.slice(0,40),sport:'NFL',leagueType:'draft_results',formatKey:storageKey(leagueId,key),computedAt:new Date(observation.observedAt),snapshotData:aggregate as unknown as Prisma.InputJsonValue,totalDrafts:1,totalPicks:selections.length}}),
    ]);
  }
  return {weeks:coveredWeeks.length,state:report.state};
}
