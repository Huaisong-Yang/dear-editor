'use strict';
const tokenOK=token=>typeof token==='string'&&/^[a-z0-9-]{8,100}$/i.test(token);
const validKind=kind=>kind==='progress'||kind==='citation';
const appOrigin=url=>{
 try{
  const u=new URL(url);
  if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port&&['/','/index.html'].includes(u.pathname))return u.origin+'/';
  if(u.origin==='https://huaisong-yang.github.io'&&['/dear-editor/','/dear-editor/index.html'].includes(u.pathname))return u.origin+'/dear-editor/';
 }catch{}
 return '';
};
function providerSite(url,kind){
 try{
  const u=new URL(url);
  if(u.protocol!=='https:')return false;
  if(kind==='progress')return u.hostname==='webapps.elsevier.cn'&&u.pathname.startsWith('/st-wechat/');
  return ['scopus.com','www.scopus.com'].includes(u.hostname)&&/^\/(?:authid\/|pages\/author\/)/.test(u.pathname);
 }catch{return false}
}
async function processMessage(message,sender){
 const {kind,token,base,result}=message||{};
 if(!validKind(kind)||!tokenOK(token)||sender.frameId!==0||!Number.isInteger(sender.tab?.id))return {ok:false};
 if(!providerSite(sender.url,kind)||!base||appOrigin(base)!==base||typeof result!=='object'||!result)return {ok:false,reason:'rejected'};
 const origin=new URL(base).origin, pattern=origin.startsWith('http:')?'http://127.0.0.1/*':origin+'/*';
 if(!await chrome.permissions.contains({origins:[pattern]}))return {ok:false,reason:'permission'};
 const candidates=(await chrome.tabs.query({url:pattern}))
  .filter(t=>Number.isInteger(t.id)&&t.id!==sender.tab.id&&appOrigin(t.url)===base)
  .sort((a,b)=>Number(a.windowId!==sender.tab.windowId)-Number(b.windowId!==sender.tab.windowId));
 let inspected=false;
 for(const tab of candidates){
  let checked;
  try{
   const [injection]=await chrome.scripting.executeScript({
    target:{tabId:tab.id},world:'MAIN',args:[{kind,token,base,result}],
    func:message=>{
     if(typeof window.receiveDearEditorLookup!=='function')return 'outdated';
     return window.receiveDearEditorLookup(message)?'accepted':'rejected';
    }
   });
   checked=injection?.result;
  }catch{continue}
  if(checked==='rejected')inspected=true;
  if(checked!=='accepted')continue;
  try{
   const updated=await chrome.tabs.update(tab.id,{active:true});
   if(Number.isInteger(updated?.windowId))await chrome.windows.update(updated.windowId,{focused:true});
   return {ok:true,focused:true};
  }catch{return {ok:true,focused:false}}
 }
 return {ok:false,reason:inspected?'rejected':candidates.length?'outdated':'missing'};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.action!=='deliver')return;
 processMessage(message,sender).then(sendResponse,()=>sendResponse({ok:false}));
 return true;
});
