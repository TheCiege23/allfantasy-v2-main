'use client'
import { useState } from 'react'
import type { SeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { identityArt } from '@/lib/tournament/seasonArtwork'
import { SeasonCrest } from './SeasonIdentity'
const moments = [ ['revealed', 'League revealed'], ['draft', 'Draft scheduled'], ['cut', 'Made the cut'], ['eliminated', 'Eliminated'], ['bubble', 'On the bubble'], ['champion', 'Champion'] ] as const
/** Planning previews only; no fake result data, channel enrollment or message dispatch. */
export function SeasonTournamentMoments({ config }: { config: SeasonBlueprint }) {
  const [moment, setMoment] = useState<string>('draft')
  const draft = config.rules?.calendar.drafts.find(d => d.stage === 1)
  const validDate = draft?.startsAt && Number.isFinite(Date.parse(draft.startsAt))
  const copy: Record<string, [string, string]> = {
    revealed: ['Your league is ready', 'Your saved league assignment and draft slot appear here after the field is frozen.'],
    draft: ['Your draft is scheduled', validDate ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.rules!.calendar.timezone }).format(new Date(draft!.startsAt)) : 'Set the first draft window to preview its scheduled time.'],
    cut: ['You made the cut', 'Your confirmed seed and next league appear after scores and corrections are final.'],
    eliminated: ['Thanks for competing', 'Your final finish and season recap appear after elimination is confirmed.'],
    bubble: ['The cut-line race is on', 'Your verified seed and distance from the cut appear once weekly scoring is available.'],
    champion: ['A champion is crowned', 'The verified winner and final result appear after the championship is finalized.'],
  }
  return <details className="min-w-0 rounded-2xl border border-amber-300/25 bg-slate-950 p-4 sm:p-6"><summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Tournament moments and champion card</summary>
    <p className="my-3 text-sm text-amber-200">Design previews · notifications, public trophy pages and image export are upcoming. No message is sent from this panel.</p>
    <div className="flex flex-wrap gap-2" aria-label="Tournament moment previews">{moments.map(([id, name]) => <button type="button" key={id} className="min-h-11 rounded-lg border border-white/20 px-3 text-sm aria-pressed:border-amber-300 aria-pressed:bg-amber-300/10" aria-pressed={moment === id} onClick={() => setMoment(id)}>{name}</button>)}</div>
    <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"><section aria-label="Notification design preview" className="min-w-0 rounded-2xl border border-white/15 bg-slate-900 p-4"><p className="text-xs uppercase tracking-widest text-slate-400">AllFantasy · preview</p><h3 className="mt-3 font-bold">{copy[moment]![0]}</h3><p className="mt-2 break-words text-sm text-slate-300">{config.name}</p><p className="mt-2 text-sm text-slate-300">{copy[moment]![1]}</p></section>
    <section aria-label="Champion card design preview" className="min-w-0 rounded-2xl border border-amber-300/40 bg-gradient-to-b from-amber-950/60 to-slate-950 p-5 text-center"><p className="text-xs uppercase tracking-widest text-amber-200">Champion card · preview</p><SeasonCrest art={identityArt(config, 0)} division={config.divisions[0] ?? ''} className="mx-auto mt-4 w-28 max-w-full" /><h3 className="mt-3 text-xl font-black tracking-widest text-amber-300">CHAMPION</h3><p className="mt-2 break-words font-semibold">{config.name}</p><p className="mt-3 text-sm text-slate-300">Winner, final score and road to the title will come from finalized results.</p><p className="mt-6 text-xs text-amber-200">ALLFANTASY.AI · created by KB</p></section></div>
  </details>
}
