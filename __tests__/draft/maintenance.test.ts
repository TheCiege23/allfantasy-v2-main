import {describe,it,expect,vi,beforeEach} from 'vitest';
const db=vi.hoisted(()=>({$executeRaw:vi.fn(),$queryRaw:vi.fn(),sportsDataCache:{findMany:vi.fn(),upsert:vi.fn(),deleteMany:vi.fn()}}));
const capture=vi.hoisted(()=>vi.fn());
const remaining=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/prisma',()=>({prisma:db}));
vi.mock('@/lib/cron/runBudget',()=>({createRunBudget:()=>({remainingMs:remaining,elapsedMs:()=>50})}));
vi.mock('@/lib/draft-archive/ingestion/importedResults',()=>({captureImportedResults:capture}));
import {maintainDraftResults} from '@/lib/draft-archive/ingestion/maintenance';
beforeEach(()=>{vi.clearAllMocks();db.$executeRaw.mockResolvedValue(1);db.sportsDataCache.findMany.mockResolvedValue([]);db.sportsDataCache.upsert.mockResolvedValue({});db.sportsDataCache.deleteMany.mockResolvedValue({count:1});remaining.mockReturnValue(180000);});
describe('scheduled draft result maintenance',()=>{
 it('does no source work when another runner owns the lease',async()=>{db.$executeRaw.mockResolvedValue(0);expect(await maintainDraftResults()).toMatchObject({skipped:'already_running',examined:0});expect(db.$queryRaw).not.toHaveBeenCalled();expect(db.sportsDataCache.deleteMany).not.toHaveBeenCalled();});
 it('isolates a failed source, records retry and continues the next source',async()=>{db.$queryRaw.mockResolvedValueOnce([{leagueId:'a',sourceId:'1',season:2025},{leagueId:'b',sourceId:'2',season:2025}]).mockResolvedValueOnce([]);capture.mockRejectedValueOnce(new Error('Recorded selection ownership differs from provider')).mockResolvedValueOnce({state:'ready',weeks:18});expect(await maintainDraftResults()).toMatchObject({examined:2,failed:1,ready:1});expect(capture).toHaveBeenNthCalledWith(2,'b','imported:2',true);expect(db.sportsDataCache.upsert).toHaveBeenCalledTimes(2);expect(db.sportsDataCache.deleteMany).toHaveBeenCalledWith({where:{cacheKey:'draft-analysis-maintenance:lease:v1',data:{path:['token'],equals:expect.any(String)}}});});
 it('leaves the queue for the next fire when the run has insufficient source headroom',async()=>{db.$queryRaw.mockResolvedValueOnce([{leagueId:'a',sourceId:'1',season:2025}]).mockResolvedValueOnce([]);remaining.mockReturnValue(99000);expect(await maintainDraftResults()).toMatchObject({selected:1,examined:0});expect(capture).not.toHaveBeenCalled();expect(db.sportsDataCache.upsert).not.toHaveBeenCalled();});
 it('blocks an oversized inventory and releases its own lease',async()=>{db.$queryRaw.mockResolvedValueOnce(Array(2001).fill({}));await expect(maintainDraftResults()).rejects.toThrow('inventory bound');expect(db.sportsDataCache.deleteMany).toHaveBeenCalledOnce();});
});
