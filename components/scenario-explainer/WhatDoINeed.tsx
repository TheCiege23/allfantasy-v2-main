'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { ChopExplainer, FirstPickExplainer, ScenarioExplainer } from '@/lib/scenario-explainer/scenarioService'

/**
 * Scenario explainer (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 8): "what do I need to get the
 * #1 pick / avoid the chop?" in plain words. The playoff question is answered by Season Outlook's own
 * milestones, beside which the #1-pick block is drawn.
 */

type Copy = (en: string, es: string) => string

function useScenarios(leagueId: string) {
  const [data, setData] = useState<ScenarioExplainer | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    // Never rejects: a failed read hides the block rather than raising an unhandled error on the page.
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/scenarios`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!live) return
        if (res.ok && body) setData(body as ScenarioExplainer)
        else setFailed(true)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [leagueId])
  return { data, failed }
}

const pctText = (n: number) => (n > 0 && n < 1 ? '<1%' : n > 99 && n < 100 ? '>99%' : `${Math.round(n)}%`)

export function FirstPickExplainerBlock({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const t: Copy = (en, es) => (language === 'es' ? es : en)
  const { data } = useScenarios(leagueId)
  if (!data || data.kind !== 'h2h' || !data.firstPick.supported) return null
  return <FirstPickView t={t} fp={data.firstPick} />
}

function FirstPickView({ t, fp }: { t: Copy; fp: Extract<FirstPickExplainer, { supported: true }> }) {
  const ruleEs: Record<string, string> = {
    lottery: 'Una lotería ponderada decide los primeros turnos del draft entre los equipos fuera de playoffs.',
    reverse_standings: 'El peor récord fuera de playoffs elige primero: es la regla de la liga.',
    lowest_points: 'Los menos puntos a favor fuera de playoffs eligen primero: es la regla de la liga.',
  }
  return (
    <section className="af-olk-panel" data-testid="first-pick-explainer" style={{ marginTop: 16 }}>
      <h3 className="af-label">{t('The #1 pick', 'La primera selección')}</h3>
      <p>{t(fp.ruleText, ruleEs[fp.rule] ?? fp.ruleText)}</p>
      {fp.you ? (
        <p>
          {fp.you.firstPickPct > 0
            ? t(
                `${fp.you.name}: ${pctText(fp.you.firstPickPct)} chance at the #1 pick, ${pctText(fp.you.missPlayoffsPct)} chance to miss the playoffs.`,
                `${fp.you.name}: ${pctText(fp.you.firstPickPct)} de opciones de la primera selección y ${pctText(fp.you.missPlayoffsPct)} de quedarse fuera de playoffs.`,
              )
            : t(
                `${fp.you.name} did not land the #1 pick in any simulated season.`,
                `${fp.you.name} no consiguió la primera selección en ninguna temporada simulada.`,
              )}
        </p>
      ) : null}
      {fp.leaders.length > 0 && (
        <ul>
          {fp.leaders.map((l) => (
            <li key={l.name} style={{ fontWeight: l.isYou ? 600 : undefined }}>
              {l.name}: {pctText(l.firstPickPct)}
            </li>
          ))}
        </ul>
      )}
      <p className="af-olk-empty">{t(fp.basis, 'Calculado con las mismas temporadas simuladas que usa la Proyección de temporada, aplicando la regla de orden del draft de la liga a cada tabla final.')}</p>
    </section>
  )
}

export function ChopExplainerBlock({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const t: Copy = (en, es) => (language === 'es' ? es : en)
  const { data } = useScenarios(leagueId)
  if (!data || data.kind !== 'guillotine' || !data.chop.supported) return null
  return <ChopView t={t} chop={data.chop} />
}

function ChopView({ t, chop }: { t: Copy; chop: Extract<ChopExplainer, { supported: true }> }) {
  const you = chop.you
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm" data-testid="chop-explainer">
      <h3 className="font-semibold">{t('What do I need to avoid the chop?', '¿Qué necesito para evitar la eliminación?')}</h3>
      {you?.chopped ? (
        <p className="mt-1 text-white/70">{t(`${you.name} has already been chopped.`, `${you.name} ya fue eliminado.`)}</p>
      ) : you ? (
        <>
          <p className="mt-1">
            {t(
              `${you.name}: ${pctText(you.surviveWeekPct)} to survive week ${chop.week}, ${pctText(you.surviveAllPct)} to outlast every remaining chop.`,
              `${you.name}: ${pctText(you.surviveWeekPct)} de sobrevivir la semana ${chop.week} y ${pctText(you.surviveAllPct)} de superar todas las eliminaciones restantes.`,
            )}
          </p>
          {you.safeScore && (
            <p className="mt-1">
              {t(
                `Score ${Math.ceil(you.safeScore.p80)} and you survive this week 4 times in 5 (${Math.ceil(you.safeScore.p95)} for 19 in 20).`,
                `Con ${Math.ceil(you.safeScore.p80)} puntos sobrevives esta semana 4 de cada 5 veces (${Math.ceil(you.safeScore.p95)} para 19 de cada 20).`,
              )}
            </p>
          )}
        </>
      ) : null}
      <ul className="mt-2 space-y-1">
        {chop.table.slice(0, 6).map((r) => (
          <li key={r.name} style={{ fontWeight: r.isYou ? 600 : undefined }}>
            {r.name}: {pctText(r.surviveWeekPct)} {t('to survive this week', 'de sobrevivir esta semana')}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/50">
        {t(chop.basis, 'Simulamos las eliminaciones restantes: cada equipo puntúa alrededor de su media semanal de esta temporada y los peores se eliminan cada semana. No se modelan cambios de alineación, lesiones ni semanas libres.')}
      </p>
    </section>
  )
}
