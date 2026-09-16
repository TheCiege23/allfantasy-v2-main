import 'server-only'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { classifyChimmyIntent } from '@/lib/chimmy-orchestration/intent-classifier'
import type { ChimmyOrchestrationIntent } from '@/lib/chimmy-orchestration/types'

export type ChimmyAgentType =
  | 'trade_analyzer'
  | 'waiver_wire'
  | 'draft_assistant'
  | 'matchup_simulator'
  | 'player_comparison'
  | 'power_rankings'
  | 'bracket'
  | 'dynasty_legacy'
  | 'c2c_specialist'
  | 'storyline'
  | 'general_research'
  | 'commissioner'

const PROMPT_DIR = path.join(process.cwd(), 'lib', 'agents', 'prompts')
const SYSTEM_PROMPT_FILE = 'chimmy_system_prompt.md'

/*
 * The ten original agent files each carry an identical 736-line GLOBAL RULES / LEAGUE FORMAT
 * header ahead of their own section. The two added on 2026-09-16 do not copy it a tenth and
 * eleventh time: they are composed from `agent_global_rules.md` plus their own section.
 * `__tests__/chimmy-eval/agent-prompts.test.ts` fails if that shared file stops matching the
 * header the other nine carry — so editing the header in one place and not the other goes red.
 */
const GLOBAL_RULES_FILE = 'agent_global_rules.md'

const AGENT_PROMPT_FILE_MAP: Record<ChimmyAgentType, string | readonly string[]> = {
  trade_analyzer: 'trade_analyzer_agent_prompt.md',
  waiver_wire: 'waiver_wire_agent_prompt.md',
  draft_assistant: 'draft_assistant_agent_prompt.md',
  matchup_simulator: 'matchup_simulator_agent_prompt.md',
  player_comparison: 'player_comparison_agent_prompt.md',
  power_rankings: 'power_rankings_agent_prompt.md',
  bracket: 'bracket_agent_prompt.md',
  dynasty_legacy: 'dynasty_legacy_agent_prompt.md',
  c2c_specialist: 'c2c_agent_prompt.md',
  storyline: 'storyline_agent_prompt.md',
  general_research: [GLOBAL_RULES_FILE, 'general_research_agent_prompt.md'],
  commissioner: [GLOBAL_RULES_FILE, 'commissioner_agent_prompt.md'],
}

export const CHIMMY_AGENT_PROMPT_FILES: Readonly<Record<ChimmyAgentType, readonly string[]>> = Object.fromEntries(
  Object.entries(AGENT_PROMPT_FILE_MAP).map(([agent, files]) => [agent, typeof files === 'string' ? [files] : files]),
) as Record<ChimmyAgentType, readonly string[]>

const promptCache = new Map<string, string>()

async function readPromptFile(fileName: string): Promise<string> {
  if (promptCache.has(fileName)) {
    return promptCache.get(fileName) as string
  }

  const filePath = path.join(PROMPT_DIR, fileName)
  const text = await fs.readFile(filePath, 'utf8')
  const normalized = text.trim()
  promptCache.set(fileName, normalized)
  return normalized
}

export async function getChimmySystemPrompt(): Promise<string> {
  return readPromptFile(SYSTEM_PROMPT_FILE)
}

export async function getSpecialistAgentPrompt(agent: ChimmyAgentType): Promise<string> {
  const parts = await Promise.all(CHIMMY_AGENT_PROMPT_FILES[agent].map((file) => readPromptFile(file)))
  return parts.join('\n\n')
}

export type BuildAgentPromptInput = {
  agent: ChimmyAgentType
  userMessage: string
  sport?: string | null
  deterministicContext?: Record<string, unknown> | null
  conversationContext?: string | null
}

export async function buildAgentPrompt(input: BuildAgentPromptInput): Promise<string> {
  const [systemPrompt, specialistPrompt] = await Promise.all([
    getChimmySystemPrompt(),
    getSpecialistAgentPrompt(input.agent),
  ])

  const sport = normalizeToSupportedSport(input.sport || DEFAULT_SPORT)
  const deterministicContext =
    input.deterministicContext && Object.keys(input.deterministicContext).length > 0
      ? JSON.stringify(input.deterministicContext, null, 2)
      : '{}'

  const convoContext = (input.conversationContext || '').trim()

  return [
    systemPrompt,
    '',
    '---',
    '',
    specialistPrompt,
    '',
    '---',
    '',
    '## Runtime Context',
    `- Target sport: ${sport}`,
    `- Agent: ${input.agent}`,
    '',
    '### User Message',
    input.userMessage.trim() || '(empty user message)',
    '',
    '### Deterministic Context JSON',
    deterministicContext,
    '',
    '### Conversation Context',
    convoContext || '(none provided)',
  ].join('\n')
}

