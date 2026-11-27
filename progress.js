'use strict';
const progressKeys=['invited','agreed','completed'];
const progressPending=new Map();
const progressTTL=20*60*1000;
const elsevierOrigin='https://webapps.elsevier.cn';
const progressLabel=()=>T('更新进展','Update progress','進捗を更新');
const progressButton=r=>btn(progressLabel(),`type="button" data-progress="${esc(r.id)}"`);
const progressStatusName=()=>T('当前状态','Current status','現在の状況');
const progressUnchanged=()=>T('暂时没有新进展。再等等，愿好消息早日到来 🌱','No new progress yet. Hang in there — here’s hoping for good news soon 🌱','まだ進展はありません。もう少し待ちましょう。良い知らせが届きますように 🌱');
const progressRetry=()=>T('无法核对这次查询。请回到原稿件重新查询，或手动更新。','Could not verify this result. Reopen the query from the original submission or update manually.','結果を確認できません。元の投稿から再照会するか、手動で更新してください。');
const progressNorm=s=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';
const progressNumber=s=>progressNorm(s).replace(/r\d+$/,'');
const progressEdition=s=>progressNorm(s).match(/r\d+$/)?.[0];
function progressValue(key,value){
 if(value===null||value===undefined||value==='')return '—';
 return key==='status'?stateName(String(value)):String(value);
}
function progressSnapshot(r){
 const q=r.rounds.at(-1);
 return {status:r.status,round:q?.id||null,...Object.fromEntries(progressKeys.map(k=>[k,q?.[k]??null]))};
}
function progressResult(r,result){
 if(!result||!progressNumber(r.number)||progressNumber(result.number)!==progressNumber(r.number))return null;
 const expected=progressEdition(r.number),actual=progressEdition(result.number);
 if(expected&&actual&&expected!==actual)return null;
 const values={};
 if(typeof result.status==='string'&&Object.hasOwn(S,result.status)){
  values.status=result.status==='complete'&&FINAL_DECISIONS.includes(r.status)?r.status:result.status;
 }
 if(result.status==='ur'){
  for(const k of progressKeys)if(Number.isSafeInteger(result[k])&&result[k]>=0)values[k]=result[k];
 }
 return values;
}
function applyProgress(r,input,newRound,date,source){
 const rounds=r.rounds.map(q=>({...q})),status=input.status||r.status;
 const advancing=['we','ur','rrc'].includes(status);
 const requireNew=REVISIONS.includes(r.status)&&advancing;
 if(!date||!dateOK(date))fail('请输入有效的更新日期','Enter a valid update date','有効な更新日を入力してください');
 if(requireNew&&!newRound)fail('返修后进入新阶段，请确认开启新一轮','Confirm a new round after resubmission','再投稿後の新しいラウンドを確認してください');
 if(newRound&&(!REVISIONS.includes(r.status)||!advancing))fail('开启新一轮时请选择返修重投后的阶段','Choose the stage reached after resubmission','再投稿後の状況を選択してください');
 if(CLOSED.includes(r.status)&&status!==r.status&&!(r.status==='complete'&&['accept','reject'].includes(status)))fail('如需修改已结束稿件的状态，请使用「编辑」','Use Edit to change a closed submission’s status','終了した投稿の状況変更には「編集」を使用してください');
 const changes=[];
 if(newRound){
  rounds.push({...emptyRound(rounds.length+1),submitted:date});
  changes.push({key:'newRound'});
 }
 if(!rounds.length&&(status!=='waiting'||progressKeys.some(k=>Object.hasOwn(input,k))))rounds.push({...emptyRound(1),submitted:r.submitted});
 const q=rounds.at(-1);
 let accepted=r.accepted;
 if(status!==r.status){
  changes.push({key:'status',from:r.status,to:status});
  if(q&&advancing&&date&&!q[status])q[status]=date;
  if(q&&[...REVISIONS,...FINAL_DECISIONS].includes(status)){
   if(q.decision!==status)q.decisionDate=date;
   else if(date)q.decisionDate=date;
   q.decision=status;
  }
  if(status==='accept'&&date&&!accepted){
   if(r.submitted&&date<r.submitted)fail('录用日期不能早于投稿日期','Acceptance cannot precede submission','採択日は投稿日以降にしてください');
   accepted=date;
  }
 }
 for(const k of progressKeys)if(q&&Object.hasOwn(input,k)&&input[k]!==q[k]){
  changes.push({key:k,from:q[k],to:input[k]});q[k]=input[k];
 }
 if(!changes.length)return null;
 const error=q&&roundError(q);if(error)throw Error(error);
 return {...r,status,rounds,accepted,updated:today(),history:[...r.history,{
   kind:'progress',source,date,stageDate:date,text:'',status,changes,round:q?.index||0,at:new Date().toISOString()
 }]};
}
function showProgress(r,proposal=null){
 const snapshot=progressSnapshot(r),isQuery=proposal!==null;
 const isRevision=REVISIONS.includes(r.status),choices=r.status==='complete'?['complete','accept','reject']:Object.keys(S).filter(s=>s===r.status||s!=='waiting'&&!CLOSED.includes(r.status));
 const suggested=proposal?.status;
 const startNew=isRevision&&['we','ur','rrc'].includes(suggested);
 const authors=r.authors.filter(a=>a.corresponding&&queryReady(queryPayload(r,a.id)));
 modal('progress',progressLabel(),`<h3>${esc(r.title)}</h3><p class="note">${esc(stateName(r.status))} · ${r.rounds.length?`${txt.round()} ${r.rounds.length}`:'—'}</p>
 ${suggested&&!choices.includes(suggested)?`<p class="warning">${esc(progressStatusName()+': '+stateName(suggested))} · ${T('如需更正状态，请使用「编辑」。','Use Edit to correct this status.','状況の訂正には「編集」を使ってください。')}</p>`:''}
 <form id="progressForm" data-keep-actions><div class="form-grid">
 ${select('progressStatus',progressStatusName(),choices.map(s=>[s,stateName(s)]),choices.includes(suggested)?suggested:r.status)}
 ${field('progressDate',T('更新日期','Update date','更新日'),today(),'date','required')}
 ${isRevision?`<label class="field full"><span><input type="checkbox" id="progressNewRound"> ${T('返修后重新提交：开启下一轮','Resubmitted after revision: start a new round','修正後に再投稿：新しいラウンドを開始')}</span></label>`:''}
 ${progressKeys.map(k=>field('progress-'+k,ROUND_LABELS[k](),'','number','min="0" step="1"')).join('')}
 </div>
 <div id="progressDiff" aria-live="polite"></div><p id="progressError" class="warning hidden" role="alert"></p>
 <div class="modal-foot progress-actions">
 ${authors.length>1?select('progressQueryAuthor',T('通讯作者','Corresponding author','責任著者'),authors.map(a=>[a.id,a.name]),authors[0].id):''}
 ${authors.length?`<a class="btn" id="progressQueryOpen" target="_blank" rel="noopener noreferrer">${T('Elsevier 查询 ↗','Query Elsevier ↗','Elsevierで照会 ↗')}</a>`:''}
 ${btn(txt.cancel(),'type="button" data-close="progress"')}${btn(T('确认保存','Confirm and save','確認して保存'),'type="submit" id="progressSave"',true)}</div></form>`);
 const form=$('progressForm'),status=$('progressStatus'),newRound=$('progressNewRound'),date=$('progressDate');
 const query=$('progressQueryOpen'),author=$('progressQueryAuthor');
 if(query){
  const payload=()=>queryPayload(r,author?.value||authors[0].id);
  const sync=()=>{query.href=queryUrl(payload())};
  if(author)author.onchange=sync;
  query.onclick=()=>{query.href=progressQueryUrl(r,payload())};
  sync();
 }
 if(startNew)newRound.checked=true;
 const read=()=>{
  const input={status:status.value};
  for(const k of progressKeys){const value=$('progress-'+k).value;if(value!=='')input[k]=Number(value)}
  return input;
 };
 function refresh(reset=false){
  const fresh=!!newRound?.checked;
  for(const k of progressKeys){
   const el=$('progress-'+k),base=fresh?null:snapshot[k];
   if(reset)el.value=proposal&&Object.hasOwn(proposal,k)?proposal[k]:'';
   el.placeholder=progressValue(k,base);
  }
  const values=read(),rows=[];
  if(fresh)rows.push(`<li><strong>${T('开启新一轮','Start a new round','新しいラウンドを開始')}: ${r.rounds.length} → ${r.rounds.length+1}</strong></li>`);
  for(const key of ['status',...progressKeys]){
   if(!Object.hasOwn(values,key))continue;
   const base=fresh&&key!=='status'?null:snapshot[key];
   if(base!==values[key])rows.push(`<li><strong>${esc(key==='status'?progressStatusName():ROUND_LABELS[key]())}: ${esc(progressValue(key,base))} → ${esc(progressValue(key,values[key]))}</strong></li>`);
  }
  $('progressDiff').innerHTML=rows.length?`<ul class="progress-diff">${rows.join('')}</ul>`:'';
  $('progressSave').disabled=!rows.length;
 }
 if(newRound)newRound.onchange=()=>refresh(!isQuery);
 form.oninput=()=>refresh();
 form.onsubmit=e=>{
  e.preventDefault();const error=$('progressError');error.classList.add('hidden');
  try{
   const current=records.find(x=>x.id===r.id);
   if(!unlocked||current!==r)throw Error(progressRetry());
   const next=applyProgress(current,read(),!!newRound?.checked,date.value,isQuery?'elsevier':'manual');
   if(next&&writeAll(records.map(x=>x===current?next:x))){
    $('progress').close();render();
    if($('detail').open)showDetail(r.id);
    toast(T('进展已保存','Progress saved','進捗を保存しました'));
   }
  }catch(ex){error.textContent=ex.message;error.classList.remove('hidden')}
 };
 refresh(true);
}
function progressReturnUrl(){
 if(location.protocol==='http:'&&location.hostname==='127.0.0.1')return location.origin+'/';
 if(location.origin==='https://huaisong-yang.github.io'&&location.pathname.startsWith('/dear-editor/'))return location.origin+'/dear-editor/';
 return '';
}
function progressQueryUrl(r,p){
 const back=progressReturnUrl();
 if(!back||!progressChannel||!queryReady(p)||!unlocked)return queryUrl(p);
 const now=Date.now(),token=uid();
 const {round,...baseline}=progressSnapshot(r);
 for(const [key,entry] of progressPending)if(entry.expires<=now)progressPending.delete(key);
 progressPending.set(token,{id:r.id,account:accountStore.active,round,expires:now+progressTTL});
 return queryUrl({...p,progress:{token,back,number:r.number,baseline}});
}
let progressChannel=null;
function receiveProgressReceipt(e){
 const msg=e.data;
 if(msg?.type!=='receipt'||typeof msg.token!=='string')return;
 const entry=progressPending.get(msg.token);
 if(!entry)return;
 progressPending.delete(msg.token);
 const r=records.find(x=>x.id===entry.id),valid=entry.expires>Date.now()&&unlocked&&accountStore.active===entry.account&&r&&progressSnapshot(r).round===entry.round;
 const values=valid?progressResult(r,msg.result):null;
 if(!values||!Object.keys(values).length){progressChannel.postMessage({type:'reject',token:msg.token});return}
 if(msg.account!==entry.account){
  if(Object.entries(values).some(([k,v])=>progressSnapshot(r)[k]!==v))showProgress(r,values);
  else toast(progressUnchanged());
  progressChannel.postMessage({type:'original',token:msg.token});return;
 }
 progressChannel.postMessage({type:'accept',token:msg.token,id:r.id,round:entry.round});
}
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-progress]');
 if(!button||!unlocked)return;
 const r=records.find(x=>x.id===button.dataset.progress);if(r)showProgress(r);
});
document.addEventListener('DOMContentLoaded',()=>{
 const prefix='#de-progress=',returning=location.hash.startsWith(prefix);
 let receipt=null;
 if(returning){
  try{receipt=JSON.parse(decodeURIComponent(location.hash.slice(prefix.length)))}catch{}
  history.replaceState(history.state,'',location.pathname+location.search);
 }
 if(!progressReturnUrl()||typeof BroadcastChannel!=='function'){if(returning)alert(progressRetry());return}
 progressChannel=new BroadcastChannel('dear-editor-elsevier-progress-v1');
 progressChannel.onmessage=receiveProgressReceipt;
 if(!returning)return;
 if(!receipt||typeof receipt.token!=='string'||receipt.token.length>100){alert(progressRetry());return}
 const timer=setTimeout(()=>{progressChannel.onmessage=receiveProgressReceipt;alert(progressRetry())},3500);
 progressChannel.onmessage=e=>{
  const msg=e.data;
  if(msg?.token!==receipt.token||!['original','reject','accept'].includes(msg.type))return;
  clearTimeout(timer);progressChannel.onmessage=receiveProgressReceipt;
  if(msg.type==='original'){alert(T('结果已送回原来的 Dear Editor 标签页，请切回查看。','Result sent to the original Dear Editor tab. Switch back to review it.','元のDear Editorタブで結果を確認してください。'));return}
  const r=msg.type==='accept'&&unlocked&&records.find(x=>x.id===msg.id);
  const values=r&&progressSnapshot(r).round===msg.round&&progressResult(r,receipt.result);
  if(!values||!Object.keys(values).length){alert(progressRetry());return}
  if(Object.entries(values).some(([k,v])=>progressSnapshot(r)[k]!==v))showProgress(r,values);
  else toast(progressUnchanged());
 };
 progressChannel.postMessage({type:'receipt',token:receipt.token,account:unlocked?accountStore.active:null,result:receipt.result});
});
