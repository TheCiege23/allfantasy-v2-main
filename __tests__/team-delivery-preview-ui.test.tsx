import React from 'react'
import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({language:'en'}))
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:m.language})}))
import DeliveryReceipt from '@/components/core-app/DeliveryReceipt'
import NativeAutoSubsPreview from '@/components/core-app/NativeAutoSubsPreview'
afterEach(()=>{cleanup();m.language='en'})
describe('clear bilingual preview and delivery copy',()=>{
 it.each(['en','es'])('explains a manual lineup pause in %s',language=>{m.language=language;render(<NativeAutoSubsPreview assessment={{checkedAt:'2026-10-06T05:00:00Z',state:'paused',reason:'lineup_changed',slots:[]}}/>);expect(screen.getByRole('status').textContent).toContain(language==='en'?'lineup changed':'alineación cambió')})
 it('does not invent delivery when a receipt is missing',()=>{render(<DeliveryReceipt receipt={null}/>);expect(screen.getByText(/Delivery is unconfirmed/)).toBeTruthy()})
 it('shows partial push acceptance and an explicit display limitation',()=>{render(<DeliveryReceipt receipt={{completedAt:'2026-10-06T05:00:00Z',channels:{inApp:{status:'stored',reason:'in_app_saved'},email:{status:'accepted',reason:'provider_accepted'},sms:{status:'suppressed',reason:'quiet_hours'},push:{status:'partial',reason:'provider_accepted',endpoints:2,acceptedEndpoints:1}}}}/>);expect(screen.getByText(/1\/2 endpoints/)).toBeTruthy();expect(screen.getByText(/Push display on a device is unconfirmed/)).toBeTruthy();expect(screen.getByText(/Quiet hours/)).toBeTruthy()})
})
