import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('G59 launch certification framework guardrails', () => {
  it('keeps evidence levels distinct and runtime claims withheld', () => {
    const framework = read('docs/redraft/G59_END_TO_END_LAUNCH_CERTIFICATION_FRAMEWORK.md')

    for (const label of [
      'Source verified',
      'Test verified',
      'Browser verified',
      'Authenticated verified',
      'DB-backed verified',
      'Live provider verified',
    ]) {
      expect(framework).toContain(label)
    }
    expect(framework).toContain('AUTHENTICATED CERTIFICATION PERFORMED: NO')
    expect(framework).toContain('LIVE PROVIDER CERTIFICATION PERFORMED: NO')
  })

  it('covers the complete customer journey and objective release gates', () => {
    const framework = read('docs/redraft/G59_END_TO_END_LAUNCH_CERTIFICATION_FRAMEWORK.md')

    for (const step of [
      'Landing',
      'Sign Up',
      'Login',
      'Create league',
      'Import league',
      'Draft room',
      'Waivers',
      'Trades',
      'Season completion',
    ]) {
      expect(framework).toContain(step)
    }
    for (let gate = 1; gate <= 7; gate += 1) {
      expect(framework).toContain(`| ${gate} —`)
    }
  })

  it('keeps sport limitations and provider evidence explicit', () => {
    const checklist = read('docs/redraft/INVITED_MVP_CERTIFICATION_CHECKLIST.md')
    const providers = read('docs/redraft/PROVIDER_CERTIFICATION_MATRIX.md')

    expect(checklist).toContain('NFL auction remains `NOT SUPPORTED`')
    expect(checklist).toContain('NCAAF Sleeper import and auction are `NOT SUPPORTED`')
    expect(providers).toContain('Mandatory evidence packet per scenario')
    expect(providers).toContain('Not live certified')
  })

  it('requires three independent clients and persistence evidence for draft certification', () => {
    const draft = read('docs/redraft/MULTIPLAYER_DRAFT_CERTIFICATION_SCRIPT.md')

    expect(draft).toContain('Commissioner, Manager A and Manager B')
    expect(draft).toContain('No shared session cookie')
    expect(draft).toContain('Pick count equals occupied draft slots')
    expect(draft).toContain('MULTIPLAYER GATE: PASS / FAIL / BLOCKED')
  })

  it('exposes one deterministic source certification command', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.['certify:invited-mvp:source']).toBe(
      'vitest run --config vitest.invited-mvp.config.ts --pool=threads --maxWorkers=1',
    )
  })
})
