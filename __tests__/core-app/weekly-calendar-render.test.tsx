import React from 'react'
import { afterEach,describe,it,expect,vi } from 'vitest'
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
vi.mock('next/link',()=>({default:({children,href}:any)=><a href={href}>{children}</a>}))
const lang=vi.hoisted(()=>({language:'en'}))
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:lang.language})}))
import { WeeklyCalendar } from '@/components/core-app/WeeklyCalendar'
import { buildWeeklyCalendar } from '@/lib/core-app/weeklyCalendar'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
afterEach(()=>{cleanup();lang.language='en'})
describe('weekly calendar controls',()=>{
 it('names processing as reclamos in Spanish and keeps the missing date explicit',()=>{
 lang.language='es';const now=new Date('2026-10-06T12:00:00Z');const data=buildWeeklyCalendar([{id:'A',name:'Liga',settings:{nextWaiverRunAt:'2026-10-07T12:00:00Z'}},{id:'B',name:'Otra liga'}],now);render(<WeeklyCalendar data={data}/>);expect(screen.getByText('Procesamiento de reclamos')).toBeTruthy();expect(screen.getByText(/próximo procesamiento de reclamos no disponible/)).toBeTruthy()
 })
 it('shows timezone and confirmed dates, with reminders off until chosen',()=>{
 const data=buildWeeklyCalendar([{id:'A',name:'My league',settings:{lineupLockAt:'2026-10-08T20:00:00-04:00'}}],new Date('2026-10-06T12:00:00Z'))
 render(<WeeklyCalendar data={data}/>);expect(screen.getByText('Lineup lock')).toBeTruthy();expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
 fireEvent.change(screen.getByLabelText('Calendar timezone'),{target:{value:'UTC'}});expect(document.querySelector('time')?.textContent).toContain('Oct 9')
 const capture=vi.fn();window.addEventListener(COMMS_OPEN_EVENT,capture);fireEvent.click(screen.getByText('Plan with Chimmy'));expect(capture.mock.calls[0][0].detail).toMatchObject({leagueId:'A',tab:'chimmy'});expect(capture.mock.calls[0][0].detail.prefill).toContain('2026-10-09T00:00:00.000Z');window.removeEventListener(COMMS_OPEN_EVENT,capture)
 })
 it('exposes missing data and a failed calendar distinctly',()=>{const {rerender}=render(<WeeklyCalendar data={buildWeeklyCalendar([{id:'A',name:'League'}],new Date('2026-10-06'))}/>);expect(screen.getByText(/No confirmed dated events/)).toBeTruthy();expect(screen.getByText(/Dates still to confirm/)).toBeTruthy();rerender(<WeeklyCalendar/>);expect(screen.getByRole('status').textContent).toContain('unavailable')})
})
