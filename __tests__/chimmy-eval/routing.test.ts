import { describe, expect, it } from 'vitest'
import {
  classifyPecrIntent,
  requiresLeagueGrounding,
  type PecrIntent,
} from '@/lib/chimmy-chat/question-routing'
import { classifyChimmyIntent } from '@/lib/chimmy-orchestration/intent-classifier'
import { inferAgentFromMessage } from '@/lib/agents/pipeline'
import { DEFAULT_CHIMMY_ASSISTANT_MODE } from '@/lib/chimmy-chat/assistant-mode'
import { CHIMMY_EVAL_CORPUS, type Dimension, type EvalCase, type EvalCategory } from './corpus'

/**
 * The Chimmy routing eval: every question in `corpus.ts`, through the four
 * decisions `/api/chat/chimmy` makes before any model call.
 *
 * This is deterministic and runs in every `npm test`. It scores ROUTING, not
 * answers — whether a question reaches the right workflow with the right
 * league requirement. Answer quality needs a model and is out of scope here.
 */

type Classifier = (q: string) => string | boolean

/** Mirrors the route: the PECR intent feeds the grounding gate. */
const decide: Record<Dimension, Classifier> = {
  pecr: (q) => classifyPecrIntent(q),
  grounding: (q) => requiresLeagueGrounding({ message: q, intent: classifyPecrIntent(q) }),
  orchestration: (q) => classifyChimmyIntent(q).intent,
  /* The route joins the assistant mode into the agent's input; mirror the default. */
  agent: (q) => inferAgentFromMessage([q, DEFAULT_CHIMMY_ASSISTANT_MODE].join('\n')),
}

const DIMENSIONS: readonly Dimension[] = ['pecr', 'grounding', 'orchestration', 'agent']

function accepted(c: EvalCase, d: Dimension): readonly (string | boolean)[] | null {
  const want = c[d]
  if (want === null) return null
  return Array.isArray(want) ? want : [want as string | boolean]
}

type Row = { c: EvalCase; d: Dimension }
const rows: Row[] = CHIMMY_EVAL_CORPUS.flatMap((c) =>
  DIMENSIONS.filter((d) => accepted(c, d) !== null).map((d) => ({ c, d })),
)

describe('Chimmy routing eval', () => {
  it.each(rows.map((r) => [r.d, r.c.q, r] as const))('%s: %s', (_d, _q, { c, d }) => {
    const actual = decide[d](c.q)
    const gap = c.gaps?.[d]

    if (gap) {
      /*
       * A known defect: pinned to its exact current value, so ANY change — a
       * regression elsewhere or the fix itself — turns this red and forces the
       * corpus to be updated rather than silently drifting.
       */
      expect(actual, `known gap moved (${gap.why}) — if this is a fix, delete the gap entry`).toBe(gap.today)
    } else {
      expect(accepted(c, d), `misrouted`).toContain(actual)
    }
  })
})

describe('the corpus is honest about itself', () => {
  /*
   * A gap whose `today` is one of the accepted values is not a gap at all: it
   * would pass either way and advertise a defect that does not exist.
   */
  it('every gap names a value outside its own expectation', () => {
    const stale = CHIMMY_EVAL_CORPUS.flatMap((c) =>
      DIMENSIONS.filter((d) => {
        const gap = c.gaps?.[d]
        const want = accepted(c, d)
        return gap && (want === null || want.includes(gap.today))
      }).map((d) => `${d}: ${c.q}`),
    )
    expect(stale).toEqual([])
  })

  it('has no duplicate questions', () => {
    const qs = CHIMMY_EVAL_CORPUS.map((c) => c.q.toLowerCase())
    expect(new Set(qs).size).toBe(qs.length)
  })

  /*
   * The brief this suite answers names these families explicitly: real fantasy
   * questions across the specialist workflows, platform settings, college
   * players, kickers and IDP. Pinned so a trim cannot quietly drop one.
   */
  it.each([
    ['trade', 5],
    ['waiver', 5],
    ['lineup', 5],
    ['draft', 5],
    ['commissioner', 4],
    ['research', 4],
    ['college', 4],
    ['kicker', 4],
    ['idp', 4],
    ['platform_settings', 6],
    ['real_world', 5],
    ['name_collision', 5],
  ] as const satisfies readonly (readonly [EvalCategory, number])[])('covers %s with at least %i questions', (cat, min) => {
    expect(CHIMMY_EVAL_CORPUS.filter((c) => c.category === cat).length).toBeGreaterThanOrEqual(min)
  })

  /*
   * The scoreboard. Not asserted as a number — each gap is already pinned
   * individually above — but carried in the TEST NAME, so any reporter that
   * lists tests says how far routing is from the corpus without anyone having
   * to count. (A `console.info` was tried first; this repo's runs do not print
   * it for a passing test.)
   */
  const gapCounts = DIMENSIONS.map((d) => `${d} ${CHIMMY_EVAL_CORPUS.filter((c) => c.gaps?.[d]).length}`)
  it(`scoreboard: ${CHIMMY_EVAL_CORPUS.length} questions, open gaps: ${gapCounts.join(', ')}`, () => {
    expect(gapCounts).toHaveLength(DIMENSIONS.length)
  })
})

