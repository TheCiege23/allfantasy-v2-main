import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { buildShareCardContent, headlineFontSize, statsForFormat, type ShareCardContent } from './cardContent'
import { FALLBACK_FONT_CACHE_CONTROL } from './momentAccess'
import { SHARE_CARD_SIZES, type ShareCardFormat, type ShareMomentRecord } from './types'

/**
 * Server render of a Survivor share card with `next/og`, ported from the handoff's `card.html` +
 * `share.css`. Every size, colour and spacing below comes from that reference renderer.
 *
 * FONTS. The career card (app/api/share/career-card/route.tsx) deliberately loads no font binaries:
 * the repo ships none, forbids next/font/google, and a CDN fetch on every export is a network
 * dependency on a request path. That reasoning is about cost per request, and it does not hold
 * here, because a share card is rendered once per moment and format and then served with
 * `immutable` caching. So the three faces are fetched from Google Fonts once per server process,
 * memoised, and bounded by a timeout. If the fetch fails the card still renders in the built-in
 * sans, and the response is marked short-lived (FALLBACK_FONT_CACHE_CONTROL) so the CDN does not
 * pin the degraded image for a year.
 *
 * ART. SVGs are read from `public/` and inlined as data URIs rather than passed as absolute URLs:
 * the server never fetches itself (Railway's bind address is not reachable from inside), and only
 * whitelisted `/survivor/...svg` paths can be read.
 */

type FontEntry = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800; style: 'normal' }

const FONT_FAMILIES: Array<{ name: string; query: string }> = [
  { name: 'Archivo', query: 'Archivo:wght@500;600;700;800' },
  { name: 'Cinzel', query: 'Cinzel:wght@700' },
  { name: 'JetBrains Mono', query: 'JetBrains+Mono:wght@700' },
]
const FONT_TIMEOUT_MS = 4000
const FONT_RETRY_AFTER_MS = 60_000

let fontsPromise: Promise<FontEntry[] | null> | null = null
let fontsFailedAt = 0

/** Parse a Google Fonts css2 response (requested without a browser UA, so it lists TTF files). */
export function parseGoogleFontCss(css: string): Array<{ weight: number; url: string }> {
  const out: Array<{ weight: number; url: string }> = []
  for (const block of css.split('@font-face').slice(1)) {
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1])
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(block)?.[1]
    if (url && Number.isFinite(weight)) out.push({ weight, url })
  }
  return out
}

