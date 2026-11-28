/**
 * The Black Friday → Cyber Monday sale emails (lib/monetization/holidaySale.ts), as plain text for
 * `sendMarketingEmail` — which adds the unsubscribe link and footer itself. Pure:
 * scripts/send-holiday-sale.ts renders them and __tests__/monetization/holiday-sale-email.test.ts pins
 * every price against the catalog, so the email and the charge cannot drift apart.
 *
 *   launch  — Friday morning: the offer, all three plans, both intervals.
 *   lastday — Monday evening: "ends tonight".
 */
import { holidaySalePriceUsd, HOLIDAY_SALE_PERCENT_OFF } from '@/lib/monetization/holidaySale'
import { getMonetizationCatalogItemBySku, type MonetizationSku } from '@/lib/monetization/catalog'

export type HolidaySaleEmailKind = 'launch' | 'lastday'

type Input = {
  kind: HolidaySaleEmailKind
  lang: 'en' | 'es'
  /** Production origin, no trailing slash — links must not point at localhost. */
  baseUrl: string
}

/** "$40" for whole dollars, "$7.50" otherwise — the same rule the pricing page uses. */
function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

function price(sku: MonetizationSku): { was: string; now: string } {
  const item = getMonetizationCatalogItemBySku(sku)
  if (!item) throw new Error(`holiday sale email: no catalog item ${sku}`)
  return { was: money(item.amountUsd), now: money(holidaySalePriceUsd(item.amountUsd)) }
}

function prices() {
  return {
    proY: price('af_pro_yearly'),
    comY: price('af_commissioner_yearly'),
    supY: price('af_supreme_yearly'),
    proM: price('af_pro_monthly'),
    comM: price('af_commissioner_monthly'),
    supM: price('af_supreme_monthly'),
  }
}

export function buildHolidaySaleEmail(input: Input): { subject: string; bodyText: string } {
  const link = `${input.baseUrl}/pricing`
  const p = prices()
  const pct = HOLIDAY_SALE_PERCENT_OFF
  if (input.lang === 'es') return input.kind === 'launch' ? launchEs(link, p, pct) : lastdayEs(link, p, pct)
  return input.kind === 'launch' ? launchEn(link, p, pct) : lastdayEn(link, p, pct)
}

type P = ReturnType<typeof prices>

function launchEn(link: string, p: P, pct: number) {
  return {
    subject: `${pct}% off AllFantasy, this weekend only`,
    bodyText: [
      `The fantasy playoffs are a few weeks out, so this weekend every AllFantasy plan is ${pct}% off your first year.`,
      `AF Pro: ${p.proY.now} for the year (normally ${p.proY.was})\n100 Chimmy answers a day, start/sit calls, full trade breakdowns, and Competitive Edge on every manager in your league.`,
      `AF Commissioner: ${p.comY.now} for the year (normally ${p.comY.was})\nLeague health and integrity checks, recaps, custom scoring, and the Commissioner OS.`,
      `AF Supreme: ${p.supY.now} for the year (normally ${p.supY.was})\nEverything in Pro, Commissioner and Legacy.`,
      `Rather pay monthly? Those are half off too, for 12 months: ${p.proM.now}, ${p.comM.now} and ${p.supM.now}.`,
      `The discount is applied automatically at checkout on allfantasy.ai. No code to type.`,
      `Get ${pct}% off: ${link}`,
      `Ends Monday, Nov 30 at 11:59 PM ET.`,
      `Good luck down the stretch,\nThe AllFantasy team`,
      `Running a league? Share your Partner Code this weekend. Your leaguemates get the sale price, and you still get credit for every signup.`,
    ].join('\n\n'),
  }
}

function lastdayEn(link: string, p: P, pct: number) {
  return {
    subject: `Last day: ${pct}% off ends tonight`,
    bodyText: [
      `Quick reminder: ${pct}% off your first year ends tonight at midnight ET.`,
      `AF Pro is ${p.proY.now} for the year, AF Commissioner ${p.comY.now}, AF Supreme ${p.supY.now}. Or half off monthly for 12 months.`,
      `Get ${pct}% off: ${link}`,
      `After tonight, prices go back to normal.`,
      `The AllFantasy team`,
    ].join('\n\n'),
  }
}

function launchEs(link: string, p: P, pct: number) {
  return {
    subject: `${pct}% de descuento en AllFantasy, solo este fin de semana`,
    bodyText: [
      `Faltan pocas semanas para los playoffs de fantasy, así que este fin de semana todos los planes de AllFantasy tienen ${pct}% de descuento en tu primer año.`,
      `AF Pro: ${p.proY.now} por el año (normalmente ${p.proY.was})\n100 respuestas de Chimmy al día, decisiones de titulares, análisis completos de intercambios y Competitive Edge sobre cada mánager de tu liga.`,
      `AF Commissioner: ${p.comY.now} por el año (normalmente ${p.comY.was})\nSalud e integridad de la liga, resúmenes, puntuación personalizada y el Commissioner OS.`,
      `AF Supreme: ${p.supY.now} por el año (normalmente ${p.supY.was})\nTodo lo de Pro, Commissioner y Legacy.`,
      `¿Prefieres pagar mes a mes? También tienen ${pct}% de descuento durante 12 meses: ${p.proM.now}, ${p.comM.now} y ${p.supM.now}.`,
      `El descuento se aplica automáticamente al pagar en allfantasy.ai. No necesitas código.`,
      `Obtén ${pct}% de descuento: ${link}`,
      `Termina el lunes 30 de noviembre a las 11:59 p. m. (hora del Este).`,
      `Mucha suerte en la recta final,\nEl equipo de AllFantasy`,
      `¿Administras una liga? Comparte tu Partner Code este fin de semana. Tus compañeros de liga obtienen el precio de oferta y tú sigues recibiendo crédito por cada registro.`,
    ].join('\n\n'),
  }
}

function lastdayEs(link: string, p: P, pct: number) {
  return {
    subject: `Último día: el ${pct}% de descuento termina hoy`,
    bodyText: [
      `Un recordatorio rápido: el ${pct}% de descuento en tu primer año termina hoy a la medianoche (hora del Este).`,
      `AF Pro cuesta ${p.proY.now} por el año, AF Commissioner ${p.comY.now} y AF Supreme ${p.supY.now}. O la mitad mes a mes durante 12 meses.`,
      `Obtén ${pct}% de descuento: ${link}`,
      `Después de hoy, los precios vuelven a la normalidad.`,
      `El equipo de AllFantasy`,
    ].join('\n\n'),
  }
}
