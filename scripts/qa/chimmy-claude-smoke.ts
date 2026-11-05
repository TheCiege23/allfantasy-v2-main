import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { request } from '@playwright/test'

const BASE = 'https://bracket-qa-gateway-staging.up.railway.app'
const CHAT = '/api/chat/chimmy'
type DeepCase = {
  id: string
  message: string
  sport: string
  leagueId?: string
  source?: string
  tools?: string[]
  decisionGap?: string
  contains: string[]
}

function parseCases(raw: unknown): DeepCase[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 12) throw new Error('Provide one to twelve test cases')
  const ids = new Set<string>()
  for (const test of raw) {
    if (!test || typeof test.id !== 'string' || !/^[a-z0-9-]+$/.test(test.id) || ids.has(test.id) ||
        typeof test.message !== 'string' || !test.message.trim() ||
        !['NFL','NCAAF','NBA','NCAAB','NHL','MLB','SOCCER'].includes(test.sport) ||
        (test.decisionGap !== undefined
          ? typeof test.decisionGap !== 'string' || !test.decisionGap || !test.leagueId || test.tools !== undefined
          : !Array.isArray(test.tools) || !test.tools.length || test.tools.some((tool: unknown) => typeof tool !== 'string' || !tool)) ||
        !Array.isArray(test.contains) || !test.contains.length || test.contains.some((part: unknown) => typeof part !== 'string' || !part) ||
        (test.leagueId !== undefined && typeof test.leagueId !== 'string') ||
        (test.source !== undefined && typeof test.source !== 'string')) {
      throw new Error('Invalid Claude case. Each requires a unique id, prompt, sport, answer facts, and expected tools or a decision gap.')
    }
    ids.add(test.id)
  }
  return raw
}

async function main() {
  const [, , path, ...flags] = process.argv
  if (!path || flags.some((flag) => flag !== '--run')) throw new Error('Provide the case JSON path and optionally --run')
  const cases = parseCases(JSON.parse(await readFile(path, 'utf8')))
  if (!flags.includes('--run')) {
    console.log(JSON.stringify({ validated: cases.map((test) => test.id), modelRequests: 0 }))
    return
  }
  const gate = process.env.QA_GATE_PASSWORD
  const password = process.env.QA_APP_PASSWORD
  if (!gate || !password) throw new Error('Configure the isolated staging QA credentials in the execution environment')
  const ctx = await request.newContext({ baseURL: BASE, httpCredentials: { username: 'qa', password: gate }, timeout: 110_000 })
  try {
    const csrf = await (await ctx.get('/api/auth/csrf')).json()
    await ctx.post('/api/auth/callback/credentials', {
      form: { csrfToken: csrf.csrfToken, login: 'bracket-admin@staging.invalid', password, callbackUrl: BASE + '/brackets', json: 'true' },
      maxRedirects: 0,
    })
    const session = await (await ctx.get('/api/auth/session')).json()
    if (session.user?.id !== 'bracket-qa-admin') throw new Error('Isolated staging QA login failed')

    for (const test of cases) {
      const requestId = randomUUID()
      let res = await ctx.post(CHAT, { multipart: {
        requestId, message: test.message, sport: test.sport,
        ...(test.leagueId ? { leagueId: test.leagueId } : {}),
        ...(test.source ? { source: test.source } : {}),
        mode: 'deep_analysis', assistantMode: 'deep_analysis', privateMode: 'true', analysisPreviewVersion: '1',
      } })
      const until = Date.now() + 150_000
      while (res.status() === 202 && Date.now() < until) {
        await res.dispose()
        await sleep(3_000)
        res = await ctx.get(CHAT, { params: { requestId } })
      }
      const body = await res.json().catch(() => null)
      const answer = String(body?.response ?? body?.result ?? '').toLowerCase()
      const tools = Array.isArray(body?.meta?.toolsUsed) ? body.meta.toolsUsed : []
      const claude = body?.meta?.providerStatus?.anthropic === 'ok' && /^claude-/i.test(body?.meta?.model ?? '')
      const factsMatch = test.contains.every((fact) => answer.includes(fact.toLowerCase()))
      const toolsMatch = test.tools?.every((tool) => tools.includes(tool)) ?? false
      const decisionMatch = Boolean(test.decisionGap && body?.source === 'chimmy_decision_engine' &&
        body?.meta?.decision?.status === 'needs_data' && body?.meta?.decision?.gap?.code === test.decisionGap &&
        body?.meta?.decision?.leagueId === test.leagueId && body?.meta?.tokenSpend === null)
      const passed = res.status() === 200 && factsMatch && (test.decisionGap ? decisionMatch : claude && toolsMatch)
      console.log(JSON.stringify({ case: test.id, status: res.status(), claude, factsMatch, toolsMatch, decisionMatch, passed }))
      await res.dispose()
      if (!passed) {
        process.exitCode = 1
        break
      }
    }
  } finally {
    await ctx.dispose()
  }
}

main().catch(() => { console.error('Claude staging QA could not complete. Check case input, staging credentials, and connectivity.'); process.exitCode = 1 })
