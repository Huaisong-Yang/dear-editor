'use strict';
// Track each document, including the login screen. A lease covers browsers that
// skip pagehide; keepalive lets a normal close shorten the wait.
const diskTab=uid();
let diskTabSequence=0,diskTabActive=true;
function diskTabSignal(active){
 const body=JSON.stringify({tab:diskTab,sequence:++diskTabSequence,active});
 if(!active&&navigator.sendBeacon?.('/api/tab-close',new Blob([body],{type:'application/json'})))return;
 fetch('/api/tab',{method:'POST',keepalive:true,
  headers:{'Content-Type':'application/json','X-Dear-Editor-Local':'1'},
  body
 }).catch(()=>{});
}
diskTabSignal(true);
setInterval(()=>{if(diskTabActive)diskTabSignal(true)},15000);
window.addEventListener('pagehide',()=>{diskTabActive=false;diskTabSignal(false)});
window.addEventListener('pageshow',()=>{diskTabActive=true;diskTabSignal(true)});
document.addEventListener('visibilitychange',()=>{if(diskTabActive)diskTabSignal(true)});
let diskSession=null;
const diskKeys=[KEY,AUTHORS_KEY,PROFILE_KEY,SETTINGS_KEY];
function diskRequest(action,body){
 // Writes are synchronous so the existing editor never closes or reports
 // success before SQLite has committed the change.
 const request=new XMLHttpRequest();
 request.open(body===undefined?'GET':'POST','/api/'+action,false);
 if(body!==undefined){
  request.setRequestHeader('Content-Type','application/json');
  request.setRequestHeader('X-Dear-Editor-Local','1');
 }
 try{request.send(body===undefined?null:JSON.stringify(body))}
 catch{throw Error('无法连接本地服务。请让启动窗口保持打开，再重试。')}
 const result=JSON.parse(request.responseText||'{}');
 if(request.status!==200){const error=Error(result.error||'本地服务请求失败。');error.status=request.status;throw error}
 return result;
}
function diskOpenSession(session){
 const data=session.workspace;
 accountStore.use(session.id);
 for(const [key,value] of [[KEY,data.records],[AUTHORS_KEY,data.authors],[PROFILE_KEY,data.profile],[SETTINGS_KEY,data.settings]]){
  if(value==null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));
 }
 loadAccount(session.id);diskSession={id:session.id,revision:session.revision};
 enterWorkspace();
}
function diskForgetSession(){
 diskSession=null;accountStore.native.clear();clearDeletedSession();
}
const diskShowLogin=showLogin;
showLogin=function(register=false){
 diskShowLogin(register);
 $('rememberLogin')?.closest('label').remove();
 $('authForm').insertAdjacentHTML('beforebegin','<p class="note">本地数据库版 · 保存后自动写入电脑</p>');
 const form=$('authForm');
 form.onsubmit=e=>{
  e.preventDefault();const error=$('authError');
  try{
   const username=$('loginUser').value.trim(),password=$('loginPassword').value;
   if(register&&password!==$('confirmPassword').value)throw Error('两次密码不一致。');
   diskOpenSession(diskRequest(register?'register':'login',{username,password}));
  }catch(ex){error.textContent=ex.message}
 };
};
// The browser's optional file mirror is unnecessary in database mode.
enterWorkspace=fileMirrorEnter;
renderBackup=function(){
 fileMirrorBackup();
 const section=document.createElement('section');section.className='panel';
 section.innerHTML='<h2>本地数据库自动保存</h2><p class="note">每次成功保存都已写入电脑。清除浏览器网站数据后，只需用这个本地账号重新登录。导出备份仅用于迁移或防止磁盘故障；旧备份可恢复到当前账号。</p>';
 $('content').prepend(section);
};
function diskSnapshot(){
 return {records,library,profile,settings,loadError,stored:diskKeys.map(k=>[k,localStorage.getItem(k)])};
}
function diskRollback(s){
 ({records,library,profile,settings,loadError}=s);
 for(const [key,value] of s.stored){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}
}
function diskCommit(currentPassword){
 const workspace={records,authors:library,profile,settings};
 const result=diskRequest('save',{...diskSession,workspace,currentPassword});
 diskSession.revision=result.revision;
}
function diskImportData(papers,authors,source){
 if(!source||!profile)return {records:papers,authors,profile};
 const oldId='self:'+source.username,newId='self:'+profile.username;
 const rename=a=>a.id===oldId?{...a,id:newId}:a;
 // Academic profile fields move with the backup; the current login does not.
 return {records:papers.map(r=>({...r,authors:r.authors.map(rename)})),authors:authors.map(rename),
  profile:{...profile,...source,username:profile.username,salt:profile.salt,hash:profile.hash}};
}
function diskDiscardUndo(){undoState=null;clearTimeout(undoTimer);$('undoNotice')?.remove()}
const diskWrite=writeAll;
writeAll=function(...args){
 if(!diskSession||!unlocked){alert('请先登录本地账号。');return false}
 const previous=diskSnapshot();
 if(!diskWrite(...args))return false;
 try{
  const renamed=previous.profile.username!==profile.username,changedPassword=previous.profile.hash!==profile.hash||previous.profile.salt!==profile.salt;
  diskCommit(renamed?$('usernamePassword')?.value:changedPassword?$('oldPassword')?.value:undefined);
  if(renamed||changedPassword)diskDiscardUndo();
  return true;
 }catch(ex){diskRollback(previous);diskDiscardUndo();alert(ex.message);return false}
};
undoLast=function(){
 if(!diskSession||!undoState||Date.now()>undoState.expires)return;
 const previous=diskSnapshot(),s=undoState;
 if(!v4Write(s.records,s.library,s.profile,{nextSettings:s.settings}))return;
 try{diskCommit()}catch(ex){diskRollback(previous);alert(ex.message);return}
 diskDiscardUndo();document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();toast(T('已撤回上一次操作','Last action undone','直前の操作を取り消しました'));
};
removeCurrentAccount=function(){
 diskRequest('delete',{...diskSession,currentPassword:$('deletePassword').value});
 diskForgetSession();
};
// This listener receives only the synthetic click after the existing confirmation.
document.addEventListener('click',e=>{
 if(!confirmingLogout||!e.target.closest('[data-logout]'))return;
 e.stopImmediatePropagation();
 try{
  if(diskSession)diskRequest('logout',{id:diskSession.id});
  diskForgetSession();
 }catch(ex){alert(ex.message)}
},true);
try{diskOpenSession(diskRequest('session'))}catch(ex){showLogin();if(ex.status!==401)$('authError').textContent=ex.message}
