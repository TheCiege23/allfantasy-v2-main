// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { gateAnalysisAccess } from '@/lib/chimmy/analysisAccess'
import { issueAnalysisQuote, verifyAnalysisQuote } from '@/lib/chimmy/analysisQuote'
import { fingerprintChimmyRequest } from '@/lib/chimmy/requestFingerprint'
import { buildFreeAnalysisSummary, readDeepAnalysisPreview } from '@/lib/chimmy/deepAnalysisPreview'
const form = () => { const f = new FormData(); f.set('requestId','request-one'); f.set('analysisPreviewVersion','1'); f.set('message','Should I change my lineup?'); f.set('assistantMode','deep_analysis'); return f }
const quoteInput = { userId:'u1', requestId:'request-one', fingerprint:'original', tokenCost:3, access:'tokens' as const }
const plan = { kind:'free' as const, included:false, planName:'Free Chimmy', used:2, limit:2, resetsAt:'2026-10-26T00:00:00.000Z' }
const previewSpend = vi.fn(async () => ({ tokenCost:3, currentBalance:20, canSpend:true, ruleCode:'ai_chimmy_chat_message' } as any))
const gate = (f: FormData, extra = {}) => gateAnalysisAccess({ userId:'u1', form:f, mode:f.get('analysisUnlock') ? 'deep_analysis' : String(f.get('assistantMode')), summary:'Keep an eligible starter and check the injury report before kickoff.', plan, previewSpend, hasReceipt:true, ...extra })
beforeEach(() => { vi.stubEnv('NEXTAUTH_SECRET','unit-test-analysis-signing-key'); previewSpend.mockClear() })
it('binds consent to user, request, question, price, access and expiry', () => {
 const deps = {secret:'test-key',now:()=>1000}; const {quote} = issueAnalysisQuote(quoteInput,deps)
 expect(verifyAnalysisQuote(quote,quoteInput,deps)).toBe(true)
 for (const change of [{userId:'u2'},{requestId:'other'},{fingerprint:'changed'},{tokenCost:2},{tokenCost:4},{access:'daily_answer' as const}]) expect(verifyAnalysisQuote(quote,{...quoteInput,...change},deps)).toBe(false)
 expect(verifyAnalysisQuote(quote+'x',quoteInput,deps)).toBe(false)
 expect(verifyAnalysisQuote(quote,quoteInput,{...deps,now:()=>601000})).toBe(false)
})
it('returns only a free summary and placeholder descriptions before consent', async () => {
 const result = await gate(form()); expect(result.allowed).toBe(false)
 if (result.allowed) throw Error('unexpected access')
 const p = readDeepAnalysisPreview(result.payload.analysisPreview)!
 expect(p.tokenCost).toBe(3); expect(p.currentBalance).toBe(20); expect(p.summary).toContain('injury report')
 expect(result.payload.meta).toMatchObject({free:true,tokenSpend:null})
 expect(JSON.stringify(result.payload)).not.toContain('fullResponse')
 expect(Object.keys(p.sections[0]).sort()).toEqual(['description','title'])
 expect(readDeepAnalysisPreview({...p,fullResponse:'SECRET',sections:[{...p.sections[0],report:'SECRET'}]})).not.toHaveProperty('fullResponse')
})
it('allows exactly the quoted paid price only after an explicit unlock and durable identity', async () => {
 const f=form(); const first=await gate(f); if(first.allowed) throw Error('expected preview')
 const p=readDeepAnalysisPreview(first.payload.analysisPreview)!;f.set('tokenQuote',p.quote);f.set('confirmTokenSpend','true');f.set('analysisUnlock','true')
 expect(await gate(f)).toMatchObject({allowed:true,expectedTokenCost:3})
 expect(await gate(f,{hasReceipt:false})).toMatchObject({allowed:false,status:400})
 f.set('message','Different question');expect(await gate(f)).toMatchObject({allowed:false,status:409})
})
it('reconfirms either a higher or a lower price without authorizing a debit', async () => {
 for(const cost of [2,4]) { const f=form();const first=await gate(f);if(first.allowed)throw Error('expected preview')
 f.set('tokenQuote',readDeepAnalysisPreview(first.payload.analysisPreview)!.quote);f.set('confirmTokenSpend','true');f.set('analysisUnlock','true')
 const changed=await gate(f,{previewSpend:async()=>({tokenCost:cost,currentBalance:20,canSpend:true})})
 expect(changed).toMatchObject({allowed:false,status:409,payload:{analysisPreview:{tokenCost:cost}}}) }
})
it('keeps summaries independent of the included detailed-answer allowance', async () => {
 const f=form(); f.set('assistantMode','fast_take')
 const result=await gate(f,{plan:{...plan,used:0}})
 expect(result).toMatchObject({allowed:false,payload:{analysisPreview:{access:'daily_answer',dailyRemaining:2,tokenCost:0}}})
 expect(previewSpend).not.toHaveBeenCalled()
 f.set('analysisUnlock','true');expect(await gate(f,{plan:{...plan,used:0}})).toMatchObject({allowed:true,tokenPreview:null})
})
it('keeps full included answers available without a wallet preflight', async () => {
 expect(await gate(form(),{plan:{...plan,used:1}})).toMatchObject({allowed:true,tokenPreview:null})
 expect(previewSpend).not.toHaveBeenCalled()
})
it('fingerprints attachments and context but excludes consent fields', async () => {
 const f=form();const hash=await fingerprintChimmyRequest(f); f.set('tokenQuote','price');f.set('analysisUnlock','true');f.set('confirmTokenSpend','true')
 expect(await fingerprintChimmyRequest(f)).toBe(hash);f.set('leagueId','changed');expect(await fingerprintChimmyRequest(f)).not.toBe(hash)
})
it('uses verified engine sentences and practical guidance without inventing a player verdict', () => {
 expect(buildFreeAnalysisSummary({question:'lineup',engineAnswer:'Start A. Check the injury report. PRIVATE breakdown and projections.'})).toBe('Start A. Check the injury report.')
 expect(buildFreeAnalysisSummary({question:'Should I trade?',leagueName:'My league'})).toContain('For My league, compare')
})

it('answers common rules questions directly without inventing league-specific settings', () => {
 expect(buildFreeAnalysisSummary({question:'Explain PPR scoring'})).toContain('half PPR adds 0.5')
 expect(buildFreeAnalysisSummary({question:'What is superflex?'})).toContain('start a quarterback')
 expect(buildFreeAnalysisSummary({question:'What does FAAB mean?'})).toContain('blind waiver bids')
 expect(buildFreeAnalysisSummary({question:'Which unknown mystery option wins?'})).toContain('do not have a verified')
})
