/**
 * Imported-league assist (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3 idea 4, §1.1 "Imported leagues").
 *
 * AllFantasy computes the rookie draft order for a league that lives on Sleeper, ESPN, Yahoo,
 * Fleaflicker or MFL, but it cannot write the order back — those platforms' APIs are read-only to us.
 * So the commissioner gets what they need to apply it there in two minutes: the order with each
 * slot's reason, numbered steps for their platform, and a text block to paste into league chat.
 *
 * ⚠ MENU NAMES ARE "WHERE TO LOOK", NOT A PROMISE. Platforms rename their settings screens, and
 * nothing here can verify them. The steps say so, and the order itself — the part that matters — is
 * exact. A wrong menu name costs the commissioner a search; a wrong order would cost the league.
 *
 * Pure.
 */

export type ChecklistSlot = { slot: number; name: string; reason: string; status: 'locked' | 'provisional' }
export type Phase = 'regular_season' | 'playoffs' | 'final'
export type Lang = 'en' | 'es'

const PLATFORM: Record<string, { label: string; where: Record<Lang, string> }> = {
  sleeper: {
    label: 'Sleeper',
    where: {
      en: 'In the Sleeper app, open the league and go to the Draft tab. As commissioner, open the draft’s settings and choose the draft order.',
      es: 'En la app de Sleeper, abre la liga y ve a la pestaña Draft. Como comisionado, abre los ajustes del draft y elige el orden del draft.',
    },
  },
  espn: {
    label: 'ESPN',
    where: {
      en: 'On ESPN, open LM Tools (League Manager only) and find Draft Order.',
      es: 'En ESPN, abre LM Tools (solo el League Manager) y busca Draft Order.',
    },
  },
  yahoo: {
    label: 'Yahoo',
    where: {
      en: 'On Yahoo, open Commissioner Tools and find the draft order setting.',
      es: 'En Yahoo, abre Commissioner Tools y busca el ajuste del orden del draft.',
    },
  },
  fleaflicker: {
    label: 'Fleaflicker',
    where: {
      en: 'On Fleaflicker, open the league’s commissioner settings and find the draft order.',
      es: 'En Fleaflicker, abre los ajustes de comisionado de la liga y busca el orden del draft.',
    },
  },
  mfl: {
    label: 'MyFantasyLeague',
    where: {
      en: 'On MyFantasyLeague, open the Commissioner setup menu and find Draft Order.',
      es: 'En MyFantasyLeague, abre el menú de configuración del comisionado y busca Draft Order.',
    },
  },
}

export function platformLabel(platform: string | null | undefined): string {
  return PLATFORM[String(platform ?? '').toLowerCase()]?.label ?? 'your league’s platform'
}

export type DraftOrderChecklist = {
  platform: string
  /** Every slot is locked — safe to set on the platform now. */
  final: boolean
  steps: string[]
  /** Ready to paste into league chat. */
  shareText: string
}

export function buildDraftOrderChecklist(args: {
  platform: string | null | undefined
  draftSeason: number
  phase: Phase
  slots: readonly ChecklistSlot[]
  lang?: Lang
}): DraftOrderChecklist {
  const lang: Lang = args.lang === 'es' ? 'es' : 'en'
  const t = (en: string, es: string) => (lang === 'es' ? es : en)
  const key = String(args.platform ?? '').toLowerCase()
  const label = platformLabel(key)
  const slots = [...args.slots].sort((a, b) => a.slot - b.slot)
  const final = args.phase === 'final' && slots.length > 0 && slots.every((s) => s.status === 'locked')
  const where = PLATFORM[key]?.where[lang] ?? t(`Open ${label} and find the draft order setting for the ${args.draftSeason} draft.`, `Abre ${label} y busca el ajuste del orden del draft de ${args.draftSeason}.`)

  const steps = [
    ...(final ? [] : [t('This order is not final yet: some slots wait on games still to be played. Set it on the platform once every slot is locked.', 'Este orden aún no es final: algunos puestos dependen de partidos por jugar. Ponlo en la plataforma cuando todos los puestos estén fijados.')]),
    t(`Make sure the ${args.draftSeason} draft exists on ${label}. If it does not, create next season’s draft there first.`, `Comprueba que el draft de ${args.draftSeason} exista en ${label}. Si no existe, crea primero allí el draft de la próxima temporada.`),
    `${where} ${t('(Menu names can change; look for “draft order”.)', '(Los nombres de los menús pueden cambiar; busca «draft order».)')}`,
    ...slots.map((s) => t(`Put ${s.name} at pick ${s.slot}.`, `Pon a ${s.name} en la selección ${s.slot}.`)),
    t('Save, then check the order on the platform against this list.', 'Guarda y compara el orden en la plataforma con esta lista.'),
    t('Post the order to league chat so every manager can see why they pick where they do.', 'Publica el orden en el chat de la liga para que cada mánager vea por qué elige donde elige.'),
  ]

  const head = final
    ? t(`${args.draftSeason} rookie draft order (final)`, `Orden del draft de novatos ${args.draftSeason} (final)`)
    : t(`${args.draftSeason} rookie draft order (so far — not final)`, `Orden del draft de novatos ${args.draftSeason} (por ahora, no es final)`)
  const lines = slots.map((s) => `${s.slot}. ${s.name}${s.status === 'provisional' ? t(' (pending)', ' (pendiente)') : ''} — ${s.reason}`)
  const shareText = [head, '', ...lines, '', t('Calculated by AllFantasy from this season’s results.', 'Calculado por AllFantasy con los resultados de esta temporada.')].join('\n')

  return { platform: label, final, steps, shareText }
}
