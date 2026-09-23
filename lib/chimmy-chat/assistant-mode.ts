export const CHIMMY_ASSISTANT_MODE_VALUES = [
  'fast_take',
  'deep_analysis',
  'commissioner_view',
  'dynasty_lens',
  'dfs_upside',
] as const

export type ChimmyAssistantMode = (typeof CHIMMY_ASSISTANT_MODE_VALUES)[number]

/*
 * The full answer unless a caller asks for Fast Take (user decision 2026-09-23). `fast_take` trims a
 * reply to its first paragraph (≤280 chars), and as the default it applied to every caller that sent
 * no mode — and to any mode string this function did not recognise.
 */
export const DEFAULT_CHIMMY_ASSISTANT_MODE: ChimmyAssistantMode = 'deep_analysis'

export const CHIMMY_ASSISTANT_MODE_LABELS: Record<ChimmyAssistantMode, string> = {
  fast_take: 'Fast Take',
  deep_analysis: 'Deep Analysis',
  commissioner_view: 'Commissioner View',
  dynasty_lens: 'Dynasty Lens',
  dfs_upside: 'DFS/Upside',
}

export function normalizeChimmyAssistantMode(value: unknown): ChimmyAssistantMode {
  if (typeof value !== 'string') return DEFAULT_CHIMMY_ASSISTANT_MODE
  const raw = value.trim().toLowerCase()
  if (!raw) return DEFAULT_CHIMMY_ASSISTANT_MODE

  if (CHIMMY_ASSISTANT_MODE_VALUES.includes(raw as ChimmyAssistantMode)) {
    return raw as ChimmyAssistantMode
  }

  if (raw.includes('fast')) return 'fast_take'
  if (raw.includes('deep')) return 'deep_analysis'
  if (raw.includes('commish') || raw.includes('commissioner')) return 'commissioner_view'
  if (raw.includes('dynasty')) return 'dynasty_lens'
  if (raw.includes('dfs') || raw.includes('upside')) return 'dfs_upside'

  return DEFAULT_CHIMMY_ASSISTANT_MODE
}

export function buildChimmyResponseForAssistantMode(args: {
  mode: ChimmyAssistantMode
  fullResponse: string
  shortAnswer?: string | null
}): string {
  const full = (args.fullResponse || '').trim()
  if (!full) return full

  if (args.mode !== 'fast_take') {
    return full
  }

  const short = (args.shortAnswer || '').trim()
  if (short.length > 0) {
    return short
  }

  // Fast Take: keep only the first thought chunk so this mode is always shorter.
  const firstParagraph = full.split(/\n\n+/)[0]?.trim() || ''
  if (firstParagraph.length > 0) {
    return firstParagraph.length <= 280 ? firstParagraph : `${firstParagraph.slice(0, 280).trimEnd()}...`
  }

  return full.length <= 280 ? full : `${full.slice(0, 280).trimEnd()}...`
}
