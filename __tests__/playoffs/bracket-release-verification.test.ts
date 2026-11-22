import {describe,expect,it,vi} from "vitest"
// Public probe has no production dependencies and is injected with fixture GETs here.
// @ts-expect-error standalone operator script intentionally has no .d.ts
import {verifyBracketRelease} from "@/scripts/verify-bracket-release.mjs"
describe("credential-free release verification",()=>{
 it("requires ancestry and real health/auth/privacy checks, while clearly leaving personal acceptance open",async()=>{
  const fetcher=vi.fn(async(url:URL,init:RequestInit)=>{expect(init).toMatchObject({method:"GET",credentials:"omit",redirect:"error"});expect(init.headers).not.toHaveProperty("Authorization");
   return url.pathname.endsWith("/health")?Response.json({ok:true,database:{connected:true},env:{valid:true}}):url.pathname.endsWith("/live")?Response.json({series:[{id:"g"}],scores:[]}):Response.json({error:"Unauthorized"},{status:401})})
  const result=await verifyBracketRelease({baseUrl:"https://example.test",challengeId:"pool",deploymentCommit:"a".repeat(40),requiredCommit:"b".repeat(40),fetchImpl:fetcher,ancestor:async()=>true})
  expect(result.passed).toBe(true);expect(fetcher).toHaveBeenCalledTimes(3);expect(result.remainingAcceptance.join(" ")).toContain("Authenticated entry")
 })
 it("cannot certify a wrong deployment, leaked picks or unprotected coach",async()=>{
  const result=await verifyBracketRelease({baseUrl:"https://example.test",challengeId:"pool",deploymentCommit:"a".repeat(40),requiredCommit:"b".repeat(40),ancestor:async()=>false,fetchImpl:async(url:URL)=>url.pathname.endsWith("/live")?Response.json({series:[],scores:[],picks:[{pickTeamName:"SECRET"}]}):Response.json({status:"ok",database:{connected:true},env:{valid:true}})})
  expect(result.passed).toBe(false);expect(result.checks).toMatchObject({containsRequiredCommit:false,privateCoachRequiresAuth:false,publicFeedExcludesPicks:false})
 })
 it("rejects credentials embedded in URLs before making a network request",async()=>{
  const fetcher=vi.fn();await expect(verifyBracketRelease({baseUrl:"https://name:password@example.test",challengeId:"pool",deploymentCommit:"a".repeat(40),requiredCommit:"b".repeat(40),fetchImpl:fetcher})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled()
 })
})
