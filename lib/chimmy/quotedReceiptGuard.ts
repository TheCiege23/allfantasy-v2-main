import 'server-only'
import { NextResponse } from 'next/server'
import type { ReceiptContext } from './requestReceipts'

/** Cached older pages may keep their free answers; token unlocks need the deployed quote/receipt protocol. */
export function requireQuotedChimmyReceipt(receipt: ReceiptContext | undefined, tokenCost: number | undefined): NextResponse | null {
  if (tokenCost === 0) return null
  if (receipt && tokenCost !== undefined && Number.isSafeInteger(tokenCost) && tokenCost >= 0) return null
  return NextResponse.json({ code: 'chimmy_client_update_required',
    error: 'Refresh Chimmy before unlocking another answer. No tokens were spent.' }, { status: 409 })
}
