import fs from 'node:fs'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {checkChimmyHallucination} from '@/lib/chimmy-chat/hallucination-guard'
import {judgeChimmyDelivery} from '@/lib/chimmy/chargeOnDelivery'
const route=fs.readFileSync(path.join(process.cwd(),'app/api/chat/chimmy/route.ts'),'utf8')
describe('Chimmy evidence and guarded delivery',()=>{
  it('validates against the server enrichment the model was actually given',()=>{
    expect(route).toContain('pecrGroundingText = [legacyEnrichmentContext,legacyMemorySection]')
    expect(route).toContain('responseGroundingText = [combinedMemorySection,pecrGroundingText]')
    expect(route).toContain('groundingText: responseGroundingText')
    const answer='Estimated playoff odds: 51.9%. Win: 64.3%. Lose: 39.9%.'
    const verified='Stored model estimates: 51.9%, 64.3%, 39.9%.'
    expect(checkChimmyHallucination(answer,{groundingText:verified,hasLeagueContext:true,userMessage:'Explain my playoff path'}).action).toBe('pass')
    const rejected=checkChimmyHallucination(answer,{groundingText:'Roster context only',hasLeagueContext:true,userMessage:'Explain my playoff path'})
    expect(rejected.action).toBe('replace')
    expect(judgeChimmyDelivery({modelOutputs:[{raw:answer}],answer:rejected.displayText,rejected:rejected.action==='replace'})).toEqual({delivered:false,reason:'rejected_answer'})
  })
  it('passes replacement state to settlement, preserving annotations as answers',()=>{
    expect(route).toContain("rejected: hallucinationCheck.action === 'replace'")
    expect(judgeChimmyDelivery({modelOutputs:[{raw:'A cautious answer'}],answer:'Verify missing data before deciding.',rejected:false})).toEqual({delivered:true})
  })
})
