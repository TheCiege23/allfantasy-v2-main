import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/queues/bullmq'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'

export type MemoryEntryType =
  | 'user-message'
  | 'ai-response'
  | 'tool-call'
  | 'decision'
  | 'summary'

export interface MemoryEntry {
  id: string
  type: MemoryEntryType
  content: string
  importance: number
  timestamp: number
  compressed: boolean
  tags: string[]
  confidence?: number
}

export interface WorkingMemory {
  sessionId: string
  userId: string | null
  compressionGen: number
  tokenEstimate: number
  updatedAt: number
  entries: MemoryEntry[]
}

export interface WorkingMemoryPrompt {
  systemBlock: string
  contextBlock: string
  tokenCount: number
}

const DETAIL_ENTRY_LIMIT = 8
const MAX_TOTAL_ENTRIES = 40
const TOKEN_TARGET = 1500
const TOKEN_BUFFER = 100
const REDIS_PREFIX = 'working-memory'
const FALLBACK_EVENT_PREFIX = 'wm'
const DEFAULT_CONFIDENCE = 0.7
const WORKING_MEMORY_EVENT_TYPE = 'working_memory'
const SUMMARY_MODEL =
  process.env.ANTHROPIC_MODEL_QUICKASK?.trim() || 'claude-haiku-4-5-20251001'

const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? ''
const isServerRuntime = typeof window === 'undefined'

type AnthropicSdkModule = typeof import('@anthropic-ai/sdk')
type AnthropicSummaryClient = InstanceType<AnthropicSdkModule['default']>

let anthropicSummaryClientPromise: Promise<AnthropicSummaryClient | null> | null = null

async function getAnthropicSummaryClient(): Promise<AnthropicSummaryClient | null> {
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already returns null when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  if (!isAiSpendEnabled()) return null

  if (!anthropicApiKey || !isServerRuntime) {
    return null
  }

  if (!anthropicSummaryClientPromise) {
    anthropicSummaryClientPromise = import('@anthropic-ai/sdk')
      .then((mod) => {
        const Anthropic = mod.default
        return new Anthropic({ apiKey: anthropicApiKey })
      })
      .catch(() => null)
  }

  return anthropicSummaryClientPromise
}

const TAG_DICTIONARY = [
  'trade',
  'waiver',
  'draft',
  'lineup',
  'roster',
  'matchup',
  'playoff',
  'rebuild',
  'contender',
  'dynasty',
  'keeper',
  'redraft',
  'superflex',
  'ppr',
  'qb',
  'rb',
  'wr',
  'te',
  'nfl',
  'nba',
  'mlb',
  'nhl',
  'ncaaf',
  'ncaab',
  'soccer',
]

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function getRedisKey(sessionId: string): string {
  return `${REDIS_PREFIX}:${sessionId}`
}

function getFallbackEventId(sessionId: string): string {
  return `${FALLBACK_EVENT_PREFIX}-${sessionId}`
}

