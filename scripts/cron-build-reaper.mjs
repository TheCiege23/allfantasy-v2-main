/**
 * cron-build-reaper.mjs — cancels Railway builds that a newer commit has already superseded.
 *
 * WHY (2026-10-02). Railway builds every commit pushed to `main` in full, in parallel, and never
 * cancels one. At 00:16 UTC five allfantasy-v2-main builds were running at once (23:50, 00:08,
 * 00:09, 00:11, 00:16), each ~20 minutes, all on the same builder — so the one that matters, the
 * newest, ran slower than it would alone, and every older one was billed for nothing. `main` is
 * linear (PRs land by rebase), so the newest build already contains every older commit.
 *
 * Runs inside scripts/cron-scheduler.mjs, once a minute.
 *
 * THE RULE (pickSuperseded), for builds still QUEUED / INITIALIZING / BUILDING:
 *   - one with a NEWER deployment already DEPLOYING or SUCCESS is cancelled — newer code is live,
 *     so it must not finish last and replace it;
 *   - of the rest, the NEWEST is kept, and so is the OLDEST one that has started building;
 *     everything between them is cancelled. At most two builds run, and one always finishes.
 * A newer build that FAILED (or crashed, or was removed/skipped) supersedes nothing, so an older
 * good build still ships. DEPLOYING is never cancelled: it is seconds from serving.
 *
 * 🛑 THE FIRST VERSION CANCELLED EVERY BUILD THAT HAD ANY NEWER BUILD, AND IT FROZE PRODUCTION.
 * Live from 01:44 UTC on 2026-10-02, sessions pushed every 3–15 minutes against a ~15-minute
 * build, so each build was cancelled by the next push before it could finish: twelve in a row,
 * one of them 16 minutes in, and allfantasy.ai served a 01:18 build for over an hour while 15
 * commits (counted 02:40) and a rotated APNs key waited. "Cancel the older one" is a debounce, and a
 * debounce never fires while input keeps arriving faster than its window. Keeping the oldest
 * running build is what guarantees progress; the newest then becomes the oldest and ships next.
 *
 * DRY-RUN BY DEFAULT. Unless BUILD_REAPER_LIVE=1 it logs "would cancel" and calls nothing.
 * Disabled (one log line) without RAILWAY_TOKEN or BUILD_REAPER_SERVICE_IDS.
 *
 * Env: RAILWAY_TOKEN (a project token — sent only as the Project-Access-Token header, never
 * logged), BUILD_REAPER_SERVICE_IDS (comma-separated), BUILD_REAPER_LIVE, and RAILWAY_PROJECT_ID /
 * RAILWAY_ENVIRONMENT_ID, which Railway injects into every service at runtime.
 */

const API = 'https://backboard.railway.com/graphql/v2'

const IN_FLIGHT = new Set(['QUEUED', 'INITIALIZING', 'BUILDING'])
/** Started building — the in-flight states with progress worth protecting. */
const PROGRESSING = new Set(['INITIALIZING', 'BUILDING'])
/** Newer code that is serving, or seconds from serving. */
const LIVE = new Set(['DEPLOYING', 'SUCCESS'])

/**
 * Pure. Given one service's deployments, the ids to cancel and why.
 * @param {{ id: string, status: string, createdAt: string, commitHash?: string }[]} deployments
 */
export function pickSuperseded(deployments) {
  const byAge = [...deployments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const t = (d) => Date.parse(d.createdAt)
  const newerLive = (d) => byAge.find((n) => LIVE.has(n.status) && t(n) > t(d))
  const out = []

  // In flight and not already beaten by newer code that is live or about to be.
  const contenders = []
  for (const d of byAge) {
    if (!IN_FLIGHT.has(d.status)) continue
    const live = newerLive(d)
    if (live) out.push({ id: d.id, commitHash: d.commitHash, supersededBy: live.id, newerStatus: live.status })
    else contenders.push(d)
  }
  if (contenders.length < 2) return out

  // Keep the NEWEST, and keep the oldest one that is actually building: it is the one closest to
  // shipping, and cancelling it on every push is what froze production (see the header).
  const newest = contenders[contenders.length - 1]
  const runner = contenders.find((d) => d !== newest && PROGRESSING.has(d.status))
  for (const d of contenders) {
    if (d === newest || d === runner) continue
    out.push({ id: d.id, commitHash: d.commitHash, supersededBy: newest.id, newerStatus: newest.status })
  }
  return out
}

async function gql(token, query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Project-Access-Token': token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Railway API HTTP ${res.status}`)
  const body = await res.json()
  if (body.errors?.length) throw new Error(`Railway API: ${body.errors.map((e) => e.message).join('; ')}`)
  return body.data
}

const LIST = `query($input: DeploymentListInput!, $first: Int) {
  deployments(input: $input, first: $first) { edges { node { id status createdAt meta } } }
}`
const CANCEL = `mutation($id: String!) { deploymentCancel(id: $id) }`

let warnedDisabled = false
let announcedReady = false

/** Tests only: the one-time log lines are per process, so each test starts from a fresh one. */
export function resetReaperState() {
  warnedDisabled = false
  announcedReady = false
}

/** One pass over every configured service. Never throws: a reaper failure must not touch the crons. */
export async function reapOnce({ env = process.env, log = console.log } = {}) {
  const token = env.RAILWAY_TOKEN?.trim()
  const services = (env.BUILD_REAPER_SERVICE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const projectId = env.RAILWAY_PROJECT_ID
  const environmentId = env.RAILWAY_ENVIRONMENT_ID
  if (!token || services.length === 0 || !projectId || !environmentId) {
    if (!warnedDisabled) {
      log('[reaper] disabled: needs RAILWAY_TOKEN, BUILD_REAPER_SERVICE_IDS, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID')
      warnedDisabled = true
    }
    return
  }
  const live = env.BUILD_REAPER_LIVE === '1'
  let listed = 0
  for (const serviceId of services) {
    try {
      const data = await gql(token, LIST, { input: { projectId, environmentId, serviceId }, first: 15 })
      listed++
      const deployments = (data?.deployments?.edges ?? []).map(({ node }) => ({
        id: node.id,
        status: node.status,
        createdAt: node.createdAt,
        commitHash: node.meta?.commitHash ?? null,
      }))
      for (const s of pickSuperseded(deployments)) {
        const what = `${s.id} (${String(s.commitHash ?? '?').slice(0, 9)}), superseded by ${s.supersededBy} [${s.newerStatus}]`
        if (!live) {
          log(`[reaper] would cancel ${what} (dry-run)`)
          continue
        }
        await gql(token, CANCEL, { id: s.id })
        log(`[reaper] cancelled ${what}`)
      }
    } catch (e) {
      log(`[reaper] service ${serviceId}: ${e?.message ?? e}`)
    }
  }
  // Silence is the normal state (nothing superseded), so say once that the API answered —
  // otherwise "working" and "never ran" read the same in the logs.
  if (!announcedReady && listed > 0) {
    log(`[reaper] watching ${listed}/${services.length} service(s), ${live ? 'LIVE' : 'dry-run'}`)
    announcedReady = true
  }
}
