import { demoRateLimit, demoReadOnlyResponse, demoResponse, withDemoContext } from '@/lib/demo-league/http'

export const dynamic = 'force-dynamic'

/** GET /api/demo/league — the whole anonymized demo league. Public, read-only. */
export async function GET(req: Request) {
  const limited = demoRateLimit(req, 'read', 120, 60_000)
  if (limited) return limited
  return withDemoContext((ctx) => demoResponse(ctx, ctx.view))
}

export const POST = demoReadOnlyResponse
export const PUT = demoReadOnlyResponse
export const PATCH = demoReadOnlyResponse
export const DELETE = demoReadOnlyResponse
