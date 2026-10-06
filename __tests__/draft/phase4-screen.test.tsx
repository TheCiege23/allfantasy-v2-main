import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {TextDecoder} from 'node:util';
const language=vi.hoisted(()=>({language:'en'}));
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>language}));
beforeEach(()=>{language.language='en';});
import {DraftPhase4} from '@/components/core-app/screens/DraftPhase4';
import type {ArchiveDetail} from '@/lib/draft-archive/detail';
const detail={choice:{key:'native:d',leagueId:'l'},picks:[{id:'a',overall:2,playerName:'First recorded player'},{id:'b',overall:7,playerName:'Later recorded player'}],coverage:[],phase4:{components:[],scores:[],calibration:null,dynasty:[],replay:{state:'unavailable',players:[],picks:[]},lineage:{state:'partial',lineages:[],pending:Array.from({length:21},(_,i)=>({season:2027,round:i+1,originalRosterId:'owner',from:'a',to:'b'}))},contributions:[{playerId:'p',name:'Observed player',rosterId:'a',state:'partial',weeks:[{week:1,points:10,starter:true}],expectedWeeks:2,totalPoints:10,starterPoints:10,starts:1,usage:null,earlyStarterPoints:null,lateStarterPoints:null}]}} as unknown as ArchiveDetail;
describe('draft analysis controls',()=>{
  it('preserves strict UTF-8 source for the Next.js compiler',()=>{
    expect(()=>new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(resolve(process.cwd(),'components/core-app/screens/DraftPhase4.tsx')))).not.toThrow();
  });
  it('opens scoped Chimmy with an archive key without sending a message',()=>{
    const listener=vi.fn();window.addEventListener('af-comms-open',listener);
    render(<DraftPhase4 detail={detail}/>);fireEvent.click(screen.getByRole('button',{name:'Ask Chimmy about this draft'}));
    expect(listener.mock.calls[0][0].detail).toEqual({tab:'chimmy',leagueId:'l',prefill:'Explain the verified draft analysis for archive key native:d.'});
    window.removeEventListener('af-comms-open',listener);
  });
  it('replays actual recorded picks even with gaps in overall numbers',()=>{
    render(<DraftPhase4 detail={detail}/>);fireEvent.click(screen.getByRole('button',{name:'Replay a pick'}));expect(screen.getByLabelText('Overall pick')).toHaveValue(2);fireEvent.click(screen.getByRole('button',{name:'Next pick'}));expect(screen.getByLabelText('Overall pick')).toHaveValue(7);expect(screen.getByRole('button',{name:'Next pick'})).toBeDisabled();
  });
  it('makes every pending asset reachable and renders missing weekly usage honestly',()=>{
    render(<DraftPhase4 detail={detail}/>);fireEvent.click(screen.getByRole('button',{name:'Asset history'}));fireEvent.click(screen.getByText(/Unresolved pick assets/));fireEvent.click(screen.getByRole('button',{name:'More assets'}));expect(screen.getByText(/Round 21/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Weekly contribution'}));expect(screen.getByText('Observed player')).toBeInTheDocument();expect(screen.getByText(/1\/2 final weeks covered/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Usage and sustained contribution'})).toBeInTheDocument();
  });
  it('labels provisional observations and departures without calling them bench appearances',()=>{
    const observed={...detail,resultsReport:{provisional:true,state:'partial',teams:[],coverage:'Provider-reported usage'},resultsObservedAt:'2026-10-06T04:00:00Z',phase4:{...detail.phase4!,contributions:[{...detail.phase4!.contributions![0],weeks:[{week:1,points:0,starter:false,held:false}]}]}} as ArchiveDetail;
    render(<DraftPhase4 detail={observed}/>);fireEvent.click(screen.getByRole('button',{name:'Weekly contribution'}));
    expect(screen.getByText(/Provisional provider-reported weekly usage/)).toBeInTheDocument();
    expect(screen.getByText(/scored weeks covered/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show weekly rows'));
    expect(screen.getByText(/Not on original roster/)).toBeInTheDocument();
    expect(screen.queryByText(/Week 1: 0.0 · Bench/)).not.toBeInTheDocument();
  });
  it('does not render absent player-week points or starts as zero',()=>{
    render(<DraftPhase4 detail={{...detail,phase4:{...detail.phase4!,contributions:[{...detail.phase4!.contributions![0],weeks:[],totalPoints:0,starterPoints:0,starts:0}]}}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Weekly contribution'}));
    expect(screen.getByText('Starter contribution / all recorded points: — / —')).toBeInTheDocument();
    expect(screen.getByText(/0\/2 final weeks covered · — starts/)).toBeInTheDocument();
  });
  it('explains provisional usage and original-roster departures in Spanish',()=>{
    language.language='es';
    render(<DraftPhase4 detail={{...detail,resultsReport:{provisional:true,state:'partial',teams:[],coverage:'Provider'},phase4:{...detail.phase4!,contributions:[{...detail.phase4!.contributions![0],weeks:[{week:1,points:0,starter:false,held:false}]}]}}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Contribución semanal'}));
    expect(screen.getByText(/Uso semanal provisional informado por el proveedor/)).toBeInTheDocument();
    expect(screen.getByText(/semanas puntuadas cubiertas/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mostrar filas semanales'));
    expect(screen.getByText(/Fuera de la plantilla original/)).toBeInTheDocument();
  });
});

it('explains finalized bench comparisons and preserves negative differences',()=>{
 const observed={...detail,weeklyOutcomes:{finalizedWeeks:[1],replacements:[{playerId:'p',rosterId:'a',week:1,state:'ready',replacementPlayerId:'bench',replacementPoints:20,difference:-10}]}} as ArchiveDetail
 render(<DraftPhase4 detail={observed}/>);fireEvent.click(screen.getByRole('button',{name:'Weekly contribution'}))
 expect(screen.getByText('Finalized bench replacement')).toBeInTheDocument();expect(screen.getByText(/Starter minus bench alternative.*-10.0/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Replacement evidence'})).toBeInTheDocument()
})
it('does not show missing finalization as zero replacement value in Spanish',()=>{
 language.language='es';render(<DraftPhase4 detail={{...detail,weeklyOutcomes:{finalizedWeeks:[],replacements:[]}}}/>);fireEvent.click(screen.getByRole('button',{name:'Contribución semanal'}))
 expect(screen.getByText('Todavía no hay comparaciones verificadas de reemplazo finalizado.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Evidencia de reemplazo'})).toBeInTheDocument()
})

it('shows negative historical cap space and explains mismatched coverage',()=>{
 const cap={...detail,specialtyEvidence:{capturedAt:'2026-08-01',collegeMode:null,collegeRounds:[],collegePlayers:0,salaryTeams:1,salaryContracts:0,dispersal:false,salaryHistory:{state:'partial',teams:[{rosterId:'a',capYear:2026,capSpace:-5,totalCapHit:15,deadMoneyHit:2,contracts:0,expiring:0,recordedSalary:0,matchesLedger:false}]}}} as ArchiveDetail;
 render(<DraftPhase4 detail={cap}/>);
 expect(screen.getByRole('region',{name:'Historical cap ledgers'})).toHaveTextContent('-5');
 expect(screen.getByText('Incomplete contract coverage')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Historical cap and contract coverage'})).toBeInTheDocument();
});
