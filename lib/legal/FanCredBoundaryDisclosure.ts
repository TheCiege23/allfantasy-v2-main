export const FANCRED_BOUNDARY_DISCLOSURE_VERSION = "2026-03-28"

const SHORT_DISCLOSURE =
  "Paid league dues and payouts are handled externally via FanCred. AllFantasy does not process league dues, hold funds, or distribute winnings."

const LONG_DISCLOSURE = [
  "AllFantasy league creation and league operation are free.",
  "If your league uses paid dues, commissioners must manage dues and payouts externally through FanCred.",
  "AllFantasy is not the payment or payout processor for league prizes.",
  "No gambling, betting, or in-app prize payout systems are offered in AllFantasy.",
].join(" ")

const COMMISSIONER_SETUP_NOTICE =
  "Commissioners are responsible for setting up FanCred, collecting league dues, and managing payout distribution for paid leagues."

const DISCLOSURE_CHECKLIST = [
  "Paid league dues are handled externally through FanCred.",
  "Commissioners are responsible for FanCred setup and payout operations.",
  "AllFantasy does not process league dues, payouts, or winnings.",
  "No prizes or gambling occur inside the AllFantasy app.",
] as const

type FanCredBoundaryDisclosure = {
  version: string
  short: string
  long: string
  commissionerSetup: string
  checklist: readonly string[]
}

export function getFanCredBoundaryDisclosureShort(): string {
  return SHORT_DISCLOSURE
}

export function getFanCredBoundaryDisclosureLong(): string {
  return LONG_DISCLOSURE
}

export function getFanCredBoundaryChecklist(): readonly string[] {
  return DISCLOSURE_CHECKLIST
}

export function getFanCredCommissionerSetupNotice(): string {
  return COMMISSIONER_SETUP_NOTICE
}

export function getFanCredBoundaryDisclosure(): FanCredBoundaryDisclosure {
  return {
    version: FANCRED_BOUNDARY_DISCLOSURE_VERSION,
    short: SHORT_DISCLOSURE,
    long: LONG_DISCLOSURE,
    commissionerSetup: COMMISSIONER_SETUP_NOTICE,
    checklist: DISCLOSURE_CHECKLIST,
  }
}
