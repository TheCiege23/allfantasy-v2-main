/**
 * Extracts Chimmy orchestration-shaped sections from model prose (markdown headings).
 * Used to populate ChimmyResponseStructure when the model follows the public contract.
 */

type ParsedOrchestrationSections = {
  direct: string
  why?: string
  tool?: string
  confidence?: string
  followUp?: string
}

type SectionKey = 'preamble' | 'direct' | 'why' | 'tool' | 'confidence' | 'followup'

function normalizeSectionName(raw: string): SectionKey | null {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (s === 'direct') return 'direct'
  if (s === 'why') return 'why'
  if (s === 'tool') return 'tool'
  if (s === 'confidence') return 'confidence'
  if (s === 'follow-up' || s === 'follow up') return 'followup'
  return null
}

/**
 * Match a section header line or inline "**Direct** rest of line".
 * Returns the section key and optional same-line content after the header.
 */
function matchSectionHeader(line: string): { key: SectionKey; rest?: string } | null {
  const t = line.trim()

  const inline = t.match(
    /^(?:#{1,3}\s*)?\*\*(Direct|Why|Tool|Confidence|Follow(?:-|\s)up)\*\*\s+(.+)$/i
  )
  if (inline) {
    const key = normalizeSectionName(inline[1])
    if (!key || key === 'preamble') return null
    return { key, rest: inline[2].trim() }
  }

  const standalone = t.match(
    /^(?:#{1,3}\s*)?(?:\*\*)?(Direct|Why|Tool|Confidence|Follow(?:-|\s)up)(?:\*\*)?\s*:?\s*$/i
  )
  if (standalone) {
    const key = normalizeSectionName(standalone[1])
    if (!key || key === 'preamble') return null
    return { key }
  }

  return null
}

/**
 * When the assistant uses **Direct** (or ## Direct) and optional sibling sections,
 * returns structured fields. Otherwise returns null so callers can fall back to heuristics.
 */
export function parseOrchestrationResponseSections(text: string): ParsedOrchestrationSections | null {
  if (!text || !text.trim()) return null

  const lines = text.split(/\r?\n/)
  let current: SectionKey = 'preamble'
  const buffers: Record<SectionKey, string[]> = {
    preamble: [],
    direct: [],
    why: [],
    tool: [],
    confidence: [],
    followup: [],
  }

  for (const line of lines) {
    const header = matchSectionHeader(line)
    if (header) {
      current = header.key
      if (header.rest) {
        buffers[current].push(header.rest)
      }
      continue
    }
    buffers[current].push(line)
  }

  const direct = buffers.direct.join('\n').trim()
  if (!direct) {
    return null
  }

  const joinSection = (key: Exclude<SectionKey, 'preamble'>) => buffers[key].join('\n').trim() || undefined

  return {
    direct,
    why: joinSection('why'),
    tool: joinSection('tool'),
    confidence: joinSection('confidence'),
    followUp: joinSection('followup'),
  }
}
