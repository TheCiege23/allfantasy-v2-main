import {
  SpecialtyActionButton,
  SpecialtyCard,
  SpecialtyFeed,
  SpecialtyHero,
  SpecialtyShell,
  spStyles,
} from '@/components/league/specialty/SpecialtyShell'
import type { SpecialtyPreviewFormat } from '@/lib/specialty-preview/formats'

/**
 * A static "coming soon" preview for a specialty format with art but no engine, built on the
 * shared specialty shell (components/league/specialty/).
 *
 * It deliberately has no countdown, no live mechanic panel and no signature moment: those need real
 * league data, and King of the Hill / Pirate have no engine to supply it.
 */
export function SpecialtyFormatPreview({ format }: { format: SpecialtyPreviewFormat }) {
  return (
    <main data-format={format.slug} data-testid="specialty-format-preview" style={{ minHeight: '100vh', background: '#07080d' }}>
      <SpecialtyShell format={format.shellFormat}>
        <SpecialtyHero
          format={format.shellFormat}
          bannerSrc={format.art.banner}
          emblemSrc={format.art.emblem}
          emblemAlt={`${format.name} emblem`}
          chips={['Specialty format', 'Coming soon']}
          title={format.name}
          blurb={format.tagline}
        />
        <SpecialtyCard label="The idea" aside={<span className={spStyles.prop}>Rules not final</span>} testId="specialty-preview-idea">
          <SpecialtyFeed items={format.points.map((p) => ({ id: p.label, icon: p.icon, title: p.label, sub: p.body }))} />
        </SpecialtyCard>
        <SpecialtyCard label="Today on AllFantasy" testId="specialty-preview-today">
          <p style={{ margin: 0, maxWidth: 680, color: '#c4c9db', fontSize: 14 }}>{format.today}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            <SpecialtyActionButton action={{ label: 'My leagues', href: '/leagues', primary: true }} />
            <SpecialtyActionButton action={{ label: 'Create a league', href: '/create-league' }} />
          </div>
        </SpecialtyCard>
      </SpecialtyShell>
    </main>
  )
}

export default SpecialtyFormatPreview
