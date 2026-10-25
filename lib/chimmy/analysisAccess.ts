import 'server-only'
import { issueAnalysisQuote, verifyAnalysisQuote } from './analysisQuote'
import { fingerprintChimmyRequest } from './requestFingerprint'
import { DEEP_ANALYSIS_SECTIONS, type DeepAnalysisPreview } from './deepAnalysisPreview'
import type { ChimmyPlanAllowanceView } from './planAllowanceView'
import type { TokenSpendPreview } from '@/lib/tokens/TokenSpendService'

export function usesAnalysisPreview(form: FormData): boolean {
  return form.get('analysisPreviewVersion') === '1'
}
export function asksForFreeSummary(form: FormData, mode: string): boolean {
  return form.get('analysisPreviewVersion') === '1' && mode === 'fast_take' && form.get('analysisUnlock') !== 'true'
}

type GateResult =
  | { allowed: true; tokenPreview: TokenSpendPreview | null; expectedTokenCost?: number }
  | { allowed: false; status: 409 | 400; payload: Record<string, unknown> }
/** Only the whitelisted summary and placeholder descriptions leave this gate. No model has run. */
export async function gateAnalysisAccess(input: {
  userId: string; form: FormData; mode: string; summary: string
  plan: ChimmyPlanAllowanceView | null; previewSpend: () => Promise<TokenSpendPreview>
  forcePreview?: boolean; notice?: string; hasReceipt?: boolean
}): Promise<GateResult> {
  const remaining = input.plan ? Math.max(0, input.plan.limit - input.plan.used) : 0
  const access = remaining > 0 ? 'daily_answer' as const : 'tokens' as const
  if (access === 'daily_answer' && !asksForFreeSummary(input.form, input.mode) && !input.forcePreview) {
    return { allowed: true, tokenPreview: null }
  }
  const tokenPreview = access === 'tokens' ? await input.previewSpend() : null
  const tokenCost = tokenPreview?.tokenCost ?? 0
  const fingerprint = await fingerprintChimmyRequest(input.form)
  const expected = { userId: input.userId, requestId: String(input.form.get('requestId') ?? ''), fingerprint, tokenCost, access }
  const confirmed = input.form.get('confirmTokenSpend') === 'true'
  const quoted = verifyAnalysisQuote(String(input.form.get('tokenQuote') ?? ''), expected)
  if (confirmed && quoted && (tokenPreview?.canSpend ?? true) && !asksForFreeSummary(input.form, input.mode) && !input.forcePreview) {
    if (access === 'tokens' && !input.hasReceipt) return { allowed: false, status: 400, payload: { code: 'chimmy_request_identity_required', error: 'Reload Chimmy to unlock this analysis safely. No tokens were spent.' } }
    return { allowed: true, tokenPreview, expectedTokenCost: tokenCost }
  }
  const signed = issueAnalysisQuote(expected)
  const analysisPreview: DeepAnalysisPreview = {
    version: 1, summary: input.summary, sections: DEEP_ANALYSIS_SECTIONS.map(section => ({ ...section })),
    access, tokenCost, canUnlock: tokenPreview?.canSpend ?? true, ...signed,
    ...(tokenPreview ? { currentBalance: tokenPreview.currentBalance } : {}),
    ...(input.plan ? { dailyRemaining: remaining, dailyLimit: input.plan.limit, resetsAt: input.plan.resetsAt } : {}),
    ...(input.notice ? { notice: input.notice } : confirmed && !quoted ? { notice: 'This price needs a fresh confirmation. Review the unlock below.' } : {}),
  }
  return { allowed: false, status: 409, payload: {
    code: 'token_confirmation_required', response: input.summary, result: input.summary,
    source: 'chimmy_analysis_preview', analysisPreview, preview: tokenPreview,
    planAllowance: input.plan,
    meta: { free: true, mode: 'fast_take', analysisPreview, tokenSpend: null, planAllowance: input.plan },
  } }
}
