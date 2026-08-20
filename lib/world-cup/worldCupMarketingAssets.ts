/**
 * World Cup 2026 marketing asset paths.
 *
 * All paths are relative to /public/. Serving static assets from /public/
 * is zero-config in Next.js — no import or image optimization needed for
 * video/poster; use next/image for raster images.
 *
 * ASSET CHECKLIST — upload these files to activate.
 *
 * ⚠ TWO OF THESE WERE MARKED (exists) AND DO NOT. Checked against public/ and
 * against production, where both 404. A checklist that reports a missing file as
 * present is worse than no checklist, because it is the thing someone consults
 * before deciding whether an asset needs uploading.
 *
 * ⬜  /videos/world-cup/af-world-cup-hero.mp4             (MISSING — was marked exists)
 * ✅  /images/brackets/world-cup/af-world-cup-hero-poster.jpg (exists)
 * ✅  /images/brackets/world-cup/af-world-cup-logo.png    (exists)
 * ⬜  /images/brackets/world-cup/world-cup-bracket-template.png (MISSING — was marked exists; nothing reads bracketTemplateSrc today)
 * ⬜  /images/brackets/world-cup/world-cup-trophy-stadium.jpg
 * ⬜  /images/brackets/world-cup/world-cup-bracket-preview.jpg
 * ⬜  /images/brackets/world-cup/world-cup-ai-strategy.jpg
 *
 * The missing hero video is NOT currently a visible defect: WorldCupHeroMedia
 * falls back to the poster, which does exist, and fires its
 * onFallbackShown analytics event when it does. So the landing page has been
 * quietly serving the poster rather than the video.
 *
 * Components fall back to heroPosterSrc when a preferred asset is missing.
 */

export const WC_ASSETS = {
  /** Main hero video (autoplay, muted, looped) — cinematic 16:9 */
  heroVideoSrc: "/videos/world-cup/af-world-cup-hero.mp4",

  /** Poster image for heroVideoSrc — shown while loading / reduced-motion */
  heroPosterSrc: "/images/brackets/world-cup/af-world-cup-hero-poster.jpg",

  /** World Cup logo mark */
  logoSrc: "/images/brackets/world-cup/af-world-cup-logo.png",

  /** Bracket template visual */
  bracketTemplateSrc: "/images/brackets/world-cup/world-cup-bracket-template.png",

  /**
   * Optional additional hero-quality assets.
   * Falls back to heroPosterSrc until the files are uploaded.
   *
   * Upload /images/brackets/world-cup/world-cup-trophy-stadium.jpg
   * to replace the fallback with a dedicated stadium/trophy image.
   */
  trophyImageSrc: "/images/brackets/world-cup/af-world-cup-hero-poster.jpg",
  stadiumImageSrc: "/images/brackets/world-cup/af-world-cup-hero-poster.jpg",
  bracketPreviewImageSrc: "/images/brackets/world-cup/world-cup-bracket-template.png",
  aiStrategyImageSrc: "/images/brackets/world-cup/af-world-cup-hero-poster.jpg",

  /** Same as heroPosterSrc — used when a compact/portrait crop is preferred */
  mobilePosterSrc: "/images/brackets/world-cup/af-world-cup-hero-poster.jpg",

  /** Always-present fallback — the WC logo mark */
  fallbackImageSrc: "/images/brackets/world-cup/af-world-cup-logo.png",
} as const

export type WcAssetKey = keyof typeof WC_ASSETS
