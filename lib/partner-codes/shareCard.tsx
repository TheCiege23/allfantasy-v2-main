import { ImageResponse } from 'next/og'
import { parseGoogleFontCss } from '@/lib/survivor/shareCards/renderCard'
import { SHARE_FORMATS, SHARE_LOOKS, type ShareFormatKey, type ShareLookKey } from './shareLooks'

type Font = { name: string; data: ArrayBuffer; weight: 600 | 800 | 900; style: 'normal' }
let fontsPromise: Promise<Font[] | null> | null = null

/**
 * Inter, fetched once per process the same way lib/survivor/shareCards/renderCard.tsx does (the repo
 * ships no font files). On any failure the image still renders in the built-in sans, and the next
 * request tries again.
 */
async function loadFonts(): Promise<Font[] | null> {
  if (fontsPromise) return fontsPromise
  fontsPromise = (async () => {
    const css = await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@600;800;900&display=swap', { signal: AbortSignal.timeout(4000) }).then((r) => r.text())
    const faces = parseGoogleFontCss(css)
    return Promise.all(
      faces.map(async (f) => ({
        name: 'Inter',
        data: await fetch(f.url, { signal: AbortSignal.timeout(4000) }).then((r) => r.arrayBuffer()),
        weight: f.weight as Font['weight'],
        style: 'normal' as const,
      })),
    )
  })().catch(() => {
    fontsPromise = null
    return null
  })
  return fontsPromise
}

/**
 * Draws a commissioner's share image. One function so the real endpoint
 * (/api/partner-codes/image) and the preview harness draw exactly the same thing.
 */
export async function renderShareCard(args: {
  code: string
  name: string
  look: ShareLookKey
  format: ShareFormatKey
  logo: 'af' | 'initials' | 'upload'
  logoUrl: string | null
  discountPercent: number
  discountMonths: number
}): Promise<ImageResponse> {
  const format = SHARE_FORMATS[args.format]
  const look = SHARE_LOOKS[args.look]
  const wide = format.width / format.height > 1.5
  // Story is tall: scale the content up so it fills the frame instead of floating in the middle.
  // Banner is short, so it scales off its height; story is tall, so its content is scaled up to fill it.
  const scale = wide ? format.height / 820 : (format.width / 1080) * (format.height > format.width * 1.5 ? 1.5 : 1)
  const px = (n: number) => Math.round(n * scale)
  const initials = args.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AF'
  const fonts = await loadFonts()

  const logo =
    args.logo === 'upload' && args.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={args.logoUrl} width={px(150)} height={px(150)} style={{ borderRadius: px(28), objectFit: 'cover' }} />
    ) : (
      <div style={{ width: px(150), height: px(150), borderRadius: 999, background: look.pillBg, color: look.pillText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(54), fontWeight: 900 }}>
        {args.logo === 'af' ? 'AF' : initials}
      </div>
    )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: wide ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: px(56),
          padding: px(wide ? 40 : 80),
          backgroundColor: look.bg,
          // Only Gridiron has a pattern. Satori refuses `backgroundImage: 'none'`, so omit the key instead.
          ...(look.stripes
            ? { backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.09) ${px(4)}px, transparent ${px(4)}px, transparent ${px(110)}px)` }
            : {}),
          color: look.text,
          // Satori calls .split on fontFamily, so an undefined value crashes the render: omit the key instead.
          ...(fonts ? { fontFamily: 'Inter' } : {}),
        }}
      >
        {logo}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: wide ? 'flex-start' : 'center', gap: px(wide ? 14 : 22) }}>
          <div style={{ fontSize: px(40), fontWeight: 600, color: look.sub }}>{`${args.name} invites you to`}</div>
          <div style={{ fontSize: px(wide ? 96 : 120), fontWeight: 900, lineHeight: 1 }}>AllFantasy</div>
          <div style={{ fontSize: px(36), fontWeight: 700, color: look.sub, marginTop: px(wide ? 8 : 24) }}>Use code</div>
          <div style={{ display: 'flex', padding: `${px(20)}px ${px(44)}px`, borderRadius: px(28), background: look.pillBg, color: look.pillText, fontSize: px(84), fontWeight: 900 }}>{args.code}</div>
          <div style={{ fontSize: px(40), fontWeight: 800, color: look.accent }}>{`${args.discountPercent}% off your first ${args.discountMonths} months`}</div>
          <div style={{ fontSize: px(30), color: look.sub, marginTop: px(wide ? 4 : 16) }}>{`allfantasy.ai/with/${args.code}`}</div>
        </div>
      </div>
    ),
    { width: format.width, height: format.height, ...(fonts ? { fonts } : {}) },
  )
}
