/**
 * English + Spanish copy for the commissioner settings tabs that used to be placeholders
 * (app/league/[leagueId]/components/CommissionerSettingsModal.tsx): Payments, Import / Sync, Advanced
 * Rules, Appearance, Permissions, Draft Pick Settings and Integrations. Kept beside `lib/i18n/translations`,
 * like c2c-campus-copy.ts: the panels read it through `useLanguage()`; anything not Spanish reads English.
 * `{{n}}`-style placeholders are filled by `tabsCopy`.
 */
export type TabsLang = 'en' | 'es'

export function tabsLang(language: string | null | undefined): TabsLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const TABS_COPY = {
  // Tab headers
  duesTitle: { en: 'Payments / League Dues', es: 'Pagos / Cuotas de la liga' },
  duesSub: { en: 'The buy-in, where members pay it, and who has paid.', es: 'La cuota, dónde la pagan los miembros y quién ya pagó.' },
  importTitle: { en: 'Import / Sync', es: 'Importar / Sincronizar' },
  importSub: { en: 'Where this league comes from and when it was last read.', es: 'De dónde viene esta liga y cuándo se leyó por última vez.' },
  advancedTitle: { en: 'Advanced Rules', es: 'Reglas avanzadas' },
  advancedSub: { en: 'The offseason calendar: when each offseason step opens and closes.', es: 'El calendario de pretemporada: cuándo abre y cierra cada paso.' },
  appearanceTitle: { en: 'Appearance / Branding', es: 'Apariencia / Marca' },
  appearanceSub: { en: 'The logo members see on the league header and league switcher.', es: 'El logo que ven los miembros en el encabezado y el selector de ligas.' },
  securityTitle: { en: 'Permissions', es: 'Permisos' },
  securitySub: { en: 'Lock rule areas so they cannot change mid-season without a league vote.', es: 'Bloquea áreas de reglas para que no cambien a mitad de temporada sin una votación de la liga.' },
  picksTitle: { en: 'Draft Pick Settings', es: 'Ajustes de selecciones del draft' },
  picksSub: { en: 'How far ahead picks can be traded, and protected or conditional picks.', es: 'Con cuánta antelación se pueden intercambiar selecciones, y selecciones protegidas o condicionales.' },
  integrationsTitle: { en: 'Integrations', es: 'Integraciones' },
  integrationsSub: { en: 'Connect this league to a Discord server.', es: 'Conecta esta liga a un servidor de Discord.' },

  // Import / Sync
  nativeLeague: {
    en: 'This league runs on AllFantasy, so there is nothing to sync. Every rule, roster and score lives here.',
    es: 'Esta liga funciona en AllFantasy, así que no hay nada que sincronizar. Todas las reglas, plantillas y puntuaciones están aquí.',
  },
  importedFrom: { en: 'Imported from {{platform}}', es: 'Importada de {{platform}}' },
  importedOn: { en: 'Imported {{date}}', es: 'Importada el {{date}}' },
  lastSynced: { en: 'Last synced {{date}}', es: 'Última sincronización: {{date}}' },
  neverSynced: { en: 'Not synced since the import.', es: 'Sin sincronizar desde la importación.' },
  statusError: { en: 'The last sync did not finish. Try again from the Sync screen.', es: 'La última sincronización no terminó. Vuelve a intentarlo desde la pantalla de sincronización.' },
  importNote: {
    en: 'Rules for an imported league are set on {{platform}}. AllFantasy reads them on each sync.',
    es: 'Las reglas de una liga importada se configuran en {{platform}}. AllFantasy las lee en cada sincronización.',
  },
  openSync: { en: 'Open the Sync screen', es: 'Abrir la pantalla de sincronización' },

  // Appearance
  logoCurrent: { en: 'Current logo', es: 'Logo actual' },
  logoNone: { en: 'No logo yet. Members see the league initials.', es: 'Todavía no hay logo. Los miembros ven las iniciales de la liga.' },
  logoUpload: { en: 'Upload a logo', es: 'Subir un logo' },
  logoReplace: { en: 'Replace logo', es: 'Cambiar logo' },
  logoRemove: { en: 'Remove logo', es: 'Quitar logo' },
  logoHint: { en: 'PNG, JPG, GIF or WebP. A square image looks best.', es: 'PNG, JPG, GIF o WebP. Una imagen cuadrada se ve mejor.' },
  logoSaved: { en: 'Logo saved.', es: 'Logo guardado.' },
  logoRemoved: { en: 'Logo removed.', es: 'Logo quitado.' },
  logoFailed: { en: 'The logo could not be saved. Try again.', es: 'No se pudo guardar el logo. Inténtalo de nuevo.' },
  readOnly: { en: 'Only the commissioner can change this.', es: 'Solo el comisionado puede cambiar esto.' },

  // Draft picks
  pickYearsLabel: { en: 'Seasons ahead picks can be traded', es: 'Temporadas de antelación para intercambiar selecciones' },
  pickYearsOne: { en: '{{n}} season', es: '{{n}} temporada' },
  pickYearsOther: { en: '{{n}} seasons', es: '{{n}} temporadas' },
  pickYearsHelp: {
    en: 'Trades offer each team’s picks this many seasons out. Making it shorter never loses a traded pick: it still counts when that season’s draft is made.',
    es: 'Los intercambios ofrecen las selecciones de cada equipo hasta estas temporadas. Acortarlo nunca hace perder una selección intercambiada: sigue contando cuando se crea el draft de esa temporada.',
  },
  pickYearsSave: { en: 'Save', es: 'Guardar' },
  pickYearsSaved: { en: 'Saved. Members see the change on the league home.', es: 'Guardado. Los miembros ven el cambio en el inicio de la liga.' },
  pickYearsFailed: { en: 'Could not save. Try again.', es: 'No se pudo guardar. Inténtalo de nuevo.' },
  picksNotDynasty: {
    en: 'Future pick settings apply to dynasty leagues that play on AllFantasy. Turn draft pick trading on or off in the Trades tab.',
    es: 'Los ajustes de selecciones futuras se aplican a las ligas dinastía que juegan en AllFantasy. Activa o desactiva el intercambio de selecciones en la pestaña Intercambios.',
  },
  picksTradingNote: { en: 'Draft pick trading itself is turned on or off in the Trades tab.', es: 'El intercambio de selecciones se activa o desactiva en la pestaña Intercambios.' },
} as const

export type TabsCopyKey = keyof typeof TABS_COPY

export function tabsCopy(key: TabsCopyKey, lang: TabsLang, vars: Record<string, string | number> = {}): string {
  return TABS_COPY[key][lang].replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''))
}
