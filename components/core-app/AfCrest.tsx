/**
 * The AllFantasy crest, drawn rather than loaded.
 *
 * ⚠ WHY NOT `/af-crest.png`. That file is a JPEG with a `.png` extension —
 * verified by its magic bytes — and JPEG has no alpha channel, so it carries a
 * baked-in white background. On the rail's dark ground that is a white square
 * with a crest inside it, which is exactly the "not natural to the page" look.
 * Recompressing it would also mean shipping a second raster of a mark that is
 * three flat colours and two letters.
 *
 * Drawn as SVG it is transparent by construction, crisp at 20px and at 512,
 * costs no network request, and can take the page's own accent when a surface
 * wants it to sit quietly rather than assert the brand.
 *
 * ⚠ THE GEOMETRY IS TRACED, NOT APPROXIMATED. The first version of this file
 * was a hand-drawn shield with a pointed foot and the letters set as <text> —
 * recognisably "a shield with AF on it", but not the brand's crest. Every
 * coordinate below was measured off the 1024px master artwork: the viewBox IS
 * that artwork's pixel space (crest bbox x 317–705, y 195–614), so a value can
 * be checked against the source by opening it and reading the pixel. The
 * letters are paths for the same reason — a <text> mark reflows with whatever
 * font the device happens to have.
 *
 * The palette is the brand's, not the theme's, by default: a crest that
 * changes colour with the UI is decoration, not a mark. `tone="inherit"` is
 * the deliberate exception for places where it is furniture — a rail button
 * the eye should pass over on the way to the leagues.
 */

/** Outer silhouette: peaked top, straight flanks, a rounded run to the foot. */
const OUTER =
  'M511 195 L705 267 V440 C705 490 618 570 511 614 C404 570 317 490 317 440 V267 Z'
/** The navy field, inset ~19 units — the rim is what lies between the two. */
const INNER =
  'M511 215 L686 280 V440 C686 486 610 556 511 594 C412 556 336 486 336 440 V280 Z'
/** "A" with its counter (evenodd), then "F". */
const LETTER_A = 'M434 303 H474 L527 474 H494 L483 437 H426 L416 474 H385 Z M455 338 L474 406 H435 Z'
const LETTER_F = 'M541 303 H639 V336 H573 V376 H625 V406 H573 V474 H541 Z'

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
  const brand = tone === 'brand'
  const rim = brand ? '#0B8DCB' : 'currentColor'
  const letters = brand ? '#FEFDF9' : 'currentColor'

  return (
    <svg
      width={size}
      height={size}
      viewBox="317 195 388 419"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      {/*
        The rim is drawn as a RING (outer minus inner, evenodd) rather than as
        the outer shape under an opaque field. That is what lets the inherit
        tone leave the field empty: an outline crest instead of a solid blob.
      */}
      <path d={`${OUTER} ${INNER}`} fill={rim} fillRule="evenodd" />
      {brand ? <path d={INNER} fill="#012967" /> : null}
      <path d={LETTER_A} fill={letters} fillRule="evenodd" />
      <path d={LETTER_F} fill={letters} />
    </svg>
  )
}
