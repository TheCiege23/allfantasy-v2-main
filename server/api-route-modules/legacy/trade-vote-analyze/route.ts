import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server'
import { priceAssets, ValuationContext } from '@/lib/hybrid-valuation'

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-vote-analyze", tool: "LegacyTradeVoteAnalyze" })(async (request: Request) => {
  try {
    const body = await request.json()
    const { side_a, side_b, is_superflex = true } = body

    if (!side_a?.length || !side_b?.length) {
      return NextResponse.json({ error: 'Both sides must have players' }, { status: 400 })
    }

    const ctx: ValuationContext = {
      asOfDate: new Date().toISOString().slice(0, 10),
      isSuperFlex: is_superflex
    }

    const [sideAResult, sideBResult] = await Promise.all([
      priceAssets({ players: side_a, picks: [] }, ctx),
      priceAssets({ players: side_b, picks: [] }, ctx)
    ])

    const sideAValue = sideAResult.total
    const sideBValue = sideBResult.total
    
    const totalValue = sideAValue + sideBValue
    const diff = Math.abs(sideAValue - sideBValue)
    const diffPct = totalValue > 0 ? (diff / totalValue) * 100 : 0
    
    let grade: string
    let verdict: string
    
    if (diffPct < 5) {
      grade = 'A'
      verdict = 'Very fair trade - both sides get good value'
    } else if (diffPct < 10) {
      grade = 'B+'
      verdict = sideAValue > sideBValue 
        ? `Side A slightly favored but close`
        : `Side B slightly favored but close`
    } else if (diffPct < 15) {
      grade = 'B'
      verdict = sideAValue > sideBValue 
        ? `Side A has the edge`
        : `Side B has the edge`
    } else if (diffPct < 25) {
      grade = 'C'
      verdict = sideAValue > sideBValue 
        ? `Side A wins this trade`
        : `Side B wins this trade`
    } else {
      grade = 'D'
      verdict = sideAValue > sideBValue 
        ? `Side A clearly wins - lopsided`
        : `Side B clearly wins - lopsided`
    }

    return NextResponse.json({
      success: true,
      grade,
      verdict,
      side_a_value: sideAValue,
      side_b_value: sideBValue,
      diff_pct: diffPct.toFixed(1),
    })
  } catch (error) {
    console.error('Trade vote analyze error:', error)
    return NextResponse.json({ error: 'Failed to analyze trade' }, { status: 500 })
  }
})
