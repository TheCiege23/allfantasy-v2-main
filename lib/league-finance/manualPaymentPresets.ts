/**
 * Commissioner “record external payment” presets — stored on `LeagueDues.paymentProvider`.
 * Aligns with informal rails (PayPal, Coinbase Commerce, LeagueSafe-style escrow, cash/other).
 */

export type ManualPaymentPresetId =
  | 'manual'
  | 'paypal'
  | 'coinbase'
  | 'external_escrow'
  | 'venmo'
  | 'zelle'
  | 'cash'
  | 'other'

type ManualPaymentPreset = {
  id: ManualPaymentPresetId
  /** Full label in UI */
  label: string
  /** Short chip label */
  shortLabel: string
  /** Placeholder for external reference field */
  refPlaceholder: string
  /** Hint under the field */
  refHint: string
}

export const MANUAL_PAYMENT_PRESETS: ManualPaymentPreset[] = [
  {
    id: 'paypal',
    label: 'PayPal',
    shortLabel: 'PayPal',
    refPlaceholder: 'PayPal transaction ID or email receipt ref',
    refHint: 'Use PayPal’s transaction ID or your internal receipt note.',
  },
  {
    id: 'coinbase',
    label: 'Coinbase Commerce / crypto',
    shortLabel: 'Coinbase',
    refPlaceholder: 'Commerce charge code or on-chain tx id',
    refHint: 'Coinbase Commerce charge ID or shortened on-chain reference.',
  },
  {
    id: 'external_escrow',
    label: 'External escrow (LeagueSafe-style)',
    shortLabel: 'Escrow',
    refPlaceholder: 'Escrow league id or receipt #',
    refHint: 'Third-party escrow: paste league id, receipt, or tracking link fragment.',
  },
  {
    id: 'venmo',
    label: 'Venmo',
    shortLabel: 'Venmo',
    refPlaceholder: 'Venmo payment id or @handle note',
    refHint: 'Optional: last 4 of transaction or note you used.',
  },
  {
    id: 'zelle',
    label: 'Zelle',
    shortLabel: 'Zelle',
    refPlaceholder: 'Bank confirmation or memo',
    refHint: 'Reference from your bank’s Zelle confirmation.',
  },
  {
    id: 'cash',
    label: 'Cash / in-person',
    shortLabel: 'Cash',
    refPlaceholder: 'Date or receipt note',
    refHint: 'Record when/where cash was collected for audit.',
  },
  {
    id: 'manual',
    label: 'Other / manual ledger',
    shortLabel: 'Manual',
    refPlaceholder: 'Internal note (optional)',
    refHint: 'Generic commissioner confirmation without a specific rail.',
  },
  {
    id: 'other',
    label: 'Other app',
    shortLabel: 'Other',
    refPlaceholder: 'App name + reference',
    refHint: 'Any other payment app; put the provider name in the reference if helpful.',
  },
]

const IDS = new Set<string>(MANUAL_PAYMENT_PRESETS.map((p) => p.id))

function isManualPaymentPresetId(value: string): value is ManualPaymentPresetId {
  return IDS.has(value)
}

export function normalizeManualPaymentProvider(
  raw: string | undefined | null,
): ManualPaymentPresetId {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s && isManualPaymentPresetId(s)) return s
  return 'manual'
}

export function getManualPaymentPreset(id: ManualPaymentPresetId): ManualPaymentPreset | undefined {
  return MANUAL_PAYMENT_PRESETS.find((p) => p.id === id)
}
