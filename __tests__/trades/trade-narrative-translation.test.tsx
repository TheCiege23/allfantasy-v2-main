import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { protectTradeNarrative, tradeIdentityTerms } from '@/lib/i18n/tradeNarrativeProtection'
import { translateTradeNarratives } from '@/lib/i18n/translateTradeNarratives'
import { LanguageProviderClient, useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useTradeVisualCopy } from '@/components/core-app/screens/useTradeVisualCopy'
import { TradeTranslationStatus } from '@/components/core-app/screens/TradeTranslationStatus'
const {auth,limit}=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:auth}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/rate-limit',()=>({consumeRateLimit:limit}))
import { POST } from '@/app/api/i18n/translations/route'

const original='Josh Allen adds 14.2 points, a +12% lift. Casey Smith receives grade A-.'
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs()})
function Fixture({text=original}:{text?:string}) {
  const {setLanguage}=useLanguage()
  const context={lines:[{name:'Josh Allen'}],managerName:'Casey Smith'}
  const {copy,language,translationState,retryTranslation}=useTradeVisualCopy(context)
  return <><button onClick={()=>setLanguage('es')}>Español</button><button onClick={()=>setLanguage('en')}>English</button><p data-testid="prose">{copy(text)}</p><p>{copy('Josh Allen')}</p><strong>A-</strong><TradeTranslationStatus state={translationState} language={language} retry={retryTranslation}/></>
}
const request=(body:unknown)=>new Request('https://allfantasy.ai/api/i18n/translations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
describe('trade narrative display translation',()=>{
  it('masks and exactly restores identities, percentages, points, signs and grades; rejects token loss and fabricated numbers',()=>{
    const p=protectTradeNarrative(original,['Josh Allen','Casey Smith'])
    expect(p.masked).not.toContain('Josh Allen');expect(p.masked).not.toContain('14.2');expect(p.masked).not.toContain('A-')
    const translated=p.masked.replace('adds','añade').replace('points','puntos').replace('receives grade','recibe nota')
    expect(p.restore(translated)).toBe('Josh Allen añade 14.2 puntos, a +12% lift. Casey Smith recibe nota A-.')
    expect(p.restore(translated.replace('AFKEEP000000','Josh'))).toBeNull()
    expect(p.restore(translated+' 99')).toBeNull()
    expect(p.restore(translated+' AFKEEP000000')).toBeNull()
    expect(tradeIdentityTerms({give:[{name:'José Ramírez'}],partnerName:'quiet fox',grade:{letter:'A'}})).toEqual(['José Ramírez','quiet fox'])
    const accents=protectTradeNarrative('José Ramírez helps quiet fox score 100,0.', ['José Ramírez','quiet fox'])
    expect(accents.masked).not.toContain('quiet fox');expect(accents.restore(accents.masked)).toBe('José Ramírez helps quiet fox score 100,0.')
  })
  it('uses the configured Google API with masked text only and no private cache; rejects changed claims',async()=>{
    vi.stubEnv('GOOGLE_TRANSLATE_API_KEY','test-key')
    const fetch=vi.fn(async(_input:unknown,init:RequestInit)=>{
      const body=JSON.parse(String(init.body))
      expect(body.q[0]).not.toContain('Josh Allen');expect(body.q[0]).not.toContain('Casey Smith')
      expect(body.target).toBe('es');expect(body.format).toBe('text');expect(init.cache).toBe('no-store')
      return {ok:true,json:async()=>({data:{translations:[{translatedText:body.q[0].replace('adds','añade')}]}})} as Response
    })
    vi.stubGlobal('fetch',fetch)
    expect(await translateTradeNarratives([original],'es',['Josh Allen','Casey Smith'])).toEqual([original.replace('adds','añade')])
    expect(await translateTradeNarratives([original],'es',['Josh Allen','Casey Smith'])).toEqual([original.replace('adds','añade')])
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({data:{translations:[{translatedText:'Now gains 99 points.'}]}})} as Response))
    expect(await translateTradeNarratives([original],'es',[])).toEqual([null])
  })
  it('withholds translation for absent configuration and provider failure',async()=>{
    vi.stubEnv('GOOGLE_TRANSLATE_API_KEY','')
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    expect(await translateTradeNarratives([original],'es',[])).toEqual([null]);expect(fetch).not.toHaveBeenCalled()
    vi.stubEnv('GOOGLE_TRANSLATE_API_KEY','test-key');fetch.mockRejectedValue(new Error('offline'))
    expect(await translateTradeNarratives([original],'es',[])).toEqual([null])
  })
  it('authenticates, rate limits and validates before any provider call',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    auth.mockResolvedValue(null);limit.mockReturnValue({success:true})
    expect((await POST(request({}))).status).toBe(401)
    auth.mockResolvedValue({user:{id:'user'}});limit.mockReturnValue({success:false,retryAfterSec:30})
    expect((await POST(request({}))).status).toBe(429)
    limit.mockReturnValue({success:true})
    for(const body of [{kind:'trade-narrative',language:'fr',texts:['Hello']},{kind:'trade-narrative',language:'es',texts:['x'.repeat(2001)]},{kind:'trade-narrative',language:'es',texts:['x'.repeat(2000),'x'.repeat(2000),'x'.repeat(2000),'x'.repeat(2000),'x']},{kind:'trade-narrative',language:'es',texts:['AFKEEP000000']}]) expect((await POST(request(body))).status).toBe(400)
    expect((await POST(new Request('https://allfantasy.ai/api/i18n/translations',{method:'POST',body:'x'.repeat(96001)}))).status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('returns private no-store responses with explicit incomplete status when configuration is missing',async()=>{
    auth.mockResolvedValue({user:{id:'user'}});limit.mockReturnValue({success:true});vi.stubEnv('GOOGLE_TRANSLATE_API_KEY','')
    const response=await POST(request({kind:'trade-narrative',language:'es',texts:[original],identities:['Josh Allen','Casey Smith']}))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({translations:[null],complete:false})
  })
  it('updates freeform prose en → es → en, preserves names and grades, and reuses only its local display cache',async()=>{
    const fetch=vi.fn(async(input:unknown,init?:RequestInit)=>{
      if(String(input)!=='/api/i18n/translations'||!init?.body) return {ok:true,json:async()=>({messages:{}})} as Response
      const body=JSON.parse(String(init.body));expect(body.identities).toContain('Josh Allen');expect(body.identities).toContain('Casey Smith')
      return {ok:true,json:async()=>({translations:body.texts.map((text:string)=>text.replace('adds','añade').replace('points','puntos'))})} as Response
    });vi.stubGlobal('fetch',fetch)
    render(<LanguageProviderClient><Fixture/></LanguageProviderClient>)
    expect(screen.getByTestId('prose').textContent).toBe(original)
    fireEvent.click(screen.getByText('Español'))
    await waitFor(()=>expect(screen.getByTestId('prose').textContent).toContain('añade 14.2 puntos'))
    expect(screen.getByText('A-')).toBeTruthy();expect(screen.getByText('Josh Allen')).toBeTruthy()
    fireEvent.click(screen.getByText('English'));expect(screen.getByTestId('prose').textContent).toBe(original)
    fireEvent.click(screen.getByText('Español'));expect(screen.getByTestId('prose').textContent).toContain('añade')
    expect(fetch.mock.calls.filter(([input,init])=>String(input)==='/api/i18n/translations'&&init?.method==='POST')).toHaveLength(1)
  })
  it('keeps original text visible after a failure and offers a working retry',async()=>{
    let attempts=0
    vi.stubGlobal('fetch',vi.fn(async(input:unknown,init?:RequestInit)=>{
      if(String(input)!=='/api/i18n/translations'||!init?.body) return {ok:true,json:async()=>({messages:{}})} as Response
      attempts++;return {ok:attempts>1,json:async()=>({translations:[original.replace('adds','añade')]})} as Response
    }))
    render(<LanguageProviderClient><Fixture/></LanguageProviderClient>);fireEvent.click(screen.getByText('Español'))
    await waitFor(()=>expect(screen.getByRole('button',{name:'Reintentar traducción'})).toBeTruthy())
    expect(screen.getByTestId('prose').textContent).toBe(original)
    fireEvent.click(screen.getByRole('button',{name:'Reintentar traducción'}))
    await waitFor(()=>expect(screen.getByTestId('prose').textContent).toContain('añade'))
    expect(attempts).toBe(2)
  })
  it('does not display a late Spanish response after switching back to English',async()=>{
    let resolve:((value:Response)=>void)|undefined
    vi.stubGlobal('fetch',vi.fn(async(input:unknown,init?:RequestInit)=>{
      if(String(input)!=='/api/i18n/translations'||!init?.body)return {ok:true,json:async()=>({messages:{}})} as Response
      return new Promise<Response>(done=>{resolve=done})
    }))
    render(<LanguageProviderClient><Fixture/></LanguageProviderClient>);fireEvent.click(screen.getByText('Español'))
    await waitFor(()=>expect(resolve).toBeTruthy());fireEvent.click(screen.getByText('English'))
    resolve!({ok:true,json:async()=>({translations:['texto atrasado']})} as Response)
    await waitFor(()=>expect(screen.getByTestId('prose').textContent).toBe(original))
  })
})
