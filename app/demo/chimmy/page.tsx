import { DemoChimmy } from '@/components/demo-league/DemoChimmy'

export default function DemoChimmyPage() {
  return (
    <div className="space-y-4 pt-2">
      <header>
        <h1 className="text-2xl font-black">Ask Chimmy</h1>
        <p className="mt-1 text-sm af-muted">
          Chimmy answers from this demo league&apos;s anonymized data only. It can&apos;t make moves here, and it doesn&apos;t know
          who the real managers are.
        </p>
      </header>
      <DemoChimmy />
    </div>
  )
}
