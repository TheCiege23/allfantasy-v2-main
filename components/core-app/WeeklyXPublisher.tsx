'use client'
import { useEffect, useRef, useState } from 'react'
import { messagesFor } from '@/lib/i18n/messages'
import { weeklyXPublisherMessages } from '@/lib/core-app/messages/weeklyXPublisher'
type Connection={configured:boolean;connected:boolean;handle:string|null;expiresAt:string|null}
/** What the X callback reported, carried back as ?xConnection=… on /core/week. */
function connectionResultMessage(result:string|null|undefined,m:typeof weeklyXPublisherMessages.en) {
  if(result==='connected')return m.xConnected
  if(result==='denied')return m.xConnectionWasCancelled
  if(result==='sign_in')return m.signInAgain
  if(result==='failed')return m.xDidNotFinishConnecting
  return ''
}
export function WeeklyXPublisher({post,leagueId,es=false,connectionResult=null}:{post:string;leagueId:string|null;es?:boolean;connectionResult?:string|null}) {
  const m=messagesFor(weeklyXPublisherMessages,es?'es':'en')
  const [connection,setConnection]=useState<Connection|null>(null),[text,setText]=useState(post),[reviewed,setReviewed]=useState(false)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(()=>connectionResultMessage(connectionResult,m)),[url,setUrl]=useState<string|null>(null),[uncertain,setUncertain]=useState(false)
  const requestId=useRef<string|null>(null)
  useEffect(()=>{setText(post);setReviewed(false);requestId.current=null},[post])
  useEffect(()=>{
    try {if(sessionStorage.getItem('af-weekly-x:pending')){setUncertain(true);setMessage(m.earlierPublicationUnconfirmed)}}catch{}
    let alive=true
    fetch('/api/core/week/x',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(alive)setConnection(value)}).catch(()=>{if(alive)setMessage(m.couldNotCheckConnection)})
    return ()=>{alive=false}
  },[m])
  async function connect() {
    setBusy(true);setMessage('')
    try {
      const response=await fetch('/api/core/week/x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'connect',league:leagueId})})
      const body=await response.json()
      if(!response.ok || typeof body.url!=='string' || !body.url.startsWith('https://x.com/i/oauth2/authorize?'))throw new Error()
      window.location.assign(body.url)
    }catch{setMessage(m.couldNotStartConnection)}
    finally{setBusy(false)}
  }
  async function disconnect() {
    setBusy(true)
    try {
      const response=await fetch('/api/core/week/x',{method:'DELETE'})
      if(!response.ok)throw new Error()
      setConnection(c=>c?{...c,connected:false,handle:null}:c)
      setMessage(m.disconnectedNote)
    }catch{setMessage(m.couldNotDisconnectX)}
    finally{setBusy(false)}
  }
  async function publish() {
    if(!reviewed||busy||uncertain||!connection?.connected||!text.trim()||text.length>280)return
    setBusy(true);setUrl(null);setMessage('')
    requestId.current??=crypto.randomUUID()
    try {sessionStorage.setItem('af-weekly-x:pending',requestId.current)}
    catch {setMessage(m.browserStorageNeeded);setBusy(false);return}
    try {
      const response=await fetch('/api/core/week/x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'publish',requestId:requestId.current,text})})
      const body=await response.json()
      if(response.ok && typeof body.url==='string' && /^https:\/\/x\.com\/i\/status\/\d+$/.test(body.url)) {
        sessionStorage.removeItem('af-weekly-x:pending')
        setUrl(body.url);setMessage(m.publishedOnX);setReviewed(false)
      }else if(['post_failed','invalid_post','reconnect','not_configured','invalid_origin','rate_limited'].includes(body.error)) {
        setMessage(body.error==='reconnect'?(m.connectionExpiredReconnectX):(m.xDidNotAcceptPost))
        sessionStorage.removeItem('af-weekly-x:pending')
        requestId.current=null;setReviewed(false)
        if(body.error==='reconnect')setConnection(c=>c?{...c,connected:false}:c)
      }else {setUncertain(true);setMessage(m.couldNotConfirmResult)}
    }catch{setUncertain(true);setMessage(m.couldNotConfirmResult)}
    finally{setBusy(false)}
  }
  const status=<p role="status" className="af-wbp-x-status">{message}{url ? <> <a href={url} target="_blank" rel="noopener noreferrer">{m.viewPost}</a></> : null}</p>
  const allowAnother=uncertain ? <button type="button" disabled={busy} onClick={()=>{try{sessionStorage.removeItem('af-weekly-x:pending')}catch{};setUncertain(false);setReviewed(false);requestId.current=null;setMessage('')}}>{m.allowAnotherPost}</button> : null
  const canPublish=!!connection?.configured && connection.connected
  return <div className="af-wbp-x-publisher">
    <h4>{m.publishWithMyX}</h4>
    {!connection ? <p>{m.checkingConnection}</p> : !connection.configured ? <p>{m.notConfigured}</p> : <>
      <p>{connection.connected? '@'+connection.handle : m.connectYourAccount}</p>
      <p><small>{connection.connected && !connection.expiresAt
        ? (m.staysConnectedNote)
        : (m.connectionExpiresNote)}</small></p>
      <button type="button" onClick={connect} disabled={busy}>{connection.connected?(m.reconnectOrChangeAccount):(m.connectX)}</button>
      {connection.connected ? <>
        <button type="button" onClick={disconnect} disabled={busy}>{m.disconnectFromAllfantasy}</button>
        <label>{m.textToPublishLabel}<textarea rows={5} value={text} disabled={busy} onChange={e=>{setText(e.target.value);setReviewed(false);requestId.current=null}}/></label>
        <p>{text.length}/280 {m.charactersNote}</p>
        <label><input type="checkbox" checked={reviewed} disabled={busy||uncertain} onChange={e=>setReviewed(e.target.checked)}/>{m.reviewedConfirm} @{connection.handle}.</label>
        {/* The result sits beside the button that produced it: below the fold it read as "nothing happened". */}
        <div className="af-wbp-x-publish-row">
          <button type="button" onClick={publish} disabled={busy||uncertain||!reviewed||!text.trim()||text.length>280}>{busy?(m.publishing):(m.publishNowOnX)}</button>
          {allowAnother}
          {status}
        </div>
      </> : null}
    </>}
    {canPublish ? null : <>{allowAnother}{status}</>}
  </div>
}
