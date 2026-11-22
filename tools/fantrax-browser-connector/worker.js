import {downloadActualCsv,downloadTransactionCsv} from './download.js'
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id || !['download','downloadTransactions'].includes(message?.action))return
 ;(message.action==='download'?downloadActualCsv:downloadTransactionCsv)(message.url).then(csv=>reply({ok:true,csv}),()=>reply({ok:false,error:'Fantrax download failed. Check your login and retry; no credentials are copied.'}))
 return true
})
