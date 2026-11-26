// ==UserScript==
// @name         Dear Editor · Elsevier Autofill
// @namespace    gaoji.local
// @version      4.0.0
// @description  Prefill manuscript number and corresponding author names. No submission or CAPTCHA automation.
// @match        https://webapps.elsevier.cn/st-wechat/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  if (window.__acceptMeHelper) return;
  window.__acceptMeHelper = true;
  const STORE = 'acceptme.pending-query.v3';
  let pending = null, observer = null, timer = null, completed = false;
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
      try { sessionStorage.setItem(STORE, JSON.stringify(pending)); } catch {}
      completed = false;
      return true;
    } catch { return false; }
  }
  if (!capture()) {
    try {
      const p = JSON.parse(sessionStorage.getItem(STORE));
      if (valid(p) && Date.now() - p.capturedAt < 120000) pending = p;
    } catch {}
  }
  function message(success) {
    document.getElementById('acceptme-notice')?.remove();
    const zh = !['en','ja'].includes(pending?.lang), ja = pending?.lang === 'ja';
    const note = document.createElement('div');
    note.id = 'acceptme-notice';
    note.setAttribute('role', 'status');
    note.textContent = success
      ? zh ? '投个好稿：编号与姓名已填入。请核对资料，自行确认条款、提交查询并完成验证码。'
        : ja ? 'まだ査読中：番号と氏名を入力しました。確認・規約同意・送信・認証は手動で行ってください。'
        : 'Dear Editor: Fields filled. Check the details and handle consent, submission and verification yourself.'
      : zh ? '投个好稿：未找到完整表单。请重开预填链接，或复制资料手动填写。'
        : ja ? 'まだ査読中：フォームが見つかりません。リンクを開き直すか手動入力してください。'
        : 'Dear Editor: Form not found. Reopen the prefill link or enter the details manually.';
    note.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:' + (success ? '#276956' : '#936528') + ';color:white;padding:14px 20px;border-radius:9px;font:14px/1.7 sans-serif;max-width:90vw;box-shadow:0 3px 20px #0002;cursor:pointer';
    note.title = 'Click to dismiss';
    note.onclick = () => note.remove();
    document.body.append(note);
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
    try { sessionStorage.removeItem(STORE); } catch {}
    if (location.hash.startsWith('#gaoji=')) history.replaceState(history.state, '', location.pathname + location.search);
    message(true);
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
      try { sessionStorage.removeItem(STORE); } catch {}
      if (document.body && !completed) message(false);
    }, 30000);
  }
  // Capture before the site's SPA router can replace the URL fragment.
  start();
  window.addEventListener('hashchange', () => { if (capture()) start(); });
  document.addEventListener('DOMContentLoaded', () => { if (!completed) start(); }, { once: true });
})();
