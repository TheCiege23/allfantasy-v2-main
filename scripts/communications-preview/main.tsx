import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionProvider } from 'next-auth/react'
import { MessageSquare } from 'lucide-react'
import CommsDrawer from '../../components/core-app/comms/CommsDrawer'
import '../../app/globals.css'

// Isolated preview: no request from this harness reaches a real chat or account.
const leagueMessages = [{ id: 'preview-message', userId: 'friend', userName: 'Jordan', username: 'Jordan', message: 'Who is everyone starting at FLEX this week?', createdAt: new Date().toISOString(), metadata: {} }]
window.fetch = async (input, init) => {
  const url = String(input)
  let payload: unknown = {}
  if (url.includes('/api/league/trade-grades')) {
    payload = url.includes('view=proposals') ? { proposals: [{ id: 'preview-offer', title: 'Dynasty Dragons → Jordan', status: 'pending', involvesYou: true, assets: ['Sample receiver', '2027 round 2 pick'], grade: 'B', explanation: 'Sample fairness snapshot for layout review only.' }], nextCursor: null } : { supported: true, grades: { trades: [], missing: [], fetchedAt: new Date().toISOString() } }
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
  }
  if (url.includes('/api/chat/chimmy')) payload = { response: 'Your league uses PPR scoring. I would compare the available FLEX candidates against their current projections and injury status before choosing a starter.', meta: { free: true, tokenSpend: { tokenCost: 0 } } }
  else if (url.includes('/typing')) payload = { typing: [] }
  else if (url.includes('/read-receipts')) payload = { receipts: [] }
  else if (url.includes('/threads/') && url.includes('/messages')) payload = { messages: [
    { id: 'private-preview', senderUserId: 'friend', senderName: 'Jordan', body: 'Who is everyone starting at FLEX this week?', createdAt: new Date().toISOString(), metadata: {} },
    { id: 'poll-preview', senderUserId: 'preview-user', senderName: 'You', body: 'Draft weekend?', createdAt: new Date().toISOString(), metadata: { poll: { question: 'Draft weekend?', closeAt: '2099-01-01', options: [{ id: 'sat', text: 'Saturday', votes: [] }, { id: 'sun', text: 'Sunday', votes: [] }] } } },
  ] }
  else if (url.includes('/threads')) payload = { threads: [{ id: 'dm-preview', threadType: 'dm', title: 'Jordan', unreadCount: 2, memberCount: 2 }, { id: 'group-preview', threadType: 'group', title: 'Draft weekend', unreadCount: 1, memberCount: 4 }] }
  else if (url.includes('/chat') || url.includes('/messages')) payload = { messages: leagueMessages, viewerUserId: 'preview-user' }
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const leagues = Array.from({ length: 65 }, (_, i) => ({ id: `preview-${i}`, name: i === 0 ? 'Dynasty Dragons' : i === 64 ? 'Last League - Long Name Championship' : `League ${i + 1}`, platform: 'sleeper', platformLeagueId: null }))
function Preview() {
  const [open, setOpen] = useState(true)
  return <><style>{`html,body,#root{margin:0;min-height:100%;background:#06070f;color:#eef0fa;font-family:Arial,sans-serif}main{padding:28px;max-width:900px;margin:auto}h1{font-size:22px}.preview-row{padding:18px 0;border-bottom:1px solid #252c40;display:flex;justify-content:space-between}button,input,select{font:inherit}`}</style><main>
    <h1>Dynasty Dragons</h1>
    <div className="preview-row"><span>QB - Josh Allen</span><span>24.1</span></div>
    <div className="preview-row"><span>RB - Bijan Robinson</span><span>14.8</span></div>
    <div className="preview-row"><span>FLEX</span><span>Open</span></div>
  </main>{!open && <button className="af-cm-launch" aria-label="Open communications" onClick={() => setOpen(true)}><MessageSquare size={22}/></button>}
  <CommsDrawer userId="preview-user" open={open} onClose={() => setOpen(false)} leagues={leagues} pageLeagueId={leagues[0].id} chimmyTokenCost={10} />
  </>
}
createRoot(document.getElementById('root')!).render(<SessionProvider session={{ user: { id: 'preview-user', name: 'You' }, expires: '2099-01-01' }} refetchInterval={0} refetchOnWindowFocus={false}><Preview /></SessionProvider>)
