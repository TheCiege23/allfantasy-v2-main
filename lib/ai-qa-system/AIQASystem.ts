import type { AIContextEnvelope, ModelOutput } from '@/lib/unified-ai/types'

interface AIQASystemInput {
  primaryAnswer: string
  modelOutputs: ModelOutput[]
  envelope?: AIContextEnvelope
  factGuardWarnings?: string[]
}

interface AIQAVerification {
  noHallucinations: boolean
  correctDataUsage: boolean
  consistentResponses: boolean
}

interface AIQASystemReport {
  passed: boolean
  score: number
  verification: AIQAVerification
  warnings: string[]
}

function extractNumericTokens(text: string): Set<string> {
  const matches = text.match(/-?\d+(?:\.\d+)?%?/g) ?? []
  return new Set(matches.map((token) => normalizeNumericToken(token)).filter(Boolean))
}

function normalizeNumericToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  const hasPercent = trimmed.endsWith('%')
  const numericPart = hasPercent ? trimmed.slice(0, -1) : trimmed
  const parsed = Number(numericPart)
  if (!Number.isFinite(parsed)) return trimmed
  const normalized = parsed.toString()
  return hasPercent ? `${normalized}%` : normalized
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function extractDeterministicTextSources(envelope?: AIContextEnvelope): string[] {
  if (!envelope) return []
  const sources: string[] = []
  if (envelope.deterministicPayload) {
    sources.push(stableStringify(envelope.deterministicPayload))
  }
  if (envelope.deterministicContextEnvelope) {
    sources.push(stableStringify(envelope.deterministicContextEnvelope))
  }
  if (envelope.statisticsPayload) {
    sources.push(stableStringify(envelope.statisticsPayload))
  }
  return sources.filter(Boolean)
}

function tokenizeWords(text: string): Set<string> {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'that',
    'this',
    'your',
    'have',
    'will',
    'into',
    'about',
    'there',
    'their',
    'because',
    'should',
    'would',
    'could',
    'based',
    'data',
    'league',
    'team',
    'player',
    'value',
    'trade',
  ])
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !stopWords.has(word))
  return new Set(words)
}

function inferVerdict(text: string): string {
  const lowered = text.toLowerCase()
  if (/\b(accept|approve|take|go with)\b/.test(lowered)) return 'accept'
  if (/\b(reject|decline|avoid|pass)\b/.test(lowered)) return 'reject'
  if (/\b(hold|wait|neutral|even|mixed)\b/.test(lowered)) return 'hold'
  return 'unknown'
}

/**
 * PROMPT 249 — AI QA System:
 * verify hallucination risk, deterministic data usage, and response consistency.
 */
export function runAIQASystem(input: AIQASystemInput): AIQASystemReport {
  const warnings: string[] = []
  let score = 100

  const answer = (input.primaryAnswer ?? '').trim()
  const deterministicSources = extractDeterministicTextSources(input.envelope)
  const deterministicText = deterministicSources.join('\n')
  const deterministicNumbers = extractNumericTokens(deterministicText)
  const answerNumbers = extractNumericTokens(answer)

  const factWarnings = input.factGuardWarnings ?? []
  const hasFactGuardHallucinationWarning = factWarnings.some((warning) =>
    /invent|unsupported|hallucin|made up|unverified/i.test(warning)
  )

  let noHallucinations = true
  if (hasFactGuardHallucinationWarning) {
    noHallucinations = false
    warnings.push('Fact guard flagged unsupported or invented claims.')
    score -= 25
  } else if (deterministicNumbers.size > 0 && answerNumbers.size > 0) {
    const unknownNumbers = [...answerNumbers].filter((token) => {
      if (deterministicNumbers.has(token)) return false
      // Common confidence/fairness denominator notation (e.g., "87/100") should not be treated as hallucination.
      if (token === '100' && answer.includes('/100')) return false
      return true
    })
    if (unknownNumbers.length > 0) {
      noHallucinations = false
      warnings.push(`Answer introduced numbers not found in deterministic context: ${unknownNumbers.slice(0, 5).join(', ')}`)
      score -= 20
    }
  }

  let correctDataUsage = true
  if (deterministicText.length > 0 && answer.length > 0) {
    const deterministicWords = tokenizeWords(deterministicText)
    const answerWords = tokenizeWords(answer)
    const overlapCount = [...answerWords].filter((word) => deterministicWords.has(word)).length
    const numberOverlapCount = [...answerNumbers].filter((token) => deterministicNumbers.has(token)).length
    if (overlapCount === 0 && numberOverlapCount === 0) {
      correctDataUsage = false
      warnings.push('Answer does not appear grounded in provided deterministic context.')
      score -= 20
    }
  }

  let consistentResponses = true
  const verdicts = [inferVerdict(answer)]
  for (const output of input.modelOutputs) {
    if (output.skipped || output.error) continue
    const raw = typeof output.raw === 'string' ? output.raw.trim() : ''
    if (!raw) continue
    verdicts.push(inferVerdict(raw))
  }
  const meaningfulVerdicts = verdicts.filter((verdict) => verdict !== 'unknown')
  const uniqueVerdicts = new Set(meaningfulVerdicts)
  if (uniqueVerdicts.size > 1) {
    consistentResponses = false
    warnings.push(`Provider outputs disagree on recommendation direction: ${[...uniqueVerdicts].join(', ')}`)
    score -= 15
  }

  score = Math.max(0, Math.min(100, score))
  const verification: AIQAVerification = {
    noHallucinations,
    correctDataUsage,
    consistentResponses,
  }

  return {
    passed: noHallucinations && correctDataUsage && consistentResponses,
    score,
    verification,
    warnings,
  }
}
