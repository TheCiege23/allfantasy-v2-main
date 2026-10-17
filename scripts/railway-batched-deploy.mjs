/**
 * Deploy the newest `main` to Railway's `allfantasy-v2-main`, one build at a time.
 * Run by .github/workflows/railway-deploy.yml — its header says WHY (2026-10-06).
 *
 * Steps: wait QUIET_SECONDS for more merges → wait until no build of this service is in flight →
 * deploy the newest commit on main → follow that deployment to its end. Exit 0 only when it is
 * live, so a failed build is a red run.
 *
 * Env: RAILWAY_TOKEN — a PROJECT token scoped to the production environment, sent in the
 * `Project-Access-Token` header and never printed. PROJECT_ID, ENVIRONMENT_ID, SERVICE_ID, REPO_URL.
 * Optional: QUIET_SECONDS (180), POLL_SECONDS (30), WAIT_IDLE_SECONDS (2700), WAIT_BUILD_SECONDS
 * (2700), DEPLOY_SHA (deploy this commit instead of the newest main), RAILWAY_API.
 *
 * ⚠ THE API REPORTS FAILURE IN AN `errors` ARRAY, OFTEN WITH HTTP 200 — an authorization denial is
 * a 200 (docs.railway.com/integrations/api). Every call checks `errors`; the status code alone is
 * never trusted.
 *
 * No dependencies: global fetch, and git for `ls-remote`. Pure core with injected I/O, so
 * __tests__/railway-batched-deploy.test.ts drives it against a fake API.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const DEFAULT_API = 'https://backboard.railway.com/graphql/v2'
/** Deployment statuses that mean a build of this service is still in progress. */
export const IN_FLIGHT = new Set(['BUILDING', 'DEPLOYING', 'QUEUED', 'INITIALIZING', 'WAITING'])

export class DeployError extends Error {}

