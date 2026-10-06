import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {DraftAnalysis} from '@/components/core-app/screens/DraftAnalysis';
import {DraftResultsRefresh} from '@/components/core-app/screens/DraftResultsRefresh';
import type {ResultsReport} from '@/lib/draft-archive/analysisModel';
const language=vi.hoisted(()=>({language:'en'}));
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>language}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/lib/draft-archive/historyActions',()=>({refreshHistoricalResults:vi.fn()}));
beforeEach(()=>{language.language='en';});
const results:ResultsReport={state:'partial',provisional:true,coverage:'Provider-reported scored weeks',teams:['a','b'].map(rosterId=>({rosterId,name:rosterId,rank:null,points:0,starterPoints:0,starts:0,weeks:[],coveredPicks:0}))};
describe('result provenance and server-rendered help',()=>{
  it.each([['en','Covered scored weeks'],['es','Semanas puntuadas cubiertas']])('labels imported periods as scored rather than finalized in %s',(locale,heading)=>{
    language.language=locale;render(<DraftAnalysis results={results}/>);
    expect(screen.getByRole('columnheader',{name:heading})).toBeInTheDocument();
    expect(screen.queryByRole('columnheader',{name:/Covered final weeks|Semanas finales cubiertas/})).not.toBeInTheDocument();
    if(locale==='es')expect(screen.getByText(/Puntos provisionales informados por el proveedor/)).toBeInTheDocument();
  });
  it('keeps finalized native evidence distinct',()=>{
    render(<DraftAnalysis results={{...results,provisional:false}}/>);
    expect(screen.getByRole('columnheader',{name:'Covered final weeks'})).toBeInTheDocument();
    expect(screen.queryByText(/Results use provisional/)).not.toBeInTheDocument();
  });
  it('keeps explanation text inside the popover after HTML parsing',()=>{
    for(const view of [<DraftAnalysis results={results}/>,<DraftResultsRefresh leagueId="l" archiveKey="imported:222"/>]) {
      const host=document.createElement('div');host.innerHTML=renderToString(view);
      const popover=host.querySelector('.af-info-pop');
      expect(popover?.querySelector('.af-info-para')?.textContent).toMatch(/recorded|retrieve/);
      expect(popover?.querySelector('p')).toBeNull();
    }
  });
});
