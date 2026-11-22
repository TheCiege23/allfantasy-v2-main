import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type SavedProviderResult = {
  provider: string
  raw: string
  error?: string | null
  skipped?: boolean
}

type SavedOutputPayload = {
  evidence: string[]
  aiExplanation: string
  actionPlan?: string | null
  confidence?: number | null
  confidenceLabel?: 'low' | 'medium' | 'high' | null
  confidenceReason?: string | null
  uncertainty?: string | null
  providerResults?: SavedProviderResult[]
  usedDeterministicFallback?: boolean
}

type SavedHistoryRecord = {
  version: 1
  tool: string
  sport: string
  aiMode?: string | null
  provider?: string | null
  prompt?: string | null
  output: SavedOutputPayload
}

function toStringValue(value: unknown, max = 4_000): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function toStringArray(value: unknown, max = 25): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max)
}

function toProviderResults(value: unknown): SavedProviderResult[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const candidate = item as Record<string, unknown>
      const provider = toStringValue(candidate.provider, 64)
      if (!provider) return null
      return {
        provider,
        raw: toStringValue(candidate.raw, 8_000) ?? '',
        error: toStringValue(candidate.error, 512),
        skipped: candidate.skipped === true,
      } as SavedProviderResult
    })
    .filter((item): item is SavedProviderResult => item != null)
    .slice(0, 6)
}

function normalizeSavedOutput(value: unknown): SavedOutputPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const aiExplanation = toStringValue(candidate.aiExplanation, 12_000)
  if (!aiExplanation) return null
  const confidenceRaw = candidate.confidence
  const confidence =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
      : null
  return {
    evidence: toStringArray(candidate.evidence, 30),
    aiExplanation,
    actionPlan: toStringValue(candidate.actionPlan, 2_000),
    confidence,
    confidenceLabel:
      candidate.confidenceLabel === 'low' ||
      candidate.confidenceLabel === 'medium' ||
      candidate.confidenceLabel === 'high'
        ? candidate.confidenceLabel
        : null,
    confidenceReason: toStringValue(candidate.confidenceReason, 2_000),
    uncertainty: toStringValue(candidate.uncertainty, 2_000),
    providerResults: toProviderResults(candidate.providerResults),
    usedDeterministicFallback: candidate.usedDeterministicFallback === true,
  }
}

function normalizeSavedRecord(value: unknown): SavedHistoryRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const output = normalizeSavedOutput(candidate.output)
  const tool = toStringValue(candidate.tool, 96)
  const sport = toStringValue(candidate.sport, 32)
  if (!output || !tool || !sport) return null
  return {
    version: 1,
    tool,
    sport,
    aiMode: toStringValue(candidate.aiMode, 64),
    provider: toStringValue(candidate.provider, 32),
    prompt: toStringValue(candidate.prompt, 1_000),
    output,
  }
}

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 30
  return Math.max(1, Math.min(100, Math.round(parsed)))
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = normalizeLimit(new URL(req.url).searchParams?.get('limit'))
  const rows = await (prisma as any).aiOutput.findMany({
    where: {
      taskType: 'saved_ai_result',
      targetType: 'user_ai_result',
      targetId: session.user.id,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const items = rows.map((row: any) => {
    const saved = normalizeSavedRecord(row.contentJson)
    const fallbackOutput: SavedOutputPayload = {
      evidence: [],
      aiExplanation: toStringValue(row.contentText, 12_000) ?? 'Saved Chimmy result',
      actionPlan: null,
      confidence: row.confidence != null ? Math.round(Number(row.confidence) * 100) : null,
      confidenceLabel: null,
      confidenceReason: null,
      uncertainty: null,
      providerResults: [],
      usedDeterministicFallback: false,
    }

    return {
      id: row.id,
      createdAt: row.createdAt,
      tool: saved?.tool ?? 'unknown_tool',
      sport: saved?.sport ?? 'NFL',
      aiMode: saved?.aiMode ?? null,
      provider: saved?.provider ?? null,
      prompt: saved?.prompt ?? null,
      output: saved?.output ?? fallbackOutput,
      stale: saved == null,
    }
  })

  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: 'unauthorized', message: 'Unauthorized', userMessage: 'You need to sign in to save results.' },
      { status: 401 }
    )
  }

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json(
      {
        code: 'invalid_json',
        message: 'Invalid JSON body.',
        userMessage: 'Invalid save request payload.',
      },
      { status: 400 }
    )
  }

  const output = normalizeSavedOutput(body.output)
  const tool = toStringValue(body.tool, 96)
  const sport = toStringValue(body.sport, 32)
  if (!tool || !sport || !output) {
    return NextResponse.json(
      {
        code: 'invalid_payload',
        message: 'tool, sport, and output.aiExplanation are required.',
        userMessage: 'Could not save this Chimmy result because required fields are missing.',
      },
      { status: 400 }
    )
  }

  const payload: SavedHistoryRecord = {
    version: 1,
    tool,
    sport,
    aiMode: toStringValue(body.aiMode, 64),
    provider: toStringValue(body.provider, 32),
    prompt: toStringValue(body.prompt, 1_000),
    output,
  }
  const model = payload.provider ?? output.providerResults?.find((result) => !result.error)?.provider ?? null

  const created = await (prisma as any).aiOutput.create({
    data: {
      provider: model ?? 'system',
      role: 'narrative',
      taskType: 'saved_ai_result',
      targetType: 'user_ai_result',
      targetId: session.user.id,
      model,
      contentText: output.aiExplanation,
      contentJson: payload,
      confidence: typeof output.confidence === 'number' ? output.confidence / 100 : null,
      meta: {
        savedFrom: 'unified_ai_workbench',
      },
    },
  })

  return NextResponse.json({
    id: created.id,
    createdAt: created.createdAt,
  })
}

export async function DELETE(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: 'unauthorized', message: 'Unauthorized', userMessage: 'You need to sign in to remove saved results.' },
      { status: 401 }
    )
  }

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json(
      { code: 'invalid_json', message: 'Invalid JSON body.', userMessage: 'Invalid delete request.' },
      { status: 400 }
    )
  }

  const id = toStringValue(body.id, 128)
  if (!id) {
    return NextResponse.json(
      { code: 'invalid_payload', message: 'id is required.', userMessage: 'Missing saved item id.' },
      { status: 400 }
    )
  }

  const deleted = await (prisma as any).aiOutput.deleteMany({
    where: {
      id,
      taskType: 'saved_ai_result',
      targetType: 'user_ai_result',
      targetId: session.user.id,
    },
  })

  if (!deleted?.count) {
    return NextResponse.json(
      { code: 'not_found', message: 'Saved result not found.', userMessage: 'That saved result no longer exists.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true })
}


