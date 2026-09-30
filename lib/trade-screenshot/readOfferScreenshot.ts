import 'server-only'

import { readImageWithVision } from '@/lib/chimmy/screenshotVision'
import { OFFER_READ_QUESTION, OFFER_READ_SYSTEM, parseOfferRead, type OfferRead } from './offerRead'

/**
 * Read a trade-offer screenshot into an `OfferRead`, through THE one vision call Chimmy's screenshot
 * reader uses (`readImageWithVision`) — same provider order, same spend switch.
 */

export const MAX_OFFER_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const OFFER_SCREENSHOT_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export type OfferScreenshotResult =
  | { status: 'read'; read: OfferRead }
  /** AI spend is switched off — say so, and point at entering the offer by hand. */
  | { status: 'disabled' }
  /** Every provider failed. Not the image's fault; try again. */
  | { status: 'unavailable' }

export async function readOfferScreenshot(file: File): Promise<OfferScreenshotResult> {
  const r = await readImageWithVision({ file, system: OFFER_READ_SYSTEM, question: OFFER_READ_QUESTION, maxTokens: 1500 })
  if (r.status !== 'ok') return { status: r.status }
  return { status: 'read', read: parseOfferRead(r.text) }
}
