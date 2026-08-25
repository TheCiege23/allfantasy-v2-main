/**
 * The AllFantasy crest, drawn rather than loaded.
 *
 * ⚠ WHY NOT `/af-crest.png`. That file is a JPEG with a `.png` extension —
 * verified by its magic bytes — and JPEG has no alpha channel, so it carries a
 * baked-in white background. On the rail's dark ground that is a white square
 * with a crest inside it, which is exactly the "not natural to the page" look.
 * Recompressing it would also mean shipping a second raster of a mark that is
 * four flat colours and two letters.
 *
 * Drawn as SVG it is transparent by construction, crisp at 42px and at 512,
 * costs no network request, and can take the page's own accent when a surface
 * wants it to sit quietly rather than assert the brand.
 *
 * The palette is the brand's, not the theme's, by default: a crest that
 * changes colour with the UI is decoration, not a mark. `tone="inherit"` is
 * the deliberate exception for places where it is furniture — a rail button
 * the eye should pass over on the way to the leagues.
 */

export function AfCrest({
  size = 42,
  tone = 'brand',
  title,
}: {
  size?: number
  /** 'brand' keeps AllFantasy blue; 'inherit' takes the surrounding colour. */
  tone?: 'brand' | 'inherit'
  /** Omit for decorative use — the parent link already carries the label. */
  title?: string
}) {
  const rim = tone === 'brand' ? '#2286D4' : 'currentColor'
  const body = tone === 'brand' ? '#123A7A' : 'transparent'
  const letters = tone === 'brand' ? '#FFFFFF' : 'currentColor'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      {/* Shield: angled shoulders, straight flanks, a point at the foot. */}
      <path
        d="M32 3 L59 15.5 V40 L32 69 L5 40 V15.5 Z"
        fill={body}
        stroke={rim}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <text
        x="32"
        y="41"
        textAnchor="middle"
        fill={letters}
        style={{
          /*
           * A stack, not a single family: this renders on whatever the device
           * has, and a missing face would silently reflow the two letters the
           * whole mark consists of.
           */
          font: '800 26px/1 Archivo, "Arial Black", Helvetica, Arial, sans-serif',
          letterSpacing: '-0.5px',
        }}
      >
        AF
      </text>
    </svg>
  )
}
