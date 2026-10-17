// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(()=>{vi.resetModules();vi.stubEnv('APP_URL','https://allfantasy.ai');vi.stubEnv('CRON_SECRET','test-only-secret');vi.stubEnv('DRY_RUN','1');fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);vi.spyOn(console,'log').mockImplementation(()=>{})})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks()})
describe('deadline scheduler deployment and privacy gate',()=>{
  it('calls only authenticated dry runs after the repair capability deploys and logs aggregate counts',async()=>{
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({ok:true,sha:'deploy',capabilities:{bigBrotherDeadlines:1}})}).mockResolvedValue({ok:true,json:async()=>({ok:true,processed:1,errors:[],privateBallot:'never-log-this'})})
    await import('../scripts/big-brother-deadlines.mjs')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    for(const [url,options] of fetchMock.mock.calls.slice(1)) {
      expect(String(url)).toContain('dryRun=1');expect(options.method).toBe('POST');expect(options.headers.Authorization).toBe('Bearer test-only-secret');expect(options.redirect).toBe('error')
    }
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('never-log-this')
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('test-only-secret')
  })
  it('stops on an unverified health response before any mutations',async()=>{
    fetchMock.mockResolvedValue({ok:true,json:async()=>({ok:false})})
    await expect(import('../scripts/big-brother-deadlines.mjs')).rejects.toThrow('verified build marker')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('fails on an authenticated job error without echoing private diagnostics',async()=>{
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({ok:true,sha:'deploy',capabilities:{bigBrotherDeadlines:1}})}).mockResolvedValue({ok:true,json:async()=>({ok:false,errors:['private-league-detail']})})
    await expect(import('../scripts/big-brother-deadlines.mjs')).rejects.toThrow('reported errors')
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('private-league-detail')
  })
})
