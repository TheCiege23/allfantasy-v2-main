import { readFile } from 'node:fs/promises'
import path from 'node:path'
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

type Badges = { apple: string; google: string }
let badgesPromise: Promise<Badges | null> | null = null

/**
 * The official App Store and Google Play badges (public/badges/, the same files the landing page
 * uses), as data URIs so the renderer needs no network. Read once per process; on any failure the
 * image renders without them and the next request tries again.
 *
 * 🛑 STORE ARTWORK, STORE RULES — see components/core-app/screens/LandingStoreBadges.tsx: App Store
 * first, both the same height, Apple at least 40px tall, clear space of 1/4 the height, unaltered.
 */
async function loadBadges(): Promise<Badges | null> {
  if (badgesPromise) return badgesPromise
  const dir = path.join(process.cwd(), 'public', 'badges')
  badgesPromise = Promise.all([readFile(path.join(dir, 'app-store-en.svg')), readFile(path.join(dir, 'google-play-en.png'))])
    .then(([svg, png]) => ({
      apple: `data:image/svg+xml;base64,${svg.toString('base64')}`,
      google: `data:image/png;base64,${png.toString('base64')}`,
    }))
    .catch(() => {
      badgesPromise = null
      return null
    })
  return badgesPromise
}

/** Width over height of each badge file, so both render at one height without distortion. */
const APPLE_BADGE_RATIO = 119.66407 / 40
const GOOGLE_BADGE_RATIO = 564 / 168

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
  const [fonts, badges] = await Promise.all([loadFonts(), loadBadges()])
  const badgeH = px(wide ? 70 : 78)

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: wide ? 'flex-start' : 'center', textAlign: wide ? 'left' : 'center', gap: px(wide ? 14 : 22) }}>
          <div style={{ fontSize: px(40), fontWeight: 600, color: look.sub }}>{`${args.name} invites you to`}</div>
          <div style={{ fontSize: px(wide ? 96 : 120), fontWeight: 900, lineHeight: 1 }}>AllFantasy</div>
          <div style={{ fontSize: px(36), fontWeight: 700, color: look.sub, marginTop: px(wide ? 8 : 24) }}>Use code</div>
          <div style={{ display: 'flex', padding: `${px(20)}px ${px(44)}px`, borderRadius: px(28), background: look.pillBg, color: look.pillText, fontSize: px(84), fontWeight: 900 }}>{args.code}</div>
          {/* The discount is web-only (owner's call 2026-11-23), so the line says so now that the app is on the card too. */}
          <div style={{ fontSize: px(40), fontWeight: 800, color: look.accent }}>{`${args.discountPercent}% off your first ${args.discountMonths} months on the web`}</div>
          <div style={{ fontSize: px(30), color: look.sub, marginTop: px(wide ? 4 : 16) }}>{`allfantasy.ai/with/${args.code}`}</div>
          {badges ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: wide ? 'flex-start' : 'center', gap: px(14), marginTop: px(wide ? 10 : 28) }}>
              {/* A friend who installs the app counts only if they type the code at sign-up (/api/auth/register). */}
              <div style={{ fontSize: px(28), fontWeight: 600, color: look.sub }}>{`Or get the app. Enter ${args.code} when you sign up.`}</div>
              <div style={{ display: 'flex', gap: Math.ceil(badgeH / 4) + px(8) }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={badges.apple} width={Math.round(badgeH * APPLE_BADGE_RATIO)} height={badgeH} alt="" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={badges.google} width={Math.round(badgeH * GOOGLE_BADGE_RATIO)} height={badgeH} alt="" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: format.width, height: format.height, ...(fonts ? { fonts } : {}) },
  )
}
