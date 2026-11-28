import { notFound } from 'next/navigation'
import NativeUndoHarnessClient from './NativeUndoHarnessClient'

/**
 * DB-free render of the "undo the switch" card (components/league-home/NativeUndoCard.tsx), with sample data.
 * Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/native-undo                 the card, before the commissioner asks
 *   /e2e/native-undo?state=confirm   the list of what undo throws away, with the confirm button
 *   /e2e/native-undo?state=nothing   the list when nothing has happened since the switch
 */
export default async function NativeUndoHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <NativeUndoHarnessClient state={sp.state === 'confirm' ? 'confirm' : sp.state === 'nothing' ? 'nothing' : 'idle'} />
}
