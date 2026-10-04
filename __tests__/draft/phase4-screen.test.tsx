import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {TextDecoder} from 'node:util';
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:'en'})}));
import {DraftPhase4} from '@/components/core-app/screens/DraftPhase4';
import type {ArchiveDetail} from '@/lib/draft-archive/detail';
const detail={choice:{key:'native:d',leagueId:'l'},picks:[{id:'a',overall:2,playerName:'First recorded player'},{id:'b',overall:7,playerName:'Later recorded player'}],coverage:[],phase4:{components:[],scores:[],calibration:null,dynasty:[],replay:{state:'unavailable',players:[],picks:[]},lineage:{state:'partial',lineages:[],pending:Array.from({length:21},(_,i)=>({season:2027,round:i+1,originalRosterId:'owner',from:'a',to:'b'}))},contributions:[{playerId:'p',name:'Observed player',rosterId:'a',state:'partial',weeks:[{week:1,points:10,starter:true}],expectedWeeks:2,totalPoints:10,starterPoints:10,starts:1,usage:null,earlyStarterPoints:null,lateStarterPoints:null}]}} as unknown as ArchiveDetail;
describe('draft analysis controls',()=>{
  it('preserves strict UTF-8 source for the Next.js compiler',()=>{
    expect(()=>new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(resolve(process.cwd(),'components/core-app/screens/DraftPhase4.tsx')))).not.toThrow();
  });
  it('replays actual recorded picks even with gaps in overall numbers',()=>{
    render(<DraftPhase4 detail={detail}/>);fireEvent.click(screen.getByRole('button',{name:'Replay a pick'}));expect(screen.getByLabelText('Overall pick')).toHaveValue(2);fireEvent.click(screen.getByRole('button',{name:'Next pick'}));expect(screen.getByLabelText('Overall pick')).toHaveValue(7);expect(screen.getByRole('button',{name:'Next pick'})).toBeDisabled();
  });
  it('makes every pending asset reachable and renders missing weekly usage honestly',()=>{
    render(<DraftPhase4 detail={detail}/>);fireEvent.click(screen.getByRole('button',{name:'Asset history'}));fireEvent.click(screen.getByText(/Unresolved pick assets/));fireEvent.click(screen.getByRole('button',{name:'More assets'}));expect(screen.getByText(/Round 21/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Weekly contribution'}));expect(screen.getByText('Observed player')).toBeInTheDocument();expect(screen.getByText(/1\/2 final weeks covered/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Usage and sustained contribution'})).toBeInTheDocument();
  });
});
