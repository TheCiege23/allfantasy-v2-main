import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserSessionFromCookie, validateRequestOrigin } from '@/lib/api-auth'

export const POST = withApiUsage({ endpoint: "/api/legacy/share-reward", tool: "LegacyShareReward" })(async (req: NextRequest) => {
  try {
    if (!validateRequestOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }

    const session = (await getUserSessionFromCookie())
    if (!session?.sleeperUsername) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const sleeperUsername = session.sleeperUsername

    const body = await req.json()
    const { leagueId, shareType, shareContent, platform } = body

    if (!shareType) {
      return NextResponse.json({ error: 'Missing shareType' }, { status: 400 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const existingToday = await prisma.shareReward.findFirst({
      where: {
        sleeperUsername,
        shareType,
        createdAt: { gte: today }
      }
    })

    if (existingToday) {
      return NextResponse.json({ 
        success: false, 
        message: 'You already earned a token for sharing today. Come back tomorrow!',
        alreadyClaimed: true
      })
    }

    const reward = await prisma.shareReward.create({
      data: {
        sleeperUsername,
        leagueId: leagueId || null,
        shareType,
        shareContent: shareContent || null,
        tokensAwarded: 1,
        platform: platform || null
      }
    })

    const totalTokens = await prisma.shareReward.count({
      where: { sleeperUsername, redeemed: false }
    })

    return NextResponse.json({ 
      success: true, 
      message: 'You earned 1 free AI token!',
      rewardId: reward.id,
      totalUnredeemedTokens: totalTokens
    })
  } catch (error) {
    console.error('Share reward error:', error)
    return NextResponse.json({ error: 'Failed to record share' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/share-reward", tool: "LegacyShareReward" })(async () => {
  try {
    const session = (await getUserSessionFromCookie())
    if (!session?.sleeperUsername) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const sleeperUsername = session.sleeperUsername

    const rewards = await prisma.shareReward.findMany({
      where: { sleeperUsername },
      orderBy: { createdAt: 'desc' },
      take: 20
    })

    const totalEarned = await prisma.shareReward.aggregate({
      where: { sleeperUsername },
      _sum: { tokensAwarded: true }
    })

    const unredeemedCount = await prisma.shareReward.count({
      where: { sleeperUsername, redeemed: false }
    })

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const canShareToday = !(await prisma.shareReward.findFirst({
      where: {
        sleeperUsername,
        createdAt: { gte: today }
      }
    }))

    return NextResponse.json({
      rewards,
      totalEarned: totalEarned._sum.tokensAwarded || 0,
      unredeemedTokens: unredeemedCount,
      canShareToday
    })
  } catch (error) {
    console.error('Get share rewards error:', error)
    return NextResponse.json({ error: 'Failed to get rewards' }, { status: 500 })
  }
})
