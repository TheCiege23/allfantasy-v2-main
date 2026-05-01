import { NextResponse } from 'next/server'
import { recomputeAllFantasyAdp } from '@/lib/adp/recomputeAllFantasyAdp'

function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const cronHeader = req.headers.get('x-cron-secret')
  if (cronHeader === secret) return true

  return false
}

async function handleRequest(req: Request): Promise<NextResponse> {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const sport = (url.searchParams.get('sport') ?? 'NFL').toUpperCase()
  const season = url.searchParams.get('season') ?? null
  const draftMode = 'real' as const
  const includeTest = url.searchParams.get('includeTest') === 'true'
  const apply = url.searchParams.get('dryRun') !== 'true'

  try {
    const report = await recomputeAllFantasyAdp({
      sport,
      season,
      draftMode,
      includeTest,
      apply,
    })

    const hasErrors = Array.isArray(report.errors) && report.errors.length > 0
    const status = hasErrors ? 207 : 200

    return NextResponse.json({ ok: !hasErrors, report }, { status })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleRequest(req)
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleRequest(req)
}
