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
  const ordinal = (round: string) => round === '1' ? '1st' : round === '2' ? '2nd' : round === '3' ? '3rd' : '4th'
  // Vision readers may spell the same visible pick as “2027 Round 1”. Preserve year and round.
  /*
   * ⚠ A SUFFIX WRITTEN WITH A COMMA IS PART OF THE NAME, NOT A NEW ASSET. "Tyrone Tracy, Jr." split
   * on commas counts as two assets, so a correctly read five-asset offer expected six, the engine
   * resolved five, and the offer was refused as `screenshot_assets_unresolved`. The engine's own
   * name parser also drops a comma-separated suffix ("Tyrone Tracy"), so the comma is removed here,
   * before counting AND before the question is built. The engine then reads exactly what it reads
   * for "Tyrone Tracy Jr.". A suffix only counts when a separator or the end follows it, so a name
   * that merely starts with "V" or "II" after a comma is left alone.
   */
  const joinSuffixes = (side: string) =>
    side.replace(/,\s*(Jr|Sr|II|III|IV|V)(\.?)(?=\s*(?:[,;&]|and\b|$))/gi, ' $1$2')
  const normalizePicks = (side: string) => joinSuffixes(side)
    .replace(/\b((?:19|20)\d{2})\s+(?:round|rd)\s*([1-4])\b/gi, (_, year: string, round: string) => year + ' ' + ordinal(round) + '-round pick')
    .replace(/\b(?:round|rd)\s*([1-4])\s+(?:in\s+)?((?:19|20)\d{2})\b/gi, (_, round: string, year: string) => year + ' ' + ordinal(round) + '-round pick')
  const given = normalizePicks(give.value)
  const received = normalizePicks(get.value)
  const count = (side: string) => side.split(/\s+and\s+|\s*&\s*|,|;/i).filter(v => v.trim()).length
  return { question: `Should I trade ${given} for ${received}?`, clarification: null, assetCount: count(given) + count(received) }
}
