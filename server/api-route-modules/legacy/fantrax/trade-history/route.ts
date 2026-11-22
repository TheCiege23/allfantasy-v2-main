import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { withApiUsage } from '@/lib/telemetry/usage'
import { FANTRAX_TRADE_CSV_MAX_BYTES, importFantraxTradeHistory } from '@/lib/league-import/fantrax/importFantraxTradeHistory'

/**
 * POST /api/legacy/fantrax/trade-history — multipart `leagueId` + `file` (Fantrax "Transaction History → Trade"
 * CSV). Writes the export's completed trades into that imported Fantrax league's trade history.
 *
 * Commissioner only: the rows become the league's trade record for every member, so a member cannot add trades by
 * uploading a file. Nothing is called but Postgres; see `importFantraxTradeHistory`.
 */
export const POST = withApiUsage({ endpoint: '/api/legacy/fantrax/trade-history', tool: 'FantraxTradeHistory' })(async (request: NextRequest) => {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const leagueId = String(form?.get('leagueId') ?? '').trim()
  const file = form?.get('file')
  if (!leagueId) return NextResponse.json({ error: 'Choose a league.' }, { status: 400 })
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Choose the trade history CSV.' }, { status: 400 })
  if (file.size > FANTRAX_TRADE_CSV_MAX_BYTES) return NextResponse.json({ error: 'The file is too large for a trade history export.' }, { status: 400 })
  if (!(await canCommissionerAct(leagueId, userId, 'league'))) return NextResponse.json({ error: 'Only the commissioner can upload trade history.' }, { status: 403 })

  const result = await importFantraxTradeHistory({ leagueId, csvText: await file.text() })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
})
