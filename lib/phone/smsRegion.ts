/**
 * Which numbers we will TEXT a code to: the United States and Canada only (owner's decision,
 * 2026-11-23). PURE.
 *
 * ⚠ WHY: SMS PUMPING. Every code we text is billed to us, and international — especially some
 * Caribbean and premium routes — costs many times a US text. Fraud rings type expensive numbers
 * into public "text me a code" boxes and are paid a share by the carrier. The rate limits on
 * those routes are per process, so they slow this down rather than stop it. Refusing the number
 * before Twilio is called stops it.
 *
 * "+1" IS NOT "US OR CANADA". The North American Numbering Plan also covers about twenty other
 * countries — the Bahamas, Jamaica, the Dominican Republic and the rest of the Caribbean — and
 * those are exactly the pumping routes. Their area codes are listed below and refused. US
 * territories (Puerto Rico 787/939, USVI 340, Guam 671, Northern Marianas 670, American Samoa 684)
 * ARE the United States and stay allowed. 900 is premium-rate and refused.
 */

/** NANP area codes that belong to countries other than the US and Canada. */
const OTHER_NANP_COUNTRIES = new Set([
  "242", // Bahamas
  "246", // Barbados
  "264", // Anguilla
  "268", // Antigua and Barbuda
  "284", // British Virgin Islands
  "345", // Cayman Islands
  "441", // Bermuda
  "473", // Grenada
  "649", // Turks and Caicos
  "658", // Jamaica
  "664", // Montserrat
  "721", // Sint Maarten
  "758", // Saint Lucia
  "767", // Dominica
  "784", // Saint Vincent and the Grenadines
  "809", // Dominican Republic
  "829", // Dominican Republic
  "849", // Dominican Republic
  "868", // Trinidad and Tobago
  "869", // Saint Kitts and Nevis
  "876", // Jamaica
])

const PREMIUM_AREA_CODES = new Set(["900"])

export const SMS_REGION_ERROR = "PHONE_REGION_NOT_SUPPORTED"
export const SMS_REGION_MESSAGE = "We can only text US and Canadian phone numbers right now."

/**
 * True for a US or Canadian number in E.164 (`+1` and ten digits, a valid area code and exchange).
 * Takes the normalized form (lib/phone/e164 normalizePhoneE164); anything else is false.
 */
export function isSmsAllowedNumber(e164: string): boolean {
  const m = /^\+1([2-9]\d{2})([2-9]\d{2})\d{4}$/.exec(e164)
  if (!m) return false
  const area = m[1]
  if (OTHER_NANP_COUNTRIES.has(area) || PREMIUM_AREA_CODES.has(area)) return false
  // N11 codes (211, 311, … 911) are service codes, never area codes.
  if (area[1] === "1" && area[2] === "1") return false
  return true
}
