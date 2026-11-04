import { buildRealGameResults } from '@/lib/chimmy/tools/realGameResults'

const GAME_RESULT = /\b(?:scores?|results?|who won|games? (?:on|in|from))\b/i
const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/
const NAMED_DAY = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Null means the question is not a dated game lookup. A miss never falls through to today's slate. */
export async function answerDatedGameQuestion(message: string, sport: string | null): Promise<string | null> {
  if (!GAME_RESULT.test(message) || /\b(?:compare|analy[sz]e)\b/i.test(message)) return null
  const named = NAMED_DAY.exec(message)
  const dateMatch = ISO_DAY.exec(message)
  const date = dateMatch?.[0] ?? (named
    ? named[3] + '-' + String(MONTHS.indexOf(named[1]!.toLowerCase()) + 1).padStart(2, '0') + '-' + named[2]!.padStart(2, '0')
    : null)
  if (!date) return null
  if (!sport) return 'Which sport should I use for ' + date + '?'
  const beforeDate = message.slice(0, dateMatch?.index ?? named?.index)
  const subject = /\b(?:for|of)\s+(.+?)\s+on\s*$/i.exec(beforeDate)?.[1] ??
    /\bwhat (?:was|were) (?:the )?(.+?)\s+(?:scores?|results?)\s+on\s*$/i.exec(beforeDate)?.[1]
  const words = subject?.trim().split(/\s+/) ?? []
  if (words[0]?.toUpperCase() === sport.toUpperCase()) words.shift()
  const team = words.join(' ') || undefined
  if (team && /\b(?:vs\.?|versus|against)\b/i.test(team)) return null
  const evidence = await buildRealGameResults({ sport, team, date }).catch(() => 'The stored results could not be read. Try again shortly.')
  const [heading, ...lines] = evidence.split('\n')
  if (!lines.length) return date + ' UTC. ' + heading
  return [
    sport + ' results for ' + date + ' UTC (up to 15 stored games)',
    ...lines.map((line) => {
      const row = JSON.parse(line)
      return '- ' + row.away + ' at ' + row.home + ' · ' + row.score + ' · ' + row.status +
        ' · ' + row.source + ' · observed ' + row.asOf
    }),
  ].join('\n')
}