function uniqueItems(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function truncate(text: string, maxChars: number): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`
}

function getBaseImportance(type: MemoryEntryType, confidence: number, tags: string[]): number {
  const typeWeight: Record<MemoryEntryType, number> = {
    'user-message': 0.5,
    'ai-response': 0.7,
    'tool-call': 0.55,
    decision: 0.85,
    summary: 0.45,
  }

  const tagBoost = Math.min(tags.length, 4) * 0.03
  return clamp(typeWeight[type] + tagBoost + Math.max(confidence - 0.5, 0) * 0.25, 0.1, 1)
}

function inferTags(content: string, seedTags: string[] = []): string[] {
  const normalized = content.toLowerCase()
  const matchedTags = TAG_DICTIONARY.filter((tag) => normalized.includes(tag))
  return uniqueItems([...seedTags.map((tag) => tag.toLowerCase()), ...matchedTags]).slice(0, 8)
}

function scoreEntry(entry: MemoryEntry, featureTags: string[], now: number): number {
  const ageMs = Math.max(now - entry.timestamp, 0)
  const ageHours = ageMs / (1000 * 60 * 60)
  const recencyScore = 1 / (1 + ageHours / 12)
  const overlap = entry.tags.filter((tag) => featureTags.includes(tag)).length
  const overlapBoost = overlap * 0.2
  const typeBoost =
    entry.type === 'decision' ? 0.2 : entry.type === 'summary' ? -0.05 : entry.type === 'tool-call' ? 0.05 : 0

  return entry.importance + recencyScore + overlapBoost + typeBoost
}

function makeEntry(
  type: MemoryEntryType,
  content: string,
  seedTags: string[] = [],
  confidence: number = DEFAULT_CONFIDENCE,
  compressed = false
): MemoryEntry {
  const tags = inferTags(content, seedTags)
  return {
    id: randomUUID(),
    type,
    content: truncate(content, compressed ? 500 : 900),
    importance: getBaseImportance(type, confidence, tags),
    timestamp: Date.now(),
    compressed,
    tags,
    confidence,
  }
}

function normalizeEntry(entry: Partial<MemoryEntry>, fallbackIndex: number): MemoryEntry {
  const content = typeof entry.content === 'string' ? entry.content : ''
  const type = (entry.type ?? 'summary') as MemoryEntryType
  const confidence = typeof entry.confidence === 'number' ? entry.confidence : DEFAULT_CONFIDENCE
  const tags = Array.isArray(entry.tags)
    ? entry.tags.filter((tag): tag is string => typeof tag === 'string')
    : []

  return {
    id: typeof entry.id === 'string' ? entry.id : `mem-${fallbackIndex}`,
    type,
    content,
    importance:
      typeof entry.importance === 'number'
        ? entry.importance
        : getBaseImportance(type, confidence, tags),
    timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now() - fallbackIndex,
    compressed: Boolean(entry.compressed),
    tags,
    confidence,
  }
}

function emptyMemory(sessionId: string, userId?: string | null): WorkingMemory {
  return {
    sessionId,
    userId: userId ?? null,
    compressionGen: 0,
    tokenEstimate: 0,
    updatedAt: Date.now(),
    entries: [],
  }
}

function normalizeMemory(
  raw: Partial<WorkingMemory> | null,
  sessionId: string,
  userId?: string | null
): WorkingMemory {
  const base = emptyMemory(sessionId, userId)
  if (!raw) return base

  const entries = Array.isArray(raw.entries)
    ? raw.entries.map((entry, index) => normalizeEntry(entry, index))
    : []

  return {
    sessionId,
    userId: userId ?? raw.userId ?? null,
    compressionGen: typeof raw.compressionGen === 'number' ? raw.compressionGen : 0,
    tokenEstimate: typeof raw.tokenEstimate === 'number' ? raw.tokenEstimate : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    entries: entries.sort((a, b) => b.timestamp - a.timestamp),
  }
}

function parseMemoryPayload(
  payload: string | Record<string, unknown> | null | undefined,
  sessionId: string,
  userId?: string | null
): WorkingMemory | null {
  if (!payload) return null

  try {
    const parsed =
      typeof payload === 'string' ? (JSON.parse(payload) as Partial<WorkingMemory>) : (payload as Partial<WorkingMemory>)
    return normalizeMemory(parsed, sessionId, userId)
  } catch {
    return null
  }
}

async function loadWorkingMemory(sessionId: string, userId?: string | null): Promise<WorkingMemory> {
  const redisKey = getRedisKey(sessionId)

  if (redis) {
    try {
      const cached = await redis.get(redisKey)
      const parsed = parseMemoryPayload(cached, sessionId, userId)
      if (parsed) return parsed
    } catch {
      // Fall through to Prisma fallback.
    }
  }

  try {
    const fallback = await prisma.aIMemoryEvent.findUnique({
      where: { id: getFallbackEventId(sessionId) },
    })
    const parsed = parseMemoryPayload(
      (fallback?.content ?? null) as Record<string, unknown> | null,
      sessionId,
      userId
    )
    if (parsed) return parsed
  } catch {
    // Return empty memory below.
  }

  return emptyMemory(sessionId, userId)
}

async function saveWorkingMemory(memory: WorkingMemory): Promise<void> {
  const payload = JSON.stringify(memory)
  const fallbackContent = JSON.parse(payload) as Record<string, unknown>

  if (redis) {
    try {
      await redis.set(getRedisKey(memory.sessionId), payload)
      return
    } catch {
      // Fall through to Prisma fallback.
    }
  }

  await prisma.aIMemoryEvent.upsert({
    where: { id: getFallbackEventId(memory.sessionId) },
    update: {
      userId: memory.userId,
      eventType: WORKING_MEMORY_EVENT_TYPE,
      subject: memory.sessionId,
      content: fallbackContent,
      confidence: 1,
      expiresAt: null,
    },
    create: {
      id: getFallbackEventId(memory.sessionId),
      userId: memory.userId,
      leagueId: null,
      teamId: null,
      eventType: WORKING_MEMORY_EVENT_TYPE,
      subject: memory.sessionId,
      content: fallbackContent,
      confidence: 1,
      expiresAt: null,
    },
  })
}

async function summarizeChunk(entries: MemoryEntry[]): Promise<string> {
  const deterministicSummary = [
    'Compressed session summary:',
    ...entries.slice(0, 6).map((entry) => `- ${entry.type}: ${truncate(entry.content, 120)}`),
  ].join('\n')

  const anthropic = await getAnthropicSummaryClient()
  if (!anthropic || entries.length === 0) {
    return deterministicSummary
  }

  try {
    const response = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 220,
      system:
        'Compress prior session context for an internal working-memory store. Return 3-5 bullets, factual only, no markdown heading.',
      messages: [
        {
          role: 'user',
          content: entries
            .map((entry) => `[${entry.type}] ${truncate(entry.content, 220)}`)
            .join('\n'),
        },
      ],
    })

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    return text || deterministicSummary
  } catch {
    return deterministicSummary
  }
}

async function compressOlderEntries(memory: WorkingMemory): Promise<WorkingMemory> {
  if (memory.entries.length <= DETAIL_ENTRY_LIMIT) {
    return memory
  }

  const recent = memory.entries.slice(0, DETAIL_ENTRY_LIMIT)
  const older = memory.entries.slice(DETAIL_ENTRY_LIMIT)
  const alreadyCompressed = older.filter((entry) => entry.compressed)
  const uncompressed = older.filter((entry) => !entry.compressed)

  if (uncompressed.length === 0) {
    return memory
  }

  const summaryEntries: MemoryEntry[] = []
  for (let index = 0; index < uncompressed.length; index += 6) {
    const chunk = uncompressed.slice(index, index + 6)
    const summary = await summarizeChunk(chunk)
    const summaryTags = uniqueItems(chunk.flatMap((entry) => entry.tags))
    const summaryTimestamp = chunk[0]?.timestamp ?? Date.now()
    summaryEntries.push({
      id: randomUUID(),
      type: 'summary',
      content: summary,
      importance: clamp(
        chunk.reduce((total, entry) => total + entry.importance, 0) / Math.max(chunk.length, 1),
        0.2,
        0.8
      ),
      timestamp: summaryTimestamp,
      compressed: true,
      tags: summaryTags,
      confidence: 0.75,
    })
  }

  const entries = [...recent, ...alreadyCompressed, ...summaryEntries].sort(
    (a, b) => b.timestamp - a.timestamp
  )

  return {
    ...memory,
    compressionGen: memory.compressionGen + 1,
    entries,
    updatedAt: Date.now(),
  }
}

async function maintainMemory(
  memory: WorkingMemory,
  featureTags: string[] = []
): Promise<WorkingMemory> {
  let nextMemory = normalizeMemory(memory, memory.sessionId, memory.userId)
  nextMemory = await compressOlderEntries(nextMemory)

  if (nextMemory.entries.length > MAX_TOTAL_ENTRIES) {
    const preservedRecent = nextMemory.entries.slice(0, DETAIL_ENTRY_LIMIT)
    const remaining = nextMemory.entries.slice(DETAIL_ENTRY_LIMIT)
    const now = Date.now()
    const sortedRemaining = [...remaining].sort(
      (a, b) => scoreEntry(b, featureTags, now) - scoreEntry(a, featureTags, now)
    )
    nextMemory = {
      ...nextMemory,
      entries: [...preservedRecent, ...sortedRemaining.slice(0, MAX_TOTAL_ENTRIES - DETAIL_ENTRY_LIMIT)].sort(
        (a, b) => b.timestamp - a.timestamp
      ),
      updatedAt: Date.now(),
    }
  }

  nextMemory.tokenEstimate = buildWorkingMemoryPrompt(nextMemory, featureTags).tokenCount
  return nextMemory
}

async function appendEntry(
  sessionId: string,
  userId: string | null,
  entry: MemoryEntry,
  featureTags: string[] = []
): Promise<void> {
  const current = await loadWorkingMemory(sessionId, userId)
  const next = await maintainMemory(
    {
      ...current,
      userId,
      updatedAt: Date.now(),
      entries: [entry, ...current.entries],
    },
    featureTags
  )

  await saveWorkingMemory(next)
}

export function getCurrentTags(memory: WorkingMemory): string[] {
  const recentEntries = [...memory.entries]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12)

  const weights = new Map<string, number>()
  recentEntries.forEach((entry, index) => {
    const weight = Math.max(12 - index, 1)
    entry.tags.forEach((tag) => {
      weights.set(tag, (weights.get(tag) ?? 0) + weight)
    })
  })

  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag)
}

export function buildWorkingMemoryPrompt(
  memory: WorkingMemory,
  featureTags: string[] = []
): WorkingMemoryPrompt {
  if (memory.entries.length === 0) {
    return { systemBlock: '', contextBlock: '', tokenCount: 0 }
  }

  const now = Date.now()
  let selected = [...memory.entries]
    .sort((a, b) => scoreEntry(b, featureTags, now) - scoreEntry(a, featureTags, now))
    .reduce<MemoryEntry[]>((acc, entry) => {
      const candidate = [...acc, entry]
      const preview = candidate
        .sort((left, right) => left.timestamp - right.timestamp)
        .map((item) => `- [${item.type}] ${truncate(item.content, item.compressed ? 180 : 220)}`)
        .join('\n')
      const tokenEstimate = estimateTokens(preview)

      if (tokenEstimate <= TOKEN_TARGET + TOKEN_BUFFER) {
        acc.push(entry)
      }

      return acc
    }, [])
    .sort((a, b) => a.timestamp - b.timestamp)

  if (selected.length === 0) {
    return { systemBlock: '', contextBlock: '', tokenCount: 0 }
  }

  const currentTags = uniqueItems([...featureTags, ...getCurrentTags(memory)]).slice(0, 8)
  let systemBlock = [
    '## Working Memory Instructions',
    'Use this memory only when it directly improves the answer.',
    'Prefer recent, high-importance details and do not repeat stale context unless it still matters.',
    currentTags.length > 0 ? `Current tags: ${currentTags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  let contextBlock = [
    '## Working Memory Context',
    ...selected.map((entry) => {
      const tagLine = entry.tags.length > 0 ? ` (${entry.tags.join(', ')})` : ''
      return `- [${entry.type}]${tagLine} ${truncate(entry.content, entry.compressed ? 180 : 220)}`
    }),
  ].join('\n')
  let tokenCount = estimateTokens(`${systemBlock}\n${contextBlock}`)

  while (tokenCount > TOKEN_TARGET + TOKEN_BUFFER && selected.length > 1) {
    selected = selected.slice(1)
    contextBlock = [
      '## Working Memory Context',
      ...selected.map((entry) => {
        const tagLine = entry.tags.length > 0 ? ` (${entry.tags.join(', ')})` : ''
        return `- [${entry.type}]${tagLine} ${truncate(entry.content, entry.compressed ? 180 : 220)}`
      }),
    ].join('\n')
    tokenCount = estimateTokens(`${systemBlock}\n${contextBlock}`)
  }

  return {
    systemBlock,
    contextBlock,
    tokenCount,
  }
}

export async function prepareWorkingMemory(args: {
  sessionId: string
  userId: string | null
  message: string
  featureTags?: string[]
}): Promise<{
  mem: WorkingMemory
  prompt: WorkingMemoryPrompt
  currentTags: string[]
}> {
  const mem = await loadWorkingMemory(args.sessionId, args.userId)
  const featureTags = uniqueItems([
    ...(args.featureTags ?? []).map((tag) => tag.toLowerCase()),
    ...inferTags(args.message),
    ...getCurrentTags(mem),
  ])
  const prompt = buildWorkingMemoryPrompt(mem, featureTags)

  appendEntry(
    args.sessionId,
    args.userId,
    makeEntry('user-message', args.message, featureTags, DEFAULT_CONFIDENCE),
    featureTags
  ).catch(() => {})

  return {
    mem,
    prompt,
    currentTags: featureTags,
  }
}

export async function recordAIResponse(
  sessionId: string,
  userId: string | null,
  content: string,
  confidence = DEFAULT_CONFIDENCE
): Promise<void> {
  const tags = inferTags(content)
  await appendEntry(sessionId, userId, makeEntry('ai-response', content, tags, confidence), tags)
}

export async function recordToolCall(
  sessionId: string,
  userId: string | null,
  toolName: string,
  content: string
): Promise<void> {
  const tags = inferTags(`${toolName} ${content}`, [toolName.toLowerCase()])
  await appendEntry(
    sessionId,
    userId,
    makeEntry('tool-call', `${toolName}: ${content}`, tags, DEFAULT_CONFIDENCE),
    tags
  )
}

export async function recordDecision(
  sessionId: string,
  userId: string | null,
  content: string,
  confidence = 0.8
): Promise<void> {
  const tags = inferTags(content)
  await appendEntry(sessionId, userId, makeEntry('decision', content, tags, confidence), tags)
}
