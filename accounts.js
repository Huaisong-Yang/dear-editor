'use strict';
// Each tab keeps a fixed namespace; the legacy account retains its original keys.
const accountStore=(()=>{
 const native=window.localStorage;
 let active=sessionStorage.getItem('de.account')||native.getItem('de.lastAccount')||'legacy';
 const key=k=>k.startsWith('gaoji.')&&k!=='gaoji.lang'&&active!=='legacy'?'de.user.'+active+'.'+k:k;
 const store={getItem:k=>native.getItem(key(k)),setItem:(k,v)=>native.setItem(key(k),v),removeItem:k=>native.removeItem(key(k))};
 Object.defineProperty(window,'localStorage',{configurable:true,value:store});
 return {native,get active(){return active},use(id){active=id;sessionStorage.setItem('de.account',id);native.setItem('de.lastAccount',id)},list(){
  const out=[];for(let i=0;i<native.length;i++){const k=native.key(i);if(k==='gaoji.profile.v2'||/^de\.user\.[^.]+\.gaoji\.profile\.v2$/.test(k)){const p=JSON.parse(native.getItem(k));if(p)out.push({id:k==='gaoji.profile.v2'?'legacy':k.split('.')[2],profile:p})}}return out;
 }};
})();
