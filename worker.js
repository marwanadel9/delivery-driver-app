const SUPABASE_URL = "https://wnfibznjxihilgfedfij.supabase.co";

const DRIVER_EMAILS = {
  zain: "nasegypt9\u0040gmail.com",
  zain2: "moomaro990\u0040gmail.com"
};

const MASTER_USERNAME = "zezo";
const MASTER_EMAIL = "marwanadel333\u0040gmail.com";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Excel-Sync-Secret",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}

// تاريخ دبي هو المرجع الموحد لعرض فواتير الغد وقفلها حتى يوم التوصيل.
function dubaiDateKey(date) {
  const value = date instanceof Date ? date : new Date();
  return new Date(value.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function isFutureDeliveryDate(value, todayKey) {
  const dateKey = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey > todayKey;
}
function rejectFutureDelivery(order, todayKey) {
  return isFutureDeliveryDate(order && order.delivery_date, todayKey)
    ? json({ error: "الفاتورة مجدولة ليوم قادم ولا يمكن تنفيذ أي إجراء عليها قبل يوم التوصيل", code: "FUTURE_DELIVERY_LOCKED" }, 409)
    : null;
}

function checkSecrets(env) {
  if (!env.SUPABASE_ANON_KEY) {
    return "SUPABASE_ANON_KEY";
  }

  if (!env.EXCEL_SYNC_SECRET) {
    return "EXCEL_SYNC_SECRET";
  }

  return null;
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function makeSharedInvoiceKey(row) {
  // مفتاح مشترك مشتق من بيانات الفاتورة التي تتطابق بين نسختي المندوبين.
  const created = row && row.created_at ? new Date(row.created_at).getTime() : 0;
  const canonical = [
    String(row && row.order_number || "").trim().toUpperCase(),
    String(Number.isFinite(created) ? created : 0),
    String(row && row.customer_name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(),
    String(Number(row && row.total || 0).toFixed(2))
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
}

async function supabaseRequest(path, options) {
  const opts = options || {};

  return fetch(SUPABASE_URL + path, {
    method: opts.method || "GET",
    headers: opts.headers || {},
    body: opts.body
  });
}

// ---- Exact normalized Google Maps coordinates (v4) ----
const FARUJ_MAP_HOSTS = new Set(["maps.app.goo.gl","goo.gl","google.com","www.google.com","maps.google.com","maps.google.ae","www.google.ae"]);
function farujCanonicalCoord(n) { const v=Math.round(Number(n)*1e6)/1e6; return Object.is(v,-0)?0:v; }
function farujCoordKey(lat,lng) { return farujCanonicalCoord(lat).toFixed(6)+","+farujCanonicalCoord(lng).toFixed(6); }
function farujDmsToDecimal(deg,min,sec,hem) { let v=Math.abs(Number(deg))+Number(min)/60+Number(sec)/3600; if(/[SW]/i.test(hem))v=-v; return farujCanonicalCoord(v); }
function farujExtractCoords(text) {
 const s=String(text||""); let m;
 // IMPORTANT: Google Maps @lat,lng is often only the map viewport center,
 // not the selected place/pin. Prefer explicit place coordinates (!3d!4d),
 // then explicit query coordinates, and use @ only as a last resort.
 m=s.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
 if(!m)m=s.match(/[?&](?:q|query|destination|ll|center)=(-?\d{1,2}(?:\.\d+)?)(?:%2C|,|%252C)(-?\d{1,3}(?:\.\d+)?)/i);
 if(!m)m=s.match(/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
 if(m){const lat=farujCanonicalCoord(m[1]),lng=farujCanonicalCoord(m[2]);if(Math.abs(lat)<=90&&Math.abs(lng)<=180)return {lat,lng};}
 // DMS text: 24°39'46.3"N 54°45'49.3"E (also accepts prime glyphs).
 const dms=/(-?\d{1,2})\s*°\s*(\d{1,2})\s*[′'’]\s*(\d{1,2}(?:\.\d+)?)\s*[″"”]?\s*([NS])[^\d-]{0,20}(-?\d{1,3})\s*°\s*(\d{1,2})\s*[′'’]\s*(\d{1,2}(?:\.\d+)?)\s*[″"”]?\s*([EW])/i;
 m=s.match(dms);
 if(m){const lat=farujDmsToDecimal(m[1],m[2],m[3],m[4]),lng=farujDmsToDecimal(m[5],m[6],m[7],m[8]);if(Math.abs(lat)<=90&&Math.abs(lng)<=180)return {lat,lng};}
 return null;
}
async function farujResolveGoogleMap(raw) {
 let u; try { u = new URL(String(raw || "")); } catch (_) { throw new Error("رابط خرائط غير صالح"); }
 if (u.protocol !== "https:" || !FARUJ_MAP_HOSTS.has(u.hostname.toLowerCase())) throw new Error("يسمح فقط بروابط Google Maps الموثوقة عبر HTTPS");
 let current = u.toString();
 for (let hop = 0; hop <= 6; hop++) {
  const parsed = new URL(current);
  if (parsed.protocol !== "https:" || !FARUJ_MAP_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("تم إيقاف تحويل الرابط إلى نطاق غير موثوق");
  let coords = farujExtractCoords(current);
  if (coords) return { ...coords, key: farujCoordKey(coords.lat, coords.lng), resolved_url: current };
  if (hop === 6) break;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let resp;
  try {
   resp = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0" } });
  } catch (e) {
   const err = new Error(e && e.name === "AbortError" ? "انتهت مهلة فك رابط الخريطة" : "تعذر فك رابط الخريطة");
   err.code = e && e.name === "AbortError" ? "MAP_TIMEOUT" : "MAP_FETCH_FAILED";
   throw err;
  } finally { clearTimeout(timer); }
  if (resp.status === 429) {
   const rawRetry = String(resp.headers.get("Retry-After") || "").trim();
   let retryAfterSec = Number(rawRetry);
   if (!Number.isFinite(retryAfterSec) || retryAfterSec <= 0) {
    const retryDate = Date.parse(rawRetry);
    retryAfterSec = Number.isFinite(retryDate) ? Math.max(1, Math.ceil((retryDate - Date.now()) / 1000)) : 60;
   }
   retryAfterSec = Math.max(5, Math.min(900, Math.ceil(retryAfterSec)));
   const err = new Error("Google Maps (HTTP 429): تم تحديد معدل الطلبات؛ انتظر " + retryAfterSec + " ثانية ثم أعد محاولة الحالات المؤقتة فقط");
   err.code = "MAP_RATE_LIMITED";
   err.retryAfterSec = retryAfterSec;
   throw err;
  }
  if (!resp.ok && ![301, 302, 303, 307, 308].includes(resp.status)) {
   const err = new Error("Google Maps (HTTP " + resp.status + ")");
   err.code = "MAP_HTTP_ERROR";
   throw err;
  }
  const loc = resp.headers.get("location");
  if (!loc) {
   const body = await resp.text().catch(() => "");
   coords = farujExtractCoords(body);
   if (coords) return { ...coords, key: farujCoordKey(coords.lat, coords.lng), resolved_url: current };
   break;
  }
  current = new URL(loc, current).toString();
 }
 throw new Error("تعذر استخراج إحداثيات مؤكدة من الرابط؛ لم يتم حفظ الموقع");
}

async function farujServiceHeaders(env){
 const key=String(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
 if(!key)throw new Error("مفتاح Supabase الخدمي غير مضبوط في Worker");
 const h={apikey:key,"Content-Type":"application/json"};if(!key.startsWith("sb_secret_"))h.Authorization="Bearer "+key;return h;
}
async function farujRpc(env,name,args){const h=await farujServiceHeaders(env);const r=await supabaseRequest("/rest/v1/rpc/"+name,{method:"POST",headers:h,body:JSON.stringify(args)});const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d&&(d.message||d.details||d.hint)||("Supabase RPC failed: "+r.status));return d;}
// Read large JSONB payloads in small pieces to avoid PostgREST response-size limits.
async function farujReadSharedStateChunked(env){
 const headers=await farujServiceHeaders(env);
 const chunkSize=500000;
 let offset=0,totalChars=null,updatedAt=null,sourceDevice=null,fullText="";
 for(let page=0;page<100;page++){
  const response=await supabaseRequest("/rest/v1/rpc/faruj_desktop_shared_state_read_chunk",{
   method:"POST",headers,
   body:JSON.stringify({p_offset:offset,p_limit:chunkSize})
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result||typeof result!=="object"){
   const detail=result&&(result.message||result.details||result.hint||result.error);
   throw new Error("تعذر قراءة جزء من التخزين المشترك (HTTP "+response.status+")"+(detail?": "+String(detail).slice(0,220):""));
  }
  if(!result.exists) return null;
  if(totalChars===null){totalChars=Number(result.total_chars);updatedAt=result.updated_at;sourceDevice=result.source_device||null;}
  else if(result.updated_at!==updatedAt||Number(result.total_chars)!==totalChars){
   throw new Error("تغيرت النسخة المشتركة أثناء قراءتها؛ أعد المحاولة بعد ثوانٍ");
  }
  const piece=String(result.chunk_text||"");
  if(!piece&&offset<totalChars)throw new Error("تعذر إكمال قراءة النسخة المشتركة عند الموضع "+offset);
  fullText+=piece;
  // PostgreSQL substring/char_length count Unicode code points, while
  // JavaScript String.length counts UTF-16 code units (emoji may count as 2).
  // Keep offsets and completeness checks in the same character unit as PostgreSQL.
  offset+=Array.from(piece).length;
  if(offset>=totalChars)break;
 }
 if(totalChars===null) return null;
 if(Array.from(fullText).length!==totalChars)throw new Error("قراءة النسخة المشتركة غير مكتملة؛ لم يتم تطبيق أي بيانات");
 let payload;
 try{payload=JSON.parse(fullText);}catch(_){throw new Error("تعذر تحليل النسخة المشتركة بعد تجميع أجزائها");}
 if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("سجل التخزين المشترك لا يحتوي على payload صالح");
 return {payload,updated_at:updatedAt,source_device:sourceDevice};
}
async function farujSharedPayload(env){
 const row=await farujReadSharedStateChunked(env);
 if(!row)throw new Error("تعذر قراءة التخزين المشترك: السجل غير موجود");
 return row.payload;
}
async function farujReadSharedStateVersion(env){
 const row=await farujReadSharedStateChunked(env);
 if(!row)throw new Error("تعذر قراءة النسخة المشتركة لإجراء العميل: السجل غير موجود");
 return row;
}
function farujStableJson(value){
 if(value===null)return 'null';
 if(Array.isArray(value))return '['+value.map(farujStableJson).join(',')+']';
 if(typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+farujStableJson(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
async function farujFingerprint(value){
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function farujMigrationState(env){const h=await farujServiceHeaders(env);const r=await supabaseRequest("/rest/v1/faruj_customer_location_migration_v4?id=eq.1&select=*",{headers:h});const d=await r.json().catch(()=>null);if(!r.ok||!Array.isArray(d)||!d.length)throw new Error("جدول تهيئة مواقع العملاء غير جاهز؛ شغّل ملف SQL v4 أولًا");return d[0];}
// Fetch only a tiny server-side page from the customer array. The full shared
// payload never crosses into the Worker during migration start/batch/retry.
async function farujMigrationPage(env, offset, limit){
 const d=await farujRpc(env,"faruj_customer_location_migration_page_v1",{
  p_offset:Math.max(0,Number(offset)||0),p_limit:Math.max(0,Math.min(1,Number(limit)||0))
 });
 if(!d||typeof d!=="object"||!Array.isArray(d.customers)||!d.snapshot_token)
  throw new Error("تعذر قراءة صفحة العملاء الصغيرة للتهيئة؛ تأكد من تثبيت دالة v47 في Supabase");
 return {customers:d.customers,total_customers:Number(d.total_customers)||0,snapshot_token:String(d.snapshot_token)};
}
async function farujMigrationCustomer(env, customerCode){
 const d=await farujRpc(env,"faruj_customer_location_migration_customer_v1",{p_customer_code:String(customerCode||"").trim()});
 if(!d||typeof d!=="object"||!d.snapshot_token)
  throw new Error("تعذر قراءة العميل المطلوب لإعادة المحاولة؛ تأكد من تثبيت دالة v47 في Supabase");
 return {customer:d.customer&&typeof d.customer==="object"?d.customer:null,snapshot_token:String(d.snapshot_token)};
}
async function farujRegisteredLocationCodes(env, customerCodes){
 // Read only the current batch's customer codes. Fetching the entire registry on
 // every batch needlessly grows memory and response size as the registry expands.
 const codes=Array.from(new Set((Array.isArray(customerCodes)?customerCodes:[])
   .map(x=>String(x||"").trim()).filter(Boolean)));
 const out=new Map();
 if(!codes.length)return out;
 const h=await farujServiceHeaders(env);
 for(const code of codes){
  const r=await supabaseRequest("/rest/v1/faruj_customer_location_registry_v4?customer_code=eq."+encodeURIComponent(code)+"&select=customer_code,original_url&limit=1",{headers:h});
  const d=await r.json().catch(()=>null);
  if(!r.ok||!Array.isArray(d))throw new Error("تعذر قراءة سجل الموقع للعميل "+code+"؛ أوقفنا الاستكمال دون تغيير الروابط");
  if(d.length)out.set(String(d[0].customer_code||"").trim(),String(d[0].original_url||"").trim());
 }
 return out;
}
async function farujWriteMigration(env,patch,expectedOffset){const h=await farujServiceHeaders(env);const q="/rest/v1/faruj_customer_location_migration_v4?id=eq.1"+(expectedOffset===undefined?"":"&next_offset=eq."+encodeURIComponent(expectedOffset));const r=await supabaseRequest(q,{method:"PATCH",headers:Object.assign({},h,{Prefer:"return=representation"}),body:JSON.stringify(Object.assign({},patch,{updated_at:new Date().toISOString()}))});const d=await r.json().catch(()=>null);if(!r.ok||!Array.isArray(d)||!d.length)throw new Error("تغير مؤشر التهيئة من طلب آخر؛ أعد قراءة الحالة قبل المتابعة");return d[0];}
async function farujWriteMigrationCAS(env,patch,expectedUpdatedAt){
 const h=await farujServiceHeaders(env);
 const q="/rest/v1/faruj_customer_location_migration_v4?id=eq.1&updated_at=eq."+encodeURIComponent(String(expectedUpdatedAt||""));
 const r=await supabaseRequest(q,{method:"PATCH",headers:Object.assign({},h,{Prefer:"return=representation"}),body:JSON.stringify(Object.assign({},patch,{updated_at:new Date().toISOString()}))});
 const d=await r.json().catch(()=>null);
 if(!r.ok||!Array.isArray(d)||!d.length)throw new Error("تغير سجل المراجعة من طلب آخر؛ لم نعتمد نتيجة متعارضة. أعد قراءة الحالة.");
 return d[0];
}

// إلغاء طلبات التسليم القديمة عند إرجاع الفاتورة إلى قيد التوصيل.
async function cancelPendingDeliveryRequests(env, orderIds, source) {
 const ids=Array.from(new Set((Array.isArray(orderIds)?orderIds:[]).map(Number).filter(id=>Number.isInteger(id)&&id>0)));
 if(!ids.length)return {success:true,cancelled:0};
 const svc=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
 if(!svc)return {success:false,error:"SUPABASE_SERVICE_ROLE_KEY غير مضبوط"};
 const H={apikey:svc,Authorization:"Bearer "+svc,"Content-Type":"application/json",Prefer:"return=representation"};
 let cancelled=0;
 for(const status of ["pending","requested","waiting"]){
  const r=await supabaseRequest("/rest/v1/driver_delivery_requests?order_id=in.("+ids.join(",")+")&status=eq."+encodeURIComponent(status),{method:"PATCH",headers:H,body:JSON.stringify({status:"cancelled",processed_at:new Date().toISOString()})});
  const rows=await r.json().catch(()=>null);
  if(!r.ok)return {success:false,cancelled,error:(rows&&(rows.message||rows.hint||rows.error))||"تعذر إلغاء طلب تسليم قديم"};
  if(Array.isArray(rows))cancelled+=rows.length;
 }
 return {success:true,cancelled,source:String(source||"office_status_change")};
}
// إشعار لحظي بعد نجاح تعديل الفاتورة فقط، دون إرسال بيانات العميل أو الفاتورة.
// نفس القناة التي يستمع لها تطبيق الماستر وتطبيقات المناديب: fa-orders-live.
async function broadcastOrdersChanged(env, source) {
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return false;
  try {
    const response = await supabaseRequest("/realtime/v1/api/broadcast", {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [{
          topic: "fa-orders-live",
          event: "orders-changed",
          payload: {
            source: String(source || "system"),
            emitted_at: new Date().toISOString()
          }
        }]
      })
    });
    if (!response.ok) {
      try { console.error("Realtime broadcast failed:", response.status, await response.text()); } catch (_) {}
      return false;
    }
    return true;
  } catch (error) {
    try { console.error("Realtime broadcast exception:", error && error.message || error); } catch (_) {}
    return false;
  }
}

async function getUser(token, anonKey) {
  if (!token || !anonKey) {
    return null;
  }

  const response = await supabaseRequest("/auth/v1/user", {
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + token
    }
  });

  if (!response.ok) {
    return null;
  }

  return await response.json().catch(function () {
    return null;
  });
}

async function getDriverInfo(token, anonKey, userId) {
  if (!token || !anonKey || !userId) {
    return null;
  }

  const path =
    "/rest/v1/mandoub_users?user_id=eq." +
    encodeURIComponent(userId) +
    "&select=mandoub_name,sheet_name";

  const response = await supabaseRequest(path, {
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + token
    }
  });

  if (!response.ok) {
    return null;
  }

  const rows = await response.json().catch(function () {
    return [];
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return {
    mandoub_name: rows[0].mandoub_name || "",
    sheet_name: rows[0].sheet_name || ""
  };
}

async function requireDriver(request, env) {
  const token = getBearerToken(request);

  if (!token) {
    return {
      error: "غير مصرح",
      status: 401
    };
  }

  const user = await getUser(
    token,
    env.SUPABASE_ANON_KEY
  );

  if (!user || !user.id) {
    return {
      error: "انتهت الجلسة",
      status: 401
    };
  }

  const driver = await getDriverInfo(
    token,
    env.SUPABASE_ANON_KEY,
    user.id
  );

  if (!driver) {
    return {
      error: "المندوب غير مسجل",
      status: 403
    };
  }

  return {
    token: token,
    user: user,
    driver: driver
  };
}

async function requireMaster(request, env) {
  const token = getBearerToken(request);

  if (!token) {
    return {
      error: "غير مصرح",
      status: 401
    };
  }

  const user = await getUser(
    token,
    env.SUPABASE_ANON_KEY
  );

  if (!user || !user.id) {
    return {
      error: "انتهت الجلسة",
      status: 401
    };
  }

  const path =
    "/rest/v1/master_admins?user_id=eq." +
    encodeURIComponent(user.id) +
    "&select=id,user_id,email";

  const response = await supabaseRequest(path, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: "Bearer " + token
    }
  });

  if (!response.ok) {
    return {
      error: "تعذر التحقق من صلاحيات الماستر",
      status: 500
    };
  }

  const rows = await response.json().catch(function () {
    return [];
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      error: "غير مصرح",
      status: 403
    };
  }

  return {
    token: token,
    user: user,
    master: rows[0]
  };
}


// مطابقة هوية الفاتورة بين الكمبيوتر ونسخ المندوبين والماستر.
// رقم الفاتورة وحده لا يكفي دائمًا؛ نستخدم تاريخ التوصيل والهاتف والعميل.
function invoiceDigits(value) {
  return String(value == null ? "" : value).replace(/[^0-9]/g, "");
}
function invoiceNorm(value) {
  return String(value == null ? "" : value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function matchInvoiceRows(rows, identity) {
  const orderNumber = String(identity.order_number || "").trim();
  let candidates = (Array.isArray(rows) ? rows : []).filter(function (row) {
    return String(row.order_number || "").trim() === orderNumber;
  });
  if (!candidates.length) return { rows: [], ambiguous: false };

  const phone = invoiceDigits(identity.phone);
  const customer = invoiceNorm(identity.customer_name);
  const sheet = String(identity.sheet_name || "").trim();
  const date = String(identity.delivery_date || "").slice(0, 10);
  const allSheets = !sheet || sheet.toUpperCase() === "ALL";

  // نحدد المندوب أولًا في عمليات التعديل؛ حتى لا نغيّر sheet_name
  // لنسخ مندوب آخر لمجرد أن رقم الفاتورة وتاريخها متطابقان.
  if (!allSheets) {
    candidates = candidates.filter(function (row) {
      return String(row.sheet_name || "").trim() === sheet;
    });
    if (!candidates.length) return { rows: [], ambiguous: false };
  }

  // التاريخ المعروف المختلف لا يُطابق الفاتورة. نسمح بتاريخ NULL فقط
  // لنسخة واحدة لدى المندوب المحدد، ولا نوسّع الحذف الشامل إلى سجلات مجهولة التاريخ.
  if (date) {
    const exactDate = candidates.filter(function (row) {
      return String(row.delivery_date || "").slice(0, 10) === date;
    });
    if (exactDate.length) {
      candidates = exactDate;
    } else {
      const unknownDate = candidates.filter(function (row) {
        return !String(row.delivery_date || "").trim();
      });
      if (!allSheets && unknownDate.length === 1) candidates = unknownDate;
      else return { rows: [], ambiguous: unknownDate.length > 1 };
    }
  }

  // نستخدم اسم العميل كحاجز حماية عند إعادة استخدام أرقام الفواتير اليومية.
  let nameMatched = candidates;
  if (customer) {
    nameMatched = candidates.filter(function (row) {
      const saved = invoiceNorm(row.customer_name);
      return !saved || saved === customer;
    });
    if (!nameMatched.length) return { rows: [], ambiguous: false };
  }

  if (phone) {
    const phoneMatched = nameMatched.filter(function (row) {
      const saved = invoiceDigits(row.phone);
      return !saved || saved === phone;
    });
    if (phoneMatched.length) {
      candidates = phoneMatched;
    } else if (customer && date) {
      // إذا كان هاتف نسخة قديمة مختلفًا، نقبل مطابقة الاسم فقط بعد تضييق
      // النطاق بالتاريخ وبالمندوب المحدد أو ALL؛ ولا نتجاوز اختلاف تاريخ معروف.
      candidates = nameMatched;
    } else {
      return { rows: [], ambiguous: false };
    }
  } else {
    candidates = nameMatched;
  }

  if (!allSheets && candidates.length > 1) return { rows: [], ambiguous: true };
  if (allSheets && !date && candidates.length > 1) return { rows: [], ambiguous: true };

  // ALL + تاريخ + هوية العميل يعيد كل النسخ المتطابقة عبر المناديب.
  return { rows: candidates, ambiguous: false };
}

function invoiceIdFilter(rows) {
  const ids = (Array.isArray(rows) ? rows : [])
    .map(function (row) { return Number(row.id); })
    .filter(function (id) { return Number.isInteger(id) && id > 0; });
  return ids.length ? "id=in.(" + ids.join(",") + ")" : "";
}

// إزالة الإيموجي من نصوص الأصناف قبل إرسالها للمندوب
function stripEmojiText(value) {
  return String(value == null ? "" : value)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizePayment(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();

  if (
    v === "cash" ||
    v === "كاش" ||
    v === "نقدي" ||
    v === "دفع كاش"
  ) {
    return "cash";
  }

  if (
    v === "bank_transfer" ||
    v === "bank transfer" ||
    v === "bank" ||
    v === "transfer" ||
    v === "تحويل بنكي" ||
    v === "تحويل"
  ) {
    return "bank_transfer";
  }

  return null;
}

function paymentLabel(value) {
  if (value === "cash") {
    return "دفع كاش";
  }

  if (value === "bank_transfer") {
    return "تحويل بنكي";
  }

  return "";
}


async function clearGatePhotosForInvoice(invoiceNumber, env) {
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) {
    throw new Error("إعداد حذف الصور غير مكتمل: SUPABASE_SERVICE_ROLE_KEY");
  }

  const headers = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey
  };
  const encodedInvoice = encodeURIComponent(invoiceNumber);
  const rowsResponse = await supabaseRequest(
    "/rest/v1/orders?order_number=eq." + encodedInvoice +
      "&select=id,order_number,gate_photo_url,gate_photo_urls",
    { headers: headers }
  );
  const rows = await rowsResponse.json().catch(function () { return null; });
  if (!rowsResponse.ok || !Array.isArray(rows)) {
    throw new Error((rows && (rows.message || rows.hint || rows.error)) || "تعذر قراءة صور الفاتورة");
  }

  const bucketName = "gate-photos 3";
  const bucketMarker = "/storage/v1/object/public/" + encodeURIComponent(bucketName) + "/";
  const paths = [];
  const addPath = function (value) {
    const photoUrl = String(value || "").trim();
    const at = photoUrl.indexOf(bucketMarker);
    if (at < 0) return;
    const rawPath = photoUrl.slice(at + bucketMarker.length).split("?")[0];
    let decoded;
    try {
      decoded = rawPath.split("/").map(function (part) { return decodeURIComponent(part); }).join("/");
    } catch (_) { return; }
    if (decoded.startsWith("invoices/") && !decoded.includes("..") && !paths.includes(decoded)) {
      paths.push(decoded);
    }
  };

  for (const row of rows) {
    addPath(row.gate_photo_url);
    let photos = row.gate_photo_urls;
    if (typeof photos === "string") {
      try { photos = JSON.parse(photos); } catch (_) { photos = []; }
    }
    if (Array.isArray(photos)) {
      for (const photo of photos) {
        addPath(typeof photo === "string" ? photo : (photo && (photo.url || photo.gate_photo_url)) || "");
      }
    }
  }

  if (paths.length) {
    const storageResponse = await supabaseRequest(
      "/storage/v1/object/" + encodeURIComponent(bucketName),
      {
        method: "DELETE",
        headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes: paths })
      }
    );
    const storageData = await storageResponse.json().catch(function () { return null; });
    if (!storageResponse.ok) {
      throw new Error((storageData && (storageData.message || storageData.error)) || "تعذر حذف الصور من التخزين السحابي");
    }
  }

  const clearBody = JSON.stringify({ gate_photo_url: null, gate_photo_urls: [] });
  const ordersPatch = await supabaseRequest(
    "/rest/v1/orders?order_number=eq." + encodedInvoice,
    { method: "PATCH", headers: Object.assign({}, headers, { "Content-Type": "application/json", Prefer: "return=minimal" }), body: clearBody }
  );
  if (!ordersPatch.ok) throw new Error("تم حذف الصور من التخزين لكن تعذر مسح روابط الطلبات");

  const archivePatch = await supabaseRequest(
    "/rest/v1/master_orders_archive?order_number=eq." + encodedInvoice,
    { method: "PATCH", headers: Object.assign({}, headers, { "Content-Type": "application/json", Prefer: "return=minimal" }), body: clearBody }
  );
  if (!archivePatch.ok && archivePatch.status !== 404) {
    throw new Error("تم تحديث الطلبات لكن تعذر مسح روابط صور أرشيف الماستر");
  }
  return paths.length;
}


// After an existing customer's map is successfully changed (or the customer is deleted),
// remove only that customer's obsolete migration issue. Keep every other issue and cursor.
async function farujClearCustomerMigrationIssue(env, customerCode) {
  const code = String(customerCode || "").trim();
  if (!code) return false;
  try {
    const state = await farujMigrationState(env);
    const issues = Array.isArray(state.issues) ? state.issues : [];
    const kept = issues.filter(x => String(x && x.customer_code || "").trim() !== code);
    if (kept.length === issues.length) return true;
    const nextStatus = state.status === "running" ? "running" : (kept.length ? "needs_review" : "complete");
    await farujWriteMigrationCAS(env, { issues: kept, status: nextStatus }, state.updated_at);
    return true;
  } catch (e) {
    try { console.error("Customer saved but migration issue cleanup was deferred:", code, e && e.message || e); } catch (_) {}
    return false;
  }
}

export default {
  async fetch(request, env) {
    const missingSecret = checkSecrets(env);

    if (missingSecret) {
      return json(
        {
          error: "Server configuration error"
        },
        500
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Excel-Sync-Secret",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // السماح لمسارات الماستر بالوصول إلى معالجات التعديل وتأكيد التحويل
    // أدناه، مع بقاء التحقق من جلسة وصلاحيات حساب الماستر داخل كل مسار.

    try {
      // Customer location protection v4.10: exact canonical coordinate equality only.
      if (path.startsWith("/api/customer-location/")) {
        try {
        const supplied=request.headers.get("X-Excel-Sync-Secret")||"";
        if(!env.EXCEL_SYNC_SECRET||supplied!==env.EXCEL_SYNC_SECRET)return json({ok:false,error:"غير مصرح"},401);
        if(path==="/api/customer-location/check"&&request.method==="POST"){
          const body=await request.json().catch(()=>null);if(!body)return json({ok:false,error:"بيانات الطلب غير صالحة"},400);
          const code=String(body.customer_code||"").trim();if(!code)return json({ok:false,error:"كود العميل مطلوب"},400);
          const migration=await farujMigrationState(env);
          const legacyIssues=Array.isArray(migration.issues)?migration.issues:[];
          const existingEdit=body.allow_existing_customer_edit===true;
          if(migration.status==="running")return json({ok:false,error:"هناك دفعة تهيئة تعمل الآن. انتظر انتهاء الدفعة قبل تغيير رابط الموقع حتى لا تتداخل عمليتا الفحص والحجز.",code:"MIGRATION_RUNNING"},409);
          if(migration.status!=="complete"&&!existingEdit)return json({ok:false,error:"إضافة رابط موقع لعميل جديد تتطلب اكتمال تهيئة المواقع القديمة أولًا. يمكن تعديل رابط عميل موجود من نافذة التعديل.",code:"MIGRATION_REQUIRED"},409);
          if(existingEdit){
            const payload=await farujSharedPayload(env);
            const customers=Array.isArray(payload.fa_custs)?payload.fa_custs:[];
            const matches=customers.filter(c=>String(c&&c.code||"").trim()===code);
            if(!matches.length)return json({ok:false,error:"العميل غير موجود في التخزين السحابي؛ لا يمكن استخدام مسار تعديل موقع عميل موجود",code:"CUSTOMER_NOT_FOUND"},409);
            if(matches.length>1){
              // Allow the location pre-check to proceed only when every cloud copy
              // is byte-for-byte equivalent (stable JSON) to the exact record the
              // user opened. The commit endpoint repeats this check before collapse.
              const expected=body.expected_customer;
              const expectedValid=expected&&typeof expected==="object"&&!Array.isArray(expected)&&String(expected.code||"").trim()===code;
              const firstJson=farujStableJson(matches[0]);
              const allExactCopies=matches.every(item=>farujStableJson(item)===firstJson);
              const matchesOpenedRecord=expectedValid&&firstJson===farujStableJson(expected);
              if(!allExactCopies||!matchesOpenedRecord){
                return json({ok:false,error:"يوجد أكثر من سجل للعميل "+code+" في التخزين السحابي، لكن النسخ ليست متطابقة تمامًا أو لا تطابق السجل المفتوح. لم نغيّر أي سجل؛ حدّث قائمة العملاء وراجع السجلات أولًا.",code:"CUSTOMER_CODE_DUPLICATE_CONFLICT",customer_code:code,duplicate_count:matches.length},409);
              }
            }
          }
          let resolved;try{resolved=await farujResolveGoogleMap(body.url);}catch(e){return json({ok:false,error:e.message,code:"LOCATION_RESOLVE_FAILED"},422);}
          const rows=await farujRpc(env,"faruj_check_customer_location_v4",{p_customer_code:code,p_latitude:resolved.lat,p_longitude:resolved.lng});
          const row=Array.isArray(rows)?rows[0]:rows;
          if(!row||row.available!==true)return json({ok:false,code:"CUSTOMER_LOCATION_DUPLICATE",other_customer_code:row&&row.other_customer_code||null,location_key:resolved.key,error:"الإحداثيات متطابقة مع موقع عميل مسجل"},409);
          const otherIssues=legacyIssues.filter(x=>String(x&&x.customer_code||"").trim()!==code);
          const unresolvedOther=otherIssues.filter(x=>String(x&&x.issue_type||"")==="unresolved").length;
          return json({ok:true,coords:[resolved.lat,resolved.lng],location_key:resolved.key,precision:6,match_mode:"exact",migration_pending:migration.status==="running"||otherIssues.length>0,remaining_legacy_issues:otherIssues.length,unverified_legacy_customers:unresolvedOther,checked_against_registered_locations:true});
        }
        if(path==="/api/customer-location/migration/status"&&request.method==="GET"){
          const state=await farujMigrationState(env);return json({ok:true,state,issues:Array.isArray(state.issues)?state.issues:[]});
        }
        if(path==="/api/customer-location/migration/start"&&request.method==="POST"){
          // Idempotent, lightweight start: no full payload download and no Worker-side
          // SHA-256 over the complete customer array. The database returns only count+token.
          const state=await farujMigrationState(env);
          // Once v47 has started, repeated clicks/requests (even every second)
          // return the saved cursor immediately without re-reading or hashing customers.
          // Older v4/v46 SHA-256 fingerprints are 64 hex chars and get one-time rebasing.
          if(state.status==="running" && /^[a-f0-9]{32}$/i.test(String(state.customer_fingerprint||""))){
            return json({ok:true,status:state.status,total_customers:Number(state.total_customers)||0,customer_fingerprint:String(state.customer_fingerprint),next_offset:Number(state.next_offset)||0,issues_count:Array.isArray(state.issues)?state.issues.length:0,resumed:true,already_running:true});
          }
          const meta=await farujMigrationPage(env,0,0);
          const fingerprint=meta.snapshot_token;
          const oldFingerprint=String(state.customer_fingerprint||"");
          if((state.status==="running"||state.status==="complete") && oldFingerprint===fingerprint){
            return json({ok:true,status:state.status,total_customers:Number(state.total_customers)||meta.total_customers,customer_fingerprint:fingerprint,next_offset:Number(state.next_offset)||0,issues_count:Array.isArray(state.issues)?state.issues.length:0,resumed:state.status==="running"});
          }
          // If a previous pass ended in needs_review, start a controlled second pass
          // from offset zero. Existing duplicate issues are revalidated; transient 429
          // issues remain held for the dedicated cooldown retry endpoint.
          if(state.status==="needs_review" && oldFingerprint===fingerprint){
            const saved=await farujWriteMigrationCAS(env,{
              status:"running",customer_fingerprint:fingerprint,
              total_customers:meta.total_customers,next_offset:0,
              issues:Array.isArray(state.issues)?state.issues:[]
            },state.updated_at);
            return json({ok:true,status:saved.status,total_customers:meta.total_customers,customer_fingerprint:fingerprint,next_offset:0,issues_count:Array.isArray(saved.issues)?saved.issues.length:(Array.isArray(state.issues)?state.issues.length:0),recheck:true});
          }
          // A changed customer-list snapshot or an older v4 hash is rebased safely.
          // Keep every existing issue; never discard review history during rebase.
          const keptIssues=Array.isArray(state.issues)?state.issues:[];
          const patch={
            status:meta.total_customers?"running":(keptIssues.length?"needs_review":"complete"),
            customer_fingerprint:fingerprint,
            total_customers:meta.total_customers,
            next_offset:0,
            issues:keptIssues
          };
          let saved;
          try{
            saved=await farujWriteMigrationCAS(env,patch,state.updated_at);
          }catch(startConflict){
            // Another tab/device may have started at the same moment. Read and return
            // the winner's state instead of launching another expensive initialization.
            const current=await farujMigrationState(env);
            return json({ok:true,status:current.status,total_customers:Number(current.total_customers)||meta.total_customers,customer_fingerprint:String(current.customer_fingerprint||fingerprint),next_offset:Number(current.next_offset)||0,issues_count:Array.isArray(current.issues)?current.issues.length:0,resumed:true,concurrent_start:true});
          }
          return json({ok:true,status:saved.status,total_customers:meta.total_customers,customer_fingerprint:fingerprint,next_offset:Number(saved.next_offset)||0,issues_count:keptIssues.length,rebased:!!oldFingerprint});
        }
        if(path==="/api/customer-location/migration/batch"&&request.method==="POST"){
          const body=await request.json().catch(()=>null);if(!body)return json({ok:false,error:"بيانات الدفعة غير صالحة"},400);
          const state=await farujMigrationState(env);if(state.status!=="running")return json({ok:false,error:"لا توجد عملية تهيئة جارية"},409);
          if(String(body.customer_fingerprint||"")!==String(state.customer_fingerprint||""))return json({ok:false,error:"بصمة سجل العملاء غير مطابقة؛ لم نغيّر أي سجل",code:"CUSTOMER_FINGERPRINT_CHANGED"},409);
          const offset=Number(body.offset);
          if(!Number.isInteger(offset)||offset!==Number(state.next_offset))return json({ok:false,error:"مؤشر الدفعة غير مطابق للحالة الحالية"},409);
          // The database returns exactly one customer and a lightweight snapshot token.
          const page=await farujMigrationPage(env,offset,1);
          if(page.snapshot_token!==String(state.customer_fingerprint||"") || page.total_customers!==Number(state.total_customers)){
            return json({ok:false,error:"تغيرت قائمة العملاء أثناء التهيئة؛ أوقفنا الدفعة دون تعديل أي رابط. ابدأ التهيئة لمواءمة المؤشر.",code:"CUSTOMER_FINGERPRINT_CHANGED"},409);
          }
          const batch=page.customers;
          if(offset<page.total_customers&&!batch.length)return json({ok:false,error:"تعذر تحميل العميل التالي من صفحة التهيئة؛ لم يتم تحريك المؤشر"},503);
          const issues=Array.isArray(state.issues)?state.issues.slice():[];
          const registered=await farujRegisteredLocationCodes(env,batch.map(c=>c&&c.code));
          for(const c of batch){
            const code=String(c&&c.code||"").trim(),map=String(c&&c.map||"").trim();
            if(!code){if(map&&!issues.some(x=>!String(x&&x.customer_code||"").trim()&&String(x&&x.issue_type||"")==="missing_code"))issues.push({customer_code:"",customer_name:String(c&&c.name||""),issue_type:"missing_code",details:"عميل لديه رابط موقع دون كود عميل"});continue;}
            const oldIssueIndex=issues.findIndex(x=>String(x&&x.customer_code||"").trim()===code);
            const oldIssue=oldIssueIndex>=0?issues[oldIssueIndex]:null;
            if(!map){
              try{
                await farujRpc(env,"faruj_release_customer_location_v4",{p_customer_code:code});
                if(oldIssueIndex>=0)issues.splice(oldIssueIndex,1);
              }catch(e){
                const item={customer_code:code,customer_name:String(c.name||""),issue_type:"release_failed",details:String(e.message||e).slice(0,300)};
                if(oldIssueIndex>=0)issues[oldIssueIndex]=item;else issues.push(item);
              }
              continue;
            }
            if(registered.get(code)===map){
              if(oldIssue&&oldIssue.issue_type==="duplicate")issues.splice(oldIssueIndex,1);
              continue;
            }
            // Re-check prior duplicate issues on a controlled second pass. Keep
            // unresolved 429s and other review items for their dedicated workflows.
            if(oldIssue && oldIssue.issue_type!=="duplicate")continue;
            if(oldIssueIndex>=0)issues.splice(oldIssueIndex,1);
            try{
              const resolved=await farujResolveGoogleMap(map);
              const claim=await farujRpc(env,"faruj_claim_customer_location_v4",{p_customer_code:code,p_latitude:resolved.lat,p_longitude:resolved.lng,p_original_url:map});
              const row=Array.isArray(claim)?claim[0]:claim;
              if(!row||row.success!==true)issues.push({customer_code:code,customer_name:String(c.name||""),issue_type:"duplicate",details:"إحداثيات مطابقة للعميل "+(row&&row.other_customer_code||"آخر")});
            }catch(e){
              issues.push({customer_code:code,customer_name:String(c.name||""),issue_type:"unresolved",details:String(e.message||e).slice(0,300)});
            }
          }
          const next=Math.min(page.total_customers,offset+batch.length);
          const done=next>=page.total_customers;
          const finalStatus=done?(issues.length?"needs_review":"complete"):"running";
          let nextState;
          try{
            nextState=await farujWriteMigrationCAS(env,{next_offset:next,issues,status:finalStatus},state.updated_at);
          }catch(commitConflict){
            const latest=await farujMigrationState(env);
            if(Number(latest.next_offset)>offset){
              return json({ok:true,processed:0,next_offset:Number(latest.next_offset),total_customers:Number(latest.total_customers)||page.total_customers,status:latest.status,issues_count:Array.isArray(latest.issues)?latest.issues.length:0,duplicate_request:true});
            }
            throw commitConflict;
          }
          return json({ok:true,processed:batch.length,next_offset:next,total_customers:page.total_customers,status:nextState.status,issues_count:issues.length});
        }
        if(path==="/api/customer-location/migration/retry-rate-limited"&&request.method==="POST"){
          const state=await farujMigrationState(env);
          if(state.status!=="needs_review")return json({ok:false,error:"لا توجد حالات مكتملة تنتظر إعادة محاولة روابط Google المؤقتة",code:"NO_RETRY_REVIEW"},409);
          const body=await request.json().catch(()=>({}));
          if(String(body&&body.customer_fingerprint||"")!==String(state.customer_fingerprint||""))return json({ok:false,error:"بصمة سجل العملاء غير مطابقة؛ لم نغيّر أي سجل",code:"CUSTOMER_FINGERPRINT_CHANGED"},409);
          const issues=Array.isArray(state.issues)?state.issues.slice():[];
          const retryIndexes=[];let cooldownSeconds=0;const nowMs=Date.now();
          for(let i=0;i<issues.length;i++){
            const it=issues[i]||{};
            if(String(it.issue_type||"")!=="unresolved" || !/HTTP\\s*429|rate.?limit|معدل الطلبات/i.test(String(it.details||"")))continue;
            const lastRetry=Date.parse(String(it.last_retry_at||""));
            const requiredWait=Math.max(5,Math.min(900,Number(it.retry_after_seconds)||60));
            if(Number.isFinite(lastRetry)&&nowMs<lastRetry+requiredWait*1000){cooldownSeconds=Math.max(cooldownSeconds,Math.ceil((lastRetry+requiredWait*1000-nowMs)/1000));break;}
            retryIndexes.push(i);if(retryIndexes.length>=1)break;
          }
          const retryableCount=issues.filter(x=>String(x.issue_type||"")==="unresolved"&&/HTTP\\s*429|rate.?limit|معدل الطلبات/i.test(String(x.details||""))).length;
          if(cooldownSeconds>0)return json({ok:true,retried:0,rate_limited:true,retry_after_seconds:cooldownSeconds,retryable_remaining:retryableCount,issues_count:issues.length,status:state.status,message:"يجب احترام مهلة Google قبل المحاولة التالية."});
          if(!retryIndexes.length)return json({ok:true,retried:0,retryable_remaining:0,issues_count:issues.length,status:state.status,message:"لا توجد أخطاء HTTP 429 قابلة لإعادة المحاولة تلقائيًا؛ باقي الحالات تحتاج مراجعة يدوية."});
          let retried=0,resolvedCount=0,duplicateCount=0,rateLimited=false,retryAfterSec=0;
          for(const idx of retryIndexes){
            const oldIssue=issues[idx]||{};const code=String(oldIssue.customer_code||"").trim();
            const snapshot=await farujMigrationCustomer(env,code);
            if(snapshot.snapshot_token!==String(state.customer_fingerprint||""))return json({ok:false,error:"تغير سجل العملاء الأصلي؛ أوقفنا إعادة المحاولة لحماية الروابط",code:"CUSTOMER_FINGERPRINT_CHANGED"},409);
            const customer=snapshot.customer;
            if(!code||!customer||!String(customer.map||"").trim()){issues[idx]=Object.assign({},oldIssue,{details:"تعذر العثور على العميل أو رابطه الأصلي في السجل الحالي؛ لم يتم تعديل الرابط."});continue;}
            retried++;
            try{
              const map=String(customer.map).trim();const resolved=await farujResolveGoogleMap(map);
              const claim=await farujRpc(env,"faruj_claim_customer_location_v4",{p_customer_code:code,p_latitude:resolved.lat,p_longitude:resolved.lng,p_original_url:map});
              const row=Array.isArray(claim)?claim[0]:claim;
              if(row&&row.success===true){issues[idx]=null;resolvedCount++;}
              else{issues[idx]=Object.assign({},oldIssue,{issue_type:"duplicate",details:"إحداثيات مطابقة للعميل "+String(row&&row.other_customer_code||"آخر")});duplicateCount++;}
            }catch(e){
              issues[idx]=Object.assign({},oldIssue,{details:String(e&&e.message||e).slice(0,300),retry_attempts:(Number(oldIssue.retry_attempts)||0)+1,last_retry_at:new Date().toISOString(),retry_after_seconds:e&&e.code==="MAP_RATE_LIMITED"?(Number(e.retryAfterSec)||60):undefined});
              if(e&&e.code==="MAP_RATE_LIMITED"){rateLimited=true;retryAfterSec=Math.max(retryAfterSec,Number(e.retryAfterSec)||60);break;}
            }
          }
          const finalIssues=issues.filter(Boolean);
          const stillRetryable=finalIssues.filter(x=>String(x.issue_type||"")==="unresolved"&&/HTTP\\s*429|rate.?limit|معدل الطلبات/i.test(String(x.details||""))).length;
          const saved=await farujWriteMigrationCAS(env,{issues:finalIssues,status:finalIssues.length?"needs_review":"complete"},state.updated_at);
          return json({ok:true,retried,resolved:resolvedCount,duplicates:duplicateCount,rate_limited:rateLimited,retry_after_seconds:retryAfterSec,retryable_remaining:stillRetryable,issues_count:finalIssues.length,status:saved.status,next_offset:Number(saved.next_offset)||0,total_customers:Number(saved.total_customers)||0});
        }
        return json({ok:false,error:"مسار حماية المواقع غير معروف"},404);
        } catch (locationError) {
          const diagnostic = String(locationError && locationError.message || locationError || "unknown").slice(0, 350);
          try { console.error("Faruj customer-location route failed:", path, diagnostic); } catch (_) {}
          return json({
            ok: false,
            code: "CUSTOMER_LOCATION_INTERNAL",
            error: "تعذر تنفيذ فحص موقع العميل: " + diagnostic
          }, 500);
        }
      }

      // حفظ سجل عميل واحد مباشرة في التخزين السحابي، بهوية code فقط وCAS ذري.
      if (path === "/api/desktop-customers/commit" && request.method === "POST") {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ ok: false, error: "غير مصرح" }, 401);
        const declaredLength = Number(request.headers.get("Content-Length") || 0);
        if (declaredLength > 2 * 1024 * 1024) return json({ ok: false, error: "حجم سجل العميل أكبر من الحد المسموح" }, 413);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "بيانات تعديل العميل غير صالحة" }, 400);
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 2 * 1024 * 1024) return json({ ok: false, error: "حجم تعديل العميل أكبر من الحد المسموح (2 ميجابايت)" }, 413);
        const action = String(body.action || "").trim();
        const code = String(body.customer_code || "").trim();
        if (!["create", "update", "delete"].includes(action) || !/^[A-Za-z0-9_-]{1,80}$/.test(code)) {
          return json({ ok: false, error: "نوع العملية أو كود العميل غير صالح" }, 400);
        }
        const proposed = body.customer;
        const expected = body.expected_customer;
        if (action === "create" || action === "update") {
          if (!proposed || typeof proposed !== "object" || Array.isArray(proposed) || String(proposed.code || "").trim() !== code || !String(proposed.name || "").trim()) {
            return json({ ok: false, error: "سجل العميل الجديد غير صالح أو كوده لا يطابق الطلب" }, 400);
          }
        }
        if (action === "update" || action === "delete") {
          if (!expected || typeof expected !== "object" || Array.isArray(expected) || String(expected.code || "").trim() !== code) {
            return json({ ok: false, error: "نسخة العميل الأصلية المطلوبة للتحقق غير موجودة" }, 400);
          }
        }
        let lastConflict = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          let shared;
          try { shared = await farujReadSharedStateVersion(env); }
          catch (e) { return json({ ok: false, code: "CUSTOMER_CLOUD_READ_FAILED", error: String(e && e.message || e).slice(0, 350) }, 502); }
          const payload = JSON.parse(JSON.stringify(shared.payload));
          if (!Array.isArray(payload.fa_custs)) return json({ ok: false, code: "CUSTOMER_LIST_INVALID", error: "قائمة العملاء في التخزين السحابي ليست قائمة صالحة؛ لم يتم تغييرها" }, 409);
          const customers = payload.fa_custs;
          let matches = [];
          for (let i = 0; i < customers.length; i++) {
            if (String(customers[i] && customers[i].code || "").trim() === code) matches.push(i);
          }
          const proposedJson = (action === "create" || action === "update") ? farujStableJson(proposed) : null;
          const expectedJson = expected ? farujStableJson(expected) : null;
          let current = matches.length ? customers[matches[0]] : null;
          let currentJson = current ? farujStableJson(current) : null;
          let duplicateCopiesCollapsed = 0;

          // A cloud list may contain repeated byte-for-byte copies of the same customer
          // after old sync/import attempts. Collapse only exact copies of the record the
          // user opened. Never merge or discard a same-code record with different data.
          if (matches.length > 1) {
            if (action === "update" || action === "delete") {
              const matchedJson = matches.map(index => farujStableJson(customers[index]));
              const allExactCopies = matchedJson.every(value => value === matchedJson[0]);
              const matchesOpenedRecord = !!expectedJson && matchedJson[0] === expectedJson;
              if (!allExactCopies || !matchesOpenedRecord) {
                return json({
                  ok: false,
                  code: "CUSTOMER_CODE_DUPLICATE_CONFLICT",
                  customer_code: code,
                  duplicate_count: matches.length,
                  error: "يوجد أكثر من سجل في التخزين السحابي بنفس كود العميل " + code + "، لكن بيانات السجلات ليست نسخًا متطابقة تمامًا أو لا تطابق النسخة المفتوحة. لم نغيّر أو نحذف أي سجل حتى لا نفقد بيانات عميل آخر. يلزم مراجعة سجلات هذا الكود أولًا."
                }, 409);
              }
              for (let i = matches.length - 1; i >= 1; i--) customers.splice(matches[i], 1);
              duplicateCopiesCollapsed = matches.length - 1;
              matches = [matches[0]];
              current = customers[matches[0]];
              currentJson = farujStableJson(current);
            } else {
              return json({ ok: false, code: "CUSTOMER_CODE_DUPLICATE", customer_code: code, duplicate_count: matches.length, error: "كود العميل موجود بالفعل في التخزين السحابي؛ لا يمكن إنشاء عميل جديد بنفس الكود" }, 409);
            }
          }

          if (action === "create") {
            if (current) {
              if (currentJson === proposedJson) return json({ ok: true, action, customer_code: code, already_applied: true, updated_at: shared.updated_at });
              return json({ ok: false, code: "CUSTOMER_CODE_DUPLICATE", error: "كود العميل موجود بالفعل في التخزين السحابي بسجل مختلف؛ لم ندمج السجلين" }, 409);
            }
            customers.push(proposed);
          } else if (action === "update") {
            if (!current) return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "لم يعد سجل العميل موجودًا في التخزين السحابي؛ لم نعتمد التعديل" }, 409);
            if (currentJson === proposedJson && duplicateCopiesCollapsed === 0) return json({ ok: true, action, customer_code: code, already_applied: true, updated_at: shared.updated_at });
            if (currentJson !== expectedJson) return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "تم تعديل هذا العميل على جهاز آخر منذ فتح السجل؛ لم نستبدل أي بيانات" }, 409);
            customers[matches[0]] = proposed;
          } else {
            if (!current) return json({ ok: true, action, customer_code: code, already_applied: true, updated_at: shared.updated_at });
            if (currentJson !== expectedJson) return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "تغير سجل العميل على جهاز آخر؛ لم ننفذ الحذف حتى لا نفقد تعديلًا أحدث" }, 409);
            customers.splice(matches[0], 1);
          }

          // Validate only the customer being changed. Older cloud payloads may
          // already contain unrelated legacy duplicate/blank codes; blocking every
          // edit because of those unrelated rows makes a valid C197 update impossible.
          // Do not rewrite, merge, or delete any unrelated customer record here.
          const targetCodeCount = customers.reduce((count, item) =>
            count + (String(item && item.code || "").trim() === code ? 1 : 0), 0);
          if (action === "delete" ? targetCodeCount !== 0 : targetCodeCount !== 1) {
            return json({
              ok: false,
              code: "CUSTOMER_TARGET_CODE_INVALID",
              customer_code: code,
              target_count: targetCodeCount,
              error: "تعذر اعتماد تعديل العميل " + code + " لأن عدد سجلات هذا الكود بعد التعديل ليس سجلًا واحدًا. لم نغيّر أي سجل."
            }, 409);
          }
          const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
          if (payloadBytes > 20 * 1024 * 1024) return json({ ok: false, error: "حجم التخزين المشترك تجاوز الحد المسموح" }, 413);
          let rpcResult;
          try {
            rpcResult = await farujRpc(env, "faruj_desktop_shared_state_cas_update", {
              p_expected_updated_at: shared.updated_at,
              p_payload: payload,
              p_source_device: String(body.source_device || "desktop-customer").slice(0, 80)
            });
          } catch (e) {
            const message = String(e && e.message || e).slice(0, 350);
            const duplicate = /CUSTOMER_LOCATION_DUPLICATE|إحداثيات مطابقة/i.test(message);
            return json({ ok: false, code: duplicate ? "CUSTOMER_LOCATION_DUPLICATE" : "CUSTOMER_CLOUD_COMMIT_FAILED", error: "رفض التخزين السحابي اعتماد سجل العميل: " + message }, duplicate ? 409 : 502);
          }
          const saved = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
          if (saved && saved.success === true && saved.conflict !== true && saved.updated_at) {
            const mapChanged = action === "update" && String(expected && expected.map || "").trim() !== String(proposed && proposed.map || "").trim();
            let migrationIssueCleared = null;
            let locationRegistryReleased = null;
            if (action === "delete") {
              // Release the deleted customer's unique location claim only after the
              // cloud customer deletion is committed. Never touch another customer's row.
              try {
                await farujRpc(env, "faruj_release_customer_location_v4", { p_customer_code: code });
                locationRegistryReleased = true;
              } catch (releaseError) {
                locationRegistryReleased = false;
                try { console.error("Customer deleted; location registry cleanup deferred:", String(releaseError && releaseError.message || releaseError)); } catch (_) {}
              }
            }
            if (action === "delete" || mapChanged) {
              // Bookkeeping is secondary to the committed customer update.
              // A bookkeeping failure must not turn a successful cloud save into a false failure.
              try { migrationIssueCleared = await farujClearCustomerMigrationIssue(env, code); }
              catch (migrationError) {
                try { console.error("Customer saved; migration issue cleanup deferred:", String(migrationError && migrationError.message || migrationError)); } catch (_) {}
                migrationIssueCleared = false;
              }
            }
            return json({ ok: true, action, customer_code: code, already_applied: false, updated_at: saved.updated_at, source_device: saved.source_device || body.source_device || "desktop-customer", migration_issue_cleared: migrationIssueCleared, location_registry_released: locationRegistryReleased, duplicate_copies_collapsed: duplicateCopiesCollapsed });
          }
          lastConflict = saved || null;
          if (!(saved && saved.conflict === true) || attempt === 3) break;
        }
        return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "تغير التخزين المشترك أثناء حفظ العميل ولم يمكن تأكيد العملية بعد 4 محاولات؛ لم نعتمد نجاحًا غير مؤكد", updated_at: lastConflict && lastConflict.updated_at || null }, 409);
      }

      if (
        path === "/api/health" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          worker: "delivery-driver-app",
          configuration: "ready"
        });
      }

      /* مزامنة مستخدمي نسخة سطح المكتب بين الأجهزة — جدول مستقل عن orders والماستر */
      if (path === "/api/desktop-users" && (request.method === "GET" || request.method === "POST")) {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "غير مصرح" }, 401);
        }
        // يقبل مفتاح Supabase الجديد sb_secret_ أو مفتاح service_role القديم.
        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "مفتاح التخزين المركزي غير مضبوط: أضف SUPABASE_SECRET_KEY أو SUPABASE_SERVICE_ROLE_KEY إلى أسرار Worker" }, 500);
        const serviceHeaders = { apikey: serviceKey, "Content-Type": "application/json" };
        // مفاتيح sb_secret_ ليست JWT ولا يصح وضعها في Authorization Bearer.
        if (!serviceKey.startsWith("sb_secret_")) serviceHeaders.Authorization = "Bearer " + serviceKey;
        if (request.method === "GET") {
          const response = await supabaseRequest(
            "/rest/v1/faruj_desktop_shared_users?id=eq.1&select=users,deleted_names,updated_at",
            { headers: serviceHeaders }
          );
          const rows = await response.json().catch(function () { return null; });
          if (!response.ok || !Array.isArray(rows)) {
            return json({
              error: "تعذر قراءة المستخدمين من التخزين المركزي",
              detail: rows,
              supabase_status: response.status
            }, 502);
          }
          return json({
            users: rows.length && Array.isArray(rows[0].users) ? rows[0].users : [],
            deleted_names: rows.length && Array.isArray(rows[0].deleted_names) ? rows[0].deleted_names : [],
            updated_at: rows.length ? rows[0].updated_at : null
          });
        }
        const body = await request.json().catch(function () { return null; });
        if (!body || !Array.isArray(body.users) || body.users.length > 200) {
          return json({ error: "قائمة المستخدمين غير صالحة" }, 400);
        }
        const deletedNames = Array.isArray(body.deleted_names)
          ? body.deleted_names.filter(function (name) { return typeof name === "string" && name.trim(); }).slice(0, 200)
          : [];
        const restoreNames = Array.isArray(body.restore_names)
          ? body.restore_names.filter(function (name) { return typeof name === "string" && name.trim(); }).slice(0, 200)
          : [];
        const valid = body.users.every(function (u) {
          return u && typeof u.name === "string" && u.name.trim() &&
            typeof u.pass === "string" && typeof u.role === "string";
        });
        if (!valid) return json({ error: "يوجد مستخدم ببيانات غير مكتملة" }, 400);
        const response = await supabaseRequest("/rest/v1/rpc/faruj_sync_desktop_users", {
          method: "POST",
          headers: serviceHeaders,
          body: JSON.stringify({ p_users: body.users, p_deleted_names: deletedNames, p_restore_names: restoreNames })
        });
        const result = await response.json().catch(function () { return null; });
        if (!response.ok) {
          return json({
            error: "تعذر دمج المستخدمين في التخزين المركزي",
            detail: result,
            supabase_status: response.status
          }, 502);
        }
        const syncedUsers = result && Array.isArray(result.users) ? result.users : body.users;
        const syncedDeletedNames = result && Array.isArray(result.deleted_names) ? result.deleted_names : deletedNames;
        return json({ success: true, users: syncedUsers, deleted_names: syncedDeletedNames });
      }

      /* نقل أولي آمن لبيانات برنامج سطح المكتب بين الكمبيوتر الرئيسي واللابتوب. */
      if (path === "/api/desktop-state" && (request.method === "GET" || request.method === "POST")) {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "مفتاح التخزين المركزي غير مضبوط في أسرار Worker" }, 500);
        const headers = { apikey: serviceKey, "Content-Type": "application/json" };
        if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + serviceKey;
        if (request.method === "GET") {
          try {
            const row = await farujReadSharedStateChunked(env);
            if (!row) return json({ success: true, payload: null, updated_at: null, source_device: null });
            return json({ success: true, payload: row.payload, updated_at: row.updated_at, source_device: row.source_device });
          } catch (error) {
            return json({ error: "تعذرت قراءة النسخة المشتركة", detail: String(error && error.message || error) }, 502);
          }
        }
        const declaredLength = Number(request.headers.get("Content-Length") || 0);
        if (declaredLength > 20 * 1024 * 1024) return json({ error: "حجم النسخة أكبر من الحد المسموح (20 ميجابايت)" }, 413);
        const body = await request.json().catch(function () { return null; });
        if (!body || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return json({ error: "محتوى النسخة غير صالح" }, 400);
        const keys = Object.keys(body.payload);
        if (!keys.length || keys.length > 100) return json({ error: "عدد مفاتيح النسخة غير صالح" }, 400);
        for (const key of keys) {
          if (!/^fa_[a-zA-Z0-9_-]+$/.test(key) || ["fa_set","fa_users","fa_users_deleted","fa_users_pending_delete","fa_users_restore","fa_theme","fa_owner_pass_2010_migrated"].includes(key)) {
            return json({ error: "النسخة تحتوي على مفتاح محظور: " + key }, 400);
          }
        }
        const payloadText = JSON.stringify(body.payload);
        if (new TextEncoder().encode(payloadText).byteLength > 20 * 1024 * 1024) return json({ error: "حجم بيانات النسخة أكبر من 20 ميجابايت" }, 413);
        const response = await supabaseRequest("/rest/v1/faruj_desktop_shared_state?on_conflict=id", {
          method: "POST",
          headers: Object.assign({}, headers, { Prefer: "resolution=ignore-duplicates,return=representation" }),
          body: JSON.stringify({ id: 1, payload: body.payload, source_device: String(body.source_device || "desktop-primary").slice(0, 80), updated_at: new Date().toISOString() })
        });
        const rows = await response.json().catch(function () { return null; });
        if (!response.ok) return json({ error: "تعذر حفظ النسخة المشتركة", detail: rows, supabase_status: response.status }, 502);
        if (!Array.isArray(rows) || !rows.length) return json({ error: "توجد نسخة مشتركة بالفعل؛ لم نستبدلها حمايةً لبياناتك. استخدم تحميل البيانات على الجهاز الآخر." }, 409);
        return json({ success: true, saved_keys: keys.length, updated_at: rows[0].updated_at || new Date().toISOString(), message: "تم حفظ النسخة الأولية دون استبدال نسخة سابقة" });
      }

      /* مزامنة حالة سطح المكتب ثنائية الاتجاه مع تحكم بالتعارض عبر updated_at CAS. */
      if (path === "/api/desktop-state/sync" && (request.method === "GET" || request.method === "POST")) {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);

        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "مفتاح التخزين المركزي غير مضبوط في أسرار Worker" }, 500);
        const headers = { apikey: serviceKey, "Content-Type": "application/json" };
        if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + serviceKey;

        if (request.method === "GET") {
          const metadataOnly = url.searchParams.get("meta") === "1";
          if (metadataOnly) {
            const response = await supabaseRequest(
              "/rest/v1/faruj_desktop_shared_state?id=eq.1&select=id,updated_at,source_device",
              { headers }
            );
            const rows = await response.json().catch(function () { return null; });
            if (!response.ok || !Array.isArray(rows)) return json({ error: "تعذر قراءة بيانات مراجعة التخزين المشترك", detail: rows, supabase_status: response.status }, 502);
            if (!rows.length) return json({ success: true, exists: false, updated_at: null, source_device: null });
            return json({ success: true, exists: true, updated_at: rows[0].updated_at, source_device: rows[0].source_device });
          }
          try {
            const row = await farujReadSharedStateChunked(env);
            if (!row) return json({ success: true, exists: false, payload: null, updated_at: null, source_device: null });
            return json({ success: true, exists: true, payload: row.payload, updated_at: row.updated_at, source_device: row.source_device });
          } catch (error) {
            return json({ error: "تعذر قراءة حالة التخزين المشترك", detail: String(error && error.message || error) }, 502);
          }
        }

        const body = await request.json().catch(function () { return null; });
        if (!body || typeof body.expected_updated_at !== "string" || !body.expected_updated_at.trim()) {
          return json({ error: "رقم مراجعة النسخة المشتركة غير موجود" }, 400);
        }
        if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
          return json({ error: "محتوى النسخة غير صالح" }, 400);
        }
        const keys = Object.keys(body.payload);
        if (!keys.length || keys.length > 100) return json({ error: "عدد مفاتيح النسخة غير صالح" }, 400);
        const forbidden = ["fa_set", "fa_users", "fa_users_deleted", "fa_users_pending_delete", "fa_users_restore", "fa_theme", "fa_owner_pass_2010_migrated"];
        for (const key of keys) {
          // تسمح الشرطة بتاريخ مفاتيح التنبيهات مثل fa_wa_2026-10-31.
          if (!/^fa_[a-zA-Z0-9_-]+$/.test(key) || forbidden.includes(key)) {
            return json({ error: "النسخة تحتوي على مفتاح محظور: " + key }, 400);
          }
        }

        const payloadText = JSON.stringify(body.payload);
        const payloadBytes = new TextEncoder().encode(payloadText).byteLength;
        if (payloadBytes > 20 * 1024 * 1024) return json({ error: "حجم بيانات النسخة أكبر من 20 ميجابايت" }, 413);

        // حماية مركزية إضافية: لا نقبل لقطة ناقصة للفواتير ولا نستنتج الحذف من اختفاء سجل.
        if (!Array.isArray(body.payload.fa_invs)) {
          return json({ success: false, code: "INVOICE_SNAPSHOT_INVALID", error: "النسخة الواردة لا تحتوي على قائمة فواتير صالحة؛ لم يتم حفظ أي تغيير" }, 400);
        }
        let currentShared;
        try {
          currentShared = await farujReadSharedStateChunked(env);
        } catch (error) {
          return json({ success: false, code: "INVOICE_SNAPSHOT_CHECK_FAILED", error: "تعذر فحص النسخة الحالية قبل الحفظ؛ لم يتم استبدال أي بيانات", detail: String(error && error.message || error) }, 502);
        }
        if (currentShared) {
          if (!currentShared.payload || !Array.isArray(currentShared.payload.fa_invs)) {
            return json({ success: false, code: "INVOICE_BASE_INVALID", error: "النسخة السحابية الحالية لا تحتوي على قائمة فواتير صالحة؛ تم رفض الاستبدال لحماية البيانات" }, 409);
          }
          // إذا تغيرت النسخة منذ قراءتها، اترك CAS يعيد المحاولة من خلال دورة المزامنة بدل فحص لقطة قديمة.
          if (String(currentShared.updated_at || "") !== body.expected_updated_at.trim()) {
            return json({ success: false, conflict: true, code: "STATE_REVISION_CONFLICT", error: "تغيرت النسخة المشتركة قبل فحص الفواتير؛ أعد قراءتها وادمجها قبل الحفظ", updated_at: currentShared.updated_at || null }, 409);
          }
          // نفس أولوية هوية الفاتورة المستخدمة في دمج سطح المكتب: id ثم uuid ثم uid ثم رقم الفاتورة.
          const invoiceId = inv => String(inv && (inv.id || inv.uuid || inv.uid || inv.no || inv.invoice_number || inv.order_number || inv._dn) || "").trim().toUpperCase();
          const buildInvoiceMap = (rows, label) => {
            const map = new Map();
            for (const inv of rows) {
              const id = invoiceId(inv);
              if (!id || map.has(id)) return { error: label + " تحتوي على رقم فاتورة فارغ أو مكرر: " + (id || "بدون رقم") };
              map.set(id, inv);
            }
            return { map };
          };
          const oldInvoices = buildInvoiceMap(currentShared.payload.fa_invs, "النسخة السحابية الحالية");
          const newInvoices = buildInvoiceMap(body.payload.fa_invs, "النسخة الواردة");
          if (oldInvoices.error) return json({ success: false, code: "INVOICE_SNAPSHOT_INVALID", error: oldInvoices.error }, 409);
          if (newInvoices.error) return json({ success: false, code: "INVOICE_SNAPSHOT_INVALID", error: newInvoices.error }, 409);
          const explicitTrash = new Set((Array.isArray(body.payload.fa_trash) ? body.payload.fa_trash : [])
            .map(item => String(item && (item.no || item._dn || item.invoice_number || item.order_number) || "").trim().toUpperCase())
            .filter(Boolean));
          const missingInvoices = [];
          const partialInvoices = [];
          for (const [id, oldInvoice] of oldInvoices.map) {
            if (!newInvoices.map.has(id)) {
              if (!explicitTrash.has(id)) missingInvoices.push(id);
              continue;
            }
            const newInvoice = newInvoices.map.get(id);
            if (oldInvoice && newInvoice && typeof oldInvoice === "object" && typeof newInvoice === "object") {
              const missingFields = Object.keys(oldInvoice).filter(key => !Object.prototype.hasOwnProperty.call(newInvoice, key));
              if (missingFields.length) partialInvoices.push({ invoice: id, fields: missingFields.slice(0, 5) });
            }
          }
          if (missingInvoices.length) {
            return json({
              success: false, code: "INVOICE_SNAPSHOT_INCOMPLETE",
              error: "تم رفض النسخة لأنها ستُسقط فواتير موجودة دون أمر حذف صريح مسجل في سلة المحذوفات",
              current_invoice_count: oldInvoices.map.size, incoming_invoice_count: newInvoices.map.size,
              missing_invoices: missingInvoices.slice(0, 30)
            }, 409);
          }
          if (partialInvoices.length) {
            return json({
              success: false, code: "INVOICE_RECORD_INCOMPLETE",
              error: "تم رفض النسخة لأنها تحتوي على فواتير ناقصة الحقول؛ لم يتم استبدال أي بيانات",
              partial_invoices: partialInvoices.slice(0, 20)
            }, 409);
          }
        }

        // التحديث يتم عبر RPC ذرّي بقفل الصف والتحقق من updated_at داخل PostgreSQL.
        // هذا يمنع الكتابة فوق تعديل جهاز آخر، ويمنح عملية JSONB الكبيرة مهلة 60 ثانية
        // داخل الدالة فقط، بدل إرجاع حمولة 6+ MB من PostgREST بعد كل PATCH.
        const expectedMillis = Date.parse(body.expected_updated_at.trim());
        if (!Number.isFinite(expectedMillis)) return json({ error: "رقم مراجعة النسخة المشتركة غير صالح" }, 400);
        const response = await supabaseRequest(
          "/rest/v1/rpc/faruj_desktop_shared_state_cas_update",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              p_expected_updated_at: body.expected_updated_at.trim(),
              p_payload: body.payload,
              p_source_device: String(body.source_device || "desktop-device").slice(0, 80)
            })
          }
        );
        const rows = await response.json().catch(function () { return null; });
        if (!response.ok || !Array.isArray(rows) || !rows.length) {
          return json({
            error: "تعذر حفظ تحديث التخزين المشترك",
            detail: rows,
            supabase_status: response.status,
            hint: rows && rows.code === "57014"
              ? "انتهت مهلة PostgreSQL حتى بعد استخدام مسار الحفظ الموسع؛ لم نؤكد نجاح الحفظ"
              : undefined
          }, 502);
        }
        const saved = rows[0];
        if (saved.success !== true || saved.conflict === true) {
          return json({
            success: false,
            conflict: true,
            code: "STATE_REVISION_CONFLICT",
            error: "تغيرت النسخة المشتركة على جهاز آخر؛ أعد قراءة التحديث ودمجه قبل الحفظ",
            updated_at: saved.updated_at || null,
            source_device: saved.source_device || null
          }, 409);
        }
        return json({
          success: true,
          updated_at: saved.updated_at,
          source_device: saved.source_device,
          saved_keys: keys.length,
          payload_bytes: payloadBytes
        });
      }

      if (
        path === "/api/login" &&
        request.method === "POST"
      ) {
        const body =
          await request.json().catch(function () {
            return {};
          });

        const username =
          String(body.username || "")
            .trim()
            .toLowerCase();

        const password =
          String(body.password || "");

        if (!username || !password) {
          return json(
            {
              error:
                "يرجى إدخال اسم المستخدم وكلمة المرور"
            },
            400
          );
        }

        const email =
          DRIVER_EMAILS[username];

        if (!email) {
          return json(
            {
              error:
                "اسم المستخدم أو كلمة المرور غير صحيحة"
            },
            401
          );
        }

        const authResponse =
          await supabaseRequest(
            "/auth/v1/token?grant_type=password",
            {
              method: "POST",
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                email: email,
                password: password
              })
            }
          );

        const authData =
          await authResponse.json().catch(function () {
            return {};
          });

        if (
          !authResponse.ok ||
          !authData.access_token
        ) {
          return json(
            {
              error:
                "اسم المستخدم أو كلمة المرور غير صحيحة"
            },
            401
          );
        }

        const driver =
          await getDriverInfo(
            authData.access_token,
            env.SUPABASE_ANON_KEY,
            authData.user &&
              authData.user.id
          );

        if (!driver) {
          return json(
            {
              error:
                "المندوب غير مسجل في النظام"
            },
            403
          );
        }

        return json({
          access_token:
            authData.access_token,
          refresh_token:
            authData.refresh_token,
          expires_in:
            authData.expires_in,
          username:
            username,
          mandoub_name:
            driver.mandoub_name,
          sheet_name:
            driver.sheet_name,
          can_call:
            username === "zain2"
        });
      }

      if (
        path === "/api/master-login" &&
        request.method === "POST"
      ) {
        const body =
          await request.json().catch(function () {
            return {};
          });

        const username =
          String(body.username || "")
            .trim()
            .toLowerCase();

        const password =
          String(body.password || "");

        if (
          username !==
          MASTER_USERNAME
        ) {
          return json(
            {
              error:
                "اسم المستخدم أو كلمة المرور غير صحيحة"
            },
            401
          );
        }

        if (!password) {
          return json(
            {
              error:
                "يرجى إدخال كلمة المرور"
            },
            400
          );
        }

        const authResponse =
          await supabaseRequest(
            "/auth/v1/token?grant_type=password",
            {
              method: "POST",
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                email:
                  MASTER_EMAIL,
                password:
                  password
              })
            }
          );

        const authData =
          await authResponse.json().catch(function () {
            return {};
          });

        if (
          !authResponse.ok ||
          !authData.access_token
        ) {
          return json(
            {
              error:
                "اسم المستخدم أو كلمة المرور غير صحيحة"
            },
            401
          );
        }

        const user =
          await getUser(
            authData.access_token,
            env.SUPABASE_ANON_KEY
          );

        if (!user || !user.id) {
          return json(
            {
              error:
                "تعذر التحقق من حساب الماستر"
            },
            401
          );
        }

        const masterPath =
          "/rest/v1/master_admins?user_id=eq." +
          encodeURIComponent(user.id) +
          "&select=id,user_id,email";

        const masterResponse =
          await supabaseRequest(
            masterPath,
            {
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                Authorization:
                  "Bearer " +
                  authData.access_token
              }
            }
          );

        const masterRows =
          await masterResponse.json().catch(function () {
            return [];
          });

        if (
          !masterResponse.ok ||
          !Array.isArray(masterRows) ||
          masterRows.length === 0
        ) {
          return json(
            {
              error:
                "هذا الحساب ليس حساب ماستر"
            },
            403
          );
        }

        return json({
          access_token:
            authData.access_token,
          refresh_token:
            authData.refresh_token,
          expires_in:
            authData.expires_in,
          username:
            MASTER_USERNAME,
          email:
            MASTER_EMAIL,
          role:
            "master_admin"
        });
      }

      if (
        path === "/api/refresh" &&
        request.method === "POST"
      ) {
        const body =
          await request.json().catch(function () {
            return {};
          });

        const refreshToken =
          String(
            body.refresh_token || ""
          ).trim();

        if (!refreshToken) {
          return json(
            {
              error:
                "لا يوجد refresh token"
            },
            401
          );
        }

        const authResponse =
          await supabaseRequest(
            "/auth/v1/token?grant_type=refresh_token",
            {
              method: "POST",
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                refresh_token:
                  refreshToken
              })
            }
          );

        const authData =
          await authResponse.json().catch(function () {
            return {};
          });

        if (
          !authResponse.ok ||
          !authData.access_token
        ) {
          return json(
            {
              error:
                "انتهت الجلسة"
            },
            401
          );
        }

        const driver =
          await getDriverInfo(
            authData.access_token,
            env.SUPABASE_ANON_KEY,
            authData.user &&
              authData.user.id
          );

        if (!driver) {
          return json(
            {
              error:
                "المندوب غير مسجل"
            },
            403
          );
        }

        const username =
          authData.user &&
          authData.user.email ===
            DRIVER_EMAILS.zain2
            ? "zain2"
            : "zain";

        return json({
          access_token:
            authData.access_token,
          refresh_token:
            authData.refresh_token,
          expires_in:
            authData.expires_in,
          username:
            username,
          mandoub_name:
            driver.mandoub_name,
          sheet_name:
            driver.sheet_name,
          can_call:
            username === "zain2"
        });
      }

      if (path === "/api/driver/order/reorder" && request.method === "POST") {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "إعداد حفظ ترتيب الفواتير غير مكتمل: أضف SUPABASE_SERVICE_ROLE_KEY إلى أسرار Worker" }, 500);

        const body = await request.json().catch(function () { return {}; });
        const orderIds = Array.isArray(body.order_ids)
          ? body.order_ids.map(function (value) { return String(value == null ? "" : value).trim(); })
          : [];
        const validOrderId = function (value) { return /^[0-9]+$/.test(value); };
        if (!orderIds.length || orderIds.some(function (id) { return !validOrderId(id); }) || new Set(orderIds).size !== orderIds.length) {
          return json({ error: "قائمة معرفات الفواتير غير صحيحة" }, 400);
        }

        const sheet = auth.driver.sheet_name;
        const ordersResponse = await supabaseRequest(
          "/rest/v1/orders?select=id,order_number,created_at,customer_name,total,delivery_date&sheet_name=eq." + encodeURIComponent(sheet) + "&id=in.(" + orderIds.join(",") + ")",
          { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } }
        );
        const ownedOrders = await ordersResponse.json().catch(function () { return []; });
        if (!ordersResponse.ok || !Array.isArray(ownedOrders) || ownedOrders.length !== orderIds.length) {
          return json({ error: "تعذر التحقق من فواتير المندوب الحالي", detail: ownedOrders }, 403);
        }
        const todayKey = dubaiDateKey(new Date());
        if (ownedOrders.some(function (row) { return isFutureDeliveryDate(row.delivery_date, todayKey); })) {
          return json({ error: "لا يمكن تغيير ترتيب فواتير يوم قادم قبل يوم التوصيل", code: "FUTURE_DELIVERY_LOCKED" }, 409);
        }
        const byId = new Map(ownedOrders.map(function (row) { return [String(row.id), row]; }));
        const now = new Date().toISOString();
        const sortRows = [];
        for (let index = 0; index < orderIds.length; index++) {
          const row = byId.get(orderIds[index]);
          if (!row) return json({ error: "لم يتم العثور على إحدى الفواتير" }, 404);
          sortRows.push({ invoice_key: await makeSharedInvoiceKey(row), sort_position: index + 1, updated_at: now });
        }
        const saveResponse = await supabaseRequest(
          "/rest/v1/driver_invoice_order_shared?on_conflict=invoice_key",
          { method: "POST", headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(sortRows) }
        );
        const savedRows = await saveResponse.json().catch(function () { return []; });
        if (!saveResponse.ok) return json({ error: "تعذر حفظ الترتيب المشترك - HTTP " + saveResponse.status, detail: savedRows }, 500);
        return json({ success: true, saved: sortRows.length, scope: "shared_invoice_fingerprint" });
      }

      if (
        path === "/api/orders" &&
        request.method === "GET"
      ) {
        const auth =
          await requireDriver(
            request,
            env
          );

        if (auth.error) {
          return json(
            {
              error:
                auth.error
            },
            auth.status
          );
        }

        const sheet =
          auth.driver.sheet_name;

        /* المندوب يرى فواتير اليوم وما بعده؛ فواتير المستقبل للعرض فقط ومقفولة حتى موعدها. */
        const dubaiDay = dubaiDateKey(new Date());
        const ordersPath =
          "/rest/v1/orders?sheet_name=eq." +
          encodeURIComponent(sheet) +
          "&select=*" +
          "&delivery_date=gte." +
          encodeURIComponent(dubaiDay) +
          "&order=delivery_date.asc,created_at.asc";

        const ordersResponse =
          await supabaseRequest(
            ordersPath,
            {
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                Authorization:
                  "Bearer " +
                  auth.token
              }
            }
          );

        const orders =
          await ordersResponse.json().catch(function () {
            return [];
          });

        if (!ordersResponse.ok) {
          return json(
            {
              error:
                "تعذر تحميل الطلبات"
            },
            500
          );
        }

        // إظهار أرقام الهاتف للمندوب المصرح له فقط؛ لا نغيّر البيانات المخزنة في قاعدة البيانات.
        const canCall = auth.user.email === DRIVER_EMAILS.zain2;
        const safeOrders = (Array.isArray(orders) ? orders : []).map(function (row) {
          // علامة التعاقد الشهري كما في الملف الأصلي المرسل: لا نغيّر بيانات الفاتورة.
          const paymentText = String(row.payment_method || "").trim().toLowerCase();
          const monthlyContractDeferred =
            paymentText === "تعاقد شهري" ||
            paymentText === "monthly contract" ||
            row.monthly_contract_deferred === true ||
            row.monthly_contract_deferred === 1 ||
            row.is_monthly_contract === true ||
            row.is_monthly_contract === 1;
          const cleaned = Object.assign({}, row, {
            _delivery_locked: isFutureDeliveryDate(row.delivery_date, dubaiDay),
            plate_names: stripEmojiText(row.plate_names),
            plate_qtys: stripEmojiText(row.plate_qtys),
            chicken_weights: stripEmojiText(row.chicken_weights),
            chicken_qtys: stripEmojiText(row.chicken_qtys),
            customer_name: stripEmojiText(row.customer_name),
            monthly_contract_deferred: monthlyContractDeferred
          });
          if (canCall) return cleaned;
          return Object.assign({}, cleaned, { phone: "" });
        });
        if (safeOrders.length && env.SUPABASE_SERVICE_ROLE_KEY) {
          const ids = safeOrders.map(function (row) { return Number(row.id); }).filter(function (id) { return Number.isInteger(id) && id > 0; });
          if (ids.length) {
            const departureResponse = await supabaseRequest(
              "/rest/v1/driver_departures?order_id=in.(" + ids.join(",") + ")&select=order_id,departed_at",
              { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
            );
            const departureRows = await departureResponse.json().catch(function () { return []; });
            if (departureResponse.ok && Array.isArray(departureRows)) {
              const departureMap = new Map(departureRows.map(function (row) { return [Number(row.order_id), row.departed_at]; }));
              safeOrders.forEach(function (row) { row.driver_departure_at = departureMap.get(Number(row.id)) || null; });
            }
          }
        }

        /* ⭐ سد ثغرة الموقع الناقص: لو نسخة الفاتورة عند المندوب مفيهاش location_url
           (نسخة قديمة اتعملت قبل ما الموقع يتسجل، وإعادة المزامنة مش بتحدثها)،
           املأه تلقائيًا من أي نسخة تانية لنفس رقم الفاتورة عند المندوبين التانيين */
        if (safeOrders.length && env.SUPABASE_SERVICE_ROLE_KEY) {
          const locNumbers = Array.from(new Set(safeOrders.map(function (row) { return String(row.order_number || "").trim(); }).filter(Boolean)));
          if (locNumbers.length) {
            const locResponse = await supabaseRequest(
              "/rest/v1/orders?order_number=in.(" + locNumbers.map(function (v) { return encodeURIComponent(v); }).join(",") + ")&select=order_number,location_url",
              { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
            );
            const locRows = await locResponse.json().catch(function () { return []; });
            if (locResponse.ok && Array.isArray(locRows)) {
              const locMap = new Map();
              for (const r of locRows) {
                const u = String(r.location_url || "").trim();
                const k = String(r.order_number || "").trim();
                if (u && k && !locMap.has(k)) locMap.set(k, u);
              }
              for (const row of safeOrders) {
                const k = String(row.order_number || "").trim();
                if (k && !String(row.location_url || "").trim() && locMap.has(k)) row.location_url = locMap.get(k);
              }
            }
          }
        }

        // تحميل الترتيب المشترك باستخدام بصمة الفاتورة، وليس orders.id لأن لكل مندوب id مختلفاً.
        if (safeOrders.length && env.SUPABASE_SERVICE_ROLE_KEY) {
          const sortResponse = await supabaseRequest(
            "/rest/v1/driver_invoice_order_shared?select=invoice_key,sort_position",
            { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
          );
          const sortRows = await sortResponse.json().catch(function () { return []; });
          if (sortResponse.ok && Array.isArray(sortRows)) {
            const positionMap = new Map(sortRows.map(function (row) { return [String(row.invoice_key), Number(row.sort_position)]; }));
            for (const row of safeOrders) {
              const key = await makeSharedInvoiceKey(row);
              const position = positionMap.get(key);
              if (Number.isFinite(position) && position > 0) row._driver_sort_position = position;
            }
          }
        }

        return json({
          orders:
            safeOrders,
          sheet:
            sheet,
          mandoub_name:
            auth.driver.mandoub_name,
          can_call:
            canCall
        });
      }

      if (
        path === "/api/master/orders" &&
        request.method === "GET"
      ) {
        const auth =
          await requireMaster(
            request,
            env
          );

        if (auth.error) {
          return json(
            {
              error:
                auth.error
            },
            auth.status
          );
        }

        // قراءة مجزأة بمؤشر id لتجنب تجاوز حد CPU في Worker عند كبر الأرشيف.
        // كل استدعاء يعيد حتى 250 صفًا من كل جدول، والواجهة تطلب الدفعات التالية.
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        const masterReadHeaders = serviceKey
          ? { apikey: serviceKey, Authorization: "Bearer " + serviceKey }
          : { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + auth.token };
        const pageSize = 250;

        function readCursor(name) {
          const raw = url.searchParams.get(name);
          if (raw === null || raw === "") return 0;
          const value = Number(raw);
          return Number.isSafeInteger(value) && value >= 0 ? value : null;
        }

        const activeAfter = readCursor("active_after");
        const archiveAfter = readCursor("archive_after");
        if (activeAfter === null || archiveAfter === null) {
          return json({ error: "مؤشر تحميل الفواتير غير صالح." }, 400);
        }

        async function readMasterPage(tableName, afterId) {
          const query = "?select=*&id=gt." + afterId + "&order=id.asc&limit=" + pageSize;
          const response = await supabaseRequest("/rest/v1/" + tableName + query, {
            headers: masterReadHeaders
          });
          const rows = await response.json().catch(function () { return null; });
          if (!response.ok || !Array.isArray(rows)) {
            return {
              ok: false,
              status: response.status,
              error: rows && (rows.message || rows.details || rows.hint || rows.error)
                ? (rows.message || rows.details || rows.hint || rows.error)
                : "تعذر قراءة جدول " + tableName
            };
          }
          const last = rows.length ? Number(rows[rows.length - 1].id) : afterId;
          if (!Number.isSafeInteger(last) || last < afterId) {
            return { ok: false, status: 502, error: "تعذر متابعة قراءة جدول " + tableName + " بسبب مؤشر غير صالح." };
          }
          return { ok: true, rows: rows, next: last, hasMore: rows.length === pageSize };
        }

        const [activeResult, archiveResult] = await Promise.all([
          readMasterPage("orders", activeAfter),
          readMasterPage("master_orders_archive", archiveAfter)
        ]);

        if (!activeResult.ok || !archiveResult.ok) {
          return json({
            error: "تعذر تحميل دفعة فواتير الماستر.",
            orders_error: activeResult.ok ? null : activeResult.error,
            archive_error: archiveResult.ok ? null : archiveResult.error
          }, 502);
        }

        const activeRows = activeResult.rows.map(function (row) {
          return Object.assign({}, row, { _master_source: "orders" });
        });
        const archivedRows = archiveResult.rows.map(function (row) {
          return Object.assign({}, row, { _master_source: "master_orders_archive" });
        });

        return json({
          orders: activeRows.concat(archivedRows),
          active_count: activeRows.length,
          archived_count: archivedRows.length,
          next_active_after: activeResult.next,
          next_archive_after: archiveResult.next,
          has_more_active: activeResult.hasMore,
          has_more_archive: archiveResult.hasMore,
          username: MASTER_USERNAME,
          email: MASTER_EMAIL,
          role: "master_admin"
        });
      }

      if (
        path === "/api/master/customer-balances" &&
        request.method === "GET"
      ) {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        if (!env.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "إعداد عرض أرصدة العملاء غير مكتمل" }, 500);
        }
        const response = await supabaseRequest(
          "/rest/v1/customer_balances?select=customer_code,customer_name,phone,amount_added,amount_paid,current_balance,notes,area,emirate,order_ref,updated_at&order=customer_code.asc",
          {
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY
            }
          }
        );
        const balances = await response.json().catch(function () { return null; });
        if (!response.ok) {
          return json({ error: (balances && (balances.message || balances.hint || balances.error)) || "تعذر تحميل أرصدة العملاء" }, 502);
        }
        return json({ balances: Array.isArray(balances) ? balances : [] });
      }

      if (path === "/api/driver/heading-to-customer" && request.method === "POST") {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "إعداد إشعارات التحرك غير مكتمل: أضف SUPABASE_SERVICE_ROLE_KEY إلى أسرار Worker" }, 500);
        const body = await request.json().catch(function () { return {}; });
        const orderId = Number(body.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) return json({ error: "رقم الطلب غير صحيح" }, 400);

        const orderResponse = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(orderId) + "&sheet_name=eq." + encodeURIComponent(auth.driver.sheet_name) + "&select=id,order_number,customer_name,phone,emirate,area,total,sheet_name,delivery_date&limit=1",
          { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
        );
        const orderRows = await orderResponse.json().catch(function () { return null; });
        if (!orderResponse.ok) return json({ error: (orderRows && (orderRows.message || orderRows.hint || orderRows.error)) || "تعذر التحقق من الفاتورة" }, 502);
        if (!Array.isArray(orderRows) || !orderRows.length) return json({ error: "الفاتورة غير موجودة ضمن طلبات حسابك" }, 404);
        const order = orderRows[0];
        const futureLock = rejectFutureDelivery(order, dubaiDateKey(new Date()));
        if (futureLock) return futureLock;

        const existingResponse = await supabaseRequest(
          "/rest/v1/driver_departures?order_id=eq." + encodeURIComponent(orderId) + "&select=order_id,departed_at&limit=1",
          { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
        );
        const existingRows = await existingResponse.json().catch(function () { return null; });
        if (!existingResponse.ok) return json({ error: "تعذر قراءة سجل التحرك. تأكد من إنشاء جدول driver_departures من SQL المرفق." }, 502);
        if (Array.isArray(existingRows) && existingRows.length) return json({ success: true, already_marked: true, departed_at: existingRows[0].departed_at });

        const departedAt = new Date().toISOString();
        const insertResponse = await supabaseRequest("/rest/v1/driver_departures", {
          method: "POST",
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ order_id: order.id, invoice_number: String(order.order_number || order.id), customer_name: String(order.customer_name || ""), phone: String(order.phone || ""), emirate: String(order.emirate || ""), area: String(order.area || ""), total: Number(order.total) || 0, sheet_name: String(auth.driver.sheet_name || ""), driver_name: String(auth.driver.mandoub_name || ""), driver_user_id: auth.user.id, departed_at: departedAt })
        });
        const insertData = await insertResponse.json().catch(function () { return null; });
        if (!insertResponse.ok) {
          if (insertResponse.status === 409) {
            const retryResponse = await supabaseRequest("/rest/v1/driver_departures?order_id=eq." + encodeURIComponent(orderId) + "&select=departed_at&limit=1", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } });
            const retryRows = await retryResponse.json().catch(function () { return []; });
            if (Array.isArray(retryRows) && retryRows.length) return json({ success: true, already_marked: true, departed_at: retryRows[0].departed_at });
          }
          return json({ error: (insertData && (insertData.message || insertData.hint || insertData.error)) || "تعذر تسجيل التحرك" }, 502);
        }
        return json({ success: true, already_marked: false, departed_at: Array.isArray(insertData) && insertData[0] ? insertData[0].departed_at : departedAt });
      }

      if (path === "/api/master/driver-departures" && request.method === "GET") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "إعداد إشعارات التحرك غير مكتمل" }, 500);
        const response = await supabaseRequest("/rest/v1/driver_departures?select=*&order=departed_at.desc&limit=100", {
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }
        });
        const rows = await response.json().catch(function () { return null; });
        if (!response.ok) return json({ error: (rows && (rows.message || rows.hint || rows.error)) || "تعذر تحميل إشعارات التحرك" }, 502);
        return json({ departures: Array.isArray(rows) ? rows : [] });
      }

      if (
        path === "/api/payment" &&
        request.method === "POST"
      ) {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);

        const body = await request.json().catch(function () { return {}; });
        const orderId = Number(body.orderId);
        const paymentMethod = normalizePayment(body.payment_method);

        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json({ error: "رقم الطلب غير صحيح" }, 400);
        }
        if (!paymentMethod) {
          return json({ error: "طريقة الدفع غير صحيحة" }, 400);
        }

        // لا نستخدم مفتاحاً سرياً داخل الكود؛ نقرأه من إعدادات Cloudflare.
        const paymentServiceKey = String(
          env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ""
        ).trim();
        if (!paymentServiceKey) {
          return json({ error: "إعداد مزامنة الدفع غير مكتمل: أضف SUPABASE_SECRET_KEY في أسرار Worker" }, 500);
        }

        const paymentHeaders = { apikey: paymentServiceKey };
        // مفاتيح sb_secret_ ليست JWT، أما service_role القديم فهو JWT.
        if (!paymentServiceKey.startsWith("sb_secret_")) {
          paymentHeaders.Authorization = "Bearer " + paymentServiceKey;
        }

        // تحقق أن الفاتورة تخص المندوب الحالي قبل تحديث أي نسخة أخرى.
        const sourceResponse = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(orderId) +
          "&sheet_name=eq." + encodeURIComponent(auth.driver.sheet_name) +
          "&select=id,order_number,customer_name,sheet_name,paid_in_advance,delivery_status,delivery_date&limit=1",
          { headers: paymentHeaders }
        );
        const sourceRows = await sourceResponse.json().catch(function () { return null; });
        if (!sourceResponse.ok) {
          return json({ error: (sourceRows && (sourceRows.message || sourceRows.hint || sourceRows.error)) || "تعذر التحقق من الفاتورة قبل مزامنة الدفع" }, 502);
        }
        if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
          return json({ error: "الفاتورة غير موجودة ضمن طلبات حسابك" }, 404);
        }

        const sourceOrder = sourceRows[0];
        const futurePaymentLock = rejectFutureDelivery(sourceOrder, dubaiDateKey(new Date()));
        if (futurePaymentLock) return futurePaymentLock;
        if (sourceOrder.paid_in_advance === true) {
          return json({ error: "هذه الفاتورة مدفوعة مقدمًا، وتعديل الدفع من الكمبيوتر فقط" }, 403);
        }
        if (String(sourceOrder.delivery_status || "").toLowerCase() === "delivered" || String(sourceOrder.delivery_status || "").includes("تم التسليم")) {
          return json({ error: "لا يمكن تغيير طريقة الدفع بعد التسليم" }, 409);
        }
        const invoiceNumber = String(sourceOrder.order_number || "").trim();
        if (!invoiceNumber) {
          return json({ error: "الفاتورة لا تحتوي على رقم فاتورة يمكن مزامنته" }, 400);
        }

        // حدّث طريقة الدفع فقط في جميع نسخ الفاتورة لدى المناديب.
        const duplicatesResponse = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(invoiceNumber) + "&select=id",
          { headers: paymentHeaders }
        );
        const duplicateRows = await duplicatesResponse.json().catch(function () { return null; });
        if (!duplicatesResponse.ok || !Array.isArray(duplicateRows) || duplicateRows.length === 0) {
          return json({ error: (duplicateRows && (duplicateRows.message || duplicateRows.hint || duplicateRows.error)) || "تعذر العثور على نسخ الفاتورة لمزامنة الدفع" }, 502);
        }

        const updateOrdersResponse = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, paymentHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=representation"
            }),
            body: JSON.stringify({ payment_method: paymentMethod })
          }
        );
        const updatedOrders = await updateOrdersResponse.json().catch(function () { return null; });
        if (!updateOrdersResponse.ok) {
          return json({ error: (updatedOrders && (updatedOrders.message || updatedOrders.hint || updatedOrders.error)) || "تعذر تحديث طريقة الدفع عند المناديب" }, 502);
        }

        // حدّث نسخة الماستر/الأرشيف أيضاً، مع لمس عمود طريقة الدفع فقط.
        const archiveResponse = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, paymentHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=representation"
            }),
            body: JSON.stringify({ payment_method: paymentMethod })
          }
        );
        const archiveData = await archiveResponse.json().catch(function () { return null; });
        if (!archiveResponse.ok) {
          return json({ error: (archiveData && (archiveData.message || archiveData.hint || archiveData.error)) || "تم تحديث المناديب لكن تعذر تحديث طريقة الدفع في الماستر" }, 502);
        }

        return json({
          success: true,
          payment_method: paymentMethod,
          payment_label: paymentLabel(paymentMethod),
          synced_orders: Array.isArray(updatedOrders) ? updatedOrders.length : duplicateRows.length,
          synced_master: Array.isArray(archiveData) ? archiveData.length : 0
        });
      }

      if (
        path === "/api/deliver" &&
        request.method === "POST"
      ) {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);

        const body = await request.json().catch(function () { return {}; });
        const orderId = Number(body.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json({ error: "رقم الطلب غير صحيح" }, 400);
        }

        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "إعداد طلبات التسليم غير مكتمل: أضف SUPABASE_SECRET_KEY أو SUPABASE_SERVICE_ROLE_KEY" }, 500);
        const serviceHeaders = { apikey: serviceKey };
        if (!serviceKey.startsWith("sb_secret_")) serviceHeaders.Authorization = "Bearer " + serviceKey;

        // تأكد أن الفاتورة تخص هذا المندوب، ولا تغيّر حالة الفاتورة هنا.
        const orderResponse = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(orderId) +
          "&sheet_name=eq." + encodeURIComponent(auth.driver.sheet_name) +
          "&select=id,order_number,customer_name,sheet_name,delivery_status,paid_in_advance,delivery_date&limit=1",
          { headers: serviceHeaders }
        );
        const orderRows = await orderResponse.json().catch(function () { return null; });
        if (!orderResponse.ok) return json({ error: (orderRows && (orderRows.message || orderRows.hint || orderRows.error)) || "تعذر التحقق من الفاتورة" }, 502);
        if (!Array.isArray(orderRows) || !orderRows.length) return json({ error: "الفاتورة غير موجودة ضمن طلبات حسابك" }, 404);
        const order = orderRows[0];
        const futureDeliveryLock = rejectFutureDelivery(order, dubaiDateKey(new Date()));
        if (futureDeliveryLock) return futureDeliveryLock;
        // الدفع مقدمًا لا يمنع التسليم؛ الكمبيوتر يحدد حالة الدفع فقط.
        if (String(order.delivery_status || "").toLowerCase() === "delivered" || String(order.delivery_status || "").includes("تم التسليم")) {
          return json({ success: true, already_delivered: true, delivery_status: order.delivery_status });
        }

        const requestedAt = new Date().toISOString();
        const requestResponse = await supabaseRequest(
          "/rest/v1/driver_delivery_requests?on_conflict=order_id",
          {
            method: "POST",
            headers: Object.assign({}, serviceHeaders, {
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=representation"
            }),
            body: JSON.stringify({
              order_id: order.id,
              invoice_number: String(order.order_number || order.id),
              sheet_name: String(auth.driver.sheet_name || ""),
              driver_user_id: auth.user.id,
              driver_name: String(auth.driver.mandoub_name || ""),
              status: "pending",
              requested_at: requestedAt
            })
          }
        );
        const requestData = await requestResponse.json().catch(function () { return null; });
        if (!requestResponse.ok) {
          return json({ error: (requestData && (requestData.message || requestData.hint || requestData.error)) || "تعذر إرسال طلب التسليم. تأكد من إنشاء جدول driver_delivery_requests" }, 502);
        }
        return json({ success: true, delivery_requested: true, delivery_status: "pending", requested_at: requestedAt });
      }

      if (
        path === "/api/master/order/update" &&
        request.method === "POST"
      ) {
        const auth =
          await requireMaster(
            request,
            env
          );

        if (auth.error) {
          return json(
            {
              error:
                auth.error
            },
            auth.status
          );
        }

        const body =
          await request.json().catch(function () {
            return {};
          });

        const orderId =
          Number(body.orderId);

        const order =
          body.order;

        if (
          !Number.isInteger(orderId) ||
          orderId <= 0
        ) {
          return json(
            {
              error:
                "رقم الفاتورة غير صحيح"
            },
            400
          );
        }

        if (
          !order ||
          typeof order !== "object"
        ) {
          return json(
            {
              error:
                "بيانات الفاتورة غير صحيحة"
            },
            400
          );
        }

        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/master_update_order",
            {
              method: "POST",
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                Authorization:
                  "Bearer " +
                  auth.token,
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  p_order_id:
                    orderId,
                  p_order:
                    order
                })
            }
          );

        let rpcData =
          await rpcResponse.json().catch(function () {
            return null;
          });

        if (!rpcResponse.ok) {
          /* ⭐ بديل: لو نسخة المناديب محذوفة (مثلًا بحذف يدوي SQL) أو RPC رفض الصف،
             حدّث أرشيف الماستر مباشرة بمفتاح الخدمة — تعديل الماستر ميستحالش أبدًا
             بسبب نسخة ناقصة عند مندوب */
          const svcKeyFb =
            String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
          let fallbackRow = null;
          if (svcKeyFb) {
            const directPatch =
              Object.assign({}, order);
            delete directPatch.id;
            directPatch.updated_at =
              new Date().toISOString();
            const archResp =
              await supabaseRequest(
                "/rest/v1/master_orders_archive?id=eq." +
                  encodeURIComponent(orderId),
                {
                  method: "PATCH",
                  headers: {
                    apikey: svcKeyFb,
                    Authorization:
                      "Bearer " + svcKeyFb,
                    "Content-Type":
                      "application/json",
                    Prefer:
                      "return=representation"
                  },
                  body:
                    JSON.stringify(directPatch)
                }
              );
            const archRows =
              await archResp.json().catch(function () {
                return null;
              });
            if (
              archResp.ok &&
              Array.isArray(archRows) &&
              archRows.length
            ) {
              fallbackRow = archRows[0];
            }
            /* ⭐ المحاولة التانية: الـ ID قديم واتبنى صف جديد برقم جديد بعد
               إعادة الرفع — نطابق بالرقم والشيت ونحدّث مهما كان الـ ID */
            if (!fallbackRow) {
              const fbOrdNo =
                String(order.order_number || "").trim();
              const fbSheet =
                String(order.sheet_name || "").trim();
              if (fbOrdNo && fbSheet) {
                const archResp2 =
                  await supabaseRequest(
                    "/rest/v1/master_orders_archive?order_number=eq." +
                      encodeURIComponent(fbOrdNo) +
                      "&sheet_name=eq." +
                      encodeURIComponent(fbSheet),
                    {
                      method: "PATCH",
                      headers: {
                        apikey: svcKeyFb,
                        Authorization:
                          "Bearer " + svcKeyFb,
                        "Content-Type":
                          "application/json",
                        Prefer:
                          "return=representation"
                      },
                      body:
                        JSON.stringify(directPatch)
                    }
                  );
                const archRows2 =
                  await archResp2.json().catch(function () {
                    return null;
                  });
                if (
                  archResp2.ok &&
                  Array.isArray(archRows2) &&
                  archRows2.length
                ) {
                  fallbackRow = archRows2[0];
                }
              }
            }
          }
          if (fallbackRow) {
            rpcData = fallbackRow;
          } else {
          return json(
            {
              error:
                [
                  rpcData && rpcData.message,
                  rpcData && rpcData.details,
                  rpcData && rpcData.hint,
                  rpcData && rpcData.code ? "Code: " + rpcData.code : null,
                  rpcData && rpcData.error
                ].filter(Boolean).join(" | ") || "تعذر تعديل الفاتورة"
            },
            400
          );
          }
        }
        // مزامنة صريحة لطريقة الدفع على كل نسخ هذه الفاتورة المحددة بالمعرّفات.
        // لا نعتمد هنا على تطابق رقم الفاتورة وحده، حتى لا نمس فاتورة أخرى قد تحمل رقمًا مشابهًا.
        if (Object.prototype.hasOwnProperty.call(order, "payment_method")) {
          // لوحة MASTER تسمح بترك طريقة الدفع غير محددة حتى يختارها المندوب.
          // نخزنها كـ null، بينما يظل مسار المندوب /api/payment يقبل كاش أو تحويل فقط.
          const rawPaymentMethod = order.payment_method;
          const rawPaymentText = String(rawPaymentMethod == null ? "" : rawPaymentMethod).trim().toLowerCase();
          const isUnselectedPayment =
            rawPaymentMethod == null ||
            rawPaymentText === "" ||
            rawPaymentText === "غير محدد" ||
            rawPaymentText === "غير محددة" ||
            rawPaymentText === "unselected" ||
            rawPaymentText === "not_set";
          const paymentMethod = isUnselectedPayment ? null : normalizePayment(rawPaymentMethod);
          if (!isUnselectedPayment && !paymentMethod) {
            return json({ error: "طريقة الدفع غير صحيحة. القيم المقبولة: غير محدد أو كاش أو تحويل بنكي." }, 400);
          }
          const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
          if (!serviceKey) {
            return json({ error: "إعداد مزامنة طريقة الدفع غير مكتمل: SUPABASE_SERVICE_ROLE_KEY" }, 500);
          }
          const rawIds = Array.isArray(body.invoiceCopyIds) ? body.invoiceCopyIds : [orderId];
          const copyIds = Array.from(new Set(rawIds.concat([orderId]).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
          if (!copyIds.length || copyIds.length > 20) {
            return json({ error: "تعذر تحديد نسخ الفاتورة المراد تحديثها" }, 400);
          }
          const serviceHeaders = {
            apikey: serviceKey,
            Authorization: "Bearer " + serviceKey,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          };
          const paymentPatch = {
            payment_method: paymentMethod,
            bank_transfer_received: paymentMethod === "bank_transfer" ? (order.bank_transfer_received === true) : false
          };
          // تاريخ الطلب جزء من بيانات الفاتورة ويجب أن يتزامن مع كل نسخة لدى المندوبين.
          if (typeof order.created_at === "string" && !Number.isNaN(new Date(order.created_at).getTime())) {
            paymentPatch.created_at = new Date(order.created_at).toISOString();
          }
          paymentPatch.updated_at = new Date().toISOString();
          const paymentBody = JSON.stringify(paymentPatch);
          const idFilter = "in.(" + copyIds.join(",") + ")";
          const ordersPaymentResponse = await supabaseRequest(
            "/rest/v1/orders?id=" + encodeURIComponent(idFilter),
            { method: "PATCH", headers: serviceHeaders, body: paymentBody }
          );
          if (!ordersPaymentResponse.ok) {
            const paymentError = await ordersPaymentResponse.json().catch(function () { return null; });
            return json({ error: (paymentError && (paymentError.message || paymentError.hint || paymentError.error)) || "تعذر تحديث طريقة الدفع في نسخ المندوبين" }, 502);
          }
          const archivePaymentResponse = await supabaseRequest(
            "/rest/v1/master_orders_archive?id=" + encodeURIComponent(idFilter),
            { method: "PATCH", headers: serviceHeaders, body: paymentBody }
          );
          if (!archivePaymentResponse.ok) {
            const paymentError = await archivePaymentResponse.json().catch(function () { return null; });
            return json({ error: (paymentError && (paymentError.message || paymentError.hint || paymentError.error)) || "تم تحديث المندوبين لكن تعذر تحديث أرشيف الماستر" }, 502);
          }
        }

        // حدّث نسخة أرشيف الماستر أيضًا؛ واجهة MASTER تقرأ الفواتير من هذا الأرشيف.
        // بدون هذه الخطوة قد تظهر القيم القديمة مرة أخرى بعد إعادة فتح الفاتورة.
        const invoiceNumber = String(
          (rpcData && (rpcData.order_number || rpcData.invoice_number)) ||
          order.order_number ||
          order.invoice_number ||
          ""
        ).trim();

        if (invoiceNumber) {
          const archivePatchBody = {};
          const archiveFields = [
            "customer_name",
            "phone",
            "emirate",
            "area",
            "chicken_weights",
            "chicken_qtys",
            "plate_names",
            "plate_qtys",
            "total",
            "location_url",
            "note",
            "appointment_coordinator",
            "payment_method",
            "delivery_status",
            "gate_photo_url",
            "gate_photo_urls",
            "driver_notes",
            "delivery_fee",
            "paid_in_advance",
            "bank_transfer_received",
            "created_at",
            "delivery_date"
          ];

          for (const field of archiveFields) {
            if (rpcData && Object.prototype.hasOwnProperty.call(rpcData, field)) {
              archivePatchBody[field] = rpcData[field];
            }
          }

          archivePatchBody.updated_at = new Date().toISOString();
          // تاريخ الطلب الذي اختاره المستخدم في لوحة MASTER له الأولوية على
          // أي تاريخ قديم يعيده RPC، ويجب أن يظل متطابقًا في أرشيف MASTER.
          if (typeof order.created_at === "string" && !Number.isNaN(new Date(order.created_at).getTime())) {
            archivePatchBody.created_at = new Date(order.created_at).toISOString();
          }
          // تاريخ التوصيل الذي اختاره الكمبيوتر له الأولوية، ولا نخلطه بتاريخ الرفع.
          if (Object.prototype.hasOwnProperty.call(order, "delivery_date")) {
            const deliveryDate = order.delivery_date == null ? null : String(order.delivery_date).trim();
            if (deliveryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
              return json({ error: "تاريخ التوصيل غير صحيح" }, 400);
            }
            archivePatchBody.delivery_date = deliveryDate;
          }

          // قيمة الدفع التي اختارها المستخدم في لوحة MASTER لها الأولوية على
          // القيمة القديمة التي قد يعيدها RPC؛ لا نسمح بإرجاع "كاش" بعد اختيار "غير محدد".
          if (Object.prototype.hasOwnProperty.call(order, "payment_method")) {
            const archiveRawPayment = order.payment_method;
            const archivePaymentText = String(archiveRawPayment == null ? "" : archiveRawPayment).trim().toLowerCase();
            const archivePaymentUnselected =
              archiveRawPayment == null ||
              archivePaymentText === "" ||
              archivePaymentText === "غير محدد" ||
              archivePaymentText === "غير محددة" ||
              archivePaymentText === "unselected" ||
              archivePaymentText === "not_set";
            archivePatchBody.payment_method = archivePaymentUnselected ? null : normalizePayment(archiveRawPayment);
            archivePatchBody.bank_transfer_received = archivePatchBody.payment_method === "bank_transfer"
              ? (order.bank_transfer_received === true)
              : false;
          }

          const archivePatchResponse = await supabaseRequest(
            "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(invoiceNumber),
            {
              method: "PATCH",
              headers: {
                apikey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
                Authorization: "Bearer " + (env.SUPABASE_SERVICE_ROLE_KEY || auth.token),
                "Content-Type": "application/json",
                Prefer: "return=minimal"
              },
              body: JSON.stringify(archivePatchBody)
            }
          );

          if (!archivePatchResponse.ok) {
            const archiveError = await archivePatchResponse.json().catch(function () { return null; });
            return json({
              error: (archiveError && (archiveError.message || archiveError.hint || archiveError.error)) ||
                "تم تعديل الطلب، لكن تعذر تحديث نسخة أرشيف الماستر"
            }, 502);
          }
        }

        return json({
          success: true,
          order: rpcData
        });
      }

      if (
        path === "/api/master/order/delete" &&
        request.method === "POST"
      ) {
        const auth =
          await requireMaster(
            request,
            env
          );

        if (auth.error) {
          return json(
            {
              error:
                auth.error
            },
            auth.status
          );
        }

        const body =
          await request.json().catch(function () {
            return {};
          });

        const orderId =
          Number(body.orderId);

        if (
          !Number.isInteger(orderId) ||
          orderId <= 0
        ) {
          return json(
            {
              error:
                "رقم الفاتورة غير صحيح"
            },
            400
          );
        }

        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/master_delete_order",
            {
              method: "POST",
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                Authorization:
                  "Bearer " +
                  auth.token,
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  p_order_id:
                    orderId
                })
            }
          );

        const rpcData =
          await rpcResponse.json().catch(function () {
            return null;
          });

        if (!rpcResponse.ok) {
          const archiveDeleteResponse =
            await supabaseRequest(
              "/rest/v1/master_orders_archive?id=eq." +
                encodeURIComponent(orderId),
              {
                method: "DELETE",
                headers: {
                  apikey:
                    env.SUPABASE_ANON_KEY,
                  Authorization:
                    "Bearer " +
                    auth.token,
                  Prefer:
                    "return=representation"
                }
              }
            );

          const archivedRows =
            await archiveDeleteResponse.json().catch(function () {
              return [];
            });

          if (
            archiveDeleteResponse.ok &&
            Array.isArray(archivedRows) &&
            archivedRows.length > 0
          ) {
            return json({
              success: true,
              data: archivedRows[0],
              archived_only: true
            });
          }

          return json(
            {
              error:
                (rpcData &&
                  rpcData.message) ||
                (rpcData &&
                  rpcData.hint) ||
                (rpcData &&
                  rpcData.error) ||
                "تعذر حذف الفاتورة"
            },
            400
          );
        }

        const archiveDeleteResponse =
          await supabaseRequest(
            "/rest/v1/master_orders_archive?id=eq." +
              encodeURIComponent(orderId),
            {
              method: "DELETE",
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                Authorization:
                  "Bearer " +
                  auth.token,
                Prefer:
                  "return=representation"
              }
            }
          );

        if (!archiveDeleteResponse.ok) {
          const archiveError =
            await archiveDeleteResponse.json().catch(function () {
              return null;
            });

          return json(
            {
              error:
                (archiveError &&
                  (archiveError.message ||
                    archiveError.hint ||
                    archiveError.error)) ||
                "تم حذف الفاتورة من الطلبات لكن تعذر حذف نسخة الأرشيف"
            },
            500
          );
        }

        return json({
          success:
            true,
          data:
            rpcData
        });
      }

      if (
        path === "/api/master/transfer-received" &&
        request.method === "POST"
      ) {
        const auth = await requireMaster(request, env);

        if (auth.error) {
          return json({ error: auth.error }, auth.status);
        }

        const body = await request.json().catch(function () {
          return {};
        });

        const orderId = Number(body.orderId);
        const received = body.received === true;

        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        }

        const rpcResponse = await supabaseRequest(
          "/rest/v1/rpc/master_set_transfer_received",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + auth.token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              p_order_id: orderId,
              p_received: received
            })
          }
        );

        const rpcData = await rpcResponse.json().catch(function () {
          return null;
        });

        if (!rpcResponse.ok) {
          return json({
            error:
              (rpcData && rpcData.message) ||
              (rpcData && rpcData.hint) ||
              (rpcData && rpcData.error) ||
              "تعذر حفظ تأكيد استلام التحويل"
          }, 400);
        }

        return json({
          success: true,
          order: rpcData,
          bank_transfer_received: received
        });
      }

      if (
        path === "/api/gate-photo/delete" &&
        request.method === "POST"
      ) {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "غير مصرح" }, 401);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) {
          return json({ error: "إعداد حذف الصور غير مكتمل: أضف SUPABASE_SERVICE_ROLE_KEY إلى أسرار Worker" }, 500);
        }

        const body = await request.json().catch(function () { return {}; });
        const invoiceNumber = String(body.invoice_number || "").trim();
        if (!invoiceNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(invoiceNumber)) {
          return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        }
        if (body.confirm_delete !== true) {
          return json({ error: "يجب تأكيد حذف صورة البوابة بإرسال confirm_delete: true" }, 400);
        }

        const authHeaders = {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey
        };
        const queryPath = "/rest/v1/orders?order_number=eq." +
          encodeURIComponent(invoiceNumber) +
          "&select=id,order_number,gate_photo_url,gate_photo_urls";
        const ordersResponse = await supabaseRequest(queryPath, { headers: authHeaders });
        const ordersData = await ordersResponse.json().catch(function () { return null; });
        if (!ordersResponse.ok || !Array.isArray(ordersData)) {
          return json({
            error: (ordersData && (ordersData.message || ordersData.hint || ordersData.error)) || "تعذر قراءة صور الفاتورة من قاعدة البيانات"
          }, 502);
        }
        if (ordersData.length === 0) {
          return json({ error: "الفاتورة غير موجودة في جدول الطلبات؛ لم يتم حذف أي ملف" }, 404);
        }

        const bucketName = "gate-photos 3";
        const bucketMarker = "/storage/v1/object/public/" + encodeURIComponent(bucketName) + "/";
        const prefixes = [];
        const addPhotoPath = function (photoUrl) {
          const value = String(photoUrl || "").trim();
          const markerIndex = value.indexOf(bucketMarker);
          if (markerIndex < 0) return;
          const pathPart = value.slice(markerIndex + bucketMarker.length).split("?")[0];
          let decodedPath;
          try {
            decodedPath = pathPart.split("/").map(function (part) { return decodeURIComponent(part); }).join("/");
          } catch (_) {
            return;
          }
          if (decodedPath.startsWith("invoices/") && !decodedPath.includes("..")) {
            if (!prefixes.includes(decodedPath)) prefixes.push(decodedPath);
          }
        };

        for (const row of ordersData) {
          addPhotoPath(row.gate_photo_url);
          let photos = row.gate_photo_urls;
          if (typeof photos === "string") {
            try { photos = JSON.parse(photos); } catch (_) { photos = []; }
          }
          if (Array.isArray(photos)) {
            for (const photo of photos) {
              addPhotoPath(typeof photo === "string" ? photo : (photo && (photo.url || photo.gate_photo_url)) || "");
            }
          }
        }

        if (prefixes.length > 0) {
          const encodedBucket = encodeURIComponent(bucketName);
          const deleteResponse = await supabaseRequest(
            "/storage/v1/object/" + encodedBucket,
            {
              method: "DELETE",
              headers: Object.assign({}, authHeaders, {
                "Content-Type": "application/json"
              }),
              body: JSON.stringify({ prefixes: prefixes })
            }
          );
          const deleteData = await deleteResponse.json().catch(function () { return null; });
          if (!deleteResponse.ok) {
            return json({
              error: (deleteData && (deleteData.message || deleteData.error)) || "تعذر حذف الصور من التخزين السحابي؛ لم يتم مسح روابطها من قاعدة البيانات",
              photo_count: prefixes.length
            }, 502);
          }
        }

        const patchResponse = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, authHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=representation"
            }),
            body: JSON.stringify({ gate_photo_url: null, gate_photo_urls: [] })
          }
        );
        const patchData = await patchResponse.json().catch(function () { return null; });
        if (!patchResponse.ok) {
          return json({
            error: (patchData && (patchData.message || patchData.hint || patchData.error)) || "تم طلب حذف الصور من التخزين، لكن تعذر مسح روابطها من جدول الطلبات",
            photos_deleted: prefixes.length
          }, 502);
        }

        const archiveResponse = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, authHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=minimal"
            }),
            body: JSON.stringify({ gate_photo_url: null, gate_photo_urls: [] })
          }
        );
        if (!archiveResponse.ok && archiveResponse.status !== 404) {
          return json({
            error: "تم تحديث الطلبات، لكن تعذر مسح رابط الصورة من أرشيف الماستر",
            photos_deleted: prefixes.length
          }, 502);
        }

        return json({
          success: true,
          invoice_number: invoiceNumber,
          photos_deleted: prefixes.length,
          message: "تم حذف روابط صور البوابة من الطلبات والأرشيف"
        });
      }

      if (
        path === "/api/gate-photo" &&
        request.method === "POST"
      ) {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "غير مصرح" }, 401);
        }
        if (!env.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "إعداد رفع الصور غير مكتمل" }, 500);
        }

        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.toLowerCase().includes("multipart/form-data")) {
          return json({ error: "يجب إرسال الصور بصيغة multipart/form-data" }, 400);
        }

        const form = await request.formData().catch(function () { return null; });
        if (!form) {
          return json({ error: "تعذر قراءة بيانات الصور" }, 400);
        }

        const invoiceNumber = String(form.get("invoice_number") || "").trim();
        if (!invoiceNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(invoiceNumber)) {
          return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        }

        // يدعم الملف القديم (file) وكذلك عدة ملفات تحت file أو files أو photo.
        const submittedFiles = [];
        for (const fieldName of ["file", "files", "photo", "photos"]) {
          for (const item of form.getAll(fieldName)) {
            if (item && typeof item.arrayBuffer === "function" && Number(item.size) >= 0) {
              submittedFiles.push(item);
            }
          }
        }
        // يدعم كذلك أسماء حقول مرقمة مثل photo_1 وphoto_2.
        for (const [fieldName, item] of form.entries()) {
          if (/^(file|photo|image)[_-]?\d+$/i.test(fieldName) && item && typeof item.arrayBuffer === "function" && Number(item.size) >= 0) {
            submittedFiles.push(item);
          }
        }

        const files = submittedFiles.filter((item, index, all) => all.indexOf(item) === index);
        if (!files.length) {
          return json({ error: "لم يتم اختيار أي صورة" }, 400);
        }
        if (files.length > 10) {
          return json({ error: "الحد الأقصى 10 صور في الطلب الواحد" }, 400);
        }

        const allowedTypes = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp"
        };
        const bucketName = "gate-photos 3";
        const uploadedUrls = [];
        const requestedIndex = String(form.get("photo_index") || form.get("image_index") || "").trim();

        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const mimeType = String(file.type || "").toLowerCase();
          if (!allowedTypes[mimeType]) {
            return json({ error: "الصيغ المسموحة: JPG وPNG وWEBP" }, 400);
          }
          if (file.size > 8 * 1024 * 1024) {
            return json({ error: "حجم كل صورة يجب ألا يتجاوز 8 ميجابايت" }, 400);
          }

          let objectName;
          if (files.length > 1) {
            objectName = invoiceNumber + "-photo-" + (i + 1) + "." + allowedTypes[mimeType];
          } else if (requestedIndex && /^\d{1,3}$/.test(requestedIndex)) {
            objectName = invoiceNumber + "-photo-" + requestedIndex + "." + allowedTypes[mimeType];
          } else {
            // الحفاظ على مسار الصور القديمة عند استخدام واجهة الرفع القديمة.
            objectName = invoiceNumber + "." + allowedTypes[mimeType];
          }

          const objectPath = "invoices/" + objectName;
          const storagePath = "/storage/v1/object/" + encodeURIComponent(bucketName) + "/" + objectPath.split("/").map(encodeURIComponent).join("/");
          const uploadResponse = await supabaseRequest(storagePath, {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": mimeType,
              "x-upsert": "true",
              "Cache-Control": "3600"
            },
            body: await file.arrayBuffer()
          });

          const uploadData = await uploadResponse.json().catch(function () { return null; });
          if (!uploadResponse.ok) {
            return json({
              error: (uploadData && (uploadData.message || uploadData.error)) || "فشل رفع الصورة رقم " + (i + 1),
              uploaded_count: uploadedUrls.length,
              gate_photo_urls: uploadedUrls
            }, 502);
          }

          const publicUrl = SUPABASE_URL + "/storage/v1/object/public/" + encodeURIComponent(bucketName) + "/" + objectPath.split("/").map(encodeURIComponent).join("/");
          uploadedUrls.push(publicUrl);
        }

        return json({
          success: true,
          invoice_number: invoiceNumber,
          gate_photo_urls: uploadedUrls,
          gate_photo_url: uploadedUrls[0],
          uploaded_count: uploadedUrls.length
        });
      }

      if (
        path === "/api/customer-balances-sync" &&
        request.method === "POST"
      ) {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";

        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "غير مصرح" }, 401);
        }

        if (!env.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "إعداد مزامنة أرصدة العملاء غير مكتمل: SUPABASE_SERVICE_ROLE_KEY" }, 500);
        }

        const body = await request.json().catch(function () { return null; });
        const inputRows = Array.isArray(body)
          ? body
          : (body && Array.isArray(body.balances) ? body.balances : []);

        if (!Array.isArray(inputRows)) {
          return json({ error: "بيانات الأرصدة غير صحيحة" }, 400);
        }

        const balances = [];
        for (const row of inputRows) {
          if (!row || typeof row !== "object") continue;

          const customerCode = String(row.customer_code || "").trim();
          if (!customerCode) continue;

          const amountAdded = Number(row.amount_added || 0);
          const amountPaid = Number(row.amount_paid || 0);
          if (!Number.isFinite(amountAdded) || !Number.isFinite(amountPaid)) {
            return json({ error: "يوجد مبلغ غير صحيح للعميل " + customerCode }, 400);
          }

          balances.push({
            customer_code: customerCode,
            customer_name: String(row.customer_name || "").trim(),
            phone: String(row.phone || "").trim(),
            amount_added: amountAdded,
            amount_paid: amountPaid,
            notes: String(row.notes || "").trim(),
            area: String(row.area || "").trim(),
            emirate: String(row.emirate || "").trim(),
            order_ref: String(row.order_ref || "").trim(),
            updated_at: new Date().toISOString()
          });
        }

        if (balances.length === 0) {
          return json({ success: true, synced: 0, message: "لا توجد أرصدة لها أكواد عملاء" });
        }

        const balanceResponse = await supabaseRequest(
          "/rest/v1/customer_balances?on_conflict=customer_code",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=representation"
            },
            body: JSON.stringify(balances)
          }
        );

        const balanceData = await balanceResponse.json().catch(function () { return null; });
        if (!balanceResponse.ok) {
          return json({
            error: (balanceData && (balanceData.message || balanceData.hint || balanceData.error)) || "فشلت مزامنة أرصدة العملاء"
          }, 502);
        }

        return json({ success: true, synced: balances.length, data: balanceData });
      }

      // قراءة أرقام مراجعة الفواتير قبل المزامنة؛ قراءة فقط ولا تعدّل أي سجل.
      if (path === "/api/excel-sync-revisions" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ success: false, error: "غير مصرح" }, 401);
        }

        const rawNumbers = String(url.searchParams.get("numbers") || "");
        const numbers = Array.from(new Set(rawNumbers.split(",")
          .map(function (value) { return value.trim().toUpperCase(); })
          .filter(function (value) { return /^[A-Z0-9_-]{1,80}$/.test(value); })));

        if (!numbers.length) return json({ success: true, rows: [] });
        if (numbers.length > 80) {
          return json({ success: false, error: "الحد الأقصى 80 رقم فاتورة في الطلب" }, 400);
        }

        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) {
          return json({ success: false, error: "مفتاح خدمة قاعدة البيانات غير مضبوط في Worker" }, 500);
        }

        const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
        const inFilter = "(" + numbers.join(",") + ")";
        const tables = ["orders", "master_orders_archive"];
        const revisions = new Map();

        for (const table of tables) {
          const response = await supabaseRequest(
            "/rest/v1/" + table + "?select=order_number,sync_revision&order_number=in." + encodeURIComponent(inFilter),
            { headers: headers }
          );
          const rows = await response.json().catch(function () { return null; });
          if (!response.ok || !Array.isArray(rows)) {
            return json({
              success: false,
              error: (rows && (rows.message || rows.hint || rows.error)) || "تعذر قراءة أرقام المراجعة من " + table
            }, 502);
          }
          rows.forEach(function (row) {
            const key = String(row && row.order_number || "").trim().toUpperCase();
            if (!key) return;
            const revision = Math.max(0, Number(row.sync_revision) || 0);
            revisions.set(key, Math.max(revisions.get(key) || 0, revision));
          });
        }

        return json({
          success: true,
          rows: Array.from(revisions.entries()).map(function (entry) {
            return { order_number: entry[0], sync_revision: entry[1] };
          })
        });
      }

      if (
        path === "/api/excel-sync" &&
        request.method === "POST"
      ) {
        const secret =
          request.headers.get(
            "X-Excel-Sync-Secret"
          ) || "";

        if (
          secret !==
          env.EXCEL_SYNC_SECRET
        ) {
          return json(
            {
              error:
                "غير مصرح"
            },
            401
          );
        }

        const body =
          await request.json().catch(function () {
            return null;
          });

        if (!body) {
          return json(
            {
              error:
                "بيانات غير صحيحة"
            },
            400
          );
        }

        const orders =
          Array.isArray(body)
            ? body
            : Array.isArray(body.orders)
              ? body.orders
              : [];

        // منع أي مزامنة قديمة من إعادة نشر فاتورة مسحوبة؛ يلزم أمر رفع صريح من الكمبيوتر.
        const serviceKeyForWithdrawals = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKeyForWithdrawals) return json({ error: "تعذر التحقق من سجل سحب الفواتير؛ أوقفنا الرفع لحماية البيانات" }, 500);
        const withdrawalHeaders = { apikey: serviceKeyForWithdrawals, Authorization: "Bearer " + serviceKeyForWithdrawals };
        const incomingReleaseOrders = orders.filter(function (o) {
          return o && o._fa_explicit_release === true &&
            /^[a-zA-Z0-9_-]{1,80}$/.test(String(o.order_number || "")) &&
            /^\d{4}-\d{2}-\d{2}$/.test(String(o.delivery_date || "").slice(0, 10));
        });
        const incomingNumbers = Array.from(new Set(orders.map(function (o) {
          return String(o && o.order_number || "").trim();
        }).filter(function (n) { return /^[a-zA-Z0-9_-]{1,80}$/.test(n); })));
        const blockedWithdrawals = [];
        if (incomingNumbers.length) {
          const wr = await supabaseRequest(
            "/rest/v1/faruj_future_invoice_withdrawals?order_number=in.(" +
              incomingNumbers.map(encodeURIComponent).join(",") +
              ")&select=order_number,delivery_date,status,release_revision",
            { headers: withdrawalHeaders }
          );
          const withdrawalRows = await wr.json().catch(function () { return null; });
          if (!wr.ok || !Array.isArray(withdrawalRows)) {
            return json({ error: "تعذر قراءة سجل السحب؛ لم يتم رفع أي فاتورة", detail: withdrawalRows }, 502);
          }
          const explicitMap = new Map(incomingReleaseOrders.map(function (o) {
            return [String(o.order_number).trim().toUpperCase() + "|" + String(o.delivery_date).slice(0, 10), Number(o._fa_release_revision) || 0];
          }));
          for (const row of withdrawalRows) {
            const key = String(row.order_number || "").trim().toUpperCase() + "|" + String(row.delivery_date || "").slice(0, 10);
            const requestedRevision = explicitMap.get(key);
            if (row.status === "withdrawn" || row.status === "release_pending") {
              if (row.status !== "release_pending" || !requestedRevision || requestedRevision !== Number(row.release_revision)) {
                blockedWithdrawals.push({ order_number: row.order_number, delivery_date: row.delivery_date, status: row.status });
              }
            }
          }
        }
        if (blockedWithdrawals.length) {
          return json({
            error: "تم رفض الرفع لأن الفاتورة مسحوبة بأمر صريح. استخدم زر رفع شغل بكرة لإعادة نشرها.",
            code: "FUTURE_INVOICE_WITHDRAWN",
            blocked: blockedWithdrawals
          }, 409);
        }
        const rpcOrders = orders.map(function (order) {
          const copy = Object.assign({}, order);
          delete copy._fa_explicit_release;
          delete copy._fa_release_revision;
          return copy;
        });

        // لا نحذف صور التخزين قبل نجاح حفظ المزامنة؛ حتى لا يؤدي طلب قديم
        // أو فاشل إلى حذف صور فاتورة أحدث.
        const clearInvoices = Array.from(new Set(
          orders
            .filter(function (order) { return order && (order.clear_gate_photos === true || order.clear_gate_photos === 1 || String(order.clear_gate_photos).toLowerCase() === "true"); })
            .map(function (order) { return String(order.order_number || "").trim(); })
            .filter(function (number) { return /^[a-zA-Z0-9_-]{1,80}$/.test(number); })
        ));
        const deletedPhotoCounts = {};

        const releaseAuthorizations = Array.from(new Map(incomingReleaseOrders.map(function (o) {
          const key = String(o.order_number).trim().toUpperCase() + "|" + String(o.delivery_date).slice(0, 10);
          return [key, {
            order_number: String(o.order_number).trim(),
            delivery_date: String(o.delivery_date).slice(0, 10),
            release_revision: Number(o._fa_release_revision) || 0
          }];
        })).values());
        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/faruj_sync_orders_from_excel_guarded",
            {
              method: "POST",
              headers: Object.assign({}, withdrawalHeaders, { "Content-Type": "application/json" }),
              body:
                JSON.stringify({
                  p_orders: rpcOrders,
                  p_release_authorizations: releaseAuthorizations
                })
            }
          );

        const rpcData =
          await rpcResponse.json().catch(function () {
            return null;
          });

        if (!rpcResponse.ok) {
          return json(
            {
              error:
                (rpcData &&
                  rpcData.message) ||
                (rpcData &&
                  rpcData.hint) ||
                (rpcData &&
                  rpcData.error) ||
                "فشل مزامنة Excel"
            },
            500
          );
        }

        let skippedOldRevision = null;
        if (rpcData && typeof rpcData === "object") {
          const rpcResult = Array.isArray(rpcData) ? (rpcData[0] || {}) : rpcData;
          const rawSkipped = rpcResult.skipped_old_revision;
          if (rawSkipped !== undefined && rawSkipped !== null && Number.isFinite(Number(rawSkipped))) {
            skippedOldRevision = Number(rawSkipped);
          }
        }

        if (incomingReleaseOrders.length) {
          await broadcastOrdersChanged(env, "future_invoice_released");
        }

        let photosDeletionSkipped = false;
        if (clearInvoices.length && skippedOldRevision === 0) {
          try {
            for (const invoiceNumber of clearInvoices) {
              deletedPhotoCounts[invoiceNumber] = await clearGatePhotosForInvoice(invoiceNumber, env);
            }
          } catch (photoError) {
            // نجاح حفظ الفاتورة لا يُلغى بسبب فشل تنظيف ملفات الصور.
            photosDeletionSkipped = true;
          }
        } else if (clearInvoices.length) {
          photosDeletionSkipped = true;
        }

        return json({
          success: true,
          data: rpcData,
          gate_photos_cleared: skippedOldRevision === 0 ? clearInvoices.length : 0,
          gate_photo_files_deleted: deletedPhotoCounts,
          gate_photo_file_deletion_skipped: photosDeletionSkipped,
          skipped_old_revision: skippedOldRevision
        });
      }

      /* سحب حالة المندوب للكمبيوتر: حالة التسليم + طريقة الدفع المختارة من المندوب + تأكيد التحويل */
      if (path === "/api/excel-driver-status" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط في أسرار Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc };
        const r = await supabaseRequest(
          "/rest/v1/orders?select=order_number,sheet_name,payment_method,delivery_status,paid_in_advance,bank_transfer_received&order=order_number.asc",
          { headers: H }
        );
        const rows = await r.json().catch(function () { return null; });
        if (!r.ok || !Array.isArray(rows)) {
          return json({ error: (rows && (rows.message || rows.hint || rows.error)) || "تعذر سحب حالات المندوبين" }, 502);
        }
        return json({ orders: rows });
      }

      if (
        path === "/api/excel-status" &&
        request.method === "GET"
      ) {
        const secret =
          request.headers.get(
            "X-Excel-Sync-Secret"
          ) || "";

        if (
          secret !==
          env.EXCEL_SYNC_SECRET
        ) {
          return json(
            {
              error:
                "غير مصرح"
            },
            401
          );
        }

        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/get_order_delivery_statuses",
            {
              method: "POST",
              headers: {
                apikey:
                  env.SUPABASE_ANON_KEY,
                Authorization:
                  "Bearer " +
                  env.SUPABASE_ANON_KEY,
                "Content-Type":
                  "application/json"
              }
            }
          );

        const data =
          await rpcResponse.json().catch(function () {
            return null;
          });

        if (!rpcResponse.ok) {
          return json(
            {
              error:
                (data &&
                  data.message) ||
                (data &&
                  data.hint) ||
                (data &&
                  data.error) ||
                "تعذر قراءة حالات التسليم"
            },
            500
          );
        }

        // اجلب طلبات التسليم المعلقة من نفس الجدول الذي يكتب فيه /api/deliver.
        // الكمبيوتر يتوقعها في الخاصية delivery_requests.
        // استخدم مفتاح service_role أولاً حتى لا يحجب مفتاح anon/secret غير المناسب قراءة الطلبات.
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (!serviceKey) return json({ error: "مفتاح خدمة Supabase غير مضبوط في Worker: أضف SUPABASE_SERVICE_ROLE_KEY" }, 500);
        const serviceHeaders = { apikey: serviceKey };
        if (!serviceKey.startsWith("sb_secret_")) serviceHeaders.Authorization = "Bearer " + serviceKey;
        const requestsResponse = await supabaseRequest(
          "/rest/v1/driver_delivery_requests?select=id,order_id,invoice_number,sheet_name,driver_name,requested_at,status&order=requested_at.asc",
          { headers: serviceHeaders }
        );
        const allDeliveryRequests = await requestsResponse.json().catch(function () { return null; });
        if (!requestsResponse.ok || !Array.isArray(allDeliveryRequests)) {
          return json({ error: (allDeliveryRequests && (allDeliveryRequests.message || allDeliveryRequests.hint || allDeliveryRequests.error)) || "تعذر قراءة طلبات اعتماد التسليم" }, 502);
        }
        // بعض النسخ القديمة قد تستخدم requested بدلاً من pending؛ اعرض الطلبات غير المعالجة فقط.
        const deliveryRequests = allDeliveryRequests.filter(function (row) {
          const status = String(row.status || "pending").trim().toLowerCase();
          return status === "pending" || status === "requested" || status === "waiting" || status === "قيد الانتظار";
        });
        const statusOrders = Array.isArray(data) ? data : (Array.isArray(data && data.orders) ? data.orders : []);
        return new Response(JSON.stringify({ orders: statusOrders, delivery_requests: deliveryRequests }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store, no-cache, must-revalidate" }
        });
      }

      // اعتماد طلب التسليم من الكمبيوتر فقط. لا يتم تحديث الفاتورة إلا بعد ضغط المستخدم للموافقة.
      if (path === "/api/excel-approve-delivery" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const body = await request.json().catch(function () { return {}; });
        const requestId = Number(body.request_id);
        if (!Number.isInteger(requestId) || requestId <= 0) return json({ error: "رقم طلب الاعتماد غير صحيح" }, 400);
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (!serviceKey) return json({ error: "مفتاح خدمة Supabase غير مضبوط في Worker" }, 500);
        const H = { apikey: serviceKey, "Content-Type": "application/json" };
        if (!serviceKey.startsWith("sb_secret_")) H.Authorization = "Bearer " + serviceKey;

        const getRes = await supabaseRequest(
          "/rest/v1/driver_delivery_requests?id=eq." + requestId + "&status=eq.pending&select=id,order_id,invoice_number,sheet_name&limit=1",
          { headers: H }
        );
        const rows = await getRes.json().catch(function () { return null; });
        if (!getRes.ok) return json({ error: (rows && (rows.message || rows.hint || rows.error)) || "تعذر قراءة طلب الاعتماد" }, 502);
        if (!Array.isArray(rows) || !rows.length) return json({ error: "طلب الاعتماد غير موجود أو تمت معالجته مسبقًا" }, 404);
        const req = rows[0];

        const orderRes = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(req.order_id) + "&sheet_name=eq." + encodeURIComponent(req.sheet_name) + "&select=id,delivery_date,delivery_status&limit=1",
          { headers: H }
        );
        const orderRows = await orderRes.json().catch(function () { return null; });
        if (!orderRes.ok || !Array.isArray(orderRows) || !orderRows.length) return json({ error: (orderRows && (orderRows.message || orderRows.hint || orderRows.error)) || "تعذر التحقق من الفاتورة قبل اعتماد التسليم" }, 502);
        const approvalLock = rejectFutureDelivery(orderRows[0], dubaiDateKey(new Date()));
        if (approvalLock) return approvalLock;
        const currentStatus = String(orderRows[0].delivery_status || "").trim().toLowerCase();
        if (currentStatus === "delivered" || currentStatus.includes("تم التسليم")) {
          return json({ error: "الفاتورة تم تسليمها بالفعل", already_delivered: true }, 409);
        }

        const updateRes = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(req.order_id) + "&sheet_name=eq." + encodeURIComponent(req.sheet_name),
          { method: "PATCH", headers: Object.assign({}, H, { Prefer: "return=representation" }), body: JSON.stringify({ delivery_status: "delivered" }) }
        );
        const changed = await updateRes.json().catch(function () { return null; });
        if (!updateRes.ok || !Array.isArray(changed) || !changed.length) return json({ error: (changed && (changed.message || changed.hint || changed.error)) || "تعذر اعتماد حالة التسليم في الفاتورة" }, 502);

        const doneRes = await supabaseRequest(
          "/rest/v1/driver_delivery_requests?id=eq." + requestId + "&status=eq.pending",
          { method: "PATCH", headers: Object.assign({}, H, { Prefer: "return=minimal" }), body: JSON.stringify({ status: "approved", processed_at: new Date().toISOString() }) }
        );
        if (!doneRes.ok) return json({ error: "تم تحديث الفاتورة لكن تعذر إغلاق طلب الاعتماد" }, 502);
        return json({ success: true, order_number: req.invoice_number, delivery_status: "delivered" });
      }

      if (path === "/api/resolve-map" && request.method === "POST") {
        const supplied=request.headers.get("X-Excel-Sync-Secret")||"";
        if(!env.EXCEL_SYNC_SECRET||supplied!==env.EXCEL_SYNC_SECRET)return json({ok:false,error:"غير مصرح"},401);
        const body=await request.json().catch(()=>null);
        try{const p=await farujResolveGoogleMap(body&&body.url);return json({ok:true,url:String(body.url||""),coords:[p.lat,p.lng],location_key:p.key});}
        catch(e){return json({ok:false,error:e.message},422);}
      }

      if (path === "/api/master/order/update-by-identity" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const identity = body.identity && typeof body.identity === "object" ? body.identity : {};
        const order = body.order && typeof body.order === "object" ? body.order : null;
        const orderNumber = String(identity.order_number || "").trim();
        const deliveryDate = String(order && order.delivery_date || "").slice(0, 10);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !order || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
          return json({ error: "بيانات الفاتورة أو تاريخ التوصيل غير صحيحة" }, 400);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "مفتاح الخدمة غير مضبوط في أسرار Worker" }, 500);
        const H = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=representation" };
        const lookupPath = "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) +
          "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000";
        const archiveLookupPath = "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber) +
          "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000";
        const [ordersResp, archiveResp] = await Promise.all([
          supabaseRequest(lookupPath, { headers: H }),
          supabaseRequest(archiveLookupPath, { headers: H })
        ]);
        const [ordersRows, archiveRows] = await Promise.all([
          ordersResp.json().catch(function () { return null; }),
          archiveResp.json().catch(function () { return null; })
        ]);
        if (!ordersResp.ok || !Array.isArray(ordersRows)) return json({ error: "تعذر البحث عن الفاتورة في طلبات المناديب", details: ordersRows }, 502);
        if (!archiveResp.ok || !Array.isArray(archiveRows)) return json({ error: "تعذر البحث عن الفاتورة في أرشيف الماستر", details: archiveRows }, 502);

        const foundOrders = matchInvoiceRows(ordersRows, identity);
        const foundArchive = matchInvoiceRows(archiveRows, identity);
        if (foundOrders.ambiguous || foundArchive.ambiguous) {
          return json({ error: "رقم الفاتورة له أكثر من نسخة ولا يمكن تحديدها بأمان. لم يتم تعديل أي شيء.", ambiguous_orders: foundOrders.ambiguous, ambiguous_archive: foundArchive.ambiguous }, 409);
        }
        if (!foundOrders.rows.length && !foundArchive.rows.length) {
          return json({ error: "not_found — لم يتم العثور على الفاتورة بنفس بيانات العميل" }, 404);
        }
        // الطلبات قيد التوصيل توجد في orders فقط بعد فصل الأرشيف.
        // غياب نسخة الأرشيف ليس خطأ: نحدّث كل نسخ المناديب، وإذا أصبحت Delivered
        // ينشئها Trigger الأرشفة. الفواتير المسلّمة الموجودة بالأرشيف تُحدّث هناك أيضًا.

        // نحدد أسماء المناديب التي لديها نسخة من نفس الفاتورة قبل بناء التحديث.
        // عند وجود نسخ متعددة، نحدّث بيانات الفاتورة في كل النسخ مع إبقاء sheet_name
        // الخاص بكل مندوب كما هو؛ لا نحوّل نسخ المندوبين إلى اسم مندوب واحد.
        const currentSheets = Array.from(new Set(
          foundOrders.rows.concat(foundArchive.rows)
            .map(function (row) { return String(row.sheet_name || '').trim(); })
            .filter(Boolean)
        ));
        const requestedSheet = String(order.sheet_name || '').trim();
        const hasMultipleDriverCopies = currentSheets.length > 1;
        // عند وجود أكثر من نسخة لدى المناديب، لا نرفض تعديل بيانات الفاتورة.
        // نحدّث كل النسخ المطابقة ونحافظ على sheet_name الخاص بكل نسخة كما هو.
        // يظل تغيير المندوب متاحًا كما كان سابقًا إذا كانت هناك نسخة واحدة فقط.

        const allowed = [
          "customer_name", "phone", "emirate", "area", "order_details",
          "chicken_weights", "chicken_qtys", "plate_names", "plate_qtys",
          "total", "payment_method", "delivery_status", "delivery_fee",
          "delivery_date", "location_url", "note",
          "appointment_coordinator", "gate_photo_url", "gate_photo_urls",
          "paid_in_advance", "bank_transfer_received"
        ];
        const archivePatch = {};
        allowed.forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(order, key)) archivePatch[key] = order[key];
        });
        archivePatch.updated_at = new Date().toISOString();
        const ordersPatch = Object.assign({}, archivePatch);
        delete ordersPatch.updated_at;

        // تغيير المندوب مسموح فقط إذا كانت الفاتورة لها مندوب واحد معروف.
        // أما الفاتورة المكررة عند عدة مناديب فتبقى كل نسخة باسم مندوبها.
        if (currentSheets.length === 1 && requestedSheet && requestedSheet !== currentSheets[0]) {
          if (foundOrders.rows.length) ordersPatch.sheet_name = requestedSheet;
          if (foundArchive.rows.length) archivePatch.sheet_name = requestedSheet;
        }
        if (Object.prototype.hasOwnProperty.call(order, "sync_revision")) {
          ordersPatch.sync_revision = Math.max(0, Number(order.sync_revision) || 0);
        }

        // نفس قاعدة الدفع الحالية: قرار المندوب لا يُفرض عليه قبل إتمام التسليم.
        const statusRaw = String(ordersPatch.delivery_status || "").toLowerCase();
        const delivered = statusRaw === "delivered" || statusRaw.includes("تم");
        const paymentRaw = String(ordersPatch.payment_method || "").trim();
        const driverPaymentChoice = paymentRaw === "cash" || paymentRaw === "bank_transfer" || paymentRaw === "كاش" || paymentRaw === "تحويل بنكي";
        if (driverPaymentChoice && !delivered) ordersPatch.payment_method = "";
        if (ordersPatch.paid_in_advance === true || /مقدم/.test(paymentRaw)) {
          ordersPatch.paid_in_advance = true;
          archivePatch.paid_in_advance = true;
        }

        const ordersFilter = invoiceIdFilter(foundOrders.rows);
        const archiveFilter = invoiceIdFilter(foundArchive.rows);
        let updatedOrders = [];
        let updatedArchive = [];
        if (ordersFilter) {
          const response = await supabaseRequest("/rest/v1/orders?" + ordersFilter, { method: "PATCH", headers: H, body: JSON.stringify(ordersPatch) });
          updatedOrders = await response.json().catch(function () { return null; });
          if (!response.ok || !Array.isArray(updatedOrders) || updatedOrders.length !== foundOrders.rows.length) {
            return json({ error: "تعذر تحديث كل نسخ المناديب؛ راجع قاعدة البيانات قبل إعادة المحاولة.", updated_orders: Array.isArray(updatedOrders) ? updatedOrders.length : 0 }, 502);
          }
        }

        // عند وجود نسخ نشطة في orders، يكون Trigger الأرشفة هو المسؤول عن
        // إنشاء/تحديث نسخة الأرشيف عند التسليم أو إزالتها عند الرجوع إلى out.
        // لذلك لا نرسل PATCH إلى نسخة أرشيف قد يكون Trigger حذفها للتو.
        // نحدّث الأرشيف مباشرة فقط عندما لا توجد أي نسخة نشطة مطابقة.
        const targetIsDelivered = statusRaw === "delivered" || statusRaw.includes("تم");
        let archiveManagedByOrderTrigger = false;
        if (archiveFilter && !foundOrders.rows.length) {
          if (!targetIsDelivered) {
            return json({ error: "الفاتورة موجودة في الأرشيف فقط ولا توجد نسخة نشطة عند المناديب لإعادتها إلى قيد التوصيل. لم يتم اعتماد التعديل.", updated_orders: 0, updated_archive: 0 }, 409);
          }
          const response = await supabaseRequest("/rest/v1/master_orders_archive?" + archiveFilter, { method: "PATCH", headers: H, body: JSON.stringify(archivePatch) });
          updatedArchive = await response.json().catch(function () { return null; });
          if (!response.ok || !Array.isArray(updatedArchive) || updatedArchive.length !== foundArchive.rows.length) {
            return json({ error: "تعذر تحديث نسخة الأرشيف؛ راجع قاعدة البيانات فورًا.", updated_orders: updatedOrders.length, updated_archive: Array.isArray(updatedArchive) ? updatedArchive.length : 0 }, 502);
          }
        } else if (foundOrders.rows.length) {
          archiveManagedByOrderTrigger = true;
        }
        let cancelledDeliveryRequests = 0;
        if (!delivered && (statusRaw === "out" || statusRaw === "pending" || statusRaw.includes("قيد التوصيل"))) {
          const cr = await cancelPendingDeliveryRequests(env, foundOrders.rows.map(row => row.id), "master_identity_update");
          if (!cr.success) return json({ error: "تم تحديث الفاتورة لكن تعذر إلغاء طلبات التسليم القديمة؛ أعد المحاولة قبل المزامنة.", details: cr.error }, 502);
          cancelledDeliveryRequests = cr.cancelled;
        }
        // لا نرسل الإشعار إلا بعد تحديث الصفوف وإلغاء الطلبات القديمة.
        const liveNotified = await broadcastOrdersChanged(env, "desktop_invoice_update");
        return json({
          success: true,
          order_number: orderNumber,
          updated_orders: updatedOrders.length,
          updated_archive: updatedArchive.length,
          archive_managed_by_orders_trigger: archiveManagedByOrderTrigger,
          updated_sheets: currentSheets,
          driver_assignment_preserved: hasMultipleDriverCopies,
          delivery_date: deliveryDate,
          live_notified: liveNotified,
          cancelled_delivery_requests: cancelledDeliveryRequests,
          created_at_unchanged: true
        });
      }

      if (path === "/api/master/order/update-by-number" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const orderNumber = String(body.order_number || "").trim();
        const patch = body.order && typeof body.order === "object" ? body.order : null;
        if (!orderNumber || !patch) return json({ error: "بيانات غير مكتملة" }, 400);
        delete patch.id;
        if (Object.prototype.hasOwnProperty.call(patch, "delivery_date") && patch.delivery_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.delivery_date))) {
          return json({ error: "تاريخ التوصيل غير صحيح" }, 400);
        }
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط في أسرار Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=minimal" };
        // كاش/تحويل بنكي يحددها المندوب عند التسليم: نحتفظ بقيمة الكمبيوتر في أرشيف الماستر
        // ونمسح نسخة المندوب (قبل التسليم فقط) ليُطلب منه إعادة الاختيار.
        const driverPatch = Object.assign({}, patch);
        const archivePatch = Object.assign({}, patch);
        archivePatch.updated_at = new Date().toISOString();
        const stRaw = String(patch.delivery_status || "").toLowerCase();
        const isDelivered = stRaw === "delivered" || stRaw.includes("تم");
        const pmRaw = String(patch.payment_method || "").trim();
        const isDriverChoice = pmRaw === "cash" || pmRaw === "bank_transfer" || pmRaw === "كاش" || pmRaw === "تحويل بنكي";
        const isAdvance = patch.paid_in_advance === true || /مقدم/.test(pmRaw);
        if (isDriverChoice && !isDelivered) driverPatch.payment_method = "";
        if (isAdvance) { driverPatch.paid_in_advance = true; archivePatch.paid_in_advance = true; }
        const orderIdsResp = await supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id", { headers: H });
        const orderIdRows = await orderIdsResp.json().catch(function () { return null; });
        if (!orderIdsResp.ok || !Array.isArray(orderIdRows)) return json({ error: "تعذر تحديد نسخ الفاتورة قبل تصحيح الحالة" }, 502);
        const numberIdsResp = await supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id", { headers: H });
        const numberIdRows = await numberIdsResp.json().catch(function () { return null; });
        if (!numberIdsResp.ok || !Array.isArray(numberIdRows)) return json({ error: "تعذر تحديد نسخ الفاتورة قبل تعديل الحالة" }, 502);
        const r1 = await supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(driverPatch) });
        if (!r1.ok) {
          const e1 = await r1.json().catch(function () { return null; });
          return json({ error: (e1 && (e1.message || e1.hint || e1.error)) || "تعذر تحديث نسخ الطلبات" }, 502);
        }
        const r2 = await supabaseRequest("/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(archivePatch) });
        if (!r2.ok) {
          const e2 = await r2.json().catch(function () { return null; });
          return json({ error: (e2 && (e2.message || e2.hint || e2.error)) || "تم تحديث الطلبات وتعذر تحديث الأرشيف" }, 502);
        }
        let cancelledRequests = 0;
        if (!isDelivered && (stRaw === "out" || stRaw === "pending" || stRaw.includes("قيد التوصيل"))) {
          const cr = await cancelPendingDeliveryRequests(env, numberIdRows.map(row => row.id), "master_update_by_number");
          if (!cr.success) return json({ error: "تم تحديث الحالة لكن تعذر إلغاء طلب التسليم القديم؛ أعد المحاولة قبل المزامنة.", details: cr.error }, 502);
          cancelledRequests = cr.cancelled;
        }
        const liveNotified = await broadcastOrdersChanged(env, "master_update_by_number");
        return json({ success: true, updated: orderNumber, cancelled_delivery_requests: cancelledRequests, live_notified: liveNotified });
      }

      /* تصحيح فوري من برنامج الكمبيوتر (بسر المزامنة): حالة تسليم / طريقة دفع / تأكيد تحويل.
         لا يحذف أي بيانات — يعدّل الحقول المحددة فقط في نسخ الطلبات والأرشيف. */
      if (path === "/api/excel-correct" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط في أسرار Worker" }, 500);
        const body = await request.json().catch(function () { return {}; });
        const orderNumber = String(body.order_number || "").trim();
        const set = body.set && typeof body.set === "object" ? body.set : null;
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !set) return json({ error: "بيانات غير صحيحة" }, 400);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=minimal" };
        const driverPatch = Object.assign({}, set);
        const archivePatch = Object.assign({}, set);
        archivePatch.updated_at = new Date().toISOString();
        const stRaw = String(set.delivery_status || "").toLowerCase();
        const isDelivered = stRaw === "delivered" || stRaw.includes("تم");
        const pmRaw = String(set.payment_method || "").trim();
        const isDriverChoice = pmRaw === "cash" || pmRaw === "bank_transfer" || pmRaw === "كاش" || pmRaw === "تحويل بنكي";
        if (isDriverChoice && !isDelivered) driverPatch.payment_method = "";
        if (set.paid_in_advance === true || /مقدم/.test(pmRaw)) { driverPatch.paid_in_advance = true; archivePatch.paid_in_advance = true; }
        const r1 = await supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(driverPatch) });
        if (!r1.ok) {
          const e1 = await r1.json().catch(function () { return null; });
          return json({ error: (e1 && (e1.message || e1.hint || e1.error)) || "تعذر تحديث نسخ الطلبات" }, 502);
        }
        const r2 = await supabaseRequest("/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(archivePatch) });
        if (!r2.ok) {
          const e2 = await r2.json().catch(function () { return null; });
          return json({ error: (e2 && (e2.message || e2.hint || e2.error)) || "تم تحديث الطلبات وتعذر تحديث الأرشيف" }, 502);
        }
        let cancelledRequests = 0;
        if (!isDelivered && (stRaw === "out" || stRaw === "pending" || stRaw.includes("قيد التوصيل"))) {
          const cr = await cancelPendingDeliveryRequests(env, orderIdRows.map(row => row.id), "excel_correct");
          if (!cr.success) return json({ error: "تم تحديث الحالة لكن تعذر إلغاء طلب التسليم القديم؛ أعد المحاولة قبل المزامنة.", details: cr.error }, 502);
          cancelledRequests = cr.cancelled;
        }
        const liveNotified = await broadcastOrdersChanged(env, "excel_correct");
        return json({ success: true, updated: orderNumber, cancelled_delivery_requests: cancelledRequests, live_notified: liveNotified });
      }

      if (path === "/api/master/delete-by-date" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        return json({
          success: false,
          deleted: false,
          error: "تم إيقاف الحذف حسب التاريخ حفاظًا على الفواتير والأرشيف. غيّر delivery_date بدل الحذف."
        }, 410);
      }

      if (path === "/api/master/dedupe" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "إعداد التنضيف غير مكتمل: SUPABASE_SERVICE_ROLE_KEY" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc };
        async function dedupeTable(table, withSheet) {
          const cols = withSheet ? "id,order_number,sheet_name" : "id,order_number";
          const res = await supabaseRequest("/rest/v1/" + table + "?select=" + cols + "&order=id.asc", { headers: H });
          const rows = await res.json().catch(function () { return []; });
          if (!res.ok || !Array.isArray(rows)) return { error: "تعذر قراءة " + table };
          const keep = new Map();
          for (const r of rows) {
            const key = (withSheet ? String(r.sheet_name) + "|" : "") + String(r.order_number);
            keep.set(key, r.id);
          }
          const del = rows
            .filter((r) => keep.get((withSheet ? String(r.sheet_name) + "|" : "") + String(r.order_number)) !== r.id)
            .map((r) => r.id);
          if (!del.length) return { removed: 0 };
          const dres = await supabaseRequest("/rest/v1/" + table + "?id=in.(" + del.join(",") + ")", { method: "DELETE", headers: H });
          return { removed: del.length, ok: dres.ok };
        }
        const o = await dedupeTable("orders", true);
        const a = await dedupeTable("master_orders_archive", false);
        return json({ success: true, orders: o, archive: a });
      }

      /* تسجيل إذن رفع مستقبلي بمراجعة مركزية متزايدة؛ يمنع تساوي عدادات جهازين مختلفين. */
      if (path === "/api/master/order/release-future" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const orderNumber = String(body.order_number || "").trim();
        const deliveryDate = String(body.delivery_date || "").slice(0, 10);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
          return json({ error: "رقم الفاتورة أو تاريخ التوصيل غير صحيح" }, 400);
        }
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط في أسرار Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
        const rpc = await supabaseRequest("/rest/v1/rpc/faruj_request_future_invoice_release", {
          method: "POST",
          headers: H,
          body: JSON.stringify({ p_order_number: orderNumber, p_delivery_date: deliveryDate, p_requested_by: "desktop_master" })
        });
        const result = await rpc.json().catch(function () { return null; });
        if (!rpc.ok || !result || result.success !== true || !Number(result.release_revision)) {
          return json({ error: (result && (result.error || result.message || result.hint)) || "تعذر تسجيل إذن الرفع على السحابة", detail: result }, 502);
        }
        return json({ success: true, release_revision: Number(result.release_revision), order_number: orderNumber, delivery_date: deliveryDate });
      }

      /* سحب شامل لفاتورة مستقبلية: المناديب + الماستر + الأرشيف، مع سجل يمنع إعادة نشرها تلقائيًا. */
      if (path === "/api/master/order/recall-future" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const orderNumber = String(body.order_number || "").trim();
        const requestedDate = String(body.delivery_date || "").slice(0, 10);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
          return json({ error: "رقم الفاتورة أو تاريخ التوصيل غير صحيح" }, 400);
        }
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط في أسرار Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
        // اجمع مفاتيح ترتيب الفاتورة قبل حذف نسخ المناديب؛ هذه بيانات ترتيب تشغيلية فقط.
        const sortSourceResp = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) +
          "&delivery_date=eq." + encodeURIComponent(requestedDate) +
          "&select=order_number,created_at,customer_name,total,sheet_name",
          { headers: H }
        );
        const sortSourceRows = await sortSourceResp.json().catch(function () { return null; });
        if (!sortSourceResp.ok || !Array.isArray(sortSourceRows)) {
          return json({ error: "تعذر قراءة مفاتيح ترتيب الفاتورة قبل السحب؛ لم يتم تنفيذ السحب", detail: sortSourceRows }, 502);
        }
        const sortKeys = [];
        for (const row of sortSourceRows) sortKeys.push(await makeSharedInvoiceKey(row));

        const rpc = await supabaseRequest("/rest/v1/rpc/faruj_withdraw_future_invoice", {
          method: "POST",
          headers: H,
          body: JSON.stringify({
            p_order_number: orderNumber,
            p_delivery_date: requestedDate,
            p_requested_by: "desktop_master"
          })
        });
        const result = await rpc.json().catch(function () { return null; });
        if (!rpc.ok || !result || result.success !== true) {
          return json({
            error: (result && (result.error || result.message || result.hint)) || "تعذر تنفيذ السحب الشامل؛ لم نعتبر العملية ناجحة",
            detail: result,
            supabase_status: rpc.status
          }, rpc.status === 409 ? 409 : 502);
        }
        let removedSortMetadata = 0;
        if (sortKeys.length) {
          const uniqueSortKeys = Array.from(new Set(sortKeys));
          const sortDelete = await supabaseRequest(
            "/rest/v1/driver_invoice_order_shared?invoice_key=in.(" + uniqueSortKeys.map(encodeURIComponent).join(",") + ")",
            { method: "DELETE", headers: Object.assign({}, H, { Prefer: "return=representation" }) }
          );
          const sortDeletedRows = await sortDelete.json().catch(function () { return [] });
          if (sortDelete.ok && Array.isArray(sortDeletedRows)) removedSortMetadata = sortDeletedRows.length;
        }
        await broadcastOrdersChanged(env, "future_invoice_withdrawn");
        return json({
          success: true,
          withdrawn: true,
          removed_orders: Number(result.removed_orders) || 0,
          removed_archive: Number(result.removed_archive) || 0,
          removed_departures: Number(result.removed_departures) || 0,
          cancelled_requests: Number(result.cancelled_requests) || 0,
          removed_sort_metadata: removedSortMetadata,
          release_revision: Number(result.release_revision) || 0,
          order_number: orderNumber,
          delivery_date: requestedDate,
          retained_on_desktop: true
        });
      }

      if (path === "/api/master/order/delete-by-identity" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const identity = body.identity && typeof body.identity === "object" ? body.identity : {};
        const orderNumber = String(identity.order_number || "").trim();
        const identityDate = String(identity.delivery_date || "").slice(0, 10);
        const identityPhone = invoiceDigits(identity.phone);
        const identityCustomer = invoiceNorm(identity.customer_name);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(identityDate) || (!identityPhone && identityCustomer.length < 3)) {
          return json({ error: "لا يمكن حذف الفاتورة بأمان دون تاريخ التوصيل ورقم الهاتف أو اسم العميل." }, 400);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "مفتاح الخدمة غير مضبوط في أسرار Worker" }, 500);
        const H = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=representation" };
        const [ordersResp, archiveResp] = await Promise.all([
          supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000", { headers: H }),
          supabaseRequest("/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000", { headers: H })
        ]);
        const [ordersRows, archiveRows] = await Promise.all([
          ordersResp.json().catch(function () { return null; }),
          archiveResp.json().catch(function () { return null; })
        ]);
        if (!ordersResp.ok || !Array.isArray(ordersRows)) return json({ error: "تعذر البحث عن الفاتورة في طلبات المناديب", details: ordersRows }, 502);
        if (!archiveResp.ok || !Array.isArray(archiveRows)) return json({ error: "تعذر البحث عن الفاتورة في الماستر", details: archiveRows }, 502);
        const foundOrders = matchInvoiceRows(ordersRows, identity);
        const foundArchive = matchInvoiceRows(archiveRows, identity);
        if (foundOrders.ambiguous) return json({ error: "رقم الفاتورة له أكثر من نسخة عند المناديب ولا يمكن تحديدها بأمان. لم يتم حذف أي شيء.", ambiguous_orders: true }, 409);
        if (foundArchive.ambiguous) {
          // إذا كانت نسخة الأرشيف بتاريخ NULL لكنها تحمل نفس id وsheet_name
          // لنسخة نشطة تم تحديدها بدقة، فهذا رابط مباشر لنفس السجل وليس تخمينًا.
          const exactArchiveCounterparts = archiveRows.filter(function (archived) {
            return foundOrders.rows.some(function (active) {
              return String(active.id) === String(archived.id) &&
                String(active.order_number || "").trim() === String(archived.order_number || "").trim() &&
                String(active.sheet_name || "").trim() === String(archived.sheet_name || "").trim();
            });
          });
          if (exactArchiveCounterparts.length) {
            foundArchive.rows = exactArchiveCounterparts;
            foundArchive.ambiguous = false;
          } else {
            return json({ error: "نسخ الأرشيف لنفس رقم الفاتورة غير محددة بأمان. لم يتم حذف أي شيء.", ambiguous_archive: true }, 409);
          }
        }
        // أضف النسخ الأرشيفية المرتبطة بالـid نفسه حتى لو تاريخها NULL،
        // ثم أزل التكرار بالمعرّف قبل الحذف.
        const exactArchiveCounterparts = archiveRows.filter(function (archived) {
          return foundOrders.rows.some(function (active) {
            return String(active.id) === String(archived.id) &&
              String(active.order_number || "").trim() === String(archived.order_number || "").trim() &&
              String(active.sheet_name || "").trim() === String(archived.sheet_name || "").trim();
          });
        });
        foundArchive.rows = foundArchive.rows.concat(exactArchiveCounterparts).filter(function (row, index, rows) {
          return rows.findIndex(function (item) { return String(item.id) === String(row.id); }) === index;
        });
        if (!foundOrders.rows.length && !foundArchive.rows.length) return json({ error: "not_found — الفاتورة غير موجودة بنفس بيانات العميل" }, 404);

        const orderIds = foundOrders.rows.map(function (row) { return Number(row.id); }).filter(function (id) { return Number.isInteger(id) && id > 0; });
        const archiveIds = foundArchive.rows.map(function (row) { return Number(row.id); }).filter(function (id) { return Number.isInteger(id) && id > 0; });
        if (orderIds.length) {
          const depRes = await supabaseRequest("/rest/v1/driver_departures?order_id=in.(" + orderIds.join(",") + ")", { method: "DELETE", headers: H });
          if (!depRes.ok && depRes.status !== 404) {
            const detail = await depRes.json().catch(function () { return {}; });
            return json({ error: "تعذر تنظيف سجل حركة المندوب؛ لم يتم حذف الفاتورة.", details: detail }, 502);
          }
          const approvalRes = await supabaseRequest("/rest/v1/driver_delivery_requests?order_id=in.(" + orderIds.join(",") + ")", { method: "DELETE", headers: H });
          if (!approvalRes.ok && approvalRes.status !== 404) {
            const detail = await approvalRes.json().catch(function () { return {}; });
            return json({ error: "تعذر تنظيف طلبات اعتماد التسليم؛ لم يتم حذف الفاتورة.", details: detail }, 502);
          }
        }
        // حذف نسخة الماستر ثم نسخ المناديب. عند أي نقص لا يبلّغ المكتب بنجاح العملية.
        let deletedArchive = [];
        let deletedOrders = [];
        if (archiveIds.length) {
          const ar = await supabaseRequest("/rest/v1/master_orders_archive?id=in.(" + archiveIds.join(",") + ")", { method: "DELETE", headers: H });
          deletedArchive = await ar.json().catch(function () { return null; });
          if (!ar.ok || !Array.isArray(deletedArchive) || deletedArchive.length !== archiveIds.length) {
            return json({ error: "تعذر حذف الفاتورة من الماستر بالكامل؛ راجع قاعدة البيانات قبل إعادة المحاولة.", deleted_archive: Array.isArray(deletedArchive) ? deletedArchive.length : 0, expected_archive: archiveIds.length }, 502);
          }
        }
        if (orderIds.length) {
          const od = await supabaseRequest("/rest/v1/orders?id=in.(" + orderIds.join(",") + ")", { method: "DELETE", headers: H });
          deletedOrders = await od.json().catch(function () { return null; });
          if (!od.ok || !Array.isArray(deletedOrders) || deletedOrders.length !== orderIds.length) {
            return json({ error: "تم حذف نسخة الماستر لكن تعذر حذف كل نسخ المناديب. لا تعتبر العملية مكتملة حتى مراجعة الفاتورة.", deleted_archive: deletedArchive.length, deleted_orders: Array.isArray(deletedOrders) ? deletedOrders.length : 0, expected_orders: orderIds.length }, 502);
          }
        }
        return json({ success: true, deleted: orderNumber, deleted_orders: deletedOrders.length, deleted_archive: deletedArchive.length, driver_departures_removed: orderIds.length });
      }

      if (
        path === "/api/master/order/delete-by-number" &&
        request.method === "POST"
      ) {
        const auth = await requireMaster(request, env);

        if (auth.error) {
          return json({ error: auth.error }, auth.status);
        }

        const body = await request.json().catch(function () {
          return {};
        });

        const orderNumber = String(body.order_number || "").trim();

        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) {
          return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        }

        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

        if (!serviceKey) {
          return json({ error: "إعداد الحذف غير مكتمل: أضف SUPABASE_SERVICE_ROLE_KEY إلى أسرار Worker" }, 500);
        }

        const svcHeaders = {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey
        };

        // 1) البحث عن الفاتورة برقمها في جدول الطلبات
        const findResp = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." +
            encodeURIComponent(orderNumber) +
            "&select=id,order_number",
          { headers: svcHeaders }
        );

        const found = await findResp.json().catch(function () {
          return null;
        });

        if (!findResp.ok || !Array.isArray(found)) {
          return json({ error: "تعذر البحث عن الفاتورة" }, 502);
        }

        if (!found.length) {
          return json({ error: "not_found" }, 404);
        }

        const orderIds = found
          .map(function (row) { return row.id; })
          .filter(function (id) { return Number.isInteger(id) && id > 0; });

        // 2) حذف سجلات التحرك المرتبطة بالأوردر (لو الجدول موجود)
        if (orderIds.length) {
          await supabaseRequest(
            "/rest/v1/driver_departures?order_id=in.(" + orderIds.join(",") + ")",
            { method: "DELETE", headers: svcHeaders }
          );
        }

        // 3) حذف الفاتورة من جدول الطلبات — يعمل حتى لو كانت قيد التوصيل
        const delResp = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber),
          {
            method: "DELETE",
            headers: Object.assign({}, svcHeaders, { Prefer: "return=representation" })
          }
        );

        if (!delResp.ok) {
          const delErr = await delResp.json().catch(function () { return null; });
          return json({
            error:
              (delErr && (delErr.message || delErr.hint || delErr.error)) ||
              "تعذر حذف الفاتورة من الطلبات"
          }, 502);
        }

        // 4) حذف نسخة الأرشيف أيضًا (لو وُجدت)
        await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber),
          { method: "DELETE", headers: svcHeaders }
        );

        return json({
          success: true,
          deleted: orderNumber,
          orders_deleted: found.length
        });
      }

      /* ============================================================
         ⭐ مزامنة ثنائية الاتجاه (ماستر ↔ كمبيوتر ↔ مناديب) + تحويلات + تحصيل مجدول
         ============================================================ */

      /* 1) حالة الفواتير من أرشيف الماستر → الكمبيوتر */
      if (path === "/api/excel-master-state" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Secret") || request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط في أسرار Worker" }, 500);
        const r = await supabaseRequest(
          "/rest/v1/master_orders_archive?select=order_number,customer_name,phone,emirate,area,total,note,payment_method,delivery_status,paid_in_advance,bank_transfer_received,updated_at&order=updated_at.desc&limit=2000",
          { headers: { apikey: svc, Authorization: "Bearer " + svc } }
        );
        const rows = await r.json().catch(function () { return null; });
        if (!r.ok || !Array.isArray(rows)) {
          return json({ error: (rows && (rows.message || rows.hint || rows.error)) || "تعذر قراءة حالة الماستر" }, 502);
        }
        return json({ orders: rows, server_now: new Date().toISOString() });
      }

      /* 2) تأكيد استلام التحويل من الكمبيوتر (مطابقة/استلام يدوي/تحصيل مجدول) → الماستر + المناديب */
      if (path === "/api/excel-transfer-received" && request.method === "POST") {
        // توافق مع نسختي الهيدر المستخدمتين في برنامج الكمبيوتر.
        const supplied = request.headers.get("X-Excel-Sync-Secret") ||
          request.headers.get("X-Excel-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "غير مصرح: مفتاح مزامنة Excel غير مطابق" }, 401);
        }

        // استخدم مفتاح الخدمة المستخدم بالفعل في بقية مسارات Worker، مع دعم المفتاح الحديث كبديل.
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط في أسرار Worker" }, 500);

        const body = await request.json().catch(function () { return null; });
        const orderNumber = String(body && body.order_number || "").trim();
        const received = !(body && body.received === false);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) {
          return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        }

        const H = {
          apikey: svc,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        };
        // مفاتيح sb_secret_ ليست JWT؛ لا تُرسل في Authorization Bearer.
        if (!svc.startsWith("sb_secret_")) H.Authorization = "Bearer " + svc;

        // نغيّر عمود تأكيد الاستلام فقط، دون لمس أي بيانات أو أعمدة أخرى.
        const patch = { bank_transfer_received: received };
        const encoded = encodeURIComponent(orderNumber);

        const r1 = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encoded,
          { method: "PATCH", headers: H, body: JSON.stringify(patch) }
        );
        const d1 = await r1.json().catch(function () { return null; });
        if (!r1.ok) {
          return json({
            error: (d1 && (d1.message || d1.hint || d1.error)) || "تعذر تحديث نسخ المناديب",
            failed_table: "orders",
            supabase_status: r1.status,
            detail: d1
          }, 502);
        }

        const r2 = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encoded,
          { method: "PATCH", headers: H, body: JSON.stringify(patch) }
        );
        const d2 = await r2.json().catch(function () { return null; });
        if (!r2.ok) {
          return json({
            error: (d2 && (d2.message || d2.hint || d2.error)) || "تم تحديث المناديب وتعذر تحديث أرشيف الماستر",
            failed_table: "master_orders_archive",
            supabase_status: r2.status,
            detail: d2
          }, 502);
        }

        const driversUpdated = Array.isArray(d1) ? d1.length : 0;
        const archiveUpdated = Array.isArray(d2) ? d2.length : 0;
        let desktopStateUpdated = false;
        if (driversUpdated === 0 && archiveUpdated === 0) {
          // بعض الفواتير القديمة قد تكون موجودة في نسخة الكمبيوتر المشتركة فقط.
          // نحدّث علامة استلام التحويل داخل الفاتورة المطابقة فقط، مع CAS لمنع
          // الكتابة فوق تعديل أحدث من جهاز آخر. لا ننشئ سجل orders ولا نغيّر Master.
          const stateResponse = await supabaseRequest(
            "/rest/v1/faruj_desktop_shared_state?id=eq.1&select=id,payload,updated_at",
            { headers: H }
          );
          const stateRows = await stateResponse.json().catch(function () { return null; });
          if (!stateResponse.ok || !Array.isArray(stateRows)) {
            return json({ error: "تعذر فحص نسخة الكمبيوتر المشتركة؛ لم يتم تغيير أي بيانات", detail: stateRows, supabase_status: stateResponse.status }, 502);
          }
          if (stateRows.length !== 1 || !stateRows[0].payload || !Array.isArray(stateRows[0].payload.fa_invs)) {
            return json({ error: "تعذر العثور على نسخة الكمبيوتر المشتركة أو قائمة الفواتير؛ لم يتم تغيير أي بيانات", order_number: orderNumber }, 404);
          }
          const shared = stateRows[0];
          const matches = shared.payload.fa_invs.filter(function (inv) {
            const id = String(inv && (inv.no || inv._dn || inv.invoice_number || inv.order_number) || "").trim().toUpperCase();
            return id === orderNumber.toUpperCase();
          });
          if (matches.length === 0) {
            return json({ error: "لم يتم العثور على الفاتورة في الطلبات أو أرشيف الماستر أو نسخة الكمبيوتر المشتركة", order_number: orderNumber }, 404);
          }
          if (matches.length !== 1) {
            return json({ error: "رقم الفاتورة مكرر داخل نسخة الكمبيوتر المشتركة؛ أوقفنا التحديث لتجنب تعديل فاتورة خاطئة", order_number: orderNumber, matches: matches.length }, 409);
          }
          const nextPayload = JSON.parse(JSON.stringify(shared.payload));
          const target = nextPayload.fa_invs.find(function (inv) {
            const id = String(inv && (inv.no || inv._dn || inv.invoice_number || inv.order_number) || "").trim().toUpperCase();
            return id === orderNumber.toUpperCase();
          });
          if (!target || typeof target !== "object") {
            return json({ error: "تعذر تحديد سجل الفاتورة داخل النسخة المشتركة؛ لم يتم تغيير أي بيانات", order_number: orderNumber }, 409);
          }
          target.tRec = received;
          const casResponse = await supabaseRequest("/rest/v1/rpc/faruj_desktop_shared_state_cas_update", {
            method: "POST",
            headers: H,
            body: JSON.stringify({
              p_expected_updated_at: shared.updated_at,
              p_payload: nextPayload,
              p_source_device: "excel-transfer-received"
            })
          });
          const casRows = await casResponse.json().catch(function () { return null; });
          if (!casResponse.ok || !Array.isArray(casRows) || !casRows.length) {
            return json({ error: "تعذر حفظ تأكيد التحويل في نسخة الكمبيوتر المشتركة؛ لم نؤكد نجاح التحديث", detail: casRows, supabase_status: casResponse.status }, 502);
          }
          const cas = casRows[0];
          if (cas.success !== true || cas.conflict === true) {
            return json({ success: false, conflict: true, code: "STATE_REVISION_CONFLICT", error: "تغيرت نسخة الكمبيوتر أثناء التحديث؛ أعد المحاولة بعد إعادة المزامنة", updated_at: cas.updated_at || null }, 409);
          }
          desktopStateUpdated = true;
        }

        // إشعار لحظي بعد نجاح التحديث في أي من مصادر الفاتورة.
        await broadcastOrdersChanged(env, "excel-transfer-received");

        return json({
          success: true,
          order_number: orderNumber,
          bank_transfer_received: received,
          drivers_updated: driversUpdated,
          archive_updated: archiveUpdated,
          desktop_state_updated: desktopStateUpdated
        });
      }

      /* 3) مزامنة قسم «تحصيل مجدول» كامل من الكمبيوتر → جدول scheduled_collections */
      if (path === "/api/collect-sync" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط" }, 500);
        const body = await request.json().catch(function () { return null; });
        const rows = Array.isArray(body) ? body : (body && Array.isArray(body.collects) ? body.collects : null);
        if (!Array.isArray(rows)) return json({ error: "بيانات غير صحيحة" }, 400);
        const now = new Date().toISOString();
        const clean = rows.filter(function (r) { return r && r.id; }).map(function (r) {
          return {
            id: String(r.id), code: String(r.code || ""), name: String(r.name || ""),
            phone: String(r.phone || ""), emirate: String(r.emirate || ""),
            date: String(r.date || ""), amt: Number(r.amt) || 0,
            method: String(r.method || ""), note: String(r.note || ""),
            status: String(r.status || "pend"), done_at: String(r.done_at || ""),
            src_inv: String(r.src_inv || ""), created_at: String(r.created_at || now), updated_at: now
          };
        });
        if (clean.length) {
          const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
          const up = await supabaseRequest("/rest/v1/scheduled_collections?on_conflict=id", { method: "POST", headers: H, body: JSON.stringify(clean) });
          if (!up.ok) { const eu = await up.json().catch(function () { return null; }); return json({ error: (eu && (eu.message || eu.hint || eu.error)) || "فشل حفظ التحصيل المجدول" }, 502); }
        }
        return json({ success: true, synced: clean.length });
      }

      /* 4) سحب التحصيل المجدول → الكمبيوتر (تعديلات الماستر تنزل للكمبيوتر) */
      if (path === "/api/excel-collect" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط" }, 500);
        const r = await supabaseRequest("/rest/v1/scheduled_collections?select=*&order=date.asc", { headers: { apikey: svc, Authorization: "Bearer " + svc } });
        const rows = await r.json().catch(function () { return null; });
        if (!r.ok || !Array.isArray(rows)) return json({ error: (rows && (rows.message || rows.hint || rows.error)) || "تعذر قراءة التحصيل المجدول" }, 502);
        return json({ collects: rows });
      }

      /* 5) قراءة التحصيل المجدول من صفحة الماستر */
      if (path === "/api/master/collect" && request.method === "GET") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط" }, 500);
        const r = await supabaseRequest("/rest/v1/scheduled_collections?select=*&order=date.asc", { headers: { apikey: svc, Authorization: "Bearer " + svc } });
        const rows = await r.json().catch(function () { return null; });
        if (!r.ok || !Array.isArray(rows)) return json({ error: (rows && (rows.message || rows.hint || rows.error)) || "تعذر قراءة التحصيل المجدول" }, 502);
        return json({ collects: rows });
      }

      /* 6) تعديل موعد تحصيل من صفحة الماستر (تم التحصيل/تأجيل/ملاحظة) */
      if (path === "/api/master/collect-update" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط" }, 500);
        const body = await request.json().catch(function () { return {}; });
        const id = String(body.id || "").trim();
        const patch = body.patch && typeof body.patch === "object" ? body.patch : null;
        if (!id || !patch) return json({ error: "بيانات غير صحيحة" }, 400);
        if (patch.status === "done" && !patch.done_at) patch.done_at = new Date().toISOString();
        patch.updated_at = new Date().toISOString();
        /* Upsert: يسمح للماستر بإضافة موعد جديد أو تعديل موجود بالمسار نفسه */
        const row = Object.assign({}, patch, { id: id });
        const r = await supabaseRequest("/rest/v1/scheduled_collections?on_conflict=id", {
          method: "POST",
          headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(row)
        });
        if (!r.ok) { const e = await r.json().catch(function () { return null; }); return json({ error: (e && (e.message || e.hint || e.error)) || "تعذر تحديث الموعد" }, 502); }
        return json({ success: true, id: id });
      }

      if (
        env.ASSETS &&
        typeof env.ASSETS.fetch ===
          "function"
      ) {
        /* ⭐ منع كاش ملفات الموقع (HTML/JS/CSS): كل موبايل يجيب الكود الجديد دايمًا —
           بيمنع مشكلة «موبايل شغال بنسخة قديمة وموبايل لا» نهائيًا */
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse && assetResponse.status === 200) {
          const contentType = String(assetResponse.headers.get("Content-Type") || "").toLowerCase();
          if (contentType.indexOf("text/html") >= 0 || contentType.indexOf("javascript") >= 0 || contentType.indexOf("css") >= 0) {
            const headers = new Headers(assetResponse.headers);
            headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
            headers.set("Pragma", "no-cache");
            headers.delete("ETag");
            return new Response(assetResponse.body, {
              status: assetResponse.status,
              statusText: assetResponse.statusText,
              headers: headers
            });
          }
        }
        return assetResponse;
      }

      return new Response(
        "Not Found",
        {
          status: 404,
          headers: {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        }
      );

    } catch (error) {
      return json(
        {
          error:
            "حدث خطأ غير متوقع"
        },
        500
      );
    }
  }
};
