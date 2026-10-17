import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { verifyTradeCard, type TradeCardAsset, type TradeCardSide } from '@/lib/push-notifications/tradeCard'
import { headshotUrl } from '@/lib/media-url'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The picture on a trade notification (1200×600, the 2:1 Android shows large and iOS crops well).
 *
 * Fetched by the PHONE, with no session — see lib/push-notifications/tradeCard.ts for why the
 * card is drawn from its signed URL rather than looked up. No database read happens here, so
 * an invalid link costs one HMAC and a 403.
 */

const LETTER_COLOR: Record<string, string> = {
  A: '#4ade80',
  B: '#38bdf8',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
}

/**
 * Headshots are fetched here and inlined, never left as remote <img> URLs: a single missing
 * player photo makes the renderer throw, and that would cost the whole card. A photo that is not
 * there in 2.5 s becomes initials.
 */
async function inlineHeadshot(id: string | undefined): Promise<string | null> {
  if (!id) return null
  const url = headshotUrl(id)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 400_000) return null
    const type = imageTypeOf(buf)
    return type ? `data:${type};base64,${buf.toString('base64')}` : null
  } catch {
    return null
  }
}

/**
 * 🛑 READ THE BYTES, NOT THE HEADER. Measured rendering this card for real: a Sleeper headshot
 * came back as something the renderer refused ("Invalid JPEG") and the whole card failed with it.
 * The renderer decodes JPEG and PNG; anything else — WebP, an HTML error page served with 200 —
 * becomes initials instead of taking the card down.
 */
export function imageTypeOf(buf: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  return null
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '•'
}

/** What stands in for a photo: "$" for FAAB, "PK" for a pick, the player's initials otherwise. */
function badgeFor(asset: TradeCardAsset): string {
  if (asset.n.startsWith('$')) return '$'
  if (asset.d === 'Draft pick') return 'PK'
  return initials(asset.n)
}

function AssetRow({ asset, photo }: { asset: TradeCardAsset; photo: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" width={76} height={76} style={{ borderRadius: 76, objectFit: 'cover', background: '#1b2050' }} />
      ) : (
        <div
          style={{
            display: 'flex',
            width: 76,
            height: 76,
            borderRadius: 76,
            background: '#262c6a',
            color: '#d5daff',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
          }}
        >
          {badgeFor(asset)}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 18 }}>
        <div style={{ display: 'flex', fontSize: 34, color: '#f0f2ff' }}>{asset.n}</div>
        {asset.d ? <div style={{ display: 'flex', fontSize: 21, color: '#8b93cf' }}>{asset.d}</div> : null}
      </div>
    </div>
  )
}

function SideColumn({ side, photos }: { side: TradeCardSide; photos: (string | null)[] }) {
  const color = side.letter ? LETTER_COLOR[side.letter] : '#a1a1aa'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        background: side.you ? '#161b4d' : '#12163e',
        border: side.you ? '2px solid #4f5bd5' : '1px solid #262c6a',
        borderRadius: 22,
        padding: '22px 28px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 32, color: '#f0f2ff' }}>
            {side.you ? 'You get' : `${side.name} gets`}
          </div>
        </div>
        {side.letter ? (
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 900, color, lineHeight: 1 }}>{side.letter}</div>
        ) : null}
      </div>
      {side.gets.length === 0 ? (
        <div style={{ display: 'flex', fontSize: 24, color: '#8b93cf', marginTop: 18 }}>Nothing</div>
      ) : (
        side.gets.map((asset, i) => <AssetRow key={i} asset={asset} photo={photos[i] ?? null} />)
      )}
      {side.more ? (
        <div style={{ display: 'flex', fontSize: 20, color: '#8b93cf', marginTop: 12 }}>+{side.more} more</div>
      ) : null}
    </div>
  )
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const verified = verifyTradeCard(url.searchParams.get('d'), url.searchParams.get('s'))
  if (!verified.ok) {
    // A signature mismatch on a well-formed link means the two services disagree on
    // NEXTAUTH_SECRET — worth seeing in the logs, because the symptom is only "no picture".
    if (verified.reason !== 'bad_payload') console.warn('[push-card/trade] refused', { reason: verified.reason })
    return NextResponse.json({ error: 'invalid card' }, { status: 403 })
  }
  const { card } = verified
  const [photosA, photosB] = await Promise.all(
    card.sides.map((side) => Promise.all(side.gets.map((a) => inlineHeadshot(a.id)))),
  )
  const heading = card.kind === 'accepted' ? 'Trade accepted' : 'Trade offer'

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#0b0e2a',
          padding: '30px 40px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 900, color: '#f0f2ff' }}>{heading}</div>
          <div style={{ display: 'flex', fontSize: 22, color: '#8b93cf' }}>{card.league}</div>
        </div>
        <div style={{ display: 'flex', flex: 1, marginTop: 22 }}>
          <SideColumn side={card.sides[0]} photos={photosA} />
          <div style={{ display: 'flex', width: 24 }} />
          <SideColumn side={card.sides[1]} photos={photosB} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, fontSize: 18, color: '#5b63a8' }}>
          AllFantasy
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 600,
      // The image is fully determined by its signed URL, so it can be cached as long as anyone likes.
      headers: { 'Cache-Control': 'public, max-age=604800, immutable' },
    },
  )
}
