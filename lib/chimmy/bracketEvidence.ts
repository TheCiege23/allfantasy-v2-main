/** Facts attached only after an owned bracket entry was verified and read. */
export type BracketEvidence = {
  entryName: string
  poolName: string
  sport: string
  format: 'tournament' | 'world_cup' | 'playoff'
  href: string
  entryUpdatedAt: string
  scoreUpdatedAt: string | null
  readAt: string
}

/** JSON quoting keeps entry names with quotes or line breaks unambiguous in prefilled questions. */
export function bracketPromptTarget(entryName: string, poolName: string): string {
  return `bracket entry ${JSON.stringify(entryName)} in pool ${JSON.stringify(poolName)}`
}

export function readBracketEvidence(value: unknown): BracketEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const string = (key: string) => typeof row[key] === 'string' ? (row[key] as string).trim() : ''
  const format = string('format')
  const href = string('href')
  const entryName = string('entryName')
  const poolName = string('poolName')
  const entryUpdatedAt = string('entryUpdatedAt')
  const readAt = string('readAt')
  if (!entryName || !poolName || !entryUpdatedAt || !readAt ||
    !['tournament', 'world_cup', 'playoff'].includes(format) ||
    !href.startsWith('/') || href.startsWith('//') || href.includes('\\') || /[\u0000-\u001f]/.test(href) ||
    !Number.isFinite(Date.parse(entryUpdatedAt)) ||
    !Number.isFinite(Date.parse(readAt))) return null
  const scoreUpdatedAt = string('scoreUpdatedAt')
  return {
    entryName: entryName.slice(0, 120), poolName: poolName.slice(0, 120), sport: string('sport').slice(0, 40),
    format: format as BracketEvidence['format'], href, entryUpdatedAt, readAt,
    scoreUpdatedAt: scoreUpdatedAt && Number.isFinite(Date.parse(scoreUpdatedAt)) ? scoreUpdatedAt : null,
  }
}

/** Entry and pool names make the next tool call resolvable even without chat history. */
export function bracketFollowUps(evidence: BracketEvidence): string[] {
  const target = bracketPromptTarget(evidence.entryName, evidence.poolName)
  return [
    `Which picks in my ${target} are still unresolved?`,
    `What do my scored picks mean for my ${target}?`,
    'How are my other brackets doing?',
  ].filter((question) => question.length <= 120)
}
