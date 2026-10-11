'use client'
import { useEffect, useRef, useState } from 'react'
type Connection={configured:boolean;connected:boolean;handle:string|null;expiresAt:string|null}
export function WeeklyXPublisher({post,leagueId,es=false}:{post:string;leagueId:string|null;es?:boolean}) {
  const [connection,setConnection]=useState<Connection|null>(null),[text,setText]=useState(post),[reviewed,setReviewed]=useState(false)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[url,setUrl]=useState<string|null>(null),[uncertain,setUncertain]=useState(false)
  const requestId=useRef<string|null>(null)
  useEffect(()=>{setText(post);setReviewed(false);requestId.current=null},[post])
  useEffect(()=>{
    try {if(sessionStorage.getItem('af-weekly-x:pending')){setUncertain(true);setMessage(es?'Una publicación anterior tiene un resultado sin confirmar. Comprueba X antes de publicar otra vez.':'An earlier publication has an unconfirmed result. Check X before posting again.')}}catch{}
    let alive=true
    fetch('/api/core/week/x',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(alive)setConnection(value)}).catch(()=>{if(alive)setMessage(es?'No se pudo comprobar la conexión.':'Could not check the X connection.')})
    return ()=>{alive=false}
  },[es])
  async function connect() {
    setBusy(true);setMessage('')
    try {
      const response=await fetch('/api/core/week/x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'connect',league:leagueId})})
      const body=await response.json()
      if(!response.ok || typeof body.url!=='string' || !body.url.startsWith('https://x.com/i/oauth2/authorize?'))throw new Error()
      window.location.assign(body.url)
    }catch{setMessage(es?'No se pudo iniciar la conexión.':'Could not start the X connection.')}
    finally{setBusy(false)}
  }
  async function disconnect() {
    setBusy(true)
    try {
      const response=await fetch('/api/core/week/x',{method:'DELETE'})
      if(!response.ok)throw new Error()
      setConnection(c=>c?{...c,connected:false,handle:null}:c)
      setMessage(es?'Desconectado de AllFantasy. Puedes revocar el acceso desde las aplicaciones conectadas de X.':'Disconnected from AllFantasy. You can revoke access in X’s connected apps settings.')
    }catch{setMessage(es?'No se pudo desconectar.':'Could not disconnect X.')}
    finally{setBusy(false)}
  }
  async function publish() {
    if(!reviewed||busy||uncertain||!connection?.connected||!text.trim()||text.length>280)return
    setBusy(true);setUrl(null);setMessage('')
    requestId.current??=crypto.randomUUID()
    try {sessionStorage.setItem('af-weekly-x:pending',requestId.current)}
    catch {setMessage(es?'Se necesita almacenamiento del navegador para evitar reintentos duplicados.':'Browser storage is needed to guard against duplicate retries.');setBusy(false);return}
    try {
      const response=await fetch('/api/core/week/x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'publish',requestId:requestId.current,text})})
      const body=await response.json()
      if(response.ok && typeof body.url==='string' && /^https:\/\/x\.com\/i\/status\/\d+$/.test(body.url)) {
        sessionStorage.removeItem('af-weekly-x:pending')
        setUrl(body.url);setMessage(es?'Publicado en X.':'Published on X.');setReviewed(false)
      }else if(['post_failed','invalid_post','reconnect','not_configured','invalid_origin','rate_limited'].includes(body.error)) {
        setMessage(body.error==='reconnect'?(es?'La conexión venció. Vuelve a conectar X.':'Connection expired. Reconnect X.'):(es?'X no aceptó la publicación. Revisa el texto y la conexión.':'X did not accept the post. Review the text and connection.'))
        sessionStorage.removeItem('af-weekly-x:pending')
        requestId.current=null;setReviewed(false)
        if(body.error==='reconnect')setConnection(c=>c?{...c,connected:false}:c)
      }else {setUncertain(true);setMessage(es?'No se pudo confirmar el resultado. Comprueba tu cuenta de X antes de intentar publicar otra vez.':'Could not confirm the result. Check your X account before attempting another post.')}
    }catch{setUncertain(true);setMessage(es?'No se pudo confirmar el resultado. Comprueba tu cuenta de X antes de intentar publicar otra vez.':'Could not confirm the result. Check your X account before attempting another post.')}
    finally{setBusy(false)}
  }
  return <div className="af-wbp-x-publisher">
    <h4>{es?'Publicar con mi cuenta de X':'Publish with my X account'}</h4>
    {!connection ? <p>{es?'Comprobando conexión…':'Checking connection…'}</p> : !connection.configured ? <p>{es?'La conexión con X está pendiente de configuración. Puedes abrir el borrador de X arriba.':'Connected X publishing isn’t available yet. You can open the X draft above.'}</p> : <>
      <p>{connection.connected? '@'+connection.handle : es?'Conecta tu cuenta para revisar y publicar aquí.':'Connect your account to review and publish here.'}</p>
      <p><small>{es?'La conexión caduca; vuelve a autorizar cuando se solicite. Esta opción publica solo texto.':'The connection expires; reauthorize when prompted. This option publishes text only.'}</small></p>
      <button type="button" onClick={connect} disabled={busy}>{connection.connected?(es?'Cambiar cuenta':'Reconnect or change account'):(es?'Conectar X':'Connect X')}</button>
      {connection.connected ? <>
        <button type="button" onClick={disconnect} disabled={busy}>{es?'Desconectar de AllFantasy':'Disconnect from AllFantasy'}</button>
        <label>{es?'Texto para publicar en X':'Text to publish on X'}<textarea rows={5} value={text} disabled={busy} onChange={e=>{setText(e.target.value);setReviewed(false);requestId.current=null}}/></label>
        <p>{text.length}/280 {es?'caracteres; X valida su propio límite.':'characters; X validates its own limit.'}</p>
        <label><input type="checkbox" checked={reviewed} disabled={busy||uncertain} onChange={e=>setReviewed(e.target.checked)}/>{es?'Revisé el texto. Quiero publicarlo en':'I reviewed the text and want to publish it on'} @{connection.handle}.</label>
        <button type="button" onClick={publish} disabled={busy||uncertain||!reviewed||!text.trim()||text.length>280}>{busy?(es?'Publicando…':'Publishing…'):(es?'Publicar ahora en X':'Publish now on X')}</button>
      </> : null}
    </>}
    {uncertain ? <button type="button" disabled={busy} onClick={()=>{try{sessionStorage.removeItem('af-weekly-x:pending')}catch{};setUncertain(false);setReviewed(false);requestId.current=null;setMessage('')}}>{es?'Comprobé X; permitir otra publicación':'I checked X; allow another post'}</button> : null}
    <p role="status">{message}{url ? <> <a href={url} target="_blank" rel="noopener noreferrer">{es?'Ver publicación':'View post'}</a></> : null}</p>
  </div>
}
