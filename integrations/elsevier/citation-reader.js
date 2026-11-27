(() => {
  'use strict';
  if (!['scopus.com','www.scopus.com'].includes(location.hostname) || window.__dearEditorCitationReader) return;
  window.__dearEditorCitationReader = true;
  const prefix = '#de-citation=', store = 'dear-editor.citation-query.v1', TTL = 30*60*1000;
  const text = s => typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
  const lines = el => (el?.innerText ?? el?.textContent ?? '').split(/\r?\n/).map(text).filter(Boolean);
  const content = el => text(el?.innerText ?? el?.textContent);
  const visible = el => el?.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"],#dear-editor-citation-box') &&
    getComputedStyle(el).visibility === 'visible';
  const count = raw => {
    if (!/^(?:\d+|\d{1,3}(?:[,\u202f ]\d{3})+)$/.test(text(raw))) return undefined;
    const n = Number(text(raw).replace(/[,\s]/g, ''));
    return Number.isSafeInteger(n) ? n : undefined;
  };
  const numberAtStart=raw=>count(text(raw).match(/^[0-9]+(?:[, ]\d{3})*(?=\s|$)/)?.[0]);
  const digits = '(\\d+(?:[,\\u202f ]\\d{3})*)';
  const elements = 'div,span,li,p,a,b,strong,dd,dt,label,button,h1,h2,h3,h4,h5,section,[role="heading"]';
  const compact = (scope, limit = 180) => [...scope.querySelectorAll(elements)]
    .filter(el => visible(el) && el.textContent.length < limit*2).map(el => [el,content(el)])
    .filter(([,value]) => value && value.length<=limit);
  const single = values => {
    const set = new Set(values.filter(n => n!==undefined));
    return set.size===1 ? set.values().next().value : undefined;
  };
  function authorRoute() {
    return new URL(location.href).searchParams.get('authorId') ||
      location.pathname.match(/\/pages\/author\/(\d+)/i)?.[1] || '';
  }
  function returnAddress(p) {
    if (!p||typeof p.token!=='string'||!/^[a-z0-9-]{8,100}$/i.test(p.token)||
        typeof p.authorId!=='string'||!/^\d{4,25}$/.test(p.authorId)) return null;
    try {
      const url = new URL(p.back);
      if (url.username||url.password||url.search||url.hash) return null;
      if (url.origin==='https://huaisong-yang.github.io'&&url.pathname==='/dear-editor/' ||
          url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/') return url;
    } catch {}
    return null;
  }
  let pending=null;
  if (location.hash.startsWith(prefix)) {
    try {
      const data=JSON.parse(decodeURIComponent(location.hash.slice(prefix.length)));
      if (returnAddress(data)) {
        pending={...data,at:Date.now()};
        try {sessionStorage.setItem(store,JSON.stringify(pending));} catch {}
        history.replaceState(history.state,'',location.pathname+location.search);
      }
    } catch {}
  } else {
    try {const saved=JSON.parse(sessionStorage.getItem(store));if(returnAddress(saved)&&Date.now()-saved.at<TTL)pending=saved;} catch {}
  }
  if (!pending) return;
  const words = (zh,en,ja) => pending.lang==='en'?en:pending.lang==='ja'?ja:zh;
  function metric(scope, label) {
    const forward=new RegExp(`^${digits}\\s*${label}$`,'i'),reverse=new RegExp(`^${label}\\s*:?\\s*${digits}$`,'i');
    const labelOnly=new RegExp(`^${label}\\s*:?$`,'i');
    const hits=[];
    for (const [el,value] of compact(scope)) {
      const match=value.match(forward)||value.match(reverse);
      if (!match&&!labelOnly.test(value)) continue;
      if (match) hits.push(count(match[1]));
      else {
        const before=el.previousElementSibling,after=el.nextElementSibling;
        // Use a direct sibling only. Never infer zero or borrow from a neighbouring record.
        const previous=visible(before)?count(content(before)):undefined;
        const next=visible(after)?count(content(after)):undefined;
        hits.push(previous!==undefined?previous:next);
      }
    }
    return single(hits);
  }
  function doiOf(row) {
    for (const a of row.querySelectorAll('a[href]')) {
      if (!visible(a)) continue;
      try {
        const url=new URL(a.href);
        const value=decodeURIComponent(url.pathname.slice(1));
        if ((url.hostname==='doi.org'||url.hostname==='dx.doi.org')&&/^10\.\d{4,9}\/\S+$/i.test(value)) return value;
      } catch {}
    }
    return lines(row).map(s=>s.match(/^doi:\s*(10\.\d{4,9}\/\S+)$/i)?.[1]).find(Boolean)||'';
  }
  function readScopus() {
    const name=document.querySelector('[data-testid="author-profile-name"]');
    const box=name?.closest('#author-profile-page-control__general-information-content')||name?.parentElement;
    if (!box||!visible(name)) return null;
    const authorId=content(box.querySelector('[data-testid="authorId"]')).match(/(?:^|\D)(\d{4,25})(?!\d)/)?.[1];
    if (!authorId) return null;
    const readTest=key=>{
      const el=box.querySelector(`[data-testid="${key}"]`);
      return visible(el)?numberAtStart(content(el.querySelector('[data-testid="unclickable-count"],[data-testid="clickable-count"]'))||lines(el)[0]):undefined;
    };
    const metrics={citations:readTest('metrics-section-citations-count'),publications:readTest('metrics-section-document-count'),
      hIndex:readTest('metrics-section-h-index')};
    const documents=[];
    const rows=[...document.querySelectorAll('[data-testid="results-list-item"]')].filter(visible);
    const label='(?:citations?|cited by|引文|引用|被引用|被引次数|被引次數)';
    for (const row of rows) {
      if (!visible(row)) continue;
      const title=row.querySelector('a[href*="/pages/publications/"], a[href*="record/display.uri"]');
      if (!visible(title)) continue;
      const journal=row.querySelector('[data-testid="source-title"]')||row.querySelector('a[href="#"]');
      // Scopus uses different elements for zero and clickable positive counts.
      const citationBoxes=[...row.querySelectorAll('[data-testid="count-label-and-value"]')].filter(el=>
        visible(el)&&new RegExp(`(?:^|\\s)${label}$`,'i').test(content(el)));
      const primary=single(citationBoxes.map(el=>{
        const value=el.querySelector('[data-testid="clickable-count"],[data-testid="unclickable-count"]');
        return visible(value)?numberAtStart(content(value)):numberAtStart(content(el));
      }));
      const n=primary??metric(row,label);
      if(n!==undefined)documents.push({title:content(title),journal:lines(journal)[0]||'',doi:doiOf(row),count:n});
    }
    return {authorId,metrics,documents,scanned:rows.length};
  }
  function makeBox() {
    if(!document.body||document.getElementById('dear-editor-citation-box'))return;
    if(authorRoute()&&authorRoute()!==pending.authorId.toUpperCase())return;
    const box=document.createElement('aside'),button=document.createElement('button'),note=document.createElement('span');
    box.id='dear-editor-citation-box';
    box.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#245c52;color:white;border-radius:12px;padding:10px 14px;font:14px/1.5 system-ui;text-align:center;box-sizing:border-box;max-width:min(550px,90vw);box-shadow:0 4px 20px #0003';
    button.type='button';button.textContent=words('读取数据并返回 ↗','Read data and return ↗','データを読み取って戻る ↗');
    button.style.cssText='font:inherit;font-weight:650;background:white;color:#19483e;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;margin-inline-end:8px';
    note.setAttribute('role','status');note.style.cssText='display:block;margin-top:4px';
    box.append(button,note);document.body.append(box);
    button.onclick=async()=>{
      const back=returnAddress(pending);
      if(!back||Date.now()-pending.at>TTL){note.textContent=words('查询已过期，请重新打开。','Lookup expired. Reopen it.','有効期限が切れました。');return;}
      const result=readScopus();
      if(!result||result.authorId!==pending.authorId){
        note.textContent=words('未能核对作者 ID。请先打开对应的作者主页并完成平台要求的登录。','Author ID could not be verified. Open the matching author profile and sign in if required.','著者IDを確認できません。該当の著者ページを開き、必要な場合はログインしてください。');return;
      }
      result.documents=result.documents.slice(0,250).map(d=>({...d,title:d.title.slice(0,500),journal:d.journal.slice(0,200),doi:d.doi.slice(0,300)}));
      if(!Object.values(result.metrics).some(n=>n!==undefined)&&!result.documents.length){
        note.textContent=words('当前页面未识别到指标或论文引用数。请等文献列表加载后再试。','No metrics or citation counts detected. Wait for the publications list to load and try again.','指標や被引用数を読み取れません。文献一覧が表示されたら再試行してください。');return;
      }
      button.disabled=true;
      let delivery;
      try{delivery=await chrome.runtime.sendMessage({action:'deliver',kind:'citation',token:pending.token,base:back.href,result})}catch{}
      if(delivery?.ok){
        try{sessionStorage.removeItem(store)}catch{}
        note.textContent=delivery.focused===false
          ?words('已送回，请切到原 Dear Editor 标签页核对。','Sent. Switch to the original Dear Editor tab to review.','送信済みです。元のDear Editorタブで確認してください。')
          :words('已送回原 Dear Editor 标签页。','Sent to the original Dear Editor tab.','元のDear Editorタブに送信しました。');
      }else{
        button.disabled=false;
        note.textContent=delivery?.reason==='permission'
          ?words('请在扩展详情允许访问 Dear Editor，再重试。','Allow access to Dear Editor in extension settings and retry.','拡張機能の設定でDear Editorへのアクセスを許可してください。')
          :words('未能送回。请刷新 Dear Editor，再从原网页发起一次查询。','Refresh Dear Editor and start a new query from the original tab.','Dear Editorを再読み込みし、元のタブで新しく照会してください。');
      }
    };
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',makeBox,{once:true});
  else makeBox();
})();
