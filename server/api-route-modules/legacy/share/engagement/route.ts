import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { share_type, platform, action, style } = body

    // A write attributing engagement to a username — previously any caller could file
    // engagement rows against anyone.
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body?.sleeper_username || '').trim() || null,
      rateLimit: { action: 'share_engagement', maxRequests: 60, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername

    if (!share_type || !platform || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await prisma.shareEngagement.create({
      data: {
        sleeperUsername: sleeper_username,
        shareType: share_type,
        platform,
        action,
        style: style || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Share engagement log error:', e)
    return NextResponse.json({ ok: true })
  }
}

export async function GET(req: NextRequest) {
  try {
    // Read side of the same surface — returned any user's engagement history by name.
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: req.nextUrl.searchParams?.get('sleeper_username')?.trim() ?? null,
      rateLimit: { action: 'share_engagement_read', maxRequests: 60, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

    const recent = await prisma.shareEngagement.findMany({
      where: { sleeperUsername: username },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        shareType: true,
        platform: true,
        style: true,
        createdAt: true,
      },
    })

    const styleCounts: Record<string, number> = {}
    const platformCounts: Record<string, number> = {}
    for (const r of recent) {
      if (r.style) styleCounts[r.style] = (styleCounts[r.style] || 0) + 1
      platformCounts[r.platform] = (platformCounts[r.platform] || 0) + 1
    }

    const preferredStyle = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const preferredPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null

    return NextResponse.json({
      ok: true,
      preferred_style: preferredStyle,
      preferred_platform: preferredPlatform,
      total_shares: recent.length,
    })
  } catch (e) {
    console.error('Share engagement fetch error:', e)
    return NextResponse.json({ ok: true, preferred_style: null, preferred_platform: null })
  }
}

