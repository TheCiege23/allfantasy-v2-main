import { vi } from 'vitest'
import { issueAnalysisQuote } from '@/lib/chimmy/analysisQuote'
import { fingerprintChimmyRequest } from '@/lib/chimmy/requestFingerprint'
import { createMockNextRequest } from './createMockNextRequest'
let sequence = 0
/** Keep the real quote validator; replace only durable database persistence in route unit tests. */
export const receiptStorageFixture = {
  claimRequestReceipt: vi.fn(async ({ userId, requestId }: { userId: string; requestId: string }) => ({
    kind: 'execute', context: { id: `fixture-${requestId}`, userId, ownerToken: 'test-owner' },
  })),
  recordReceiptTokenIntent: vi.fn().mockResolvedValue(undefined),
  assertReceiptTokenSpend: vi.fn().mockResolvedValue(undefined),
  finishRequestReceipt: vi.fn().mockResolvedValue(undefined),
  reconcileRequestCharge: vi.fn().mockResolvedValue(undefined),
  reconcileUnreportedTokenCharge: vi.fn().mockResolvedValue(undefined),
}
export async function quotedChimmyRequest(form: FormData, userId: string, tokenCost = 15) {
  const headers: Record<string, string> = {}
  if (form.get('confirmTokenSpend') === 'true' && form.get('analysisPreviewVersion') !== '1' && !form.has('tokenQuote')) {
    const requestId = `fixture-request-${++sequence}`
    form.set('requestId', requestId)
    form.set('tokenQuote', issueAnalysisQuote({ userId, requestId, tokenCost,
      access: 'tokens', fingerprint: await fingerprintChimmyRequest(form) }).quote)
    headers['x-chimmy-request-id'] = requestId
  }
  return createMockNextRequest('http://localhost/api/chat/chimmy', { method: 'POST', body: form, headers })
}
