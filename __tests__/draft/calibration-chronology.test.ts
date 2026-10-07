import {describe,it,expect,vi,beforeEach} from 'vitest';
import {preSeasonCalibration} from '@/lib/draft-archive/calibrationChronology';
const db=vi.hoisted(()=>({query:vi.fn(),opening:vi.fn(),detail:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:db.query,sportsGame:{findFirst:db.opening}}}));
vi.mock('@/lib/draft-archive/detail',()=>({draftArchiveDetail:db.detail}));
import {recomputeDraftCalibration} from '@/lib/draft-archive/ingestion/calibration';
const now=new Date('2026-10-06'),opening=new Date('2025-09-04');
describe('calibration chronology',()=>{
 it('accepts only draft-time forecasts before a recorded season opening',()=>{expect(preSeasonCalibration('2025-08-01',opening,2025,now)).toBe(true);expect(preSeasonCalibration('2025-09-04',opening,2025,now)).toBe(false);expect(preSeasonCalibration('2026-08-01',opening,2025,now)).toBe(false);});
 it('rejects unavailable, mismatched-year, invalid and unplayed opening dates',()=>{expect(preSeasonCalibration('2025-08-01',null,2025,now)).toBe(false);expect(preSeasonCalibration('2025-08-01',opening,2024,now)).toBe(false);expect(preSeasonCalibration('invalid',opening,2025,now)).toBe(false);expect(preSeasonCalibration('2027-08-01',new Date('2027-09-01'),2027,now)).toBe(false);});
});
beforeEach(()=>{vi.clearAllMocks();db.query.mockResolvedValue([{id:'d',leagueId:'l',userId:'u'}]);db.opening.mockResolvedValue({startTime:opening});db.detail.mockResolvedValue({startedAt:'2025-09-15',choice:{season:2025},snapshot:{context:{sport:'NFL',season:2025,leagueType:'redraft',purpose:'standard',draftType:'snake',teamCount:2,playerPool:'all',scoring:'ppr',scoringRules:{rec:1},rosterSlots:['WR']}},analysisReport:{state:'ready'},phase4:{replay:{state:'ready'},components:[{rosterId:'a',scores:[50,50,50,50]},{rosterId:'b',scores:[50,50,50,50]}]},resultsReport:{state:'ready',provisional:false,teams:[{rosterId:'a',starterPoints:20,weeks:Array.from({length:14},(_,i)=>i+1)},{rosterId:'b',starterPoints:10,weeks:Array.from({length:14},(_,i)=>i+1)}]}});});
it('does not train on a late-created historical league even with complete finalized rows',async()=>{expect(await recomputeDraftCalibration(false,100)).toMatchObject({examined:1,eligible:0,models:0,validated:0});expect(db.opening.mock.calls[0][0].where).toMatchObject({sport:'NFL',season:2025,seasonType:'regular',week:1});});
it('retains eligible pre-season evidence without inventing calibrated weights',async()=>{const detail=await db.detail();detail.startedAt='2025-08-01';db.detail.mockResolvedValue(detail);expect(await recomputeDraftCalibration(false,100)).toMatchObject({eligible:1,models:1,validated:0});});
it('blocks publication when official opening-date lookup fails',async()=>{db.opening.mockRejectedValueOnce(new Error('unavailable'));expect(await recomputeDraftCalibration(true,100)).toMatchObject({failed:1,models:0,validated:0});});
