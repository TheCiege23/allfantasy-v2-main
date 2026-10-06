// @vitest-environment node
/**
 * scripts/railway-batched-deploy.mjs — the batched Railway deploy (2026-10-06). Driven against a
 * fake GraphQL API and a fake clock: it must wait out a build in flight, deploy the NEWEST main,
 * follow that build to the end, and turn red on every failure — including an authorization denial,
 * which Railway returns as HTTP 200 with an `errors` array.
 */
import { describe, expect, it } from 'vitest'

import { DeployError, runBatchedDeploy } from '../scripts/railway-batched-deploy.mjs'

const SHA = 'a'.repeat(40)
const NEWER = 'b'.repeat(40)
const TOKEN = 'rw_project_token_SECRET_123'

type Call = { query: string; variables: Record<string, unknown>; headers: Record<string, string> }

/** A fake Railway API: `inFlight` answers per list call, `statuses` per status call. */
function fakeApi(opts: {
  inFlight?: number[]
  statuses?: string[]
  deployId?: string | null
  respond?: (call: Call) => { status?: number; body: unknown } | undefined
}) {
  const calls: Call[] = []
  const inFlight = [...(opts.inFlight ?? [0])]
  const statuses = [...(opts.statuses ?? ['SUCCESS'])]
  const fetchImpl = async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const { query, variables } = JSON.parse(init.body)
    const call = { query, variables, headers: init.headers }
    calls.push(call)
    const custom = opts.respond?.(call)
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    if (custom) return reply(custom.status ?? 200, custom.body)
    if (query.includes('deployments(')) {
      const busy = inFlight.length > 1 ? inFlight.shift()! : inFlight[0]
      const edges = Array.from({ length: busy }, (_, i) => ({ node: { id: `old${i}`, status: 'BUILDING' } }))
      edges.push({ node: { id: 'live', status: 'SUCCESS' } })
      return reply(200, { data: { deployments: { edges } } })
    }
    if (query.includes('serviceInstanceDeployV2')) {
      return reply(200, { data: { serviceInstanceDeployV2: opts.deployId === undefined ? 'dep-123' : opts.deployId } })
    }
    if (query.includes('deployment(id')) {
      const s = statuses.length > 1 ? statuses.shift()! : statuses[0]
      return reply(200, { data: { deployment: { id: 'dep-123', status: s } } })
    }
    throw new Error(`unexpected query ${query}`)
  }
  return { fetchImpl, calls }
}

function harness(over: Record<string, unknown> = {}) {
  let t = 0
  const sleeps: number[] = []
  const logs: string[] = []
  return {
    sleeps,
    logs,
    opts: {
      token: TOKEN,
      projectId: 'proj',
      environmentId: 'env',
      serviceId: 'svc',
      repoUrl: 'https://example.invalid/repo.git',
      quietSeconds: 180,
      pollSeconds: 30,
      waitIdleSeconds: 600,
      waitBuildSeconds: 1800,
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        t += ms
      },
      log: (m: string) => logs.push(m),
      readSha: () => SHA,
      ...over,
    },
  }
}

