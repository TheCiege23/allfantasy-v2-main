/**
 * Pasted Yahoo league — build a snapshot one page at a time.
 *
 *   GET    ?league=<url|id>   { enabled, checklist? }  — is this open to me, and what is still missing
 *   POST   multipart: league, and text OR image        — read one page, fold it in, return the checklist
 *   DELETE ?league=<url|id>                            — throw the snapshot away and start over
 *
 * Importing is NOT done here. Once the checklist is ready, the client sends
 * `{ provider: 'yahoo', sourceId: 'yahoo-snapshot:<id>' }` to the ordinary preview and commit routes,
 * which read the snapshot back through the pipeline — see lib/league-import/yahoo/snapshot/.
 *
 * ⚠ NO YAHOO CALL HAPPENS ANYWHERE ON THIS PATH. The commissioner opens their own pages; we only read
 * what they hand us. That is the whole reason this works while Yahoo's API access is unapproved.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withApiUsage } from '@/lib/telemetry/usage'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { consumeRateLimit } from '@/lib/rate-limit'
import { isYahooSnapshotImportOpenFor } from '@/lib/yahoo/yahooAvailability'
import {
  extractYahooSnapshotPage,
  YAHOO_SNAPSHOT_IMAGE_TYPES,
  YAHOO_SNAPSHOT_MAX_IMAGE_BYTES,
  YAHOO_SNAPSHOT_MAX_TEXT_CHARS,
} from '@/lib/league-import/yahoo/snapshot/extractYahooSnapshotPage'
import {
  mergeYahooSnapshotPage,
  parseYahooLeagueId,
  yahooSnapshotChecklist,
  yahooSnapshotSourceId,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotModel'
import {
  deleteYahooSnapshot,
  loadOrStartYahooSnapshot,
  saveYahooSnapshot,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotStore'

const BAD_LEAGUE = 'Paste your Yahoo league link (it looks like football.fantasysports.yahoo.com/f1/123456) or the league ID.'

function closed(): NextResponse {
  return NextResponse.json({ enabled: false, error: 'Pasting a Yahoo league is not available on your account yet.' }, { status: 403 })
}

export const GET = withApiUsage({ endpoint: '/api/leagues/import/yahoo-snapshot', tool: 'YahooSnapshot' })(
  async (req: NextRequest) => {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response
    // 200 with enabled:false, not 403: the panel asks this on every load to decide whether to render.
    if (!isYahooSnapshotImportOpenFor(auth.userId)) return NextResponse.json({ enabled: false })

    const raw = req.nextUrl.searchParams.get('league')
    if (!raw) return NextResponse.json({ enabled: true })
    const leagueId = parseYahooLeagueId(raw)
    if (!leagueId) return NextResponse.json({ enabled: true, error: BAD_LEAGUE }, { status: 400 })

    const snapshot = await loadOrStartYahooSnapshot(auth.userId, leagueId)
    return NextResponse.json({
      enabled: true,
      sourceId: yahooSnapshotSourceId(leagueId),
      checklist: yahooSnapshotChecklist(snapshot),
    })
  },
)

export const POST = withApiUsage({ endpoint: '/api/leagues/import/yahoo-snapshot', tool: 'YahooSnapshot' })(
  async (req: NextRequest) => {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response
    if (!isYahooSnapshotImportOpenFor(auth.userId)) return closed()

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Send the page as a form upload.' }, { status: 400 })
    }

    const leagueId = parseYahooLeagueId(String(form.get('league') ?? ''))
    if (!leagueId) return NextResponse.json({ error: BAD_LEAGUE }, { status: 400 })

    const textValue = form.get('text')
    const imageValue = form.get('image')
    const text = typeof textValue === 'string' ? textValue.trim() : ''
    // Duck-typed, not `instanceof File`: a multipart File can come from a different realm's
    // constructor (undici vs the global), and `instanceof` then silently reads it as "no image".
    const image =
      imageValue && typeof imageValue === 'object' && typeof (imageValue as File).arrayBuffer === 'function' && (imageValue as File).size > 0
        ? (imageValue as File)
        : null

    if (!text && !image) {
      return NextResponse.json({ error: 'Paste the page text, or add a screenshot.' }, { status: 400 })
    }
    if (text && text.length > YAHOO_SNAPSHOT_MAX_TEXT_CHARS) {
      return NextResponse.json({ error: 'That paste is too long to be one league page. Copy a single page at a time.' }, { status: 413 })
    }
    if (image) {
      if (!(YAHOO_SNAPSHOT_IMAGE_TYPES as readonly string[]).includes(image.type)) {
        return NextResponse.json({ error: 'Screenshots must be PNG, JPEG or WebP.' }, { status: 415 })
      }
      if (image.size > YAHOO_SNAPSHOT_MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'That screenshot is over 5 MB. Try a smaller one.' }, { status: 413 })
      }
    }

    // Checked after validation so a malformed request does not spend the user's allowance.
    const limit = consumeRateLimit({
      scope: 'yahoo_snapshot',
      action: 'extract',
      sleeperUsername: auth.userId,
      maxRequests: 40,
      windowMs: 60 * 60 * 1000,
    })
    if (!limit.success) {
      return NextResponse.json(
        { error: `You've pasted a lot of pages in the last hour. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
      )
    }

    const result = await extractYahooSnapshotPage(text ? { text } : { image: image! })
    if (result.status === 'disabled' || result.status === 'unavailable') {
      return NextResponse.json({ error: 'Reading pages is unavailable right now. Try again in a few minutes.' }, { status: 503 })
    }
    if (result.status === 'invalid') {
      return NextResponse.json(
        { error: "We couldn't read that page cleanly. Copy the whole page (Ctrl+A, then Ctrl+C) and paste it again." },
        { status: 422 },
      )
    }
    if (result.status === 'unrecognized') {
      return NextResponse.json(
        { error: `That isn't one of the pages we need: ${result.reason}`, code: 'unrecognized' },
        { status: 422 },
      )
    }

    const snapshot = mergeYahooSnapshotPage(await loadOrStartYahooSnapshot(auth.userId, leagueId), result.page)
    await saveYahooSnapshot(auth.userId, snapshot)
    console.info('[YahooSnapshot] user=%s league=%s page=%s', auth.userId.slice(0, 8), leagueId, result.page.kind)

    return NextResponse.json({
      enabled: true,
      sourceId: yahooSnapshotSourceId(leagueId),
      page: result.page.kind,
      ...(result.page.kind === 'roster' ? { team: result.page.teamName } : {}),
      checklist: yahooSnapshotChecklist(snapshot),
    })
  },
)

export const DELETE = withApiUsage({ endpoint: '/api/leagues/import/yahoo-snapshot', tool: 'YahooSnapshot' })(
  async (req: NextRequest) => {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response
    if (!isYahooSnapshotImportOpenFor(auth.userId)) return closed()
    const leagueId = parseYahooLeagueId(req.nextUrl.searchParams.get('league'))
    if (!leagueId) return NextResponse.json({ error: BAD_LEAGUE }, { status: 400 })
    await deleteYahooSnapshot(auth.userId, leagueId)
    return NextResponse.json({ ok: true })
  },
)
