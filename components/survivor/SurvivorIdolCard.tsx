import type { CSSProperties, ReactNode } from 'react'
import {
  survivorIdolArt,
  survivorIdolCopy,
  survivorIdolTag,
  type SurvivorIdolLeagueValues,
  type SurvivorIdolTypeDef,
} from '@/lib/survivor/survivorIdolTypes'
import './survivorIdols.css'

/** Glow colour as CSS variables; anything that is not a plain hex colour falls back to gold. */
export function survivorIdolGlowStyle(glow: string | null | undefined): CSSProperties {
  const hex = typeof glow === 'string' && /^#[0-9a-f]{6}$/i.test(glow) ? glow : '#f2c94c'
  return { ['--glow' as string]: hex, ['--glow-soft' as string]: `${hex}47`, ['--glow-faint' as string]: `${hex}1a`, ['--glow-line' as string]: `${hex}5c` }
}

type Props = {
  type: SurvivorIdolTypeDef
  layout?: 'tile' | 'row'
  values?: SurvivorIdolLeagueValues
  selected?: boolean
  dimmed?: boolean
  /** Rendered after the copy (a checkbox, a Play button, an "Always in" chip). */
  aside?: ReactNode
  /** Rendered before the art (pick-mode checkbox). */
  lead?: ReactNode
  headingLevel?: 'h3' | 'h4'
}

/**
 * Idol card (survivor-theme handoff): radial glow in the idol's colour behind the art, Cinzel 700
 * title in the glow colour, and the `Category · ●●○` / "Always in" tag.
 */
export function SurvivorIdolCard({ type, layout = 'tile', values, selected, dimmed, aside, lead, headingLevel = 'h3' }: Props) {
  const Heading = headingLevel
  const art = survivorIdolArt(type.id, 'hero')
  return (
    <div className="svi-card" data-layout={layout} data-selected={selected || undefined} data-dimmed={dimmed || undefined} data-always={type.alwaysIn || undefined} style={survivorIdolGlowStyle(type.glow)}>
      {lead}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {art && <img className="svi-art" src={art} alt="" />}
      <div className="svi-copy">
        <Heading className="svi-name">{type.name}</Heading>
        <p className="svi-short">{survivorIdolCopy(type.id, type.short, values)}</p>
        {layout === 'tile' && <span className="svi-tag" data-always={type.alwaysIn || undefined}>{survivorIdolTag(type)}</span>}
      </div>
      {layout === 'row' && !aside && <span className="svi-tag svi-tag-row" data-always={type.alwaysIn || undefined}>{survivorIdolTag(type)}</span>}
      {aside}
    </div>
  )
}