async function fetchFamily(name: string, query: string): Promise<FontEntry[]> {
  const cssResponse = await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=swap`, { signal: AbortSignal.timeout(FONT_TIMEOUT_MS) })
  if (!cssResponse.ok) throw new Error(`font css ${cssResponse.status}`)
  const faces = parseGoogleFontCss(await cssResponse.text())
  if (faces.length === 0) throw new Error('font css had no faces')
  return Promise.all(faces.map(async face => {
    const file = await fetch(face.url, { signal: AbortSignal.timeout(FONT_TIMEOUT_MS) })
    if (!file.ok) throw new Error(`font file ${file.status}`)
    return { name, data: await file.arrayBuffer(), weight: face.weight as FontEntry['weight'], style: 'normal' as const }
  }))
}

async function loadFonts(): Promise<FontEntry[] | null> {
  if (fontsPromise) return fontsPromise
  if (fontsFailedAt && Date.now() - fontsFailedAt < FONT_RETRY_AFTER_MS) return null
  fontsPromise = Promise.all(FONT_FAMILIES.map(family => fetchFamily(family.name, family.query)))
    .then(sets => sets.flat())
    .catch((error: unknown) => {
      console.warn('[survivor-share] brand fonts unavailable, rendering with the default face:', error instanceof Error ? error.message : 'unknown')
      fontsFailedAt = Date.now()
      fontsPromise = null
      return null
    })
  return fontsPromise
}

const SAFE_SVG = /^\/survivor\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\.svg$/
const svgCache = new Map<string, { uri: string; aspect: number } | null>()

/** Read a whitelisted public SVG as a data URI with its viewBox aspect ratio (width / height). */
export async function loadPublicSvg(publicPath: string | null): Promise<{ uri: string; aspect: number } | null> {
  if (!publicPath || !SAFE_SVG.test(publicPath)) return null
  if (svgCache.has(publicPath)) return svgCache.get(publicPath) ?? null
  try {
    const text = await readFile(path.join(process.cwd(), 'public', ...publicPath.split('/').filter(Boolean)), 'utf8')
    const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(text)
    const aspect = box ? Number(box[1]) / Number(box[2]) : 1
    const value = { uri: `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`, aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1 }
    svgCache.set(publicPath, value)
    return value
  } catch {
    svgCache.set(publicPath, null)
    return null
  }
}

const FALLBACK_CREST = '/survivor/weekly/torch-lit-icon.svg'
const DEFAULT_HERO = '/survivor/idols/immunity.svg'

type Art = { uri: string; aspect: number } | null

/** satori drops the space after an en-dash run ("3–1–1 after" → "3–1–1after"); pin it. */
function keepDashRunTogether(text: string): string {
  return text.replace(/(\d–\d+) /g, '$1\u00a0')
}

const ARCHIVO = 'Archivo'
const CINZEL = 'Cinzel'
const MONO = 'JetBrains Mono'

function Card({ content, format, background, hero, crest }: { content: ShareCardContent; format: ShareCardFormat; background: Art; hero: Art; crest: Art }) {
  const size = SHARE_CARD_SIZES[format]
  const isLink = format === 'link'
  const isStory = format === 'story'
  const padding = isLink ? { t: 48, r: 56, b: 48, l: 56 } : isStory ? { t: 120, r: 80, b: 110, l: 80 } : { t: 72, r: 72, b: 64, l: 72 }
  const heroHeight = isLink ? 440 : isStory ? 780 : 560
  const midWidth = isLink ? 420 : size.width - padding.l - padding.r
  const glow = Math.round(midWidth * 0.7)
  const stats = statsForFormat(content, format)
  const headSize = headlineFontSize(format, content.headline)

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: ARCHIVO, fontWeight: 800, fontSize: 34, letterSpacing: -0.68, color: '#fff' }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, color: '#1a1204', backgroundImage: 'linear-gradient(135deg, #f1d58a, #d9b45a 55%, #a77c26)' }}>AF</div>
        <span>AllFantasy</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px 10px 10px', borderRadius: 999, background: 'rgba(7,8,13,.6)', border: '1px solid rgba(255,255,255,.14)', fontFamily: ARCHIVO, fontWeight: 600, fontSize: 24, color: '#e8eaf2', maxWidth: isLink ? 300 : 520 }}>
        {crest ? <img src={crest.uri} width={44} height={44} alt="" style={{ width: 44, height: 44 }} /> : null}
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{content.leagueName}</span>
      </div>
    </div>
  )

  const mid = (
    <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center', ...(isLink ? { width: 420, height: '100%', flexShrink: 0 } : { flexGrow: 1, width: '100%' }) }}>
      <div style={{ position: 'absolute', width: glow, height: glow, borderRadius: glow, backgroundImage: `radial-gradient(circle, ${content.theme.glow} 0%, rgba(7,8,13,0) 65%)` }} />
      {hero ? <img src={hero.uri} alt="" width={Math.round(heroHeight * hero.aspect)} height={heroHeight} style={{ position: 'relative', height: heroHeight, width: Math.round(heroHeight * hero.aspect), maxWidth: midWidth, objectFit: 'contain' }} /> : null}
    </div>
  )

  const text = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isLink ? 14 : 18, width: '100%' }}>
      <div style={{ display: 'flex' }}>
        <span style={{ display: 'flex', padding: '8px 16px', borderRadius: 6, fontFamily: ARCHIVO, fontWeight: 700, fontSize: isLink ? 20 : 22, letterSpacing: 3, textTransform: 'uppercase', color: content.theme.accent, background: 'rgba(7,8,13,.55)', border: `1.5px solid ${content.theme.accent}` }}>{content.kicker}</span>
      </div>
      <div style={{ display: 'block', fontFamily: CINZEL, fontWeight: 700, fontSize: headSize, lineHeight: 1.04, letterSpacing: headSize * 0.01, color: content.theme.head, textShadow: '0 4px 24px rgba(0,0,0,.6)', lineClamp: isStory ? 3 : 2 }}>{content.headline}</div>
      <div style={{ display: 'flex', fontFamily: ARCHIVO, fontWeight: 500, fontSize: isLink ? 24 : 32, lineHeight: 1.35, color: '#d6d9e6' }}>{keepDashRunTogether(content.sub)}</div>
      {stats.length > 0 ? (
        <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
          {stats.map(stat => (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: isLink ? '10px 14px' : '14px 20px', borderRadius: 12, background: 'rgba(16,19,28,.78)', border: '1px solid rgba(255,255,255,.1)', minWidth: isLink ? 120 : 170 }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: isLink ? 28 : 40, color: '#fff' }}>{stat.value}</span>
              <span style={{ fontFamily: ARCHIVO, fontWeight: 600, fontSize: isLink ? 13 : 18, letterSpacing: isLink ? 1.3 : 1.8, textTransform: 'uppercase', color: '#8d93ad' }}>{stat.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: isLink ? 14 : 34, paddingTop: isLink ? 14 : 26, borderTop: '1px solid rgba(255,255,255,.12)', fontFamily: ARCHIVO, fontWeight: 600, fontSize: isLink ? 17 : 24, color: '#a3a9c2' }}>
        <span>allfantasy.ai</span>
        <span style={{ display: 'flex' }}>
          <span style={{ color: '#f1d58a', fontWeight: 700 }}>Survivor</span>
          <span>{`\u00a0· ${content.footerSport}`}</span>
        </span>
      </div>
    </div>
  )

  const veil = isLink
    ? 'linear-gradient(90deg, rgba(7,8,13,.25) 0%, rgba(7,8,13,.55) 40%, rgba(7,8,13,.94) 62%, #07080d 100%)'
    : 'linear-gradient(180deg, rgba(7,8,13,.55) 0%, rgba(7,8,13,.15) 30%, rgba(7,8,13,.35) 55%, rgba(7,8,13,.92) 82%, #07080d 100%)'

  return (
    <div style={{ display: 'flex', position: 'relative', overflow: 'hidden', width: size.width, height: size.height, background: '#07080d', color: '#f3ead6', fontFamily: ARCHIVO, flexDirection: isLink ? 'row' : 'column', alignItems: isLink ? 'center' : 'stretch', gap: isLink ? 40 : 0, padding: `${padding.t}px ${padding.r}px ${padding.b}px ${padding.l}px` }}>
      {background ? <img src={background.uri} alt="" width={size.width} height={size.height} style={{ position: 'absolute', top: 0, left: 0, width: size.width, height: size.height, objectFit: 'cover' }} /> : null}
      <div style={{ position: 'absolute', top: 0, left: 0, width: size.width, height: size.height, backgroundImage: veil }} />
      {/* No fragments here: satori renders a fragment as its own flex-row box. */}
      {isLink ? mid : topBar}
      {isLink ? (
        <div style={{ display: 'flex', flexDirection: 'column', width: size.width - padding.l - padding.r - 420 - 40, gap: 18, position: 'relative' }}>
          {topBar}
          {text}
        </div>
      ) : mid}
      {isLink ? null : text}
    </div>
  )
}

export async function renderShareCard(moment: ShareMomentRecord, format: ShareCardFormat, cacheControl: string): Promise<ImageResponse> {
  const content = buildShareCardContent(moment.type, moment.week, moment.payload)
  const [fonts, background, heroArt, crestArt] = await Promise.all([
    loadFonts(),
    loadPublicSvg(content.backgroundPath),
    loadPublicSvg(content.heroPath),
    loadPublicSvg(content.crestPath ?? FALLBACK_CREST),
  ])
  const hero = heroArt ?? (await loadPublicSvg(DEFAULT_HERO))
  const crest = crestArt ?? (await loadPublicSvg(FALLBACK_CREST))
  const size = SHARE_CARD_SIZES[format]
  return new ImageResponse(<Card content={content} format={format} background={background} hero={hero} crest={crest} />, {
    width: size.width,
    height: size.height,
    ...(fonts ? { fonts } : {}),
    headers: {
      'Cache-Control': fonts ? cacheControl : cacheControl.startsWith('private') ? cacheControl : FALLBACK_FONT_CACHE_CONTROL,
      'Content-Disposition': `inline; filename="allfantasy-survivor-${moment.type}-week-${moment.week}-${format}.png"`,
    },
  })
}
