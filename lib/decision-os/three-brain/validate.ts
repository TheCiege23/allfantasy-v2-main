/**
 * Server-side validation of raw model output. This is the trust boundary: a model may only DRAFT prose +
 * cite evidence ids; the server rejects malformed output, drops claims that cite unknown evidence ids or
 * cite no evidence (unsupported), strips any URLs the model produced, and never lets a model set an
 * authoritative field. Nothing here trusts `raw.text` beyond parsing it.
 */
import type { ProviderChatResult } from '@/lib/ai-orchestration/types'
import { SpecialistDraftSchema, SynthesisDraftSchema } from './schemas'
import type { SpecialistEvaluation, SpecialistFinding, SpecialistProvider } from './types'

// http(s):// , www. , and bare domains with common TLDs (+ optional path). Conservative to avoid eating
// ordinary text like "3.5" or "vs.".
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|app|co|tv|ai|xyz|dev)(?:\/\S*)?/gi

/** Strip URLs + collapse whitespace from model-produced text. Models must never produce clickable links. */
export function sanitizeModelText(input: string): string {
  return input.replace(URL_RE, '[link removed]').replace(/\s+/g, ' ').trim()
}

export function parseModelJson(raw: ProviderChatResult): unknown {
  if (raw.json != null && typeof raw.json === 'object') return raw.json
  try {
    return JSON.parse(raw.text)
  } catch {
    return null
  }
}

export type SpecialistValidation = {
  evaluation: SpecialistEvaluation
  droppedUnknownEvidence: number
  droppedUnsupported: number
}

/** Validate + ground a specialist's raw output against the packet's evidence ids. */
export function validateSpecialistOutput(
  provider: SpecialistProvider,
  raw: ProviderChatResult,
  validIds: ReadonlySet<string>,
): SpecialistValidation {
  const failed = (note: string): SpecialistValidation => ({
    evaluation: { provider, status: 'failed', findings: [], caveats: [note] },
    droppedUnknownEvidence: 0,
    droppedUnsupported: 0,
  })
  if (raw.status === 'timeout') return failed('Specialist timed out.')
  if (raw.status !== 'ok') return failed(`Specialist unavailable (${raw.status}).`)

  const parsed = SpecialistDraftSchema.safeParse(parseModelJson(raw))
  if (!parsed.success) return failed('Specialist output failed schema validation.')

  let droppedUnknownEvidence = 0
  let droppedUnsupported = 0
  const findings: SpecialistFinding[] = []
  for (const f of parsed.data.findings) {
    const known = f.evidenceIds.filter((id) => validIds.has(id))
    droppedUnknownEvidence += f.evidenceIds.length - known.length
    const claim = sanitizeModelText(f.claim)
    if (known.length === 0 || !claim) {
      droppedUnsupported += 1 // a claim that cites no valid evidence is unsupported — dropped
      continue
    }
    findings.push({ claim, evidenceIds: known, impact: f.impact })
  }
  const caveats = parsed.data.caveats.map(sanitizeModelText).filter(Boolean)
  const recommendation = parsed.data.recommendation ? sanitizeModelText(parsed.data.recommendation) : undefined
  const hadDrops = droppedUnsupported > 0 || droppedUnknownEvidence > 0
  // completed = clean; degraded = schema-valid but the server had to drop over-claimed content.
  const status: SpecialistEvaluation['status'] = hadDrops ? 'degraded' : 'completed'
  return { evaluation: { provider, status, findings, recommendation, caveats }, droppedUnknownEvidence, droppedUnsupported }
}

export type SynthesisDraftValidated = {
  shortAnswer: string
  whatDataSays: string
  whatItMeans: string
  recommendedAction?: string
  alternatives: string[]
  caveats: string[]
  evidenceIds: string[]
}

export type SynthesisValidation =
  | { ok: true; draft: SynthesisDraftValidated; droppedUnknownEvidence: number }
  | { ok: false; note: string }

/** Validate + ground OpenAI's synthesis draft (URLs stripped, unknown evidence ids dropped). */
export function validateSynthesisOutput(raw: ProviderChatResult, validIds: ReadonlySet<string>): SynthesisValidation {
  if (raw.status === 'timeout') return { ok: false, note: 'Synthesis timed out.' }
  if (raw.status !== 'ok') return { ok: false, note: `Synthesis unavailable (${raw.status}).` }
  const parsed = SynthesisDraftSchema.safeParse(parseModelJson(raw))
  if (!parsed.success) return { ok: false, note: 'Synthesis output failed schema validation.' }
  const d = parsed.data
  const known = d.evidenceIds.filter((id) => validIds.has(id))
  return {
    ok: true,
    droppedUnknownEvidence: d.evidenceIds.length - known.length,
    draft: {
      shortAnswer: sanitizeModelText(d.shortAnswer),
      whatDataSays: sanitizeModelText(d.whatDataSays),
      whatItMeans: sanitizeModelText(d.whatItMeans),
      recommendedAction: d.recommendedAction ? sanitizeModelText(d.recommendedAction) : undefined,
      alternatives: d.alternatives.map(sanitizeModelText).filter(Boolean),
      caveats: d.caveats.map(sanitizeModelText).filter(Boolean),
      evidenceIds: known,
    },
  }
}
