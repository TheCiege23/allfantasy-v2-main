import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * G15.10 — source-level contract for the live wiring (route + agent pipeline are too
 * dependency-heavy for a cheap runtime render; the resolver logic is unit-tested separately
 * in resolve-chimmy-grounding.test.ts).
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const route = read('app/api/chimmy/route.ts')
const pipeline = read('lib/agents/anthropic-pipeline.ts')

describe('Chimmy live grounding wiring', () => {
  it('route imports + invokes the grounding resolver in both pipeline paths', () => {
    expect(route).toContain('resolveChimmyCommissionerGrounding')
    // legacy forwarded path passes grounding into buildForwardedRequest
    expect(route).toMatch(/buildForwardedRequest\(req, parseResult\.data, commissionerGrounding\)/)
    // anthropic path attaches grounding to the context
    expect(route).toMatch(/anthropicContext\.commissionerGrounding = await resolveChimmyCommissionerGrounding/)
  })

  it('buildForwardedRequest appends grounding additively WITHOUT changing existing behavior', () => {
    expect(route).toContain("formData.append('commissionerGrounding', commissionerGrounding)")
    // existing forwarded fields remain intact (regression guard)
    expect(route).toContain("formData.append('message', payload.message)")
    expect(route).toContain("formData.append('leagueId', payload.userContext.leagueId)")
  })

  it('agent pipeline carries grounding on UserContext and includes it in the system prompt', () => {
    expect(pipeline).toContain('commissionerGrounding?: string | null')
    expect(pipeline).toContain('## COMMISSIONER INTELLIGENCE')
    expect(pipeline).toContain('ctx.commissionerGrounding')
  })
})
