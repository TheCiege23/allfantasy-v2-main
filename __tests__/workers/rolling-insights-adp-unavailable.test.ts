import { afterEach, describe, expect, it, vi } from 'vitest'
import { rollingInsightsProvider } from '@/lib/workers/providers/rolling-insights'
describe('documented Rolling Insights ADP limitation',()=>{
  afterEach(()=>vi.unstubAllGlobals())
  it.each(['NFL','NBA','NHL','MLB'])('does not authenticate or guess endpoints for %s ADP',async sport=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    expect(await rollingInsightsProvider({sport,dataType:'adp'})).toMatchObject({
      data:null,source:'rolling_insights',latency:0,error:'Rolling Insights does not supply observed draft ADP',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
