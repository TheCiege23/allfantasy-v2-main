/**
 * Decision OS Replay Framework — static isolation proof, per
 * docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §6 ("Explicit separation
 * from live calibration"). Complements writer.test.ts's behavioral mock
 * assertions with a structural guarantee: no file under lib/replay-framework
 * imports the live-capture/calibration write path or the live tables at all.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const REPLAY_FRAMEWORK_ROOT = join(process.cwd(), 'lib', 'replay-framework')

const FORBIDDEN_IMPORT_PATTERNS = [
  'trade-event-logger',
  'tradeLearningCapture',
  'auto-recalibration',
  'league-trade-engine/tradeService',
]

const FORBIDDEN_PRISMA_MODEL_ACCESS = [
  'prisma.tradeOfferEvent',
  'prisma.tradeOutcomeEvent',
  'prisma.tradeLearningStats',
]

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  let files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files = files.concat(listTsFiles(fullPath))
    } else if (entry.endsWith('.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

describe('Replay Framework isolation from live Decision OS trade learning', () => {
  const files = listTsFiles(REPLAY_FRAMEWORK_ROOT)

  it('found the expected replay-framework source files (sanity check the scan itself is real)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('no file imports the live-capture write path or the weekly-recalibration scheduler', () => {
    const violations: Array<{ file: string; pattern: string }> = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      // Only real `import`/`require` statements count — a doc comment
      // *referencing* a precedent by name (e.g. explaining which existing
      // convention a fallback value mirrors) is not an isolation violation.
      const importLines = content
        .split('\n')
        .filter((line) => /^\s*(import|.*require\()/.test(line))
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (importLines.some((line) => line.includes(pattern))) {
          violations.push({ file, pattern })
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('no file accesses TradeOfferEvent, TradeOutcomeEvent, or TradeLearningStats via prisma', () => {
    const violations: Array<{ file: string; pattern: string }> = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      for (const pattern of FORBIDDEN_PRISMA_MODEL_ACCESS) {
        if (content.includes(pattern)) {
          violations.push({ file, pattern })
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('the writer module only ever calls prisma.replayImport / prisma.replayBacktestResult', () => {
    const writerContent = readFileSync(join(REPLAY_FRAMEWORK_ROOT, 'writer.ts'), 'utf-8')
    const prismaCalls = writerContent.match(/prisma\.\w+/g) ?? []
    const uniqueModels = new Set(prismaCalls)
    expect(uniqueModels).toEqual(new Set(['prisma.replayImport', 'prisma.replayBacktestResult']))
  })
})
