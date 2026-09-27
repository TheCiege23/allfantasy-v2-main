import { classifyScreenshotEvidence, screenshotNeedsClarification } from './screenshotEvidence'

/** Image fields are untrusted claims; roster ownership and values are resolved by the trade engine. */
export function screenshotTradeQuestion(raw?: string | null): { question: string | null; clarification: string | null; assetCount?: number } {
  if (!raw) return { question: null, clarification: null }
  const evidence = classifyScreenshotEvidence(raw)
  const fields = classifyScreenshotEvidence(raw.replace(/^\s*[-*]\s+/gm, '').replace(/\*\*/g, '')).fields
  const gives = fields.filter(f => /^trade gives$/i.test(f.label))
  const receives = fields.filter(f => /^trade receives$/i.test(f.label))
  if (gives.length > 1 || receives.length > 1) return { question: null, clarification: 'I received the screenshot, but it contains multiple trade sides. Confirm which team is yours and what it sends and receives.' }
  const give = fields.find(f => /^trade gives$/i.test(f.label))
  const get = fields.find(f => /^trade receives$/i.test(f.label))
  if (!give && !get) return { question: null, clarification: null }
  const uncertain = screenshotNeedsClarification(evidence)
  if (!give || !get || uncertain.needed || evidence.imperatives.length) return {
    question: null, clarification: uncertain.question ?? 'I received the trade screenshot, but could not reliably read both sides. Confirm what you send and receive.' }
  const ordinal = (round: string) => ({ '1': '1st', '2': '2nd', '3': '3rd', '4': '4th' }[round] ?? round)
  // Vision readers may spell the same visible pick as “2027 Round 1”. Preserve year and round.
  const normalizePicks = (side: string) => side
    .replace(/\b((?:19|20)\d{2})\s+(?:round|rd)\s*([1-4])\b/gi, (_, year: string, round: string) => year + ' ' + ordinal(round) + '-round pick')
    .replace(/\b(?:round|rd)\s*([1-4])\s+(?:in\s+)?((?:19|20)\d{2})\b/gi, (_, round: string, year: string) => year + ' ' + ordinal(round) + '-round pick')
  const given = normalizePicks(give.value)
  const received = normalizePicks(get.value)
  const count = (side: string) => side.split(/\s+and\s+|\s*&\s*|,|;/i).filter(v => v.trim()).length
  return { question: `Should I trade ${given} for ${received}?`, clarification: null, assetCount: count(given) + count(received) }
}
