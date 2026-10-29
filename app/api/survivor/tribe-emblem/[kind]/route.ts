import { NextResponse } from 'next/server'
import { renderTribeEmblemRequest } from '@/lib/survivor/tribeEmblemRoute'

export const runtime = 'nodejs'

/**
 * GET /api/survivor/tribe-emblem/crest?tribe=<catalogId>&sport=<nfl|…>&p=<rrggbb>&s=<rrggbb>&name=<display name>
 * GET /api/survivor/tribe-emblem/mark?tribe=<catalogId>&kit=<football|…>&p=…&s=…
 *
 * Public catalogue art: no league data is read. Every input is in the URL and validated, so the
 * response is immutable for that URL.
 */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params
  const result = renderTribeEmblemRequest(kind, new URL(req.url).searchParams, req.headers.get('if-none-match'))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return new Response(result.status === 304 ? null : result.svg, { status: result.status, headers: result.headers })
}
