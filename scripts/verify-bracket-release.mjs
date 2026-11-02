/** Credential-free release acceptance. GET only; no Prisma, cookies, secrets, publishers or AI calls. */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export async function verifyBracketRelease({ baseUrl, challengeId, deploymentCommit, requiredCommit, fetchImpl = fetch, ancestor = gitAncestor }) {
  const origin = new URL(baseUrl)
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
    !(origin.protocol === "https:" || origin.protocol === "http:" && ["localhost","127.0.0.1"].includes(origin.hostname))) throw new Error("Use an HTTPS origin or a local test server")
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(challengeId) || !/^[0-9a-f]{40}$/.test(deploymentCommit) || !/^[0-9a-f]{40}$/.test(requiredCommit)) throw new Error("Supply a pool ID and exact 40-character commit SHAs")
  const get = async path => {
    const response = await fetchImpl(new URL(path,origin), { method:"GET",credentials:"omit",redirect:"error",cache:"no-store",headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000) })
    return { status:response.status,data:await response.json().catch(()=>null) }
  }
  const [health,live,privateCoach] = await Promise.all([get("/api/health"),get(`/api/brackets/playoffs/${challengeId}/live`),get(`/api/brackets/playoffs/${challengeId}/coach`)])
  const data = live.data
  const checks = {
    containsRequiredCommit: await ancestor(requiredCommit,deploymentCommit),
    health: health.status===200 && health.data?.ok===true && health.data?.database?.connected===true && health.data?.env?.valid===true,
    publicLiveFeed: live.status===200 && Array.isArray(data?.series) && Array.isArray(data?.scores),
    privateCoachRequiresAuth: privateCoach.status===401,
    publicFeedExcludesPicks: data && !JSON.stringify(data).match(/"(?:picks|pickTeamName|userId|email|inviteCode|inviteUrl)"\s*:/),
    draftsExcluded: Array.isArray(data?.scores) && data.scores.every(s=>s.rank!=null),
  }
  return { observedAt:new Date().toISOString(),deploymentCommit,requiredCommit,checks,passed:Object.values(checks).every(Boolean),
    counts:{games:Array.isArray(data?.series)?data.series.length:0,finalizedEntries:Array.isArray(data?.scores)?data.scores.length:0},
    remainingAcceptance:["Railway SUCCESS and startup must be confirmed separately for deploymentCommit.","Authenticated entry creation/save/finalize, real Chimmy consent/billing and real result-driven delivery require an authorized test account in an isolated environment. This public probe cannot prove them."] }
}
function gitAncestor(required,deployed) {
  const result=spawnSync("git",["merge-base","--is-ancestor",required,deployed],{cwd:fileURLToPath(new URL("..",import.meta.url)),encoding:"utf8",windowsHide:true})
  if (result.error || result.status>1 || result.status==null) throw new Error("Git ancestry could not be verified with local objects; fetch the exact commits first")
  return result.status===0
}
if(process.argv[1] && fileURLToPath(import.meta.url).toLowerCase()===process.argv[1].toLowerCase()) {
  const [baseUrl,challengeId,deploymentCommit,requiredCommit]=process.argv.slice(2)
  try { const result=await verifyBracketRelease({baseUrl,challengeId,deploymentCommit,requiredCommit});console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1 }
  catch(error){console.error(error.message);process.exitCode=1}
}
