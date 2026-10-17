import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),clips:vi.fn(),news:vi.fn(),sync:vi.fn(),dispatch:vi.fn()}))
vi.mock('@/app/api/cron/_auth',()=>({requireCronAuth:mocks.auth}))
vi.mock('@/lib/highlights/x-catalog',()=>({refreshXCatalog:mocks.clips}))
vi.mock('@/lib/workers/news-importer',()=>({runNewsImporter:mocks.news}))
vi.mock('@/app/api/sports/news/sync-helper',()=>({syncFullNewsCoverage:mocks.sync,syncEspnNewsOnly:mocks.sync}))
vi.mock('@/lib/notifications/PlayerNewsNotificationService',()=>({dispatchPendingPlayerNewsNotifications:mocks.dispatch}))
vi.mock('@/lib/production-health/syncJobRunTelemetry',()=>({recordSyncJobRun:vi.fn(),extractCommonCounts:vi.fn()}))
vi.mock('@/lib/cron/runBudget',()=>({createRunBudget:()=>({exhausted:()=>false}),respondBeforeEdge:async(fn:()=>Promise<unknown>)=>({result:await fn(),overran:false}),CRON_HARD_RESPONSE_MS:270000}))
import { GET } from '@/app/api/cron/import-news/route'
const request=(query='')=>new NextRequest('https://allfantasy.ai/api/cron/import-news'+query)
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockReturnValue(true);mocks.clips.mockResolvedValue({status:'ready',count:1});mocks.news.mockResolvedValue({imported:1,sports:['NFL']});mocks.sync.mockResolvedValue({total:1,breakdown:{espn:1}});mocks.dispatch.mockResolvedValue({})})
describe('X clips news cron integration',()=>{
 it('requires cron authentication before clip refresh',async()=>{mocks.auth.mockReturnValue(false);expect((await GET(request('?clips=1'))).status).toBe(401);expect(mocks.clips).not.toHaveBeenCalled()})
 it('supports a clip-only refresh without news ingestion or notification dispatch',async()=>{expect((await GET(request('?clips=1'))).status).toBe(200);expect(mocks.clips).toHaveBeenCalledTimes(1);expect(mocks.news).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled()})
 it('reports clip-only provider failures',async()=>{mocks.clips.mockRejectedValue(new Error('Unavailable'));expect((await GET(request('?clips=1'))).status).toBe(503)})
 it('refreshes clips in the full-news pass and isolates X failure',async()=>{mocks.clips.mockRejectedValue(new Error('Unavailable'));const response=await GET(request('?full=1'));expect(response.status).toBe(200);expect((await response.json()).clips).toEqual({status:'unavailable'});expect(mocks.news).toHaveBeenCalledTimes(1)})
 it('skips clips in ESPN-only and non-NFL passes',async()=>{await GET(request('?full=0'));await GET(request('?full=1&sport=NBA'));expect(mocks.clips).not.toHaveBeenCalled();expect(mocks.news).toHaveBeenCalledTimes(2)})
})

