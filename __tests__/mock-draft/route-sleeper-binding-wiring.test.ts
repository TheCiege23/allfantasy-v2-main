/**
 * `/api/mock-draft/predict-board` and `/snipe-radar` hand `sleeperId` to `MiniPlayerImg`. Both
 * resolved it by bare name, so QB Josh Allen wore a free-agent guard's headshot. The routes need a
 * league, a session and a simulation to exercise end to end, so this pins the wiring by source:
 * the position-verified batch resolver, keyed `player|position`, and — on predict-board, whose pool
 * may be another sport — only for NFL, because Sleeper's dictionary is NFL-only.
 *
 * Patterns are anchored to code lines so a comment naming the old call cannot satisfy them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe.each([
  ['app/api/mock-draft/predict-board/route.ts', 't'],
  ['app/api/mock-draft/snipe-radar/route.ts', 'alert'],
])('%s Sleeper id wiring', (file, v) => {
  const code = src(file)

  it('uses the position-verified batch resolver, never the name-only one', () => {
    expect(code).toMatch(/^\s*const ids = await resolveSleeperIdsBatch\(/m)
    expect(code).toMatch(/^\s*return \{ name, position, team: playerTeamMap\.get\(name\) \|\| null \}/m)
    expect(code).not.toMatch(/^\s*[^*/\s].*\bresolveSleeperIds\(/m)
  })

  it('reads the id back by player AND position', () => {
    expect(code).toMatch(new RegExp(`sleeperIdByKey\\.get\\(\`\\$\\{${v}\\.player\\}\\|\\$\\{${v}\\.position\\}\`\\)`))
  })
})

describe('predict-board resolves Sleeper ids for NFL only', () => {
  it('gates the resolver on isNfl', () => {
    expect(src('app/api/mock-draft/predict-board/route.ts')).toMatch(
      /^\s*if \(isNfl\) \{\s*\n\s*try \{\s*\n[^\n]*\n\s*const ids = await resolveSleeperIdsBatch\(/m,
    )
  })
})
