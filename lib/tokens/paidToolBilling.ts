import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  assertReceiptTokenSpend, claimRequestReceipt, finishRequestReceipt, readRequestReceipt,
  reconcileRequestCharge, recordReceiptTokenIntent, recoverExpiredReceipt, receiptSpendKey,
  validChimmyRequestId, type ReceiptContext,
} from '@/lib/chimmy/requestReceipts'
import { issuePaidToolQuote, verifyPaidToolQuote } from './paidToolQuote'
import { TokenSpendService, TokenSpendPriceChangedError, TokenInsufficientBalanceError,
  type TokenSpendPreview, type TokenLedgerEntryView } from './TokenSpendService'

type Identity = { provided: boolean; body: Record<string, unknown>; clientId: string; requestId: string; fingerprint: string }
type BillingContext = {
  request: Request; identity?: Promise<Identity>; receipt?: ReceiptContext; intent?: boolean
  ledger?: TokenLedgerEntryView; undelivered?: boolean; override?: NextResponse
}
const storage = new AsyncLocalStorage<BillingContext>()
const OMIT = new Set(['confirmTokenSpend', 'confirmedTokenSpend', 'confirmed', 'tokenQuote', 'paidToolRequestId', 'paidToolVersion'])
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}
export function paidToolFingerprint(url: string, method: string, body: Record<string, unknown>): string {
  const parsed = new URL(url); parsed.searchParams.sort()
  const content = Object.fromEntries(Object.entries(body).filter(([k]) => !OMIT.has(k)))
  return 'paid-tool-v1:' + createHash('sha256').update(JSON.stringify([method, parsed.pathname + parsed.search, canonical(content)])).digest('hex')
}
async function identity(ctx: BillingContext): Promise<Identity> {
  ctx.identity ??= (async () => {
    const text = await ctx.request.clone().text()
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('Paid request is too large')
    let body: Record<string, unknown> = {}
    try { const parsed = JSON.parse(text || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed } catch { /* route validates JSON */ }
    const header = ctx.request.headers.get('x-paid-tool-request-id')
    const supplied = body.paidToolRequestId
    if (header && supplied && header !== supplied) throw new Error('Mismatched paid request ID')
    const clientId = String(header ?? randomUUID())
    if (!validChimmyRequestId(clientId)) throw new Error('Invalid paid request ID')
    const url = new URL(ctx.request.url)
    const requestId = createHash('sha256').update(JSON.stringify(['paid-tool-v1', ctx.request.method, url.pathname, clientId])).digest('hex')
    return { provided: Boolean(header || supplied), body, clientId, requestId, fingerprint: paidToolFingerprint(ctx.request.url, ctx.request.method, body) }
  })()
  return ctx.identity
}
function pending(clientId?: string) {
  return NextResponse.json({ code: 'paid_tool_processing', paidToolRequestId: clientId,
    message: 'This request is still processing or recovering. Retry the same request to check its result.' },
    { status: 202, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '3' } })
}
/** Called only after the route has authenticated and checked access to its resources. */
export async function replayPaidToolRequest(userId: string): Promise<NextResponse | null> {
  const ctx = storage.getStore()
  if (!ctx) return null
  if (!ctx.request.headers.get('x-paid-tool-request-id')) return null
  const id = await identity(ctx)
  if (!id.provided) return null
  const existing = await readRequestReceipt(userId, id.requestId)
  if (!existing) return null
  if (existing.fingerprint !== id.fingerprint) return NextResponse.json({ code: 'paid_tool_request_conflict', error: 'This request ID belongs to different input. Start a new request.' }, { status: 409 })
  const receipt = await recoverExpiredReceipt(existing)
  if (receipt.status === 'awaiting_confirmation') return null
  if (receipt.response && receipt.http_status) return NextResponse.json(receipt.response, { status: receipt.http_status, headers: { 'Cache-Control': 'private, no-store', 'x-paid-tool-terminal': '1' } })
  return pending(id.clientId)
}
export function paidToolNotDelivered(): void { const ctx = storage.getStore(); if (ctx) ctx.undelivered = true }

export type PaidToolChargeInput = {
  userId: string; userEmail?: string | null; ruleCode: string; preview: TokenSpendPreview
  confirmed: boolean; sourceType: string; sourceId?: string | null; description?: string | null
  metadata?: Record<string, unknown> | null
}
/** Quote, claim and fence once. World Cup may defer the debit until validated AI output exists. */
export async function preparePaidToolCharge(input: PaidToolChargeInput): Promise<
  { ok: false; response: NextResponse } | { ok: true; commit: () => Promise<TokenLedgerEntryView> }
