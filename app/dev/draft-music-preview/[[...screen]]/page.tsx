import { notFound } from 'next/navigation'
import { AppMusicLauncher } from '@/components/app-music/AppMusicDock'

export const dynamic = 'force-dynamic'

function Card({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section className="af-frame" style={{ padding: 14, display: 'grid', gap: 8 }}>
      <span className="af-label">{title}</span>
      {rows.map((row) => (
        <div
          key={row}
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--surface2)',
            border: '1px solid var(--line)',
            fontSize: 14,
          }}
        >
          {row}
        </div>
      ))}
    </section>
  )
}

export default async function MusicPreviewScreen({
  params,
}: {
  params: Promise<{ screen?: string[] }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await params
  const which = screen?.[0] ?? 'draft'

  if (which === 'lineup') {
    return (
      <>
        <header className="af-frame" style={{ padding: '12px 14px' }}>
          <strong>Set your lineup · Week 11</strong>
        </header>
        <Card
          title="Starters"
          rows={['QB · Jalen Hurts', 'RB · Bijan Robinson', 'RB · Kyren Williams', 'WR · Ja’Marr Chase', 'WR · Puka Nacua', 'TE · Sam LaPorta', 'FLEX · DeVonta Smith']}
        />
        <Card title="Bench" rows={['WR · Jayden Reed', 'RB · Zack Moss', 'QB · Sam Darnold']} />
      </>
    )
  }

  if (which === 'trades') {
    return (
      <>
        <header className="af-frame" style={{ padding: '12px 14px' }}>
          <strong>Review a trade offer</strong>
        </header>
        <Card title="You give" rows={['WR · Puka Nacua', '2026 2nd round pick']} />
        <Card title="You get" rows={['RB · Jahmyr Gibbs']} />
      </>
    )
  }

  if (which !== 'draft') notFound()

  return (
    <>
      <header className="af-frame" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between' }}>
        <strong>Iron Horse Dynasty · Round 3, pick 4</strong>
        <span style={{ color: 'var(--muted)' }}>On the clock 1:12</span>
      </header>
      <AppMusicLauncher />
      <Card title="The board" rows={['R1 · Bijan Robinson', 'R2 · Puka Nacua', 'R3 · on the clock']} />
    </>
  )
}
