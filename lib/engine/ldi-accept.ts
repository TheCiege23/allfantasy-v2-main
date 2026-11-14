export interface LDIAcceptResult {
  probability: number
  drivers: AcceptDriver[]
  counterRequired: boolean
  explanation: string
}

interface AcceptDriver {
  id: string
  label: string
  impact: number
  direction: 'positive' | 'negative' | 'neutral'
}

