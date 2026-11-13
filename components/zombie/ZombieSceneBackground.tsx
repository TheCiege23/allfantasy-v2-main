import clsx from 'clsx'
import { getZombieTheme, zombieThemeImageSrc } from '@/lib/zombie/zombieBackgroundThemes'

/**
 * A league's zombie scene behind a header: the theme's art (`/zombie/bg/<id>.svg`) with the two overlays
 * from the design handoff (`ZombieBackgrounds`) — a left-to-right fade so the title stays legible, and a
 * bottom fade into the page. Falls back to the theme's gradient, then to a neutral one, so an unknown or
 * missing theme still renders a header.
 *
 * Purely decorative: positioned absolutely inside a `relative` parent, hidden from assistive tech.
 */
export function ZombieSceneBackground({
  themeId,
  className,
  stackedBelowLg = false,
}: {
  themeId: string | null | undefined
  className?: string
  /**
   * The header's content spans its full width below `lg` (it stacks), so the fade — which leaves the art's
   * right side bare for a left-aligned title — puts the brightest marks behind content. Adds an even scrim
   * there. (2026-11-07 Zombie audit: the scene's red cross sat on the outbreak meter's labels on a phone.)
   */
  stackedBelowLg?: boolean
}) {
  const theme = getZombieTheme(themeId)
  return (
    <div
      className={clsx(
        'pointer-events-none absolute inset-0 overflow-hidden',
        theme?.gradientClass ?? 'bg-gradient-to-br from-slate-900 via-emerald-950 to-black',
        className,
      )}
      aria-hidden
    >
      {theme && (
        // eslint-disable-next-line @next/next/no-img-element -- a local SVG; next/image adds nothing here.
        <img
          src={zombieThemeImageSrc(theme.id)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[66%_60%] sm:object-[62%_60%]"
          decoding="async"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,8,13,0.92),rgba(7,8,13,0.55)_42%,transparent_72%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(transparent_55%,#07080d)]" />
      {stackedBelowLg ? <div className="absolute inset-0 bg-[rgba(7,8,13,0.7)] lg:hidden" data-testid="zombie-scene-stacked-scrim" /> : null}
    </div>
  )
}
