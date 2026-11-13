import type { ChimmyResponseStructure } from './types'

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g
const MAX_VOICE_SUMMARY_WORDS = 30

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stripMarkdownPreservingLines(text: string): string {
  return text
    .replace(MARKDOWN_LINK_REGEX, '$1')
    .replace(/[_*`>#]/g, ' ')
}

function stripMarkdown(text: string): string {
  return normalizeWhitespace(stripMarkdownPreservingLines(text))
}

function splitSentences(text: string): string[] {
  return stripMarkdown(text)
    .split(SENTENCE_SPLIT_REGEX)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function firstSentence(text?: string | null): string {
  if (!text) return ''
  return splitSentences(text)[0] ?? ''
}

function firstTwoSentences(text: string): string {
  const sentences = splitSentences(text)
  return sentences.slice(0, 2).join(' ').trim()
}

function splitLines(text: string): string[] {
  return stripMarkdownPreservingLines(text)
    .split(/\r?\n+/)
    .map((line) => normalizeWhitespace(line.replace(/^[-*•\d.)\s]+/, '')))
    .filter(Boolean)
}

function joinUniqueSentences(parts: Array<string | null | undefined>, maxSentences = 2): string {
  const unique: string[] = []

  for (const part of parts) {
    const sentence = normalizeWhitespace(part ?? '')
    if (!sentence) continue
    if (unique.some((existing) => existing.toLowerCase() === sentence.toLowerCase())) continue
    unique.push(sentence)
    if (unique.length >= maxSentences) break
  }

  return unique.join(' ').trim()
}

export function countWords(text: string): number {
  return stripMarkdown(text).split(/\s+/).filter(Boolean).length
}

export function isLongChimmyResponse(text: string): boolean {
  return countWords(text) > 150
}

function truncateToWordLimit(text: string, maxWords = MAX_VOICE_SUMMARY_WORDS): string {
  const words = stripMarkdown(text).split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return normalizeWhitespace(text)
  return `${words.slice(0, maxWords).join(' ').trim()}...`
}

function firstMatchingLine(text: string, matcher: RegExp): string {
  return splitLines(text).find((line) => matcher.test(line)) ?? ''
}

function firstMatchingSentence(text: string, matcher: RegExp): string {
  return splitSentences(text).find((sentence) => matcher.test(sentence)) ?? ''
}

function extractTradeVerdict(input: {
  content: string
  shortAnswer: string
  recommendation: string
}) {
  const normalizedContent = stripMarkdownPreservingLines(input.content)
  const recommendationMatch = normalizedContent.match(/recommendation\s*:\s*([^.!?]+[.!?]?)/i)
  if (recommendationMatch?.[1]) {
    return normalizeWhitespace(recommendationMatch[1])
  }

  const tradeCallMatch = normalizedContent.match(/\b(?:accept|reject|counter|hold)\b[^.!?]*[.!?]?/i)
  if (tradeCallMatch?.[0]) {
    return normalizeWhitespace(tradeCallMatch[0])
  }

  const recommendationLine = firstMatchingLine(input.content, /\brecommendation\s*:/i)
  if (recommendationLine) {
    return recommendationLine.replace(/\brecommendation\s*:\s*/i, '').trim()
  }

  const uppercaseTradeCall =
    firstMatchingLine(input.content, /\b(?:accept|reject|counter|hold)\b/i) ||
    firstMatchingSentence(input.content, /\b(?:accept|reject|counter|hold)\b/i)

  return uppercaseTradeCall || input.recommendation || input.shortAnswer
}

function extractWaiverVerdict(input: {
  content: string
  shortAnswer: string
  recommendation: string
}) {
  const normalizedContent = stripMarkdownPreservingLines(input.content)
  const pickupMatch = normalizedContent.match(/\b(?:top pickup|pickup|priority add|add|claim)\b[^.!?\n]*[.!?]?/i)
  if (pickupMatch?.[0]) {
    return normalizeWhitespace(pickupMatch[0])
  }

  const pickupLine =
    firstMatchingLine(input.content, /\b(?:top pickup|pickup|priority add|add|claim)\b/i) ||
    firstMatchingSentence(input.content, /\b(?:top pickup|pickup|priority add|add|claim)\b/i)

  return pickupLine || input.recommendation || input.shortAnswer
}

export function buildChimmyCollapsedSummary(input: {
  content: string
  responseStructure?: ChimmyResponseStructure | null
}): string {
  const shortAnswer = normalizeWhitespace(input.responseStructure?.shortAnswer ?? '')
  const recommendation = firstSentence(input.responseStructure?.recommendedAction)
  const meaning = firstSentence(input.responseStructure?.whatItMeans)
  const data = firstSentence(input.responseStructure?.whatDataSays)

  return (
    joinUniqueSentences([shortAnswer, recommendation, meaning || data], 2) ||
    firstTwoSentences(input.content) ||
    stripMarkdown(input.content)
  )
}

export function buildChimmyResponseStructure(answer: string): ChimmyResponseStructure {
  const shortAnswer = firstSentence(answer) || 'Chimmy response available.'
  const whatDataSays = firstSentence(answer) || undefined

  return {
    shortAnswer,
    whatDataSays,
  }
}

export function buildChimmyVoiceSummary(input: {
  content: string
  responseStructure?: ChimmyResponseStructure | null
  recommendedTool?: string | null
}): string {
  const normalizedContent = stripMarkdownPreservingLines(input.content)
  const shortAnswer = normalizeWhitespace(input.responseStructure?.shortAnswer ?? '')
  const recommendation = firstSentence(input.responseStructure?.recommendedAction)
  const meaning = firstSentence(input.responseStructure?.whatItMeans)
  const data = firstSentence(input.responseStructure?.whatDataSays)
  const intentHint = `${input.recommendedTool ?? ''} ${shortAnswer} ${input.content}`.toLowerCase()
  const tradeVerdict = extractTradeVerdict({
    content: input.content,
    shortAnswer,
    recommendation,
  })
  const waiverVerdict = extractWaiverVerdict({
    content: input.content,
    shortAnswer,
    recommendation,
  })

  const directRecommendationVerdict = normalizedContent.match(/recommendation\s*:\s*([^.!?]+[.!?]?)/i)?.[1]
  if (directRecommendationVerdict) {
    return truncateToWordLimit(normalizeWhitespace(directRecommendationVerdict))
  }

  if (/start\b|sit\b/.test(intentHint) && shortAnswer) {
    return truncateToWordLimit(shortAnswer)
  }

  if (/\brecommendation\s*:|\b(?:accept|reject|counter|hold)\b/i.test(input.content) && tradeVerdict) {
    return truncateToWordLimit(tradeVerdict)
  }

  if (/trade|counter|accept|reject/.test(intentHint)) {
    return truncateToWordLimit(
      tradeVerdict ||
        joinUniqueSentences([recommendation || shortAnswer, meaning || data || shortAnswer], 2) ||
        firstTwoSentences(input.content)
    )
  }

  if (/\b(?:top pickup|pickup|priority add|add|claim)\b/i.test(input.content) && waiverVerdict) {
    return truncateToWordLimit(waiverVerdict)
  }

  if (/waiver|pickup|add\b|free agent|drop\b/.test(intentHint)) {
    return truncateToWordLimit(
      waiverVerdict ||
        joinUniqueSentences([recommendation || shortAnswer, meaning || data || shortAnswer], 2) ||
        firstTwoSentences(input.content)
    )
  }

  return truncateToWordLimit(
    joinUniqueSentences([shortAnswer, meaning || data || recommendation], 2) ||
      firstTwoSentences(input.content) ||
      stripMarkdown(input.content)
  )
}