/**
 * Which specialist prompt answers a question.
 *
 * 🛑 THIS WAS A SECOND, INDEPENDENT CLASSIFIER, AND ITS FALLTHROUGH WAS THE TRADE ANALYZER.
 * Until 2026-09-16 it ran its own regex set, unrelated to the orchestration intent the route had
 * already computed, and anything those regexes missed became `trade_analyzer`. That was most
 * questions: "who should I pick up?", "should I start X or Y?", "when does the season start?",
 * "is there collusion in my league?". Each was answered under a prompt that demands a fairness
 * score and an accept / reject / counter verdict. `__tests__/chimmy-eval/` counted 53 wrong
 * picks across 71 real questions.
 *
 * Now the orchestration intent decides, so the prompt and the intent label the model is shown
 * cannot disagree. What remains here is only what the intent taxonomy cannot express:
 *
 * - `bracket` and College-to-Canton, which are products rather than question shapes;
 * - an explicit `insightType` from the surface, which is a stronger signal than any wording;
 * - refinements where the intent is too coarse (a comparison, a dynasty window, "worth
 *   rostering", collusion);
 * - the assistant MODE and league format, which choose a specialist ONLY when the question
 *   itself names no workflow. They used to be joined into the text being classified, so a
 *   Dynasty Lens trade question went to the dynasty agent and a dynasty league's every
 *   unmatched question did too.
 *
 * `general_research` is the fallthrough. A question that is not a decision gets a prompt that
 * does not ask for one.
 */
export type ChimmyAgentHints = {
  /** The orchestration intent the route already computed. Classified here when absent. */
  intent?: ChimmyOrchestrationIntent
  insightType?: string | null
  mode?: string | null
  leagueFormat?: string | null
}

const INTENT_AGENT: Record<ChimmyOrchestrationIntent, ChimmyAgentType> = {
  trade: 'trade_analyzer',
  waiver: 'waiver_wire',
  start_sit: 'matchup_simulator',
  matchup: 'matchup_simulator',
  draft: 'draft_assistant',
  league_strength: 'power_rankings',
  story_recap: 'storyline',
  commissioner: 'commissioner',
  bracket: 'bracket',
  player_value: 'general_research',
  injury: 'general_research',
  weather: 'general_research',
  manager_psychology: 'general_research',
  general: 'general_research',
}

/* A Map, not an object literal: `insightType` is a request field, and `{}['constructor']` is truthy. */
const INSIGHT_AGENT = new Map<string, ChimmyAgentType>([
  ['trade', 'trade_analyzer'],
  ['waiver', 'waiver_wire'],
  ['draft', 'draft_assistant'],
  ['matchup', 'matchup_simulator'],
  ['dynasty', 'dynasty_legacy'],
])

export function inferAgentFromMessage(message: string, hints: ChimmyAgentHints = {}): ChimmyAgentType {
  const text = message.toLowerCase()

  if (/\b(brackets?|march\s+madness)\b/.test(text)) return 'bracket'
  if (/\bc2c\b|college to canton|campus to canton|college scoring|college roster/.test(text)) return 'c2c_specialist'

  const insight = INSIGHT_AGENT.get(String(hints.insightType ?? '').toLowerCase())
  if (insight) return insight

  const intent = hints.intent ?? classifyChimmyIntent(message).intent
  const agent = INTENT_AGENT[intent]

  /*
   * ⚠ COLLUSION IS AN INTEGRITY QUESTION FOR THE COMMISSIONER, even though the orchestration
   * intent (deliberately, and pinned by its own tests) files it under manager psychology.
   *
   * 🛑 NOT A BARE `tank`. The first version matched `tank(?:s|ed|ing)?` and sent "Flex Tank Bigsby
   * or Rhamondre Stevenson?" to the commissioner — the substring-in-a-name bug this whole change
   * exists to remove, reintroduced by it. Caught by the held-out set in `__tests__/chimmy-eval/`.
   */
  if (/\b(collu\w*|tanking|tanked)\b|\bto\s+tank\b/.test(text)) return 'commissioner'

  if (agent !== 'general_research') return agent

  // Refinements for a question that named no workflow of its own.
  if (/\b(worth\s+(?:rostering|adding|a\s+roster\s+spot|picking\s+up|stashing)|rostering)\b/.test(text)) {
    return 'waiver_wire'
  }
  if (/\b(compare|comparison|versus|vs\.?)\b/.test(text)) return 'player_comparison'
  if (/\b(dynasty|rebuild(?:ing)?|contend(?:er|ers|ing)?|contention)\b/.test(text)) return 'dynasty_legacy'

  const mode = String(hints.mode ?? '').toLowerCase()
  if (mode === 'dynasty_lens' || /\bdynasty\b/.test(String(hints.leagueFormat ?? '').toLowerCase())) {
    return 'dynasty_legacy'
  }
  if (mode === 'commissioner_view') return 'commissioner'

  return 'general_research'
}
