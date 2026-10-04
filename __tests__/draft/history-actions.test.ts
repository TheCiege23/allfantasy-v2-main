import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({auth:vi.fn(),gate:vi.fn(),limit:vi.fn(),list:vi.fn(),preview:vi.fn(),apply:vi.fn()}));
vi.mock('@/lib/auth-guard',()=>({requireAuth:mock.auth}));
vi.mock('@/server/services/permissionService',()=>({isElevatedCommissioner:mock.gate}));
vi.mock('@/lib/rate-limit',()=>({consumeRateLimit:mock.limit}));
vi.mock('@/lib/draft-archive/ingestion/reconciliation',()=>({reconciliationSources:mock.list,reconciliationPreview:mock.preview,applyReconciliation:mock.apply}));
vi.mock('@/lib/draft-archive/ingestion/importedResults',()=>({captureImportedResults:vi.fn()}));
import { listHistorySources, previewHistorySource, confirmHistorySource } from '@/lib/draft-archive/historyActions';
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({ok:true,userId:'u'});mock.gate.mockResolvedValue(true);mock.limit.mockReturnValue({success:true});});
describe('history review permissions',()=>{
  it('denies before any provider or database reconciliation read',async()=>{mock.gate.mockResolvedValue(false);expect(await listHistorySources('l','legacy:NFL:2026')).toEqual({ok:false});expect(mock.list).not.toHaveBeenCalled();});
  it('denies unauthenticated and rate limited calls',async()=>{mock.auth.mockResolvedValue({ok:false});await previewHistorySource('l','key','123');expect(mock.preview).not.toHaveBeenCalled();mock.auth.mockResolvedValue({ok:true,userId:'u'});mock.limit.mockReturnValue({success:false});await confirmHistorySource('l','key','123','a'.repeat(64),'Known draft evidence');expect(mock.apply).not.toHaveBeenCalled();});
  it('requires a review digest and explanatory reason',async()=>{await confirmHistorySource('l','key','123','bad','short');expect(mock.apply).not.toHaveBeenCalled();mock.apply.mockResolvedValue(3);expect(await confirmHistorySource('l','key','123','a'.repeat(64),'Verified against original draft')).toEqual({ok:true,count:3});});
});
