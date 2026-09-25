import { prisma } from '@/lib/prisma'
import { openaiChatJson } from '@/lib/openai-client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'

const COASTAL_ADJ = ['Pacific', 'Atlantic', 'Gulf', 'Northern', 'Southern', 'Eastern', 'Western', 'Central']
const NATURE_THEME = ['Storm', 'Thunder', 'Tide', 'Peak', 'Ridge', 'Canyon', 'River', 'Forest']

const ANIMALS = ['Wolves', 'Eagles', 'Falcons', 'Bears', 'Lions', 'Tigers', 'Sharks', 'Hawks']
const ANIMAL_ADJ = ['Iron', 'Swift', 'Dark', 'Crimson', 'Golden', 'Silver', 'Cobalt', 'Crimson']
const ELEMENTS = ['Thunder', 'Ice', 'Fire', 'Frost', 'Solar', 'Lunar', 'Stone', 'Steel']
const FORCES = ['Force', 'Storm', 'Ridge', 'Wave', 'Surge', 'Strike', 'Edge', 'Pulse']
const COLORS = ['Crimson', 'Midnight', 'Gold', 'Emerald', 'Azure', 'Scarlet', 'Obsidian', 'Ivory']
const CREATURES = ['Hawks', 'Vipers', 'Lions', 'Serpents', 'Panthers', 'Dragons', 'Wolves', 'Foxes']

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function pickUnused<T>(pool: T[], used: Set<string>, i: number): T {
  const start = i % pool.length
  for (let k = 0; k < pool.length; k++) {
    const v = pool[(start + k) % pool.length]!
    if (!used.has(String(v))) return v
  }
  return pool[start]!
}

export function getRoundLabel(roundType: string, participantCount: number): string {
  const n = participantCount
  switch (roundType) {
    case 'opening':
      return 'Opening Season'
    case 'qualifier':
      return n >= 128 ? `Round of ${Math.min(n, 256)}` : 'Qualifier Round'
    case 'elite':
      return n <= 16 ? 'Elite Eight' : 'Elite Round'
    case 'semifinal':
      return 'Championship Semis'
    case 'final':
      return 'Final Four'
    case 'championship':
      return 'The Championship'
    case 'bubble':
      return 'Bubble Week'
    default:
      return 'Tournament Round'
  }
}

export function generateConferenceName(
  _tournamentId: string,
  conferenceNumber: number,
  existingNames: string[],
): string {
  const usedAdj = new Set(existingNames.map((n) => n.split(/\s+/)[0] ?? '').filter(Boolean))
  const adj = pickUnused(COASTAL_ADJ, usedAdj, conferenceNumber)
  const theme = NATURE_THEME[(conferenceNumber * 3) % NATURE_THEME.length]!
  const name = `${adj} ${theme} Conference`
  if (existingNames.some((e) => e.toLowerCase() === name.toLowerCase())) {
    let i = 1
    let candidate = name
    while (existingNames.some((e) => e.toLowerCase() === candidate.toLowerCase())) {
      candidate = `${adj} ${theme} ${i} Conference`
      i++
    }
    return candidate
  }
  return name
}

export function generateLeagueNamesForConference(
  _conferenceId: string,
  count: number,
  existingNamesInTournament: string[],
  _theme?: string,
): string[] {
  const lower = new Set(existingNamesInTournament.map((x) => x.toLowerCase()))
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const pattern = i % 3
    let name = ''
    let tries = 0
    do {
      if (pattern === 0) {
        name = `${ANIMAL_ADJ[(i + tries) % ANIMAL_ADJ.length]} ${ANIMALS[(i + tries * 2) % ANIMALS.length]}`
      } else if (pattern === 1) {
        name = `${ELEMENTS[(i + tries) % ELEMENTS.length]} ${FORCES[(i + tries) % FORCES.length]}`
      } else {
        name = `${COLORS[(i + tries) % COLORS.length]} ${CREATURES[(i + tries) % CREATURES.length]}`
      }
      tries++
    } while (lower.has(name.toLowerCase()) && tries < 40)
    lower.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

export async function recordName(
  tournamentId: string,
  entityType: string,
  entityId: string,
  generatedName: string,
  finalName: string,
  namingMode: string,
  generationPrompt?: string | null,
): Promise<void> {
  await prisma.tournamentNameRecord.create({
    data: {
      tournamentId,
      entityType,
      entityId,
      generatedName,
      finalName,
      namingMode,
      generationPrompt: generationPrompt ?? undefined,
    },
  })
}

export async function generateLeagueNamesWithAi(args: {
  userId: string
  sport: string
  theme?: string
  roundLabel: string
  count: number
  avoid: string[]
}): Promise<string[] | null> {
  // The live plan, not the profile flag (lib/subscription/livePlanFlags.ts).
  const plans = await resolveLivePlanFlags(args.userId)
  if (!plans.commissioner) return null

  const sport = normalizeToSupportedSport(args.sport)
  const prompt = `Generate ${args.count} unique fantasy sports league names for ${sport} tournament. Conference theme: ${args.theme ?? 'general'}. Round: ${args.roundLabel}. Existing names to avoid: ${JSON.stringify(args.avoid)}. Names should feel premium, organized, and cohesive. Each name should be 2-3 words. Respond with JSON: {"names": string[] } only.`

  const res = await openaiChatJson({
    messages: [
      { role: 'system', content: 'You output only valid JSON objects.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.85,
    maxTokens: 800,
  })
  if (!res.ok) return null
  const completion = res.json as { choices?: Array<{ message?: { content?: string | null } }> }
  const text = completion?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string') return null
  try {
    const parsed = JSON.parse(text) as { names?: string[] }
    if (!Array.isArray(parsed.names)) return null
    return parsed.names.filter((n) => typeof n === 'string').slice(0, args.count)
  } catch {
    return null
  }
}

export { slugify }
