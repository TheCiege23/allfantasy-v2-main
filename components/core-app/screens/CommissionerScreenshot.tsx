import 'server-only'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * A feature screenshot on /commissioners, or a styled placeholder until the real image exists.
 *
 * ⚠ THE FILE CHECK RUNS ON THE SERVER, NOT IN THE BROWSER. The obvious version — render the <img>
 * and swap to a placeholder `onError` — ships a broken-image flash and a 404 per missing screenshot
 * to every visitor. Checking `public/` here means a missing file never reaches the page, and
 * dropping the PNG into `public/images/commissioners/` is the whole swap: no code change.
 *
 * Only paths under `/images/` are checked, so a stray `..` cannot walk out of `public/`.
 */
function publicFileExists(src: string): boolean {
  if (!src.startsWith('/images/') || src.includes('..')) return false
  try {
    return existsSync(path.join(process.cwd(), 'public', src))
  } catch {
    return false
  }
}

export function CommissionerScreenshot({ src, alt }: { src: string; alt: string }) {
  if (publicFileExists(src)) {
    return (
      <figure className="af-cx-shot">
        {/* eslint-disable-next-line @next/next/no-img-element -- static marketing asset, same as LandingV4's brand images */}
        <img className="af-cx-shot-img" src={src} alt={alt} width={1280} height={800} loading="lazy" decoding="async" />
      </figure>
    )
  }

  return (
    <figure className="af-cx-shot af-cx-shot--placeholder" data-screenshot-placeholder={src}>
      <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 15l5-5 4 4 3-3 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {/* The alt text doubles as the caption, so the placeholder still says what will be shown. */}
      <figcaption className="af-cx-shot-caption">
        <span className="af-cx-shot-title">Screenshot coming soon</span>
        <span className="af-cx-shot-alt">{alt}</span>
      </figcaption>
    </figure>
  )
}
