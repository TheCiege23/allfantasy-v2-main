import React from 'react'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react'
import {LanguageProviderClient,useLanguage} from '@/components/i18n/LanguageProviderClient'
import {GenericTradeAnalyzer} from '@/components/core-app/screens/GenericTradeAnalyzer'
import {TradeDecisionSummary} from '@/components/core-app/screens/TradeDecisionSummary'
import {TradeEvidencePanel} from '@/components/core-app/screens/TradeEvidencePanel'
import {TradePackageCost} from '@/components/core-app/screens/TradePackageCost'
import {ImpactNowReview} from '@/components/core-app/screens/ImpactNowReview'
import {PlayerValueHistoryChart} from '@/components/core-app/player-card/PlayerValueHistoryChart'
import {TradeReactionSettings,TradeReaction} from '@/components/core-app/screens/TradeReactions'
import {gradeTrade} from '@/lib/decision-os/trade/tradeGrade'
import {tradeVisualCopy} from '@/lib/core-app/tradeVisualCopy'
import {TradeFinderPanel} from '@/components/core-app/screens/TradeFinderPanel'
import {TradePartnerSuggestions} from '@/components/core-app/screens/TradePartnerSuggestions'
import {TradeCompetitiveEdge} from '@/components/core-app/screens/TradeCompetitiveEdge'
const grade=gradeTrade({giveValue:100,getValue:140,giveMarket:100,getMarket:140,unpriced:0,giveCount:1,getCount:1,basis:'Dynasty · Superflex · 12 teams',scoringApplied:false,needApplied:false,needGap:null,moves:[],lines:[{side:'give',assetKind:'player',name:'Josh Allen',marketValue:100,leagueValue:100,valueSource:'fantasycalc',valueAsOf:'2026-10-03'},{side:'get',assetKind:'player',name:'Justin Jefferson',marketValue:140,leagueValue:140,valueSource:'fantasycalc',valueAsOf:'2026-10-03'}]})
function Toggle(){const {setLanguage}=useLanguage();return <><button onClick={()=>setLanguage('es')}>Español</button><button onClick={()=>setLanguage('en')}>English</button></>}
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();document.documentElement.dataset.lang='en'})
function mockFetch(){
  const fetch=vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input)
    let body:unknown={}
    if(url.includes('player-value-history'))body={description:'Dynasty · Superflex',scope:'universal-market',note:'Recorded market prices, not fantasy points or league scoring adjustments. Missing capture weeks remain gaps.',points:[{day:'2026-09-08',value:100},{day:'2026-09-25',value:140}]}
    else if(url.includes('impact-now'))body={grade,impact:null,reason:'Current roster or starting slots are missing.',moved:[],returned:[],evaluatedAt:'2026-10-03T12:00:00Z',rostersStale:false,nonPlayers:false,note:'Latest recorded prices and current roster fit. This hypothetical undo is separate from recorded tenure production and does not predict a championship. Original evaluations remain unchanged.',realized:{asOf:'2026-10-03T12:00:00Z',stale:false,ongoing:true,receivedPoints:100,sentPoints:80,assets:[{direction:'received',name:'Josh Allen',points:100,seasons:{'2026':100},status:'No recorded departure in the scanned tenure'}],notes:[]}}
    else if(url.includes('/analyze'))body={grade,lastUpdated:'2026-10-03T12:00:00Z',dataGaps:[]}
    return {ok:true,json:async()=>body} as Response
  });vi.stubGlobal('fetch',fetch);return fetch
}
describe('English ↔ Spanish trade experience',()=>{
  it('switches older finder, partner and evidence panels without translating manager names',()=>{
    mockFetch()
    render(<LanguageProviderClient><Toggle/><TradeFinderPanel leagueId="l"/><TradePartnerSuggestions ranking={{partners:[],gaps:[]} as never} selectedRosterId={null} onChoose={()=>{}} onStartWith={()=>{}}/><TradeCompetitiveEdge access={null} partnerName="Casey Smith" edge={{available:false,reason:'No completed trades on file in this league.'}}/></LanguageProviderClient>)
    fireEvent.click(screen.getByRole('button',{name:'Español'}))
    expect(screen.getByRole('button',{name:'Buscar socios de intercambio'})).toBeTruthy()
    expect(screen.getByText('Mejores socios de intercambio')).toBeTruthy()
    expect(screen.getByText('No hay intercambios completados registrados en esta liga.')).toBeTruthy()
    expect(screen.getByRole('region',{name:'Ventaja competitiva · Casey Smith'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'English'}))
    expect(screen.getByRole('button',{name:'Find trade partners'})).toBeTruthy()
    expect(screen.getByText('Best trade partners')).toBeTruthy()
  })
  it('switches existing evaluation, history chart, package costs, receipts and reactions without regrading',async()=>{
    const fetch=mockFetch()
    render(<LanguageProviderClient><Toggle/><TradeDecisionSummary grade={grade} evaluatedAt="2026-10-03T12:00:00Z"/><TradeEvidencePanel grade={grade} evaluatedAt="2026-10-03T12:00:00Z"/><TradePackageCost cost={{capacity:16,activeBefore:16,activeAfter:17,requiredDrops:1,displacedStarters:[],candidates:[{playerId:'1',name:'Josh Allen',singleDropLineupCost:0}],note:'Roster capacity is unverified.'}}/><ImpactNowReview leagueId="l" trade={{kind:'af',tradeId:'t'}} original={grade}/><PlayerValueHistoryChart sleeperId="1" sport="NFL" unlocked/><TradeReactionSettings/><TradeReaction letter="A"/></LanguageProviderClient>)
    await waitFor(()=>expect(screen.getByText('Universal reference book',{exact:false})).toBeTruthy())
    fireEvent.click(screen.getByRole('button',{name:'Impact now',exact:true}))
    await waitFor(()=>expect(screen.getByText('Your trade receipt')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox',{name:/Chimmy reactions/}))
    fireEvent.click(screen.getByRole('button',{name:'Español'}))
    expect(screen.getByRole('region',{name:'Resumen de la decisión'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'Actualizar impacto actual'})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Valor a lo largo del tiempo'})).toBeTruthy()
    expect(screen.getByRole('img',{name:/Gráfico de valor de mercado por semanas/})).toBeTruthy()
    expect(screen.getByText('Tu comprobante del intercambio')).toBeTruthy()
    expect(screen.getByText('Activos enviados en los equipos receptores')).toBeTruthy()
    expect(document.documentElement.lang).toBe('es')
    expect(localStorage.getItem('af_lang')).toBe('es')
    expect(screen.getByText('Se necesita 1 baja para que este paquete quepa.')).toBeTruthy()
    expect(screen.getByText('Sube el valor. Deja que Chimmy cocine.')).toBeTruthy()
    expect(document.body.textContent).toContain('Tu equipo recibe 140 en valor cotizado')
    expect(document.body.textContent).toContain('Dinastía · Superflex · 12 equipos')
    expect(document.body.textContent).toContain('Josh Allen')
    expect(screen.queryByText('Why hesitate')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'English'}))
    expect(screen.getByRole('button',{name:'Refresh impact now'})).toBeTruthy()
    expect(screen.getByText('Value lift. Let Chimmy cook.')).toBeTruthy()
    expect(screen.getByRole('img',{name:/Recorded market value chart, weeks/})).toBeTruthy()
    expect(localStorage.getItem('af_lang')).toBe('en')
    expect(fetch.mock.calls.filter(([u])=>String(u).includes('impact-now'))).toHaveLength(1)
    expect(fetch.mock.calls.filter(([u])=>String(u).includes('player-value-history'))).toHaveLength(1)
  })
  it('localizes the generic analyzer, saved comparison and generated PNG in the current language',async()=>{
    const fetch=mockFetch(),fillText=vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillText,fillRect:vi.fn()} as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/png;base64,fixture')
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
    render(<LanguageProviderClient><Toggle/><GenericTradeAnalyzer/></LanguageProviderClient>)
    fireEvent.change(screen.getByRole('textbox',{name:'Team A sends'}),{target:{value:'Josh Allen'}})
    fireEvent.change(screen.getByRole('textbox',{name:'Team B sends'}),{target:{value:'Justin Jefferson'}})
    fireEvent.click(screen.getByRole('button',{name:'Analyze trade'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'Download share card'})).toBeTruthy())
    fireEvent.click(screen.getByRole('button',{name:'Español'}))
    expect(screen.getByRole('heading',{name:'Analizador rápido de intercambios'})).toBeTruthy()
    expect(screen.getByRole('textbox',{name:'El equipo A envía'}).getAttribute('placeholder')).toContain('ronda 1')
    expect(screen.getByRole('button',{name:'Analizar intercambio'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Descargar tarjeta para compartir'}))
    expect(fillText.mock.calls.flat()).toContain('ALLFANTASY · COMPARACIÓN DE INTERCAMBIOS')
    expect(fillText.mock.calls.flat()).toContain('El equipo A recibe más valor de mercado')
    expect(fillText.mock.calls.flat()).toContain('Josh Allen')
    fillText.mockClear()
    fireEvent.click(screen.getByRole('button',{name:'English'}))
    fireEvent.click(screen.getByRole('button',{name:'Download share card'}))
    expect(fillText.mock.calls.flat()).toContain('ALLFANTASY · TRADE COMPARISON')
    expect(fetch.mock.calls.filter(([u])=>String(u).includes('/analyze'))).toHaveLength(1)
  })
  it('translates dynamic limits and preserves player identity and evidence numbers',()=>{
    expect(tradeVisualCopy('Josh Allen: source is more than 7 days old.','es')).toBe('Josh Allen: la fuente tiene más de 7 días de antigüedad.')
    expect(tradeVisualCopy('If that player uses an active slot, this counter needs 2 drops under the recorded capacity.','es')).toContain('requiere 2 bajas')
    expect(tradeVisualCopy('Roster depth decreases at RB, WR.','es')).toContain('RB, WR')
  })
  it('accepts a Spanish draft-pick description without misidentifying it as a player',async()=>{
    const fetch=mockFetch()
    render(<LanguageProviderClient><Toggle/><GenericTradeAnalyzer/></LanguageProviderClient>)
    fireEvent.click(screen.getByRole('button',{name:'Español'}))
    fireEvent.change(screen.getByRole('textbox',{name:'El equipo A envía'}),{target:{value:'2027 ronda 1 temprana'}})
    fireEvent.change(screen.getByRole('textbox',{name:'El equipo B envía'}),{target:{value:'Josh Allen'}})
    fireEvent.click(screen.getByRole('button',{name:'Analizar intercambio'}))
    await waitFor(()=>expect(fetch.mock.calls.some(([url])=>String(url).endsWith('/analyze'))).toBe(true))
    const call=fetch.mock.calls.find(([url])=>String(url).endsWith('/analyze')) as unknown as [string,RequestInit]
    expect(JSON.parse(String(call[1].body)).sideGive[0]).toMatchObject({kind:'pick',year:2027,round:1,tier:'early'})
  })
})
