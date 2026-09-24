import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAiAuthority } from '@/lib/decision-os/three-brain/phase4/aiAuthorityPolicy'
import {
  ANSWER_CATEGORIES,
  CHIMMY_ANSWER_BANK,
  NO_ADP,
  NO_DECISION_TOOL,
  NO_NEWS,
  NO_PROBABILITY,
  type AnswerCase,
} from './answer-bank'

/**
 * Integrity of the answer bank — deterministic, runs in every `npm test`, and scores nothing about
 * Chimmy's answers. What it pins is that the bank stays TRUE about the code it describes:
 *
 *   - every required decision is one the Decision OS policy keeps explanation-only;
 *   - every tool it names is a tool Chimmy actually has;
 *   - every `knownGap` is still a gap. Like `corpus.ts`, a gap entry pins today's defect and must be
 *     deleted by the change that fixes it — so this goes RED when a decision tool, an ADP tool, a
 *     probability tool or a news tool is added and the bank still says there is none.
 */

const TOOLS_SOURCE = readFileSync(join(process.cwd(), 'lib/chimmy/tools/chimmyTools.ts'), 'utf8')
const TOOL_NAMES = new Set([...TOOLS_SOURCE.matchAll(/^\s*name: '([a-z_]+)'/gm)].map((m) => m[1]))

const PLACEHOLDER_LEAGUE: Record<string, AnswerCase['league']> = {
  '{nativeLeague}': 'native',
  '{importedLeague}': 'imported',
  '{otherImport}': 'other_import',
}

describe('the answer bank', () => {
  it('reads the real tool list (positive control: the parse found tools, including a known one)', () => {
    expect(TOOL_NAMES.size).toBeGreaterThanOrEqual(15)
    expect(TOOL_NAMES.has('get_player_season_stats')).toBe(true)
  })

  it('has unique ids and covers every area the owner named', () => {
    const ids = CHIMMY_ANSWER_BANK.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const covered = new Set(CHIMMY_ANSWER_BANK.map((c) => c.category))
    expect(ANSWER_CATEGORIES.filter((cat) => !covered.has(cat))).toEqual([])
  })

  it('only requires decisions the Decision OS keeps explanation-only', () => {
    const authoring = CHIMMY_ANSWER_BANK.filter((c) => c.decision && resolveAiAuthority(c.decision) !== 'explanation_only')
    expect(authoring.map((c) => `${c.id} ${c.decision}`)).toEqual([])
  })

  it('grounds every required decision on that same decision', () => {
    const ungrounded = CHIMMY_ANSWER_BANK.filter(
      (c) => c.decision && !c.groundOn.some((s) => s.kind === 'decision_os' && s.decision === c.decision),
    )
    expect(ungrounded.map((c) => c.id)).toEqual([])
  })

  it('names only tools Chimmy has', () => {
    const unknown = CHIMMY_ANSWER_BANK.flatMap((c) =>
      c.groundOn.filter((s) => s.kind === 'tool' && !TOOL_NAMES.has(s.tool)).map((s) => `${c.id} ${(s as { tool: string }).tool}`),
    )
    expect(unknown).toEqual([])
  })

  it('uses league placeholders that agree with the case’s league context', () => {
    const wrong = CHIMMY_ANSWER_BANK.flatMap((c) => {
      const found = [...c.q.matchAll(/\{[A-Za-z]+\}/g)].map((m) => m[0])
      return found
        .filter((p) => !(p in PLACEHOLDER_LEAGUE) || PLACEHOLDER_LEAGUE[p] !== c.league)
        .map((p) => `${c.id} ${p} vs ${c.league}`)
    })
    expect(wrong).toEqual([])
  })

  describe('known gaps are still gaps', () => {
    const decisionOsImported = /from '@\/lib\/decision-os\//.test(TOOLS_SOURCE)

    it('the decision-tool gap is recorded on every registered decision while no tool imports the Decision OS', () => {
      const registered = CHIMMY_ANSWER_BANK.filter((c) => c.decision && !c.decision.startsWith('unregistered:'))
      if (decisionOsImported) {
        // A decision tool exists now: the gap must be gone from the bank, not left standing.
        expect(registered.filter((c) => c.knownGap?.includes(NO_DECISION_TOOL)).map((c) => c.id)).toEqual([])
      } else {
        expect(registered.filter((c) => !c.knownGap?.includes(NO_DECISION_TOOL)).map((c) => c.id)).toEqual([])
      }
    })

    it.each([
      [NO_ADP, /adp/i],
      [NO_PROBABILITY, /odds|probabilit|simulat/i],
      [NO_NEWS, /news|web_search|search/i],
    ])('"%s" stands only while no tool name matches', (gap, pattern) => {
      const toolExists = [...TOOL_NAMES].some((n) => pattern.test(n))
      const stillClaimed = CHIMMY_ANSWER_BANK.some((c) => c.knownGap?.includes(gap))
      expect({ toolExists, stillClaimed }).not.toEqual({ toolExists: true, stillClaimed: true })
    })
  })
})
