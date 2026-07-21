/* Corporative Tent House — OFFLINE desktop backend.
   Drop-in replacement for the online common.js. Same function names, same
   camelCase model — but instead of talking to Supabase over the internet, it
   stores everything INSIDE this computer using the browser's IndexedDB.
   Nothing leaves the device. A fake `sb` object mimics the small slice of the
   Supabase API the pages use, so the page code runs unchanged. */

/* ================= local database (IndexedDB) ================= */
const IDB_NAME="tenthouse", IDB_VER=1;
let _idbP=null;
function idb(){
  if(_idbP) return _idbP;
  _idbP=new Promise((resolve,reject)=>{
    const req=indexedDB.open(IDB_NAME,IDB_VER);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("meta"))     db.createObjectStore("meta",{keyPath:"k"});
      if(!db.objectStoreNames.contains("bookings")) db.createObjectStore("bookings",{keyPath:"id"});
      if(!db.objectStoreNames.contains("expenses")) db.createObjectStore("expenses",{keyPath:"id"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return _idbP;
}
function _tx(store,mode){ return idb().then(db=>db.transaction(store,mode).objectStore(store)); }
function _wrap(req){ return new Promise((res,rej)=>{ req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
async function idbGet(store,key){ const s=await _tx(store,"readonly"); return _wrap(s.get(key)); }
async function idbAll(store){ const s=await _tx(store,"readonly"); return _wrap(s.getAll()); }
async function idbPut(store,val){ const s=await _tx(store,"readwrite"); return _wrap(s.put(val)); }
async function idbDel(store,key){ const s=await _tx(store,"readwrite"); return _wrap(s.delete(key)); }

/* ================= fake Supabase client (`sb`) ================= */
function _cmp(a,b,asc){ if(a==null)a=""; if(b==null)b=""; if(a<b)return asc?-1:1; if(a>b)return asc?1:-1; return 0; }
function _matches(row,filters){
  return filters.every(f=>{
    if(f.k==="eq")  return String(row[f.col])===String(f.val);
    if(f.k==="in")  return (f.vals||[]).map(String).includes(String(row[f.col]));
    return true;
  });
}
async function _availability(){
  const rows=await idbAll("bookings"); const map={};
  rows.forEach(b=>{
    if(b.status!=="confirmed"||!b.event_date) return;
    (b.items||[]).forEach(i=>{
      const id=String(i.id!=null?i.id:i.name), q=parseInt(i.qty)||0; if(!q) return;
      const key=id+"|"+b.event_date;
      map[key]=map[key]||{item_id:id,date:b.event_date,qty:0}; map[key].qty+=q;
    });
  });
  return Object.values(map);
}
class Q{
  constructor(table){ this.t=table; this.op="select"; this.cols="*"; this.filters=[]; this.ord=null; this.single=false; this.payload=null; }
  select(cols){ this.op="select"; this.cols=cols; return this; }
  eq(col,val){ this.filters.push({k:"eq",col,val}); return this; }
  in(col,vals){ this.filters.push({k:"in",col,vals}); return this; }
  order(col,opts){ this.ord={col,asc:!(opts&&opts.ascending===false)}; return this; }
  maybeSingle(){ this.single=true; return this._exec(); }
  insert(row){ this.op="insert"; this.payload=row; return this._exec(); }
  upsert(row){ this.op="upsert"; this.payload=row; return this._exec(); }
  update(row){ this.op="update"; this.payload=row; return this; }
  delete(){ this.op="delete"; return this; }
  then(res,rej){ return this._exec().then(res,rej); }
  async _exec(){
    try{ return await this._run(); }
    catch(e){ console.warn("local db:",e); return {data:null,error:{message:String(e&&e.message||e)}}; }
  }
  async _run(){
    const t=this.t;
    /* ----- site blob (single record in `meta`) ----- */
    if(t==="site"){
      if(this.op==="upsert"){ await idbPut("meta",{k:"site",data:this.payload.data}); return {data:null,error:null}; }
      const rec=await idbGet("meta","site");
      const data=rec? {data:rec.data} : null;
      return {data:this.single?data:(data?[data]:[]),error:null};
    }
    /* ----- availability (computed live from bookings) ----- */
    if(t==="availability"){
      let rows=await _availability();
      if(this.filters.length) rows=rows.filter(r=>_matches(r,this.filters));
      return {data:rows,error:null};
    }
    /* ----- bookings / expenses (own stores) ----- */
    if(t==="bookings"||t==="expenses"){
      if(this.op==="insert"||this.op==="upsert"){ await idbPut(t,this.payload); return {data:null,error:null}; }
      if(this.op==="update"){
        const id=(this.filters.find(f=>f.k==="eq"&&f.col==="id")||{}).val;
        const cur=id!=null?await idbGet(t,String(id)):null;
        const merged=Object.assign({},cur||{},this.payload); if(id!=null&&merged.id==null) merged.id=String(id);
        await idbPut(t,merged); return {data:null,error:null};
      }
      if(this.op==="delete"){
        const id=(this.filters.find(f=>f.k==="eq"&&f.col==="id")||{}).val;
        if(id!=null) await idbDel(t,String(id)); return {data:null,error:null};
      }
      // select
      let rows=await idbAll(t);
      if(this.filters.length) rows=rows.filter(r=>_matches(r,this.filters));
      if(this.ord) rows.sort((a,b)=>_cmp(a[this.ord.col],b[this.ord.col],this.ord.asc));
      if(this.single) return {data:rows[0]||null,error:null};
      return {data:rows,error:null};
    }
    return {data:this.single?null:[],error:null};
  }
}
/* On a private desktop there's no login — the machine itself is the lock.
   Auth calls always report "signed in" so every screen is fully editable. */
const _SESSION={user:{email:"desktop"}};
const sb={
  from(table){ return new Q(table); },
  auth:{
    async getSession(){ return {data:{session:_SESSION},error:null}; },
    async getUser(){ return {data:{user:_SESSION.user},error:null}; },
    async signInWithPassword(){ return {data:{session:_SESSION},error:null}; },
    async signOut(){ return {error:null}; },
    onAuthStateChange(cb){ setTimeout(()=>{ try{cb("SIGNED_IN",_SESSION);}catch(e){} },0); return {data:{subscription:{unsubscribe(){}}}}; }
  }
};

/* Hide the online login bits — irrelevant offline. */
(function(){
  const s=document.createElement("style");
  s.textContent="#authPill,#viewbar,#viewBanner,#loginModal{display:none!important}";
  (document.head||document.documentElement).appendChild(s);
})();

/* Register the service worker so the app installs & works with no internet. */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(e=>console.warn("sw:",e)); });
}

/* ================= shared helpers (identical to the online app) ================= */
function todayISO(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDaysISO(iso,n){ const d=new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function money(s){ const n=parseFloat(String(s).replace(/[^0-9.]/g,"")); return isNaN(n)?0:n; }
function inr(n){ return "₹"+Number(n||0).toLocaleString("en-IN"); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtDate(s){ if(!s) return "—"; return new Date(s+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); }
function fmtLong(s){ if(!s) return "—"; return new Date(s+"T00:00:00").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }

let AVAIL={};
async function loadAvailability(dates){
  dates=(dates||[]).filter(Boolean);
  let q=sb.from("availability").select("item_id,date,qty");
  if(dates.length) q=q.in("date",dates);
  const {data,error}=await q;
  if(error){ console.warn("availability:",error.message); return; }
  if(dates.length) dates.forEach(d=>AVAIL[d]={}); else AVAIL={};
  (data||[]).forEach(r=>{ (AVAIL[r.date]=AVAIL[r.date]||{})[String(r.item_id)]=parseInt(r.qty)||0; });
}
function itemStock(i){ return (i.stock===""||i.stock==null)?null:(parseInt(i.stock)||0); }
function itemBooked(i,date){ if(!date) return 0; const m=AVAIL[date]; return m?(parseInt(m[String(i.id)])||0):0; }
function itemRemaining(i,date){ const s=itemStock(i); return s==null?null:Math.max(0,s-itemBooked(i,date)); }

function bookingItemsTotal(b){ return (b.items||[]).reduce((s,c)=>s+money(c.price)*(c.qty||0),0); }
function bookingTotal(b){ const t=parseFloat(b.total); return (b.total===""||b.total==null||isNaN(t))?bookingItemsTotal(b):t; }
function bookingPaid(b){ return (b.payments||[]).reduce((s,p)=>s+(parseFloat(p.amount)||0),0); }
function bookingDue(b){ return Math.max(0,bookingTotal(b)-bookingPaid(b)); }
function payState(b){ const t=bookingTotal(b),p=bookingPaid(b); if(b.status==="cancelled")return"canc"; if(p<=0)return"unpaid"; if(p+0.001>=t)return"paid"; return"partial"; }
function createdISO(b){ return (b.createdAt||"").slice(0,10); }
function applyInventory(){}
function newId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

function bookingToRow(b){
  return {
    id:String(b.id), created_at:b.createdAt||new Date().toISOString(),
    status:b.status||"confirmed", quote_no:b.quoteNo||"",
    customer:b.customer||{}, event_date:b.eventDate||null,
    items:b.items||[], total:(b.total===""||b.total==null)?null:money(b.total),
    payments:b.payments||[], notes:b.notes||"", updated_at:new Date().toISOString()
  };
}
function rowToBooking(r){
  return {
    id:String(r.id), createdAt:r.created_at||"", status:r.status||"confirmed",
    quoteNo:r.quote_no||"", customer:r.customer||{}, eventDate:r.event_date||"",
    items:Array.isArray(r.items)?r.items:[], total:(r.total==null)?"":r.total,
    payments:Array.isArray(r.payments)?r.payments:[], notes:r.notes||""
  };
}
function rowToExpense(r){ return {id:String(r.id),date:r.date||"",category:r.category||"",amount:r.amount,note:r.note||""}; }

async function dbLoadBookings(){
  const {data,error}=await sb.from("bookings").select("*").order("event_date",{ascending:false});
  if(error){ console.warn("load bookings:",error.message); return null; }
  return (data||[]).map(rowToBooking);
}
async function dbLoadExpenses(){
  const {data,error}=await sb.from("expenses").select("*").order("date",{ascending:false});
  if(error){ console.warn("load expenses:",error.message); return null; }
  return (data||[]).map(rowToExpense);
}
async function dbInsertBooking(b){ const {error}=await sb.from("bookings").insert(bookingToRow(b)); return {ok:!error,error}; }
async function dbUpdateBooking(b){ const {error}=await sb.from("bookings").update(bookingToRow(b)).eq("id",String(b.id)); return {ok:!error,error}; }
async function dbInsertExpense(e){ const {error}=await sb.from("expenses").insert({id:String(e.id),date:e.date||null,category:e.category||"",amount:money(e.amount),note:e.note||""}); return {ok:!error,error}; }
async function dbUpdateExpense(e){ const {error}=await sb.from("expenses").update({date:e.date||null,category:e.category||"",amount:money(e.amount),note:e.note||""}).eq("id",String(e.id)); return {ok:!error,error}; }
async function dbDeleteExpense(id){ const {error}=await sb.from("expenses").delete().eq("id",String(id)); return {ok:!error,error}; }
