'use strict';
// In local-service mode only: the existing application uses this per-page cache.
// The server, not browser website data, is the persistent store.
(()=>{
 const data=new Map();
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
  get length(){return data.size},key:i=>[...data.keys()][i]??null,
  getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
  removeItem:k=>data.delete(k),clear:()=>data.clear()
 }});
})();
