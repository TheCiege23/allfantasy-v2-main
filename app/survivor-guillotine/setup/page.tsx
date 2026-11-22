import type { Metadata } from 'next'
import { SurvivorGuillotineSetup } from '@/components/survivor-guillotine/SurvivorGuillotineSetup'

export const metadata: Metadata = { title: 'Survivor Guilly Setup | AllFantasy' }

export default function SurvivorGuillotineSetupPage() {
  return <SurvivorGuillotineSetup />
}
