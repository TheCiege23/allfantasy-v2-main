import {beforeEach,describe,it,expect,vi} from 'vitest'
const h=vi.hoisted(()=>({references:vi.fn(),start:vi.fn()}))
vi.mock('@/server/services/permissionService',()=>({canViewLeague:vi.fn().mockResolvedValue(true),isElevatedCommissioner:vi.fn().mockResolvedValue(false)}))
vi.mock('@/lib/core-app/draftHq',()=>({resolvePlayerNames:vi.fn().mockResolvedValue(new Map())}))
vi.mock('@/lib/draft-archive/catalog',()=>({draftArchiveCatalog:vi.fn().mockResolvedValue({choices:[{key:'native:d',leagueId:'l',source:'native',sourceId:'d',format:'auction',sport:'NFL',season:2026}]})}))
vi.mock('@/lib/draft-archive/references',()=>({draftReferences:h.references}))
vi.mock('@/lib/draft-archive/ledger',()=>({archiveLedger:h.start,archiveSequence:vi.fn().mockReturnValue(null)}))
vi.mock('@/lib/prisma',()=>({prisma:{draftSession:{findFirst:vi.fn().mockResolvedValue({id:'d',status:'completed',startedAt:new Date('2026-09-01'),auctionBudgetPerTeam:500})},draftPick:{findMany:vi.fn().mockResolvedValue([])},leagueAuditLog:{findMany:vi.fn().mockResolvedValue([])},draftPickTradeProposal:{findMany:vi.fn().mockResolvedValue([])},tradeExecutionSnapshot:{findMany:vi.fn().mockResolvedValue([])}}}))
import {draftArchiveDetail} from '@/lib/draft-archive/detail'
const context={sport:'NFL',season:2026,leagueType:'redraft',purpose:'standard',draftType:'auction',teamCount:2,playerPool:'all',scoring:'ppr',scoringRules:{rec:1},rosterSlots:['WR','BN']}
beforeEach(()=>{vi.clearAllMocks();h.references.mockResolvedValue([])})
describe('historical auction budget provenance',()=>{
  it('uses the original archived budget after a commissioner changes today’s budget',async()=>{
    h.start.mockResolvedValue([{createdAt:new Date('2026-09-01'),afterState:{snapshot:{context,analysisBasis:{version:'draft-analysis-basis-v2',entries:[]},session:{auctionBudgetPerTeam:200}}}}])
    await draftArchiveDetail('l','user','native:d')
    expect(h.references).toHaveBeenCalledWith(context,new Date('2026-09-01'),200)
  })
  it('does not substitute today’s budget when historical evidence is missing',async()=>{
    h.start.mockResolvedValue([{createdAt:new Date('2026-09-01'),afterState:{snapshot:{context,analysisBasis:{version:'draft-analysis-basis-v2',entries:[]},session:{}}}}])
    await draftArchiveDetail('l','user','native:d')
    expect(h.references).toHaveBeenCalledWith(context,new Date('2026-09-01'),null)
  })
})
