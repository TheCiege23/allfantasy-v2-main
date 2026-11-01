import {afterEach,beforeEach,describe,expect,it,vi} from "vitest"
import {NextRequest} from "next/server"
const m=vi.hoisted(()=>({auth:vi.fn(),cup:vi.fn(),cfp:vi.fn(),sweep:vi.fn()}))
vi.mock("@/app/api/cron/_auth",()=>({requireCronAuth:m.auth}))
vi.mock("@/lib/playoffs/syncNbaCupTournament",()=>({syncNbaCupTournament:m.cup}))
vi.mock("@/lib/playoffs/syncSeasonBracketResults",()=>({syncSeasonBracketResults:m.cfp}))
vi.mock("@/lib/playoffs/bracketExperienceService",()=>({sweepBracketExperience:m.sweep}))
import {POST} from "@/app/api/cron/season-bracket-results/route"
const request=(body:unknown)=>new NextRequest("https://example.test/api/cron/season-bracket-results",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.auth.mockReturnValue(true);m.cup.mockResolvedValue({applied:true,failures:[]});m.cfp.mockResolvedValue({applied:false,rows:[]});m.sweep.mockResolvedValue({processed:1,alerts:0,failures:0});vi.stubEnv("BRACKET_AUTO_RESULT_SYNC_ENABLED","false")})
afterEach(()=>vi.unstubAllEnvs())
describe("scheduled observation and alert wiring",()=>{
 it("authenticates before result sync or experience writes",async()=>{m.auth.mockReturnValue(false);expect((await POST(request({sport:"nba_cup",season:2026,apply:true}))).status).toBe(401);expect(m.cup).not.toHaveBeenCalled();expect(m.sweep).not.toHaveBeenCalled()})
 it("keeps preview calls read-only and follows an applied Cup sync with its bounded sweep",async()=>{await POST(request({sport:"nba_cup",season:2026,apply:false}));expect(m.sweep).not.toHaveBeenCalled();const response=await POST(request({sport:"nba_cup",season:2026,apply:true}));expect(response.status).toBe(200);expect(m.sweep).toHaveBeenCalledWith("nba_cup",2026);expect((await response.json()).experience.processed).toBe(1)})
 it("reports an experience failure as a partial release failure instead of a healthy cron",async()=>{m.sweep.mockRejectedValue(new Error("Storage unavailable"));const response=await POST(request({sport:"nba_cup",season:2026,apply:true}));expect(response.status).toBe(502);expect(await response.json()).toMatchObject({ok:false,applied:true,experience:{failures:1}})})
 it("preserves the CFP opt-in instead of enabling it through this feature",async()=>{await POST(request({sport:"ncaaf",season:2026,apply:true}));expect(m.cfp).toHaveBeenCalledWith({sport:"ncaaf",season:2026,apply:false});expect(m.sweep).not.toHaveBeenCalled()})
})
