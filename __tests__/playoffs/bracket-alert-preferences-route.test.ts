import {beforeEach,describe,expect,it,vi} from "vitest"
const m=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),save:vi.fn()}))
vi.mock("@/app/api/brackets/playoffs/_utils",()=>({requireWorldCupApiUser:m.auth}))
vi.mock("@/lib/playoffs/bracketCoachService",()=>({loadCoachView:m.access,CoachAccessError:class extends Error{status=403}}))
vi.mock("@/lib/playoffs/bracketExperienceService",()=>({saveBracketAlerts:m.save}))
import {PUT} from "@/app/api/brackets/playoffs/[challengeId]/coach/alerts/route"
import {defaultBracketAlerts} from "@/lib/playoffs/bracketExperience"
const ctx={params:Promise.resolve({challengeId:"pool"})}
const req=(body:unknown=defaultBracketAlerts,origin="https://example.test")=>new Request("https://example.test/api/brackets/playoffs/pool/coach/alerts",{method:"PUT",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({ok:true,user:{id:"me"}});m.access.mockResolvedValue({challenge:{sport:"nba_cup",isTestMode:false}});m.save.mockResolvedValue(defaultBracketAlerts)})
describe("per-pool alert preference boundary",()=>{
  it("does not enable alerts for pools with no scheduled experience worker",async()=>{m.access.mockResolvedValue({challenge:{sport:"nba",isTestMode:false}});expect((await PUT(req(),ctx)).status).toBe(400);expect(m.save).not.toHaveBeenCalled()})
  it("requires authentication before any preference write",async()=>{m.auth.mockResolvedValue({ok:false,response:new Response(null,{status:401})});expect((await PUT(req(),ctx)).status).toBe(401);expect(m.save).not.toHaveBeenCalled()})
  it("rejects cross-origin requests and spoofed user IDs",async()=>{expect((await PUT(req(defaultBracketAlerts,"https://attacker.test"),ctx)).status).toBe(403);expect((await PUT(req({...defaultBracketAlerts,userId:"victim"}),ctx)).status).toBe(400);expect(m.save).not.toHaveBeenCalled()})
  it("refuses nonmembers and saves only authenticated user's scoped settings",async()=>{const {CoachAccessError}=await import("@/lib/playoffs/bracketCoachService");m.access.mockRejectedValueOnce(new CoachAccessError(403,"denied"));expect((await PUT(req(),ctx)).status).toBe(403);expect(m.save).not.toHaveBeenCalled();const r=await PUT(req(),ctx);expect(r.status).toBe(200);expect(r.headers.get("Cache-Control")).toBe("private, no-store");expect(m.save).toHaveBeenCalledWith("me","pool",defaultBracketAlerts)})
})