describe('runBatchedDeploy', () => {
  it('waits the quiet window, waits out a build in flight, deploys the newest main, and follows it to live', async () => {
    const api = fakeApi({ inFlight: [2, 1, 0], statuses: ['BUILDING', 'DEPLOYING', 'SUCCESS'] })
    const h = harness({ fetchImpl: api.fetchImpl })
    const r = await runBatchedDeploy(h.opts)
    expect(r).toMatchObject({ outcome: 'live', sha: SHA, deploymentId: 'dep-123' })
    expect(h.sleeps[0]).toBe(180_000)
    const order = api.calls.map((c) => (c.query.includes('deployments(') ? 'list' : c.query.includes('Deploy') ? 'deploy' : 'status'))
    // Three in-flight checks (2, 1, 0) BEFORE the deploy — never a second build while one runs.
    expect(order).toEqual(['list', 'list', 'list', 'deploy', 'status', 'status', 'status'])
    const deploy = api.calls.find((c) => c.query.includes('serviceInstanceDeployV2'))!
    expect(deploy.variables).toEqual({ s: 'svc', e: 'env', c: SHA })
    expect(deploy.headers['Project-Access-Token']).toBe(TOKEN)
  })

  it('deploys the commit read AT DEPLOY TIME, so merges during the wait ride along', async () => {
    let reads = 0
    let sleptBeforeRead = -1
    const api = fakeApi({ inFlight: [1, 0] })
    const h = harness({ fetchImpl: api.fetchImpl, readSha: () => ((sleptBeforeRead = h.sleeps.length), ++reads, NEWER) })
    await runBatchedDeploy(h.opts)
    expect(reads).toBe(1)
    // Read only after the quiet window AND the in-flight wait (2 sleeps), never at the start.
    expect(sleptBeforeRead).toBe(2)
    expect(api.calls.find((c) => c.query.includes('serviceInstanceDeployV2'))!.variables.c).toBe(NEWER)
  })

  it('an authorization denial is HTTP 200 with an errors array — that is a failure, not a success', async () => {
    const api = fakeApi({
      respond: () => ({ status: 200, body: { data: null, errors: [{ message: 'Not Authorized', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } }),
    })
    const h = harness({ fetchImpl: api.fetchImpl, quietSeconds: 0 })
    await expect(runBatchedDeploy(h.opts)).rejects.toThrow(/Not Authorized/)
    expect(api.calls.some((c) => c.query.includes('serviceInstanceDeployV2'))).toBe(false)
  })

  it('a build that ends FAILED or CRASHED turns the run red', async () => {
    for (const end of ['FAILED', 'CRASHED']) {
      const h = harness({ fetchImpl: fakeApi({ statuses: ['BUILDING', end] }).fetchImpl, quietSeconds: 0 })
      await expect(runBatchedDeploy(h.opts)).rejects.toThrow(new RegExp(`ended ${end}`))
    }
  })

  it('a build in flight that never clears is reported, and no second build is started', async () => {
    const api = fakeApi({ inFlight: [1] })
    const h = harness({ fetchImpl: api.fetchImpl, quietSeconds: 0, waitIdleSeconds: 120 })
    await expect(runBatchedDeploy(h.opts)).rejects.toThrow(/in flight for over 2 min/)
    expect(api.calls.some((c) => c.query.includes('serviceInstanceDeployV2'))).toBe(false)
  })

  it('its own build stuck past the limit is red', async () => {
    const h = harness({ fetchImpl: fakeApi({ statuses: ['BUILDING'] }).fetchImpl, quietSeconds: 0, waitBuildSeconds: 90 })
    await expect(runBatchedDeploy(h.opts)).rejects.toThrow(/still BUILDING after/)
  })

  it('an unreadable main commit, a missing token, or no deployment id never deploys anything silently', async () => {
    const bad = fakeApi({})
    await expect(runBatchedDeploy(harness({ fetchImpl: bad.fetchImpl, quietSeconds: 0, readSha: () => 'not-a-sha' }).opts)).rejects.toThrow(/Could not read the main commit/)
    expect(bad.calls.some((c) => c.query.includes('serviceInstanceDeployV2'))).toBe(false)

    const none = fakeApi({})
    await expect(runBatchedDeploy(harness({ fetchImpl: none.fetchImpl, token: '' }).opts)).rejects.toBeInstanceOf(DeployError)
    expect(none.calls).toHaveLength(0)

    await expect(runBatchedDeploy(harness({ fetchImpl: fakeApi({ deployId: null }).fetchImpl, quietSeconds: 0 }).opts)).rejects.toThrow(/no deployment id/)
  })

  it('a superseded build is reported, not treated as a failure; quiet 0 does not sleep first', async () => {
    const h = harness({ fetchImpl: fakeApi({ statuses: ['REMOVED'] }).fetchImpl, quietSeconds: 0 })
    expect(await runBatchedDeploy(h.opts)).toMatchObject({ outcome: 'removed' })
    expect(h.sleeps).toEqual([])
  })

  it('DEPLOY_SHA overrides the newest main', async () => {
    const api = fakeApi({})
    await runBatchedDeploy(harness({ fetchImpl: api.fetchImpl, quietSeconds: 0, deploySha: NEWER, readSha: () => SHA }).opts)
    expect(api.calls.find((c) => c.query.includes('serviceInstanceDeployV2'))!.variables.c).toBe(NEWER)
  })

  it('never writes the token to its log', async () => {
    const h = harness({ fetchImpl: fakeApi({ inFlight: [1, 0], statuses: ['BUILDING', 'SUCCESS'] }).fetchImpl })
    await runBatchedDeploy(h.opts)
    expect(h.logs.join('\n')).not.toContain(TOKEN)
  })
})
