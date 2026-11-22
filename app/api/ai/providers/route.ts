/**
 * GET /api/ai/providers — List AI providers and availability. No secrets.
 * Used for provider selector UI. Fallback when no provider available is handled by run/compare.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkProviderAvailability, checkProviderHealth } from '@/lib/ai-orchestration'
import { isOpenClawConfigured, isOpenClawGrowthConfigured } from '@/lib/openclaw/config'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const includeHealth = req.nextUrl.searchParams?.get('includeHealth') === '1'
  const availability = checkProviderAvailability()
  const health = includeHealth ? await checkProviderHealth() : null
  const openclaw = isOpenClawConfigured()
  const openclawGrowth = isOpenClawGrowthConfigured()
  const providers = [
    { id: 'openai', name: 'OpenAI', available: availability.openai, role: 'Sport-aware user explanations, draft/waiver advice, roster suggestions, matchup summaries' },
    { id: 'deepseek', name: 'DeepSeek', available: availability.deepseek, role: 'Sport-aware statistical modeling, projections, and matchup scoring context' },
    { id: 'grok', name: 'Grok', available: availability.grok, role: 'Sport-aware trend detection, narrative context, and storyline framing' },
    { id: 'openclaw', name: 'OpenClaw Dev Assistant', available: openclaw, role: 'Workflow assistant routing for development and Chimmy operations support' },
    { id: 'openclaw-growth', name: 'OpenClaw Growth Assistant', available: openclawGrowth, role: 'Growth and engagement workflow assistant routing for campaign support' },
  ]
  return NextResponse.json({
    providers,
    availability: {
      ...availability,
      openclaw,
      openclawGrowth,
    },
    health,
    endpoints: {
      status: '/api/ai/providers/status',
      health: '/api/ai/providers/health',
    },
  })
}

