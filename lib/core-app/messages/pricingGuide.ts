import { defineMessages } from '@/lib/i18n/messages'

/**
 * /pricing guide copy (2026-11-14): the answer at the top, the yearly saving, Supreme's value in
 * numbers, and the folds. Prices arrive already formatted from the catalog — none is written here.
 */
export const pricingGuideMessages = defineMessages({
  en: {
    headPlan: (plan: string) => `You’re on ${plan}`,
    headFree: (from: string) => `Every league is free. Plans from ${from} a month`,
    headFreeNoPrice: 'Every league is free',
    introSupreme: 'Every paid tool is included: AF Pro’s player tools and AF Commissioner’s league tools.',
    introPlan: 'Your card is marked below. AF Supreme includes both paid plans.',
    introFree: 'Creating, importing and running leagues never costs anything. Pay for more Chimmy answers and player tools, for commissioner tools, or buy tokens and pay only for what you use.',
    saveRange: (min: number, max: number): string => (min === max ? `Save ${min}% paying yearly` : `Save ${min}–${max}% paying yearly`),
    supremeMonth: (supreme: string, separately: string) => `Both paid plans for ${supreme} a month instead of ${separately}.`,
    supremeYear: (supreme: string, separately: string) => `Both paid plans for ${supreme} a year instead of ${separately}.`,
    inYourPlan: 'In your plan',
    compareSummary: 'Compare every feature',
    comingSoon: (list: string) => `Coming soon on every plan: ${list}.`,
    tokensTitle: 'Or pay only for what you use',
    tokensSub: 'Tokens are for managers who do not want a subscription. Every action shows its cost before you click, and tokens you buy do not reset each month.',
  },
  es: {
    headPlan: (plan: string) => `Tienes ${plan}`,
    headFree: (from: string) => `Todas las ligas son gratis. Planes desde ${from} al mes`,
    headFreeNoPrice: 'Todas las ligas son gratis',
    introSupreme: 'Todas las herramientas de pago están incluidas: las de jugador de AF Pro y las de liga de AF Commissioner.',
    introPlan: 'Tu tarjeta está marcada abajo. AF Supreme incluye los dos planes de pago.',
    introFree: 'Crear, importar y llevar ligas nunca cuesta nada. Paga por más respuestas de Chimmy y herramientas de jugador, por herramientas de comisionado, o compra tokens y paga solo por lo que uses.',
    saveRange: (min: number, max: number): string => (min === max ? `Ahorra ${min}% pagando al año` : `Ahorra ${min}–${max}% pagando al año`),
    supremeMonth: (supreme: string, separately: string) => `Los dos planes de pago por ${supreme} al mes en vez de ${separately}.`,
    supremeYear: (supreme: string, separately: string) => `Los dos planes de pago por ${supreme} al año en vez de ${separately}.`,
    inYourPlan: 'En tu plan',
    compareSummary: 'Comparar todas las funciones',
    comingSoon: (list: string) => `Próximamente en todos los planes: ${list}.`,
    tokensTitle: 'O paga solo por lo que uses',
    tokensSub: 'Los tokens son para quien no quiere suscripción. Cada acción muestra su costo antes de tocarla, y los tokens que compras no se reinician cada mes.',
  },
})
