import { defineMessages } from '@/lib/i18n/messages'

/**
 * "What runs itself" on the Commissioner Hub (components/core-app/commissioner/AutomationOverview.tsx)
 * — the panel's local `t(english, spanish)` helper (including the preset buttons and their preview) and the group headings that were the English/Spanish
 * `GROUPS` table. Every string is the one the component wrote before the move, byte for byte, in both
 * languages — a relocation, not a rewrite. The per-automation `LABELS_ES` table stays in the component:
 * it is Spanish keyed by the row's code, a translator for the label the loader sends, not a pair.
 */
export const automationOverviewMessages = defineMessages({
  en: {
    loadFailed: 'Could not load. Refresh and try again.',
    saved: (n: number) => `Saved: ${n} change${n === 1 ? '' : 's'}. Every switch still works on its own.`,
    saveFailed: 'Could not save. Refresh and try again.',
    stateOn: 'On',
    stateNeedsPlan: 'AF Commissioner',
    stateOff: 'Off',
    title: 'What runs itself',
    loading: 'Loading…',
    summary: (on: number, total: number) =>
      `${on} of ${total} automations are on. Each switch is on its own card or settings page; follow the link to change it.`,
    presetRecommended: 'Turn on the recommended setup',
    presetRunIt: 'Run it for me',
    presetAllOn: 'Everything in this setup is already on.',
    presetSavingWill: 'Saving will:',
    presetNeedsPlan: 'Needs AF Commissioner, so not included: ',
    saving: 'Saving…',
    save: 'Save',
    cancel: 'Cancel',
    groupLineups: 'Lineups',
    groupDrafts: 'Drafts',
    groupFairness: 'Fairness',
    change: 'Change',
  },
  es: {
    loadFailed: 'No se pudo cargar. Actualiza e inténtalo de nuevo.',
    saved: (n) => `Guardado: ${n} cambio${n === 1 ? '' : 's'}. Cada interruptor sigue funcionando por separado.`,
    saveFailed: 'No se pudo guardar. Actualiza e inténtalo de nuevo.',
    stateOn: 'Activo',
    stateNeedsPlan: 'AF Commissioner',
    stateOff: 'Apagado',
    title: 'Lo que funciona solo',
    loading: 'Cargando…',
    summary: (on, total) =>
      `${on} de ${total} automatizaciones están activas. Cada interruptor está en su propia tarjeta o página de ajustes; sigue el enlace para cambiarlo.`,
    presetRecommended: 'Activar la configuración recomendada',
    presetRunIt: 'Que lo lleve AllFantasy',
    presetAllOn: 'Todo lo de esta configuración ya está activo.',
    presetSavingWill: 'Al guardar:',
    presetNeedsPlan: 'Requiere AF Commissioner, así que no se incluye: ',
    saving: 'Guardando…',
    save: 'Guardar',
    cancel: 'Cancelar',
    groupLineups: 'Alineaciones',
    groupDrafts: 'Drafts',
    groupFairness: 'Juego limpio',
    change: 'Cambiar',
  },
})
