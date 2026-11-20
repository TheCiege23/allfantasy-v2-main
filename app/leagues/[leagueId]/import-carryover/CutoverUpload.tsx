'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CutoverUpload({leagueId}:{leagueId:string}){
  const router=useRouter()
  const [file,setFile]=useState<File>()
  const [message,setMessage]=useState(''), [busy,setBusy]=useState(false)
  async function submit(){
    if(!file || busy)return
    setBusy(true)
    try{
      const r=await fetch('/api/leagues/'+encodeURIComponent(leagueId)+'/import-carryover/reconcile',{method:'POST',headers:{'content-type':'text/csv'},body:file})
      const data=await r.json()
      setMessage(r.ok?'Verified. AllFantasy now scores this period.':data.error)
      if(r.ok)router.refresh()
    }catch{setMessage('The verification request was interrupted. You can retry the same file.')}
    finally{setBusy(false)}
  }
  return <div className="grid gap-3">
    <label>Dated source scores <input type="file" accept=".csv,text/csv" onChange={e=>setFile(e.target.files?.[0])}/></label>
    <button className="w-fit rounded border px-4 py-2" type="button" disabled={!file||busy} onClick={submit}>{busy?'Verifying…':'Verify and transfer scoring'}</button>
    <p role="status">{message}</p>
  </div>
}
