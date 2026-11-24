import ChimmyPanelHarnessClient from './ChimmyPanelHarnessClient'

/**
 * DB-free render of the Chimmy chat panel (the drawer's Chimmy tab, shown full screen as on a phone).
 * SAMPLE leagues only. Production is refused by app/e2e/layout.tsx.
 */
export default function ChimmyPanelHarnessPage() {
  return <ChimmyPanelHarnessClient />
}
