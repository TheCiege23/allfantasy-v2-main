import {describe,it,expect,vi,beforeEach} from 'vitest'
import {applyStarterSwap} from '@/lib/roster/starterSwap'

const db=vi.hoisted(()=>({league:{findUnique:vi.fn()},roster:{findFirst:vi.fn()},$transaction:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('@/lib/multi-sport/MultiSportRosterService',()=>({getRosterTemplateForLeague:vi.fn(async()=>({}))}))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry',()=>({getFormatTypeForVariant:()=>null}))
vi.mock('@/lib/roster-lineup-engine/rosterValidationService',()=>({validateCanonicalRosterPayload:()=>({ok:true})}))
vi.mock('@/lib/roster-lineup-engine/lineupAssignmentSync',()=>({syncAfRosterLineupAssignments:vi.fn()}))
vi.mock('@/lib/roster-lineup-engine/rosterMoveHistory',()=>({recordAfRosterMoveHistory:vi.fn()}))
vi.mock('@/lib/roster-lineup-engine/lineupLockService',()=>({resolveFullLineupLockContext:vi.fn(async()=>({locked:false,lockedPlayerIds:[],policy:'individual'})),upsertAfLineupLockState:vi.fn()}))
vi.mock('@/lib/league-events/publisher',()=>({publishLeagueFanoutEvent:vi.fn(async()=>{})}))
import {persistRosterLineupWithEngine} from '@/lib/roster-lineup-engine/lineupService'

const pd={starters:['a'],players:['a','b','ir'],lineup_sections:{starters:[{id:'a',position:'RB',name:'Starter',status:'healthy'}],bench:[{id:'b',position:'RB',name:'Backup',status:'healthy'}],ir:[{id:'ir',position:'RB',status:'IR'}]}}
beforeEach(()=>{vi.clearAllMocks();db.league.findUnique.mockResolvedValue({id:'L',sport:'NFL',settings:{week:5}});db.roster.findFirst.mockResolvedValue({id:'R',playerData:pd})})
describe('native starter swaps',()=>{
 it('moves stored metadata between starter and bench and preserves IR',()=>{const result=applyStarterSwap(pd,0,'b');expect(result.starters).toEqual(['b']);expect(result.players).toEqual(['b','a','ir']);expect(result.lineup_sections).toMatchObject({starters:[{id:'b',name:'Backup'}],bench:[{id:'a',name:'Starter'}],ir:[{id:'ir',status:'IR'}]});expect(pd.starters).toEqual(['a'])})
 it('rejects candidates outside the bench and invalid slots',()=>{expect(()=>applyStarterSwap(pd,0,'ir')).toThrow('bench');expect(()=>applyStarterSwap(pd,5,'b')).toThrow('slot')})
 it('rejects a screen whose lineup has changed before validation',async()=>{expect(await persistRosterLineupWithEngine({leagueId:'L',rosterId:'R',actorUserId:'u',nextPlayerData:applyStarterSwap(pd,0,'b'),season:2026,week:5,source:'user_save',expectedStarters:['old']})).toMatchObject({ok:false,status:409});expect(db.$transaction).not.toHaveBeenCalled()})
 it('uses an atomic JSON comparison and rejects a concurrent roster edit',async()=>{const updateMany=vi.fn(async()=>({count:0}));db.$transaction.mockImplementation(async f=>f({roster:{updateMany}}));expect(await persistRosterLineupWithEngine({leagueId:'L',rosterId:'R',actorUserId:'u',nextPlayerData:applyStarterSwap(pd,0,'b'),season:2026,week:5,source:'user_save',expectedStarters:['a']})).toMatchObject({ok:false,status:409});expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'R',playerData:{equals:pd}}}))})
})
