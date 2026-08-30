import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server'
import { isEvidencedPrice, pricePlayer, ValuationContext } from '@/lib/hybrid-valuation'
import { FantasyCalcPlayer } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { findPlayerInCSV, getPlayerValue as getCSVPlayerValue, getPlayerECR, CSVPlayerValue } from '@/lib/player-values-csv'
import { getConsensusADP } from '@/lib/multi-platform-adp'

export const POST = withApiUsage({ endpoint: "/api/legacy/player-stock", tool: "LegacyPlayerStock" })(async (request: Request) => {
  try {
    const body = await request.json()
    const { player_name, is2QB = true } = body

    if (!player_name?.trim()) {
      return NextResponse.json({ error: 'Player name required' }, { status: 400 })
    }

    const normalized = player_name.toLowerCase().trim()
    
    const csvPlayer = findPlayerInCSV(normalized, is2QB)
    
    const ctx: ValuationContext = {
      asOfDate: new Date().toISOString().slice(0, 10),
      isSuperFlex: is2QB
    }
    
    const pricedPlayer = await pricePlayer(player_name, ctx)
    
    const dynastyValues = await getFantasyCalcValuesDbFirst({ 
      isDynasty: true, 
      numQbs: is2QB ? 2 : 1, 
      numTeams: 12, 
      ppr: 1 
    })
    const redraftValues = await getFantasyCalcValuesDbFirst({ 
      isDynasty: false, 
      numQbs: is2QB ? 2 : 1, 
      numTeams: 12, 
      ppr: 1 
    })
    
    const dynastyPlayer = dynastyValues.find((p: FantasyCalcPlayer) => 
      p.player.name.toLowerCase().includes(normalized) || 
      normalized.includes(p.player.name.toLowerCase())
    )
    
    const redraftPlayer = redraftValues.find((p: FantasyCalcPlayer) => 
      p.player.name.toLowerCase().includes(normalized) || 
      normalized.includes(p.player.name.toLowerCase())
    )
    
    const player = dynastyPlayer || redraftPlayer
    
    /*
     * ⚠ `isEvidencedPrice` RATHER THAN `source === 'unknown'`, TO HOLD THIS BEHAVIOUR STILL.
     * The IDP flat baseline and the analytics lifetime value used to report 'unknown' too, so
     * a defender with no league board 404'd here. After the source split the bare test would
     * have let him through and rendered the constant 800 as his dynasty value beside a rank
     * of 999 — a confident-looking stock page built on a positional placeholder.
     */
    if (!isEvidencedPrice(pricedPlayer) && !csvPlayer) {
      return NextResponse.json({ 
        success: false, 
        error: 'Player not found in database' 
      }, { status: 404 })
    }

    const dynastyValue = pricedPlayer.value || dynastyPlayer?.value || 0
    const redraftValue = redraftPlayer?.redraftValue || redraftPlayer?.value || 0
    
    const dynastyRank = dynastyPlayer?.overallRank || 999
    const redraftRank = redraftPlayer?.overallRank || 999
    
    const csvValue = csvPlayer ? getCSVPlayerValue(csvPlayer, is2QB) : 0
    const csvECR = csvPlayer ? getPlayerECR(csvPlayer, is2QB) : 999
    
    let signal: string
    let trend: string
    
    if (dynastyRank <= 50) {
      if (redraftRank <= 30) {
        signal = 'HOLD'
        trend = 'Elite production + long-term value'
      } else {
        signal = 'BUY'
        trend = 'Dynasty value exceeds current production - prime buy window'
      }
    } else if (dynastyRank <= 100) {
      if (redraftRank < dynastyRank - 30) {
        signal = 'SELL'
        trend = 'Outperforming dynasty value - sell high'
      } else if (redraftRank > dynastyRank + 30) {
        signal = 'BUY'
        trend = 'Underperforming but dynasty upside'
      } else {
        signal = 'HOLD'
        trend = 'Fair valued for current production'
      }
    } else if (dynastyRank <= 200) {
      if (redraftRank <= 75) {
        signal = 'SELL'
        trend = 'Production way above dynasty value - sell high'
      } else {
        signal = 'HOLD'
        trend = 'Depth piece with some upside'
      }
    } else {
      if (redraftRank <= 100) {
        signal = 'SELL'
        trend = 'Aging asset producing now - move before decline'
      } else {
        signal = 'STASH'
        trend = 'Speculative hold for breakout'
      }
    }

    const playerName = player?.player.name || csvPlayer?.player || ''
    const playerPosition = player?.player.position || csvPlayer?.pos || ''
    const playerTeam = player?.player.maybeTeam || csvPlayer?.team || 'FA'

    const multiPlatform = getConsensusADP(playerName || pricedPlayer.name, playerPosition, playerTeam)

    return NextResponse.json({
      success: true,
      player: {
        name: playerName || pricedPlayer.name,
        position: playerPosition,
        team: playerTeam,
        value: dynastyValue || csvValue || redraftValue,
        dynastyRank,
        redraftRank,
        signal,
        trend,
        rank: dynastyRank,
        valuationSource: pricedPlayer.source,
        csv: csvPlayer ? {
          value1qb: csvPlayer.value1qb,
          value2qb: csvPlayer.value2qb,
          ecr1qb: csvPlayer.ecr1qb,
          ecr2qb: csvPlayer.ecr2qb,
          ecrPos: csvPlayer.ecrPos,
          age: csvPlayer.age,
          draftYear: csvPlayer.draftYear,
          scrapeDate: csvPlayer.scrapeDate
        } : null,
        multiPlatformADP: multiPlatform ? {
          consensusADP: multiPlatform.consensusADP,
          platformCount: multiPlatform.platformCount,
          spread: multiPlatform.spread,
          tier: multiPlatform.tier,
          bestPlatformADP: multiPlatform.bestPlatformADP,
          worstPlatformADP: multiPlatform.worstPlatformADP,
          dynastyADP: multiPlatform.dynastyADP,
          dynasty2QBADP: multiPlatform.dynasty2QBADP,
          aav: multiPlatform.aav,
          healthStatus: multiPlatform.healthStatus,
          injury: multiPlatform.injury,
        } : null
      }
    })
  } catch (error) {
    console.error('Player stock error:', error)
    return NextResponse.json({ error: 'Failed to lookup player' }, { status: 500 })
  }
})