/*
 * 🛑 POSITIVE CONTROL: THE SUITE MUST GO RED FOR THE BUG IT WAS WRITTEN AGAINST.
 *
 * These are the PECR patterns as they stood on main before 2026-09-16 — bare
 * substrings — copied verbatim. Scored against the corpus they must misroute
 * exactly the name-collision questions, or this suite cannot see the regression
 * it exists to catch, and every green run above is worth nothing.
 */
describe('positive control: the pre-fix substring classifier', () => {
  const LEGACY_ROSTER =
    /roster|lineup|sit\b|bench|flex|\bstarts?\s+(?:him|her|them|over|instead)|(?:who|should\s+i|do\s+i|would\s+you)\s+start\b|start\s*\/?\s*sit/i

  function legacyPecr(message: string): PecrIntent {
    if (/trade|swap|offer|deal|give|receiv/i.test(message)) return 'trade'
    if (/waiver|wire|pick\s*up|drop|add|free.?agent|faab|\bbids?\b|\bbidding\b|claim\s+(?:him|her|them)/i.test(message)) {
      return 'waiver'
    }
    if (LEGACY_ROSTER.test(message)) return 'roster'
    if (/draft|pick|adp|tier|rank/i.test(message)) return 'draft'
    return 'general'
  }

  function misroutedBy(classify: (q: string) => PecrIntent, category: EvalCategory): string[] {
    return CHIMMY_EVAL_CORPUS.filter((c) => c.category === category)
      .filter((c) => !accepted(c, 'pecr')!.includes(classify(c.q)))
      .map((c) => c.q)
  }

  it('misroutes the name collisions the fix exists for', () => {
    expect(misroutedBy(legacyPecr, 'name_collision')).toEqual([
      'Is Ladd McConkey a WR1?',
      'Jordan Addison rest-of-season outlook',
      'Is Tee Higgins an ideal WR2?',
      'George Pickens outlook for 2026',
      'Frank Gore career rushing yards',
    ])
  })

  /*
   * The legacy classifier also sent three of them into a league-requiring
   * intent — a 412 for anyone without a league selected. Scored as the set whose
   * requirement the fix REMOVES, because "How do I claim my team?" requires a
   * league under both (`my team`), and a before-only list would count it.
   */
  it('and turned three of them into a hard league requirement', () => {
    const lifted = CHIMMY_EVAL_CORPUS.filter((c) => c.category === 'name_collision')
      .filter((c) => requiresLeagueGrounding({ message: c.q, intent: legacyPecr(c.q) }))
      .filter((c) => !requiresLeagueGrounding({ message: c.q, intent: classifyPecrIntent(c.q) }))
      .map((c) => c.q)
    expect(lifted).toEqual(['Is Ladd McConkey a WR1?', 'Jordan Addison rest-of-season outlook', 'Is Tee Higgins an ideal WR2?'])
  })

  it('while the current classifier misroutes none of them', () => {
    expect(misroutedBy(classifyPecrIntent, 'name_collision')).toEqual([])
  })

  /* And the superflex case, which went through ROSTER_INTENT rather than a name. */
  it('read "superflex" as a lineup question, and the current one does not', () => {
    expect(legacyPecr('How does superflex scoring work?')).toBe('roster')
    expect(classifyPecrIntent('How does superflex scoring work?')).toBe('general')
  })
})
