import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCareerCard } from '@/lib/dashboard-intel/careerCardService'
import { getShareCardData } from '@/lib/core-app/shareCard'
import { ShareCard, SHARE_CARD_SIZE } from '@/components/career/ShareCard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Shareable Manager Career Card (1200×630 PNG) — the viewer's aggregated
 * Legacy identity. Auth-gated, SELF only; shared as an image, never a URL.
 *
 * ⚠ TWO CARDS BEHIND ONE ROUTE, AND THE DEFAULT IS UNCHANGED. `?design=13b`
 * returns handoff 13b's 620×780 card; anything else returns the original
 * 1200×630 image. Folded in here rather than given its own route because this
 * repo sits against Vercel's 2048-route ceiling, and because the default output
 * is referenced as an OG image — changing its dimensions or content in place
 * would silently rewrite every link preview already in the wild.
 *
 * ⚠ THE TWO CARDS READ DIFFERENT SERVICES ON PURPOSE. The original is built on
 * `getCareerCard`, which is Sleeper-only and scores trades and drafts. 13b's
 * build rule 2 requires every number to trace to a value shown on 13a, so it
 * reads `getCareerData` — the same source the career page renders. They are not
 * interchangeable and must not be merged into one payload.
 */

function gradeLine(grades: Record<string, number>): string {
  return (['A', 'B', 'C', 'D', 'F'] as const)
    .filter((g) => grades[g] > 0)
    .map((g) => `${grades[g]}×${g}`)
    .join('  ')
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (new URL(req.url).searchParams.get('design') === '13b') {
    const share = await getShareCardData(userId)
    if (!share) {
      return NextResponse.json(
        { error: 'No completed seasons yet — import past seasons to build a career card.' },
        { status: 404 },
      )
    }
    /*
     * ⚠ NO CUSTOM FONT IS LOADED, AND THE DESIGN ASKS FOR TWO. 13b specifies
     * Archivo and JetBrains Mono. This repo ships no font binaries and forbids
     * next/font/google, so embedding either would mean fetching from a CDN on
     * every export — a network dependency on a request path, to change a
     * typeface. Both sibling share routes already render in the default sans for
     * the same reason. The in-app preview at /core/career?view=share does use
     * the real faces; this image does not, and that is the one place the export
     * and the preview differ.
     */
    return new ImageResponse(<ShareCard data={share} />, {
      width: SHARE_CARD_SIZE.width,
      height: SHARE_CARD_SIZE.height,
    })
  }

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
