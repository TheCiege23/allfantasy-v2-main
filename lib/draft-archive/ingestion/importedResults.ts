import 'server-only';
import {importedResultCutoff} from '../resultCutoff';
import {stableFinalWeeks} from '../reconciliationModel';
import {MAX_WEEKLY_ROSTER_PLAYERS,weeklyOutcomes,type WeeklyRosterEvidence} from '../weeklyOutcomeModel';
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
  if (new Set(selections.map(p=>p.playerId)).size!==selections.length||selections.some(p=>!p.playerId||(p.rosterId!==null&&!rosterIds.includes(p.rosterId)))) throw new Error('Unambiguous recorded player and team identities required');
  const scored = Number(object(provider.settings).last_scored_leg);
  if (!Number.isInteger(scored) || scored < 1 || scored > 18) throw new Error('Provider has not confirmed scored weeks');
  const games = await prisma.sportsGame.findMany({where:{sport:'NFL',season:choice.season,seasonType:'regular',week:{gte:1,lte:scored}},take:1001,select:{week:true,startTime:true,status:true,source:true}});
  const cutoff=importedResultCutoff(draft);
  if (games.length > 1000 || !cutoff) throw new Error('Verified draft and schedule dates required');
  const startTime = cutoff.at;
  const weeks = Array.from({length:scored},(_,i)=>i+1).filter(week=>games.some(g=>g.week===week) && games.filter(g=>g.week===week).every(g=>g.startTime && g.startTime.getTime() > startTime));
  const reconciled=await prisma.leaguePlayerWeeklyScore.findMany({where:{leagueId:sourceLeagueId,seasonYear:choice.season,source:'sleeper',week:{in:weeks}},take:MAX_WEEKLY_ROSTER_PLAYERS+1,select:{week:true,playerId:true,rosterId:true,points:true,isStarter:true,isFinalized:true}});
  if(reconciled.length>MAX_WEEKLY_ROSTER_PLAYERS)throw new Error('Final score evidence bound exceeded');
  const weekEvidence:WeeklyRosterEvidence[]=[];
  const declaredSlots=Array.isArray(provider.roster_positions)?provider.roster_positions.filter((s):s is string=>typeof s==='string'&&!['BN','BE','BENCH','IR','TAXI'].includes(s.toUpperCase())):[];
  const rows: ImportedWeeklyEvidence['rows'] = [], coveredWeeks: number[] = [];
  const deadline = Date.now()+45000;
  for (let offset=0;offset<weeks.length;offset+=3) {
    if (Date.now()>deadline) throw new Error('Result refresh time bound exceeded');
    const batch=await Promise.all(weeks.slice(offset,offset+3).map(async week=>({week,data:await read(`league/${sourceLeagueId}/matchups/${week}`)})));
    for (const {week,data} of batch) {
      if (!Array.isArray(data) || !data.length || data.length>teams.length) continue;
      const sourceMatchups=data.map(object), ids=sourceMatchups.map(m=>id(m.roster_id));
      if (new Set(ids).size!==ids.length || ids.some(rosterId=>!rosterId||!rosterIds.includes(rosterId))) continue;
      // A missing/malformed team's contribution is unknown; verified remaining teams can still be shown.
      const matchups=sourceMatchups.filter(m=>Array.isArray(m.players)&&Array.isArray(m.starters)&&m.players.length<=100&&m.starters.length<=100&&new Set(m.players).size===m.players.length&&new Set((m.starters as unknown[]).filter(p=>p!=='0')).size===(m.starters as unknown[]).filter(p=>p!=='0').length&&m.starters.every(p=>typeof p==='string'&&(p==='0'||(m.players as unknown[]).includes(p)))&&m.players.every(p=>typeof p==='string'));
      if(!matchups.length)continue;
      const presentTeams=teams.filter(t=>matchups.some(m=>id(m.roster_id)===t.rosterId));
      const ownedIds=matchups.flatMap(m=>m.players as string[]);
      if (new Set(ownedIds).size!==ownedIds.length) continue;
      let complete=presentTeams.length===teams.length; const weekRows: typeof rows=[];
      for (const team of presentTeams) {
        const m=matchups.find(m=>id(m.roster_id)===team.rosterId)!;
        for (const pick of selections.filter(p=>p.rosterId===team.rosterId)) {
          if (!pick.playerId) {complete=false;continue;}
          const owned=(m.players as string[]).includes(pick.playerId), value=object(m.players_points)[pick.playerId];
          if (owned && (typeof value!=='number'||!Number.isFinite(value))) {complete=false;continue;}
          weekRows.push({rosterId:team.rosterId,playerId:pick.playerId,week,points:owned ? value as number : 0,isStarter:owned&&(m.starters as string[]).includes(pick.playerId),held:owned});
        }
      }
      for(const team of presentTeams){
        const m=matchups.find(m=>id(m.roster_id)===team.rosterId)!;
        const starters=m.starters as string[];
        weekEvidence.push({week,rosterId:team.rosterId,players:(m.players as string[]).map(playerId=>{
          const value=object(m.players_points)[playerId],points=typeof value==='number'&&Number.isFinite(value)?value:null,starter=starters.includes(playerId);
          const recorded=reconciled.filter(r=>r.week===week&&r.playerId===playerId);
          return{playerId,points,starter,position:selections.find(p=>p.playerId===playerId)?.position??null,finalized:recorded.length===1&&recorded[0].isFinalized&&String(recorded[0].rosterId)===team.rosterId&&recorded[0].points===points&&recorded[0].isStarter===starter};
        }),slots:starters.length===declaredSlots.length?declaredSlots.map((slot,i)=>({slot,playerId:starters[i]==='0'?null:starters[i]})):[]});
      }
      rows.push(...weekRows); if (complete) coveredWeeks.push(week);
    }
  }
  if(weekEvidence.reduce((sum,e)=>sum+e.players.length,0)>MAX_WEEKLY_ROSTER_PLAYERS)throw new Error('Weekly roster evidence bound exceeded');
  if (rows.length>18000) throw new Error('Result evidence bound exceeded');
  let stableWeeks:number[]=[];
  const now=new Date();
  // Only the verified historical source is complete by construction; contemporary sources stay conservative.
  const historicalGames=games.filter(g=>g.source==='espn_draft_history_v1');
  const finalGames=historicalGames.length?historicalGames:games;
  if(apply&&rows.length&&finalGames.some(g=>g.status?.toLowerCase()==='final'&&g.startTime&&g.startTime.getTime()<now.getTime()-36*3600000)){
    const priorRow=await prisma.aiAdpSnapshotHistory.findFirst({where:{sport:'NFL',leagueType:'draft_results',formatKey:storageKey(leagueId,key+':weekly-v3'),computedAt:{lte:new Date(now.getTime()-12*3600000)}},orderBy:[{computedAt:'desc'},{id:'desc'}],select:{snapshotData:true}});
    const prior=object(priorRow?.snapshotData);
    if(prior.version==='draft-results-v3'&&prior.leagueId===leagueId&&prior.key===key&&prior.sourceLeagueId===sourceLeagueId&&prior.sourceDraftId===choice.sourceId&&typeof prior.observedAt==='string')stableWeeks=stableFinalWeeks(weekEvidence,object(prior.weekly).weekEvidence,now.toISOString(),prior.observedAt,rosterIds,weeks,finalGames,now);
    for(const proof of weekEvidence)if(stableWeeks.includes(proof.week))for(const player of proof.players)player.finalized=true;
  }
  const report=resultsReport(selections,teams,rows,weeks);
  report.provisional=true;
  report.coverage=(cutoff.basis==='provider_last_pick'?'Start time unavailable; only weeks entirely after the recorded last pick are included. ':'')+(selections.some(p=>p.rosterId===null)?`${selections.filter(p=>p.rosterId===null).length} unassigned provider picks have unknown selecting teams; their contribution and whole-draft ranks are unavailable. `:'')+'Provider-reported scored weeks, retrieved at the displayed observation time. Production is counted only while a drafted player is held by the original team; exhaustive weekly rosters establish zero original-team contribution after departure. These are provisional usage ranks, not NFL production totals or draft-decision grades.';
  if (!completeDraft || coveredWeeks.length !== weeks.length) {report.state=report.teams.some(t=>t.coveredPicks)?'partial':'unavailable';for(const team of report.teams)team.rank=null;}
  const outcomes=weeklyOutcomes(selections,weeks,rosterIds,weekEvidence);
  const provisionalReport={...report,teams:report.teams.map(t=>({...t})),provisional:true};
  if(outcomes.finalizedWeeks.length===weeks.length&&weeks.length>0&&report.state==='ready'){report.provisional=false;report.coverage=(cutoff.basis==='provider_last_pick'?'Start time unavailable; only weeks entirely after the recorded last pick are included. ':'')+'Reconciled finalized original-team weekly contribution. Bench substitution comparisons are retrospective and use the slot rules observed at refresh, not waiver availability or causal draft grades.';}
  const observation: ImportedResultsObservation={version:'draft-results-v3',leagueId,key,observedAt:new Date().toISOString(),sourceLeagueId,sourceDraftId:choice.sourceId,report,weekly:{resultCutoff:cutoff,selections:selections.map(p=>({playerId:p.playerId!,rosterId:p.rosterId})),expectedWeeks:weeks,rows,completeDraft,weekEvidence}};
  const fingerprint=createHash('sha256').update(JSON.stringify(observation)).digest('hex');
  if (apply && rows.length) {
    const aggregate:ImportedResultsObservation={version:'draft-results-v1',leagueId,key,observedAt:observation.observedAt,sourceLeagueId,sourceDraftId:choice.sourceId,report:provisionalReport};
    const compatible:ImportedResultsObservation={...observation,version:'draft-results-v2',report:provisionalReport,weekly:{...observation.weekly!,weekEvidence:undefined}};
    const persist=(db:Pick<typeof prisma,'aiAdpSnapshotHistory'>)=>[

      db.aiAdpSnapshotHistory.create({data:{id:'hqr3-'+fingerprint.slice(0,40),sport:'NFL',leagueType:'draft_results',formatKey:storageKey(leagueId,key+':weekly-v3'),computedAt:new Date(observation.observedAt),snapshotData:observation as unknown as Prisma.InputJsonValue,totalDrafts:1,totalPicks:selections.length}}),
      // Prior v2 readers cap selected-player rows at 10,000; retain v1 fallback for larger archives.
      ...(rows.length<=10000?[db.aiAdpSnapshotHistory.create({data:{id:'hqr2-'+fingerprint.slice(0,40),sport:'NFL',leagueType:'draft_results',formatKey:storageKey(leagueId,key+':weekly-v2'),computedAt:new Date(observation.observedAt),snapshotData:JSON.parse(JSON.stringify(compatible)) as unknown as Prisma.InputJsonValue,totalDrafts:1,totalPicks:selections.length}})]:[]),
      db.aiAdpSnapshotHistory.create({data:{id:'hqr1-'+fingerprint.slice(0,40),sport:'NFL',leagueType:'draft_results',formatKey:storageKey(leagueId,key),computedAt:new Date(observation.observedAt),snapshotData:aggregate as unknown as Prisma.InputJsonValue,totalDrafts:1,totalPicks:selections.length}}),
    ];
    if(stableWeeks.length){
      const sealed=weekEvidence.filter(e=>stableWeeks.includes(e.week)).flatMap(e=>e.players.map(p=>{
        const cached=reconciled.filter(r=>r.week===e.week&&r.playerId===p.playerId);
        const previous=cached.length===1&&!cached[0].isFinalized?cached[0]:null;
        return {id:'dfr-'+createHash('sha256').update(JSON.stringify([sourceLeagueId,choice.season,e.week,p.playerId])).digest('hex').slice(0,40),week:e.week,playerId:p.playerId,rosterId:Number(e.rosterId),points:p.points,isStarter:p.starter,previousPoints:previous?.points??null,previousRosterId:previous?.rosterId??null,previousStarter:previous?.isStarter??null};
      }));
      if(sealed.some(p=>!Number.isSafeInteger(p.rosterId)||p.rosterId<1||p.points===null))throw new Error('Invalid finalization source identity');
      await prisma.$transaction(async tx=>{
        const count=await tx.$executeRaw(Prisma.sql`WITH verified AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(sealed)}::jsonb) AS r(id text,week integer,"playerId" text,"rosterId" integer,points double precision,"isStarter" boolean,"previousPoints" double precision,"previousRosterId" integer,"previousStarter" boolean)) INSERT INTO league_player_weekly_scores (id,"leagueId","seasonYear",week,"playerId","rosterId",points,"isStarter","isFinalized",source,"createdAt","updatedAt") SELECT r.id,${sourceLeagueId},${choice.season},r.week,r."playerId",r."rosterId",r.points,r."isStarter",true,'sleeper',now(),now() FROM verified r WHERE true ON CONFLICT ("leagueId","seasonYear",week,"playerId") DO UPDATE SET points=EXCLUDED.points,"rosterId"=EXCLUDED."rosterId","isStarter"=EXCLUDED."isStarter","isFinalized"=true,"updatedAt"=now() WHERE league_player_weekly_scores.source='sleeper' AND ((league_player_weekly_scores.points=EXCLUDED.points AND league_player_weekly_scores."rosterId"=EXCLUDED."rosterId" AND league_player_weekly_scores."isStarter"=EXCLUDED."isStarter") OR (NOT league_player_weekly_scores."isFinalized" AND EXISTS(SELECT 1 FROM verified v WHERE v.week=league_player_weekly_scores.week AND v."playerId"=league_player_weekly_scores."playerId" AND v."previousPoints"=league_player_weekly_scores.points AND v."previousRosterId" IS NOT DISTINCT FROM league_player_weekly_scores."rosterId" AND v."previousStarter"=league_player_weekly_scores."isStarter")))`);        if(count!==sealed.length)throw new Error('Score changed during finalization; no observation published');
        await Promise.all(persist(tx));
      },{timeout:60000});
    }else await prisma.$transaction(persist(prisma));
  }
  return {weeks:coveredWeeks.length,state:report.state};
}
