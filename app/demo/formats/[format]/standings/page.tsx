import { notFound } from 'next/navigation'
import { Standings } from '@/components/core-app/screens/Standings'
import { FORMAT_DEMO_META, getFormatDemo } from '@/lib/demo-league/formats/registry'
import { demoLeagueStandings } from '@/lib/demo-league/coreStandings'

export function generateStaticParams() {
  return FORMAT_DEMO_META.map((f) => ({ format: f.id }))
}

export async function generateMetadata(props: { params: Promise<{ format: string }> }) {
  const { format } = await props.params
  const meta = FORMAT_DEMO_META.find((f) => f.id === format)
  return { title: meta ? `${meta.title} standings — demo · AllFantasy` : 'Standings — demo · AllFantasy' }
}

/**
 * A league-type example's standings, on the app's own Standings screen. An elimination format
 * (Guilly, Survivor, Survivor Guilly) gets the screen's elimination mode — Safe / On the bubble /
 * Eliminated — from the same chops and votes its example panels show.
 */
export default async function DemoFormatStandingsPage(props: { params: Promise<{ format: string }> }) {
  const { format } = await props.params
  const demo = getFormatDemo(format)
  if (!demo) notFound()
  const id = `demo-${demo.id}`
  const elimination = demo.elimination
    ? {
        eliminated: demo.elimination.eliminatedSlots.map((s) => `demo-${s}`),
        bubble: demo.elimination.bubbleSlots?.map((s) => `demo-${s}`) ?? null,
      }
    : null
  return (
    <Standings
      data={demoLeagueStandings(demo.view, { id, name: `${demo.title} example`, pointsOnly: demo.standingsMode === 'points' })}
      elimination={elimination}
    />
  )
}
