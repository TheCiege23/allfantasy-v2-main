import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {DraftAnalysis,weekRanges} from '@/components/core-app/screens/DraftAnalysis';
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

describe('the analysis block reads top to bottom',()=>{
  const team=(rosterId:string,rank:number|null,starterPoints:number,weeks:number[])=>({rosterId,name:'Club '+rosterId,rank,points:starterPoints+10,starterPoints,starts:3,weeks,coveredPicks:2});
  it('puts the title before the provisional note, and names each part state in a chip, not in the heading',()=>{
    const {container}=render(<DraftAnalysis results={{...results,state:'ready',teams:[team('a',1,9,[1])]}}/>);
    const order=[...container.querySelectorAll('h3, .af-analysis-note, h4')].map(e=>e.tagName);
    expect(order).toEqual(['H3','P','H4']);
    expect(container.querySelector('h4')?.textContent).toBe('Results to date');
    expect(container.querySelector('.af-analysis-state')?.textContent).toBe('Comparable recorded contribution');
    expect(container.querySelector('.af-analysis-state')?.getAttribute('data-tone')).toBe('ok');
  });
  it('lists teams best rank first, unranked teams last by what they produced',()=>{
    // Live /core 2026-11-06: the first row was rank 9.
    render(<DraftAnalysis results={{...results,state:'ready',teams:[team('nine',9,10,[1]),team('none-low',null,1,[1]),team('one',1,90,[1]),team('none-high',null,50,[1])]}}/>);
    const rows=[...screen.getByRole('region',{name:'Recorded contribution ranks'}).querySelectorAll('tbody tr')].map(r=>r.children[1].textContent);
    expect(rows).toEqual(['Club one','Club nine','Club none-high','Club none-low']);
  });
  it('shortens covered weeks to ranges',()=>{
    expect(weekRanges([1,2,3,4,5,6,7])).toBe('1–7');
    expect(weekRanges([9,1,2,4,10,2])).toBe('1–2, 4, 9–10');
    expect(weekRanges([])).toBe('');
    render(<DraftAnalysis results={{...results,state:'ready',teams:[team('a',1,9,[1,2,3,4,5,6,7])]}}/>);
    expect(screen.getByRole('cell',{name:'1–7'})).toBeInTheDocument();
  });
});
describe('readable provenance',()=>{
  it('shows when results were last read as a date, never the raw ISO instant',()=>{
    const {container}=render(<DraftResultsRefresh leagueId="l" archiveKey="imported:222" observedAt="2026-11-01T12:01:54.055Z"/>);
    expect(container.textContent).toMatch(/Results last read: Nov 1, 2026/);
    expect(container.textContent).not.toContain('2026-11-01T12:01:54.055Z');
  });
  it('names the reference format and dates in words',async()=>{
    const {DraftReferences}=await import('@/components/core-app/screens/DraftReferences');
    const ref={version:'draft-reference-v1',kind:'market_value',provider:'Stats Guy Fantasy',attributionUrl:null,observedAt:'2026-09-03T00:00:00Z',effectiveAt:'2026-08-31T23:59:59.999Z',historical:true,season:2026,identitySpace:'sleeper',format:'non_sf_redraft',entries:[]} as never;
    const {container}=render(<DraftReferences references={[ref]}/>);
    expect(container.querySelector('summary')?.textContent).toContain('1-QB redraft');
    expect(container.textContent).not.toContain('non_sf_redraft');
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    language.language='es';cleanup();
    const es=render(<DraftReferences references={[ref]}/>);
    expect(es.container.querySelector('summary')?.textContent).toContain('Redraft 1-QB');
  });
});
