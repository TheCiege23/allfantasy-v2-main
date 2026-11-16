import { defineMessages } from '@/lib/i18n/messages'

/**
 * The manager card (components/core-app/manager-record/ManagerRecordSheet.tsx) — its own words. The
 * record's lines are the Competitive Edge builders' and are translated by their own translators; these
 * are only the card's frame. Moved here from inline language ternaries (the i18n ternary ratchet).
 */
export const managerRecordMessages = defineMessages({
  en: {
    loading: 'Reading their record…',
    close: 'Close',
    basis: 'Competitive Edge · what they have done, as counts. It says nothing about what they will do.',
    trades: 'Trades',
    waivers: 'Waivers this season',
    drafts: 'Past drafts',
    stale: 'This history may be out of date.',
    unattributed: (seasons: string) => `Picks from ${seasons} are not matched to managers yet, so this count may be low.`,
    failed: 'This record could not be read just now.',
    subject: 'A manager’s full record',
    open: 'Full record',
  },
  es: {
    loading: 'Leyendo su historial…',
    close: 'Cerrar',
    basis: 'Competitive Edge · lo que ha hecho, en números. No dice nada de lo que hará.',
    trades: 'Intercambios',
    waivers: 'Reclamos esta temporada',
    drafts: 'Drafts anteriores',
    stale: 'Este historial puede estar desactualizado.',
    unattributed: (seasons: string) => `Las selecciones de ${seasons} todavía no están asignadas a mánagers, así que este número puede ser bajo.`,
    failed: 'No se pudo leer este historial ahora.',
    subject: 'El historial completo de un mánager',
    open: 'Historial completo',
  },
})
