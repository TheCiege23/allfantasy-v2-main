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
  const count = (side: string) => side.split(/\s+and\s+|\s*&\s*|,|;/i).filter(v => v.trim()).length
  return { question: `Should I trade ${give.value} for ${get.value}?`, clarification: null, assetCount: count(give.value) + count(get.value) }
}
