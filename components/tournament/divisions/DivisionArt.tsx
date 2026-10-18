/**
 * Layered division art: crests, badges and medallions composed from text-free SVG
 * plus app-rendered names (division-identity README). Never bake a name into art.
 */
import { CREST_GEOMETRY, RING_GEOMETRY, crestFor, divisionMark, libraryPath, side, type CrestArt } from '@/lib/tournament/divisions/identity'

const pct = (n: number) => `${n}%`

/** League crest (300×340). Names render only when the crest is big enough to keep text at ≥ 11px. */
export function DivisionCrest({ art, size = 160, label }: { art: CrestArt; size?: number; label?: string }) {
  const height = Math.round(size / CREST_GEOMETRY.aspect)
  const showText = size >= 120
  return (
    <div className="relative shrink-0" style={{ width: size, height }} role="img" aria-label={label ?? (art.kind === 'composed' ? `${art.ribbon} · ${art.tab}` : 'League crest')}>
      {art.kind === 'pack' ? (
        <img src={art.src} alt="" width={300} height={340} className="h-full w-full" draggable={false} />
      ) : (
        <>
          <img src={art.frame} alt="" width={300} height={340} className="absolute inset-0 h-full w-full" draggable={false} />
          <img src={art.emblem} alt="" width={200} height={200} className="absolute" draggable={false}
            style={{ left: pct(CREST_GEOMETRY.emblem.left), top: pct(CREST_GEOMETRY.emblem.top), width: pct(CREST_GEOMETRY.emblem.width) }} />
          {showText && <>
            <span className="absolute flex items-center justify-center overflow-hidden whitespace-nowrap font-black uppercase tracking-wide"
              style={{ left: pct(CREST_GEOMETRY.tab.left), top: pct(CREST_GEOMETRY.tab.top), width: pct(CREST_GEOMETRY.tab.width), height: pct(CREST_GEOMETRY.tab.height), color: art.ink, fontSize: Math.max(11, Math.round(size * 0.05)) }}>{art.tab}</span>
            <span className="absolute flex items-center justify-center overflow-hidden whitespace-nowrap font-black uppercase tracking-wider"
              style={{ left: pct(CREST_GEOMETRY.ribbon.left), top: pct(CREST_GEOMETRY.ribbon.top), width: pct(CREST_GEOMETRY.ribbon.width), height: pct(CREST_GEOMETRY.ribbon.height), color: art.ink, fontSize: Math.max(11, Math.round(size * 0.075)) }}>{art.ribbon}</span>
          </>}
        </>
      )}
    </div>
  )
}

export function LeagueCrest({ division, conference, size, label }: { division: { name: string; sideId: string }; conference: { name: string; image: string }; size?: number; label?: string }) {
  return <DivisionCrest art={crestFor(division, conference)} size={size} label={label} />
}

/** Division badge: palette ring + any library emblem (or the Black/Gold buffalo marks). */
export function DivisionBadge({ division, size = 56, label }: { division: { name?: string; sideId: string; emblem: string }; size?: number; label?: string }) {
  const mark = divisionMark(division)
  const aria = label ?? division.name ?? side(division.sideId).name
  if (mark.kind === 'mark') return <img src={mark.src} alt={aria} width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} />
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={aria}>
      <img src={mark.ring} alt="" width={300} height={300} className="absolute inset-0 h-full w-full" draggable={false} />
      <img src={mark.emblem} alt="" width={200} height={200} className="absolute" draggable={false}
        style={{ left: pct(RING_GEOMETRY.emblem.left), top: pct(RING_GEOMETRY.emblem.top), width: pct(RING_GEOMETRY.emblem.width) }} />
    </div>
  )
}

/** A conference's small icon (library image, silver finish). */
export function ConferenceIcon({ image, size = 20, label }: { image: string; size?: number; label?: string }) {
  return <img src={libraryPath(image)} alt={label ?? ''} aria-hidden={label ? undefined : true} width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} />
}

