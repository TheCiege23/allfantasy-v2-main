import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/adminAuth'
import { runAiProtection } from '@/lib/ai-protection'
import { assertLeagueMember } from '@/lib/league-access'
import { logAiOutput } from '@/lib/ai/output-logger'
import { getOpenClawConfig, getOpenClawPublicMeta, buildOpenClawTargetUrl } from '@/lib/openclaw/config'

const RequestSchema = z.object({
  message: z.string().min(1).max(6000),
  conversation: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(8000),
      })
    )
    .optional()
    .default([]),
  context: z.record(z.string(), z.unknown()).optional(),
  leagueId: z.string().optional(),
  upstreamPath: z.string().optional(),
})

function validateUpstreamPath(path: string | undefined): string {
  if (!path) return ''
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.includes('://')) {
    throw new Error('upstreamPath must be a relative path.')
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Operator tooling: it spends OUR OpenClaw token, so a signed-in account is not enough.
  const adminGate = await requireAdmin()
  if (!adminGate.ok) return adminGate.res

  try {
    const meta = getOpenClawPublicMeta()
    return NextResponse.json({ ok: true, provider: 'openclaw', ...meta })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Openclaw is not configured.' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Operator tooling: it spends OUR OpenClaw token, so a signed-in account is not enough.
  const adminGate = await requireAdmin()
  if (!adminGate.ok) return adminGate.res

  const protection = await runAiProtection(req, {
    action: 'chat',
    includeIpInKey: true,
    getUserId: async () => session.user?.id ?? null,
  })
  if (protection) return protection

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request format', details: parsed.error.issues },
      { status: 400 }
    )
  }

  const payload = parsed.data

  if (payload.leagueId) {
    try {
      await assertLeagueMember(payload.leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const { token, gatewayUrl } = getOpenClawConfig()
    const upstreamPath = validateUpstreamPath(payload.upstreamPath)
    const target = new URL(buildOpenClawTargetUrl(upstreamPath))
    target.searchParams.set('gatewayUrl', gatewayUrl)
    target.searchParams.set('token', token)

    const upstreamResponse = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-openclaw-gateway-url': gatewayUrl,
      },
      body: JSON.stringify({
        message: payload.message,
        conversation: payload.conversation,
        context: payload.context ?? {},
      }),
      cache: 'no-store',
    })

    const contentType = upstreamResponse.headers.get('content-type') || ''
    const isJson = contentType.toLowerCase().includes('application/json')
    const responseBody = isJson
      ? await upstreamResponse.json().catch(() => null)
      : await upstreamResponse.text().catch(() => '')

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        {
          error: 'Openclaw upstream request failed.',
          upstreamStatus: upstreamResponse.status,
          details:
            typeof responseBody === 'string'
              ? responseBody.slice(0, 500)
              : JSON.stringify(responseBody ?? {}).slice(0, 500),
        },
        { status: 502 }
      )
    }

    await logAiOutput({
      provider: 'openclaw',
      role: 'narrative',
      taskType: 'openclaw_dev_assistant',
      targetType: 'user',
      targetId: session.user.id,
      contentJson: typeof responseBody === 'string' ? null : responseBody,
      contentText: typeof responseBody === 'string' ? responseBody.slice(0, 8000) : undefined,
      meta: {
        leagueId: payload.leagueId ?? null,
      },
    })

    return NextResponse.json({ ok: true, data: responseBody })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Openclaw request failed.' },
      { status: 500 }
    )
  }
}
