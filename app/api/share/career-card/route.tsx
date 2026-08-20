import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCareerCard } from '@/lib/dashboard-intel/careerCardService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Shareable Manager Career Card (1200×630 PNG) — the viewer's aggregated
 * Legacy identity. Auth-gated, SELF only; shared as an image, never a URL.
 */

function gradeLine(grades: Record<string, number>): string {
  return (['A', 'B', 'C', 'D', 'F'] as const)
    .filter((g) => grades[g] > 0)
    .map((g) => `${grades[g]}×${g}`)
    .join('  ')
}

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const card = await getCareerCard(userId)
  if (!card) {
    return NextResponse.json(
      { error: 'No career data yet — import a Sleeper league first.' },
      { status: 404 },
    )
  }
  const avatarUrl = card.avatar ? `https://sleepercdn.com/avatars/${card.avatar}` : null

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#0b0e2a',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', height: 8, width: '100%', background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', padding: '34px 48px', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" width={92} height={92} style={{ borderRadius: 92, objectFit: 'cover' }} />
            ) : (
              <div style={{ display: 'flex', width: 92, height: 92, borderRadius: 92, background: '#262c6a', color: '#d5daff', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 700 }}>
                {card.managerName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 900, fontStyle: 'italic', color: '#ff8a3d', letterSpacing: 2 }}>
                MANAGER CAREER CARD
              </div>
              <div style={{ display: 'flex', fontSize: 44, fontWeight: 900, fontStyle: 'italic', color: '#f0f2ff' }}>
                {card.managerName}
              </div>
              <div style={{ display: 'flex', fontSize: 17, color: '#8b93cf' }}>
                {card.leaguesIncluded} leagues · {card.allTime.seasons} seasons synced
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 18, marginTop: 34 }}>
            {[
              { l: 'ALL-TIME RECORD', v: `${card.allTime.wins}-${card.allTime.losses}${card.allTime.ties > 0 ? `-${card.allTime.ties}` : ''}` },
              { l: 'TITLES', v: `${card.allTime.titles}` },
              { l: 'POINTS FOR', v: card.allTime.pointsFor.toLocaleString() },
              { l: 'RECORDS HELD', v: `${card.recordsHeld.length}` },
            ].map((k) => (
              <div key={k.l} style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#12163e', border: '1px solid #262c6a', borderRadius: 16, padding: '18px 22px' }}>
                <div style={{ display: 'flex', fontSize: 40, fontWeight: 900, fontStyle: 'italic', color: '#f0f2ff' }}>{k.v}</div>
                <div style={{ display: 'flex', fontSize: 13, fontWeight: 700, color: '#5d64a3', letterSpacing: 1, marginTop: 6 }}>{k.l}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 18, marginTop: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#12163e', border: '1px solid #262c6a', borderRadius: 16, padding: '16px 22px' }}>
              <div style={{ display: 'flex', fontSize: 13, fontWeight: 700, color: '#5d64a3', letterSpacing: 1 }}>TRADE RÉSUMÉ · {card.trades.graded} graded</div>
              <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: '#c6cbf5', marginTop: 6 }}>
                {gradeLine(card.trades.grades) || '—'}
              </div>
              <div style={{ display: 'flex', fontSize: 15, color: card.trades.totalNet >= 0 ? '#3ddc97' : '#ff6b8b', marginTop: 4 }}>
                net {card.trades.totalNet > 0 ? '+' : ''}{card.trades.totalNet.toFixed(0)} pts while assets held
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#12163e', border: '1px solid #262c6a', borderRadius: 16, padding: '16px 22px' }}>
              <div style={{ display: 'flex', fontSize: 13, fontWeight: 700, color: '#5d64a3', letterSpacing: 1 }}>DRAFT RÉSUMÉ · {card.drafts.graded} graded</div>
              <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: '#c6cbf5', marginTop: 6 }}>
                {gradeLine(card.drafts.grades) || '—'}
              </div>
              <div style={{ display: 'flex', fontSize: 15, color: card.drafts.totalValueOver >= 0 ? '#3ddc97' : '#ff6b8b', marginTop: 4 }}>
                {card.drafts.totalValueOver > 0 ? '+' : ''}{card.drafts.totalValueOver} value over round medians
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
            <div style={{ display: 'flex', fontSize: 14, color: '#5d64a3' }}>
              Counted from synced league history, graded trades, and graded drafts
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
