import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { CHIMMY_AGENT_PROMPT_FILES, getSpecialistAgentPrompt, type ChimmyAgentType } from '@/lib/agents/pipeline'

/**
 * The prompt files behind every specialist the router can pick.
 *
 * `general_research` and `commissioner` are COMPOSED from `agent_global_rules.md` plus their own
 * section, where the ten older agents each carry their own copy of that 736-line header. Two
 * copies of one text is how they drift, so this file pins the shared one to the copies.
 */

const DIR = path.join(process.cwd(), 'lib', 'agents', 'prompts')
const read = (file: string) => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n')

const SHARED = read('agent_global_rules.md')

/* The nine older files that carry the header inline. `c2c` is standalone and never had it. */
const INLINE_HEADER_FILES = [
  'trade_analyzer_agent_prompt.md',
  'waiver_wire_agent_prompt.md',
  'draft_assistant_agent_prompt.md',
  'matchup_simulator_agent_prompt.md',
  'player_comparison_agent_prompt.md',
  'power_rankings_agent_prompt.md',
  'bracket_agent_prompt.md',
  'dynasty_legacy_agent_prompt.md',
  'storyline_agent_prompt.md',
]

describe('the shared agent header', () => {
  it('is the real header, not an empty or truncated file', () => {
    expect(SHARED.split('\n').length).toBeGreaterThan(700)
    expect(SHARED.startsWith('## GLOBAL RULES')).toBe(true)
    expect(SHARED).toContain('## SUPERFLEX / 2QB MODIFIER')
    expect(SHARED).toContain('## FORMAT 8: IDP (INDIVIDUAL DEFENSIVE PLAYER)')
  })

  it.each(INLINE_HEADER_FILES)('matches the header %s carries inline', (file) => {
    /*
     * If this goes red, someone edited the header in one place. Apply the edit to all ten, or the
     * two new agents and the nine old ones are following different rules.
     */
    expect(read(file).startsWith(SHARED)).toBe(true)
  })
})

describe('every agent the router can pick has a prompt', () => {
  const agents = Object.keys(CHIMMY_AGENT_PROMPT_FILES) as ChimmyAgentType[]

  it('covers the two agents added for routing', () => {
    expect(agents).toEqual(expect.arrayContaining(['general_research', 'commissioner']))
  })

  it.each(agents)('%s resolves to files that exist', (agent) => {
    for (const file of CHIMMY_AGENT_PROMPT_FILES[agent]) {
      expect(existsSync(path.join(DIR, file)), file).toBe(true)
    }
  })

  it.each(['general_research', 'commissioner'] as const)('%s is composed: shared header, then its own section', async (agent) => {
    const prompt = await getSpecialistAgentPrompt(agent)
    expect(prompt.startsWith('## GLOBAL RULES')).toBe(true)
    const title = agent === 'general_research' ? '# General Research Agent' : '# Commissioner Agent'
    expect(prompt).toContain(title)
    expect(prompt.indexOf(title)).toBeGreaterThan(prompt.indexOf('## SUPERFLEX / 2QB MODIFIER'))
  })

  /*
   * 🛑 THE REASON THE GENERAL AGENT EXISTS. The trade prompt demands a fairness score and an
   * accept / reject / counter verdict; a question that is not a decision must not be handed one.
   */
  it('the general research prompt does not demand a trade verdict', async () => {
    const prompt = await getSpecialistAgentPrompt('general_research')
    const own = prompt.slice(prompt.indexOf('# General Research Agent'))
    expect(own).not.toMatch(/Fairness score|Recommended action: \[Accept/)
    const trade = await getSpecialistAgentPrompt('trade_analyzer')
    expect(trade).toMatch(/Fairness score/)
  })
})
