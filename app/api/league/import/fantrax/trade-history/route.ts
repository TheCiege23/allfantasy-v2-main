import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseFantraxLeagueId } from '@/lib/league-import/fantrax/fantraxApi'
import {
  attachFantraxTradeCsv,
  FANTRAX_TRADE_CSV_MAX_BYTES,
} from '@/lib/league-import/fantrax/attachFantraxTradeCsv'

/**
 * POST /api/league/import/fantrax/trade-history
 *
 * Adds a Fantrax trade-history CSV export to a league the caller already imported,
 * so draft-pick trades in rounds the Fantrax API does not publish (5 and later)
 * are on file. They are picked up the next time the league is imported or synced.
 *
 * Accepts either multipart form data (`leagueId`, `file`) or JSON
 * (`{ leagueId, csv }`). `leagueId` is the Fantrax league id or its league URL.
 * Makes no request to Fantrax.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let leagueInput = ''
  let csv = ''
  try {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      leagueInput = String(form.get('leagueId') ?? '')
      const file = form.get('file')
      if (file && typeof file !== 'string') {
        if (file.size > FANTRAX_TRADE_CSV_MAX_BYTES) {
          return NextResponse.json({ error: 'That file is too large to be a Fantrax trade history export.' }, { status: 413 })
        }
        csv = await file.text()
      }
    } else {
      const body = (await req.json()) as { leagueId?: unknown; csv?: unknown }
      leagueInput = typeof body.leagueId === 'string' ? body.leagueId : ''
      csv = typeof body.csv === 'string' ? body.csv : ''
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const sourceLeagueId = parseFantraxLeagueId(leagueInput)
  if (!sourceLeagueId) {
    return NextResponse.json({ error: 'A Fantrax league ID is required' }, { status: 400 })
  }
  if (!csv.trim()) {
    return NextResponse.json({ error: 'Choose your Fantrax trade history CSV to upload' }, { status: 400 })
  }

  try {
    const result = await attachFantraxTradeCsv({ appUserId: session.user.id, sourceLeagueId, csv })
    if (!result.ok) {
      const status = result.code === 'league_not_found' ? 404 : result.code === 'too_large' ? 413 : 400
      return NextResponse.json({ error: result.error, code: result.code }, { status })
    }
    return NextResponse.json({ provider: 'fantrax', leagueId: sourceLeagueId, ...result })
  } catch (e) {
    console.error('[fantrax/trade-history]', e instanceof Error ? e.message : 'failed')
    return NextResponse.json({ error: 'Could not save that trade history. Try again.' }, { status: 500 })
  }
}
