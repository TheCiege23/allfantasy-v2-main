import { defineMessages } from '@/lib/i18n/messages'

/**
 * "What runs itself" on the Commissioner Hub (components/core-app/commissioner/AutomationOverview.tsx)
 * — the panel's local `t(english, spanish)` helper and the group headings that were the English/Spanish
 * `GROUPS` table. Every string is the one the component wrote before the move, byte for byte, in both
 * languages — a relocation, not a rewrite. The per-automation `LABELS_ES` table stays in the component:
 * it is Spanish keyed by the row's code, a translator for the label the loader sends, not a pair.
 */
export const automationOverviewMessages = defineMessages({
  en: {
    stateOn: 'On',
    stateNeedsPlan: 'AF Commissioner',
    stateOff: 'Off',
    title: 'What runs itself',
    loading: 'Loading…',
    summary: (on: number, total: number) =>
      `${on} of ${total} automations are on. Each switch is on its own card or settings page; follow the link to change it.`,
    groupLineups: 'Lineups',
    groupDrafts: 'Drafts',
    groupFairness: 'Fairness',
    change: 'Change',
  },
  es: {
    stateOn: 'Activo',
    stateNeedsPlan: 'AF Commissioner',
    stateOff: 'Apagado',
    title: 'Lo que funciona solo',
    loading: 'Cargando…',
    summary: (on, total) =>
      `${on} de ${total} automatizaciones están activas. Cada interruptor está en su propia tarjeta o página de ajustes; sigue el enlace para cambiarlo.`,
    groupLineups: 'Alineaciones',
    groupDrafts: 'Drafts',
    groupFairness: 'Juego limpio',
    change: 'Cambiar',
  },
})
