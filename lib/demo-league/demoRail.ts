import type { DemoRailItem } from '@/components/demo-league/DemoCoreShell'
import { FORMAT_DEMO_META, getFormatDemo } from './formats/registry'

/**
 * The demo frame's league rail: the live demo league first, then one example league per league type.
 * Built on the server (the layout passes it down) so the format registry and its sample generators
 * never ship in the client bundle.
 */
export function demoRailItems(): DemoRailItem[] {
  return [
    // The live demo league is a dynasty league.
    { href: '/demo', name: 'AllFantasy Demo League', image: null, mark: 'AF', theme: 'dynasty' },
    ...FORMAT_DEMO_META.map((f) => ({
      href: `/demo/formats/${f.id}`,
      name: `${f.title} example`,
      image: f.poster,
      mark: f.title.slice(0, 2).toUpperCase(),
      theme: getFormatDemo(f.id)?.view.settings.isDynasty ? ('dynasty' as const) : ('redraft' as const),
    })),
  ]
}
