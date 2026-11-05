"use client"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

/** Uses the production controls; no account, league, or production data is modified. */
export default function AndroidMobileHarness() {
  return <main className="mx-auto max-w-xl space-y-6 p-4">
    <h1 className="text-2xl font-bold">Android controls preview</h1>
    <p>Test controls for league, lineup, trade, draft and settings forms.</p>
    <label className="block">Player search<Input placeholder="Search players" /></label>
    <Select><SelectTrigger aria-label="Sport"><SelectValue placeholder="Choose sport" /></SelectTrigger><SelectContent><SelectItem value="NBA">NBA</SelectItem><SelectItem value="NFL">NFL</SelectItem></SelectContent></Select>
    <div className="flex flex-wrap gap-3"><Button size="sm">Review lineup</Button><Button size="icon" aria-label="Add player">+</Button></div>
    <Dialog><DialogTrigger asChild><Button>Review trade</Button></DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>Review your trade</DialogTitle><DialogDescription>Test data only. No trade will be sent.</DialogDescription></DialogHeader>
        <label>Trade note<Input placeholder="Add a note" /></label>
        <div className="space-y-4">{Array.from({length:8},(_,i)=><p key={i}>Player {i+1}: review roster impact and league settings before confirming.</p>)}</div>
        <DialogFooter><Button>Save preview</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </main>
}
