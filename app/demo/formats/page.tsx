import Link from 'next/link'
import { FORMAT_DEMO_META } from '@/lib/demo-league/formats/registry'

export const metadata = { title: 'League types — demo · AllFantasy' }

export default function DemoFormatsPage() {
  return (
    <div className="space-y-5 pt-2">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Every league type, before you commit</h1>
        <p className="mt-1 max-w-2xl text-sm af-muted">
          Each one is a generated example league: real NFL players, made-up teams and results, and the screens that make
          that format different. Pick one to look around, then create your own in a couple of minutes.
        </p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="demo-formats-grid">
        {FORMAT_DEMO_META.map((f) => (
          <li key={f.id}>
            <Link
              href={`/demo/formats/${f.id}`}
              className="af-card group flex h-full flex-col overflow-hidden transition hover:-translate-y-0.5"
              data-testid={`demo-format-card-${f.id}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.poster} alt="" width={640} height={360} loading="lazy" className="aspect-video w-full object-cover" />
              <span className="flex flex-1 flex-col p-4">
                <span className="text-lg font-black">{f.title}</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{f.subtitle}</span>
                <span className="mt-2 text-sm af-muted">{f.pitch}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
