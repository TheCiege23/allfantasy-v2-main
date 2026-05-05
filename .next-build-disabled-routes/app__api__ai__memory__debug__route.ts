import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUnifiedMemoryRecords } from '@/lib/ai-memory/unified-memory-system'

const QuerySchema = z.object({
  leagueId: z.string().optional(),
  teamId: z.string().optional(),
  role: z.enum(['member', 'commissioner', 'admin']).optional(),
  includePlatform: z.enum(['true', 'false']).optional(),
  includeMetadata: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = QuerySchema.safeParse({
    leagueId: request.nextUrl.searchParams.get('leagueId') ?? undefined,
    teamId: request.nextUrl.searchParams.get('teamId') ?? undefined,
    role: request.nextUrl.searchParams.get('role') ?? undefined,
    includePlatform: request.nextUrl.searchParams.get('includePlatform') ?? undefined,
    includeMetadata: request.nextUrl.searchParams.get('includeMetadata') ?? undefined,
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters.', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const includeMetadata = parsed.data.includeMetadata === 'true'
  const limit = parsed.data.limit ?? 25

  const rows = await getUnifiedMemoryRecords({
    userId,
    role: parsed.data.role ?? 'member',
    leagueId: parsed.data.leagueId ?? null,
    teamId: parsed.data.teamId ?? null,
    includePlatform: parsed.data.includePlatform !== 'false',
  })

  const trimmed = rows.slice(0, limit).map((row) => ({
    scope: row.scope,
    category: row.category,
    content: row.content,
    confidence: row.confidence,
    source: row.source,
    sport: row.sport,
    teamId: row.teamId,
    updatedAt: row.updatedAt,
    ...(includeMetadata ? { metadata: row.metadata ?? {} } : {}),
  }))

  return NextResponse.json({
    ok: true,
    count: trimmed.length,
    records: trimmed,
  })
}
