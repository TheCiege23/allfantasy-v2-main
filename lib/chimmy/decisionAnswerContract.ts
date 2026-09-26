import { isGeneralMarketValueQuestion } from '@/lib/chimmy-chat/question-routing'
import { resolveAiAuthority } from '@/lib/decision-os/three-brain/phase4/aiAuthorityPolicy'
import type { ReadyChimmyScenario } from './tradeScenarioTypes'
import type { ChatStartCall } from './tools/chimmyTools'

export type ChimmyDecisionKind = 'trade' | 'lineup' | 'waiver'
export type ChimmyDecisionAnswer = {
  version: 1
  kind: ChimmyDecisionKind
  decisionType: string
  authority: 'explanation_only'
  status: 'ready' | 'needs_data'
  leagueId: string | null
  answer: string
  sources: string[]
  gap?: { code: string; remedy: string }
  scenario?: ReadyChimmyScenario
  startCalls?: ChatStartCall[]
}

const TYPES = { trade: 'manager.trade.evaluate', lineup: 'manager.lineup.set', waiver: 'manager.waiver.claim' } as const

/** Detect action requests, keeping rules education, history and general prices out of this lane. */
export function chimmyDecisionKind(question: string): ChimmyDecisionKind | null {
  if (isGeneralMarketValueQuestion(question)) return null
  if (/\baccept\s+or\s+(?:decline|reject)\b/i.test(question)) return 'trade'
  if (/\b(?:how\s+(?:does|do)|what\s+(?:is|are))\b.*\b(?:rules?|work|waiver\s+priority|faab)\b/i.test(question)) return null
  if (/\b(?:trades?|trading|offer|swap|counteroffer)\b/i.test(question) && /\b(?:should|worth|fair|grade|evaluate|accept|decline|reject|recommend|suggest|find|ideas?|targets?|improve|propose|for)\b/i.test(question)) return 'trade'
  if (/\b(?:waivers?|pick\s*up|add|drop|faab|bid|claim)\b/i.test(question) && /\b(?:should|who|which|recommend|best|worth|add|drop|bid|claim)\b/i.test(question)) return 'waiver'
  if (/\b(?:start|sit|bench)\b.*\b(?:or|over|instead)\b|\b(?:who|whom|which)\b.*\b(?:start|sit|bench)\b|\b(?:should|can)\s+i\s+(?:start|sit|bench)\b|\b(?:set|optimi[sz]e|fix|best|check)\b.*\blineup\b|\b(?:is|does)\s+my\s+lineup\b/i.test(question)) return 'lineup'
  return null
}

export function decisionAnswer(args: Omit<ChimmyDecisionAnswer, 'version' | 'authority' | 'decisionType'>): ChimmyDecisionAnswer {
  const decisionType = TYPES[args.kind]
  if (resolveAiAuthority(decisionType) !== 'explanation_only') throw new Error('Consequential Chimmy decisions must remain engine-authorized')
  return { ...args, version: 1, decisionType, authority: 'explanation_only' }
}

/** Client metadata deliberately excludes private engine inputs and the duplicate answer text. */
export function decisionAnswerMeta(result: ChimmyDecisionAnswer) {
  return { version: result.version, kind: result.kind, decisionType: result.decisionType, authority: result.authority,
    status: result.status, leagueId: result.leagueId, sources: result.sources, ...(result.gap ? { gap: result.gap } : {}) }
}
