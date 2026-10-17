import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { consumeDailyLimit } from '@/lib/rate-limit-daily'
import { rateLimit } from '@/lib/rate-limit'
import {
  MAX_OFFER_SCREENSHOT_BYTES,
  OFFER_SCREENSHOT_TYPES,
  readOfferScreenshot,
} from '@/lib/trade-screenshot/readOfferScreenshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST a screenshot of a Sleeper trade offer; get back what it shows (`OfferRead`).
 *
 * Sleeper's feed never carries an offer before it is accepted and Sleeper sends no offer email, so a
 * screenshot is the only way an offer on the manager's phone reaches the Trade Center (Guap,
 * 2026-09-30). This route only READS the image. Placing the read onto the league's rosters happens in
 * the builder (`lib/trade-screenshot/matchOffer.ts`), and nothing is graded until the manager checks
 * the assets and presses Analyze.
 *
 * Bounded like every AI call that costs money per request: a league member only, 5 a minute, and a
 * durable daily cap per account (`apiRateLimitRecord`, so it holds across replicas).
 */

const DAILY_READS = 30
const PER_MINUTE = 5

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Send the screenshot as a file upload.' }, { status: 400 })
  }
  const entry = form.get('image')
  /*
   * Duck-typed, not `instanceof File`: the form parser's File class is not always the global one (it
   * differs under a jsdom test environment), and a string entry must still be refused.
   */
  const file =
    entry && typeof entry === 'object' && typeof (entry as Blob).arrayBuffer === 'function' ? (entry as File) : null
  if (!file || file.size <= 0) {
    return NextResponse.json({ error: 'Choose a screenshot to upload.' }, { status: 400 })
  }
  if (!OFFER_SCREENSHOT_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Use a JPEG, PNG, GIF or WebP screenshot.' }, { status: 400 })
  }
  if (file.size > MAX_OFFER_SCREENSHOT_BYTES) {
    return NextResponse.json({ error: 'That image is over 5 MB. Crop it to the offer and try again.' }, { status: 413 })
  }

  const who = createHash('sha256').update(userId).digest('hex').slice(0, 20)
  if (!rateLimit(`trade-screenshot:${who}`, PER_MINUTE, 60_000).success) {
    return NextResponse.json({ error: 'Too many screenshots at once — wait a minute and try again.' }, { status: 429 })
  }
  const daily = await consumeDailyLimit({ provider: 'trade_screenshot', endpoint: `read:${who}`, callsLimit: DAILY_READS }).catch(
    () => ({ success: true, retryAfterSec: 0 }),
  )
  if (!daily.success) {
    return NextResponse.json(
      { error: `You have read ${DAILY_READS} screenshots today. Enter this offer by hand, or try again tomorrow.` },
      { status: 429, headers: { 'Retry-After': String(daily.retryAfterSec) } },
    )
  }

  const result = await readOfferScreenshot(file)
  if (result.status === 'disabled') {
    return NextResponse.json({ error: 'Screenshot reading is switched off right now. Enter the offer by hand.' }, { status: 503 })
  }
  if (result.status === 'unavailable') {
    return NextResponse.json({ error: 'We could not reach the screenshot reader. Try again in a moment, or enter the offer by hand.' }, { status: 503 })
  }
  return NextResponse.json({ read: result.read })
}
