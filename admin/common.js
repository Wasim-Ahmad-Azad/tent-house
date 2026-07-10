/* Corporative Tent House — shared backend + helpers.
   Loaded by the admin pages (analytics, booking, inventory) BEFORE their own
   script. Requires the supabase-js CDN to be loaded first. Each page still
   declares its own `let DB`, page state, normalize(), and render logic. */

/* ---- Supabase (same project & row as the website) ---- */
const SUPABASE_URL = "https://npjarvohefrghtopqoms.supabase.co";
const SUPABASE_KEY = "sb_publishable_orNht7_tJzXje7yRzJiUOw_HhKgHvAp";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---- date + money + text helpers ---- */
function todayISO(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDaysISO(iso,n){ const d=new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function money(s){ const n=parseFloat(String(s).replace(/[^0-9.]/g,"")); return isNaN(n)?0:n; }
function inr(n){ return "₹"+Number(n||0).toLocaleString("en-IN"); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtDate(s){ if(!s) return "—"; return new Date(s+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); }
function fmtLong(s){ if(!s) return "—"; return new Date(s+"T00:00:00").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }

/* ---- per-date inventory helpers ---- */
function itemStock(i){ return (i.stock===""||i.stock==null)?null:(parseInt(i.stock)||0); }
function itemBooked(i,date){ if(!date||!i.bookedByDate) return 0; return parseInt(i.bookedByDate[date])||0; }
function itemRemaining(i,date){ const s=itemStock(i); return s==null?null:Math.max(0,s-itemBooked(i,date)); }

/* ---- bookings model helpers ----
   booking = {id, createdAt, status:"confirmed"|"cancelled", quoteNo,
              customer:{name,phone,address}, eventDate, items:[{id,name,price,unit,qty}],
              total, payments:[{id,amount,date,method,note}], notes} */
function bookingItemsTotal(b){ return (b.items||[]).reduce((s,c)=>s+money(c.price)*(c.qty||0),0); }
function bookingTotal(b){ const t=parseFloat(b.total); return (b.total===""||b.total==null||isNaN(t))?bookingItemsTotal(b):t; }
function bookingPaid(b){ return (b.payments||[]).reduce((s,p)=>s+(parseFloat(p.amount)||0),0); }
function bookingDue(b){ return Math.max(0,bookingTotal(b)-bookingPaid(b)); }
function payState(b){ const t=bookingTotal(b),p=bookingPaid(b); if(b.status==="cancelled")return"canc"; if(p<=0)return"unpaid"; if(p+0.001>=t)return"paid"; return"partial"; }
function createdISO(b){ return (b.createdAt||"").slice(0,10); }

/* ---- shared inventory sync (uses the page's global DB) ----
   sign +1 = reserve items on a date, -1 = free them. Skips untracked items. */
function applyInventory(items,date,sign){
  if(!date) return;
  (items||[]).forEach(c=>{
    const it=DB.items.find(x=>x.id===c.id); if(!it) return;
    if(it.stock===""||it.stock==null) return;
    if(!it.bookedByDate) it.bookedByDate={};
    const next=(parseInt(it.bookedByDate[date])||0)+sign*(c.qty||0);
    if(next>0) it.bookedByDate[date]=next; else delete it.bookedByDate[date];
  });
}
