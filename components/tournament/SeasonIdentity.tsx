import type { ReactNode } from 'react'
import type { SeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { artPalette, identityArt, seasonArtPath, seasonBannerPath, type SeasonArt } from '@/lib/tournament/seasonArtwork'

export function SeasonCrest({ art, division = '', name = '', className = '' }: { art: SeasonArt; division?: string; name?: string; className?: string }) {
  const palette = artPalette(art.sideId)
  return <figure className={'m-0 min-w-0 ' + className} aria-label={name ? name + (division ? ' · ' + division : '') : division || palette.name}>
    <div className="relative mx-auto aspect-[300/340] w-full max-w-44" aria-hidden="true">
      <img src={seasonArtPath('frames', art.sideId)} alt="" width={300} height={340} className="h-full w-full" />
      <img src={seasonArtPath('library', art.emblemId)} alt="" width={200} height={200} className="absolute left-[19.3%] top-[18.2%] w-[61.3%]" />
      <span className="absolute left-[20%] top-[5.6%] w-[60%] truncate text-center text-[clamp(6px,1.2vw,11px)] font-black uppercase" style={{ color: palette.ink }}>{division || 'AllFantasy'}</span>
      <span className="absolute left-[13%] top-[79%] w-[74%] truncate text-center text-[clamp(7px,1.4vw,12px)] font-black uppercase" style={{ color: palette.ink }}>{name || palette.name}</span>
    </div>
    {name && <figcaption className="mt-1 break-words text-center text-sm font-semibold text-white">{name}</figcaption>}
  </figure>
}

export function SeasonIdentityHero({ config, children }: { config: SeasonBlueprint; children: ReactNode }) {
  const banner = seasonBannerPath(identityArt(config, 0))
  return <header className="relative isolate overflow-hidden rounded-2xl border border-amber-300/25 bg-[#0b0c12] p-5 sm:p-7">
    {banner && <img src={banner} alt="" aria-hidden="true" width={1600} height={500} className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-25" />}
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,rgba(201,162,74,0.18),transparent_65%)]" />
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="flex shrink-0 justify-center gap-2 sm:w-48">
        {config.artwork?.divisions.length ? config.artwork.divisions.slice(0, 2).map((art, index) => <SeasonCrest key={index} art={art} division={config.divisions[index]} className="w-24" />) : <SeasonCrest art={identityArt(config, 0)} className="w-28" />}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  </header>
}
