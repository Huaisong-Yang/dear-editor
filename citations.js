'use strict';
// Cross-site lookups are user-initiated; only a confirmed preview writes to the workspace.
const citationMetricKeys=['publications','citations','hIndex'];
const citationPending=new Map();
const citationTimeLimit=30*60*1000;
const citationButtonLabel=()=>T('更新引用数','Update citation count','被引用数を更新');
const citationSyncLabel=()=>T('核对 Scopus 数据','Review Scopus data','Scopusのデータを確認');
const citationBadResult=()=>T('无法核对平台结果，请从 Dear Editor 重新发起查询。','Could not verify the result. Start the lookup again from Dear Editor.','結果を確認できません。Dear Editorから照会をやり直してください。');
const citationText=s=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' '):'';
const citationNormalize=s=>citationText(s).toLowerCase();
const citationTitleKey=s=>citationNormalize(s).replace(/[^\p{L}\p{M}\p{N}]+/gu,' ').trim();
const citationDoi=s=>citationNormalize(s).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/,'');
const citationInteger=x=>Number.isSafeInteger(x)&&x>=0;
const citationId=(p=profile)=>/^\d{4,25}$/.test(citationText(p?.scopus))?citationText(p.scopus):'';
const citationSiteUrl=id=>`https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(id)}`;
function citationSourceKey(value){
 const name=citationNormalize(value);
 // Keep old source snapshots in records and backups, without offering the retired integration.
 return name==='scopus'?'scopus':name==='wos'||name.startsWith('web of science')?'legacy':'manual';
}
function cleanCitationResult(raw){
 if(!raw||typeof raw.authorId!=='string'||!/^\d{4,25}$/.test(raw.authorId))return null;
 const metrics={};
 for(const key of citationMetricKeys)if(citationInteger(raw.metrics?.[key]))metrics[key]=raw.metrics[key];
 const documents=Array.isArray(raw.documents)?raw.documents.slice(0,250).filter(d=>d&&citationInteger(d.count))
  .map(d=>({title:citationText(d.title).slice(0,500),journal:citationText(d.journal).slice(0,200),doi:citationDoi(d.doi).slice(0,300),count:d.count}))
  .filter(d=>d.title||d.doi):[];
 const scanned=citationInteger(raw.scanned)?Math.min(raw.scanned,100000):documents.length;
 return {authorId:raw.authorId,metrics,documents,scanned:Math.max(scanned,documents.length)};
}
function findCitationMatches(papers,documents,target=null){
 const accepted=papers.filter(r=>r.status==='accept'),result=[];
 for(const paper of accepted){
  if(target&&paper.id!==target)continue;
  const doi=citationDoi(paper.doi),title=citationTitleKey(paper.title);
  const doiMatch=doi?documents.filter(d=>citationDoi(d.doi)===doi):[];
  if(doiMatch.length===1&&accepted.filter(r=>citationDoi(r.doi)===doi).length===1){
   result.push({paper,document:doiMatch[0],match:'doi',selected:true});continue;
  }
  if(doiMatch.length||!title||accepted.filter(r=>citationTitleKey(r.title)===title).length!==1)continue;
  const titleMatches=documents.filter(d=>citationTitleKey(d.title)===title);
  if(titleMatches.length!==1)continue;
  const document=titleMatches[0],journal=citationNormalize(paper.journal),remote=citationNormalize(document.journal);
  if(doi&&document.doi&&doi!==document.doi)continue;
  result.push({paper,document,match:journal&&remote&&journal===remote?'journal':'title',selected:true});
 }
 const matches=result.filter(({document})=>result.filter(row=>row.document===document).length===1);
 return {matches,unmatched:documents.length-matches.length};
}
function addCitationHistory(history,record,allowLegacy=false){
 if(record&&record.citations!=null&&record.citationDate&&!history.some(h=>h.date===record.citationDate&&
    h.count===record.citations&&((h.source||'')===(record.citationSource||'')||allowLegacy&&!h.source))){
  history.push({date:record.citationDate,count:record.citations,source:record.citationSource||''});
 }
 return history;
}
function paperCitationSources(r){
 const sources={...(r.citationsBySource||{})},key=citationSourceKey(r.citationSource);
 if(citationInteger(r.citations)&&!sources[key])sources[key]={count:r.citations,date:r.citationDate||'',source:r.citationSource||''};
 return sources;
}
function currentPaperCitation(r){
 if(citationInteger(r.citations)&&citationSourceKey(r.citationSource)!=='legacy')return {count:r.citations,source:r.citationSource||'',date:r.citationDate||''};
 const sources=paperCitationSources(r);
 return sources.scopus||sources.manual||null;
}
function citationDisplayRecord(r){
 if(r.status!=='accept'||citationSourceKey(r.citationSource)!=='legacy')return r;
 const shown=currentPaperCitation(r);
 return {...r,citations:shown?.count??null,citationSource:shown?.source??'',citationDate:shown?.date??''};
}
function saveCitationObservation(r,count,day){
 const sources={...paperCitationSources(r),scopus:{count,date:day,source:'Scopus'}};
 return {...r,citations:count,citationDate:day,citationSource:'Scopus',citationsBySource:sources,updated:today()};
}
function citationPaperSummary(r){
 const current=paperCitationSources(r).scopus;
 return citationInteger(current?.count)?`Scopus: ${current.count}${current.date?' · '+current.date:''}`:'';
}
function citationLaunch(target){
 const id=citationId(),back=progressReturnUrl();
 if(!id)return null;
 const url=new URL(citationSiteUrl(id));
 if(!back)return url.href;
 const now=Date.now(),token=uid();
 for(const [key,entry] of citationPending)if(entry.expires<=now)citationPending.delete(key);
 citationPending.set(token,{authorId:id,target:target||null,account:accountStore.active,expires:now+citationTimeLimit});
 url.hash='de-citation='+encodeURIComponent(JSON.stringify({authorId:id,back,token,lang}));
 return url.href;
}
function citationLinks(target=null){
 const id=citationId();
 if(!id)return `<p class="note">${T('请先在学术主页关联 Scopus Author ID。','Link your Scopus Author ID in your research profile first.','先にプロフィールに Scopus Author ID を登録してください。')}</p>`;
 return `<div class="actions"><a class="btn citation-lookup" href="${esc(citationSiteUrl(id))}" target="_blank" rel="noopener noreferrer" data-citation-lookup ${target?`data-citation-target="${esc(target)}"`:''}>${T('更新自 Scopus ↗','Update from Scopus ↗','Scopusから更新 ↗')}</a></div>`;
}
function citationMetricLabel(key){
 return {citations:txt.citations(),publications:T('文献数','Publications','論文数'),hIndex:'h-index'}[key];
}
function citationProfileMetrics(){
 const saved=profile.platformMetrics?.scopus;
 const current=citationId()&&saved?.authorId===citationId()?saved:null;
 const legacy=citationSourceKey(profile.metricsSource)==='legacy';
 const values=Object.fromEntries(citationMetricKeys.map(k=>[k,current?.[k]??(!legacy?profile[k]:null)??null]));
 return {values,date:current?.date||(!legacy?profile.metricsDate:''),source:current?'Scopus':!legacy?profile.metricsSource||'':''};
}
function citationProfilePanel(){
 if(!profile)return;
 const panel=$('content').querySelector('.profile-columns .research-summary')||$('content').querySelector('.profile-columns .metrics-small')?.closest('.panel');
 if(!panel)return;
 const boxes=panel.querySelector('.metrics-small'),note=boxes?.nextElementSibling;
 const {values,date,source}=citationProfileMetrics();
 const title=panel.querySelector('h2');
 if(title)title.textContent=T('学术指标','Research metrics','研究指標');
 title?.insertAdjacentHTML('afterend',`<div class="citation-profile-tools">${citationLinks()}</div>`);
 if(boxes)boxes.innerHTML=citationMetricKeys.map(k=>`<div class="metric-small"><strong>${esc(values[k]??'—')}</strong><span>${esc(citationMetricLabel(k))}</span></div>`).join('');
 if(note)note.textContent=[source,date?txt.updated()+': '+date:''].filter(Boolean).join(' · ');
}
function storeCitationMetrics(data,day){
 const saved=profile.platformMetrics?.scopus,history={...profile.platformMetrics};
 if(!history.local&&citationMetricKeys.some(k=>citationInteger(profile[k]))&&citationSourceKey(profile.metricsSource)!=='scopus'){
  history.local={date:profile.metricsDate||'',source:profile.metricsSource||'',...Object.fromEntries(citationMetricKeys.map(k=>[k,profile[k]??null]))};
 }
 history.scopus={...(saved?.authorId===data.authorId?saved:{}),...data.metrics,authorId:data.authorId,date:day};
 const prior=citationProfileMetrics().values;
 const values=Object.fromEntries(citationMetricKeys.map(k=>[k,data.metrics[k]??prior[k]??null]));
 return {...profile,...values,metricsSource:'Scopus',metricsDate:day,platformMetrics:history};
}
function citationPreview(data,target){
 const prior=citationProfileMetrics();
 const fields=Object.keys(data.metrics);
 const metricChange=fields.some(k=>data.metrics[k]!==prior.values[k])||(fields.length>0&&prior.source!=='Scopus');
 const {matches,unmatched}=findCitationMatches(records,data.documents,target);
 const entries=matches.map(row=>{
  const previous=currentPaperCitation(row.paper),same=previous?.source==='Scopus'&&previous.count===row.document.count;
  return {...row,previous,same};
 });
 const missed=target&&!matches.length;
 const account=accountStore.active;
 const local=T('当前记录','Current record','現在の記録'),remote=T('Scopus 读取值','Scopus result','Scopusの取得値');
 const sameLabel=T('无变化','No change','変更なし');
 modal('citationReview',citationSyncLabel(),`<form id="citationReviewForm" data-keep-actions>
  ${fields.length?`<h3>${T('学术指标','Research metrics','研究指標')}</h3>
  <div class="table-wrap citation-review-table"><table><thead><tr><th>${T('指标','Metric','指標')}</th><th>${local}</th><th>${remote}</th></tr></thead><tbody>${citationMetricKeys.map(k=>`<tr><th scope="row">${esc(citationMetricLabel(k))}</th><td>${esc(prior.values[k]??'—')}</td><td>${esc(data.metrics[k]??'—')}</td></tr>`).join('')}</tbody></table></div>
  ${metricChange?`<label class="option-row"><input type="checkbox" id="citationSaveProfile" checked>${T('更新学术指标','Update research metrics','研究指標を更新する')}</label>`:`<p class="note">${sameLabel}</p>`}`:''}
  ${entries.length?`<h3>${T('匹配的已录用论文','Matched accepted papers','照合できた採択論文')}</h3><div class="table-wrap citation-review-table">
  <table><thead><tr><th>${T('匹配论文','Matched paper','照合論文')}</th><th>${local}</th><th>${remote}</th><th>${T('是否更新','Update?','更新する？')}</th></tr></thead><tbody>
  ${entries.map(({paper,document,match,selected,previous,same},i)=>`<tr><th scope="row">${esc(paper.title)}
  <small>${match==='doi'?'DOI':match==='journal'?T('标题与期刊','Title and journal','論文名と雑誌'):T('按标题匹配','Matched by title','論文名で照合')}</small>
  ${document.title&&citationText(paper.title)!==document.title?`<small>Scopus: ${esc(document.title)}</small>`:''}</th>
  <td>${esc(previous?.count??'—')}${previous?.source?`<small>${esc(previous.source)}</small>`:''}</td><td><strong>${document.count}</strong></td>
  <td>${same?`<small>${sameLabel}</small>`:`<input type="checkbox" value="${i}" data-citation-approve ${selected?'checked':''} aria-label="${esc(T('更新：','Update: ','更新：')+paper.title)}">`}</td></tr>`).join('')}
  </tbody></table></div>`:''}
  <p class="note">${T(`已读取 ${data.documents.length} 篇论文的引用数，匹配 ${matches.length} 篇已录用论文。`,`Read citation counts for ${data.documents.length} papers; matched ${matches.length} accepted papers.`,`${data.documents.length}件の被引用数を取得し、${matches.length}件の採択論文と照合しました。`)}</p>
  ${!data.documents.length?`<p class="note">${data.scanned?T('平台显示有文献，但未显示可读取的逐篇引文。已有引用记录不会改动。','The platform lists papers but is not showing readable per-paper counts. Existing records are unchanged.','論文一覧はありますが、論文ごとの被引用数は表示されていません。既存の記録は変更しません。'):T('请先打开「文献」列表，等每篇旁边的引文数字显示后再试。','Open the publications list and retry once the citation numbers are visible.','文献一覧を開き、件数が表示されてから再試行してください。')}</p>`:''}
  ${missed?`<p class="note">${T('当前页面未找到可确认的这篇论文及引用数。可切换文献分页后重新读取，或手动记录。','This page did not provide a verifiable citation count for this paper. Try another publications page or record it manually.','このページでは論文の被引用数を確認できません。別ページを開くか、手入力してください。')}</p>`:''}
  ${!target&&unmatched?`<p class="note">${unmatched} ${T('条文献未匹配，未加入稿件库。','documents did not match and will not be imported.','件は一致せず、取り込みません。')}</p>`:''}
  ${!metricChange&&!entries.some(row=>!row.same)&&!missed?`<p class="note">${T('当前可核对的数据没有变化。','No verified changes on this page.','確認できる変更はありません。')}</p>`:''}
  <p class="auth-error" id="citationReviewError" role="alert"></p>
  <div class="modal-foot">${btn(txt.cancel(),'type="button" data-close="citationReview"')}${btn(T('确认更新','Confirm updates','確認して更新'),'type="submit" id="citationReviewSave"',true)}</div></form>`);
 const form=$('citationReviewForm'),paperInputs=[...form.querySelectorAll('[data-citation-approve]')],profileInput=$('citationSaveProfile');
 const refresh=()=>{$('citationReviewSave').disabled=!profileInput?.checked&&!paperInputs.some(el=>el.checked)};
 form.onchange=refresh;refresh();
 form.onsubmit=e=>{
  e.preventDefault();
  if(!unlocked||account!==accountStore.active||citationId()!==data.authorId){$('citationReviewError').textContent=citationBadResult();return}
  const day=today(),updates=new Map();
  for(const el of paperInputs.filter(el=>el.checked)){
   const row=entries[Number(el.value)],r=records.find(p=>p.id===row.paper.id);
   if(r!==row.paper){$('citationReviewError').textContent=citationBadResult();return}
   updates.set(r.id,saveCitationObservation(r,row.document.count,day));
  }
  const next=profileInput?.checked?storeCitationMetrics(data,day):profile;
  if(writeAll(records.map(r=>updates.get(r.id)||r),library,next)){
   $('citationReview').close();$('citationEdit')?.close();render();
   if($('detail').open&&target)showDetail(target);
   toast(T('引用数据已保存','Citation data saved','引用データを保存しました'));
  }
 };
}
function receiveCitationReceipt(m){
 const entry=citationPending.get(m.token),payload=cleanCitationResult(m.result);
 if(!entry||entry.expires<Date.now()||!unlocked||entry.account!==accountStore.active||citationId()!==entry.authorId||
    !payload||payload.authorId!==entry.authorId||entry.target&&!records.some(r=>r.id===entry.target&&r.status==='accept'))return false;
 citationPreview(payload,entry.target);citationPending.delete(m.token);return true;
}
document.addEventListener('click',e=>{
 const link=e.target.closest('a[data-citation-lookup]');
 if(link&&unlocked){
  const url=citationLaunch(link.dataset.citationTarget);
  if(url)link.href=url;
 }
});