/** One GraphQL request. Throws on a transport failure, a non-JSON body, or an `errors` array. */
export async function gql(fetchImpl, { api, token }, query, variables) {
  let res
  try {
    res = await fetchImpl(api, {
      method: 'POST',
      headers: { 'Project-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new DeployError(`Railway API request failed (network): ${e?.message ?? e}`)
  }
  let json
  try {
    json = await res.json()
  } catch {
    throw new DeployError(`Railway API returned a non-JSON response (HTTP ${res.status})`)
  }
  const errors = Array.isArray(json?.errors) ? json.errors : []
  if (errors.length) {
    const what = errors.map((e) => `${e?.message ?? 'error'}${e?.extensions?.code ? ` [${e.extensions.code}]` : ''}`).join('; ')
    throw new DeployError(`Railway API error: ${what}`)
  }
  if (!res.ok) throw new DeployError(`Railway API HTTP ${res.status}`)
  return json.data
}

export async function inFlightCount(fetchImpl, conn, ids) {
  const data = await gql(
    fetchImpl,
    conn,
    'query($input: DeploymentListInput!) { deployments(input: $input, first: 10) { edges { node { id status } } } }',
    { input: { projectId: ids.projectId, serviceId: ids.serviceId, environmentId: ids.environmentId } },
  )
  const edges = data?.deployments?.edges
  if (!Array.isArray(edges)) throw new DeployError('Railway API: deployments list missing from the response')
  return edges.filter((e) => IN_FLIGHT.has(e?.node?.status)).length
}

export async function deploymentStatus(fetchImpl, conn, id) {
  const data = await gql(fetchImpl, conn, 'query($id: String!) { deployment(id: $id) { id status } }', { id })
  const status = data?.deployment?.status
  if (!status) throw new DeployError(`Railway API: no status for deployment ${id}`)
  return status
}

export async function triggerDeploy(fetchImpl, conn, ids, sha) {
  const data = await gql(
    fetchImpl,
    conn,
    'mutation($s: String!, $e: String!, $c: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e, commitSha: $c) }',
    { s: ids.serviceId, e: ids.environmentId, c: sha },
  )
  const id = data?.serviceInstanceDeployV2
  if (!id || typeof id !== 'string') throw new DeployError('Railway returned no deployment id')
  return id
}

/** The newest commit on main, read at deploy time. */
export function readMainSha(repoUrl, exec = execFileSync) {
  const out = String(exec('git', ['ls-remote', repoUrl, 'refs/heads/main'], { encoding: 'utf8', timeout: 30_000 }))
  return out.split(/\s+/)[0] ?? ''
}

/**
 * The whole run. Returns { outcome, sha, deploymentId, minutes }; throws DeployError on anything
 * that must turn the run red.
 */
export async function runBatchedDeploy(opts) {
  const {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    log = (m) => console.log(m),
    readSha = () => readMainSha(opts.repoUrl),
    quietSeconds = 180,
    pollSeconds = 30,
    waitIdleSeconds = 2700,
    waitBuildSeconds = 2700,
    deploySha = '',
  } = opts
  const conn = { api: opts.api || DEFAULT_API, token: opts.token }
  const ids = { projectId: opts.projectId, environmentId: opts.environmentId, serviceId: opts.serviceId }
  for (const [k, v] of Object.entries({ token: conn.token, ...ids })) {
    if (!v) throw new DeployError(`${k} is not set`)
  }

  // 1. Quiet window: merges that land meanwhile ride along in this deploy.
  if (quietSeconds > 0) {
    log(`Waiting ${quietSeconds}s for more merges to land…`)
    await sleep(quietSeconds * 1000)
  }

  // 2. Never start a second build while one is in flight — overlapping builds share one builder
  //    machine and slow each other down (2026-10-06: a 6-min compile became 21.6).
  const idleStart = now()
  for (;;) {
    const busy = await inFlightCount(fetchImpl, conn, ids)
    if (busy === 0) break
    if (now() - idleStart > waitIdleSeconds * 1000) {
      throw new DeployError(`A build has been in flight for over ${Math.round(waitIdleSeconds / 60)} min — not starting another. Check Railway.`)
    }
    log(`${busy} deployment(s) still in flight — waiting ${pollSeconds}s`)
    await sleep(pollSeconds * 1000)
  }

  // 3. Deploy the NEWEST main, read now — not the commit that started this run.
  const sha = String(deploySha || readSha()).trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new DeployError(`Could not read the main commit (got '${sha}')`)
  const deploymentId = await triggerDeploy(fetchImpl, conn, ids, sha)
  log(`Deploying ${sha.slice(0, 9)} → Railway deployment ${deploymentId}`)

  // 4. Follow it to the end: a failed build is a red run, and the next queued run starts only
  //    after this build has finished.
  const buildStart = now()
  for (;;) {
    const status = await deploymentStatus(fetchImpl, conn, deploymentId)
    const minutes = Math.round((now() - buildStart) / 60000)
    if (status === 'SUCCESS') return { outcome: 'live', sha, deploymentId, minutes }
    if (status === 'FAILED' || status === 'CRASHED') throw new DeployError(`Railway deployment ${deploymentId} ended ${status}`)
    if (status === 'REMOVED' || status === 'SKIPPED') return { outcome: status.toLowerCase(), sha, deploymentId, minutes }
    if (now() - buildStart > waitBuildSeconds * 1000) {
      throw new DeployError(`Deployment ${deploymentId} still ${status} after ${Math.round(waitBuildSeconds / 60)} min`)
    }
    log(`Deployment ${deploymentId}: ${status}`)
    await sleep(pollSeconds * 1000)
  }
}

function num(v, d) {
  const n = Number(v)
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d
}

async function main() {
  const env = process.env
  const summary = (line) => {
    console.log(line)
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`)
      } catch {}
    }
  }
  try {
    const r = await runBatchedDeploy({
      token: env.RAILWAY_TOKEN,
      projectId: env.PROJECT_ID,
      environmentId: env.ENVIRONMENT_ID,
      serviceId: env.SERVICE_ID,
      repoUrl: env.REPO_URL,
      api: env.RAILWAY_API,
      quietSeconds: num(env.QUIET_SECONDS, 180),
      pollSeconds: num(env.POLL_SECONDS, 30),
      waitIdleSeconds: num(env.WAIT_IDLE_SECONDS, 2700),
      waitBuildSeconds: num(env.WAIT_BUILD_SECONDS, 2700),
      deploySha: env.DEPLOY_SHA,
    })
    summary(
      r.outcome === 'live'
        ? `✅ Live: \`${r.sha.slice(0, 9)}\` (Railway deployment \`${r.deploymentId}\`) after ${r.minutes} min of build`
        : `⚠ Deployment \`${r.deploymentId}\` ended ${r.outcome.toUpperCase()} (superseded or skipped)`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`::error::${msg}`)
    summary(`❌ ${msg}`)
    process.exitCode = 1
  }
}

// Run only when executed directly, never when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
