// Prefill query fields and read visible results after manual verification.
(() => {
  'use strict';
  if (window.__acceptMeHelper) return;
  window.__acceptMeHelper = true;
  const STORE = 'acceptme.pending-query.v4', TTL = 20 * 60 * 1000;
  let pending = null, observer = null, timer = null, completed = false;
  let resultObserver, resultTimer, noticeKey = '';
  function valid(p) {
    return p && ['manuscriptNumber', 'lastName', 'firstName'].every(k =>
      typeof p[k] === 'string' && p[k].trim() && p[k].length <= 200);
  }
  function capture() {
    if (!location.hash.startsWith('#gaoji=')) return false;
    try {
      const p = JSON.parse(decodeURIComponent(location.hash.slice(7)));
      if (!valid(p)) return false;
      pending = { ...p, capturedAt: Date.now() };
      noticeKey = '';
      try { sessionStorage.setItem(STORE, JSON.stringify(pending)); } catch {}
      completed = false;
      return true;
    } catch { return false; }
  }
  if (!capture()) {
    try {
      const p = JSON.parse(sessionStorage.getItem(STORE));
      if (valid(p) && Date.now() - p.capturedAt < TTL) {
        pending = p;
        completed = p.filled === true;
      }
    } catch {}
  }
  function notice(text, success) {
    document.getElementById('acceptme-notice')?.remove();
    const note = document.createElement('div');
    note.id = 'acceptme-notice';
    note.setAttribute('role', 'status');
    note.textContent = text;
    note.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:' + (success ? '#276956' : '#936528') + ';color:white;padding:14px 20px;border-radius:9px;font:14px/1.7 sans-serif;max-width:90vw;box-shadow:0 3px 20px #0002;cursor:pointer';
    note.title = 'Click to dismiss';
    note.onclick = () => note.remove();
    document.body.append(note);
    return note;
  }
  const words = (zh,en,ja) => pending?.lang === 'en' ? en : pending?.lang === 'ja' ? ja : zh;
  function message(success) {
    notice(success
      ? words('投个好稿：编号与姓名已填入。请核对资料，自行确认条款、提交查询并完成验证码。',
        'Dear Editor: Fields filled. Check the details and handle consent, submission and verification yourself.',
        'まだ査読中：番号と氏名を入力しました。確認・規約同意・送信・認証は手動で行ってください。')
      : words('投个好稿：未找到完整表单。可手动查询。',
        'Dear Editor: Form not found. You can still query manually.',
        'まだ査読中：フォームが見つかりません。手動で照会できます。'), success);
  }
  const norm = s => typeof s === 'string' ? s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
  const manuscript = s => norm(s).replace(/r\d+$/, '');
  const edition = s => norm(s).match(/r\d+$/)?.[0];
  const STATES = new Map([
    ['under review','ur'],['同行评审中','ur'],['同行评审进行中','ur'],['审稿中','ur'],
    ['with editor','we'],['编辑处理中','we'],['编辑审稿','we'],['編輯審稿','we'],['編輯處理中','we'],
    ['required reviews complete','rrc'],['required reviews completed','rrc'],['required reiews complete','rrc'],
    ['所需评审已完成','rrc'],['所需評審已完成','rrc'],
    ['complete','complete'],['completed','complete'],['已完成','complete'],
    ['major revision','major'],['minor revision','minor'],['大修','major'],['小修','minor'],
    ['revision required','revision'],['revise','revision'],['待返修','revision'],
    ['accepted','accept'],['已录用','accept'],['rejected','reject'],['已拒稿','reject'],['withdrawn','withdraw'],['已撤稿','withdraw'],
  ]);
  const labels = {
    number: /^(manuscript number|稿件编号|稿件号)\s*[:：]?\s*/i,
    status: /^(当前进度|當前進度|稿件状态|稿件狀態|current status|current progress|manuscript status)\s*[:：]?\s*/i,
    completed: /^(评审完成|評審完成|reviews completed|completed reviews)\s*[:：]?\s*/i,
    agreed: /^(接受评审邀请|接受評審邀請|review invitations accepted|invitations accepted|agreed to review)\s*[:：]?\s*/i,
    invited: /^(发出评审邀请|發出評審邀請|review invitations sent|invitations sent|reviewers invited)\s*\*?\s*[:：]?\s*/i,
  };
  function exactCount(text) {
    if (!/^\d+$/.test(text)) return undefined;
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  function readResult(p) {
    const headingSelector = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
    const nodes = [...document.body.querySelectorAll('main,section,article,dl,dt,dd,li,div,span,p,label,b,strong,td,th,'+headingSelector)].filter(el =>
      !el.closest('#acceptme-notice,[hidden],[aria-hidden="true"]') && el.getClientRects().length && getComputedStyle(el).visibility === 'visible');
    function labelled(pattern, parse) {
      const values = new Set();
      for (const el of nodes) {
        const text = norm(el.innerText ?? el.textContent);
        if (text.length > 120 || !pattern.test(text)) continue;
        const tail = text.replace(pattern, '');
        let value = tail;
        if (!value) {
          const sibling = el.nextElementSibling;
          if (sibling?.getClientRects().length && getComputedStyle(sibling).visibility === 'visible') value = norm(sibling.innerText ?? sibling.textContent);
          else if (el.nextSibling?.nodeType === Node.TEXT_NODE) value = norm(el.nextSibling.textContent);
        }
        const parsed = parse(value);
        if (parsed !== undefined) values.add(parsed);
      }
      return values.size === 1 ? values.values().next().value : undefined;
    }
    const number = labelled(labels.number, value => /^[a-z0-9][a-z0-9-]{2,99}$/.test(value) ? value : undefined);
    let status = labelled(labels.status, value => STATES.get(value));
    if (number && status === undefined) {
      const headings = new Set(nodes.filter(el => el.matches(headingSelector)).map(el => STATES.get(norm(el.innerText ?? el.textContent)))
        .filter(s => ['we','rrc','complete'].includes(s)));
      if (headings.size === 1) status = headings.values().next().value;
    }
    if (!number) return status !== undefined ? { error:'identity' } : null;
    const expected = edition(p.number), actual = edition(number);
    if (manuscript(number) !== manuscript(p.number) || expected && actual && expected !== actual) return { error:'identity' };
    if (status === undefined) return { error:'read' };
    const fields = status === 'ur' ? Object.fromEntries(['completed','agreed','invited'].map(k => [k,labelled(labels[k],exactCount)])) : {};
    return { number, status, ...fields };
  }
  function returnAddress(p) {
    if (!p || typeof p.token !== 'string' || !/^[a-z0-9-]{8,100}$/i.test(p.token)
        || !norm(p.number) || p.number.length > 200 || !p.baseline) return null;
    try {
      const url = new URL(p.back);
      if (url.username || url.password || url.search || url.hash) return null;
      if (url.origin === 'https://huaisong-yang.github.io' && url.pathname === '/dear-editor/' ||
          url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.pathname === '/') return url;
    } catch {}
    return null;
  }
  function watchResult() {
    resultObserver?.disconnect();
    clearTimeout(resultTimer);
    const p = pending?.progress, back = returnAddress(p);
    if (!back || !document.body || Date.now() - pending.capturedAt >= TTL) return;
    function scan() {
      resultTimer = null;
      if (Date.now() - pending.capturedAt >= TTL) { resultObserver.disconnect(); return; }
      const result = readResult(p);
      if (!result) {
        if (noticeKey) { noticeKey = ''; document.getElementById('acceptme-notice')?.remove(); }
        return;
      }
      const key = JSON.stringify(result);
      if (noticeKey === key) return;
      noticeKey = key;
      const cannotRead = words('投个好稿：结果未能完整识别，请核对后手动更新。',
        'Dear Editor: The result could not be fully read. Check it and update manually.',
        '結果を完全には読み取れませんでした。確認して手動で更新してください。');
      if (result.error) {
        notice(result.error === 'identity'
          ? words('投个好稿：未能核对结果中的稿件号，不会回传。',
            'Dear Editor: The manuscript number could not be matched. Nothing was sent.',
            '原稿番号を確認できません。結果は送信されません。') : cannotRead, false);
        return;
      }
      const keys = result.status === 'ur' ? ['status','invited','agreed','completed'] : ['status'];
      const alreadyDecided = result.status === 'complete' && ['accept','reject','withdraw'].includes(p.baseline.status);
      if (alreadyDecided || !keys.some(k => result[k] !== undefined && p.baseline[k] !== result[k])) {
        const complete = keys.every(k => result[k] !== undefined);
        const unchanged = result.status === 'complete'
          ? words('查询页仍显示「已完成」，未提供具体决定。请以期刊决定信为准。',
            'The tracker shows Complete without a specific outcome. Check the journal’s decision letter.',
            '照会画面は「完了」です。詳細は雑誌の判定通知を確認してください。')
          : words('暂时没有新进展。再等等，愿好消息早日到来 🌱',
          'No new progress yet. Hang in there — here’s hoping for good news soon 🌱',
          'まだ進展はありません。もう少し待ちましょう。良い知らせが届きますように 🌱');
        notice(complete ? unchanged : cannotRead, complete);
        return;
      }
      const note = notice(words('投个好稿：有新进展。返回后可核对差异，确认前不会保存。',
        'Dear Editor: New progress found. Review the differences before saving.',
        '新しい進捗があります。差分を確認するまで保存しません。'), true);
      const link = document.createElement('a');
      back.hash = 'de-progress=' + encodeURIComponent(JSON.stringify({ token:p.token, result }));
      link.href = back.href;
      link.textContent = words('确认并返回 →','Review in Dear Editor →','確認して戻る →');
      link.style.cssText = 'color:white;text-decoration:underline;margin-inline-start:12px;font-weight:bold';
      link.onclick = e => {
        e.stopPropagation();
        const latest = readResult(p);
        if (JSON.stringify(latest) !== key || Date.now() - pending.capturedAt >= TTL) {
          e.preventDefault();noticeKey = '';scan();return;
        }
        try { sessionStorage.removeItem(STORE); } catch {}
      };
      note.append(link);
    }
    resultObserver = new MutationObserver(changes => {
      if (changes.some(c => !c.target.parentElement?.closest('#acceptme-notice') && !c.target.closest?.('#acceptme-notice')) && !resultTimer) {
        resultTimer = setTimeout(scan, 200);
      }
    });
    resultObserver.observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','hidden','aria-hidden','style'] });
    scan();
  }
  function stop() {
    observer?.disconnect();
    clearTimeout(timer);
  }
  function fill() {
    if (completed || !pending || !location.pathname.includes('/manuscript-query')) return false;
    const keys = ['manuscriptNumber', 'lastName', 'firstName'];
    const inputs = keys.map(k => document.getElementById(k));
    if (inputs.some(e => !e || e.tagName !== 'INPUT' || e.disabled)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (let i = 0; i < inputs.length; i++) {
      setter.call(inputs[i], pending[keys[i]]);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!inputs.every((el, i) => el.value === pending[keys[i]])) return false;
    completed = true;
    stop();
    pending.filled = true;
    try {
      if (returnAddress(pending.progress)) sessionStorage.setItem(STORE, JSON.stringify(pending));
      else sessionStorage.removeItem(STORE);
    } catch {}
    if (location.hash.startsWith('#gaoji=')) history.replaceState(history.state, '', location.pathname + location.search);
    message(true);
    watchResult();
    return true;
  }
  function start() {
    stop();
    if (!pending || completed) return;
    if (fill()) return;
    observer = new MutationObserver(fill);
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
    timer = setTimeout(() => {
      stop();
      if (!returnAddress(pending?.progress)) try { sessionStorage.removeItem(STORE); } catch {}
      if (document.body && !completed) message(false);
    }, 30000);
  }
  // Capture before the site's SPA router can replace the URL fragment.
  start();
  window.addEventListener('hashchange', () => { if (capture()) { start(); watchResult(); } });
  document.addEventListener('DOMContentLoaded', () => { if (!completed) start(); watchResult(); }, { once: true });
})();
