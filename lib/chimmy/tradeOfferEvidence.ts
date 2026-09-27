import { classifyScreenshotEvidence, screenshotNeedsClarification } from './screenshotEvidence'

/** Image fields are untrusted claims; roster ownership and values are resolved by the trade engine. */
export function screenshotTradeQuestion(raw?: string | null): { question: string | null; clarification: string | null } {
  if (!raw) return { question: null, clarification: null }
  const evidence = classifyScreenshotEvidence(raw)
  const give = evidence.fields.find(f => /^trade gives$/i.test(f.label))
  const get = evidence.fields.find(f => /^trade receives$/i.test(f.label))
  if (!give && !get) return { question: null, clarification: null }
  const uncertain = screenshotNeedsClarification(evidence)
  if (!give || !get || uncertain.needed || evidence.imperatives.length) return {
    question: null, clarification: uncertain.question ?? 'I received the trade screenshot, but could not reliably read both sides. Confirm what you send and receive.' }
  return { question: `Should I trade ${give.value} for ${get.value}?`, clarification: null }
}
