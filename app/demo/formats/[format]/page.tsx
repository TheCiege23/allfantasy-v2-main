import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FORMAT_DEMO_META, getFormatDemo } from '@/lib/demo-league/formats/registry'
import { DemoOverview } from '@/components/demo-league/DemoScreens'
import { FormatPanels } from '@/components/demo-league/formats/FormatPanels'

export function generateStaticParams() {
  return FORMAT_DEMO_META.map((f) => ({ format: f.id }))
}

export async function generateMetadata(props: { params: Promise<{ format: string }> }) {
  const { format } = await props.params
  const meta = FORMAT_DEMO_META.find((f) => f.id === format)
  return { title: meta ? `${meta.title} league — demo · AllFantasy` : 'League type — demo · AllFantasy' }
}

export default async function DemoFormatPage(props: { params: Promise<{ format: string }> }) {
  const { format } = await props.params
  const demo = getFormatDemo(format)
  if (!demo) notFound()
  const createHref = `/create-league?type=${demo.wizardType}`
  const testHref = `/create-league?type=${demo.wizardType}&from=demo`

  return (
    <div className="space-y-5 pt-2">
      <Link href="/demo/formats" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>← All league types</Link>
      <header className="af-card grid overflow-hidden md:grid-cols-[260px_minmax(0,1fr)]">
        {/* Posters come in landscape and portrait; a fixed box keeps the header short either way. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={demo.poster} alt="" width={640} height={360} className="h-44 w-full object-cover md:h-full md:max-h-[300px]" />
        <div className="p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] af-tertiary">Example league · {demo.view.settings.teamCount} teams · NFL</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{demo.title}</h1>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{demo.subtitle}</p>
          <p className="mt-2 text-sm af-muted">{demo.pitch}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {demo.rules.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={createHref} className="af-button-primary inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold" data-testid="format-create-league">
              Create a {demo.title} league
            </Link>
            <Link href={testHref} className="af-button-secondary inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold" data-testid="format-create-test-league">
              Try it as a test league
            </Link>
          </div>
        </div>
      </header>

      <FormatPanels panels={demo.panels} teams={demo.view.teams} />

      {demo.standingsNote ? <p className="text-sm af-muted">{demo.standingsNote}</p> : null}
      <DemoOverview view={demo.view} sample createHref={createHref} testLeagueHref={testHref} standingsMode={demo.standingsMode} standingsTitle={demo.standingsTitle} />
    </div>
  )
}
