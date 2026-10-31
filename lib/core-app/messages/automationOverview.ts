import { defineMessages } from '@/lib/i18n/messages'

/**
 * "What runs itself" on the Commissioner Hub (components/core-app/commissioner/AutomationOverview.tsx).
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite.
 *
 * The rows, a preset's changes and its needs-plan list arrive from the API carrying their own English
 * and Spanish (`label` / `labelEs`, `detail` / `detailEs`); `fromApi` picks one of the pair. A row's
 * label is the exception — the API sends English only, so Spanish looks it up by the row's key here
 * and falls back to that English.
 */

const LABELS_ES: Record<string, string> = {
  fill_empty_starters: 'Llenar puestos titulares vacíos antes del cierre',
  managed_teams: 'Equipos que maneja AllFantasy o Chimmy',
  auto_handover: 'Pasar un equipo sin actividad',
  eliminated_lineups: 'Alineación mínima para equipos eliminados',
  ir_auto_move: 'Sacar de IR a los jugadores sanos',
  draft_as_me: 'Picks perdidos hechos como drafta el mánager',
  rookie_draft_opens: 'El draft de novatos se abre solo',
  rookie_draft_starts: 'El draft de novatos empieza solo',
  live_rookie_order: 'Orden del draft de novatos siempre al día',
  tanking: 'Monitor anti-tanking',
  trade_review_auto_approve: 'Aprobar intercambios sin alertas tras 48 horas sin revisión',
  hold_flagged_trades: 'Retener cambios sospechosos para revisión',
  taxi_rules: 'Reglas del taxi squad aplicadas',
}

export const automationOverviewMessages = defineMessages({
  en: {
    loadFailed: 'Could not load. Refresh and try again.',
    saveFailed: 'Could not save. Refresh and try again.',
    saved: 'Saved.',
    savedChanges: (n: number) => `Saved: ${n} change${n === 1 ? '' : 's'}. Every switch still works on its own.`,
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
    savingWill: 'Saving will:',
    needsPlanPrefix: 'Needs AF Commissioner, so not included: ',
    saving: 'Saving…',
    save: 'Save',
    cancel: 'Cancel',
    change: 'Change',
    groupLineups: 'Lineups',
    groupDrafts: 'Drafts',
    groupFairness: 'Fairness',
    rowLabel: (_key: string, english: string): string => english,
    fromApi: (english: string, _spanish: string): string => english,
  },
  es: {
    loadFailed: 'No se pudo cargar. Actualiza e inténtalo de nuevo.',
    saveFailed: 'No se pudo guardar. Actualiza e inténtalo de nuevo.',
    saved: 'Guardado.',
    savedChanges: (n) => `Guardado: ${n} cambio${n === 1 ? '' : 's'}. Cada interruptor sigue funcionando por separado.`,
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
    savingWill: 'Al guardar:',
    needsPlanPrefix: 'Requiere AF Commissioner, así que no se incluye: ',
    saving: 'Guardando…',
    save: 'Guardar',
    cancel: 'Cancelar',
    change: 'Cambiar',
    groupLineups: 'Alineaciones',
    groupDrafts: 'Drafts',
    groupFairness: 'Juego limpio',
    rowLabel: (key, english) => LABELS_ES[key] ?? english,
    fromApi: (_english, spanish) => spanish,
  },
})
