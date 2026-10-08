import {downloadActualCsv} from './download.js'
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id || message?.action!=='download')return
 downloadActualCsv(message.url).then(csv=>reply({ok:true,csv}),()=>reply({ok:false,error:'Fantrax download failed. Check your login and retry; no credentials are copied.'}))
 return true
})
