import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTradeGrades, type TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { hasNoSignal } from '@/lib/trade-intel/tradeGradeEmail'
import { realizedGradeDisplay } from '@/lib/trade-intel/gradeScale'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Shareable trade grade card (1200×630 PNG) — "who won this trade?"
 *
 * Auth-gated GENERATION: the viewer must have league access; the card is meant
 * to be shared as an IMAGE (Web Share / download), so no league data is ever
 * exposed on an unauthenticated URL. Every number on the card comes from the
 * same graded ledger the Legacy tab shows.
 */

const GRADE_COLOR: Record<string, string> = {
  A: '#3ddc97',
  B: '#3ddc97',
  C: '#7fb3ff',
  D: '#ffc53d',
  F: '#ff6b8b',
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '??'
}

function SideCol({ side, provisional }: { side: TradeSideGrade; provisional: boolean }) {
  const topIn = [
    ...side.playersIn.map((a) => ({
      name: a.name,
      pts: Object.values(a.creditedBySeason).reduce((x, y) => x + y, 0),
    })),
    ...side.picksIn
      .filter((p) => p.resolved)
      .map((p) => ({
        name: `${p.label} → ${p.resolved!.name}`,
        pts: Object.values(p.resolved!.creditedBySeason).reduce((x, y) => x + y, 0),
      })),
  ]
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 2)
  const trail = side.seasonNets
    .map((s) => `'${s.season.slice(2)} ${s.net > 0 ? '+' : ''}${s.net.toFixed(0)}`)
    .join(' > ')
  const avatarUrl = side.avatar ? `https://sleepercdn.com/avatars/${side.avatar}` : null
  const display = realizedGradeDisplay({
    scored: !provisional,
    currentGrade: side.currentGrade,
    initialGrade: side.initialGrade,
    trend: side.trend === 'improving' || side.trend === 'worsening' ? side.trend : 'steady',
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        background: '#12163e',
        border: '1px solid #262c6a',
        borderRadius: 18,
        padding: '26px 30px',
        alignItems: 'center',
      }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={64}
          height={64}
          style={{ borderRadius: 64, objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            width: 64,
            height: 64,
            borderRadius: 64,
            background: '#262c6a',
            color: '#d5daff',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          {initials(side.managerName)}
        </div>
      )}
      <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color: '#f0f2ff', marginTop: 10 }}>
        {side.managerName}
      </div>
      {side.teamName ? (
        <div style={{ display: 'flex', fontSize: 16, color: '#8b93cf' }}>{side.teamName}</div>
      ) : null}
      <div
        style={{
          display: 'flex',
          fontSize: 110,
          fontWeight: 900,
          fontStyle: 'italic',
          color: provisional ? '#5d64a3' : GRADE_COLOR[side.currentGrade] ?? '#7fb3ff',
          marginTop: 4,
          lineHeight: 1,
        }}
      >
        {display.mark}
      </div>
      <div style={{ display: 'flex', fontSize: 17, color: '#8b93cf', marginTop: 6 }}>{display.caption}</div>
      {provisional ? null : (
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            fontWeight: 700,
            color: side.cumulativeNet >= 0 ? '#3ddc97' : '#ff6b8b',
            marginTop: 4,
          }}
        >
          net {side.cumulativeNet > 0 ? '+' : ''}
          {side.cumulativeNet.toFixed(1)} pts
        </div>
      )}
      {trail && !provisional ? (
        <div style={{ display: 'flex', fontSize: 15, color: '#5d64a3', marginTop: 4 }}>{trail}</div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 14, alignItems: 'center' }}>
        {topIn.map((a) => (
          <div key={a.name} style={{ display: 'flex', fontSize: 16, color: '#c6cbf5' }}>
            {a.name} · {a.pts.toFixed(1)}
          </div>
        ))}
      </div>
    </div>
  )
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const tradeId = req.nextUrl.searchParams?.get('tradeId')?.trim()
  if (!leagueId || !tradeId) {
    return NextResponse.json({ error: 'Missing leagueId or tradeId' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, name: true, platform: true, platformLeagueId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ error: 'Sleeper leagues only (for now)' }, { status: 400 })
  }

  const grades = await getTradeGrades(league.platformLeagueId)
  const trade = grades?.trades.find((t) => t.id === tradeId)
  if (!trade) return NextResponse.json({ error: 'Trade not found in the graded ledger' }, { status: 404 })

  /*
   * 🛑 THE CARD MUST NOT ANSWER ITS OWN HEADLINE WHEN NOTHING HAS BEEN SCORED.
   *
   * Net 0 sits in the middle of the C band (`letterFor`: C is -40..40) and the engine reports a
   * tie, so a trade with no credited points renders a 110px "C" for every manager under the words
   * "WHO WON THIS TRADE?" — on an image built to be shared. That is the repo's known trap, and
   * `hasNoSignal` is the predicate written for it; the grade email has rendered a neutral chip and
   * a "too early to grade" subject for this case since it was found.
   *
   * ⚠ A SHARED IMAGE OUTLIVES ITS DATA. A screen can be reloaded once week 1 is played; a
   * screenshot in a league chat cannot, so asserting a verdict here is the most durable version of
   * the mistake.
   */
  const provisional = hasNoSignal(trade)

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#0b0e2a',
          padding: 0,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            height: 8,
            width: '100%',
            background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', padding: '30px 44px', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 42,
                fontWeight: 900,
                fontStyle: 'italic',
                color: '#f0f2ff',
                letterSpacing: 1,
              }}
            >
              WHO WON THIS TRADE?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#c6cbf5' }}>
                {league.name}
              </div>
              <div style={{ display: 'flex', fontSize: 17, color: '#8b93cf' }}>
                {trade.season} · week {trade.week}
                {/* "Dead even" is a result. With nothing credited there is no result yet. */}
                {provisional ? ' · not scored yet' : trade.tie ? ' · DEAD EVEN (so far)' : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 22, marginTop: 24, flex: 1 }}>
            {trade.sides.slice(0, 3).map((side) => (
              <SideCol key={side.rosterId} side={side} provisional={provisional} />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 18,
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', fontSize: 15, color: '#5d64a3' }}>
              Graded on real points while each asset was held · picks tracked to who they became
            </div>
            <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, color: '#c6cbf5' }}>
              AllFantasy.ai · a Brown Pig LLC product
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
