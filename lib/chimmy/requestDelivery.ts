import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  claimRequestReceipt, fingerprintChimmyRequest, finishRequestReceipt, readRequestReceipt,
  reconcileRequestCharge, reconcileUnreportedTokenCharge, recoverExpiredReceipt, validChimmyRequestId,
  type ReceiptContext, type RequestReceipt,
} from './requestReceipts'

function unavailable() {
  return NextResponse.json({ error: 'Your request is being recovered. Retry with the same request to check its status.', code: 'chimmy_request_recovery_pending' },
    { status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '3' } })
}

export async function receiptResponse(receipt: RequestReceipt): Promise<NextResponse> {
  const current = await recoverExpiredReceipt(receipt)
  if (current.response && current.http_status) {
    return NextResponse.json(current.response, { status: current.http_status, headers: { 'Cache-Control': 'private, no-store' } })
  }
  return NextResponse.json({ code: 'chimmy_request_processing', message: 'Your answer is still processing.' },
    { status: 202, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '3' } })
}

export async function getChimmyRequestResponse(userId: string, requestId: string): Promise<NextResponse> {
  if (!validChimmyRequestId(requestId)) return NextResponse.json({ error: 'Invalid request ID' }, { status: 400 })
  try {
    const receipt = await readRequestReceipt(userId, requestId)
    return receipt ? await receiptResponse(receipt) : NextResponse.json({ error: 'Request unavailable' }, { status: 404 })
  } catch { return unavailable() }
}

export async function withChimmyRequestReceipt(req: NextRequest,
  execute: (context?: ReceiptContext, request?: NextRequest) => Promise<NextResponse>,
  protect?: (userId:string) => Promise<NextResponse | null>): Promise<NextResponse> {
  // Cached clients have no request identity. Let the legacy handler read their body once;
  // teeing a multipart stream can wait forever while the original is unread.
  const requestId = req.headers.get('x-chimmy-request-id')
  if (!requestId) return execute()
  if (!validChimmyRequestId(requestId)) {
    return NextResponse.json({ error: 'Invalid request ID' }, { status: 400 })
  }
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await protect?.(userId)
  if (limited) return limited
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Invalid multipart request' }, { status: 400 }) }
  if (form.get('requestId') !== requestId) return NextResponse.json({ error: 'Invalid request ID' }, { status: 400 })
  const headers = new Headers(req.headers)
  headers.delete('content-type')
  headers.delete('content-length')
  const parsedRequest = new NextRequest(req.url, { method:'POST', headers, body:form })
  let context: ReceiptContext | undefined
  try {
    const fingerprint = await fingerprintChimmyRequest(form)
    const claim = await claimRequestReceipt({ userId, requestId, fingerprint, confirmed: form.get('confirmTokenSpend') === 'true' })
    if (claim.kind === 'conflict') return NextResponse.json({ error: 'This request ID belongs to a different question.', code: 'chimmy_request_conflict' }, { status: 409 })
    if (claim.kind === 'existing') return await receiptResponse(claim.receipt)
    context = claim.context
    const response = await execute(context, parsedRequest)
    const payload = await response.clone().json()
    const awaitingConfirmation = payload.code === 'token_confirmation_required'
    const undelivered = response.status >= 400 || payload.meta?.delivery?.delivered === false || payload.meta?.refundPending === true
    if (undelivered) await reconcileRequestCharge(context)
    else if (!(payload.tokenSpend?.ledgerId ?? payload.meta?.tokenSpend?.ledgerId)) await reconcileUnreportedTokenCharge(context)
    await finishRequestReceipt(context, payload, response.status, awaitingConfirmation)
    return response
  } catch {
    if (context) {
      try {
        await reconcileRequestCharge(context)
        await finishRequestReceipt(context, { error: 'Your answer did not finish. Its charge was released. Please ask again.', code: 'chimmy_request_failed' }, 503)
      } catch { /* scheduled recovery retries */ }
    }
    return unavailable()
  }
}
