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

/* ---- per-date inventory helpers ----
   Booked quantities now come from the `availability` VIEW (derived live from the
   bookings table), cached in AVAIL. Pages call loadAvailability([dates]) before
   rendering. This is always accurate and safe with many people booking at once. */
let AVAIL = {}; // "YYYY-MM-DD" -> { "<itemId>": bookedQty }
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

/* Deprecated: availability is derived from the bookings table now. Kept as a
   no-op so any stray caller can't crash. */
function applyInventory(){}

/* ---- bookings + expenses: table-backed data layer ----
   Bookings and expenses each live in their own Supabase TABLE (one row each),
   so a save only touches that one record — no whole-document overwrite, no lost
   bookings when several people work at once. The app still uses the same
   camelCase objects everywhere; these helpers map to/from the DB rows. */
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
