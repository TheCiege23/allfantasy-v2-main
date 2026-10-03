import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { formatValue, ProposalCardInput, sideTotal } from '@/lib/share/proposalCard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Share card (1200×630 PNG) for a trade analyzed in the Trade Center. See lib/share/proposalCard.ts
 * for what it carries and why it says "proposed". Generation is signed-in and league-member only, and
 * the card is shared as an image (Web Share / download), never served from a public URL.
 */

const CARDS_PER_MINUTE = 10

function Side({ title, letter, assets }: { title: string; letter: string | null; assets: ProposalCardInput['give'] }) {
  const total = sideTotal(assets)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#12163e', border: '1px solid #262c6a', borderRadius: 18, padding: '22px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 16, color: '#8b93cf', letterSpacing: 2 }}>GETS</div>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color: '#f0f2ff' }}>{title}</div>
        </div>
        {letter ? <div style={{ display: 'flex', fontSize: 64, fontWeight: 900, color: '#ff8a3d' }}>{letter}</div> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 14 }}>
        {assets.map((a, i) => (
          <div key={`${a.name}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, color: '#c6cbf5', marginTop: 6 }}>
            <span style={{ display: 'flex' }}>{a.name}</span>
            <span style={{ display: 'flex', color: '#8b93cf' }}>{a.value == null ? '—' : formatValue(a.value)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', marginTop: 'auto', paddingTop: 12, fontSize: 18, color: '#8b93cf' }}>
        {total == null ? 'Some assets unpriced' : `Total ${formatValue(total)}`}
      </div>
    </div>
  )
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = consumeRateLimit({ scope: 'share', action: 'proposal_card', sleeperUsername: userId, maxRequests: CARDS_PER_MINUTE, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many cards. Please wait a minute.' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, rl.retryAfterSec)) } })
  }

  const parsed = ProposalCardInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  const card = parsed.data

  const league = await prisma.league.findFirst({
    where: { id: card.leagueId, OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
    select: { name: true, sport: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0b0e2a', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', height: 8, width: '100%', background: 'linear-gradient(90deg,#22d3ee,#a855f7)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', padding: '28px 44px', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 40, fontWeight: 900, fontStyle: 'italic', color: '#f0f2ff' }}>TRADE CHECK</div>
              <div style={{ display: 'flex', fontSize: 18, color: '#8b93cf' }}>{league.name ?? 'Fantasy league'} · {league.sport?.toUpperCase() ?? 'FANTASY'}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              {card.score != null ? (
                <div style={{ display: 'flex', alignItems: 'flex-end', color: '#22d3ee' }}>
                  <span style={{ display: 'flex', fontSize: 56, fontWeight: 900 }}>{Math.round(card.score)}</span>
                  <span style={{ display: 'flex', fontSize: 22, marginBottom: 10, color: '#8b93cf' }}>/100</span>
                </div>
              ) : null}
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#f0f2ff' }}>{card.verdict}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 22, marginTop: 22, flex: 1 }}>
            <Side title={card.myLabel} letter={card.myLetter} assets={card.get} />
            <Side title={card.theirLabel} letter={card.theirLetter} assets={card.give} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 14, color: '#9ba8cf' }}>
              <span style={{ display: 'flex' }}>Proposed trade · {(card.basis ?? 'League value').slice(0, 65)} · {card.uncertainty ?? 'Value estimate'}</span>
              <span style={{ display: 'flex' }}>As of {card.asOf ? new Date(card.asOf).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC' : 'time unavailable'} · Projected value, not a result or acceptance prediction</span>
            </div>
            <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, color: '#c6cbf5' }}>AllFantasy.ai</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