> {
  const ctx = storage.getStore()
  if (!ctx) return { ok: false, response: NextResponse.json({ code: 'paid_tool_billing_unavailable', error: 'Please refresh this tool before spending tokens.' }, { status: 503 }) }
  const id = await identity(ctx)
  const quoteInput = { userId: input.userId, requestId: id.requestId, fingerprint: id.fingerprint, ruleCode: input.ruleCode, tokenCost: input.preview.tokenCost }
  const confirmation = (preview: TokenSpendPreview) => NextResponse.json({
    code: 'token_confirmation_required', error: 'Token spend confirmation required.',
    message: `Use ${preview.tokenCost} token${preview.tokenCost === 1 ? '' : 's'} for this request once.`,
    preview, paidToolRequestId: id.clientId,
    ...issuePaidToolQuote({ ...quoteInput, tokenCost: preview.tokenCost }),
  }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
  const explicit = id.body.confirmTokenSpend === true || id.body.confirmedTokenSpend === true || id.body.confirmed === true
  if (!input.confirmed || !explicit || !verifyPaidToolQuote(ctx.request.headers.get('x-paid-tool-quote') ?? id.body.tokenQuote, quoteInput)) return { ok: false, response: confirmation(input.preview) }
  const claim = await claimRequestReceipt({ userId: input.userId, requestId: id.requestId, fingerprint: id.fingerprint, confirmed: true })
  if (claim.kind === 'conflict') return { ok: false, response: NextResponse.json({ code: 'paid_tool_request_conflict', error: 'This request ID belongs to different input.' }, { status: 409 }) }
  if (claim.kind === 'existing') {
    const response = await replayPaidToolRequest(input.userId)
    return { ok: false, response: response ?? pending(id.clientId) }
  }
  ctx.receipt = claim.context
  return { ok: true, commit: async () => {
    if (ctx.ledger) return ctx.ledger
    try {
      if (!ctx.intent) { await recordReceiptTokenIntent(claim.context); ctx.intent = true }
      ctx.ledger = await new TokenSpendService().spendTokensForRule({
        ...input, confirmed: true, idempotencyKey: receiptSpendKey(claim.context.id),
        sourceId: claim.context.id, expectedTokenCost: input.preview.tokenCost,
        metadata: { ...input.metadata, originalSourceId: input.sourceId ?? null, paidToolRequestId: id.clientId },
        assertWithinTransaction: tx => assertReceiptTokenSpend(tx, claim.context),
      })
      return ctx.ledger
    } catch (error) {
      if (error instanceof TokenSpendPriceChangedError) {
        const preview = await new TokenSpendService().previewSpend(input.userId, input.ruleCode, input.userEmail)
        ctx.override = preview.canSpend ? confirmation(preview) : NextResponse.json({
          code: 'insufficient_token_balance', error: 'Insufficient token balance', preview,
        }, { status: 402 })
      } else if (error instanceof TokenInsufficientBalanceError) {
        ctx.override = NextResponse.json({ code: 'insufficient_token_balance', error: 'Insufficient token balance', requiredTokens: error.requiredTokens, currentBalance: error.currentBalance }, { status: 402 })
      }
      throw error
    }
  } }
}

/** One boundary covers errors before a route's try/catch, swallowed failures, lost responses and crashes. */
export function withPaidToolBilling<R extends Request, A extends unknown[]>(handler: (request: R, ...args: A) => Promise<Response>) {
  return async (request: R, ...args: A): Promise<Response> => {
    // Image uploads are a free action on the mixed World Cup chat route, never a paid JSON request.
    if (request.headers.get('content-type')?.includes('multipart/form-data')) return handler(request, ...args)
    const ctx: BillingContext = { request: request.clone() }
    return storage.run(ctx, async () => {
      try {
        let response: Response
        try { response = await handler(request, ...args) }
        catch (error) { if (!ctx.receipt) throw error; response = ctx.override ?? NextResponse.json({ error: 'This request did not finish. Its token charge is being released.', code: 'paid_tool_failed' }, { status: 503 }) }
        response = ctx.override ?? response
        if (!ctx.receipt) return response
        let payload = await response.clone().json()
        const failed = response.status >= 400 || payload?.ok === false || Boolean(payload?.error) || ctx.undelivered
        if (failed) {
          await reconcileRequestCharge(ctx.receipt)
          if (ctx.ledger && response.ok && payload && typeof payload === 'object') {
            payload = { ...payload, tokenSpend: null, tokenFallbackSpend: null,
              billing: { ...(payload.billing ?? {}), tokenCharged: false, status: 'refunded' } }
            response = NextResponse.json(payload, { status: response.status })
          }
        }
        await finishRequestReceipt(ctx.receipt, payload, response.status, payload?.code === 'token_confirmation_required')
        response.headers.set('Cache-Control', 'private, no-store')
        response.headers.set('x-paid-tool-terminal', '1')
        return response
      } catch (error) {
        if (ctx.receipt) {
          try {
            await reconcileRequestCharge(ctx.receipt)
            await finishRequestReceipt(ctx.receipt, { code: 'paid_tool_failed', error: 'This request did not finish. Its token charge was released. Start a new request.' }, 503)
          } catch { /* Existing scheduled receipt recovery retries durable refunds. */ }
        }
        console.warn('[paid-tool] request pending', { receiptId: ctx.receipt?.id, error: error instanceof Error ? error.name : 'Unknown' })
        return NextResponse.json({ code: 'paid_tool_recovery_pending', paidToolRequestId: (await ctx.identity?.catch(() => null))?.clientId,
          error: 'This request could not finish. Retry the same request to check its result; any undelivered charge will be released.' },
          { status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '3' } })
      }
    })
  }
}
