// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({statIngestionJob:{create:vi.fn(),update:vi.fn()},playerGameStat:{upsert:vi.fn()},$transaction:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('@/lib/multi-sport/ScoringTemplateResolver',()=>({getScoringTemplate:vi.fn().mockResolvedValue({rules:[]}),getLeagueScoringRules:vi.fn()}))
vi.mock('@/lib/scoring-defaults/FantasyPointCalculator',()=>({computeFantasyPoints:vi.fn().mockReturnValue(0)}))
import {ingestSportStats} from '@/lib/schedule-stats/StatIngestionService'
describe('provider provenance on ingestion',()=>{
 beforeEach(()=>{vi.clearAllMocks();db.statIngestionJob.create.mockResolvedValue({id:'job'});db.$transaction.mockResolvedValue([])})
 it('preserves the actual provider on both insertion and correction',async()=>{await ingestSportStats({sportType:'NCAAF',season:2026,weekOrRound:4,source:'cfbd-weekly',playerStats:[{playerId:'4805256',gameId:'cfbd:401856697',statPayload:{'receiving.REC':3}}]});const write=db.playerGameStat.upsert.mock.calls[0]![0];expect(write.create.source).toBe('cfbd-weekly');expect(write.update.source).toBe('cfbd-weekly');expect(write.update.normalizedStatMap['receiving.REC']).toBe(3)})
})
