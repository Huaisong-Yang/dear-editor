'use strict';
// Dear Editor 1.0 - current application bundle; storage migrations retained.

'use strict';
// Storage keys intentionally remain stable across the rename.
const KEY='gaoji.local.v1', PROFILE_KEY='gaoji.profile.v2', AUTHORS_KEY='gaoji.authors.v3', LANG_KEY='gaoji.lang';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
let lang='zh';try{lang=localStorage.getItem(LANG_KEY)||'zh'}catch{}
if(!UI_LOCALES.some(([id])=>id===lang))lang='zh';
const T=(zh,en,ja)=>uiText(lang,zh,en,ja);
const brand=()=>T('投个好稿','Dear Editor','まだ査読中');
const S={
 waiting:['等待投稿','Preparing submission','投稿準備中'],
 we:['编辑处理中 · WE','With Editor · WE','編集者対応中 · WE'],
 ur:['同行评审中 · UR','Under Review · UR','査読中 · UR'],
 rrc:['所需评审已完成 · RRC','Required Reviews Complete · RRC','必要な査読完了 · RRC'],
 major:['大修','Major revision','大幅修正'],
 minor:['小修','Minor revision','軽微な修正'],
 revision:['待返修（类型未注明）','Revision (unspecified)','修正待ち（種別未指定）'],
 accept:['已录用','Accepted','採択'],
 reject:['已拒稿','Rejected','不採択'],
 withdraw:['已撤稿','Withdrawn','取り下げ']
};
let stateName=s=>S[s]?T(...S[s]):s;
const CLOSED=['accept','reject','withdraw'],REVISIONS=['major','minor','revision'];
const PERSON_FIELDS=['name','lastName','firstName','email','phone','institution','department','orcid'];
const dateOK=s=>typeof s==='string'&&(s===''||/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const safeUrl=s=>{try{return ['https:','http:'].includes(new URL(s).protocol)}catch{return false}};
const doiValue=s=>s.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'');
const doiOK=s=>!s||/^10\.\d{4,9}\/\S+$/i.test(s);
const intOK=n=>n===null||n===''||Number.isSafeInteger(Number(n))&&Number(n)>=0;
const emailOK=s=>!s||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const clone=x=>JSON.parse(JSON.stringify(x));
let records=[],profile=null,library=[],page='overview',filter='all',query='',unlocked=false;
let loadError='',editing=null,transfer=null,authorDraft=[],roundDraft=[],detailId=null,editorBaseline='',toastTimer;
let batchOpened=new Set();
function fail(zh,en,ja){throw Error(T(zh,en,ja))}
function migrateState(s,r={}){return ({draft:r.submitted?'we':'waiting',review:'ur'})[s]||s}
function person(a){
 if(!a||typeof a!=='object')fail('作者资料格式错误','Invalid author data','著者情報の形式が不正です');
 const p={...a,id:a.id||uid()};
 for(const k of PERSON_FIELDS){if(a[k]!==undefined&&typeof a[k]!=='string')fail('作者字段格式错误','Invalid author field','著者の項目が不正です');p[k]=a[k]||''}
 if(!p.name.trim())fail('请填写作者姓名','Author name is required','著者名を入力してください');
 if(!emailOK(p.email))fail('作者邮箱格式错误','Invalid author email','著者のメールアドレスが不正です');
 return p;
}
function roundError(r){
 let last='';
 for(const k of ['submitted','we','ur','rrc','decisionDate']){
  if(!dateOK(r[k]??''))return T('审稿节点日期无效','Invalid review-stage date','査読日付が不正です');
  if(r[k]&&last&&r[k]<last)return T('每轮日期应按提交 → WE → UR → RRC → 决定排列','Dates within a round must follow submission → WE → UR → RRC → decision','各ラウンドの日付順：提出 → WE → UR → RRC → 判定');
  if(r[k])last=r[k];
 }
 for(const k of ['invited','agreed','completed'])if(!intOK(r[k]))return T('评审数量必须是非负整数或留空','Review counts must be nonnegative integers or blank','査読件数は0以上の整数または空欄にしてください');
 if(r.invited!==null&&r.agreed!==null&&r.agreed>r.invited||r.agreed!==null&&r.completed!==null&&r.completed>r.agreed)return T('完成数不能大于接受数，接受数不能大于邀请数','Completed ≤ accepted invitations ≤ invitations sent','完了数 ≤ 承諾数 ≤ 招待数にしてください');
 return '';
}
function emptyRound(index){return {id:uid(),index,submitted:'',we:'',ur:'',rrc:'',decisionDate:'',decision:'',invited:null,agreed:null,completed:null}}
function migrate(data){
 if(!Array.isArray(data)||data.length>10000)fail('投稿备份格式错误','Invalid submissions backup','投稿バックアップの形式が不正です');
 const ids=new Set();
 return data.map(raw=>{
  if(!raw||typeof raw.id!=='string'||!raw.id||ids.has(raw.id))fail('投稿标识重复或无效','Invalid or duplicate submission ID','投稿IDが無効または重複しています');
  ids.add(raw.id);const r={...raw};
  for(const k of ['title','journal','submitted','number','notes','created','updated'])if(typeof r[k]!=='string')fail('投稿字段缺失','Missing submission field','投稿項目が不足しています');
  if(!r.title.trim())fail('论文标题不能为空','A paper title is required','論文名は必須です');
  r.status=migrateState(r.status,r);if(!S[r.status])fail('投稿状态无效','Invalid submission status','投稿状況が不正です');
  for(const k of ['submitted','created','updated','accepted'])if(!dateOK(r[k]||''))fail('投稿日期无效','Invalid submission date','投稿日が不正です');
  r.paperId=r.paperId||r.id;r.doi=r.doi||'';
  if(!doiOK(r.doi))fail('DOI 格式错误','Invalid DOI','DOIの形式が不正です');
  if(!Array.isArray(r.history))fail('时间线格式错误','Invalid history','履歴の形式が不正です');
  r.history=r.history.map(h=>{if(!h||typeof h.text!=='string'||!dateOK(h.date)||!h.date)fail('时间线字段错误','Invalid history entry','履歴項目が不正です');return {...h}});
  r.authors=(r.authors||[]).map(a=>({...person(a),first:!!a.first,corresponding:!!a.corresponding}));
  if(!Array.isArray(r.rounds)){
   r.rounds=[];
   if(r.submitted||r.firstReview||r.secondReview||r.accepted||r.status!=='waiting'){
    const one={...emptyRound(1),submitted:r.submitted||'',legacyEnd:r.firstReview||'',legacy:true};
    r.rounds.push(one);
    if(r.secondReview)r.rounds.push({...emptyRound(2),legacyEnd:r.secondReview,legacy:true});
    // Old "review ended" dates are not relabeled as RRC: the original meaning is ambiguous.
   }
  }
  if(r.rounds.length>100)fail('审稿轮次过多','Too many review rounds','査読ラウンド数が多すぎます');
  r.rounds=r.rounds.map((q,i)=>{
   const x={...emptyRound(i+1),...q,index:i+1};
   for(const k of ['invited','agreed','completed'])x[k]=x[k]===null||x[k]===''?null:Number(x[k]);
   const error=roundError(x);if(error)throw Error(error);
   if(x.decision&&!S[x.decision])fail('审稿决定无效','Invalid decision','判定が不正です');
   return x;
  });
  for(let i=1;i<r.rounds.length;i++){
   if(r.rounds[i].submitted&&r.rounds[i-1].decisionDate&&r.rounds[i].submitted<r.rounds[i-1].decisionDate)fail('新一轮提交不能早于上一轮决定','A new round cannot start before the previous decision','新しいラウンドの提出日は前回の判定日以降にしてください');
  }
  r.citations=r.citations??null;if(!intOK(r.citations))fail('引用次数无效','Invalid citation count','引用数が不正です');
  r.citationSource=r.citationSource||'';r.citationDate=r.citationDate||'';
  if(!dateOK(r.citationDate))fail('引用更新日期无效','Invalid citation date','引用更新日が不正です');
  r.systemUrl=r.systemUrl||'';if(r.systemUrl&&!safeUrl(r.systemUrl))fail('投稿系统链接无效','Invalid submission-system URL','投稿システムURLが不正です');
  return r;
 });
}
function validProfile(p){
 if(!p||typeof p!=='object')fail('账号资料无效','Invalid account data','アカウント情報が不正です');
 for(const k of ['name','username','role','degree','salt','hash'])if(typeof p[k]!=='string')fail('账号字段缺失','Missing account field','アカウント項目が不足しています');
 if(!p.name.trim()||!p.username.trim()||!/^[a-f0-9]{32}$/.test(p.salt)||!/^[a-f0-9]{64}$/.test(p.hash))fail('账号信息格式错误','Invalid account fields','アカウント項目が不正です');
 if(!emailOK(p.email||''))fail('邮箱格式错误','Invalid email address','メールアドレスが不正です');
 for(const k of ['citations','hIndex','publications','citingArticles','withoutSelf'])if(!intOK(p[k]??null))fail('学术指标应为非负整数','Metrics must be nonnegative integers','指標は0以上の整数にしてください');
 if(!dateOK(p.metricsDate||''))fail('指标更新日期无效','Invalid metrics date','指標更新日が不正です');
 return {...p};
}
function personKey(p){return p.email?'email:'+p.email.toLowerCase():['name',p.name,p.lastName,p.firstName,p.institution].map(x=>String(x||'').trim().toLowerCase()).join('|')}
function mergePeople(base,people){
 const out=base.map(p=>({...p}));
 people.forEach(raw=>{const p=person(raw);let i=out.findIndex(x=>x.id===p.id||personKey(x)===personKey(p));if(i<0)out.push(p);else out[i]={...out[i],...p,id:out[i].id}});
 return out;
}
try{
 const raw=localStorage.getItem(KEY);records=migrate(raw?JSON.parse(raw):[]);
 const p=localStorage.getItem(PROFILE_KEY);if(p)profile=validProfile(JSON.parse(p));
 const authorsRaw=localStorage.getItem(AUTHORS_KEY),authors=JSON.parse(authorsRaw||'[]');if(!Array.isArray(authors))throw Error('Invalid author library');
 library=authorsRaw===null?mergePeople([],records.flatMap(r=>r.authors)):authors.map(person);
}catch(e){loadError=e.message}
function snapshot(){
 if(!localStorage.getItem('gaoji.before-v3'))localStorage.setItem('gaoji.before-v3',JSON.stringify({app:'gaoji',version:3,rawRecords:localStorage.getItem(KEY),rawProfile:localStorage.getItem(PROFILE_KEY),rawAuthors:localStorage.getItem(AUTHORS_KEY),at:new Date().toISOString()}));
}
function writeAll(nextRecords=records,nextLibrary=library,nextProfile=profile,{recover=false}={}){
 if(loadError&&!recover){alert(T('数据读取异常，已阻止覆盖。请先导出原始存储，再恢复备份。','Data could not be read. Export raw storage before restoring a backup.','読込エラーのため上書きできません。元データを書き出してから復元してください。'));return false}
 let previous;
 try{
  const checked=migrate(nextRecords),people=nextLibrary.map(person),p=nextProfile?validProfile(nextProfile):null;
  previous=[KEY,AUTHORS_KEY,PROFILE_KEY].map(k=>[k,localStorage.getItem(k)]);snapshot();
  localStorage.setItem(AUTHORS_KEY,JSON.stringify(people));
  if(p)localStorage.setItem(PROFILE_KEY,JSON.stringify(p));else localStorage.removeItem(PROFILE_KEY);
  localStorage.setItem(KEY,JSON.stringify(checked));
  records=checked;library=people;profile=p;loadError='';return true;
 }catch(e){
  if(previous)try{for(const [k,v] of previous){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}}catch{}
  alert(T('保存失败：','Save failed: ','保存失敗：')+e.message);return false;
 }
}
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3500)}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const btn=(text,attrs='',primary=false)=>`<button class="btn ${primary?'primary':''}" ${attrs}>${text}</button>`;
const field=(id,label,value='',type='text',attrs='')=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" ${type==='number'?'min="0" step="1"':''} type="${type}" value="${esc(value)}" ${attrs}></div>`;
function select(id,label,options,value='',attrs=''){return `<div class="field"><label for="${id}">${label}</label><select id="${id}" ${attrs}>${options.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></div>`}
function statusOptions(){return Object.keys(S).map(s=>[s,stateName(s)])}
const txt={
 title:()=>T('论文标题','Paper title','論文タイトル'),
 journal:()=>T('期刊','Journal','ジャーナル'),
 submitted:()=>T('首次投稿日期','Initial submission date','初回投稿日'),
 accepted:()=>T('录用日期','Acceptance date','採択日'),
 number:()=>T('稿件编号','Manuscript number','原稿番号'),
 save:()=>T('保存','Save','保存'),
 cancel:()=>T('取消','Cancel','キャンセル'),
 edit:()=>T('编辑','Edit','編集'),
 close:()=>T('关闭','Close','閉じる'),
 name:()=>T('姓名','Name','氏名'),
 email:()=>T('邮箱','Email','メール'),
 phone:()=>T('电话','Phone','電話'),
 institution:()=>T('学校 / 机构','Institution','大学・所属機関'),
 department:()=>T('院系 / 部门','Department','学部・部署'),
 lastName:()=>T('英文姓 · Last Name','Last name (as registered)','姓（投稿登録名）'),
 firstName:()=>T('英文名 · First Name','First name (as registered)','名（投稿登録名）'),
 orcid:()=> 'ORCID',
 citations:()=>T('引用次数','Citations','被引用数'),
 source:()=>T('数据来源','Data source','データソース'),
 updated:()=>T('更新日期','Updated on','更新日'),
 unknown:()=>T('未填写','Not recorded','未入力'),
 authors:()=>T('作者库','Author library','著者ライブラリ'),
 round:()=>T('轮次','Round','ラウンド'),
 remove:()=>T('删除','Delete','削除')
};
document.querySelectorAll('dialog').forEach(d=>d.remove());
for(const id of ['editor','detail','people','batch','authorEdit']){
 const d=document.createElement('dialog');d.id=id;
 d.innerHTML=`<div class="modal-head"><h2 id="${id}Heading"></h2><button type="button" class="close" data-close="${id}" aria-label="Close">×</button></div><div class="modal-body" id="${id}Body"></div>`;
 document.body.append(d);
 d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(id)});
 d.addEventListener('cancel',e=>{e.preventDefault();closeDialog(id)});
}
function closeDialog(id){
 if(id==='editor'&&editorBaseline&&editorFingerprint()!==editorBaseline&&!confirm(T('放弃尚未保存的修改？','Discard unsaved changes?','未保存の変更を破棄しますか？')))return;
 $(id).close();
}
function editorFingerprint(){const f=$('paperForm');return f?JSON.stringify([...f.querySelectorAll('input,select,textarea')].map(e=>[e.id,e.type==='checkbox'?e.checked:e.value])):''}
function modal(id,title,html){$(id+'Heading').textContent=title;$(id+'Body').innerHTML=html;if(!$(id).open)$(id).showModal()}
function languages(){return `<label class="language-globe" title="Language / 语言 / 言語"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></svg><select aria-label="Language / 语言 / 言語" data-language>${UI_LOCALES.map(([id,name])=>`<option value="${id}" ${lang===id?'selected':''}>${name}</option>`).join('')}</select></label>`}
function wish(){
 if(profile?.wish)return profile.wish;
 if(funWelcome(lang))return funWelcome(lang);
 if(profile?.role==='student')return T('愿实验顺利、论文录用，早日毕业！','May your experiments succeed, papers be accepted, and graduation come soon!','実験も論文も順調に。採択と卒業を応援しています！');
 if(profile?.role==='teacher')return T('愿青基立项、职称晋升，向教授与院士的梦想前行！','May your grants succeed and your academic career flourish!','研究費の採択と昇進を願って。研究の夢に向かって進みましょう！');
 return T('愿每一份探索都有回响，每一次投稿都有好消息。','May every discovery find its audience, and every submission bring good news.','すべての探究に手応えを、すべての投稿によい知らせを。');
}
function identityLinks(){
 if(!profile)return '';
 return '<div class="profile-links">'+[
  profile.orcid&&['ORCID',`https://orcid.org/${encodeURIComponent(profile.orcid)}`],
  profile.wos&&['Web of Science',`https://www.webofscience.com/wos/author/record/${encodeURIComponent(profile.wos)}`],
  profile.scopus&&['Scopus',`https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(profile.scopus)}`],
  profile.website&&safeUrl(profile.website)&&[T('个人网站','Website','ウェブサイト'),profile.website]
 ].filter(Boolean).map(([name,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${name} ↗</a>`).join('')+'</div>';
}
function renderShell(){
 document.documentElement.lang=lang==='zh'?'zh-CN':lang;document.title=brand();
 document.querySelector('aside').innerHTML=`<div class="brand"><span>✦</span>${esc(brand())}</div><div class="tagline">${T('从已提交，到已接收','FROM SUBMISSION TO ACCEPTANCE','投稿から採択まで')}</div>${languages()}${[
 ['overview',T('投稿总览','Submissions','投稿一覧')],['stats',T('数据统计','Statistics','統計')],['authors',txt.authors()],['profile',T('个人学术主页','Research profile','研究者プロフィール')],['backup',T('备份与设置','Backup & settings','バックアップ・設定')]
 ].map(([v,t])=>`<button class="nav ${page===v?'active':''}" data-page="${v}">${t}</button>`).join('')}<a class="nav feedback" href="mailto:yanghuaisong@hrbeu.edu.cn?subject=Accept%20Me!%20Feedback">${T('反馈与建议','Send feedback','ご意見・ご要望')} ↗</a><button class="nav" data-logout>${T('退出登录','Log out','ログアウト')}</button><div class="aside-bottom"><div class="local"><i class="dot"></i>${T('本地工作空间','Local workspace','ローカルワークスペース')}</div>${T('请定期导出备份','Export backups regularly','定期的にバックアップを')}<br>LOCAL EDITION 3.0</div>`;
 const titles={overview:T('投稿总览','Submissions','投稿一覧'),stats:T('数据统计','Statistics','統計'),authors:txt.authors(),profile:T('个人学术主页','Research profile','研究者プロフィール'),backup:T('备份与设置','Backup & settings','バックアップ・設定')};
 $('pageTitle').textContent=titles[page];$('pageSubtitle').textContent=T('记录每一次投稿，也记录每一次成长。','Track each submission and every step forward.','投稿も成長も、一歩ずつ記録。');
 const top=document.querySelector('.top');top.querySelector('.top-actions')?.remove();$('newButton')?.remove();
 top.insertAdjacentHTML('beforeend',`<div class="actions top-actions">${btn(T('一键查询','Query all active','進行中を一括照会'),'data-batch')}${btn('＋ '+T('新建投稿','New submission','新規投稿'),'data-new',true)}</div>`);
 $('storageWarning').classList.toggle('hidden',!loadError);$('storageWarning').textContent=loadError?T('原数据读取失败，已阻止覆盖：','Data could not be read; overwriting is blocked: ','読込エラー。上書きを停止しました：')+loadError:'';
}
function metrics(){
 const items=[
 [T('记录论文','Papers','論文数'),new Set(records.map(r=>r.paperId)).size,T('累计投稿','Submission attempts','投稿回数')+': '+records.length,'blue'],
 [T('进行中的投稿','Active submissions','進行中'),records.filter(r=>!CLOSED.includes(r.status)&&r.status!=='waiting').length,T('每一步进展，值得记录','Every step counts','一歩ずつ記録を'),'purple'],
 [T('等待返修','Revisions due','修正待ち'),records.filter(r=>REVISIONS.includes(r.status)).length,T('记录每轮审稿与返修','Track every review round','各ラウンドを記録'),'amber'],
 [T('已录用','Accepted','採択済み'),records.filter(r=>r.status==='accept').length,T('每一次接收，都是里程碑','Every acceptance is a milestone','採択は大切な節目'),'green']
 ];
 return `<div class="metrics">${items.map(([label,n,note,color])=>`<div class="metric ${color}"><div class="metric-label">${label}</div><div class="metric-number">${n}</div><div class="metric-note">${note}</div></div>`).join('')}</div>`;
}
function badge(r){return `<span class="badge ${r.status}">${esc(stateName(r.status))}</span>`}
function counts(r){
 const q=r.rounds.at(-1);if(!q||!['ur','rrc'].includes(r.status))return '';
 return `<div class="review-counts">${[[T('邀请','Invited','招待'),q.invited],[T('接受','Agreed','承諾'),q.agreed],[T('完成','Completed','完了'),q.completed]].map(([l,n])=>`<span>${l} <b>${n??'—'}</b></span>`).join('')}<small>${txt.round()} ${q.index}</small></div>`;
}
function authorsText(r){return r.authors.map(a=>`${esc(a.name)}${a.first?' ¹':''}${a.corresponding?' ✉':''}`).join(' · ')}
function card(r){
 return `<article class="card state-${r.status}"><div class="card-top"><span class="journal">${esc(r.journal)||T('期刊待定','Journal TBD','投稿先未定')}</span>${badge(r)}</div><div class="paper-title">${esc(r.title)}</div><div class="author-list">${authorsText(r)}</div>${counts(r)}<div class="meta"><span>${txt.submitted()}: ${esc(r.submitted)||'—'}</span>${r.citations!==null?`<span>${txt.citations()}: ${r.citations} ${esc(r.citationSource)}</span>`:''}</div><div class="card-bottom"><span class="deadline">${txt.updated()}: ${esc(r.updated)}</span><button class="linkbtn" data-detail="${esc(r.id)}">${T('查看详情','View details','詳細')} ↗</button></div></article>`;
}
function renderCards(){
 const q=query.trim().toLowerCase();
 const list=records.filter(r=>(filter==='all'||filter==='closed'&&CLOSED.includes(r.status)||filter==='revisions'&&REVISIONS.includes(r.status)||r.status===filter)&&(!q||[r.title,r.journal,r.number,r.doi,...r.authors.map(a=>a.name)].some(v=>v.toLowerCase().includes(q))));
 list.sort((a,b)=>Number(REVISIONS.includes(b.status))-Number(REVISIONS.includes(a.status))||b.submitted.localeCompare(a.submitted)||b.created.localeCompare(a.created));
 $('count').textContent=`${list.length} ${T('条记录','records','件')}`;
 $('cards').innerHTML=list.map(card).join('')||`<div class="empty"><h2>${T('这里还没有投稿记录','No matching submissions','該当する投稿はありません')}</h2><p>${T('新建投稿，或调整搜索与筛选条件。','Add a submission or adjust your filters.','投稿を追加するか、検索条件を変更してください。')}</p></div>`;
}
function renderOverview(){
 $('content').innerHTML=`<div class="welcome"><div><div class="eyebrow">WELCOME BACK</div><h2>${profile?T('欢迎回来，','Welcome back, ','おかえりなさい、')+esc(profile.name):esc(brand())}!</h2><p>${esc(wish())}</p>${identityLinks()}</div><div class="welcome-mark">✦</div></div>${metrics()}<div class="section-heading"><h2>${T('我的投稿','My submissions','自分の投稿')}</h2><span id="count" class="journal"></span></div><div class="toolbar"><div class="filters">${[['all',T('全部','All','すべて')],['waiting',T('等待投稿','Preparing','準備中')],['we','WE'],['ur','UR'],['rrc','RRC'],['revisions',T('返修','Revisions','修正')],['closed',T('已结束','Closed','終了')]].map(([s,n])=>`<button class="filter ${filter===s?'active':''}" data-filter="${s}">${n}</button>`).join('')}</div><input class="search" id="search" value="${esc(query)}" placeholder="${T('搜索论文、期刊、作者、DOI…','Search papers, journals, authors, DOI…','論文・雑誌・著者・DOIを検索…')}" aria-label="Search"></div><div class="cards" id="cards"></div><div class="footnote">${T('进行中优先 · 按最近更新排序 · ¹ 第一作者 / 共同一作 · ✉ 通讯作者','Active first · Most recently updated · ¹ First/co-first author · ✉ Corresponding author','進行中を優先・更新順 · ¹ 第一／共同第一著者 · ✉ 責任著者')}</div>`;
 renderCards();$('search').oninput=e=>{query=e.target.value;renderCards()};
}
function render(){renderShell();({overview:renderOverview,stats:renderStats,authors:renderAuthors,profile:renderProfile,backup:renderBackup,journals:renderJournals,feedback:renderFeedback}[page]||renderOverview)()}
function paperFields(r){
 return `<div class="form-grid">${field('title',txt.title()+' *',r.title,'text','required maxlength="500"')}${field('journal',txt.journal(),r.journal,'text','list="journals" maxlength="200"')}<datalist id="journals">${[...new Set(records.map(r=>r.journal).filter(Boolean))].map(j=>`<option value="${esc(j)}"></option>`).join('')}<option>Ocean Engineering</option><option>Marine Structures</option></datalist>${select('status',T('当前状态','Current status','現在の状況'),statusOptions(),r.status||'waiting')}${field('stageDate',T('本次状态日期','Status effective date','今回の状態の日付'),today(),'date','required')}${field('submitted',txt.submitted(),r.submitted,'date')}${field('accepted',txt.accepted(),r.accepted,'date')}${field('number',txt.number(),r.number)}${field('doi','DOI',r.doi)}${field('systemUrl',T('投稿 / 审稿系统链接','Editorial system URL','投稿・査読システムURL'),r.systemUrl,'url')}${field('citations',txt.citations(),r.citations,'number')}${field('citationSource',txt.source(),r.citationSource,'text','list="citationSources"')}${field('citationDate',txt.updated(),r.citationDate,'date')}<datalist id="citationSources"><option>Web of Science</option><option>Scopus</option><option>OpenAlex</option><option>Google Scholar</option></datalist></div><p class="help">${T('等待投稿允许期刊留空。WE 表示编辑处理中，返修用大修 / 小修记录。引用数据手动记录，请注明来源与日期。','The journal may be blank while preparing. WE means With Editor; revisions have separate statuses. Citation metrics are manual and should include a source and date.','投稿準備中は雑誌を空欄にできます。WEは編集者対応中です。修正は別状態で記録します。引用指標は出典・日付とともに手入力します。')}</p>`;
}
function openEditor(id=null,source=null){
 editing=id;transfer=source;const old=records.find(r=>r.id===id);let r=clone(old||source||{});
 if(source){r={...r,journal:'',status:'waiting',submitted:'',accepted:'',number:'',doi:'',rounds:[],systemUrl:''}}
 authorDraft=(r.authors||[]).map(a=>({...a}));roundDraft=clone(r.rounds||[]);
 modal('editor',old?T('编辑投稿','Edit submission','投稿を編集'):T('新建投稿','New submission','新規投稿'),`<form id="paperForm">${paperFields(r)}<section class="editor-section"><h2>${T('作者与署名顺序','Authors & order','著者と掲載順')}</h2><div class="actions">${btn(T('从作者库选择','Choose from library','ライブラリから選択'),'type="button" data-pick-authors')}${btn(T('添加本人','Add myself','自分を追加'),'type="button" data-add-self')}${btn('＋ '+T('新作者','New author','新しい著者'),'type="button" data-add-author')}</div><div id="authorRows"></div></section><section class="editor-section"><div class="section-heading"><h2>${T('审稿轮次 · 不限一审二审','Review rounds · unlimited stages','査読ラウンド・回数制限なし')}</h2>${btn('＋ '+T('返修后新一轮','New resubmission round','再投稿ラウンドを追加'),'type="button" data-add-round')}</div><p class="help">${T('每次返修后重新提交，请新增一轮。数量留空表示未知，0 表示确认没有。RRC 需按系统显示手动记录，不根据数量自动判断。','Add a round for each resubmission. Blank counts mean unknown; zero means none. Record RRC only when the journal reports it, not from counts alone.','修正後の再投稿ごとに追加してください。空欄は不明、0は該当なしです。RRCは件数で推測せず、システムの表示を記録します。')}</p><div id="roundRows"></div></section><div class="field"><label for="notes">${T('备注','Notes','メモ')}</label><textarea id="notes" maxlength="10000">${esc(r.notes)}</textarea></div><div class="modal-foot">${btn(txt.cancel(),'type="button" data-close="editor"')}${btn(txt.save(),'type="submit"',true)}</div></form>`);
 drawAuthors();drawRounds();$('paperForm').onsubmit=savePaper;
 $('status').onchange=()=>{$('journal').required=$('status').value!=='waiting'};
 $('status').onchange();editorBaseline=editorFingerprint();
}
function drawAuthors(){
 $('authorRows').innerHTML=authorDraft.map((a,i)=>`<div class="author-row" data-author-index="${i}"><div class="author-heading"><b>${i+1}</b><label><input type="checkbox" data-key="first" ${a.first?'checked':''}>${T('第一 / 共同第一作者','First / co-first author','第一／共同第一著者')}</label><label><input type="checkbox" data-key="corresponding" ${a.corresponding?'checked':''}>${T('通讯作者','Corresponding author','責任著者')}</label><div class="actions">${btn('↑',`type="button" data-author-up="${i}" ${i===0?'disabled':''}`)}${btn('↓',`type="button" data-author-down="${i}" ${i===authorDraft.length-1?'disabled':''}`)}${btn('×',`type="button" data-author-remove="${i}" aria-label="${txt.remove()}"`)}</div></div><div class="form-grid">${['name','lastName','firstName','email','institution','department'].map(k=>field(`author-${i}-${k}`,txt[k](),a[k],k==='email'?'email':'text',`data-key="${k}" ${k==='name'?'required':''}`)).join('')}</div></div>`).join('');
}
function readAuthors(){return [...$('authorRows').querySelectorAll('[data-author-index]')].map(row=>{const a={...authorDraft[Number(row.dataset.authorIndex)]};row.querySelectorAll('[data-key]').forEach(e=>a[e.dataset.key]=e.type==='checkbox'?e.checked:e.value.trim());return a})}
const ROUND_LABELS={
 submitted:()=>T('本轮提交','Round submitted','この回の投稿日'),we:()=> 'With Editor',ur:()=> 'Under Review',rrc:()=> 'Required Reviews Complete',
 decisionDate:()=>T('决定日期','Decision date','判定日'),invited:()=>T('发出邀请数','Invitations sent','招待数'),agreed:()=>T('接受邀请数','Invitations accepted','招待承諾数'),completed:()=>T('完成评审数','Reviews completed','査読完了数')
};
function drawRounds(){
 $('roundRows').innerHTML=roundDraft.map((r,i)=>`<div class="round-row" data-round-index="${i}"><div class="section-heading"><h3>${txt.round()} ${i+1}</h3>${btn(txt.remove(),`type="button" data-round-remove="${i}"`)}</div>${r.legacyEnd?`<p class="help">${T('旧版审稿结束日期（保留原义）','Legacy review-end date (original meaning retained)','旧版の査読終了日（元の意味を保持）')}: ${esc(r.legacyEnd)}</p>`:''}<div class="form-grid">${['submitted','we','ur','rrc','decisionDate'].map(k=>field(`round-${i}-${k}`,ROUND_LABELS[k](),r[k],'date',`data-key="${k}"`)).join('')}${select(`round-${i}-decision`,T('本轮决定','Round decision','この回の判定'),[['','—'],...['major','minor','revision','accept','reject','withdraw'].map(s=>[s,stateName(s)])],r.decision,`data-key="decision"`)}${['invited','agreed','completed'].map(k=>field(`round-${i}-${k}`,ROUND_LABELS[k](),r[k],'number',`data-key="${k}"`)).join('')}</div></div>`).join('')||`<p class="help">${T('尚无审稿轮次，首次提交时自动建立。','No review rounds yet. The first is created on submission.','まだラウンドはありません。初回投稿時に作成されます。')}</p>`;
}
function readRounds(){return [...$('roundRows').querySelectorAll('[data-round-index]')].map((row,i)=>{const r={...roundDraft[Number(row.dataset.roundIndex)],index:i+1};row.querySelectorAll('[data-key]').forEach(e=>r[e.dataset.key]=e.type==='number'?(e.value===''?null:Number(e.value)):e.value);return r})}
function savePaper(e){
 e.preventDefault();
 try{
  const old=records.find(r=>r.id===editing),data={};
  for(const k of ['title','journal','status','submitted','accepted','number','doi','notes','systemUrl','citationSource','citationDate'])data[k]=$(k).value.trim();
  data.doi=doiValue(data.doi);data.citations=$('citations').value===''?null:Number($('citations').value);
  if(!data.title||data.status!=='waiting'&&!data.journal)fail('请填写标题和期刊','Please fill in the title and journal','タイトルと雑誌を入力してください');
  if(data.accepted&&data.status!=='accept')fail('已填写录用日期，请选择已录用状态','An acceptance date requires Accepted status','採択日を入力した場合は採択を選択してください');
  if(data.accepted&&data.submitted&&data.accepted<data.submitted)fail('录用日期不能早于投稿日期','Acceptance cannot precede submission','採択日は投稿日以降にしてください');
  data.authors=readAuthors().map(person);data.rounds=readRounds();
  const date=$('stageDate').value;if(!dateOK(date)||!date)fail('状态日期无效','Invalid status date','状態日付が不正です');
  const changed=!old||old.status!==data.status;
  if(data.status!=='waiting'&&!data.rounds.length)data.rounds.push({...emptyRound(1),submitted:data.submitted});
  const q=data.rounds.at(-1);
  if(q&&changed){
   if(['we','ur','rrc'].includes(data.status)&&!q[data.status])q[data.status]=date;
   if([...REVISIONS,...CLOSED].includes(data.status)){q.decision=data.status;if(!q.decisionDate)q.decisionDate=date}
   if(data.status==='accept'&&!data.accepted)data.accepted=date;
  }
  if(q&&old&&REVISIONS.includes(old.status)&&['we','ur','rrc'].includes(data.status)&&data.rounds.length<=old.rounds.length)fail('返修后重新提交，请先新增一轮审稿','Add a new round before resubmitting a revision','修正後の再投稿には新しいラウンドを追加してください');
  const result={deadline:'',url:'',firstReview:'',secondReview:'',...old,...data,id:old?.id||uid(),paperId:old?.paperId||transfer?.paperId||uid(),created:old?.created||today(),updated:today(),history:[...(old?.history||[]),{date,status:data.status,text:'',kind:changed?'status':'edit',round:q?.index||0,from:old?.status||'',at:new Date().toISOString()}]};
  const next=old?records.map(r=>r.id===old.id?result:r):[...records,result];
  const checked=migrate(next),people=mergePeople(library,data.authors);
  if(writeAll(checked,people)){editorBaseline='';$('editor').close();render();toast(T('投稿与作者资料已保存','Submission and authors saved','投稿と著者情報を保存しました'))}
 }catch(err){alert(err.message)}
}
function editorSystem(r){
 if(r.systemUrl&&safeUrl(r.systemUrl))return r.systemUrl;
 if(/^(ocean engineering|oe)$/i.test(r.journal.trim()))return 'https://www.editorialmanager.com/oe/default.aspx';
 if(/^(marine structures|ms)$/i.test(r.journal.trim()))return 'https://www.editorialmanager.com/mastr/Default.aspx';
 return '';
}
function eventText(h){
 if(h.kind==='status')return esc(`${h.from?stateName(migrateState(h.from))+' → ':''}${stateName(migrateState(h.status))}`);
 if(h.kind==='edit')return T('更新投稿信息','Submission updated','投稿情報を更新');
 return esc(h.text); // User-written and legacy text is preserved, never translated.
}
function showDetail(id){
 const r=records.find(r=>r.id===id);if(!r)return;detailId=id;
 const system=editorSystem(r),related=records.filter(x=>x.paperId===r.paperId&&x.id!==r.id);
 modal('detail',T('投稿详情','Submission details','投稿詳細'),`${badge(r)}<h2 class="detail-title">${esc(r.title)}</h2><p>${esc(r.journal)||T('期刊待定','Journal TBD','投稿先未定')}</p><div class="detail-meta">${[['submitted',txt.submitted()],['accepted',txt.accepted()],['number',txt.number()],['updated',txt.updated()]].map(([k,n])=>`<div><small>${n}</small>${esc(r[k])||'—'}</div>`).join('')}</div><h2>${T('作者与署名','Authors','著者')}</h2><div class="author-list">${authorsText(r)||'—'}</div><p class="help">${T('¹ 第一 / 共同第一作者 · ✉ 通讯作者','¹ First / co-first · ✉ Corresponding','¹ 第一／共同第一著者 · ✉ 責任著者')}</p>${r.doi?`<p>DOI: <a href="https://doi.org/${esc(encodeURI(r.doi))}" target="_blank" rel="noopener noreferrer">${esc(r.doi)}</a></p>`:''}<p>${txt.citations()}: ${r.citations??'—'} · ${esc(r.citationSource)||txt.unknown()} · ${esc(r.citationDate)||'—'}</p><div class="actions detail-actions">${btn(txt.edit(),`data-edit="${esc(r.id)}"`,true)}${['reject','withdraw'].includes(r.status)?btn(T('转投','Transfer to another journal','別誌に投稿'),`data-transfer="${esc(r.id)}"`):''}${btn(txt.remove(),`data-delete="${esc(r.id)}"`)}${system?`<a class="btn" href="${esc(system)}" target="_blank" rel="noopener noreferrer">${T('投稿 / 审稿系统','Editorial system','投稿・査読システム')} ↗</a>`:''}</div><section class="panel"><h2>${T('审稿轮次','Review rounds','査読ラウンド')}</h2>${roundsTable(r)}</section><div id="querySection"></div><div class="panel notes">${esc(r.notes)||T('暂无备注','No notes','メモなし')}</div>${related.length?`<section class="panel"><h2>${T('同一论文的其他投稿','Other attempts for this paper','同一論文の他の投稿')}</h2>${related.map(x=>`<button class="linkbtn" data-detail="${esc(x.id)}">${esc(x.journal)} · ${stateName(x.status)} ↗</button>`).join('<br>')}</section>`:''}<h2>${T('进展时间线','Timeline','タイムライン')}</h2><div class="timeline">${[...r.history].reverse().map(h=>`<div class="event"><time>${esc(h.date)}${h.round?' · '+txt.round()+' '+h.round:''}</time><div>${eventText(h)}</div></div>`).join('')}</div>`);
 renderQuery(r);
}
function roundsTable(r){return `<div class="table-wrap"><table><thead><tr>${[txt.round(),T('提交','Submitted','提出'),'WE','UR','RRC',T('决定','Decision','判定'),T('邀请 / 接受 / 完成','Invited / agreed / completed','招待 / 承諾 / 完了')].map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${r.rounds.map(q=>`<tr><td>${q.index}</td>${['submitted','we','ur','rrc'].map(k=>`<td class="nowrap">${esc(q[k])||'—'}</td>`).join('')}<td>${q.decision?stateName(q.decision):'—'}<small>${esc(q.decisionDate)}</small>${q.legacyEnd?`<small>${T('旧版结束日期','Legacy end','旧版終了日')}: ${esc(q.legacyEnd)}</small>`:''}</td><td>${q.invited??'—'} / ${q.agreed??'—'} / ${q.completed??'—'}</td></tr>`).join('')||`<tr><td colspan="7">${T('暂无轮次','No rounds yet','ラウンドなし')}</td></tr>`}</tbody></table></div>`}
function ownPerson(){
 if(!profile)return null;
 return {...Object.fromEntries(PERSON_FIELDS.map(k=>[k,profile[k]||''])),id:'self:'+profile.username};
}
function availablePeople(){return profile?mergePeople(library,[ownPerson()]):library}
function addPersonToPaper(p){
 authorDraft=readAuthors();
 if(authorDraft.some(a=>a.id===p.id||personKey(a)===personKey(p))){toast(T('该作者已在当前论文中','This author is already on this paper','この著者は追加済みです'));return}
 authorDraft.push({...p,first:authorDraft.length===0,corresponding:false});drawAuthors();
}
function openPeople(){
 modal('people',txt.authors(),`<input id="peopleSearch" placeholder="${T('搜索姓名、邮箱或学校','Search name, email or institution','氏名・メール・所属を検索')}" aria-label="Search authors"><div id="peopleList" style="margin-top:16px"></div>`);
 const paint=()=>{const q=$('peopleSearch').value.toLowerCase();$('peopleList').innerHTML=availablePeople().filter(a=>[a.name,a.email,a.institution].some(v=>v.toLowerCase().includes(q))).map(a=>`<div class="library-item"><h3>${esc(a.name)}</h3><p>${esc(a.institution)} · ${esc(a.email)}</p>${btn(T('添加到当前论文','Add to paper','論文に追加'),`data-pick-person="${esc(a.id)}"`)}</div>`).join('')||`<p>${T('暂无作者，请先添加本人或新作者。','No authors yet. Add yourself or a new author.','著者がいません。自分または新規著者を追加してください。')}</p>`};
 $('peopleSearch').oninput=paint;paint();
}
function renderAuthors(){
 $('content').innerHTML=`<section class="panel"><div class="section-heading"><h2>${txt.authors()}</h2>${btn('＋ '+T('新建作者','New author','著者を追加'),'data-library-new',true)}</div><p>${T('自动收集已录入的投稿作者；保存投稿时同步到作者库。选择后只复用个人资料，一作与通讯角色按论文设置。','Authors from existing submissions are collected here. Saving a paper updates the library. Personal details are reused; first/corresponding roles belong to each paper.','既存の投稿著者を収集し、投稿保存時に同期します。個人情報を再利用し、第一・責任著者の役割は論文ごとに設定します。')}</p><input id="librarySearch" style="margin-top:16px" placeholder="${T('搜索姓名、邮箱、学校…','Search names, emails, institutions…','氏名・メール・所属を検索…')}"></section><div id="libraryList"></div>`;
 const paint=()=>{const q=$('librarySearch').value.toLowerCase();$('libraryList').innerHTML=availablePeople().filter(a=>[a.name,a.email,a.institution].some(v=>v.toLowerCase().includes(q))).map(a=>`<div class="library-item"><h3>${esc(a.name)}</h3><p>${esc(a.lastName)} ${esc(a.firstName)} · ${esc(a.institution)} · ${esc(a.department)}</p><p>${esc(a.email)} ${esc(a.phone)}</p><div class="actions">${a.id.startsWith('self:')?btn(T('编辑个人主页','Edit my profile','自分のプロフィールを編集'),'data-page="profile"'):btn(txt.edit(),`data-library-edit="${esc(a.id)}"`)}</div></div>`).join('')||`<div class="empty">${T('作者库为空','Your author library is empty','ライブラリは空です')}</div>`};
 $('librarySearch').oninput=paint;paint();
}
function editLibrary(id=null){
 const p=library.find(a=>a.id===id)||{};
 modal('authorEdit',id?T('编辑作者','Edit author','著者を編集'):T('新建作者','New author','著者を追加'),`<form id="libraryForm"><div class="form-grid">${PERSON_FIELDS.map(k=>field('lib-'+k,txt[k](),p[k],k==='email'?'email':'text',k==='name'?'required':'')).join('')}</div><p class="help">${T('修改仅影响作者库；已有论文保留当时的署名资料。','Edits update the library only; existing papers keep their recorded author details.','変更はライブラリに反映されます。既存論文の著者情報は維持されます。')}</p><div class="modal-foot">${btn(txt.cancel(),'type="button" data-close="authorEdit"')}${btn(txt.save(),'type="submit"',true)}</div></form>`);
 $('libraryForm').onsubmit=e=>{e.preventDefault();try{const next=person({...p,id:p.id||uid(),...Object.fromEntries(PERSON_FIELDS.map(k=>[k,$('lib-'+k).value.trim()]))});if(writeAll(records,mergePeople(library,[next]))){$('authorEdit').close();render();toast(T('作者已保存','Author saved','著者を保存しました'))}}catch(err){alert(err.message)}};
}
function avg(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:null}
function interval(a,b){return a&&b&&dateOK(a)&&dateOK(b)&&b>=a?(Date.parse(b)-Date.parse(a))/86400000:null}
function durationStats(rs){
 const stages={we:[],ur:[],rrc:[],accepted:[]};
 rs.forEach(r=>{r.rounds.forEach(q=>{
  for(const [key,a,b] of [['we','we','ur'],['ur','ur','rrc'],['rrc','rrc','decisionDate']]){const n=interval(q[a],q[b]);if(n!==null)stages[key].push(n)}
 });if(r.status==='accept'){const n=interval(r.submitted,r.accepted);if(n!==null)stages.accepted.push(n)}});
 return stages;
}
function citationPapers(){
 const map=new Map();
 records.filter(r=>r.status==='accept').forEach(r=>{const key=r.paperId;const current=map.get(key);if(!current||r.citations!==null&&(current.citations===null||(r.citationDate||r.updated)>=(current.citationDate||current.updated)))map.set(key,r)});
 return [...map.values()];
}
function renderStats(){
 const journals=[...new Set(records.map(r=>r.journal).filter(Boolean))].sort();
 const cell=values=>`<td>${values.length?`${avg(values).toFixed(1)} ${T('天','days','日')}<small>n = ${values.length}</small>`:'—'}</td>`;
 const months=[];const now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1),month=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;months.push([month,records.filter(r=>r.submitted.startsWith(month)).length])}
 const max=Math.max(1,...months.map(x=>x[1])),papers=citationPapers();
 $('content').innerHTML=metrics()+`<section class="panel"><h2>${T('期刊平均处理用时','Average journal turnaround','雑誌ごとの平均所要日数')}</h2><div class="table-wrap"><table><thead><tr>${[txt.journal(),'WE → UR','UR → RRC',T('RRC → 决定','RRC → decision','RRC → 判定'),T('首次投稿 → 录用','Initial submission → acceptance','初回投稿 → 採択')].map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${journals.map(j=>{const s=durationStats(records.filter(r=>r.journal===j));return `<tr><td>${esc(j)}</td>${['we','ur','rrc','accepted'].map(k=>cell(s[k])).join('')}</tr>`}).join('')||`<tr><td colspan="5">${T('暂无有效日期数据','No dated records yet','日付データがありません')}</td></tr>`}</tbody></table></div><p class="stats-note">${T('前三列按所有轮次的完整阶段计算，n 为有效阶段数；录用用时按投稿记录计算，n 为已录用投稿数。缺失日期显示 —，不当作 0 天。旧版一审 / 二审结束日期保留在详情中，不擅自认定为 RRC。小屏幕表格可横向滚动。','Stage averages use all dated rounds; n is the number of complete intervals. Acceptance averages count accepted submissions. Missing dates show —, never zero days. Legacy review-end dates remain in details and are not assumed to mean RRC. Tables scroll horizontally on small screens.','最初の3列は全ラウンドの有効区間、採択列は採択済み投稿を集計します。nは有効件数です。日付不足は — と表示し、0日と扱いません。旧版終了日はRRCとみなさず詳細に保持します。表は横スクロールできます。')}</p></section><div class="stats-grid"><section class="panel"><h2>${T('状态分布','Status distribution','状況別件数')}</h2>${Object.keys(S).map(s=>{const n=records.filter(r=>r.status===s).length;return `<div class="bar-row"><span>${stateName(s)}</span><div class="bar-track"><div class="bar" style="width:${records.length?n/records.length*100:0}%"></div></div><span>${n}</span></div>`}).join('')}</section><section class="panel"><h2>${T('近六个月投稿','Submissions in the last six months','直近6か月の投稿')}</h2><div class="chart-bars">${months.map(([m,n])=>`<div class="month-bar"><b>${n}</b><i style="height:${n/max*120}px"></i><span>${m}</span></div>`).join('')}</div><p class="note">${T('按首次投稿日期统计。','Based on initial submission dates.','初回投稿日で集計。')}</p></section></div><section class="panel"><h2>${T('期刊投稿概况','Journal outcomes','雑誌別の投稿結果')}</h2><div class="table-wrap"><table><thead><tr>${[txt.journal(),T('投稿次数','Attempts','投稿数'),T('进行中','Active','進行中'),stateName('accept'),stateName('reject'),stateName('withdraw')].map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${journals.map(j=>{const rs=records.filter(r=>r.journal===j);return `<tr><td>${esc(j)}</td><td>${rs.length}</td><td>${rs.filter(r=>!CLOSED.includes(r.status)).length}</td>${CLOSED.map(s=>`<td>${rs.filter(r=>r.status===s).length}</td>`).join('')}</tr>`}).join('')}</tbody></table></div></section><section class="panel"><h2>${T('论文与引用','Papers & citations','論文と被引用')}</h2><p class="note">${T('每篇论文只展示一次，优先采用最近更新的引用记录；不同来源不混合相加。引用数据为手动维护。','Each paper appears once, using its latest recorded citation metrics. Sources are not summed together. Citation data is maintained manually.','論文ごとに最新の引用記録を1回だけ表示します。出典を混ぜて合算しません。引用情報は手動更新です。')}</p><div class="table-wrap"><table><thead><tr>${[txt.title(),txt.journal(),txt.citations(),txt.source(),txt.updated()].map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${papers.map(r=>`<tr><td><button class="linkbtn" data-detail="${esc(r.id)}">${esc(r.title)}</button></td><td>${esc(r.journal)}</td><td>${r.citations??'—'}</td><td>${esc(r.citationSource)||'—'}</td><td>${esc(r.citationDate)||'—'}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function roles(){return [['student',T('学生','Student','学生')],['teacher',T('教师','Faculty','教員')],['researcher',T('科研人员','Researcher','研究者')],['other',T('其他','Other','その他')]]}
function degrees(){return [['本科',T('本科','Bachelor’s','学士')],['硕士',T('硕士','Master’s','修士')],['博士',T('博士','Doctorate','博士')],['其他',T('其他','Other','その他')]]}
function profileFields(p={},full=true){
 return `<div class="form-grid">${field('p-name',T('姓名 / 称呼','Name / preferred name','氏名・表示名'),p.name,'text','required')}${select('p-role',T('身份','Role','立場'),roles(),p.role||'student')}${select('p-degree',T('学历 / 在读学位','Education / current degree','学歴・在籍課程'),degrees(),p.degree||'本科')}${field('p-title',T('职称 / 研究阶段','Position / career stage','職位・研究段階'),p.title)}${['lastName','firstName','email','phone','institution','department'].map(k=>field('p-'+k,txt[k](),p[k],k==='email'?'email':'text')).join('')}${full?`${field('p-orcid','ORCID',p.orcid)}${field('p-wos','Web of Science ResearcherID',p.wos)}${field('p-scopus','Scopus Author ID',p.scopus)}${field('p-website',T('个人网站','Website','ウェブサイト'),p.website,'url')}${field('p-country',T('国家 / 地区','Country / region','国・地域'),p.country)}${field('p-keywords',T('研究关键词','Research keywords','研究キーワード'),p.keywords)}${field('p-wish',T('自定义欢迎语','Personal welcome message','歓迎メッセージ'),p.wish)}`:''}</div>${full?`<div class="field" style="margin-top:16px"><label for="p-bio">${T('简介','Biography','略歴')}</label><textarea id="p-bio">${esc(p.bio)}</textarea></div><div class="field" style="margin-top:16px"><label for="p-education">${T('教育与任职经历（每行一项）','Education & appointments (one entry per line)','学歴・職歴（1行に1件）')}</label><textarea id="p-education">${esc(p.education)}</textarea></div><h3>${T('学术指标快照','Research metrics snapshot','研究指標のスナップショット')}</h3><div class="form-grid">${[['publications',T('文献数','Publications','論文数')],['citations',txt.citations()],['hIndex','h-index'],['citingArticles',T('施引文献数','Citing articles','引用文献数')],['withoutSelf',T('去除自引的引用次数','Citations excluding self-citations','自己引用除外の被引用数')]].map(([k,n])=>field('p-'+k,n,p[k],'number')).join('')}${field('p-metricsSource',txt.source(),p.metricsSource,'text','placeholder="Web of Science / Scopus"')}${field('p-metricsDate',txt.updated(),p.metricsDate,'date')}</div><p class="note">${T('个人资料与指标按 ORCID / WoS / Scopus 的常用字段组织，手动填写，不代表平台认证或实时数据。','Fields follow common ORCID / WoS / Scopus profiles. They are manually recorded, not verified or live platform data.','ORCID / WoS / Scopusの一般的な項目を参考にしています。手入力であり、認証済み情報やリアルタイムデータではありません。')}</p>`:''}`;
}
function collectProfile(base={}){
 const p={...base};document.querySelectorAll('[id^="p-"]').forEach(e=>{p[e.id.slice(2)]=e.type==='number'?(e.value===''?null:Number(e.value)):e.value.trim()});
 if(p.website&&!safeUrl(p.website))fail('个人网站链接无效','Invalid website URL','ウェブサイトURLが不正です');
 if(p.orcid&&!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(p.orcid))fail('ORCID 格式无效','Invalid ORCID format','ORCIDの形式が不正です');
 if(p.scopus&&!/^\d+$/.test(p.scopus))fail('Scopus ID 应为数字','Scopus ID must contain digits only','Scopus IDは数字で入力してください');
 return p;
}
function renderProfile(){
 if(!profile){$('content').innerHTML=`<section class="panel"><h2>${T('建立你的科研档案','Create your research profile','研究者プロフィールを作成')}</h2><p>${T('创建账号后，可在投稿时一键添加本人。已有投稿保持不变。','Create a local account to add yourself to papers in one click. Existing submissions are preserved.','アカウントを作成すると論文に自分を簡単に追加できます。既存の投稿は維持されます。')}</p>${btn(T('创建本地账号','Create local account','ローカルアカウント作成'),'data-setup-profile',true)}</section>`;return}
 const p=profile;
 $('content').innerHTML=`<section class="profile-hero"><h2>${esc(p.name)}</h2><p>${esc(p.institution)} · ${esc(p.department)} · ${esc(p.title)}</p>${identityLinks()}</section><div class="profile-columns"><section class="panel"><h2>${T('个人信息','Personal information','個人情報')}</h2>${['email','phone','institution','department'].map(k=>`<p style="margin-top:12px"><small>${txt[k]()}</small><br>${esc(p[k])||'—'}</p>`).join('')}<p style="margin-top:15px">${esc(p.bio)}</p></section><section class="panel"><h2>${T('学术指标','Research metrics','研究指標')}</h2><div class="metrics-small" style="margin-top:15px">${[['publications',T('文献数','Publications','論文数')],['citations',txt.citations()],['hIndex','h-index'],['citingArticles',T('施引文献','Citing articles','引用文献')],['withoutSelf',T('引用（去自引）','Citations (no self-cites)','被引用（自己引用除外）')]].map(([k,n])=>`<div class="metric-small"><strong>${p[k]??'—'}</strong><span>${n}</span></div>`).join('')}</div><p class="note">${txt.source()}: ${esc(p.metricsSource)||'—'} · ${txt.updated()}: ${esc(p.metricsDate)||'—'}</p><h3>${T('教育与任职经历','Education & appointments','学歴・職歴')}</h3><p class="notes">${esc(p.education)||'—'}</p></section></div><section class="panel"><h2>${T('编辑学术资料','Edit research profile','プロフィールを編集')}</h2><form id="profileForm" style="margin-top:20px">${profileFields(profile)}<div class="modal-foot">${btn(txt.save(),'type="submit"',true)}</div><p class="auth-error" id="profileError" role="alert"></p></form></section><section class="panel"><h2>${T('修改密码','Change password','パスワード変更')}</h2><p>${T('用户名','Username','ユーザー名')}: ${esc(profile.username)}</p><form id="passwordForm"><div class="form-grid" style="margin-top:16px">${field('oldPassword',T('当前密码','Current password','現在のパスワード'),'','password','required autocomplete="current-password"')}${field('newPassword',T('新密码（至少 6 位）','New password (at least 6 characters)','新しいパスワード（6文字以上）'),'','password','required minlength="6" autocomplete="new-password"')}</div><div class="modal-foot">${btn(txt.save(),'type="submit"')}</div><p id="passwordError" class="auth-error" role="alert"></p></form></section>`;
 $('profileForm').onsubmit=e=>{e.preventDefault();try{const next=validProfile(collectProfile(profile));if(writeAll(records,library,next)){render();toast(T('个人资料已保存','Profile saved','プロフィールを保存しました'))}}catch(err){$('profileError').textContent=err.message}};
 $('passwordForm').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{if(await passwordHash($('oldPassword').value,profile.salt)!==profile.hash)fail('当前密码错误','Incorrect current password','現在のパスワードが違います');const salt=randomSalt(),hash=await passwordHash($('newPassword').value,salt);if(writeAll(records,library,{...profile,salt,hash})){render();toast(T('密码已更新','Password updated','パスワードを更新しました'))}}catch(err){$('passwordError').textContent=err.message}finally{e.submitter.disabled=false}};
}
function randomSalt(){return [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('')}
async function passwordHash(password,salt){
 if(!crypto.subtle)fail('请使用支持本地密码功能的新版浏览器','Please use a modern browser supporting local cryptography','暗号機能対応の新しいブラウザを使用してください');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:210000},key,256);
 return [...new Uint8Array(bits)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function enterWorkspace(){unlocked=true;document.querySelector('.auth-screen')?.remove();document.querySelector('.app').classList.remove('hidden');render()}
function showLogin(){
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('.auth-screen')?.remove();
 document.querySelector('.app').classList.add('hidden');
 const root=document.createElement('div');root.className='auth-screen';
 root.innerHTML=`<section class="auth-art"><div class="eyebrow" style="color:#bed4d5">YOUR RESEARCH COMPANION</div><h1>${esc(brand())}</h1><h2>${T('投个好稿，接收好运。','A good paper deserves good news.','今日も、よい知らせを待ちながら。')}</h2><p>投个好稿 · Accept Me! · まだ査読中</p></section><section class="auth-panel">${languages()}<h2>${profile?T('欢迎回来','Welcome back','おかえりなさい'):T('建立科研档案','Create your research profile','研究者プロフィール作成')}</h2><p>${T('本地账号与已有投稿共享同一工作空间。','Your local account uses your existing submission workspace.','ローカルアカウントは既存の投稿スペースを利用します。')}</p><form id="authForm">${field('loginUser',T('用户名','Username','ユーザー名'),profile?.username,'text','required autocomplete="username"')}${field('loginPassword',T('密码','Password','パスワード'),'','password',`required minlength="${profile?1:6}" autocomplete="${profile?'current-password':'new-password'}"`)}${profile?'':field('confirmPassword',T('确认密码（至少 6 位）','Confirm password (6+ characters)','パスワード確認（6文字以上）'),'','password','required minlength="6" autocomplete="new-password"')+profileFields({},false)}<p class="auth-error" id="authError" role="alert"></p>${btn(profile?T('登录','Log in','ログイン'):T('创建账号并进入','Create account & enter','作成して開始'),'type="submit"',true)}</form>${!profile||loadError?`<button class="linkbtn" data-skip-login style="margin-top:15px">${T('暂时跳过，进入已有工作空间','Skip for now; open existing workspace','スキップして既存スペースへ')} →</button>`:''}<p class="auth-help">${T('本地单用户登录；密码以加盐派生值保存。投稿数据未加密，不连接云端。忘记密码无邮件找回，请保留账号及备份。','Local single-user sign-in. Passwords use salted key derivation; submission data is not encrypted or cloud-synced. There is no email password reset; keep your credentials and backups.','ローカルの単一ユーザーログインです。パスワードはソルト付き導出値として保存します。投稿データは暗号化・クラウド同期されません。メールによる再設定機能はありません。')}</p></section>`;
 document.body.append(root);
 $('authForm').onsubmit=async e=>{
  e.preventDefault();e.submitter.disabled=true;
  try{
   const password=$('loginPassword').value,username=$('loginUser').value.trim();
   if(profile){if(username!==profile.username||await passwordHash(password,profile.salt)!==profile.hash)fail('用户名或密码错误','Incorrect username or password','ユーザー名またはパスワードが違います')}
   else{
    if(password!==$('confirmPassword').value)fail('两次密码不一致','Passwords do not match','パスワードが一致しません');
    const salt=randomSalt(),hash=await passwordHash(password,salt),next=validProfile({...collectProfile(),username,salt,hash});
    if(!writeAll(records,library,next))return;
   }enterWorkspace();
  }catch(err){$('authError').textContent=err.message}finally{e.submitter.disabled=false}
 };
}
function backupObject(){return {app:'gaoji',version:3,brand:'Accept Me!',exportedAt:new Date().toISOString(),records,profile,authors:library}}
function renderBackup(){
 $('content').innerHTML=`<section class="panel"><h2>${T('数据与升级保护','Data & upgrade protection','データ・アップグレード保護')}</h2><p>${T('名称改变，存储位置不变。已有账号、投稿、时间线和旧版字段继续保留。首次保存新版数据前会生成原始快照。','The name changed, not the storage keys. Existing accounts, submissions, history and legacy fields are retained. A raw snapshot is saved before the first v3 write.','名称は変更しましたが保存先キーは同じです。アカウント、投稿、履歴、旧版項目は維持し、初回の保存前に元データを保存します。')}</p><p class="note">${T('数据仍在当前浏览器本地存储。请使用同一路径、同一浏览器打开，并定期备份。','Data remains in this browser. Use the same file path and browser, and export backups regularly.','同じファイルパス・ブラウザで開き、定期的にバックアップしてください。')}</p></section><section class="panel"><h2>${T('备份与恢复','Backup & restore','バックアップと復元')}</h2><div class="actions" style="margin-top:15px">${btn(T('导出完整备份','Export full backup','完全バックアップ'),'id="export"',true)}${btn(T('恢复备份','Restore backup','バックアップ復元'),'id="import"')}${btn(T('导出原始存储','Export raw storage','元データを書き出す'),'id="rawExport"')}${btn(T('导出升级前快照','Export pre-upgrade snapshot','更新前データを書き出す'),'id="snapshotExport"')}</div><input id="importFile" type="file" accept=".json,application/json" hidden><p class="note">${T('备份包含作者库、各轮审稿、个人信息与密码派生值。恢复替换投稿和作者库；已有账号不会被覆盖。兼容旧版备份。','Backups include authors, all review rounds, profiles and password derivations. Restore replaces submissions and the library, not an existing account. Older backups are supported.','著者庫、全ラウンド、プロフィール、パスワード導出値を含みます。復元は投稿・著者庫を置換しますが既存アカウントは上書きしません。旧版バックアップにも対応します。')}</p></section><section class="panel"><h2>${T('反馈与建议','Feedback','ご意見・ご要望')}</h2><a href="mailto:yanghuaisong@hrbeu.edu.cn">yanghuaisong@hrbeu.edu.cn</a></section>`;
 $('export').onclick=()=>download(JSON.stringify(backupObject(),null,2),brand()+'-'+today()+'.json');
 $('rawExport').onclick=()=>download(JSON.stringify({app:'gaoji',version:3,rawRecords:localStorage.getItem(KEY),rawProfile:localStorage.getItem(PROFILE_KEY),rawAuthors:localStorage.getItem(AUTHORS_KEY)},null,2),'AcceptMe-raw-'+today()+'.json');
 $('snapshotExport').onclick=()=>{const raw=localStorage.getItem('gaoji.before-v3');if(raw)download(raw,'AcceptMe-before-v3.json');else toast(T('首次保存新版数据后生成快照','Snapshot is created on the first v3 save','初回のv3保存時に作成されます'))};
 $('import').onclick=()=>$('importFile').click();
 $('importFile').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
   if(f.size>25*1024*1024)fail('备份文件过大','Backup file is too large','バックアップが大きすぎます');
   let obj=JSON.parse(await f.text());
   if(obj.app!=='gaoji'||![1,2,3,4].includes(obj.version))fail('不支持的备份格式','Unsupported backup format','未対応のバックアップ形式');
   if(Object.hasOwn(obj,'rawRecords'))obj={...obj,records:JSON.parse(obj.rawRecords||'[]'),profile:JSON.parse(obj.rawProfile||'null'),authors:JSON.parse(obj.rawAuthors||'[]')};
   const next=migrate(obj.records),nextAuthors=Array.isArray(obj.authors)?obj.authors.map(person):mergePeople([],next.flatMap(r=>r.authors));
   if(obj.profile)validProfile(obj.profile);
   if(!confirm(T(`用 ${next.length} 条备份记录替换现有 ${records.length} 条投稿和作者库？请先导出当前备份。`,`Replace ${records.length} current submissions and the author library with ${next.length} backup records? Export a backup first.`,`${records.length}件の投稿と著者庫を${next.length}件のバックアップに置き換えますか？先にバックアップしてください。`)))return;
   const restoreProfile=!profile&&obj.profile&&confirm(T('同时恢复备份中的账号？需使用备份中的密码登录。','Restore the account too? Its existing password will be required.','アカウントも復元しますか？バックアップのパスワードが必要です。'));
   localStorage.setItem('gaoji.before-restore-v3',JSON.stringify({app:'gaoji',version:3,rawRecords:localStorage.getItem(KEY),rawProfile:localStorage.getItem(PROFILE_KEY),rawAuthors:localStorage.getItem(AUTHORS_KEY)}));
   if(writeAll(next,nextAuthors,restoreProfile?obj.profile:profile,{recover:true,nextSettings:obj.settings||settings})){if(restoreProfile){unlocked=false;showLogin()}else render();toast(T('备份已恢复','Backup restored','復元しました'))}
  }catch(err){alert(err.message)}finally{e.target.value=''}
 };
}
const ELSEVIER_URL='https://webapps.elsevier.cn/st-wechat/manuscript-query';
function queryPayload(r,authorId){
 const candidates=r.authors.filter(a=>a.corresponding),a=candidates.find(a=>a.id===authorId)||candidates[0];
 return {manuscriptNumber:r.number.trim().replace(/R\d+$/i,''),lastName:a?.lastName||'',firstName:a?.firstName||'',lang};
}
function queryReady(p){return ['manuscriptNumber','lastName','firstName'].every(k=>p[k]?.trim())}
function queryUrl(p){return queryReady(p)?ELSEVIER_URL+'#gaoji='+encodeURIComponent(JSON.stringify(p)):ELSEVIER_URL}
// A universal bookmark: one bookmark works for every submission's prefill link.
function universalFill(){
 if(location.origin!=='https://webapps.elsevier.cn'||!location.pathname.includes('/manuscript-query')){alert('Open the Elsevier manuscript query page first.');return}
 let p;try{p=JSON.parse(decodeURIComponent(location.hash.slice(7)))}catch{}
 if(!p||!['manuscriptNumber','lastName','firstName'].every(k=>typeof p[k]==='string'&&p[k])){alert('Open a prefill link from Dear Editor first.');return}
 const keys=['manuscriptNumber','lastName','firstName'],els=keys.map(k=>document.getElementById(k));
 if(els.some(e=>!e)){alert('Wait for the form to load, then click this bookmark again.');return}
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 els.forEach((el,i)=>{setter.call(el,p[keys[i]]);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
 alert(p.lang==='zh'?'资料已填入。请核对、同意条款并自行完成验证码。':p.lang==='ja'?'入力しました。内容と規約を確認し、認証を完了してください。':'Filled. Check the details, consent to the terms and complete verification yourself.');
}
function queryHelp(){
 return `<details style="margin-top:18px"><summary>${T('自动填表设置与故障排查','Autofill setup & troubleshooting','自動入力の設定・トラブル対応')}</summary><p class="note">${T('推荐直接安装本地浏览器扩展：Edge / Chrome → 扩展 → 开发者模式 → 加载解压缩扩展，选择当前“稿迹”文件夹。之后从这里打开查询会自动填写。无需运行油猴脚本。','Recommended: install the local browser extension. Edge / Chrome → Extensions → Developer mode → Load unpacked → choose this app’s folder (稿迹). Prefill links then fill automatically; a userscript manager is not needed.','推奨：Edge / Chrome → 拡張機能 → デベロッパーモード → パッケージ化されていない拡張機能を読み込む → このアプリの「稿迹」フォルダを選択。ユーザースクリプト管理は不要です。')}</p><p class="note">${T('已有油猴可更新配套脚本。两种安装方式选一种即可。脚本从页面开始加载时捕获参数，等待表单挂载后填入；页面顶部会显示成功提示。','Alternatively update the included userscript. Use one installation method. The helper captures parameters at page start, waits for the form and shows a success banner.','既存のユーザースクリプトも更新できます。どちらか一方を利用してください。ページ読込開始時に情報を保持し、フォーム出現後に入力して結果を表示します。')}</p><a href="elsevier-autofill.user.js" download>${T('下载更新的用户脚本','Download updated userscript','更新版ユーザースクリプト')}</a><p class="note">${T('不安装扩展：把下面的通用填表链接拖到书签栏。从本软件打开查询页面后，点击书签即可填写；一个书签适用于所有论文。','No extension: drag this universal autofill link to your bookmarks bar. Open a prefill link from this app, then click the bookmark. One bookmark works for every paper.','拡張機能なし：以下をブックマークバーにドラッグ。このアプリから照会を開いてからクリックすると入力されます。全論文で共通です。')}</p><a class="btn" data-bookmark href="${esc('javascript:('+universalFill.toString()+')();void(0)')}">${T('通用自动填表','Accept Me! Autofill','共通自動入力')}</a><p class="note">${T('自动填表只输入编号与姓名。验证码、条款确认和提交由你操作。结果暂不自动回读，查询后请手动更新本地状态。','Autofill only enters the number and names. You handle consent, submission and CAPTCHA. Results are not read back yet; update local statuses manually.','自動入力は番号と氏名のみです。規約確認・送信・CAPTCHAは手動です。結果の自動読込は未実装のため、状況は手動更新してください。')}</p></details>`;
}
function renderQuery(r){
 const people=r.authors.filter(a=>a.corresponding);
 $('querySection').innerHTML=`<section class="panel"><h2>${T('Elsevier 状态查询','Elsevier status query','Elsevier状況照会')}</h2>${select('queryAuthor',T('投稿系统登记的通讯作者','Corresponding author registered in the submission system','投稿システムに登録した責任著者'),people.length?people.map(a=>[a.id,a.name]):[['','—']])}<p id="queryInfo" class="note"></p><div class="actions query-actions"><a id="queryOpen" class="btn primary" target="_blank" rel="noopener noreferrer"></a>${btn(T('复制查询资料','Copy query details','照会情報をコピー'),'id="copyQuery"')}</div>${queryHelp()}</section>`;
 const update=()=>{const p=queryPayload(r,$('queryAuthor').value),ready=queryReady(p);$('queryOpen').href=queryUrl(p);$('queryOpen').textContent=ready?T('打开查询并预填 ↗','Open & prefill ↗','照会を開いて入力 ↗'):T('打开查询网站 ↗','Open query website ↗','照会サイトを開く ↗');$('queryInfo').textContent=ready?`${p.manuscriptNumber} · Last Name: ${p.lastName} · First Name: ${p.firstName}`:T('请补全稿件编号和通讯作者的英文姓、名。','Add the manuscript number and corresponding author’s registered first and last name.','原稿番号と責任著者の登録された姓・名を入力してください。');$('copyQuery').disabled=!ready;$('copyQuery').onclick=()=>copyQuery(p)};
 $('queryAuthor').onchange=update;update();
}
async function copyQuery(p){
 const text=`Manuscript Number: ${p.manuscriptNumber}\nLast Name: ${p.lastName}\nFirst Name: ${p.firstName}`;
 try{await navigator.clipboard.writeText(text);toast(T('已复制','Copied','コピーしました'))}catch{prompt(T('复制以下资料','Copy these details','次の情報をコピー'),text)}
}
function activePapers(){return records.filter(r=>!CLOSED.includes(r.status))}
function openBatch(){
 batchOpened=new Set();
 modal('batch',T('一键查询 · 进行中的投稿','Batch query · active submissions','一括照会・進行中の投稿'),`<p>${T('已结束的稿件不列入。待投稿或资料不全的稿件显示原因。每篇查询仍需你完成验证。','Closed submissions are excluded. Preparing or incomplete entries show why they are skipped. Each query still requires your verification.','終了した投稿は除外します。準備中・情報不足は理由を表示します。各照会の認証は手動です。')}</p><div class="actions" style="margin:16px 0">${btn(T('打开所有可查询稿件','Open all ready queries','照会可能な投稿をすべて開く'),'data-query-all',true)}${btn(T('打开下一篇','Open next','次の投稿を開く'),'data-query-next')}</div><p id="batchMessage" class="note"></p><div id="batchList">${activePapers().map(r=>`<div class="batch-row" data-batch-row="${esc(r.id)}"><h3>${esc(r.title)}</h3>${badge(r)}${select('batch-author-'+r.id,T('通讯作者','Corresponding author','責任著者'),r.authors.filter(a=>a.corresponding).map(a=>[a.id,a.name]))}<div class="batch-info note"></div><div class="actions"><a class="btn batch-link" target="_blank" rel="noopener noreferrer">${T('打开查询','Open query','照会を開く')} ↗</a>${editorSystem(r)?`<a class="btn" href="${esc(editorSystem(r))}" target="_blank" rel="noopener noreferrer">${T('投稿 / 审稿系统','Editorial system','投稿・査読システム')} ↗</a>`:''}<button class="linkbtn" data-batch-edit="${esc(r.id)}">${T('补充资料','Edit details','情報を補完')}</button></div></div>`).join('')||`<div class="empty">${T('暂无进行中的投稿','No active submissions','進行中の投稿はありません')}</div>`}</div>${queryHelp()}`);
 const update=()=>document.querySelectorAll('[data-batch-row]').forEach(row=>{
  const r=records.find(r=>r.id===row.dataset.batchRow),p=queryPayload(r,row.querySelector('select').value),ready=r.status!=='waiting'&&queryReady(p);
  row.dataset.ready=String(ready);const a=row.querySelector('.batch-link');a.href=queryUrl(p);a.classList.toggle('hidden',!ready);
  row.querySelector('.batch-info').textContent=ready?`${p.manuscriptNumber} · ${p.lastName} ${p.firstName}`:r.status==='waiting'?T('尚未投稿，暂不查询','Not submitted yet; skipped','未投稿のためスキップ'):T('缺少编号或通讯作者英文姓名','Missing number or registered author names','番号または責任著者の英語氏名が不足');
  a.onclick=()=>batchOpened.add(r.id);
 });
 $('batchList').onchange=update;update();
}
function openBatchQueries(all){
 const rows=[...document.querySelectorAll('[data-batch-row]')].filter(r=>r.dataset.ready==='true'&&!batchOpened.has(r.dataset.batchRow));
 let opened=0,blocked=0;
 for(const row of all?rows:rows.slice(0,1)){
  const w=window.open('about:blank','_blank');if(!w){blocked++;continue}
  w.opener=null;w.location.href=row.querySelector('.batch-link').href;batchOpened.add(row.dataset.batchRow);opened++;
 }
 $('batchMessage').textContent=T(`本次打开 ${opened} 篇。${blocked?` ${blocked} 个窗口被浏览器拦截，请允许弹出窗口或逐篇点击链接。`:rows.length?' 每篇请分别完成验证。':' 没有剩余可查询稿件。'}`,`Opened ${opened}. ${blocked?`${blocked} popups blocked; allow popups or click individual links.`:rows.length?'Complete verification on each page.':'No remaining ready queries.'}`,`${opened}件を開きました。${blocked?`${blocked}件がブロックされました。ポップアップを許可するか個別リンクをクリックしてください。`:rows.length?'各ページで認証してください。':'照会可能な残りの投稿はありません。'}`);
}
document.addEventListener('click',e=>{
 const b=e.target.closest('button,a');if(!b)return;
 if(b.dataset.close){closeDialog(b.dataset.close);return}
 if(b.dataset.page){page=b.dataset.page;render()}
 if(b.hasAttribute('data-new'))openEditor();
 if(b.dataset.filter){filter=b.dataset.filter;renderOverview()}
 if(b.dataset.detail)showDetail(b.dataset.detail);
 if(b.dataset.edit){$('detail').close();openEditor(b.dataset.edit)}
 if(b.dataset.transfer){const source=records.find(r=>r.id===b.dataset.transfer);$('detail').close();openEditor(null,source)}
 if(b.dataset.delete&&confirm(T('删除此投稿及其时间线？其他投稿不受影响。','Delete this submission and its history? Other submissions are preserved.','この投稿と履歴を削除しますか？他の投稿は維持されます。'))){if(writeAll(records.filter(r=>r.id!==b.dataset.delete))){$('detail').close();render()}}
 if(b.hasAttribute('data-add-author')){authorDraft=readAuthors();authorDraft.push({id:uid(),name:'',first:authorDraft.length===0,corresponding:false});drawAuthors()}
 if(b.hasAttribute('data-add-self')){const p=ownPerson();if(p)addPersonToPaper(p);else alert(T('请先在个人主页创建账号并填写资料。','Create your profile first.','先にプロフィールを作成してください。'))}
 if(b.hasAttribute('data-pick-authors'))openPeople();
 if(b.dataset.pickPerson){const p=availablePeople().find(a=>a.id===b.dataset.pickPerson);if(p)addPersonToPaper(p)}
 if(b.dataset.authorRemove!==undefined||b.dataset.authorUp!==undefined||b.dataset.authorDown!==undefined){
  authorDraft=readAuthors();if(b.dataset.authorRemove!==undefined)authorDraft.splice(Number(b.dataset.authorRemove),1);else{const up=b.dataset.authorUp!==undefined,i=Number(up?b.dataset.authorUp:b.dataset.authorDown),j=i+(up?-1:1);if(j>=0&&j<authorDraft.length)[authorDraft[i],authorDraft[j]]=[authorDraft[j],authorDraft[i]]}drawAuthors();
 }
 if(b.hasAttribute('data-add-round')){roundDraft=readRounds();roundDraft.push(emptyRound(roundDraft.length+1));drawRounds()}
 if(b.dataset.roundRemove!==undefined){const i=Number(b.dataset.roundRemove);if(confirm(T('移除此轮次？保存后才生效。','Remove this round? Takes effect when saved.','このラウンドを削除しますか？保存後に反映されます。'))){roundDraft=readRounds();roundDraft.splice(i,1);drawRounds()}}
 if(b.hasAttribute('data-library-new'))editLibrary();
 if(b.dataset.libraryEdit)editLibrary(b.dataset.libraryEdit);
 if(b.hasAttribute('data-setup-profile')){unlocked=false;showLogin()}
 if(b.hasAttribute('data-logout')){unlocked=false;showLogin()}
 if(b.hasAttribute('data-skip-login'))enterWorkspace();
 if(b.hasAttribute('data-batch'))openBatch();
 if(b.hasAttribute('data-query-all'))openBatchQueries(true);
 if(b.hasAttribute('data-query-next'))openBatchQueries(false);
 if(b.dataset.batchEdit){$('batch').close();openEditor(b.dataset.batchEdit)}
 if(b.hasAttribute('data-bookmark')){e.preventDefault();toast(T('请拖入书签栏，在查询页点击书签。','Drag this link to your bookmarks bar; click it on the query page.','ブックマークバーにドラッグし、照会ページでクリックしてください。'))}
});
document.addEventListener('change',e=>{
 if(!e.target.matches('[data-language]'))return;
 lang=e.target.value;try{localStorage.setItem(LANG_KEY,lang)}catch{}
 // Changing languages does not modify any research data.
 renderShell();if(unlocked)render();else showLogin();
});
window.addEventListener('beforeunload',e=>{if($('editor').open&&editorBaseline&&editorFingerprint()!==editorBaseline){e.preventDefault();e.returnValue=''}});
// v4 adds journal settings, feedback, import helpers and remembered sign-in,
// then starts the UI. Research storage keys remain unchanged.


'use strict';
const SETTINGS_KEY='gaoji.settings.v4',REMEMBER_KEY='gaoji.remember.v1';
const DEFAULT_JOURNALS=[
 {id:'journal-oe',name:'Ocean Engineering',abbreviation:'OE',color:'#143c68',systemUrl:'https://www.editorialmanager.com/oe/default.aspx',homepage:'https://www.sciencedirect.com/journal/ocean-engineering',impactFactor:'',citeScore:'',metricsYear:'',metricsDate:''},
 {id:'journal-ms',name:'Marine Structures',abbreviation:'MS',color:'#56bfd0',systemUrl:'https://www.editorialmanager.com/mastr/Default.aspx',homepage:'https://www.sciencedirect.com/journal/marine-structures',impactFactor:'',citeScore:'',metricsYear:'',metricsDate:''}
];
let settings={journals:clone(DEFAULT_JOURNALS),feedback:{email:'yanghuaisong@hrbeu.edu.cn',phone:'',wechat:'',welcome:'',wechatQr:'',alipayQr:''}};
function validateSettings(s){
 if(!s||!Array.isArray(s.journals)||!s.feedback)fail('设置备份格式错误','Invalid settings backup','設定バックアップが不正です');
 const out=clone(s),ids=new Set();
 out.journals.forEach(j=>{
  if(typeof j.id!=='string'||ids.has(j.id)||typeof j.name!=='string'||!j.name.trim()||!/^#[0-9a-f]{6}$/i.test(j.color))fail('期刊资料无效','Invalid journal data','雑誌情報が不正です');
  ids.add(j.id);
  for(const k of ['systemUrl','homepage'])if(j[k]&&!safeUrl(j[k]))fail('期刊链接无效','Invalid journal URL','雑誌URLが不正です');
  for(const k of ['impactFactor','citeScore'])if(j[k]!==''&&j[k]!==null&&j[k]!==undefined&&(!Number.isFinite(Number(j[k]))||Number(j[k])<0))fail('期刊指标无效','Invalid journal metrics','雑誌指標が不正です');
 });
 if(!emailOK(out.feedback.email||''))fail('联系邮箱无效','Invalid contact email','連絡メールが不正です');
 for(const k of ['wechatQr','alipayQr'])if(out.feedback[k]&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(out.feedback[k]))fail('收款码图片格式无效','Invalid support QR image','支援用QR画像が不正です');
 return out;
}
try{const raw=localStorage.getItem(SETTINGS_KEY);if(raw)settings=validateSettings(JSON.parse(raw))}catch(e){loadError=loadError||e.message}
const v3Write=writeAll;
writeAll=function(nextRecords=records,nextLibrary=library,nextProfile=profile,options={}){
 const nextSettings=options.nextSettings||settings;
 let previous,changed=false;
 try{
  const valid=validateSettings(nextSettings);
  if(loadError&&!options.recover)return v3Write(nextRecords,nextLibrary,nextProfile,options);
  previous=localStorage.getItem(SETTINGS_KEY);
  if(!localStorage.getItem('gaoji.before-v4'))localStorage.setItem('gaoji.before-v4',JSON.stringify({app:'gaoji',version:4,rawRecords:localStorage.getItem(KEY),rawProfile:localStorage.getItem(PROFILE_KEY),rawAuthors:localStorage.getItem(AUTHORS_KEY),settings:previous?JSON.parse(previous):null}));
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(valid));changed=true;
  if(!v3Write(nextRecords,nextLibrary,nextProfile,options)){
   if(previous===null)localStorage.removeItem(SETTINGS_KEY);else localStorage.setItem(SETTINGS_KEY,previous);
   return false;
  }
  settings=valid;return true;
 }catch(e){
  if(changed)try{if(previous===null)localStorage.removeItem(SETTINGS_KEY);else localStorage.setItem(SETTINGS_KEY,previous)}catch{}
  alert(T('保存失败：','Save failed: ','保存失敗：')+e.message);return false;
 }
};
const v3BackupObject=backupObject;
backupObject=function(){return {...v3BackupObject(),version:4,brand:'Dear Editor',settings}};
function newDialog(id){
 const d=document.createElement('dialog');d.id=id;d.innerHTML=`<div class="modal-head"><h2 id="${id}Heading"></h2><button class="close" data-close="${id}" aria-label="Close">×</button></div><div id="${id}Body" class="modal-body"></div>`;
 d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()});
 document.body.append(d);
}
['journalEdit','mergeAuthors','durationDetail','feedbackEdit','authorImport'].forEach(newDialog);
const v3Shell=renderShell;
renderShell=function(){
 v3Shell();
 document.documentElement.lang=lang==='en'?'en':lang==='ja'?'ja':['zh-Hant','yue'].includes(lang)?'zh-Hant':'zh-Hans';
 document.querySelector('aside .language-globe')?.remove();
 let control=$('languageControl');if(!control){control=document.createElement('div');control.id='languageControl';document.body.append(control)}control.innerHTML=languages();
 const feedback=document.querySelector('aside .feedback');
 feedback.outerHTML=`<button class="nav ${page==='feedback'?'active':''}" data-page="feedback">${T('反馈与支持','Feedback & support','ご意見・ご支援')}</button>`;
 document.querySelector('[data-page="authors"]').insertAdjacentHTML('afterend',`<button class="nav ${page==='journals'?'active':''}" data-page="journals">${T('期刊资料库','Journal library','雑誌ライブラリ')}</button>`);
 document.querySelectorAll('[data-batch]').forEach(b=>{b.textContent=T('现有稿件批量查询','Query existing submissions','既存原稿を一括照会');b.title=T('批量打开尚未结束、资料完整的稿件查询','Open queries for active submissions with complete details','情報が揃っている進行中の原稿を照会')});
 if(page==='journals')$('pageTitle').textContent=T('期刊资料库','Journal library','雑誌ライブラリ');
 if(page==='feedback')$('pageTitle').textContent=T('反馈与支持','Feedback & support','ご意見・ご支援');
 document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('LOCAL EDITION 3.0','LOCAL EDITION 4.0');
};
const v3QueryHelp=queryHelp;
queryHelp=function(){return v3QueryHelp().replaceAll('Accept Me!','Dear Editor')};
const v3Overview=renderOverview;
renderOverview=function(){v3Overview();document.querySelector('.footnote').textContent=T('待返修优先 · 其余按首次投稿日期从新到旧排序 · ¹ 第一 / 共同第一作者 · ✉ 通讯作者','Revisions first · Then initial submission date, newest first · ¹ First/co-first · ✉ Corresponding','修正待ちを優先・その後は初回投稿日の新しい順 · ¹ 第一／共同第一 · ✉ 責任著者')};
function journalFor(r){return settings.journals.find(j=>[j.name,j.abbreviation].some(n=>n&&n.trim().toLowerCase()===r.journal.trim().toLowerCase()))}
const v3System=editorSystem;
editorSystem=function(r){return r.systemUrl&&safeUrl(r.systemUrl)?r.systemUrl:journalFor(r)?.systemUrl||v3System(r)};
const v3Card=card;
card=function(r){
 const box=document.createElement('div');box.innerHTML=v3Card(r.status==='accept'?r:{...r,citations:null});
 const j=journalFor(r),label=box.querySelector('.journal');
 label.outerHTML=`<button class="journal-label" style="--journal-color:${j?.color||'#526b83'}" data-journal="${esc(j?.id||'')}" data-journal-name="${esc(r.journal)}">${esc(r.journal)||T('期刊待定','Journal TBD','投稿先未定')}</button>`;
 if(REVISIONS.includes(r.status))box.querySelector('.card').classList.add('urgent-revision');
 return box.innerHTML;
};
function renderJournals(){
 const unmatched=[...new Set(records.map(r=>r.journal).filter(Boolean))].filter(name=>!journalFor({journal:name}));
 $('content').innerHTML=`<section class="panel"><div class="section-heading"><h2>${T('期刊与编辑系统','Journals & editorial systems','雑誌と投稿システム')}</h2>${btn('＋ '+T('添加期刊','Add journal','雑誌を追加'),'data-new-journal',true)}</div><p class="note">${T('期刊颜色、IF、CiteScore 与投稿链接均可维护。指标请记录年份和更新日期。系统网址不能仅靠稿件前缀猜测；OE 使用 oe，MS 使用 mastr。','Maintain journal colors, IF, CiteScore and system links, with metric years and dates. A manuscript prefix is not a reliable URL: OE uses oe, while MS uses mastr.','色・IF・CiteScore・投稿先URLを管理できます。指標の年・更新日を記録してください。番号の接頭辞だけでURLは推定できません（OEはoe、MSはmastr）。')}</p></section><div class="journal-grid">${settings.journals.map(j=>`<section class="journal-tile" style="--journal-color:${j.color}"><div class="journal-band"><h2>${esc(j.name)}</h2><span>${esc(j.abbreviation)}</span></div><div class="journal-info"><div class="metrics-small"><div><strong>${j.impactFactor===''||j.impactFactor==null?'—':esc(j.impactFactor)}</strong><small>Impact Factor</small></div><div><strong>${j.citeScore===''||j.citeScore==null?'—':esc(j.citeScore)}</strong><small>CiteScore</small></div></div><p class="note">${T('指标年份','Metric year','指標の年')}: ${esc(j.metricsYear)||'—'} · ${txt.updated()}: ${esc(j.metricsDate)||'—'}</p><div class="actions">${btn(txt.edit(),`data-journal="${esc(j.id)}"`)}${j.systemUrl?`<a class="btn" href="${esc(j.systemUrl)}" target="_blank" rel="noopener noreferrer">${T('投稿 / 审稿','Submit / review','投稿・査読')} ↗</a>`:''}${j.homepage?`<a class="linkbtn" href="${esc(j.homepage)}" target="_blank" rel="noopener noreferrer">${T('期刊主页','Journal website','雑誌サイト')} ↗</a>`:''}</div></div></section>`).join('')}</div>${unmatched.length?`<section class="panel"><h2>${T('投稿中使用的其他期刊','Other journals in your submissions','投稿で使用した他の雑誌')}</h2>${unmatched.map(name=>btn(esc(name),`data-journal="" data-journal-name="${esc(name)}"`)).join(' ')}</section>`:''}`;
}
function editJournal(id,name=''){
 const j=settings.journals.find(j=>j.id===id)||{name,color:'#526b83'};
 modal('journalEdit',T('编辑期刊资料','Edit journal information','雑誌情報を編集'),`<form id="journalForm"><div class="form-grid">${field('j-name',txt.journal(),j.name,'text','required')}${field('j-abbreviation',T('简称','Abbreviation','略称'),j.abbreviation)}${field('j-color',T('主题颜色','Theme color','テーマカラー'),j.color,'color')}${field('j-systemUrl',T('投稿 / 审稿系统 URL','Editorial system URL','投稿・査読システムURL'),j.systemUrl,'url')}${field('j-homepage',T('期刊主页','Journal website','雑誌サイト'),j.homepage,'url')}${field('j-impactFactor','Impact Factor',j.impactFactor,'number','step="any"')}${field('j-citeScore','CiteScore',j.citeScore,'number','step="any"')}${field('j-metricsYear',T('指标年份','Metric year','指標の年'),j.metricsYear)}${field('j-metricsDate',txt.updated(),j.metricsDate,'date')}</div><p class="note">${T('修改期刊名称不会改写已有论文中的期刊名。建议保持名称一致，必要时逐篇修正。','Renaming a journal does not rewrite names in existing papers. Keep names consistent or update papers individually.','雑誌名を変更しても既存論文の雑誌名は変更しません。名称を一致させてください。')}</p><div class="modal-foot">${btn(txt.cancel(),'type="button" data-close="journalEdit"')}${btn(txt.save(),'type="submit"',true)}</div></form>`);
 for(const k of ['impactFactor','citeScore'])$('j-'+k).step='any';
 $('journalForm').onsubmit=e=>{
  e.preventDefault();const next={...j,id:j.id||uid()};
  for(const k of ['name','abbreviation','color','systemUrl','homepage','impactFactor','citeScore','metricsYear','metricsDate'])next[k]=$('j-'+k).value.trim();
  const updated=clone(settings),idx=updated.journals.findIndex(x=>x.id===next.id);if(idx<0)updated.journals.push(next);else updated.journals[idx]=next;
  if(writeAll(records,library,profile,{nextSettings:updated})){$('journalEdit').close();render();toast(T('期刊资料已保存','Journal saved','雑誌情報を保存しました'))}
 };
}
const v3Editor=openEditor;
openEditor=function(id=null,source=null){
 v3Editor(id,source);
 $('authorRows').previousElementSibling.insertAdjacentHTML('beforeend',btn(T('文字 / 图片导入','Import text / image','テキスト・画像から取込'),'type="button" data-author-import="paper"'));
 $('citations').closest('.field').classList.toggle('hidden',$('status').value!=='accept');
 $('citationSource').closest('.field').classList.toggle('hidden',$('status').value!=='accept');
 $('citationDate').closest('.field').classList.toggle('hidden',$('status').value!=='accept');
 const change=$('status').onchange;
 $('status').onchange=()=>{change();for(const k of ['citations','citationSource','citationDate'])$(k).closest('.field').classList.toggle('hidden',$('status').value!=='accept')};
 $('submitted').addEventListener('change',()=>{const input=$('round-0-submitted');if(input&&!input.value){input.value=$('submitted').value;input.dispatchEvent(new Event('change',{bubbles:true}))}});
 $('journal').setAttribute('list','journals');
 for(const j of settings.journals){const o=document.createElement('option');o.value=j.name;$('journals').append(o)}
 editorBaseline=editorFingerprint();
};
const v3DrawRounds=drawRounds;
drawRounds=function(){
 v3DrawRounds();
 $('roundRows').querySelectorAll('[data-round-index]').forEach(row=>{
  const sub=row.querySelector('[data-key="submitted"]'),we=row.querySelector('[data-key="we"]');
  const label=we.previousElementSibling;label.insertAdjacentHTML('afterend',`<small class="note">${T('默认与本轮提交同日；可单独修改','Defaults to the submission date; editable','提出日と同日が既定値・変更可')}</small>`);
  const previous=sub.value;
  sub.dataset.previous=previous;
  sub.addEventListener('change',()=>{
   if(!we.value||we.value===sub.dataset.previous)we.value=sub.value;
   sub.dataset.previous=sub.value;
  });
  if(!we.value&&sub.value){we.value=sub.value;we.dataset.defaulted='true'}
 });
};
const v3SavePaper=savePaper;
savePaper=function(e){
 // Defaults apply only to empty values; existing distinct submission/WE dates are retained.
 if($('status').value!=='waiting'&&!$('roundRows').querySelector('[data-round-index]')){
  roundDraft=[{...emptyRound(1),submitted:$('submitted').value||$('stageDate').value,we:$('submitted').value||$('stageDate').value}];drawRounds();
 }
 if(!$('submitted').value&&$('round-0-submitted')?.value)$('submitted').value=$('round-0-submitted').value;
 return v3SavePaper(e);
};
const v3Detail=showDetail;
showDetail=function(id){
 v3Detail(id);const r=records.find(x=>x.id===id);if(!r)return;
 if(r.status!=='accept'){$('detailBody').querySelectorAll(':scope > p').forEach(p=>{if(p.textContent.startsWith(txt.citations()+':'))p.remove()})}
};
let durationSources=new Map();
function durationSamples(rs){
 const out={we:[],ur:[],rrc:[],accepted:[]};
 for(const r of rs){
  for(const q of r.rounds)for(const [key,a,b] of [['we','we','ur'],['ur','ur','rrc'],['rrc','rrc','decisionDate']]){
   const days=interval(q[a],q[b]);if(days!==null)out[key].push({paper:r.title,id:r.id,round:q.index,start:q[a],end:q[b],days});
  }
  if(r.status==='accept'){const days=interval(r.submitted,r.accepted);if(days!==null)out.accepted.push({paper:r.title,id:r.id,round:null,start:r.submitted,end:r.accepted,days})}
 }return out;
}
function sampleLabel(s){return `${s.paper}${s.round?' · '+txt.round()+' '+s.round:''}\n${s.start} → ${s.end}: ${s.days} ${T('天','days','日')}`}
const v3Stats=renderStats;
renderStats=function(){
 v3Stats();durationSources=new Map();const panel=$('content').querySelector('.panel');
 const journals=[...new Set(records.map(r=>r.journal).filter(Boolean))].sort();
 panel.querySelector('tbody').innerHTML=journals.map((name,i)=>{
  const samples=durationSamples(records.filter(r=>r.journal===name));
  return `<tr><td>${esc(name)}</td>${['we','ur','rrc','accepted'].map(k=>{
   const arr=samples[k],key=`${i}-${k}`;durationSources.set(key,arr);
   return `<td>${arr.length?`<button class="duration-source" data-duration="${key}" title="${esc(arr.map(sampleLabel).join('\n\n'))}">${avg(arr.map(s=>s.days)).toFixed(1)} ${T('天','days','日')}<small>n = ${arr.length} ⓘ</small></button>`:'—'}</td>`;
  }).join('')}</tr>`;
 }).join('')||`<tr><td colspan="5">${T('暂无数据','No data yet','データなし')}</td></tr>`;
 panel.insertAdjacentHTML('beforeend',`<p class="note">${T('悬停数字查看每个样本；点击可展开论文、轮次、起止日期和具体用时。','Hover over a value for individual samples; click for the paper, round, dates and exact duration.','数値にカーソルを合わせると各サンプルを表示。クリックで論文・ラウンド・日付・日数を確認できます。')}</p>`);
 const citationSection=[...$('content').querySelectorAll('.panel')].at(-1);
 citationSection.querySelector('.note').textContent=T('只展示已录用论文，按论文去重；引用次数手动更新。','Accepted papers only, deduplicated by paper; citation counts are updated manually.','採択済み論文のみ、論文ごとに重複を除外。引用数は手動更新です。');
};
function durationModal(key){
 const samples=durationSources.get(key)||[];
 modal('durationDetail',T('统计数据来源','Underlying samples','統計データの内訳'),samples.map(s=>`<div class="library-item"><h3>${esc(s.paper)}</h3><p>${s.round?txt.round()+' '+s.round:'—'} · ${s.start} → ${s.end}</p><strong>${s.days} ${T('天','days','日')}</strong></div>`).join(''));
}
const v3Authors=renderAuthors;
renderAuthors=function(){
 v3Authors();
 $('content').querySelector('.section-heading').insertAdjacentHTML('beforeend',btn(T('文字 / 图片导入','Import text / image','テキスト・画像から取込'),'data-author-import="library"'));
 const enhance=()=>{$('libraryList').querySelectorAll('[data-library-edit]').forEach(b=>{
  const id=b.dataset.libraryEdit;b.parentElement.insertAdjacentHTML('beforeend',`${btn(T('合并','Merge','統合'),`data-merge-author="${esc(id)}"`)}${btn(txt.remove(),`data-remove-author="${esc(id)}"`)}`);
 });};
 const paint=$('librarySearch').oninput;$('librarySearch').oninput=()=>{paint();enhance()};enhance();
};
function deleteAuthor(id){
 const a=library.find(p=>p.id===id);if(!a)return;
 if(!confirm(T(`从作者库删除“${a.name}”？已有论文中的署名保持不变。`,`Remove "${a.name}" from the library? Existing paper credits are retained.`,`著者庫から「${a.name}」を削除しますか？既存論文の署名は維持します。`)))return;
 if(writeAll(records,library.filter(p=>p.id!==id)))render();
}
function mergeAuthorRecords(sourceId,targetId){
 const source=library.find(a=>a.id===sourceId),target=library.find(a=>a.id===targetId);
 if(!source||!target||sourceId===targetId)fail('请选择两个不同作者','Select two different authors','異なる著者を2人選択してください');
 const merged={...target};for(const k of PERSON_FIELDS)if(!merged[k]&&source[k])merged[k]=source[k];
 const next=records.map(r=>{
  let touched=false;const authors=[];
  for(const a of r.authors){
   const matches=a.id===source.id||a.id===target.id||personKey(a)===personKey(source)||personKey(a)===personKey(target);
   const candidate=matches?{...a,...merged,first:a.first,corresponding:a.corresponding}:a;
   if(matches)touched=true;
   const existing=matches?authors.find(x=>x.id===merged.id):null;
   if(existing){existing.first=existing.first||candidate.first;existing.corresponding=existing.corresponding||candidate.corresponding}
   else authors.push({...candidate});
  }
  return touched?{...r,authors,updated:today(),history:[...r.history,{date:today(),status:r.status,text:T('合并作者资料：','Merged author records: ','著者を統合：')+source.name+' → '+target.name}]}:r;
 });
 return {records:next,authors:library.filter(a=>a.id!==sourceId).map(a=>a.id===targetId?merged:a)};
}
function mergeAuthorDialog(id){
 const source=library.find(a=>a.id===id);if(!source)return;
 modal('mergeAuthors',T('合并重复作者','Merge duplicate authors','重複著者を統合'),`<p>${T('将以下作者合并到另一条记录：','Merge this author into another record:','この著者を別の記録に統合します：')} <b>${esc(source.name)}</b></p>${select('mergeTarget',T('保留的作者记录','Record to retain','残す著者記録'),[['','—'],...library.filter(a=>a.id!==id).map(a=>[a.id,`${a.name} · ${a.email||a.institution||'—'}`])])}<div id="mergePreview" class="panel"></div><p class="note">${T('冲突字段保留目标记录的值，目标空白处由来源补充。已有关联论文会更新作者标识；同篇重复作者合并，保留最早顺序并合并一作/通讯标记。请核对同名者确为同一人。','Conflicts keep the target value; blank target fields are filled from the source. Paper credits are relinked, duplicates keep the earliest position and combine roles. Confirm that these are the same person.','競合時は統合先を優先、空欄を補完します。論文の参照も更新し、重複は最初の順序・役割を保持します。同姓同名の別人でないか確認してください。')}</p><div class="modal-foot">${btn(txt.cancel(),'data-close="mergeAuthors"')}${btn(T('确认合并','Confirm merge','統合を確認'),'id="mergeConfirm"',true)}</div>`);
 $('mergeTarget').onchange=()=>{const target=library.find(a=>a.id===$('mergeTarget').value);$('mergePreview').innerHTML=target?`<table><tbody>${PERSON_FIELDS.map(k=>`<tr><th>${txt[k]()}</th><td>${esc(source[k])||'—'}</td><td>→ ${esc(target[k]||source[k])||'—'}</td></tr>`).join('')}</tbody></table>`:''};
 $('mergeConfirm').onclick=()=>{try{const next=mergeAuthorRecords(id,$('mergeTarget').value);if(writeAll(next.records,next.authors)){$('mergeAuthors').close();render()}}catch(err){alert(err.message)}};
}
const v3Profile=renderProfile;
renderProfile=function(){
 v3Profile();if(!profile)return;
 const metrics=$('content').querySelector('.profile-columns .metrics-small');
 [...metrics.children].slice(3).forEach(el=>el.remove());
 for(const k of ['citingArticles','withoutSelf'])$('p-'+k)?.closest('.field').remove();
 const source=$('p-metricsSource'),sourceField=source.closest('.field');
 sourceField.innerHTML=select('p-metricsSource',txt.source(),[['Scopus','Scopus']],'Scopus').replace(/^<div class="field">|<\/div>$/g,'');
 const note=metrics.parentElement.querySelector('.note');
 note.textContent=(profile.metricsSource==='Scopus'?'Scopus':T('Scopus 来源待确认；原有数值保留，请核对后保存','Scopus source not yet confirmed; existing values are retained. Verify before saving.','Scopusの出典未確認。元の数値を保持しています。確認して保存してください。'))+' · '+txt.updated()+': '+(profile.metricsDate||'—');
 const help=$('profileForm').querySelector('.note');
 help.textContent=T('本版仅维护 Scopus 的文献数、引用次数和 h-index。关联 ID 是主页入口，暂不自动抓取；原来的其他指标保留在备份中。','This version maintains Scopus publications, citations and h-index manually. Linked IDs open profile pages; automatic scraping is not enabled. Other legacy metrics remain in backups.','Scopusの論文数・被引用数・h-indexのみ手動管理します。IDはプロフィールへのリンクです。自動取得は未実装で、旧指標はバックアップに保持します。');
};
let rememberChoice=null;
function rememberedAccount(){
 try{const r=JSON.parse(localStorage.getItem(REMEMBER_KEY)||'null');return !!(r&&profile&&r.username===profile.username&&r.tag===profile.hash&&r.expires>Date.now())}catch{return false}
}
const v3Enter=enterWorkspace;
enterWorkspace=function(){
 if(profile&&rememberChoice!==null){
  try{if(rememberChoice)localStorage.setItem(REMEMBER_KEY,JSON.stringify({username:profile.username,tag:profile.hash,expires:Date.now()+30*86400000}));else localStorage.removeItem(REMEMBER_KEY)}catch{toast(T('浏览器未能保存登录偏好','Could not save sign-in preference','ログイン設定を保存できませんでした'))}
 }rememberChoice=null;v3Enter();
};
const v3Login=showLogin;
showLogin=function(){
 v3Login();document.querySelector('.auth-panel .language-globe')?.remove();
 document.querySelector('.auth-art > p').textContent='投个好稿 · Dear Editor · まだ査読中';
 const form=$('authForm'),submit=form.onsubmit;
 form.querySelector('button[type=submit]').insertAdjacentHTML('beforebegin',`<label class="remember-option"><input id="rememberLogin" type="checkbox" ${rememberedAccount()?'checked':''}>${T('记住我 / 本机保持登录 30 天','Remember me / stay signed in for 30 days','ログインを30日間保持')}</label><p class="note">${T('不保存明文密码。若需自动填入密码，可使用浏览器自带的密码管理器；退出登录会取消本机记忆。','No plaintext password is stored. Use your browser password manager for password autofill. Logging out clears this preference.','平文パスワードは保存しません。自動入力にはブラウザのパスワード管理を使えます。ログアウトで保持設定を解除します。')}</p>`);
 form.onsubmit=async e=>{rememberChoice=$('rememberLogin').checked;await submit(e);rememberChoice=null};
};
function renderFeedback(){
 const f=settings.feedback;
 $('content').innerHTML=`<section class="feedback-hero"><div class="eyebrow">DEAR RESEARCHER</div><h2>${T('你的建议，让投稿之路更顺一点。','Your feedback makes the research journey better.','ご意見が研究の道のりをよりよくします。')}</h2><p>${T('欢迎反馈问题、分享想法，也欢迎支持这个小工具。','Questions, ideas and support are always welcome.','不具合・アイデア・ご支援を歓迎します。')}</p></section><div class="profile-columns"><section class="panel"><h2>${T('联系作者','Contact the developer','開発者への連絡')}</h2><div class="contact-list"><p><small>${txt.email()}</small><a href="mailto:${esc(f.email||'yanghuaisong@hrbeu.edu.cn')}">${esc(f.email||'yanghuaisong@hrbeu.edu.cn')}</a></p><p><small>${txt.phone()}</small><span>${esc(f.phone)||T('待提供','Not provided','未設定')}</span></p><p><small>${T('微信','WeChat','WeChat')}</small><span>${esc(f.wechat)||T('待提供','Not provided','未設定')}</span></p></div>${btn(T('编辑联系方式与支持信息','Edit contact & support details','連絡・支援情報を編集'),'data-edit-feedback')}</section><section class="panel"><h2>${T('欢迎支持','Support this project','ご支援について')}</h2><p class="notes">${esc(f.welcome)||T('如果这个工具让你的投稿管理轻松了一点，欢迎分享给同事，也欢迎请开发者喝杯咖啡。','If this tool helps, share it with colleagues or support the developer with a coffee.','役立ちましたら同僚への紹介や、開発者へのコーヒーのご支援を歓迎します。')}</p><div class="support-codes">${[['wechatQr',T('微信支持','WeChat support','WeChat支援')],['alipayQr',T('支付宝支持','Alipay support','Alipay支援')]].map(([k,n])=>`<div><h3>${n}</h3>${f[k]?`<img src="${esc(f[k])}" alt="${n}">`:`<div class="qr-placeholder">${T('尚未上传收款码','No QR code uploaded','QRコード未登録')}</div>`}</div>`).join('')}</div></section></div>`;
}
function editFeedback(){
 const f=settings.feedback;
 modal('feedbackEdit',T('联系与支持信息','Contact & support details','連絡・支援情報'),`<form id="feedbackForm"><div class="form-grid">${field('f-email',txt.email(),f.email,'email','required')}${field('f-phone',txt.phone(),f.phone)}${field('f-wechat','WeChat',f.wechat)}</div><label for="f-welcome" style="margin-top:15px">${T('欢迎支持文案','Support message','支援メッセージ')}</label><textarea id="f-welcome">${esc(f.welcome)}</textarea><div class="form-grid" style="margin-top:15px">${[['wechatQr','WeChat'],['alipayQr','Alipay']].map(([k,n])=>`<div class="field"><label for="f-${k}">${n} QR · PNG / JPG / WebP ≤ 1MB</label><input id="f-${k}" type="file" accept="image/png,image/jpeg,image/webp"><label class="remember-option"><input type="checkbox" id="f-remove-${k}">${T('移除现有图片','Remove current image','現在の画像を削除')}</label></div>`).join('')}</div><p class="note">${T('联系方式和收款码仅保存在本地设置及备份中。','Contact details and QR images are stored in local settings and backups.','連絡先・QR画像はローカル設定とバックアップに保存されます。')}</p><p id="feedbackError" class="auth-error"></p><div class="modal-foot">${btn(txt.cancel(),'type="button" data-close="feedbackEdit"')}${btn(txt.save(),'type="submit"',true)}</div></form>`);
 $('feedbackForm').onsubmit=async e=>{
  e.preventDefault();e.submitter.disabled=true;
  try{
   const next=clone(settings),value=next.feedback;for(const k of ['email','phone','wechat','welcome'])value[k]=$('f-'+k).value.trim();
   for(const k of ['wechatQr','alipayQr']){
    if($('f-remove-'+k).checked)value[k]='';
    const file=$('f-'+k).files[0];if(file){if(file.size>1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))fail('请使用 1MB 内的 PNG/JPG/WebP 图片','Use PNG/JPG/WebP images up to 1MB','1MB以下のPNG/JPG/WebPを使用してください');value[k]=await readDataUrl(file)}
   }
   if(writeAll(records,library,profile,{nextSettings:next})){$('feedbackEdit').close();renderFeedback()}
  }catch(err){$('feedbackError').textContent=err.message}finally{e.submitter.disabled=false}
 };
}
function readDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Image read failed'));reader.readAsDataURL(file)})}
const v3Backup=renderBackup;
renderBackup=function(){
 v3Backup();
 const panels=$('content').querySelectorAll('.panel');panels[panels.length-1].remove();
 $('snapshotExport').onclick=()=>{const raw=localStorage.getItem('gaoji.before-v4')||localStorage.getItem('gaoji.before-v3');if(raw)download(raw,'DearEditor-before-upgrade.json');else toast(T('首次保存后生成快照','Snapshot is created on first save','初回保存時に作成されます'))};
 $('rawExport').onclick=()=>download(JSON.stringify({app:'gaoji',version:4,rawRecords:localStorage.getItem(KEY),rawProfile:localStorage.getItem(PROFILE_KEY),rawAuthors:localStorage.getItem(AUTHORS_KEY),settings},null,2),'DearEditor-raw-'+today()+'.json');
 $('export').onclick=()=>download(JSON.stringify(backupObject(),null,2),'DearEditor-backup-'+today()+'.json');
 $('content').insertAdjacentHTML('beforeend',`<section class="panel"><h2>${T('本次更新','This update','今回の更新')}</h2><p class="note">${T('完整备份现在还包含期刊资料、主题颜色、联系方式和支持图片。登录记忆不导出。旧版隐藏指标仍留在个人资料中。','Full backups also include journal metadata, colors, contact information and support images. Remembered sign-in is not exported. Hidden legacy metrics remain in the profile.','雑誌情報・色・連絡情報・支援画像もバックアップに含みます。ログイン保持設定は書き出しません。旧指標はプロフィールに保持します。')}</p></section>`);
};
let importTarget='paper',parsedAuthors=[],ocrWorker=null,ocrCancelled=false,ocrRun=0;
function parseAuthorText(text){
 const superDigits={'¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁰':'0'};
 const normal=text.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g,c=>superDigits[c]).replace(/\r/g,'')
  .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1')
  .replace(/(\d)[”"]\s*(?=[\u3400-\u9fff])/g,'$1, ');
 const lines=normal.split('\n').map(l=>l.trim()).filter(Boolean),affiliations={},authorLines=[],emails=[];
 for(const line of lines){
  const mail=line.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/ig);
  if(mail&&(/^(e-?mail|email|correspond|通讯|通信)/i.test(line)||line.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/ig,'').trim().length<5)){emails.push(...mail);continue}
  const aff=line.match(/^([a-z]|\d+)[.)\s]\s*(.+)$/);
  if(aff&&/(university|institute|school|college|department|laboratory|academy|center|centre|大学|学院|研究|中心|实验室)/i.test(aff[2])){affiliations[aff[1]]=aff[2];continue}
  if(/^(\*|†|‡)?\s*(corresponding|通讯作者|通信作者)/i.test(line))continue;
  authorLines.push(line.replace(/^(authors?|作者)\s*[:：]\s*/i,''));
 }
 const pieces=authorLines.join(';').split(/[;；,，、]/).map(x=>x.trim()).filter(Boolean),tokens=[];
 for(const p of pieces){if(/^[a-z\d*†‡\s]+$/.test(p)&&p.length<8&&tokens.length)tokens[tokens.length-1]+=' '+p;else tokens.push(p)}
 const result=[];
 for(let token of tokens){
  token=token.replace(/^\s*and\s+/i,'').trim();if(!token)continue;
  const corresponding=/[*✉]/.test(token)||/\((corresponding|通讯)\)/i.test(token);
  const markers=(token.match(/(?:\s+|(?<=[\u3400-\u9fff]))([a-z\d](?:[\s,]+[a-z\d])*|[a-z\d]+)(?=[*†‡\s]*$)/)?.[1]||token.match(/(\d+)(?=[*†‡\s]*$)/)?.[1]||'').split(/[\s,]+/).filter(m=>Object.hasOwn(affiliations,m)||/^\d+$/.test(m)||/^[a-z]$/.test(m));
  let name=token.replace(/\((corresponding|通讯)\)/ig,'').replace(/[*✉†‡]/g,'').trim();
  if(markers.length){const suffix=new RegExp('\\s*'+markers.join('[\\s,]*')+'\\s*$');name=name.replace(suffix,'').trim()}
  if(!name||/^\d+$/.test(name))continue;
  result.push({id:uid(),name,first:result.length===0,corresponding,lastName:'',firstName:'',email:'',institution:[...new Set(markers.map(m=>affiliations[m]).filter(Boolean))].join('; '),department:''});
 }
 const correspondents=result.filter(a=>a.corresponding);if(correspondents.length===1&&emails.length===1)correspondents[0].email=emails[0];
 return result;
}
function authorImport(target){
 importTarget=target;parsedAuthors=[];ocrCancelled=false;
 modal('authorImport',T('识别作者信息','Recognize author information','著者情報を読み取る'),`<p class="note">${T('粘贴作者行及机构行，或选择论文首页截图。识别后请核对顺序、通讯标记和机构，再确认导入。英文姓/名不从完整姓名强行猜测。','Paste author and affiliation lines, or select a screenshot. Review order, corresponding-author markers and institutions before importing. Registered first/last names are not guessed from full names.','著者・所属行を貼り付けるか画像を選択。順序・責任著者・所属を確認してから取込みます。登録用の姓・名は推測しません。')}</p><label for="authorText">${T('作者与机构文字','Authors and affiliations','著者と所属のテキスト')}</label><textarea id="authorText" rows="7" placeholder="Yang Huaisong1*, Ma Gang1, Chen Hailong2&#10;1 Harbin Engineering University&#10;2 Example University&#10;Email: name@example.org"></textarea><div class="actions" style="margin-top:12px">${btn(T('识别文字','Parse text','テキストを解析'),'id="parseAuthors"',true)}<label class="btn" for="authorImage">${T('选择图片进行 OCR','Choose image for OCR','画像からOCR')}</label><input id="authorImage" type="file" accept="image/png,image/jpeg,image/webp" hidden>${btn(T('停止识别','Stop OCR','OCRを停止'),'id="stopOcr" disabled')}</div><p class="note">${T('图片 OCR 首次使用需要联网下载识别组件与语言包；图片在浏览器本机处理，不上传到识别服务器。支持英文和简体中文，复杂排版可能需要人工修正。','Image OCR downloads its engine and language packs on first use. Images are processed in this browser, not uploaded to an OCR server. English and Simplified Chinese are supported; complex layouts may need corrections.','初回OCRはエンジンと言語データのダウンロードにネット接続が必要です。画像はブラウザ内で処理し、OCRサーバーに送信しません。英語・簡体字に対応し、複雑なレイアウトは修正が必要です。')}</p><p id="ocrStatus" role="status"></p><div id="importPreview"></div><div class="modal-foot">${btn(txt.cancel(),'data-close="authorImport"')}${btn(T('确认导入已勾选作者','Import selected authors','選択した著者を取り込む'),'id="confirmAuthorImport" disabled',true)}</div>`);
 $('parseAuthors').onclick=()=>{parsedAuthors=parseAuthorText($('authorText').value);drawImportPreview()};
 $('authorText').insertAdjacentHTML('afterend',select('ocrLanguage',T('图片识别语言','Image recognition language','画像の認識言語'),[['eng','English'],['chi_sim',T('简体中文','Simplified Chinese','簡体字中国語')]],'eng'));
 $('authorImage').onchange=async e=>{const file=e.target.files[0];if(file)await recognizeAuthors(file)};
 $('stopOcr').onclick=stopOcr;
 $('confirmAuthorImport').onclick=confirmAuthorImport;
}
function drawImportPreview(){
 $('importPreview').innerHTML=parsedAuthors.map((a,i)=>`<section class="author-row" data-import-index="${i}"><div class="author-heading"><label><input type="checkbox" data-key="include" checked>${i+1}. ${T('导入此作者','Include author','この著者を取込')}</label><label><input type="checkbox" data-key="first" ${a.first?'checked':''}>${T('一作 / 共同一作','First / co-first','第一／共同第一')}</label><label><input type="checkbox" data-key="corresponding" ${a.corresponding?'checked':''}>${T('通讯作者','Corresponding','責任著者')}</label></div><div class="form-grid">${['name','institution','email','lastName','firstName'].map(k=>field(`import-${i}-${k}`,txt[k](),a[k],k==='email'?'email':'text',`data-key="${k}"`)).join('')}</div></section>`).join('')||`<p>${T('未识别到作者，请检查文字格式。','No authors detected. Check the text format.','著者が見つかりません。書式を確認してください。')}</p>`;
 $('confirmAuthorImport').disabled=!parsedAuthors.length;
}
function confirmAuthorImport(){
 try{
  const selected=[...$('importPreview').querySelectorAll('[data-import-index]')].filter(row=>row.querySelector('[data-key="include"]').checked).map(row=>{
   const a={...parsedAuthors[Number(row.dataset.importIndex)]};row.querySelectorAll('[data-key]').forEach(e=>{if(e.dataset.key!=='include')a[e.dataset.key]=e.type==='checkbox'?e.checked:e.value.trim()});return person(a);
  });
  if(!selected.length)return;
  if(importTarget==='paper'){
   authorDraft=readAuthors();
   for(const a of selected)if(!authorDraft.some(p=>personKey(p)===personKey(a)))authorDraft.push(a);
   drawAuthors();$('authorImport').close();
  }else if(writeAll(records,mergePeople(library,selected))){$('authorImport').close();renderAuthors()}
 }catch(err){alert(err.message)}
}
async function loadOcr(){
 if(window.Tesseract)return;
 await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error(T('OCR 组件下载失败，请检查网络或粘贴文字导入','OCR download failed. Check your network or paste text instead.','OCRをダウンロードできません。ネット接続を確認するかテキストを使用してください。')))};document.head.append(s)});
}
async function stopOcr(){
 ocrCancelled=true;ocrRun++;const worker=ocrWorker;ocrWorker=null;if(worker)try{await worker.terminate()}catch{}
 if($('stopOcr'))$('stopOcr').disabled=true;
}
async function recognizeAuthors(file){
 if(file.size>12*1024*1024){alert(T('图片请小于 12MB','Use an image smaller than 12MB','12MB未満の画像を使用してください'));return}
 await stopOcr();const run=++ocrRun;ocrCancelled=false;$('stopOcr').disabled=false;$('authorImage').disabled=true;let activeWorker=null;
 try{
  $('ocrStatus').textContent=T('正在准备本地 OCR…','Preparing browser OCR…','ブラウザOCRを準備中…');
  await loadOcr();if(ocrCancelled||run!==ocrRun)return;
  const ocrLanguage=$('ocrLanguage').value;
  const worker=await Tesseract.createWorker(ocrLanguage,1,{
   workerPath:'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js',
   corePath:'https://unpkg.com/tesseract.js-core@5.1.1',
   langPath:`https://unpkg.com/@tesseract.js-data/${ocrLanguage}@1.0.0/4.0.0_best_int`,
   errorHandler:error=>{if(run===ocrRun&&$('authorImport').open)$('ocrStatus').textContent=String(error)},
   logger:m=>{if($('authorImport').open&&!ocrCancelled&&run===ocrRun)$('ocrStatus').textContent=T('识别中','Recognizing','認識中')+' · '+Math.round((m.progress||0)*100)+'%'}
  });
  activeWorker=worker;if(ocrCancelled||run!==ocrRun){await worker.terminate();activeWorker=null;return}ocrWorker=worker;
  const {data}=await worker.recognize(file);if(ocrCancelled||run!==ocrRun||!$('authorImport').open)return;
  $('authorText').value=data.text;parsedAuthors=parseAuthorText(data.text);drawImportPreview();
  $('ocrStatus').textContent=T('识别完成。请先核对文字和作者预览。','OCR complete. Review the text and authors before importing.','OCRが完了しました。テキストと著者を確認してください。');
 }catch(err){if(!ocrCancelled&&run===ocrRun)$('ocrStatus').textContent=T('识别失败：','OCR failed: ','OCR失敗：')+err.message}
 finally{if(activeWorker)try{await activeWorker.terminate()}catch{}if(run===ocrRun){ocrWorker=null;$('authorImage').disabled=false;$('stopOcr').disabled=true}else if(ocrCancelled){$('authorImage').disabled=false}}
}
$('authorImport').addEventListener('close',stopOcr);
document.addEventListener('click',e=>{
 const b=e.target.closest('button,a');if(!b)return;
 if(b.hasAttribute('data-journal'))editJournal(b.dataset.journal,b.dataset.journalName||'');
 if(b.hasAttribute('data-new-journal'))editJournal('');
 if(b.dataset.duration)durationModal(b.dataset.duration);
 if(b.dataset.removeAuthor)deleteAuthor(b.dataset.removeAuthor);
 if(b.dataset.mergeAuthor)mergeAuthorDialog(b.dataset.mergeAuthor);
 if(b.hasAttribute('data-edit-feedback'))editFeedback();
 if(b.dataset.authorImport)authorImport(b.dataset.authorImport);
 if(b.hasAttribute('data-logout')){try{localStorage.removeItem(REMEMBER_KEY)}catch{}if($('rememberLogin'))$('rememberLogin').checked=false}
});
// The latest upgrade module starts the interface.


'use strict';
// UI upgrades retain the same records/profile/library/settings storage keys.
const ACTIVE_STATES=['waiting','we','ur','rrc','revision','accept','reject'];
S.revision=['待返修','Revision required','修正待ち'];
S.withdraw=['历史归档','Archived legacy record','旧記録アーカイブ'];
const oldMigrate=migrate;
migrate=function(data){return oldMigrate(data).map(r=>{
 if(['major','minor'].includes(r.status)){r.previousRevisionType=r.previousRevisionType||r.status;r.status='revision'}
 return r;
})};
if(!loadError)records=migrate(records);
stateName=function(s){return ['major','minor'].includes(s)?T(...S.revision):S[s]?T(...S[s]):s};
statusOptions=function(){return ACTIVE_STATES.map(s=>[s,stateName(s)])};
settings.institutions=settings.institutions||[];
settings.widgets=settings.widgets||{clock:true,quote:true,countdowns:true,weather:false,items:[],city:null};
const previousValidateSettings=validateSettings;
validateSettings=function(value){const s=previousValidateSettings(value);s.institutions=s.institutions||[];s.widgets=s.widgets||{clock:true,quote:true,countdowns:true,weather:false,items:[],city:null};if(!Array.isArray(s.institutions)||!Array.isArray(s.widgets.items))fail('组件或机构数据无效','Invalid widgets or institutions','設定データが不正です');for(const c of s.widgets.items)if(typeof c.title!=='string'||!dateOK(c.date)||!c.date)fail('倒计时日期无效','Invalid countdown date','予定日が不正です');if(s.widgets.city&&(!Number.isFinite(s.widgets.city.latitude)||!Number.isFinite(s.widgets.city.longitude)))fail('天气城市数据无效','Invalid weather location','都市データが不正です');return s};
let undoState=null,undoTimer=null,adminUnlocked=false,adminTimer=null,clockTimer=null,weatherCache=null,profileEditing=false,authorSort='paper';
mergePeople=function(base,people){const result=base.map(p=>({...p}));for(const raw of people){const p=person(raw);const i=result.findIndex(x=>x.id===p.id||(p.email&&x.email&&p.email.toLowerCase()===x.email.toLowerCase()));if(i<0)result.push(p);else result[i]={...result[i],...p,id:result[i].id}}return result};
const v4Write=writeAll;
writeAll=function(rs=records,people=library,p=profile,options={}){
 const before={records:clone(records),library:clone(library),profile:clone(profile),settings:clone(settings)};
 const ok=v4Write(rs,people,p,{...options,nextSettings:validateSettings(options.nextSettings||settings)});
  if(ok){undoState={...before,expires:Date.now()+15000};showUndo();setTimeout(checkDuplicates,0)}
 return ok;
};
function showUndo(){
 clearTimeout(undoTimer);$('undoNotice')?.remove();
 const bar=document.createElement('div');bar.id='undoNotice';bar.className='undo-notice';bar.setAttribute('role','status');
 bar.innerHTML=`<span>${T('操作成功，15 秒内可以撤回','Saved. Undo is available for 15 seconds.','保存しました。15秒以内に取り消せます。')}</span>${btn(T('撤回','Undo','元に戻す'),'data-undo')}`;document.body.append(bar);
 undoTimer=setTimeout(()=>{undoState=null;bar.remove()},15000);
}
function undoLast(){
 if(!undoState||Date.now()>undoState.expires)return;
 const s=undoState;
 if(v4Write(s.records,s.library,s.profile,{nextSettings:s.settings})){undoState=null;clearTimeout(undoTimer);$('undoNotice')?.remove();document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();toast(T('已撤回上一次操作','Last action undone','直前の操作を取り消しました'))}
}
['widgetSettings','countdownEdit','institutionEdit','adminAccess','citationEdit','careerEdit'].forEach(newDialog);
const v5css=document.createElement('style');v5css.textContent=`.home-widgets{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:20px 0}.home-widget{padding:19px;border:1px solid #dce6eb;border-radius:13px;background:linear-gradient(140deg,#fff,#edf5f7)}.home-widget:nth-child(2n){background:linear-gradient(140deg,#fffaf1,#f4eff9)}.home-widget h3{font-size:13px;color:#69838c;margin:0 0 10px}.home-widget strong{font-size:28px}.home-widget blockquote{margin:5px 0;font-size:15px;line-height:1.9}.home-widget small{display:block;color:#84959c}.undo-notice{position:fixed;bottom:18px;right:20px;z-index:100;background:#234e50;color:white;border-radius:12px;padding:13px 17px;display:flex;gap:14px;align-items:center;box-shadow:0 8px 30px #234e5030;max-width:92vw}.undo-notice .btn{padding:5px 12px}.duplicate-note{padding:15px;border:1px solid #e6c77e;background:#fff8e6;border-radius:10px;margin:12px 0}.career-entry{border:1px solid #dbe4e5;border-radius:8px;margin:15px 0;overflow:hidden}.career-entry header{background:#edf2f5;padding:15px;font-weight:bold}.career-entry section{padding:15px}.widget-controls{display:flex;justify-content:flex-end;margin-top:12px}.profile-edit-actions{display:flex;justify-content:flex-end;gap:10px;margin-bottom:18px}.option-row{display:flex;gap:10px;align-items:center;margin:16px 0}.option-row input{width:auto}.registered-notice{padding:15px;background:#eff5f5;border-radius:8px;margin:15px 0}`;document.head.append(v5css);
const previousShell=renderShell;
renderShell=function(){
  previousShell();
  document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('LOCAL EDITION 4.0','LOCAL EDITION 5.0');
 document.querySelector('[data-page="journals"]').insertAdjacentHTML('afterend',`<button class="nav ${page==='institutions'?'active':''}" data-page="institutions">${T('机构资料库','Institutions','所属機関')}</button>`);
 if(page==='institutions')$('pageTitle').textContent=T('机构资料库','Institutions','所属機関');
};
const previousRender=render;
render=function(){clearInterval(clockTimer);if(page==='institutions'){renderShell();renderInstitutions()}else previousRender()};
const previousOverview=renderOverview;
const QUOTES=[
 {text:'千里之行，始于足下。',author:'老子',source:'《道德经》第六十四章'},
 {text:'不积跬步，无以至千里。',author:'荀子',source:'《劝学》'},
 {text:'If I have seen further it is by standing on the shoulders of Giants.',author:'Isaac Newton',source:'Letter to Robert Hooke, 1675/76'},
 {text:'The rest is silence.',author:'William Shakespeare',source:'Hamlet, Act V, Scene II'},
 {text:'May the Force be with you.',author:'Star Wars',source:'Star Wars (1977)'},
 {text:'Stay hungry. Stay foolish.',author:'Steve Jobs（引用）',source:'Stanford commencement address, 2005; The Whole Earth Epilog'}
];
renderOverview=function(){
 previousOverview();const w=settings.widgets;
 const slot=document.createElement('section');slot.id='homeWidgetArea';
 document.querySelector('.welcome').after(slot);
 const q=QUOTES[Math.floor(Date.parse(today())/86400000)%QUOTES.length];
 slot.innerHTML=`<div class="widget-controls">${btn(T('管理首页组件','Manage widgets','ウィジェット設定'),'data-widgets')}</div><div class="home-widgets">${w.clock?`<article class="home-widget"><h3>${T('此刻','Right now','現在')}</h3><strong id="liveClock"></strong><small id="liveDate"></small></article>`:''}${w.quote?`<article class="home-widget"><h3>${T('每日一句','Daily quote','今日の言葉')}</h3><blockquote>${esc(q.text)}</blockquote><small>${esc(q.author)} · ${esc(q.source)}</small></article>`:''}${w.countdowns?(w.items||[]).map(c=>{const n=Math.ceil((Date.parse(c.date)-Date.parse(today()))/86400000);return `<article class="home-widget"><h3>${esc(c.category)||T('倒计时','Countdown','カウントダウン')}</h3><p>${esc(c.title)}</p><strong>${Math.abs(n)}</strong> ${n<0?T('天已过去','days ago','日前'):n===0?T('今天','Today','今日'):T('天后','days to go','日後')}<small>${esc(c.date)}</small><button class="linkbtn" data-countdown="${esc(c.id)}">${txt.edit()}</button></article>`}).join(''):''}${w.countdowns&&!(w.items||[]).length?`<article class="home-widget"><h3>${T('下一件期待的事','Something to look forward to','次の楽しみ')}</h3>${btn(T('添加倒计时','Add countdown','予定を追加'),'data-countdown=""')}</article>`:''}${w.weather?`<article class="home-widget"><h3>${T('当地天气','Local weather','地域の天気')} · ${esc(w.city?.name||'')}</h3><div id="weatherContent">${T('尚未选择城市','Choose a city first','都市を選択してください')}</div><button class="linkbtn" data-weather-refresh>${T('更新天气','Refresh weather','天気を更新')}</button></article>`:''}</div>`;
 if(w.clock){const tick=()=>{if(!$('liveClock'))return;const d=new Date();$('liveClock').textContent=d.toLocaleTimeString(lang==='en'?'en-GB':lang==='ja'?'ja-JP':'zh-CN',{hour12:false});$('liveDate').textContent=d.toLocaleDateString()};tick();clockTimer=setInterval(tick,1000)}
 if(w.weather&&w.city)fetchWeather();
};
function widgetSettings(){
 const w=settings.widgets;
 modal('widgetSettings',T('管理首页组件','Manage home widgets','ホームの設定'),`<form id="widgetForm">${[['clock',T('时间','Clock','時計')],['quote',T('每日一句','Daily quote','今日の言葉')],['countdowns',T('倒计时','Countdowns','カウントダウン')],['weather',T('天气（联网）','Weather (online)','天気（オンライン）')]].map(([k,n])=>`<label class="option-row"><input type="checkbox" id="widget-${k}" ${w[k]?'checked':''}>${n}</label>`).join('')}<div class="actions">${btn(T('添加倒计时','Add countdown','予定を追加'),'type="button" data-countdown=""')}</div><h3>${T('天气城市','Weather city','天気の都市')}</h3><input id="citySearch" placeholder="${T('输入城市名，例如哈尔滨','City name, e.g. Harbin','都市名（例：東京）')}"><button type="button" class="btn" id="searchCities">${T('搜索城市','Find city','都市を検索')}</button><div id="cityResults"></div><p id="cityStatus" class="note">${esc(w.city?.name||'')}</p><p class="note">${T('城市由你选择，不获取 IP 或精确定位。天气来源 Open-Meteo；无法联网时显示错误或缓存。','You choose the city. No IP lookup or precise geolocation. Weather: Open-Meteo; offline errors or cached values are shown.','都市は手動選択。IP・位置情報は取得しません。天気はOpen-Meteoを利用します。')}</p><div class="modal-foot">${btn(txt.save(),'type="submit"',true)}</div></form>`);
 let city=w.city;
 $('searchCities').onclick=async()=>{
  $('cityStatus').textContent=T('正在搜索…','Searching…','検索中…');
  try{const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language='+(['en','ja'].includes(lang)?lang:'zh')+'&name='+encodeURIComponent($('citySearch').value.trim()),{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();$('cityResults').innerHTML='';for(const c of data.results||[]){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=[c.name,c.admin1,c.country].filter(Boolean).join(' · ');b.onclick=()=>{city={name:b.textContent,latitude:c.latitude,longitude:c.longitude};$('cityStatus').textContent=city.name};$('cityResults').append(b)}$('cityStatus').textContent=T('选择一个城市','Select a city','都市を選択')+(data.results?.length?'':T('：无结果',': no matches','：該当なし'))}catch(e){$('cityStatus').textContent=T('城市搜索失败：','City search failed: ','検索失敗：')+e.message}
 };
 $('widgetForm').onsubmit=e=>{e.preventDefault();const next=clone(settings);for(const k of ['clock','quote','countdowns','weather'])next.widgets[k]=$('widget-'+k).checked;next.widgets.city=city;if(writeAll(records,library,profile,{nextSettings:next})){$('widgetSettings').close();render()}};
}
function editCountdown(id){
 const c=settings.widgets.items.find(c=>c.id===id)||{};
 modal('countdownEdit',T('倒计时','Countdown','カウントダウン'),`<form id="countdownForm"><div class="form-grid">${field('c-title',T('名称','Title','名称'),c.title,'text','required')}${field('c-category',T('自定义分类','Custom category','自由な分類'),c.category,'text','list="countdownCategories"')}<datalist id="countdownCategories"><option>${T('周末','Weekend','週末')}</option><option>${T('假期','Holiday','休暇')}</option><option>${T('项目','Project','プロジェクト')}</option><option>${T('毕业','Graduation','卒業')}</option></datalist>${field('c-date',T('目标日期','Target date','予定日'),c.date,'date','required')}</div><div class="modal-foot">${c.id?btn(txt.remove(),'type="button" id="deleteCountdown"'):''}${btn(txt.save(),'type="submit"',true)}</div></form>`);
 const save=remove=>{const next=clone(settings);next.widgets.items=next.widgets.items.filter(x=>x.id!==id);if(!remove)next.widgets.items.push({id:id||uid(),title:$('c-title').value.trim(),category:$('c-category').value.trim(),date:$('c-date').value});if(writeAll(records,library,profile,{nextSettings:next})){$('countdownEdit').close();render()}};
 $('countdownForm').onsubmit=e=>{e.preventDefault();save(false)};$('deleteCountdown')?.addEventListener('click',()=>save(true));
}
async function fetchWeather(){
 const city=settings.widgets.city;if(!city||!$('weatherContent'))return;
 const key=city.latitude+','+city.longitude;
 const display=(data,cached=false)=>{if(!$('weatherContent'))return;$('weatherContent').innerHTML=`<strong>${esc(data.temperature_2m)}°C</strong><p>${T('风速','Wind','風速')}: ${esc(data.wind_speed_10m)} km/h</p><small>${esc(data.time)} · Open-Meteo${cached?' · '+T('缓存','cached','キャッシュ'):''}</small>`};
 if(weatherCache?.key===key&&Date.now()-weatherCache.at<600000){display(weatherCache.data,true);return}
 $('weatherContent').textContent=T('天气加载中…','Loading weather…','天気を取得中…');
 try{const res=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,wind_speed_10m&timezone=auto`,{signal:AbortSignal.timeout(12000)});if(!res.ok)throw Error('HTTP '+res.status);const data=await res.json();if(!data.current)throw Error('No weather data');weatherCache={key,at:Date.now(),data:data.current};if(settings.widgets.city?.latitude===city.latitude)display(data.current)}catch(e){if($('weatherContent'))$('weatherContent').textContent=T('天气暂不可用：','Weather unavailable: ','天気を取得できません：')+e.message}
}
function allInstitutions(){return [...new Set([...(settings.institutions||[]).map(x=>x.name),...library.map(a=>a.institution),...records.flatMap(r=>r.authors.map(a=>a.institution)),profile?.institution].filter(Boolean))].sort((a,b)=>a.localeCompare(b))}
function attachInstitutionHints(){
 $('institutionSuggestions')?.remove();const dl=document.createElement('datalist');dl.id='institutionSuggestions';dl.innerHTML=allInstitutions().map(n=>`<option value="${esc(n)}"></option>`).join('');document.body.append(dl);
 document.querySelectorAll('input[id*="institution"]').forEach(e=>e.setAttribute('list',dl.id));
}
const beforeDrawAuthors=drawAuthors;drawAuthors=function(){beforeDrawAuthors();attachInstitutionHints()};
const beforeLibraryEdit=editLibrary;editLibrary=function(id){beforeLibraryEdit(id);attachInstitutionHints()};
function renderInstitutions(){
 $('content').innerHTML=`<section class="panel"><div class="section-heading"><h2>${T('常用机构','Saved institutions','よく使う所属機関')}</h2>${btn('＋ '+T('添加机构','Add institution','機関を追加'),'data-institution=""',true)}</div><p class="note">${T('作者与本人资料可从已有机构名称中选择。','Author and profile forms suggest existing institution names.','著者・プロフィールで既存の所属名を選択できます。')}</p></section>${allInstitutions().map(name=>{const item=settings.institutions.find(i=>i.name===name);return `<section class="library-item"><h3>${esc(name)}</h3><p>${esc(item?.department)} · ${esc(item?.country)}</p>${btn(txt.edit(),`data-institution="${esc(item?.id||'')}" data-institution-name="${esc(name)}"`)}</section>`}).join('')}`;
}
function editInstitution(id,name=''){
 const i=settings.institutions.find(i=>i.id===id)||{name};
 modal('institutionEdit',T('机构资料','Institution details','機関情報'),`<form id="institutionForm"><div class="form-grid">${field('i-name',txt.institution(),i.name,'text','required')}${field('i-department',txt.department(),i.department)}${field('i-country',T('国家 / 地区','Country / region','国・地域'),i.country)}${field('i-website',T('网站','Website','サイト'),i.website,'url')}</div><div class="modal-foot">${btn(txt.save(),'type="submit"',true)}</div></form>`);
 $('institutionForm').onsubmit=e=>{e.preventDefault();const next=clone(settings),item={id:id||uid(),name:$('i-name').value.trim(),department:$('i-department').value.trim(),country:$('i-country').value.trim(),website:$('i-website').value.trim()};next.institutions=next.institutions.filter(x=>x.id!==id);next.institutions.push(item);if(writeAll(records,library,profile,{nextSettings:next})){$('institutionEdit').close();renderInstitutions()}};
}
function splitEnglishName(name){
 const clean=name.trim();if(!/^[A-Za-zÀ-ž .,'’\-]+$/.test(clean))return {firstName:'',lastName:''};
 if(clean.includes(',')){const [last,...first]=clean.split(',');return {lastName:last.trim(),firstName:first.join(' ').trim()}}
 const parts=clean.split(/\s+/);return parts.length>1?{firstName:parts.slice(0,-1).join(' '),lastName:parts.at(-1)}:{firstName:'',lastName:clean};
}
const previousParseAuthors=parseAuthorText;
parseAuthorText=function(text){return previousParseAuthors(text).map(a=>{const split=splitEnglishName(a.name);return {...a,...($('nameOrder')?.value==='family'?{firstName:split.lastName,lastName:split.firstName}:split),institution:'',email:'',corresponding:false,first:false}})};
const previousImport=authorImport;
authorImport=function(target){
 previousImport(target);
 const note=$('authorImportBody').querySelector('.note');note.textContent=T('仅识别作者姓名与排列顺序。英文默认按“名在前、姓在后”拆分；支持在预览中修改，或切换姓在前。不会推断机构、一作或通讯作者。','Recognize names and order only. English names default to given-name-first; review or switch to family-name-first. Affiliations and author roles are not inferred.','氏名と順序のみ認識。英語名は名→姓を既定とし、確認・変更できます。所属や著者の役割は推定しません。');
 $('authorText').placeholder='Huaisong Yang; Gang Ma; Hailong Chen';
 $('authorText').insertAdjacentHTML('afterend',select('nameOrder',T('英文姓名顺序','English name order','英語氏名の順序'),[['given','First name → Last name'],['family','Last name → First name']],'given'));
 $('nameOrder').onchange=()=>{parsedAuthors=parsedAuthors.map(a=>{const split=splitEnglishName(a.name);return {...a,...($('nameOrder').value==='family'?{firstName:split.lastName,lastName:split.firstName}:split)}});drawImportPreview()};
};
drawImportPreview=function(){
 const family=$('nameOrder')?.value==='family';
 $('importPreview').innerHTML=parsedAuthors.map((a,i)=>`<section class="author-row" data-import-index="${i}"><label class="option-row"><input type="checkbox" data-key="include" checked>${i+1}. ${T('导入此作者','Include author','著者を取込')}</label><div class="form-grid">${['name','lastName','firstName'].map(k=>field(`import-${i}-${k}`,txt[k](),a[k],'text',`data-key="${k}"`)).join('')}</div></section>`).join('')||`<p>${T('未识别到作者','No authors found','著者が見つかりません')}</p>`;
 $('confirmAuthorImport').disabled=!parsedAuthors.length;
};
function duplicates(){
 const groups=new Map();for(const p of library){const key=p.name.replace(/[\s.,，]/g,'').toLocaleLowerCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p)}return [...groups.values()].filter(g=>g.length>1);
}
function checkDuplicates(){
 $('duplicateWarning')?.remove();if(page!=='authors'||!unlocked)return;
 const groups=duplicates();if(!groups.length)return;
 const div=document.createElement('div');div.id='duplicateWarning';div.className='duplicate-note';div.innerHTML=`<strong>${T('发现同名作者，请核对是否为同一人','Matching names found — check whether they are the same person','同名の著者がいます。同一人物か確認してください')}</strong>${groups.map(g=>`<p>${esc(g[0].name)} · ${g.length} ${T('条','records','件')} ${btn(T('查看并合并','Review & merge','確認して統合'),`data-merge-author="${esc(g[0].id)}"`)}</p>`).join('')}`;$('content').prepend(div);
}
function authorOrder(a){let index=0;for(const r of records)for(const p of r.authors){if(p.id===a.id||personKey(p)===personKey(a))return index;index++}return Number.MAX_SAFE_INTEGER}
const originalAvailable=availablePeople;
availablePeople=function(){const people=originalAvailable();return people.slice().sort(authorSort==='alpha'?(a,b)=>a.name.localeCompare(b.name,lang==='en'?'en':'zh-CN',{sensitivity:'base'}):(a,b)=>authorOrder(a)-authorOrder(b))};
const oldAuthors=renderAuthors;
renderAuthors=function(){oldAuthors();$('librarySearch').insertAdjacentHTML('beforebegin',select('authorSort',T('排序方式','Sort by','並び順'),[['paper',T('论文出现顺序','Order in papers','論文の掲載順')],['alpha',T('姓名首字母 / 拼音','Name alphabetically','氏名順')]],authorSort));$('authorSort').onchange=e=>{authorSort=e.target.value;renderAuthors()};checkDuplicates()};
const oldStats=renderStats;
renderStats=function(){
  oldStats();
  $('content').querySelectorAll('table').forEach(table=>{const heads=[...table.querySelectorAll('thead th')];const index=heads.findIndex(h=>h.textContent===stateName('withdraw'));if(index>=0)table.querySelectorAll('tr').forEach(row=>row.children[index]?.remove())});
 const bars=$('content').querySelectorAll('.bar-row');for(const row of bars){const text=row.firstElementChild.textContent;if(text===stateName('withdraw'))row.remove()}
 // Rebuild distribution once so old major/minor aliases are not shown as extra rows.
 const distribution=[...$('content').querySelectorAll('.panel')].find(p=>p.querySelector('.bar-row'));
 if(distribution){const heading=distribution.querySelector('h2').outerHTML;distribution.innerHTML=heading+ACTIVE_STATES.map(s=>{const n=records.filter(r=>r.status===s).length;return `<div class="bar-row"><span>${stateName(s)}</span><div class="bar-track"><div class="bar" style="width:${records.length?n/records.length*100:0}%"></div></div><span>${n}</span></div>`}).join('')}
 const last=[...$('content').querySelectorAll('.panel')].at(-1),papers=citationPapers();
 const rows=last.querySelectorAll('tbody tr');rows.forEach((row,i)=>{if(!papers[i])return;row.insertAdjacentHTML('beforeend',`<td>${btn(T('编辑引用','Edit citations','引用を編集'),`data-citation="${esc(papers[i].id)}"`)}</td>`)});
 last.querySelector('thead tr').insertAdjacentHTML('beforeend',`<th>${T('操作','Actions','操作')}</th>`);
};
function editCitations(id){
 const r=records.find(r=>r.id===id);if(!r||r.status!=='accept')return;
 modal('citationEdit',T('编辑论文引用','Edit paper citations','論文の引用を編集'),`<form id="citationForm"><h3>${esc(r.title)}</h3><div class="form-grid">${field('cite-count',txt.citations(),r.citations,'number')}${field('cite-source',txt.source(),r.citationSource,'text','list="citationSources"')}${field('cite-date',txt.updated(),r.citationDate||today(),'date')}</div><p class="note">${T('这些数值来自你的手动记录，不是实时平台数据。未知时请留空。','These are your recorded values, not live platform data. Leave unknown counts blank.','手動記録値であり、リアルタイムデータではありません。不明は空欄にしてください。')}</p><div class="modal-foot">${btn(txt.save(),'type="submit"',true)}</div></form>`);
 $('citationForm').onsubmit=e=>{e.preventDefault();const next={...r,citations:$('cite-count').value===''?null:Number($('cite-count').value),citationSource:$('cite-source').value.trim(),citationDate:$('cite-date').value,updated:today()};if(writeAll(records.map(x=>x.id===id?next:x))){$('citationEdit').close();renderStats()}};
}
const ADMIN_KEY='gaoji.admin.v1';
const oldFeedback=renderFeedback;
renderFeedback=function(){
 oldFeedback();const edit=$('content').querySelector('[data-edit-feedback]');if(!adminUnlocked)edit.remove();
 $('content').insertAdjacentHTML('beforeend',`<p style="text-align:right"><button class="linkbtn" data-admin>${adminUnlocked?T('锁定管理员编辑','Lock admin editing','管理編集をロック'):T('管理员入口','Administrator','管理者入口')}</button></p>`);
};
function adminAccess(){
 if(adminUnlocked){adminUnlocked=false;clearTimeout(adminTimer);renderFeedback();return}
 let admin;try{admin=JSON.parse(localStorage.getItem(ADMIN_KEY)||'null')}catch{alert(T('管理员配置读取失败','Admin configuration unreadable','管理者設定を読み込めません'));return}
 modal('adminAccess',admin?T('管理员解锁','Unlock administrator','管理者ロック解除'):T('设置管理员密码','Set administrator password','管理者パスワード設定'),`<form id="adminForm">${!admin?`<p class="note">${T('首次设置需验证当前工作空间账号密码。管理员密码与登录密码独立，平时不显示编辑按钮。','First setup requires the current workspace password. The admin password is separate from sign-in. Editing stays hidden until unlocked.','初回設定には現在のアカウントのパスワードが必要です。管理者パスワードはログインと別です。')}</p>${field('admin-account',T('当前账号密码','Current account password','アカウントパスワード'),'','password','required')}`:''}${field('admin-password',admin?T('管理员密码','Admin password','管理者パスワード'):T('新管理员密码（至少 8 位）','New admin password (8+ characters)','管理者パスワード（8文字以上）'),'','password','required minlength="8"')}${!admin?field('admin-confirm',T('确认密码','Confirm password','確認用パスワード'),'','password','required minlength="8"'):''}<p id="adminError" class="auth-error"></p><div class="modal-foot">${btn(T('解锁','Unlock','解除'),'type="submit"',true)}</div></form>`);
 $('adminForm').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{
  if(!admin){if(!profile)fail('请先注册并登录工作空间','Register and sign in first','先に登録・ログインしてください');if(await passwordHash($('admin-account').value,profile.salt)!==profile.hash)fail('当前账号密码错误','Incorrect account password','アカウントパスワードが違います');if($('admin-password').value!==$('admin-confirm').value)fail('两次密码不一致','Passwords differ','パスワードが一致しません');const salt=randomSalt(),hash=await passwordHash($('admin-password').value,salt);admin={salt,hash};localStorage.setItem(ADMIN_KEY,JSON.stringify(admin))}
  else if(await passwordHash($('admin-password').value,admin.salt)!==admin.hash)fail('管理员密码错误','Incorrect admin password','管理者パスワードが違います');
  adminUnlocked=true;adminTimer=setTimeout(()=>{adminUnlocked=false;$('feedbackEdit').close();if(page==='feedback')renderFeedback()},600000);$('adminAccess').close();renderFeedback();toast(T('管理员编辑已解锁 10 分钟','Admin editing unlocked for 10 minutes','10分間編集を解除しました'));
 }catch(err){$('adminError').textContent=err.message}finally{e.submitter.disabled=false}};
}
const previousFeedbackEdit=editFeedback;editFeedback=function(){if(adminUnlocked){previousFeedbackEdit();const submit=$('feedbackForm').onsubmit;$('feedbackForm').onsubmit=e=>{if(!adminUnlocked){e.preventDefault();$('feedbackEdit').close();adminAccess();return}return submit(e)}}else adminAccess()};
const previousLogin=showLogin;
showLogin=function(){
 previousLogin();
 $('authForm').insertAdjacentHTML('beforebegin',`<div class="actions"><button type="button" class="btn" data-login-tab>${T('登录','Log in','ログイン')}</button><button type="button" class="btn" data-register-tab>${T('注册','Register','登録')}</button></div><div id="registrationNotice"></div>`);
 if(!profile)$('authForm').querySelector('button[type=submit]').textContent=T('注册本地账号','Register local account','ローカルアカウント登録');
};
function registration(){
 if(!profile){$('p-name').focus();toast(T('填写信息即可注册，已有投稿会保留','Complete the form to register; existing papers are retained','入力して登録できます。既存投稿は維持します'));return}
 $('registrationNotice').innerHTML=`<p class="registered-notice">${T('此本地工作空间已注册账号。请登录原账号；本地版暂不支持多账号隔离，新注册不会覆盖已有信息。','This local workspace already has an account. Sign in with it. Multiple isolated accounts are not supported here; registration will not overwrite your data.','このローカル領域は登録済みです。既存アカウントでログインしてください。複数アカウントの分離は未対応で、登録で既存情報を上書きしません。')}</p>`;
}
const previousProfile=renderProfile;
function careers(){return Array.isArray(profile?.careers)?profile.careers:[]}
function careerCards(){return careers().map(c=>`<article class="career-entry"><header>${esc(c.institution)}</header><section><p>${esc(c.start)||'—'} → ${c.current?T('至今','Present','現在'):esc(c.end)||'—'} · ${esc(c.position)}</p><p>${esc(c.type)} · ${esc(c.department)}</p><p class="notes">${esc(c.notes)}</p>${profileEditing?`${btn(txt.edit(),`data-career="${esc(c.id)}"`)} ${btn(txt.remove(),`data-delete-career="${esc(c.id)}"`)}`:''}</section></article>`).join('')}
renderProfile=function(){
 previousProfile();if(!profile)return;attachInstitutionHints();
 const formPanel=$('profileForm').closest('.panel'),passwordPanel=$('passwordForm').closest('.panel');
 formPanel.classList.toggle('hidden',!profileEditing);passwordPanel.classList.toggle('hidden',!profileEditing);
 $('content').insertAdjacentHTML('afterbegin',`<div class="profile-edit-actions">${btn(profileEditing?T('返回展示','Back to profile','表示に戻る'):T('编辑个人主页','Edit profile','プロフィール編集'),'data-profile-mode',true)}</div>`);
 const oldEducation=$('p-education').closest('.field');oldEducation.classList.add('hidden');
 const careerBox=document.createElement('section');careerBox.className='panel';careerBox.innerHTML=`<div class="section-heading"><h2>${T('教育与任职经历','Education & appointments','学歴・職歴')}</h2>${profileEditing?btn('＋ '+T('添加经历','Add entry','経歴を追加'),'data-career=""'):''}</div>${careerCards()}${!careers().length&&profile.education?`<p class="note">${T('旧版经历（保留原文，可逐条整理）','Legacy entries (retained; add structured entries above)','旧記録（保持されています。項目別に追加できます）')}</p><p class="notes">${esc(profile.education)}</p>`:''}`;
 formPanel.before(careerBox);
 const metrics=$('content').querySelector('.profile-columns .metrics-small');const heading=metrics?.parentElement.querySelector('h3');if(heading){heading.nextElementSibling?.remove();heading.remove()}
 $('p-name').previousElementSibling.textContent=T('昵称 / 显示姓名','Nickname / display name','ニックネーム・表示名');
 const save=$('profileForm').onsubmit;$('profileForm').onsubmit=e=>{save(e);if(!$('profileError')?.textContent){profileEditing=false;renderProfile()}};
};
function editCareer(id){
 if(!profile)return;const c=careers().find(c=>c.id===id)||{};
 modal('careerEdit',T('编辑经历','Edit entry','経歴を編集'),`<form id="careerForm"><div class="form-grid">${select('career-type',T('类型','Type','種別'),[['education',T('教育','Education','学歴')],['employment',T('任职','Employment','職歴')]],c.type||'education')}${field('career-institution',txt.institution(),c.institution,'text','required list="institutionSuggestions"')}${field('career-department',txt.department(),c.department)}${field('career-position',T('学位 / 职位','Degree / position','学位・職位'),c.position)}${field('career-start',T('开始日期','Start date','開始日'),c.start,'date')}${field('career-end',T('结束日期','End date','終了日'),c.end,'date')}</div><label class="option-row"><input id="career-current" type="checkbox" ${c.current?'checked':''}>${T('至今','Present','現在')}</label><label for="career-notes">${T('说明','Notes','説明')}</label><textarea id="career-notes">${esc(c.notes)}</textarea><div class="modal-foot">${btn(txt.save(),'type="submit"',true)}</div></form>`);attachInstitutionHints();
 $('career-current').onchange=()=>{$('career-end').disabled=$('career-current').checked};$('career-current').onchange();
 $('careerForm').onsubmit=e=>{e.preventDefault();const item={id:id||uid(),current:$('career-current').checked};for(const k of ['type','institution','department','position','start','end','notes'])item[k]=$('career-'+k).value.trim();if(item.current)item.end='';if(item.start&&item.end&&item.end<item.start){alert(T('结束日期不能早于开始日期','End date cannot precede start date','終了日は開始日以降にしてください'));return}const next={...profile,careers:[...careers().filter(c=>c.id!==id),item]};if(writeAll(records,library,next)){$('careerEdit').close();renderProfile()}};
}
const previousBackup=renderBackup;
renderBackup=function(){previousBackup();$('rawExport')?.remove();$('snapshotExport')?.remove();$('export').textContent=T('导出备份','Export backup','バックアップ出力');const panels=[...$('content').querySelectorAll('.panel')];panels.forEach(p=>{if(!p.querySelector('#export')&&!p.querySelector('#import'))p.remove()})};
// Keep withdrawn entries readable, but exclude them from selectable states and distributions.
const previousDrawRounds=drawRounds;
drawRounds=function(){previousDrawRounds();document.querySelectorAll('#roundRows select[data-key="decision"]').forEach(select=>{const original=select.value;if(['major','minor'].includes(original))select.value='revision';[...select.options].filter(o=>['major','minor'].includes(o.value)||o.value==='withdraw'&&original!=='withdraw').forEach(o=>o.remove())})};
const latestEditor=openEditor;
openEditor=function(id,source){latestEditor(id,source);const old=records.find(r=>r.id===id);if(old?.status==='withdraw'){$('status').insertAdjacentHTML('beforeend',`<option value="withdraw" selected>${stateName('withdraw')}</option>`)}editorBaseline=editorFingerprint()};
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-undo'))undoLast();
 if(b.hasAttribute('data-widgets'))widgetSettings();
 if(b.hasAttribute('data-countdown'))editCountdown(b.dataset.countdown);
 if(b.hasAttribute('data-weather-refresh')){weatherCache=null;fetchWeather()}
 if(b.hasAttribute('data-institution'))editInstitution(b.dataset.institution,b.dataset.institutionName||'');
 if(b.dataset.citation)editCitations(b.dataset.citation);
 if(b.hasAttribute('data-admin'))adminAccess();
 if(b.hasAttribute('data-profile-mode')){profileEditing=!profileEditing;renderProfile()}
 if(b.hasAttribute('data-career'))editCareer(b.dataset.career);
 if(b.dataset.deleteCareer&&profile){if(writeAll(records,library,{...profile,careers:careers().filter(c=>c.id!==b.dataset.deleteCareer)}))renderProfile()}
 if(b.hasAttribute('data-register-tab'))registration();
 if(b.hasAttribute('data-login-tab')){if(profile)$('registrationNotice').innerHTML='';$('loginUser').focus()}
 if(b.hasAttribute('data-logout')){adminUnlocked=false;profileEditing=false;clearTimeout(adminTimer)}
});


'use strict';
function loadAccount(id){
 accountStore.use(id);loadError='';
 records=migrate(JSON.parse(localStorage.getItem(KEY)||'[]'));
 profile=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null');if(profile)profile=validProfile(profile);
 const savedAuthors=localStorage.getItem(AUTHORS_KEY);
 library=savedAuthors===null?mergePeople([],records.flatMap(r=>r.authors)):JSON.parse(savedAuthors);
 settings=validateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null')||{journals:clone(DEFAULT_JOURNALS),feedback:{email:'yanghuaisong@hrbeu.edu.cn'}});
 undoState=null;clearTimeout(undoTimer);$('undoNotice')?.remove();profileEditing=false;page='overview';
}
showLogin=function(register=false){
 unlocked=false;clearInterval(clockTimer);document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('.app').classList.add('hidden');document.querySelector('.auth-screen')?.remove();
 const root=document.createElement('div');root.className='auth-screen';
 root.innerHTML=`<section class="auth-art"><div class="eyebrow">YOUR RESEARCH COMPANION</div><h1>${esc(brand())}</h1><h2>投个好稿，接收好运。</h2><p>Dear Editor · まだ査読中</p></section><section class="auth-panel">${languages()}<h2>${register?T('创建账号','Create account','登録'):T('欢迎回来','Welcome back','おかえりなさい')}</h2><div class="actions">${btn(T('登录','Log in','ログイン'),'id="switchLogin"')}${btn(T('注册','Register','登録'),'id="switchRegister"')}</div><form id="authForm">${field('loginUser',T('用户名','Username','ユーザー名'),register?'':profile?.username,'text','required autocomplete="username"')}${field('loginPassword',T('密码','Password','パスワード'),'','password',`required minlength="${register?6:1}" autocomplete="${register?'new-password':'current-password'}"`)}${register?field('confirmPassword','确认密码','','password','required minlength="6"')+field('newNickname','昵称','','text','required'):''}<label class="option-row"><input type="checkbox" id="rememberLogin">${T('记住我','Remember me','ログインを保持')}</label><p id="authError" class="auth-error" role="alert"></p>${btn(register?'注册并进入':'登录','type="submit"',true)}</form></section>`;
 document.body.append(root);$('switchLogin').onclick=()=>showLogin();$('switchRegister').onclick=()=>showLogin(true);
 $('authForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{
  const username=$('loginUser').value.trim(),password=$('loginPassword').value,remember=$('rememberLogin').checked;
  const accounts=accountStore.list(),found=accounts.find(a=>a.profile.username.toLocaleLowerCase()===username.toLocaleLowerCase());
  if(register){
   if(found)throw Error('用户名已存在，请换一个用户名');if(password!==$('confirmPassword').value)throw Error('两次密码不一致');
    const name=username,salt=randomSalt(),hash=await passwordHash(password,salt);
   const previous=accountStore.active,id=!accounts.length&&!profile?'legacy':uid().replaceAll('.','');
   const created=validProfile({username,name,salt,hash,role:'student',degree:''});
   loadAccount(id);if(!writeAll(records,library,created)){loadAccount(previous);return}
  }else{
   if(!found||await passwordHash(password,found.profile.salt)!==found.profile.hash)throw Error('用户名或密码错误');
   loadAccount(found.id);
  }
  rememberChoice=remember;enterWorkspace();
 }catch(err){$('authError').textContent=err.message}finally{button.disabled=false}};
};
registration=()=>showLogin(true);
const V6_SCHEDULE=[{name:'上午',start:'08:00',end:'11:45'},{name:'下午',start:'13:45',end:'17:15'},{name:'晚上',start:'18:30',end:'21:00'}];
function widgetData(){const w=settings.widgets;w.weather=false;w.schedule??=clone(V6_SCHEDULE);w.todos??=[];w.holidays??=[];w.workdays??=[];w.precision??='second';w.todo??=true;w.seasons??=['春风又起，愿好消息也在路上。','夏日漫长，记得休息和喝水。','秋天适合收获，也适合等待一封录用信。','天气渐冷，别忘了给自己一点温暖。'];return w}
function localDay(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function timeMinute(s){const [h,m]=s.split(':').map(Number);return h*60+m}
function offDay(d,w=widgetData()){const k=localDay(d);return w.workdays.includes(k)?false:w.holidays.includes(k)||[0,6].includes(d.getDay())}
function phaseAt(d,w=widgetData()){
 const m=d.getHours()*60+d.getMinutes()+d.getSeconds()/60,parts=w.schedule;
 if(offDay(d,w))return {name:'休息日',greeting:'今天休息，暂时把审稿的事放一放吧。'};
 const i=parts.findIndex(p=>m>=timeMinute(p.start)&&m<timeMinute(p.end));
 if(i>=0){const p=parts[i],end=new Date(`${localDay(d)}T${p.end}`);return {name:p.name,end,greeting:timeMinute(p.end)-m<=20?(i===0?'想好吃什么了吗？':i===2?'准备跑路了吗？今天辛苦了。':'快到休息时间了，伸个懒腰吧。'):['早上好，昨天休息得好吗？准备好迎接新的等待审稿的一天了吗？','午睡睡好了吗？下午也慢慢推进一点吧。','晚上好，再努力一会儿，也别忘了按时收工。'][i]||'按自己的节奏来。'}}
 const next=parts.find(p=>timeMinute(p.start)>m);return {name:next?(m<timeMinute(parts[0].start)?'早间休息':next===parts[1]?'午休':'晚餐休息'):'今日已结束',end:next?new Date(`${localDay(d)}T${next.start}`):null,greeting:next===parts[1]?'午休时间，吃好饭，再睡个好觉。':next?'休息一下，下一阶段不必着急。':'今天辛苦了，早点休息，明天再等好消息。'};
}
function restTarget(d,w){if(offDay(d,w))return d;const n=new Date(d);n.setHours(0,0,0,0);for(let i=0;i<370;i++){n.setDate(n.getDate()+1);if(offDay(n,w))return n}return null}
function remaining(target,precision,now=new Date()){
 if(!target)return '待设置';let s=Math.max(0,Math.ceil((new Date(target)-now)/1000));if(!Number.isFinite(s))return '待设置';
 const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sec=s%60;
 return precision==='day'?`${Math.ceil(s/86400)} 天`:precision==='hour'?`${d} 天 ${h} 小时`:precision==='minute'?`${d} 天 ${h} 时 ${m} 分`:`${d} 天 ${h} 时 ${m} 分 ${sec} 秒`;
}
const V6_QUOTES=[...QUOTES,{text:'古池や蛙飛びこむ水の音',author:'松尾芭蕉',source:'《蛙合》'},{text:'冬来たりなば春遠からじ',author:'P. B. Shelley',source:'Ode to the West Wind（日译）'},{text:'行到水穷处，坐看云起时。',author:'王维',source:'《终南别业》'}];
let quoteOffset=0;
function quoteView(){const q=V6_QUOTES[(Math.floor(Date.now()/86400000)+quoteOffset)%V6_QUOTES.length];return `<blockquote>${esc(q.text)}</blockquote><small>${esc(q.author)} · ${esc(q.source)}</small>`}
renderOverview=function(){
 clearInterval(clockTimer);previousOverview();const w=widgetData();
 const area=document.createElement('section');area.id='homeWidgetArea';document.querySelector('.welcome').after(area);
 area.innerHTML=`<div class="widget-controls">${btn('管理首页组件','data-widgets')}</div><div class="dashboard-grid">${w.clock?`<article class="desk-card routine"><div class="section-heading"><div><small id="liveDate"></small><h2 id="liveClock"></h2></div><span id="phaseLabel" class="phase-pill"></span></div><p id="dailyGreeting"></p><small id="seasonGreeting"></small><div class="day-track">${w.schedule.map((p,i)=>`<div class="day-block block-${i}" style="left:${timeMinute(p.start)/14.4}%;width:${(timeMinute(p.end)-timeMinute(p.start))/14.4}%"><b>${esc(p.name)}</b><small>${p.start}–${p.end}</small></div>`).join('')}<div id="nowMarker"><span>现在</span></div></div><div class="track-labels"><span>00:00</span><span>12:00</span><span>24:00</span></div></article>`:''}${w.quote?`<article class="desk-card quote-card"><div class="section-heading"><h3>每日一句 · 今日の言葉</h3>${btn('换一句','id="refreshQuote"')}</div><div id="dailyQuote">${quoteView()}</div></article>`:''}${w.countdowns?`<section class="countdown-grid"><article class="desk-card"><small>本阶段结束 / 下一阶段</small><h3 id="phaseCountdown"></h3></article><article class="desk-card"><small>周末 / 下一休息日</small><h3 id="weekendCountdown"></h3></article>${['winter','summer'].map((k,i)=>`<article class="desk-card"><small>${i?'暑假':'寒假'}</small><h3 data-vacation="${k}"></h3>${btn('设置日期','data-widgets')}</article>`).join('')}${w.items.map(c=>`<article class="desk-card"><small>${esc(c.category)}</small><h3>${esc(c.title)}</h3><p data-clock-target="${esc(c.date+'T'+(c.time||'00:00'))}" data-precision="${esc(c.precision||w.precision)}"></p>${btn(txt.edit(),`data-countdown="${esc(c.id)}"`)}</article>`).join('')}<button class="desk-card add-countdown" data-countdown="">＋ 添加倒计时</button></section>`:''}${w.todo?`<article class="desk-card todo-card"><div class="section-heading"><h3>待办事项</h3>${btn('＋ 添加','id="newTodo"')}</div><div id="todoList">${w.todos.map(t=>`<div class="todo-row ${t.done?'done':''}"><input type="checkbox" aria-label="完成 ${esc(t.title)}" data-todo-check="${esc(t.id)}" ${t.done?'checked':''}><div><b>${esc(t.title)}</b>${t.deadline?`<small class="${!t.done&&new Date(t.deadline)<new Date()?'overdue':''}">DDL ${esc(t.deadline.replace('T',' '))}</small>`:''}</div>${btn('编辑',`data-todo-edit="${esc(t.id)}"`)}</div>`).join('')||'<p class="note">今天想推进哪一件小事？</p>'}</div></article>`:''}</div>`;
 $('refreshQuote')?.addEventListener('click',()=>{quoteOffset++;$('dailyQuote').innerHTML=quoteView()});$('newTodo')?.addEventListener('click',()=>editTodo(''));
 const tick=()=>{const now=new Date(),p=phaseAt(now,w);if($('liveClock')){$('liveClock').textContent=now.toLocaleTimeString('zh-CN',{hour12:false});$('liveDate').textContent=now.toLocaleDateString(lang==='ja'?'ja-JP':lang==='en'?'en-GB':'zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});$('phaseLabel').textContent=p.name;$('dailyGreeting').textContent=p.greeting;$('seasonGreeting').textContent=w.seasons[Math.floor((now.getMonth()+10)%12/3)];$('nowMarker').style.left=(now.getHours()*3600+now.getMinutes()*60+now.getSeconds())/864+'%'}
 if($('phaseCountdown')){$('phaseCountdown').textContent=p.end?remaining(p.end,w.precision,now):p.name;$('weekendCountdown').textContent=offDay(now,w)?'今天好好休息':remaining(restTarget(now,w),w.precision,now)}
 area.querySelectorAll('[data-vacation]').forEach(el=>el.textContent=remaining(w[el.dataset.vacation],w.precision,now));area.querySelectorAll('[data-clock-target]').forEach(el=>el.textContent=remaining(el.dataset.clockTarget,el.dataset.precision,now));};tick();clockTimer=setInterval(tick,1000);
};
function precisionSelect(id,value){return select(id,'显示精度',[['day','天'],['hour','小时'],['minute','分钟'],['second','秒']],value)}
widgetSettings=function(){const w=widgetData();modal('widgetSettings','首页组件与作息',`<form id="widgetForm"><div class="form-grid">${[['clock','时间轴'],['quote','每日一句'],['countdowns','倒计时'],['todo','待办事项']].map(([k,n])=>`<label class="option-row"><input id="widget-${k}" type="checkbox" ${w[k]?'checked':''}>${n}</label>`).join('')}</div><h3>每日作息</h3>${w.schedule.map((p,i)=>`<div class="schedule-inputs">${field('s-name-'+i,'阶段',p.name,'text','required')}${field('s-start-'+i,'开始',p.start,'time','required')}${field('s-end-'+i,'结束',p.end,'time','required')}</div>`).join('')}<h3>假期与倒计时</h3><div class="form-grid">${precisionSelect('precision',w.precision)}${field('winter','寒假开始（按学校校历设置）',w.winter,'datetime-local')}${field('summer','暑假开始（按学校校历设置）',w.summer,'datetime-local')}</div><p class="note">默认周六、周日休息。按当年法定放假与调休通知补充下面的日期，每行一个 YYYY-MM-DD；调休工作日优先。</p><div class="form-grid"><label>法定假日 / 额外休息日<textarea id="holidays">${esc(w.holidays.join('\n'))}</textarea></label><label>调休工作日<textarea id="workdays">${esc(w.workdays.join('\n'))}</textarea></label></div><h3>四季问候语</h3>${w.seasons.map((s,i)=>field('season-'+i,['春','夏','秋','冬'][i],s)).join('')}<p id="widgetError" role="alert"></p><div class="modal-foot">${btn(txt.save(),'type="submit"',true)}</div></form>`);
 $('widgetForm').onsubmit=e=>{e.preventDefault();try{const next=clone(settings),n=next.widgets;for(const k of ['clock','quote','countdowns','todo'])n[k]=$('widget-'+k).checked;n.weather=false;n.schedule=w.schedule.map((p,i)=>({name:$('s-name-'+i).value.trim(),start:$('s-start-'+i).value,end:$('s-end-'+i).value}));n.schedule.forEach((p,i)=>{if(p.start>=p.end||i&&p.start<n.schedule[i-1].end)throw Error('作息须按时间先后排列，且不能重叠')});for(const k of ['holidays','workdays']){n[k]=$ (k).value.split(/[\s,，]+/).filter(Boolean);if(n[k].some(d=>!dateOK(d)))throw Error('假期日期请使用 YYYY-MM-DD 格式')}for(const k of ['winter','summer','precision'])n[k]=$(k).value;n.seasons=w.seasons.map((s,i)=>$('season-'+i).value);if(writeAll(records,library,profile,{nextSettings:next})){$('widgetSettings').close();render()}}catch(err){$('widgetError').textContent=err.message}};
};
const v5Countdown=editCountdown;editCountdown=function(id){v5Countdown(id);const c=settings.widgets.items.find(c=>c.id===id)||{};$('c-date').closest('.form-grid').insertAdjacentHTML('beforeend',field('c-time','时间',c.time||'00:00','time','step="1"')+precisionSelect('c-precision',c.precision||widgetData().precision));const save=$('countdownForm').onsubmit;$('countdownForm').onsubmit=e=>{const time=$('c-time').value,precision=$('c-precision').value;const original=writeAll;writeAll=function(rs,people,p,options){const item=options.nextSettings.widgets.items.at(-1);item.time=time;item.precision=precision;return original(rs,people,p,options)};try{save(e)}finally{writeAll=original}}};
newDialog('todoEdit');
function editTodo(id){const t=widgetData().todos.find(x=>x.id===id)||{};modal('todoEdit','待办事项',`<form id="todoForm">${field('todo-title','事项',t.title,'text','required')}${field('todo-deadline','DDL（可选）',t.deadline,'datetime-local')}<div class="modal-foot">${t.id?btn('删除','type="button" id="removeTodo"'):''}${btn(txt.save(),'type="submit"',true)}</div></form>`);const save=remove=>{const next=clone(settings);next.widgets.todos=next.widgets.todos.filter(x=>x.id!==id);if(!remove)next.widgets.todos.push({...t,id:id||uid(),title:$('todo-title').value.trim(),deadline:$('todo-deadline').value});if(writeAll(records,library,profile,{nextSettings:next})){$('todoEdit').close();render()}};$('todoForm').onsubmit=e=>{e.preventDefault();save(false)};$('removeTodo')?.addEventListener('click',()=>save(true))}
document.addEventListener('click',e=>{const b=e.target.closest('[data-todo-edit]');if(b)editTodo(b.dataset.todoEdit)});
document.addEventListener('change',e=>{if(e.target.matches('[data-todo-check]')){const next=clone(settings);next.widgets.todos.find(t=>t.id===e.target.dataset.todoCheck).done=e.target.checked;if(writeAll(records,library,profile,{nextSettings:next}))render()}});
renderFeedback=function(){oldFeedback();document.querySelector('[data-edit-feedback]')?.remove()};
const v6Profile=renderProfile;renderProfile=function(){v6Profile();$('p-metricsSource')?.closest('.field').classList.add('hidden');const metrics=document.querySelector('.profile-columns .metrics-small');if(metrics?.nextElementSibling)metrics.nextElementSibling.textContent=txt.updated()+': '+(profile.metricsDate||'—');const help=$('profileForm')?.querySelector('.note');if(help)help.textContent='';};
// Append dated observations before every paper write, including edits outside statistics.
const v6Write=writeAll;
writeAll=function(rs=records,people=library,p=profile,options={}){
 try{
  if(p&&accountStore.list().some(a=>a.id!==accountStore.active&&a.profile.username.toLocaleLowerCase()===p.username.toLocaleLowerCase()))throw Error('该用户名属于另一个本地账号，请在对应账号中恢复备份');
  const next=rs.map(r=>{const old=records.find(x=>x.id===r.id),history=clone(r.citationHistory||old?.citationHistory||[]);if(!Array.isArray(history)||history.some(h=>!dateOK(h.date)||!h.date||!Number.isInteger(h.count)||h.count<0))throw Error('引用历史格式无效');for(const x of [old,r])if(x&&x.citations!=null&&x.citationDate&&!history.some(h=>h.date===x.citationDate&&h.count===x.citations))history.push({date:x.citationDate,count:x.citations});return {...r,citationHistory:history}});
  return v6Write(next,people,p,options);
 }catch(err){alert(err.message);return false}
};
const v6Citations=editCitations;editCitations=function(id){v6Citations(id);$('cite-source').closest('.field').classList.add('hidden');$('cite-count').min='0';$('cite-count').step='1';};
const v6Stats=renderStats;renderStats=function(){v6Stats();document.querySelectorAll('#content table').forEach(table=>{const index=[...table.querySelectorAll('thead th')].findIndex(th=>th.textContent===txt.source());if(index>=0)table.querySelectorAll('tr').forEach(row=>row.children[index]?.remove())});const rows=citationPapers().flatMap(r=>{const history=clone(r.citationHistory||[]);if(r.citations!=null&&r.citationDate&&!history.some(h=>h.date===r.citationDate&&h.count===r.citations))history.push({date:r.citationDate,count:r.citations});return history.map(h=>({...h,title:r.title}))}).sort((a,b)=>b.date.localeCompare(a.date));$('content').insertAdjacentHTML('beforeend',`<section class="panel"><h2>引用更新记录</h2><div class="table-wrap"><table><thead><tr><th>更新日期</th><th>论文</th><th>引用次数</th></tr></thead><tbody>${rows.map(h=>`<tr><td>${esc(h.date)}</td><td>${esc(h.title)}</td><td>${esc(h.count)}</td></tr>`).join('')||'<tr><td colspan="3">暂无有日期的更新记录</td></tr>'}</tbody></table></div></section>`)};
function institutionEntries(){const map=new Map();for(const p of [...settings.institutions,...library,...records.flatMap(r=>r.authors),...(profile?[profile]:[])]){const name=p.institution||p.name;if(!name||(!p.institution&&!settings.institutions.includes(p)))continue;const key=name+'\0'+(p.department||'');if(!map.has(key))map.set(key,{...p,name,department:p.department||'',id:settings.institutions.includes(p)?p.id:''})}return [...map.values()]}
renderInstitutions=function(){const entries=institutionEntries(),names=[...new Set(entries.map(x=>x.name))].sort((a,b)=>a.localeCompare(b));$('content').innerHTML=`<section class="panel"><div class="section-heading"><h2>学校与学院</h2>${btn('＋ 添加学校 / 学院','data-institution=""',true)}</div></section>${names.map(name=>`<section class="panel"><h2>${esc(name)}</h2><div class="institution-grid">${entries.filter(x=>x.name===name).map((x)=>`<article class="desk-card"><h3>${esc(x.department)||'学校 / 机构'}</h3><p>${esc(x.country)}</p>${btn(txt.edit(),`data-institution="${esc(x.id)}" data-institution-name="${esc(name)}" data-department="${esc(x.department)}"`)}</article>`).join('')}</div></section>`).join('')}`};
const v6Institution=editInstitution;editInstitution=function(id,name){v6Institution(id,name);attachInstitutionHints()};
document.addEventListener('click',e=>{const b=e.target.closest('[data-department]');if(b&&$('i-department'))$('i-department').value=b.dataset.department});
const v6Hints=attachInstitutionHints;attachInstitutionHints=function(){v6Hints();$('departmentSuggestions')?.remove();const dl=document.createElement('datalist');dl.id='departmentSuggestions';dl.innerHTML=[...new Set(institutionEntries().map(x=>x.department).filter(Boolean))].map(d=>`<option value="${esc(d)}"></option>`).join('');document.body.append(dl);document.querySelectorAll('input[id*="department"]').forEach(input=>input.setAttribute('list',dl.id))};
const v6Shell=renderShell;renderShell=function(){v6Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('5.0','6.0')};


'use strict';
const v7Login=showLogin;
showLogin=function(register=false){v7Login(register);$('languageControl')?.remove();const root=document.querySelector('.auth-screen');root.querySelector('.auth-art p').textContent='投个好稿 · Dear Editor · まだ査読中';$('newNickname')?.closest('.field').remove();const language=root.querySelector('.language-globe');if(language){language.classList.add('login-language');root.prepend(language)}};
remaining=function(target,precision,now=new Date()){
 if(!target)return '待设置';const seconds=Math.max(0,Math.ceil((new Date(target)-now)/1000));if(!Number.isFinite(seconds))return '待设置';
 if(seconds>=86400)return `${Math.ceil(seconds/86400)} 天`;
 if(seconds>=3600)return `${Math.floor(seconds/3600)} 小时`;
 return `${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
};
const QUOTES_V7=[
 ['千里之行，始于足下。','千里之行，从脚下的第一步开始。','老子','《道德经》','中文'],
 ['不积跬步，无以至千里。','不积累小步，就无法走到千里之外。','荀子','《劝学》','中文'],
 ['行到水穷处，坐看云起时。','走到水流尽头，坐下来静看云起。','王维','《终南别业》','中文'],
 ['长风破浪会有时，直挂云帆济沧海。','终有乘风破浪之时，扬帆渡过大海。','李白','《行路难》','中文'],
 ['山重水复疑无路，柳暗花明又一村。','以为前路已尽，转过弯却有新的天地。','陆游','《游山西村》','中文'],
 ['If Winter comes, can Spring be far behind?','如果冬天来了，春天还会远吗？','P. B. Shelley','Ode to the West Wind','English'],
 ['I dwell in Possibility.','我栖居于可能性之中。','Emily Dickinson','I dwell in Possibility','English'],
 ['We are such stuff as dreams are made on.','我们与梦由同样的材料构成。','William Shakespeare','The Tempest','English'],
 ['A thing of beauty is a joy for ever.','美的事物带来永恒的喜悦。','John Keats','Endymion','English'],
 ['If I have seen further it is by standing on the shoulders of Giants.','如果我看得更远，是因为站在巨人的肩上。','Isaac Newton','Letter to Robert Hooke','English'],
 ['古池や蛙飛びこむ水の音','古池寂静，青蛙跃入，水声一响。','松尾芭蕉','《蛙合》','日本語'],
 ['春の海ひねもすのたりのたりかな','春日的海，一整天悠悠荡荡。','与謝蕪村','俳句','日本語'],
 ['やれ打つな蠅が手をすり足をする','别打它呀，苍蝇正在搓手搓脚。','小林一茶','俳句','日本語'],
 ['月日は百代の過客にして、行きかふ年も又旅人也。','日月是百代的过客，往来岁月也是旅人。','松尾芭蕉','《奥の細道》','日本語'],
 ['On ne voit bien qu’avec le cœur.','只有用心，才能看得清楚。','Antoine de Saint-Exupéry','Le Petit Prince','Français'],
 ['Il faut cultiver notre jardin.','我们应当耕种自己的园地。','Voltaire','Candide','Français'],
 ['Le cœur a ses raisons que la raison ne connaît point.','心有它自己的理由，理性却未必知晓。','Blaise Pascal','Pensées','Français'],
 ['Caminante, no hay camino, se hace camino al andar.','行路人，本没有路，路是在行走中走出来的。','Antonio Machado','Proverbios y cantares','Español'],
 ['La vida es sueño.','人生如梦。','Pedro Calderón de la Barca','La vida es sueño','Español'],
 ['Wer immer strebend sich bemüht, den können wir erlösen.','凡不断努力进取的人，我们都能够拯救。','Johann Wolfgang von Goethe','Faust II','Deutsch'],
 ['Du musst dein Leben ändern.','你必须改变你的生活。','Rainer Maria Rilke','Archaischer Torso Apollos','Deutsch'],
 ['E quindi uscimmo a riveder le stelle.','于是我们走出那里，再次看见群星。','Dante Alighieri','Divina Commedia, Inferno','Italiano'],
 ['Все мы вышли из народа.','我们都来自人民。','Pyotr Lavrov','Рабочая Марсельеза','Русский'],
 ['Carpe diem.','把握今天。','Horatius','Odes 1.11','Latina']
];
quoteView=function(){const q=QUOTES_V7[(Math.floor(Date.now()/86400000)+quoteOffset)%QUOTES_V7.length];return `<small>${esc(q[4])} · ${esc(q[2])}</small><blockquote>${esc(q[0])}</blockquote><p class="quote-translation">${esc(q[1])}</p><small class="quote-source">${esc(q[3])} · 中文译意</small>`};
const v7WidgetData=widgetData;
widgetData=function(){const w=v7WidgetData();if(w.vacation===undefined){const dates=[w.winter,w.summer].filter(Boolean).sort();w.vacation=dates.find(d=>new Date(d)>new Date())||dates.at(-1)||''}return w};
renderOverview=function(){
 clearInterval(clockTimer);previousOverview();const w=widgetData(),welcome=document.querySelector('.welcome');
 const area=document.createElement('section');area.id='homeWidgetArea';area.className='compact-home';welcome.replaceWith(area);
 area.innerHTML=`<div class="compact-welcome"><div><h2>${T('欢迎回来','Welcome back','おかえりなさい')}，${esc(profile?.name||profile?.username||'')} <span id="phaseLabel"></span></h2><small id="liveDate"></small>${w.clock?'<b id="liveClock"></b>':''}</div>${btn('⚙ 组件与作息','data-widgets')}</div>${w.clock?`<div class="routine-strip"><div class="work-timeline">${w.schedule.map((p,i)=>`<button class="work-phase" data-widgets data-phase-index="${i}" title="编辑作息"><span>${i===2?'☾':'☀'} ${esc(p.name)}</span><small>${esc(p.start)}–${esc(p.end)}</small><i></i></button>`).join('<span class="rest-gap">· · ·</span>')}</div><p id="dailyGreeting"></p><small id="seasonGreeting"></small></div>`:''}<div class="compact-extras">${w.quote?`<article class="mini-quote"><header><b>每日一句</b>${btn('换一句','id="refreshQuote"')}</header><div id="dailyQuote">${quoteView()}</div></article>`:''}${w.todo?`<article class="mini-todos"><header><b>待办事项 <small>${w.todos.filter(t=>!t.done).length}</small></b>${btn('＋','id="newTodo"')}</header><div class="todo-scroll">${w.todos.slice().sort((a,b)=>Number(a.done)-Number(b.done)||(a.deadline||'9999').localeCompare(b.deadline||'9999')).map(t=>`<div class="todo-row ${t.done?'done':''}"><input type="checkbox" aria-label="完成 ${esc(t.title)}" data-todo-check="${esc(t.id)}" ${t.done?'checked':''}><div><b>${esc(t.title)}</b>${t.deadline?`<small class="${!t.done&&new Date(t.deadline)<new Date()?'overdue':''}">DDL ${esc(t.deadline.replace('T',' '))}</small>`:''}</div>${btn('编辑',`data-todo-edit="${esc(t.id)}"`)}</div>`).join('')||'<small>今天先推进一件小事。</small>'}</div></article>`:''}</div>${w.countdowns?`<div class="countdown-strip"><div><small>本阶段 / 下一阶段</small><b id="phaseCountdown"></b></div><div><small>周末 / 下一休息日</small><b id="weekendCountdown"></b></div><button data-widgets><small>假期</small><b id="vacationCountdown"></b></button>${w.items.map(c=>`<button data-countdown="${esc(c.id)}"><small>${esc(c.title)}</small><b data-clock-target="${esc(c.date+'T'+(c.time||'00:00'))}"></b></button>`).join('')}<button class="add-mini" data-countdown="" aria-label="添加倒计时">＋</button></div>`:''}`;
 $('refreshQuote')?.addEventListener('click',()=>{quoteOffset++;$('dailyQuote').innerHTML=quoteView()});$('newTodo')?.addEventListener('click',()=>editTodo(''));
 const tick=()=>{const now=new Date(),p=phaseAt(now,w),m=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
 $('liveDate').textContent=now.toLocaleDateString(lang==='en'?'en-GB':lang==='ja'?'ja-JP':'zh-CN',{month:'long',day:'numeric',weekday:'long'});$('phaseLabel').textContent=p.name;
 if($('liveClock')){$('liveClock').textContent=now.toLocaleTimeString('zh-CN',{hour12:false});$('dailyGreeting').textContent=p.greeting;$('seasonGreeting').textContent=w.seasons[Math.floor((now.getMonth()+10)%12/3)];area.querySelectorAll('[data-phase-index]').forEach(el=>{const phase=w.schedule[Number(el.dataset.phaseIndex)],start=timeMinute(phase.start),end=timeMinute(phase.end);el.classList.toggle('current',!offDay(now,w)&&m>=start&&m<end);el.style.setProperty('--progress',Math.max(0,Math.min(100,(m-start)/(end-start)*100))+'%')})}
  if($('phaseCountdown')){$('phaseCountdown').textContent=p.end?remaining(p.end):p.name;$('weekendCountdown').textContent=offDay(now,w)?'今天休息':remaining(restTarget(now,w));$('vacationCountdown').textContent=remaining(w.vacation)}area.querySelectorAll('[data-clock-target]').forEach(el=>el.textContent=remaining(el.dataset.clockTarget));if(typeof sortCountdowns==='function')sortCountdowns();};tick();clockTimer=setInterval(tick,1000);
};
const v7Widgets=widgetSettings;widgetSettings=function(){v7Widgets();$('precision').closest('.field').hidden=true;$('winter').closest('.field').hidden=true;$('summer').closest('.field').hidden=true;$('winter').closest('.form-grid').insertAdjacentHTML('beforeend',field('vacation','假期开始',widgetData().vacation,'datetime-local'));const submit=$('widgetForm').onsubmit;$('widgetForm').onsubmit=e=>{const value=$('vacation').value;const writer=writeAll;writeAll=function(rs,people,p,options){options.nextSettings.widgets.vacation=value;return writer(rs,people,p,options)};try{submit(e)}finally{writeAll=writer}}};
const v7Countdown=editCountdown;editCountdown=function(id){v7Countdown(id);$('c-precision').closest('.field').hidden=true};
const v7Citations=editCitations;editCitations=function(id){v7Citations(id);$('cite-date').value=today();$('cite-date').readOnly=true;const submit=$('citationForm').onsubmit;$('citationForm').onsubmit=e=>{$('cite-date').value=today();return submit(e)}};
const v7Profile=renderProfile;renderProfile=function(){v7Profile();if(!$('profileForm'))return;$('p-metricsDate').value=today();$('p-metricsDate').readOnly=true;const submit=$('profileForm').onsubmit;$('profileForm').onsubmit=e=>{$('p-metricsDate').value=today();return submit(e)}};
const v7Editor=openEditor;openEditor=function(id,source){v7Editor(id,source);$('citationDate').readOnly=true;const oldCount=$('citations').value;$('citations').addEventListener('input',()=>{if($('citations').value!==oldCount)$('citationDate').value=today()});if(!$('citationDate').value)$('citationDate').value=today();editorBaseline=editorFingerprint()};
function institutionKey(x){return JSON.stringify([x.name||x.institution,x.department||''])}
const v7Entries=institutionEntries;institutionEntries=function(){return v7Entries().filter(x=>!(settings.hiddenInstitutions||[]).includes(institutionKey(x)))};
function institutionAuthors(x){const authors=[...library,...records.flatMap(r=>r.authors)];const seen=new Set();return authors.filter(a=>{if(a.institution!==x.name||(a.department||'')!==x.department)return false;const key=a.id||a.name;if(seen.has(key))return false;seen.add(key);return true}).map(a=>a.name)}
renderInstitutions=function(){const entries=institutionEntries(),names=[...new Set(entries.map(x=>x.name))].sort((a,b)=>a.localeCompare(b));$('content').innerHTML=`<section class="panel"><div class="section-heading"><h2>学校与学院</h2>${btn('＋ 添加学校 / 学院','data-institution=""',true)}</div></section>${names.map(name=>`<section class="panel"><h2>${esc(name)}</h2><div class="institution-grid">${entries.filter(x=>x.name===name).map(x=>`<article class="desk-card"><h3>${esc(x.department)||'学校 / 机构'}</h3><p>${esc(x.country)}</p><p class="institution-authors">所属作者：${institutionAuthors(x).map(esc).join('、')||'暂无关联作者'}</p>${btn(txt.edit(),`data-institution="${esc(x.id)}" data-institution-name="${esc(name)}" data-department="${esc(x.department)}"`)} ${btn('删除',`data-remove-institution="${esc(institutionKey(x))}"`)}</article>`).join('')}</div></section>`).join('')}`};
const v7Institution=editInstitution;editInstitution=function(id,name){v7Institution(id,name);const submit=$('institutionForm').onsubmit;$('institutionForm').onsubmit=e=>{const key=JSON.stringify([$('i-name').value.trim(),$('i-department').value.trim()]),writer=writeAll;writeAll=function(rs,people,p,options){options.nextSettings.hiddenInstitutions=(options.nextSettings.hiddenInstitutions||[]).filter(k=>k!==key);return writer(rs,people,p,options)};try{submit(e)}finally{writeAll=writer}}};
document.addEventListener('click',e=>{const button=e.target.closest('[data-remove-institution]');if(!button)return;const key=button.dataset.removeInstitution,next=clone(settings);next.institutions=next.institutions.filter(x=>institutionKey(x)!==key);next.hiddenInstitutions=[...new Set([...(next.hiddenInstitutions||[]),key])];if(writeAll(records,library,profile,{nextSettings:next}))renderInstitutions()});
const v7Shell=renderShell;renderShell=function(){v7Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('6.0','7.0')};


'use strict';
const v8WidgetsData=widgetData;widgetData=function(){const w=v8WidgetsData();w.quote=false;return w};
function phaseStyle(start){const h=timeMinute(start)/60;return h<12?'sunrise':h<18?'sunset':'moonlight'}
phaseAt=function(d,w=widgetData()){
 const parts=w.schedule,m=d.getHours()*60+d.getMinutes()+d.getSeconds()/60;
 if(offDay(d,w))return {name:'休息日',greeting:'今天休息，暂时把审稿的事放一放吧。'};
 const current=parts.find(p=>m>=timeMinute(p.start)&&m<timeMinute(p.end));
 if(current){const style=phaseStyle(current.start),near=timeMinute(current.end)-m<=20;return {name:current.name,end:new Date(`${localDay(d)}T${current.end}`),greeting:near?'快到休息时间了，准备放松一下吧。':style==='sunrise'?'早上好，昨天休息得好吗？新的一天，按自己的节奏开始吧。':style==='sunset'?'下午好，休息得怎么样？慢慢推进一点，也是在前进。':'晚上好，记得按时收工，给自己留一点休息时间。'}}
 const next=parts.find(p=>timeMinute(p.start)>m);return {name:next?'休息中':parts.length?'今日已结束':'自由安排',end:next?new Date(`${localDay(d)}T${next.start}`):null,greeting:next?'休息一下，下一阶段不必着急。':'今天辛苦了，给自己一点自由时间。'};
};
const v8Overview=renderOverview;renderOverview=function(){
 v8Overview();const area=$('homeWidgetArea'),extras=area.querySelector('.compact-extras'),strip=area.querySelector('.countdown-strip');
 if(strip){strip.className='countdown-stack';strip.children[0].querySelector('small').textContent='休息';strip.children[1].querySelector('small').textContent='周末';extras.prepend(strip)}
 area.querySelectorAll('[data-phase-index]').forEach(el=>{const i=Number(el.dataset.phaseIndex),p=widgetData().schedule[i],style=phaseStyle(p.start);el.classList.add(style);el.querySelector('span').innerHTML=`<em class="sky-orb" aria-hidden="true">${style==='moonlight'?'☾':'☀'}</em> ${esc(p.name)}`});
 applyTheme();
};
widgetSettings=function(){const w=widgetData();let schedule=clone(w.schedule);
 modal('widgetSettings','组件与作息',`<form id="widgetForm"><div class="form-grid">${[['clock','时间轴'],['countdowns','倒计时'],['todo','待办事项']].map(([k,n])=>`<label class="option-row"><input type="checkbox" id="widget-${k}" ${w[k]?'checked':''}>${n}</label>`).join('')}</div><div class="section-heading"><h3>每日作息</h3>${btn('＋ 添加阶段','type="button" id="addPhase"')}</div><div id="scheduleRows"></div><p class="note">可自由增删阶段；保存时按开始时间排列。同一天内的阶段不能重叠。</p><div class="form-grid">${field('vacation','假期开始',w.vacation,'datetime-local')}</div><h3>休息日与调休</h3><p class="note">每行一个 YYYY-MM-DD，调休工作日优先。</p><div class="form-grid"><label>法定假日 / 额外休息日<textarea id="holidays">${esc(w.holidays.join('\n'))}</textarea></label><label>调休工作日<textarea id="workdays">${esc(w.workdays.join('\n'))}</textarea></label></div><h3>四季问候</h3>${w.seasons.map((s,i)=>field('season-'+i,['春','夏','秋','冬'][i],s)).join('')}<p id="widgetError" role="alert"></p><div class="modal-foot">${btn(txt.save(),'type="submit"',true)}</div></form>`);
 const collect=()=>schedule=[...$('scheduleRows').children].map(row=>({name:row.querySelector('[data-part="name"]').value.trim(),start:row.querySelector('[data-part="start"]').value,end:row.querySelector('[data-part="end"]').value}));
 const draw=()=>{$('scheduleRows').innerHTML=schedule.map((p,i)=>`<div class="schedule-edit-row">${field('s-name-'+i,'阶段名称',p.name,'text','required data-part="name"')}${field('s-start-'+i,'开始',p.start,'time','required data-part="start"')}${field('s-end-'+i,'结束',p.end,'time','required data-part="end"')}${btn('删除',`type="button" data-delete-phase="${i}"`)}</div>`).join('')||'<p class="empty-schedule">未设置阶段，可自由安排一天。</p>'};
 // Empty-state paragraphs are not schedule records.
 const collectRows=()=>{if(!$('scheduleRows').querySelector('[data-part]'))schedule=[];else collect()};
 draw();$('addPhase').onclick=()=>{collectRows();schedule.push({name:'新阶段',start:'',end:''});draw()};$('scheduleRows').onclick=e=>{const b=e.target.closest('[data-delete-phase]');if(b){collectRows();schedule.splice(Number(b.dataset.deletePhase),1);draw()}};
 $('widgetForm').onsubmit=e=>{e.preventDefault();try{collectRows();const ordered=schedule.slice().sort((a,b)=>a.start.localeCompare(b.start));ordered.forEach((p,i)=>{if(!p.name||!/^\d{2}:\d{2}$/.test(p.start)||!/^\d{2}:\d{2}$/.test(p.end)||p.start>=p.end||(i&&p.start<ordered[i-1].end))throw Error('请填写阶段名称和有效起止时间，时间不能重叠或跨日')});const next=clone(settings);next.widgets.schedule=ordered;next.widgets.quote=false;for(const k of ['clock','countdowns','todo'])next.widgets[k]=$('widget-'+k).checked;next.widgets.vacation=$('vacation').value;for(const k of ['holidays','workdays']){next.widgets[k]=$(k).value.split(/[\s,，]+/).filter(Boolean);if(next.widgets[k].some(d=>!dateOK(d)))throw Error('日期请使用 YYYY-MM-DD 格式')}next.widgets.seasons=w.seasons.map((s,i)=>$('season-'+i).value);if(writeAll(records,library,profile,{nextSettings:next})){$('widgetSettings').close();render()}}catch(err){$('widgetError').textContent=err.message}};
};
function applyTheme(){const mode=localStorage.getItem('gaoji.theme.v8')||'auto',dark=mode==='dark'||mode==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=dark?'dark':'light';if($('themeMode'))$('themeMode').value=mode}
function themeControl(){document.querySelector('#themeControl')?.remove();const box=document.createElement('div');box.id='themeControl';box.innerHTML='<label for="themeMode">外观</label><select id="themeMode" aria-label="昼夜模式"><option value="auto">跟随系统</option><option value="light">☀ 白天</option><option value="dark">☾ 黑夜</option></select>';document.body.append(box);$('themeMode').onchange=()=>{localStorage.setItem('gaoji.theme.v8',$('themeMode').value);applyTheme()};applyTheme()}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
const v8Shell=renderShell;renderShell=function(){v8Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('7.0','8.0');themeControl()};
const v8Login=showLogin;showLogin=function(register=false){v8Login(register);themeControl()};
function hideDate(id){const input=$(id);if(input){input.closest('.field').hidden=true;input.type='hidden'}}
const v8Citations=editCitations;editCitations=function(id){v8Citations(id);hideDate('cite-date')};
const v8Profile=renderProfile;renderProfile=function(){v8Profile();hideDate('p-metricsDate')};
const v8Editor=openEditor;openEditor=function(id,source){v8Editor(id,source);hideDate('citationDate');editorBaseline=editorFingerprint()};
const v8SavePaper=savePaper;savePaper=function(e){const old=records.find(r=>r.id===editing),count=$('citations').value===''?null:Number($('citations').value);if(count!==null&&(!old||old.citations!==count||!old.citationDate))$('citationDate').value=today();return v8SavePaper(e)};
const v8Journal=editJournal;editJournal=function(id,name){v8Journal(id,name);$('j-metricsDate').value=today();hideDate('j-metricsDate');const submit=$('journalForm').onsubmit;$('journalForm').onsubmit=e=>{$('j-metricsDate').value=today();return submit(e)}};
const v8Journals=renderJournals;renderJournals=function(){v8Journals();document.querySelectorAll('.journal-info .actions a').forEach(a=>{a.className='btn';if(!a.textContent.includes('投稿')&&!a.textContent.includes('Submit'))a.classList.add('journal-home-button')})};
const ADDRESS_FIELDS=['country','region','city','postalCode'];
function affiliationText(x){return [x.department,x.name||x.institution,[x.city,x.region].filter(Boolean).join(', ')+(x.postalCode?' '+x.postalCode:''),x.country].map(s=>String(s||'').trim()).filter(Boolean).join(', ')}
function institutionMatch(a,entries=settings.institutions){return entries.find(x=>x.id&&x.id===a.institutionId)||entries.find(x=>x.name===a.institution&&(x.department||'')===(a.department||''))}
const v8Entries=institutionEntries;institutionEntries=function(){return v8Entries().map(x=>{const contributors=[...library,...records.flatMap(r=>r.authors)];const out={...x};for(const k of ADDRESS_FIELDS)if(!out[k])out[k]=contributors.find(a=>a.institution===x.name&&(a.department||'')===x.department&&a[k])?.[k]||'';return out})};
renderInstitutions=function(){const entries=institutionEntries(),names=[...new Set(entries.map(x=>x.name))].sort((a,b)=>a.localeCompare(b));$('content').innerHTML=`<section class="panel"><div class="section-heading"><h2>学校与学院</h2><div class="actions">${btn('导出机构地址','id="exportInstitutions"')}${btn('＋ 添加学校 / 学院','data-institution=""',true)}</div></div></section>${names.map(name=>`<section class="panel"><h2>${esc(name)}</h2><div class="institution-grid">${entries.filter(x=>x.name===name).map(x=>`<article class="desk-card affiliation-card"><h3>${esc(x.department)||'学校 / 机构'}</h3><p class="affiliation-address">${esc(affiliationText(x))}</p><p class="institution-authors">所属作者：${institutionAuthors(x).map(esc).join('、')||'暂无关联作者'}</p><div class="affiliation-actions">${btn('编辑',`data-edit-affiliation="${esc(institutionKey(x))}"`)}${btn('删除',`data-remove-institution="${esc(institutionKey(x))}"`)}${btn('复制地址',`data-copy-affiliation="${esc(institutionKey(x))}"`)}</div></article>`).join('')}</div></section>`).join('')}`;$('exportInstitutions').onclick=()=>download('\uFEFF'+['学院,机构,城市,地区,邮编,国家,投稿地址,所属作者',...entries.map(x=>[x.department,x.name,x.city,x.region,x.postalCode,x.country,affiliationText(x),institutionAuthors(x).join('; ')].map(v=>'"'+String(v||'').replaceAll('"','""')+'"').join(','))].join('\r\n'),'institutions-'+today()+'.csv')};
editInstitution=function(id,name='',entry=null){const current=entry||settings.institutions.find(x=>x.id===id)||{name},oldKey=institutionKey(current);
 modal('institutionEdit','机构与投稿地址',`<form id="institutionForm"><div class="form-grid">${field('i-name','学校 / 机构',current.name,'text','required')}${field('i-department','学院 / 部门',current.department)}${field('i-country','国家',current.country)}${field('i-region','地区 / 省州',current.region)}${field('i-city','城市',current.city)}${field('i-postalCode','邮编',current.postalCode,'text','autocomplete="postal-code"')}${field('i-website','网站',current.website,'url')}</div><p class="note">使用投稿所需的语言填写名称与地址，例如英文。保存后，已匹配的作者库资料会同步；论文保留提交时的署名快照。</p><label>投稿地址预览<textarea id="affiliationPreview" readonly></textarea></label><div class="modal-foot">${btn('复制地址','type="button" id="copyPreview"')}${btn(txt.save(),'type="submit"',true)}</div></form>`);attachInstitutionHints();
 const read=()=>Object.fromEntries(['name','department',...ADDRESS_FIELDS,'website'].map(k=>[k,$('i-'+k).value.trim()]));const preview=()=>{$('affiliationPreview').value=affiliationText(read())};$('institutionForm').addEventListener('input',preview);preview();$('copyPreview').onclick=()=>copyAffiliation($('affiliationPreview').value);
 $('institutionForm').onsubmit=e=>{e.preventDefault();const item={...current,...read(),id:current.id||uid()},next=clone(settings);const other=next.institutions.find(x=>x.id!==item.id&&institutionKey(x)===institutionKey(item));if(other){toast('该学校与学院已存在，请编辑已有条目');return}next.institutions=next.institutions.filter(x=>x.id!==item.id&&institutionKey(x)!==oldKey);next.institutions.push(item);next.hiddenInstitutions=(next.hiddenInstitutions||[]).filter(k=>k!==institutionKey(item));const people=library.map(a=>institutionKey({name:a.institution,department:a.department})===oldKey?{...a,institutionId:item.id,institution:item.name,department:item.department,...Object.fromEntries(ADDRESS_FIELDS.map(k=>[k,item[k]]))}:a);if(writeAll(records,people,profile,{nextSettings:next})){$('institutionEdit').close();renderInstitutions()}};
};
async function copyAffiliation(text){try{await navigator.clipboard.writeText(text);toast('机构地址已复制')}catch{newDialogIfNeeded();modal('copyAddress','复制机构地址','<textarea id="copyAddressText" readonly></textarea><p class="note">请按 Ctrl+C / ⌘C 复制所选文字。</p>');$('copyAddressText').value=text;$('copyAddressText').select()}}
function newDialogIfNeeded(){if(!$('copyAddress'))newDialog('copyAddress')}
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit-affiliation],[data-copy-affiliation]');if(!b)return;const key=b.dataset.editAffiliation||b.dataset.copyAffiliation,x=institutionEntries().find(x=>institutionKey(x)===key);if(!x)return;if(b.hasAttribute('data-edit-affiliation'))editInstitution(x.id,x.name,x);else copyAffiliation(affiliationText(x))});
const v8LibraryEdit=editLibrary;editLibrary=function(id){v8LibraryEdit(id);const p=library.find(x=>x.id===id)||{},entries=institutionEntries();$('libraryForm').querySelector('.form-grid').insertAdjacentHTML('beforeend',select('lib-affiliation','从机构资料库读取',[['','手动填写'],...entries.map(x=>[institutionKey(x),[x.name,x.department].filter(Boolean).join(' · ')])],institutionKey({name:p.institution,department:p.department}))+ADDRESS_FIELDS.map(k=>field('lib-'+k,{country:'国家',region:'地区 / 省州',city:'城市',postalCode:'邮编'}[k],p[k])).join(''));
 const fill=x=>{if(!x)return;$('lib-institution').value=x.name;$('lib-department').value=x.department||'';for(const k of ADDRESS_FIELDS)$('lib-'+k).value=x[k]||''};$('lib-affiliation').onchange=()=>fill(entries.find(x=>institutionKey(x)===$('lib-affiliation').value));
 for(const k of ['institution','department'])$('lib-'+k).addEventListener('change',()=>fill(entries.find(x=>x.name===$('lib-institution').value&&(x.department||'')===$('lib-department').value)));
 const submit=$('libraryForm').onsubmit;$('libraryForm').onsubmit=e=>{const address=Object.fromEntries(ADDRESS_FIELDS.map(k=>[k,$('lib-'+k).value.trim()])),name=$('lib-name').value.trim(),institution=$('lib-institution').value.trim(),department=$('lib-department').value.trim(),writer=writeAll;writeAll=function(rs,people,pf,options={}){people=people.map(a=>a.name===name&&a.institution===institution&&a.department===department&&(!id||a.id===id)?{...a,...address,institutionId:institutionMatch(a)?.id||''}:a);return writer(rs,people,pf,options)};try{submit(e)}finally{writeAll=writer}};
};
// Author edits enrich matching institution entries; explicit institution edits update linked authors above.
const v8Write=writeAll;writeAll=function(rs=records,people=library,p=profile,options={}){const next=clone(options.nextSettings||settings);for(const a of people){if(!a.institution)continue;const key=institutionKey({name:a.institution,department:a.department});if((next.hiddenInstitutions||[]).includes(key))continue;let item=institutionMatch(a,next.institutions);if(!item){item={id:uid(),name:a.institution,department:a.department||''};next.institutions.push(item)}const before=library.find(x=>x.id===a.id);for(const k of ADDRESS_FIELDS)if(a[k]&&(!item[k]||before&&before[k]!==a[k]))item[k]=a[k]}
 return v8Write(rs,people,p,{...options,nextSettings:next});};


'use strict';
const v9Login=showLogin;showLogin=function(register=false){v9Login(register);const art=document.querySelector('.auth-art');art.querySelector('h2').textContent=T('投个好稿，接收好运。','A good paper deserves good news.','今日も、よい知らせを待ちながら。');art.querySelector('.eyebrow').textContent=T('你的科研伙伴','YOUR RESEARCH COMPANION','あなたの研究パートナー');};
function countdownTarget(el,now=new Date()){
 if(el.querySelector('#phaseCountdown'))return phaseAt(now).end?.getTime()??Infinity;
 if(el.querySelector('#weekendCountdown'))return restTarget(now,widgetData())?.getTime()??Infinity;
 if(el.querySelector('#vacationCountdown'))return widgetData().vacation?new Date(widgetData().vacation).getTime():Infinity;
 const custom=el.querySelector('[data-clock-target]');return custom?new Date(custom.dataset.clockTarget).getTime():Infinity;
}
function sortCountdowns(){const stack=document.querySelector('.countdown-stack');if(!stack)return;const add=stack.querySelector('.add-mini');[...stack.children].filter(el=>el!==add).map((el,index)=>({el,index,time:countdownTarget(el)})).sort((a,b)=>a.time-b.time||a.index-b.index).forEach(x=>stack.append(x.el));if(add)stack.append(add)}
const v9Overview=renderOverview;renderOverview=function(){v9Overview();sortCountdowns()};
// Visibility refresh complements the overview clock's boundary updates.
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&page==='overview')sortCountdowns()});
function normalizedName(a){return String(a.name||'').replace(/[\s.,，]/g,'').toLocaleLowerCase()}
function sameAuthor(a,b){if(a.id&&b.id&&a.id===b.id)return true;if(a.email&&b.email)return a.email.toLowerCase()===b.email.toLowerCase();return normalizedName(a)&&normalizedName(a)===normalizedName(b)&&(a.institution||'')===(b.institution||'')}
function isSelf(a){return !!profile&&(a.id==='self:'+profile.username||sameAuthor(a,ownPerson()))}
function authorPaperCount(a){return records.filter(r=>r.authors.some(p=>sameAuthor(a,p))).length}
availablePeople=function(){const people=originalAvailable();return people.slice().sort((a,b)=>Number(isSelf(b))-Number(isSelf(a))||(authorSort==='alpha'?a.name.localeCompare(b.name,lang==='en'?'en':'zh-CN',{sensitivity:'base'}):authorPaperCount(b)-authorPaperCount(a)||a.name.localeCompare(b.name,'zh-CN')))};
const v9Authors=renderAuthors;renderAuthors=function(){v9Authors();const option=$('authorSort').querySelector('option[value="paper"]');if(option)option.textContent=T('合作论文次数（多到少）','Papers together (most first)','共著論文数（多い順）');const enhance=()=>{const people=availablePeople();document.querySelectorAll('#libraryList .library-item').forEach(card=>{card.querySelector('.coauthor-count')?.remove();const id=card.querySelector('[data-library-edit]')?.dataset.libraryEdit;const a=id?people.find(p=>p.id===id):people.find(isSelf);if(a){const badge=document.createElement('span');badge.className='coauthor-count';badge.textContent=(isSelf(a)?T('本人 · 参与论文','Me · Papers','本人 · 論文'):T('合作次数','Papers together','共著数'))+' '+authorPaperCount(a);card.querySelector('h3').append(badge)}})};enhance();$('librarySearch').addEventListener('input',enhance)};
// Affiliation identity is the school AND department. A stale link must never cross departments.
institutionMatch=function(a,entries=settings.institutions){return entries.find(x=>x.name===a.institution&&(x.department||'')===(a.department||''))};
const v9Institution=editInstitution;editInstitution=function(id,name,entry){v9Institution(id,name,entry);const website=$('i-website');if(website){website.type='hidden';website.closest('.field').hidden=true}const region=$('i-region');if(region)region.placeholder='例如 Guangdong / 广东省';};
const v9Institutions=renderInstitutions;renderInstitutions=function(){v9Institutions();document.querySelectorAll('.affiliation-card').forEach(card=>{const key=card.querySelector('[data-edit-affiliation]').dataset.editAffiliation,x=institutionEntries().find(x=>institutionKey(x)===key);if(!x)return;const details=document.createElement('div');details.className='address-details';details.innerHTML=[['国家',x.country],['地区 / 省州',x.region],['城市',x.city],['邮编',x.postalCode]].map(([label,value])=>`<div><small>${label}</small><span>${esc(value)||'—'}</span></div>`).join('');card.querySelector('.affiliation-address').before(details)})};
const v9Profile=renderProfile;renderProfile=function(){v9Profile();const columns=document.querySelector('.profile-columns');if(!columns)return;columns.classList.add('profile-balanced');const metrics=columns.querySelector('.metrics-small');metrics?.closest('.panel').classList.add('research-summary');};
const v9Shell=renderShell;renderShell=function(){v9Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('8.0','9.0')};


'use strict';
// Backdrop clicks are deliberately ignored: selection drags must never close an editor.
document.addEventListener('click',e=>{if(e.target instanceof HTMLDialogElement)e.stopImmediatePropagation()},true);
function fixedDialogActions(){
 document.querySelectorAll('dialog[open] form').forEach(form=>{
  if(form.querySelector('.editor-top-actions'))return;
  const submit=form.querySelector('button[type="submit"]');if(!submit)return;
  const bar=document.createElement('div');bar.className='editor-top-actions';
  const back=document.createElement('button');back.type='button';back.className='btn';back.textContent='返回';back.onclick=()=>form.closest('dialog').close();
  bar.append(back,submit);form.prepend(bar);
 });
}
new MutationObserver(fixedDialogActions).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
const v10Widgets=widgetSettings;widgetSettings=function(){v10Widgets();for(const id of ['holidays','workdays'])$(id)?.closest('label').classList.add('hidden');for(let i=0;i<4;i++)$('season-'+i)?.closest('.field').classList.add('hidden');$('widgetForm').querySelectorAll('h3,.note').forEach(el=>{if(/休息日与调休|四季问候|每行一个/.test(el.textContent))el.hidden=true});fixedDialogActions()};
const v10Overview=renderOverview;renderOverview=function(){v10Overview();const stack=document.querySelector('.countdown-stack');if(stack){const wrap=document.createElement('article');wrap.className='countdown-widget';stack.before(wrap);const head=document.createElement('header');head.innerHTML='<b>倒计时</b>';const add=stack.querySelector('.add-mini');if(add){add.className='btn';add.title='添加倒计时';head.append(add)}wrap.append(head,stack)}updateStageCharge()};
function updateStageCharge(){document.querySelectorAll('.work-phase').forEach(el=>{let badge=el.querySelector('.stage-percent');if(!badge){badge=document.createElement('strong');badge.className='stage-percent';el.append(badge)}const p=parseFloat(el.style.getPropertyValue('--progress'))||0;badge.textContent=el.classList.contains('current')?Math.floor(p)+'%':'';el.setAttribute('aria-label',el.querySelector('span').textContent+' '+(el.classList.contains('current')?Math.floor(p)+'%':''))})}
const v10Sort=sortCountdowns;sortCountdowns=function(){v10Sort();updateStageCharge()};
const v10Profile=renderProfile;renderProfile=function(){v10Profile();if(profile&&!profileEditing)appendSocial(accountStore.active)};
// School and department are the sole address identity. Imported author IDs never become institution IDs.
institutionEntries=function(){
 const entries=new Map(),hidden=new Set(settings.hiddenInstitutions||[]);
 for(const x of settings.institutions){const item={...x,name:x.name,department:x.department||''};const key=institutionKey(item);if(!hidden.has(key))entries.set(key,item)}
 for(const a of [...library,...records.flatMap(r=>r.authors)]){if(!a.institution)continue;const key=institutionKey({name:a.institution,department:a.department});if(hidden.has(key)||entries.has(key))continue;entries.set(key,{id:'',name:a.institution,department:a.department||'',country:a.country||'',city:a.city||'',postalCode:a.postalCode||''})}
 return [...entries.values()];
};
affiliationText=function(x){return [x.department,x.name||x.institution,[x.city,x.postalCode].filter(Boolean).join(' '),x.country].filter(Boolean).join(', ')};
const v10Institution=editInstitution;editInstitution=function(id,name='',entry=null){
 const actual=entry||settings.institutions.find(x=>x.id===id)||{name,department:''};
 v10Institution(id,name,actual);$('i-region')?.closest('.field').classList.add('hidden');
 $('institutionForm').onsubmit=e=>{e.preventDefault();const next=clone(settings),oldKey=institutionKey(actual),item={...actual,id:actual.id||uid()};for(const k of ['name','department','country','city','postalCode'])item[k]=$('i-'+k).value.trim();
  const key=institutionKey(item);if(next.institutions.some(x=>institutionKey(x)===key&&institutionKey(x)!==oldKey)){toast('该学院已存在，请编辑对应学院');return}
  next.institutions=next.institutions.filter(x=>institutionKey(x)!==oldKey);next.institutions.push(item);next.hiddenInstitutions=(next.hiddenInstitutions||[]).filter(k=>k!==key);
  const people=library.map(a=>institutionKey({name:a.institution,department:a.department})===oldKey?{...a,institution:item.name,department:item.department,institutionId:item.id,country:item.country,city:item.city,postalCode:item.postalCode}:a);
  if(writeAll(records,people,profile,{nextSettings:next})){$('institutionEdit').close();renderInstitutions()}
 };fixedDialogActions();
};
const v10Institutions=renderInstitutions;renderInstitutions=function(){v10Institutions();document.querySelectorAll('.address-details>div').forEach(el=>{if(el.querySelector('small').textContent.includes('地区'))el.remove()});$('exportInstitutions').onclick=()=>download('\uFEFF'+['学院,机构,城市,邮编,国家,投稿地址,所属作者',...institutionEntries().map(x=>[x.department,x.name,x.city,x.postalCode,x.country,affiliationText(x),institutionAuthors(x).join('; ')].map(v=>'"'+String(v||'').replaceAll('"','""')+'"').join(','))].join('\r\n'),'institutions-'+today()+'.csv')};
const v10Library=editLibrary;editLibrary=function(id){v10Library(id);$('lib-region')?.closest('.field').classList.add('hidden')};
// Explicit institution settings win. Automatic author collection only updates an author's own exact pair.
writeAll=function(rs=records,people=library,p=profile,options={}){
 const next=clone(options.nextSettings||settings);
 for(const a of people){if(!a.institution)continue;const key=institutionKey({name:a.institution,department:a.department});if((next.hiddenInstitutions||[]).includes(key))continue;
  let item=next.institutions.find(x=>institutionKey(x)===key);
  if(!item){item={id:uid(),name:a.institution,department:a.department||''};next.institutions.push(item)}
  if(!options.nextSettings){const old=library.find(x=>x.id===a.id);for(const k of ['country','city','postalCode'])if(a[k]&&(!item[k]||old&&old[k]!==a[k]))item[k]=a[k]}
 }
 return v8Write(rs,people,p,{...options,nextSettings:next});
};
const SHARED_FEEDBACK='de.feedback.shared.v1',SOCIAL_KEY='de.social.v1';
function sharedFeedback(){
 const native=accountStore.native,raw=native.getItem(SHARED_FEEDBACK);if(raw)return JSON.parse(raw);
 const candidates=[settings.feedback];for(let i=0;i<native.length;i++){const key=native.key(i);if(key==='gaoji.settings.v4'||/^de\.user\.[^.]+\.gaoji\.settings\.v4$/.test(key)){try{candidates.push(JSON.parse(native.getItem(key)).feedback)}catch{}}}
 const result={};for(const f of candidates.filter(Boolean))for(const [k,v] of Object.entries(f))if(v&&!result[k])result[k]=v;
 native.setItem(SHARED_FEEDBACK,JSON.stringify(result));return result;
}
const v10Feedback=renderFeedback;renderFeedback=function(){const saved=settings.feedback;try{settings.feedback=sharedFeedback();v10Feedback()}finally{settings.feedback=saved}};
function socialData(){return JSON.parse(accountStore.native.getItem(SOCIAL_KEY)||'{"visits":[],"messages":[]}')}
function saveSocial(data){try{accountStore.native.setItem(SOCIAL_KEY,JSON.stringify(data));return true}catch{toast('保存失败，请检查本地存储空间');return false}}
function publicAccounts(){return accountStore.list().map(a=>({id:a.id,name:a.profile.name||a.profile.username,profile:a.profile}))}
function appendSocial(owner){
 $('socialPanel')?.remove();const data=socialData(),users=publicAccounts(),name=id=>users.find(a=>a.id===id)?.name||'原本地用户',visits=data.visits.filter(v=>v.to===owner).sort((a,b)=>b.at.localeCompare(a.at)),messages=data.messages.filter(m=>m.to===owner).sort((a,b)=>b.at.localeCompare(a.at));
 const panel=document.createElement('section');panel.id='socialPanel';panel.className='panel social-panel';panel.innerHTML=`<h2>访客与留言</h2><div class="visitor-list">${visits.slice(0,12).map(v=>`<button class="visitor-chip" data-visit-profile="${esc(v.from)}">${esc(name(v.from))}<small>${esc(v.at.slice(0,10))}</small></button>`).join('')||'<p class="note">还没有访客，去学术圈认识一下同行吧。</p>'}</div><h3>留言板</h3><form id="messageForm"><textarea id="messageText" maxlength="1000" required placeholder="写下你的想法或问候…"></textarea><button class="btn primary" type="submit">发表留言</button></form><div class="message-list">${messages.map(m=>`<article><header><b>${esc(name(m.from))}</b><small>${esc(new Date(m.at).toLocaleString())}</small>${m.from===accountStore.active||owner===accountStore.active?btn('删除',`data-delete-message="${esc(m.id)}" data-message-owner="${esc(owner)}"`):''}</header><p>${esc(m.text)}</p></article>`).join('')}</div>`;
 $('content').append(panel);$('messageForm').onsubmit=e=>{e.preventDefault();const text=$('messageText').value.trim();if(!text)return;const next=socialData();next.messages.push({id:uid(),from:accountStore.active,to:owner,text,at:new Date().toISOString()});if(saveSocial(next)){appendSocial(owner);toast('留言已发表')}};
}
let circleProfile=null;
function renderCircle(){
 $('pageTitle').textContent='学术圈';const users=publicAccounts();const target=users.find(a=>a.id===circleProfile);
 if(!target){$('content').innerHTML=`<section class="panel"><h2>学术圈</h2><p class="note">同一浏览器中的本地账号可互访学术主页、记录访客与留言。</p></section><div class="circle-grid">${users.map(a=>`<article class="panel circle-person"><div class="avatar">${esc(a.name.slice(0,1))}</div><h3>${esc(a.name)}</h3><p>${esc(a.profile.institution||'')} · ${esc(a.profile.department||'')}</p><p>${esc(a.profile.bio||'')}</p>${btn('访问学术主页',`data-visit-profile="${esc(a.id)}"`,true)}</article>`).join('')}</div>`;return}
 const p=target.profile;
 $('content').innerHTML=`<section class="profile-hero"><button class="btn" id="backCircle">← 学术圈</button><h2>${esc(target.name)}</h2><p>${esc(p.institution)} · ${esc(p.department)}</p><p>${esc(p.bio)}</p></section><div class="profile-columns profile-balanced"><section class="panel"><h2>个人信息</h2><p>${esc(p.title)}</p><p>${esc(p.keywords)}</p><p>${esc(p.email)}</p></section><section class="panel research-summary"><h2>学术指标</h2><div class="metrics-small">${[['publications','论文'],['citations','引用'],['hIndex','h-index']].map(([k,n])=>`<div class="metric-small"><strong>${esc(p[k]??'—')}</strong><span>${n}</span></div>`).join('')}</div></section></div><section class="panel"><h2>教育与任职</h2>${(p.careers||[]).map(c=>`<p>${esc(c.institution)} · ${esc(c.position)} · ${esc(c.start)} — ${esc(c.current?'至今':c.end)}</p>`).join('')||`<p>${esc(p.education||'暂无经历')}</p>`}</section>`;
 $('backCircle').onclick=()=>{circleProfile=null;renderCircle()};appendSocial(target.id);
}
const v10Shell=renderShell;renderShell=function(){v10Shell();document.querySelector('[data-page="profile"]').insertAdjacentHTML('afterend',`<button class="nav ${page==='circle'?'active':''}" data-page="circle">学术圈</button>`);document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('9.0','10.0')};
const v10Render=render;render=function(){if(page==='circle'){clearInterval(clockTimer);renderShell();renderCircle()}else v10Render()};
document.addEventListener('click',e=>{
 const visit=e.target.closest('[data-visit-profile]');if(visit){const owner=visit.dataset.visitProfile;if(!publicAccounts().some(a=>a.id===owner))return;circleProfile=owner;if(owner!==accountStore.active){const next=socialData();next.visits=next.visits.filter(v=>!(v.from===accountStore.active&&v.to===owner));next.visits.push({from:accountStore.active,to:owner,at:new Date().toISOString()});saveSocial(next)}page='circle';render()}
 const del=e.target.closest('[data-delete-message]');if(del){const next=socialData(),message=next.messages.find(m=>m.id===del.dataset.deleteMessage);if(message&&(message.from===accountStore.active||message.to===accountStore.active)){next.messages=next.messages.filter(m=>m.id!==message.id);if(saveSocial(next))appendSocial(message.to)}}
});


'use strict';
const DELETED_ACCOUNTS='de.deletedAccounts.v1';
function accountWasDeleted(){return !!profile&&JSON.parse(accountStore.native.getItem(DELETED_ACCOUNTS)||'[]').some(x=>x.id===accountStore.active&&x.generation===profile.salt)}
function clearDeletedSession(){
 unlocked=false;clearInterval(clockTimer);clearTimeout(undoTimer);undoState=null;$('undoNotice')?.remove();
 records=[];library=[];profile=null;settings=validateSettings({journals:clone(DEFAULT_JOURNALS),feedback:{email:'yanghuaisong@hrbeu.edu.cn'}});profileEditing=false;adminUnlocked=false;circleProfile=null;page='overview';
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());showLogin();
}
const v11Write=writeAll;writeAll=function(...args){if(accountWasDeleted()){clearDeletedSession();toast('该账号已删除，请重新登录');return false}return v11Write(...args)};
window.addEventListener('storage',e=>{if(e.key===DELETED_ACCOUNTS&&accountWasDeleted())clearDeletedSession()});
newDialog('deleteAccount');
function deleteAccountDialog(){
 if(!profile||!unlocked)return;
 modal('deleteAccount','删除本账户',`<form id="deleteAccountForm"><div class="delete-account-warning"><h3>${esc(profile.username)}</h3><p>此操作会永久删除本账号的稿件、作者库、个人资料、设置和本地备份快照，并清除相关访客与留言。其他账号和共用支持信息保留。此操作不能撤回。</p></div>${field('deletePassword','当前账号密码','','password','required autocomplete="current-password"')}${field('deleteConfirmation','输入用户名确认删除','','text','required autocomplete="off"')}<p id="deleteAccountError" class="auth-error" role="alert"></p><div class="modal-foot">${btn('永久删除本账户','type="submit" class="danger-action"')}</div></form>`);
 fixedDialogActions();
 $('deleteAccountForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter,owner=accountStore.active,expected=profile;button.disabled=true;
 try{
  if($('deleteConfirmation').value.trim()!==expected.username)throw Error('确认用户名不一致');
  if(await passwordHash($('deletePassword').value,expected.salt)!==expected.hash)throw Error('当前账号密码错误');
  if(owner!==accountStore.active||profile!==expected)throw Error('账号状态已变化，请重新操作');
  removeCurrentAccount();toast('本账户已删除');
 }catch(err){if($('deleteAccountError'))$('deleteAccountError').textContent=err.message}finally{button.disabled=false}
 };
}
function removeCurrentAccount(){
 const native=accountStore.native,owner=accountStore.active,generation=profile.salt;
 const changes=new Map(),remember=k=>{if(!changes.has(k))changes.set(k,native.getItem(k))};
 const keys=[];for(let i=0;i<native.length;i++){const key=native.key(i);if(owner==='legacy'?key.startsWith('gaoji.')&&key!=='gaoji.lang':key.startsWith('de.user.'+owner+'.'))keys.push(key)}
 // Materialize common support before deleting a legacy workspace that contains it.
 sharedFeedback();
 try{
  remember(DELETED_ACCOUNTS);const deleted=JSON.parse(native.getItem(DELETED_ACCOUNTS)||'[]');deleted.push({id:owner,generation});native.setItem(DELETED_ACCOUNTS,JSON.stringify(deleted));
  remember(SOCIAL_KEY);const social=socialData();social.visits=social.visits.filter(x=>x.from!==owner&&x.to!==owner);social.messages=social.messages.filter(x=>x.from!==owner&&x.to!==owner);native.setItem(SOCIAL_KEY,JSON.stringify(social));
  for(const key of keys){remember(key);native.removeItem(key)}
  remember('de.lastAccount');native.removeItem('de.lastAccount');
 }catch(err){for(const [key,value] of changes){if(value===null)native.removeItem(key);else native.setItem(key,value)}throw err}
 sessionStorage.removeItem('de.account');clearDeletedSession();
}
const v11Profile=renderProfile;renderProfile=function(){v11Profile();if(profile&&profileEditing){const panel=document.createElement('section');panel.className='panel account-management';panel.innerHTML='<div><h2>账号管理</h2><p class="note">管理当前本地账号</p></div>'+btn('删除本账户','id="openDeleteAccount"');$('content').append(panel);$('openDeleteAccount').onclick=deleteAccountDialog}};
const v11Stats=renderStats;renderStats=function(){v11Stats();document.querySelector('.stats-grid')?.classList.add('equal-panel-grid')};
const v11Shell=renderShell;renderShell=function(){v11Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('10.0','11.0')};
// Load the final visual system after the historical styles, including their asynchronous additions.


'use strict';
const LOGIN_HISTORY='de.loginHistory.v1';
function loginHistory(){try{return JSON.parse(accountStore.native.getItem(LOGIN_HISTORY)||'[]')}catch{return []}}
function rememberUsername(){if(!profile)return;const names=[profile.username,...loginHistory().filter(n=>n!==profile.username)];try{accountStore.native.setItem(LOGIN_HISTORY,JSON.stringify(names.slice(0,20)))}catch{}}
function drawLoginHistory(){
 $('loginHistory')?.remove();if(!$('loginUser')||!loginHistory().length)return;
 const box=document.createElement('div');box.id='loginHistory';box.innerHTML=`<small>最近登录</small><div>${loginHistory().map(n=>`<span class="login-history-chip"><button type="button" data-use-login="${esc(n)}">${esc(n)}</button><button type="button" data-forget-login="${esc(n)}" aria-label="删除 ${esc(n)} 的登录记录">×</button></span>`).join('')}</div>`;$('loginUser').closest('.field').before(box);
 box.onclick=e=>{const use=e.target.closest('[data-use-login]'),remove=e.target.closest('[data-forget-login]');if(use){$('loginUser').value=use.dataset.useLogin;$('loginPassword').focus()}if(remove){accountStore.native.setItem(LOGIN_HISTORY,JSON.stringify(loginHistory().filter(n=>n!==remove.dataset.forgetLogin)));drawLoginHistory()}};
}
const v12Login=showLogin;showLogin=function(register=false){v12Login(register);if(!register){$('loginUser').value=loginHistory()[0]||'';drawLoginHistory()}};
const v12Enter=enterWorkspace;enterWorkspace=function(){v12Enter();rememberUsername()};
const v12Delete=removeCurrentAccount;removeCurrentAccount=function(){const username=profile?.username;v12Delete();accountStore.native.setItem(LOGIN_HISTORY,JSON.stringify(loginHistory().filter(n=>n!==username)));drawLoginHistory()};
remaining=function(target,precision,now=new Date()){
 if(!target)return '待设置';const seconds=Math.max(0,Math.ceil((new Date(target)-now)/1000));if(!Number.isFinite(seconds))return '待设置';
 if(seconds>=86400)return `${Math.ceil(seconds/86400)} 天`;
 if(seconds>=3600)return `${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`;
 return `${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
};
function defaultDeadline(value){return value&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T21:00':value}
const v12WidgetData=widgetData;widgetData=function(){const w=v12WidgetData();w.vacation=defaultDeadline(w.vacation);return w};
restTarget=function(now,w=widgetData()){
 if(offDay(now,w))return now;
 const day=new Date(now);day.setHours(0,0,0,0);
 for(let i=0;i<370;i++){day.setDate(day.getDate()+1);if(offDay(day,w)){day.setDate(day.getDate()-1);day.setHours(21,0,0,0);return day<now?now:day}}return null;
};
const v12Widgets=widgetSettings;widgetSettings=function(){v12Widgets();const original=$('vacation'),value=original.value;original.type='hidden';original.closest('.field').hidden=true;
 const fields=document.createElement('div');fields.className='form-grid';fields.innerHTML=field('vacationDay','假期日期',value.slice(0,10),'date')+field('vacationTime','开始时间（默认 21:00）',value.includes('T')?value.slice(11,16):'21:00','time');original.closest('.form-grid').after(fields);
 const submit=$('widgetForm').onsubmit;$('widgetForm').onsubmit=e=>{original.value=$('vacationDay').value?$('vacationDay').value+'T'+($('vacationTime').value||'21:00'):'';return submit(e)};
};
const v12Countdown=editCountdown;editCountdown=function(id){v12Countdown(id);if(!id)$('c-time').value='21:00'};
const v12Overview=renderOverview;renderOverview=function(){v12Overview();document.querySelector('.filters')?.classList.add('colored-filters');const title=$('count')?.closest('.section-heading');title?.classList.add('submission-heading');};
newDialog('journalPicker');
function chooseJournal(){modal('journalPicker','编辑期刊',`<div class="journal-picker">${settings.journals.map(j=>btn(esc(j.name),`data-journal="${esc(j.id)}" data-close="journalPicker"`)).join('')||'<p>请先添加期刊。</p>'}</div>`)}
const v12Journals=renderJournals;renderJournals=function(){
 v12Journals();const heading=document.querySelector('#content .section-heading'),add=heading.querySelector('[data-new-journal]');const controls=document.createElement('div');controls.className='actions';add.before(controls);controls.append(add);controls.insertAdjacentHTML('beforeend',btn('编辑期刊','id="chooseJournal"'));$('chooseJournal').onclick=chooseJournal;
 document.querySelectorAll('.journal-tile').forEach((tile,i)=>{const j=settings.journals[i],actions=tile.querySelector('.journal-info .actions');actions.innerHTML=`${j.homepage&&safeUrl(j.homepage)?`<a class="btn journal-home-button" href="${esc(j.homepage)}" target="_blank" rel="noopener noreferrer">期刊主页 ↗</a>`:'<span class="btn disabled-link">期刊主页 · 未设置</span>'}${j.systemUrl&&safeUrl(j.systemUrl)?`<a class="btn primary" href="${esc(j.systemUrl)}" target="_blank" rel="noopener noreferrer">投稿／审稿 ↗</a>`:'<span class="btn disabled-link">投稿／审稿 · 未设置</span>'}`});
};
const v12Shell=renderShell;renderShell=function(){v12Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('11.0','12.0')};


'use strict';
const v13Login=showLogin;
showLogin=function(register=false){
 v13Login(register);
 document.querySelectorAll('.auth-art h1,.auth-art h2').forEach(el=>{
  const text=el.textContent;el.setAttribute('aria-label',text);el.classList.add('letter-wave');
  el.innerHTML=Array.from(text).map((letter,i)=>`<span aria-hidden="true" style="--letter-index:${i}">${letter===' '?'&nbsp;':esc(letter)}</span>`).join('');
 });
};
const v13Card=card;
card=function(r){
 const wrap=document.createElement('div');wrap.innerHTML=v13Card(r);
 const article=wrap.querySelector('.card'),title=wrap.querySelector('.paper-title');
 const button=document.createElement('button');button.type='button';button.className='paper-title title-toggle';button.dataset.expandTitle='';button.setAttribute('aria-expanded','false');button.title=T('点击展开或收起完整标题','Expand or collapse full title','タイトルを展開・折りたたむ');button.textContent=r.title;title.replaceWith(button);
 // The count is source-independent in this interface; retain source data in stored records.
 const meta=wrap.querySelector('.meta');if(meta&&r.status==='accept'&&r.citations!=null){const spans=meta.querySelectorAll('span');if(spans.length>1)spans[1].textContent=txt.citations()+': '+r.citations}
 button.innerHTML=`<span class="title-text">${esc(r.title)}</span>`;
 article.classList.add('aligned-paper-card');return wrap.innerHTML;
};
document.addEventListener('click',e=>{const button=e.target.closest('[data-expand-title]');if(!button)return;const expanded=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(expanded));button.classList.toggle('title-expanded',expanded)});
const v13Charge=updateStageCharge;
updateStageCharge=function(){
 v13Charge();
 document.querySelectorAll('.work-phase').forEach(el=>{
  const time=el.querySelector('small'),percent=el.querySelector('.stage-percent');
  if(time&&percent&&time.previousElementSibling!==percent)el.insertBefore(percent,time);
 });
};
const v13Shell=renderShell;renderShell=function(){v13Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('12.0','13.0')};


'use strict';
const DEFAULT_LIBRARIES_KEY='de.defaultLibraries.v1';
function libraryTemplate(){
 const raw=accountStore.native.getItem(DEFAULT_LIBRARIES_KEY);
 return raw?JSON.parse(raw):null;
}
function saveLibraryTemplate(){
 const template={journals:clone(settings.journals),institutions:institutionEntries().map(x=>Object.fromEntries(['id','name','department','country','city','postalCode'].map(k=>[k,k==='id'?(x.id||uid()):(x[k]||'')]))),savedAt:new Date().toISOString()};
 accountStore.native.setItem(DEFAULT_LIBRARIES_KEY,JSON.stringify(template));return template;
}
// Seed from the original workspace if available; strip author/account data from shared defaults.
function initializeLibraryTemplate(){
 if(libraryTemplate())return;
 const native=accountStore.native,raw=native.getItem(SETTINGS_KEY);
 if(!raw){if(native.getItem(accountStore.active==='legacy'?PROFILE_KEY:'de.user.'+accountStore.active+'.'+PROFILE_KEY))saveLibraryTemplate();return}
 const source=JSON.parse(raw),hidden=new Set(source.hiddenInstitutions||[]),map=new Map();
 for(const x of source.institutions||[])if(!hidden.has(institutionKey(x)))map.set(institutionKey(x),{id:x.id||uid(),name:x.name,department:x.department||'',country:x.country||'',city:x.city||'',postalCode:x.postalCode||''});
 const people=JSON.parse(native.getItem(AUTHORS_KEY)||'[]');
 for(const a of people){if(!a.institution)continue;const key=institutionKey({name:a.institution,department:a.department});if(!map.has(key)&&!hidden.has(key))map.set(key,{id:uid(),name:a.institution,department:a.department||'',country:a.country||'',city:a.city||'',postalCode:a.postalCode||''})}
 native.setItem(DEFAULT_LIBRARIES_KEY,JSON.stringify({journals:clone(source.journals||DEFAULT_JOURNALS),institutions:[...map.values()],savedAt:new Date().toISOString()}));
}
const v14Load=loadAccount;loadAccount=function(id){
 initializeLibraryTemplate();
 if(!libraryTemplate()&&profile)saveLibraryTemplate();
 const key=id==='legacy'?SETTINGS_KEY:'de.user.'+id+'.'+SETTINGS_KEY,hasSettings=accountStore.native.getItem(key)!==null;
 v14Load(id);
 if(!hasSettings){const template=libraryTemplate();if(template){settings=validateSettings({...settings,journals:clone(template.journals),institutions:clone(template.institutions)})}}
};
const v14Profile=renderProfile;renderProfile=function(){v14Profile();document.querySelector('.account-management')?.remove()};
const v14Backup=renderBackup;renderBackup=function(){
 v14Backup();const panel=document.createElement('section');panel.className='panel account-management';panel.innerHTML=`<div><h2>账号与默认资料</h2><p class="note">新账号默认带入机构库和期刊库，各自编辑互不影响。</p></div><div class="actions">${btn('将当前资料库设为默认','id="saveDefaultLibraries"')}${profile?btn('删除本账户','id="openDeleteAccount"'):''}</div>`;$('content').append(panel);
 $('saveDefaultLibraries').onclick=()=>{try{saveLibraryTemplate();toast('已将当前机构库和期刊库设为新账号默认资料')}catch{toast('保存默认资料失败，请检查存储空间')}};
 $('openDeleteAccount')?.addEventListener('click',deleteAccountDialog);
};
newDialog('logoutConfirm');
let confirmingLogout=false;
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-logout]');if(!button||confirmingLogout)return;
 e.preventDefault();e.stopImmediatePropagation();
 modal('logoutConfirm',T('退出登录','Log out','ログアウト'),`<p>${T('确定要退出当前账号吗？','Log out of the current account?','現在のアカウントからログアウトしますか？')}</p><div class="modal-foot">${btn(T('取消','Cancel','キャンセル'),'data-close="logoutConfirm"')}${btn(T('确认退出','Log out','ログアウト'),'id="confirmLogout"',true)}</div>`);
 $('confirmLogout').onclick=()=>{$('logoutConfirm').close();confirmingLogout=true;try{button.click()}finally{confirmingLogout=false}};
},true);
const v14Shell=renderShell;renderShell=function(){v14Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('13.0','14.0')};
try{initializeLibraryTemplate()}catch(e){console.warn('Default library initialization deferred:',e.message)}


'use strict';
const v15Login=showLogin;showLogin=function(register=false){
 v15Login(register);const art=document.querySelector('.auth-art');art.classList.add('cinematic-login');
 // Preserve localized copy and accessible text while replacing the earlier glyph bounce.
 art.querySelectorAll('.letter-wave').forEach(el=>{el.textContent=el.getAttribute('aria-label')||el.textContent;el.classList.remove('letter-wave')});
 const block=document.createElement('div');block.className='login-copy';while(art.firstChild)block.append(art.firstChild);art.append(block);
};
const v15Charge=updateStageCharge;updateStageCharge=function(){
 v15Charge();document.querySelectorAll('.work-phase').forEach(el=>{const percent=el.querySelector('.stage-percent');if(!percent)return;const n=Math.max(0,Math.min(100,parseFloat(el.style.getPropertyValue('--progress'))||0));const active=el.classList.contains('current');percent.textContent=active?`当前进度 ${Math.floor(n)}%`:'';percent.title=active?'本阶段已经过去的时间比例':'';if(active)el.setAttribute('aria-label',`${el.querySelector('span').textContent}，当前进度 ${Math.floor(n)}%，${el.querySelector('small').textContent}`)});
};
const v15Card=card;card=function(r){
 const wrap=document.createElement('div');wrap.innerHTML=v15Card(r);const article=wrap.querySelector('.card'),meta=wrap.querySelector('.meta'),footer=wrap.querySelector('.card-bottom');
 if(meta&&footer){meta.classList.add('submission-date-row');article.insertBefore(meta,footer)}return wrap.innerHTML;
};
const v15Shell=renderShell;renderShell=function(){v15Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('14.0','15.0')};


'use strict';
const v16Charge=updateStageCharge;
updateStageCharge=function(){
 v16Charge();document.querySelectorAll('.work-phase').forEach(el=>{
  const completed=Math.max(0,Math.min(100,parseFloat(el.style.getPropertyValue('--progress'))||0));
  const active=el.classList.contains('current'),label=el.querySelector('.stage-percent');
  if(label){label.textContent=active?`已完成进度 ${Math.floor(completed)}%`:'';label.title=active?'本阶段已过去时间占整个阶段的比例':''}
  el.style.setProperty('--completed',completed+'%');
  if(active)el.setAttribute('aria-label',`${el.querySelector('span').textContent}，已完成进度 ${Math.floor(completed)}%，${el.querySelector('small').textContent}`);
 });
};
const v16Profile=renderProfile;renderProfile=function(){v16Profile();$('passwordForm')?.closest('.panel').remove()};
const v16Backup=renderBackup;renderBackup=function(){
 v16Backup();if(!profile)return;
 const section=document.createElement('section');section.className='panel credential-settings';
 section.innerHTML=`<h2>账号登录信息</h2><div class="credential-grid"><form id="usernameForm"><h3>修改用户名</h3>${field('newUsername','新用户名',profile.username,'text','required maxlength="100" autocomplete="username"')}${field('usernamePassword','当前密码','','password','required autocomplete="current-password"')}<p class="auth-error" id="usernameError" role="alert"></p>${btn('保存用户名','type="submit"',true)}</form><form id="passwordForm"><h3>修改密码</h3>${field('oldPassword','当前密码','','password','required autocomplete="current-password"')}${field('newPassword','新密码（至少6位）','','password','required minlength="6" autocomplete="new-password"')}${field('confirmNewPassword','确认新密码','','password','required minlength="6" autocomplete="new-password"')}<p class="auth-error" id="passwordError" role="alert"></p>${btn('保存密码','type="submit"',true)}</form></div>`;
 const account=document.querySelector('.account-management');if(account)account.before(section);else $('content').append(section);
 $('usernameForm').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter,previous=profile,owner=accountStore.active;button.disabled=true;$('usernameError').textContent='';
  try{
   const username=$('newUsername').value.trim();if(!username)throw Error('请输入用户名');
   if(accountStore.list().some(a=>a.id!==owner&&a.profile.username.toLocaleLowerCase()===username.toLocaleLowerCase()))throw Error('此用户名已被其他账号使用');
   if(await passwordHash($('usernamePassword').value,previous.salt)!==previous.hash)throw Error('当前密码错误');
   if(profile!==previous||accountStore.active!==owner)throw Error('账号状态已变化，请重新操作');
   if(username===previous.username){toast('用户名未改变');return}
   const oldId='self:'+previous.username,newId='self:'+username,rename=a=>a.id===oldId?{...a,id:newId}:a;
   const papers=records.map(r=>({...r,authors:r.authors.map(rename)})),people=library.map(rename);
   if(writeAll(papers,people,{...previous,username})){
    localStorage.removeItem(REMEMBER_KEY);
    accountStore.native.setItem(LOGIN_HISTORY,JSON.stringify(loginHistory().map(n=>n===previous.username?username:n).filter((n,i,a)=>a.indexOf(n)===i)));
    render();toast('用户名已更新，下次请使用新用户名登录');
   }
  }catch(err){if($('usernameError'))$('usernameError').textContent=err.message}finally{button.disabled=false}
 };
 $('passwordForm').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter,previous=profile,owner=accountStore.active;button.disabled=true;$('passwordError').textContent='';
  try{
   const password=$('newPassword').value;if(password.length<6)throw Error('新密码至少6位');if(password!==$('confirmNewPassword').value)throw Error('两次新密码不一致');
   if(await passwordHash($('oldPassword').value,previous.salt)!==previous.hash)throw Error('当前密码错误');
   const salt=randomSalt(),hash=await passwordHash(password,salt);if(profile!==previous||accountStore.active!==owner)throw Error('账号状态已变化，请重新操作');
   if(writeAll(records,library,{...previous,salt,hash})){localStorage.removeItem(REMEMBER_KEY);render();toast('密码已更新')}
  }catch(err){if($('passwordError'))$('passwordError').textContent=err.message}finally{button.disabled=false}
 };
};
const v16Shell=renderShell;renderShell=function(){v16Shell();document.querySelector('.aside-bottom').innerHTML=document.querySelector('.aside-bottom').innerHTML.replace('15.0','16.0')};


'use strict';
// Social features have been retired. Stored historical data is left intact.
appendSocial=function(){};
const retiredSocialShell=renderShell;
renderShell=function(){retiredSocialShell();document.querySelectorAll('[data-page="circle"]').forEach(el=>el.remove())};
const retiredSocialRender=render;
render=function(){if(page==='circle')page='profile';return retiredSocialRender()};
renderCircle=function(){page='profile';render()};


// Public release version is separate from the compatible backup schema version.
const releaseShell = renderShell;
renderShell = function(){ releaseShell(); const footer=document.querySelector('.aside-bottom');if(footer)footer.innerHTML=footer.innerHTML.replace(/LOCAL EDITION [\d.]+/g,'VERSION 1.0'); };
render();if(!loadError&&rememberedAccount())enterWorkspace();else showLogin();