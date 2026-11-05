import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /pricing page's account layer and card kickers (components/core-app/screens/PricingV4.tsx,
 * from the Plans board 2026-11-05): who you are on, when it renews, your token balance, and which card
 * is yours. Everything else on the page keeps its existing copy.
 */
export const plansScreenMessages = defineMessages({
  en: {
    youreOn: (planName: string) => `You’re on ${planName}`,
    youreFree: 'You’re on the free plan',
    renews: (date: string) => `Renews ${date}`,
    tokens: (n: string) => `${n} tokens left`,
    manageBilling: 'Manage billing',
    seeTokens: 'Tokens and what they buy',
    yourPlan: 'Your plan',
    includedIn: (planName: string) => `Included in ${planName}`,
    kickerFree: 'For everyone',
    kickerPro: 'For players',
    kickerCommissioner: 'For commissioners',
    kickerSupreme: 'Pro + Commissioner',
  },
  es: {
    youreOn: (planName: string) => `Tienes ${planName}`,
    youreFree: 'Tienes el plan gratuito',
    renews: (date: string) => `Se renueva el ${date}`,
    tokens: (n: string) => `${n} tokens disponibles`,
    manageBilling: 'Gestionar facturación',
    seeTokens: 'Tokens y lo que compran',
    yourPlan: 'Tu plan',
    includedIn: (planName: string) => `Incluido en ${planName}`,
    kickerFree: 'Para todos',
    kickerPro: 'Para jugadores',
    kickerCommissioner: 'Para comisionados',
    kickerSupreme: 'Pro + Commissioner',
  },
})
