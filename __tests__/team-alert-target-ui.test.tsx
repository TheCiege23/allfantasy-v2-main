import React from 'react'
import {render,screen,cleanup,waitFor} from '@testing-library/react'
import {describe,it,expect,vi,afterEach} from 'vitest'
const m=vi.hoisted(()=>({language:'en'}))
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:m.language})}))
import TeamDeadlineAlertTarget from '@/components/core-app/TeamDeadlineAlertTarget'
import TeamAlertTarget from '@/components/core-app/TeamAlertTarget'
import {teamInjuryAlertHref} from '@/lib/core-app/teamAlertTarget'
import type {MyTeamData} from '@/lib/core-app/myTeam'
const deadline=new Date(Date.now()+3600_000).toISOString()
const data={league:{id:'a',name:'Alpha'},starters:{available:true,data:[{slotLabel:'RB',player:{sleeperId:'p',name:'Starter',kickoff:deadline,ruledOut:true}}]}} as unknown as MyTeamData
HTMLElement.prototype.scrollIntoView=vi.fn()
afterEach(()=>{cleanup();m.language='en';history.replaceState(null,'','/');vi.restoreAllMocks()})
describe('injury alert review UI',()=>{
 it.each(['en','es'])('selects and focuses only the verified affected starter in %s',async language=>{m.language=language;history.replaceState(null,'',teamInjuryAlertHref('a','p',deadline,0));const review=vi.fn();render(<TeamAlertTarget data={data} onReview={review}/>);await waitFor(()=>expect(review).toHaveBeenCalledWith(0));expect(document.activeElement?.id).toBe('af-team-alert-decision');expect(screen.getByRole('status').textContent).toContain(language==='en'?'selected below':'seleccionada debajo')})
 it('selects a non-first affected slot without choosing a backup',async()=>{
  const second={...data,starters:{available:true,data:[{slotLabel:'RB',player:{sleeperId:'healthy',name:'Healthy',kickoff:deadline,ruledOut:false}},data.starters.available?data.starters.data[0]:null]}} as unknown as MyTeamData
  history.replaceState(null,'',teamInjuryAlertHref('a','p',deadline,1));const review=vi.fn();render(<TeamAlertTarget data={second} onReview={review}/>);await waitFor(()=>expect(review).toHaveBeenCalledWith(1));expect(review).not.toHaveBeenCalledWith(0)
 })
 it('does not select a starter for an outdated alert',async()=>{history.replaceState(null,'',teamInjuryAlertHref('a','old',deadline,0));const review=vi.fn();render(<TeamAlertTarget data={data} onReview={review}/>);await screen.findByText(/no longer in the original starting slot/);expect(review).not.toHaveBeenCalled()})
 it('updates same-league alert context after navigation without jumping on routine refresh',async()=>{history.replaceState(null,'',teamInjuryAlertHref('a','p',deadline,0));const review=vi.fn(),view=render(<TeamAlertTarget data={data} onReview={review}/>);await waitFor(()=>expect(review).toHaveBeenCalledWith(0));const scroll=vi.mocked(HTMLElement.prototype.scrollIntoView);scroll.mockClear();view.rerender(<TeamAlertTarget data={{...data}} onReview={review}/>);expect(scroll).not.toHaveBeenCalled();history.pushState(null,'',teamInjuryAlertHref('a','old',deadline,0));view.rerender(<TeamAlertTarget data={{...data}} onReview={review}/>);await screen.findByText(/no longer in the original starting slot/)})
})

 describe('alert context after sign-in',()=>{
  it('focuses the verified injury context even when sign-in omits the fragment',async()=>{
   history.replaceState(null,'',teamInjuryAlertHref('a','p',deadline,0).split('#')[0]);const review=vi.fn();render(<TeamAlertTarget data={data} onReview={review}/>);await waitFor(()=>expect(document.activeElement?.id).toBe('af-team-alert-decision'));expect(review).toHaveBeenCalledWith(0)
  })
  it.each(['en','es'])('focuses the recorded deadline without a fragment in %s',async language=>{
   m.language=language;render(<TeamDeadlineAlertTarget leagueId="a" events={[{key:'trade',label:'Trade deadline',at:deadline,when:deadline,detail:'Published in league settings.'}]} query={new URLSearchParams({league:'a',alertEvent:'trade',alertDeadline:deadline}).toString()}/>);await waitFor(()=>expect(document.activeElement?.id).toBe('af-team-deadline-alert'));expect(screen.getByRole('status').textContent).toContain(language==='en'?'recorded deadline':'plazo registrado')
  })
 })
