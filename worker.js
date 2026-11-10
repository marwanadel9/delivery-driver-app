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

// إشعار لحظي عام بعد نجاح الكتابة فقط. لا يحمل بيانات العميل أو الفاتورة.
// يستخدم REST Broadcast حتى لا يعتمد تحديث الواجهات على صلاحيات SELECT/RLS للجداول.
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

// مرجع اليوم دائمًا هو تاريخ الإمارات، وليس توقيت جهاز المندوب.
function dubaiDateKey(date) {
  const value = date instanceof Date ? date : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const fields = {};
  for (const part of parts) fields[part.type] = part.value;
  return fields.year + "-" + fields.month + "-" + fields.day;
}

function isFutureDeliveryDate(value, todayDubai) {
  const deliveryDate = String(value == null ? "" : value).slice(0, 10);
  const today = todayDubai || dubaiDateKey(new Date());
  return /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) && deliveryDate > today;
}

function futureDeliveryLockedResponse(deliveryDate) {
  return json({
    error: "هذه الفاتورة مجدولة ليوم " + String(deliveryDate || "") + "، وسيتم فتحها تلقائيًا مع بداية هذا اليوم بتوقيت دبي.",
    code: "FUTURE_DELIVERY_LOCKED",
    delivery_date: String(deliveryDate || "")
  }, 423);
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

// عقود فروج الزين: جداول إضافية مستقلة. لا نضيف أعمدة إلى orders ولا نغيّر payment_method.
const MONTHLY_CONTRACTS_TABLE = "froog_monthly_contracts";
const MONTHLY_CONTRACT_LINKS_TABLE = "froog_monthly_contract_invoice_links";

function monthlyInvoiceDate(row) {
  const direct = String(row && (row.delivery_date || row.date) || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(direct)) return direct.slice(0, 10);
  const created = String(row && row.created_at || "").trim();
  if (!created) return "";
  const parsed = new Date(created);
  return Number.isNaN(parsed.getTime()) ? "" : dubaiDateKey(parsed);
}

function monthlyInvoiceNumber(row) {
  return String(row && (row.invoice_number || row.invoice_no || row.order_number) || "").trim().toUpperCase();
}

function monthlyInvoiceKey(row) {
  const invoiceNumber = monthlyInvoiceNumber(row);
  const customerCode = String(row && (row.customer_code || row.customerCode) || "").trim();
  const invoiceDate = monthlyInvoiceDate(row);
  if (!invoiceNumber || !customerCode || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return "";
  return "master|" + invoiceNumber + "|" + customerCode + "|" + invoiceDate;
}

function postgrestIn(values) {
  // كل القيم المستعملة هنا معرفات آمنة ومفتاح invoice_key لا يحتوي فواصل أو أقواس.
  const safe = (Array.isArray(values) ? values : []).map(function (value) {
    const text = String(value);
    if (!/^[A-Za-z0-9_:-]+(?:\|[A-Za-z0-9_-]+)*$/.test(text)) {
      throw new Error("قيمة غير صالحة لفلتر PostgREST");
    }
    return text;
  });
  return "in.(" + safe.join(",") + ")";
}

function monthlyServiceHeaders(env, extra) {
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) return null;
  return Object.assign({ apikey: key, Authorization: "Bearer " + key }, extra || {});
}

async function monthlyTableRead(table, query, env) {
  const headers = monthlyServiceHeaders(env);
  if (!headers) return { ok: false, status: 500, error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في Worker" };
  const response = await supabaseRequest("/rest/v1/" + table + (query || "?select=*"), { headers: headers });
  const data = await response.json().catch(function () { return null; });
  if (!response.ok || !Array.isArray(data)) {
    return { ok: false, status: response.status || 502, error: data && (data.message || data.details || data.hint || data.error) || "تعذر قراءة " + table };
  }
  return { ok: true, rows: data };
}

async function monthlyLinkMapForOrders(rows, env) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = Array.from(new Set(list.map(monthlyInvoiceKey).filter(Boolean)));
  if (!keys.length) return { ok: true, map: new Map() };
  const links = await monthlyTableRead(MONTHLY_CONTRACT_LINKS_TABLE,
    "?invoice_key=" + encodeURIComponent(postgrestIn(keys)) + "&select=invoice_key,contract_id,customer_code", env);
  if (!links.ok) return links;
  const contractIds = Array.from(new Set(links.rows.map(function (r) { return String(r.contract_id || ""); }).filter(Boolean)));
  if (!contractIds.length) return { ok: true, map: new Map() };
  const active = await monthlyTableRead(MONTHLY_CONTRACTS_TABLE,
    "?contract_id=" + encodeURIComponent(postgrestIn(contractIds)) + "&pay_type=eq.deferred&select=contract_id,customer_code", env);
  if (!active.ok) return active;
  const activeMap = new Map(active.rows.map(function (r) { return [String(r.contract_id), String(r.customer_code || "")]; }));
  const map = new Map();
  links.rows.forEach(function (link) {
    const id = String(link.contract_id || "");
    const code = activeMap.get(id);
    if (code && code === String(link.customer_code || "")) map.set(String(link.invoice_key), id);
  });
  return { ok: true, map: map };
}

async function refreshMonthlyLinkSnapshots(links, env) {
  const rows = Array.isArray(links) ? links : [];
  if (!rows.length) return rows;
  const numbers = Array.from(new Set(rows.map(function (r) { return String(r.invoice_number || "").trim(); }).filter(Boolean)));
  const all = [];
  for (let offset = 0; offset < numbers.length; offset += 50) {
    const batch = numbers.slice(offset, offset + 50);
    const query = "?order_number=" + encodeURIComponent(postgrestIn(batch)) + "&select=*";
    const [active, archive] = await Promise.all([
      monthlyTableRead("orders", query, env),
      monthlyTableRead("master_orders_archive", query, env)
    ]);
    if (!active.ok || !archive.ok) {
      // لا نخفي السجل المرتبط عند تعذر تحديث اللقطة؛ نعيد اللقطة المخزنة مع تحذير.
      rows.forEach(function (r) { r.snapshot_refresh_unavailable = true; });
      return rows;
    }
    all.push.apply(all, active.rows);
    all.push.apply(all, archive.rows);
  }
  const byKey = new Map();
  all.forEach(function (row) {
    const key = monthlyInvoiceKey(row);
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  });
  return rows.map(function (link) {
    const copies = byKey.get(String(link.invoice_key || "")) || [];
    if (!copies.length) return Object.assign({}, link, { snapshot_missing: true });
    const total = Number(copies[0].total);
    const rawPayment = String(copies[0].payment_method || "");
    const payment = normalizePayment(rawPayment) || rawPayment;
    const mismatch = copies.some(function (row) {
      const rowRawPayment = String(row.payment_method || "");
      const rowPayment = normalizePayment(rowRawPayment) || rowRawPayment;
      return Math.abs(Number(row.total) - total) > 0.009 || rowPayment !== payment;
    });
    if (mismatch) return Object.assign({}, link, { snapshot_conflict: true });
    const bankReceived = copies.some(function (row) { return row.bank_transfer_received === true || row.bank_transfer_received === 1 || String(row.bank_transfer_received).toLowerCase() === "true"; });
    const paid = payment === "cash" || bankReceived;
    return Object.assign({}, link, {
      invoice_total: Number.isFinite(total) ? total : Number(link.invoice_total || 0),
      payment_method: payment,
      bank_transfer_received: bankReceived,
      is_paid: paid,
      master_order_ids: copies.map(function (row) { return Number(row.id); }).filter(function (id) { return Number.isInteger(id) && id > 0; }),
      snapshot_conflict: false,
      snapshot_missing: false
    });
  });
}

async function attachMonthlyContractInvoices(orders, env) {
  const candidates = (Array.isArray(orders) ? orders : []).filter(function (order) {
    return order && order.monthly_contract_deferred === true && String(order.monthly_contract_id || "").trim();
  });
  if (!candidates.length) return { ok: true, linked: 0, already: 0 };
  const headers = monthlyServiceHeaders(env, { "Content-Type": "application/json", Prefer: "return=representation" });
  if (!headers) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط؛ لم يكتمل ربط فواتير العقد" };
  let linked = 0, already = 0;
  const unique = new Map();
  candidates.forEach(function (order) {
    const key = monthlyInvoiceKey(order);
    if (!key) throw new Error("فاتورة تعاقد جديدة لا تحمل رقمًا أو كود عميل أو تاريخًا صالحًا");
    const id = String(order.monthly_contract_id || "").trim();
    if (!unique.has(key)) unique.set(key, { order: order, key: key, contractId: id });
    else if (unique.get(key).contractId !== id) throw new Error("الفاتورة نفسها أُرسلت بعقدين مختلفين؛ أوقفنا الربط للحماية");
  });
  for (const item of unique.values()) {
    const savedOrders = await monthlyTableRead("orders",
      "?order_number=eq." + encodeURIComponent(monthlyInvoiceNumber(item.order)) + "&select=id,order_number,customer_code,delivery_date,created_at,total,payment_method,bank_transfer_received", env);
    if (!savedOrders.ok) return { ok: false, error: savedOrders.error };
    const exactSaved = savedOrders.rows.filter(function (row) {
      return monthlyInvoiceKey(row) === item.key && Math.abs(Number(row.total || 0) - Number(item.order.total || 0)) <= 0.009;
    });
    if (!exactSaved.length) return { ok: false, error: "لم يتم العثور على الفاتورة المحفوظة بهويتها وقيمتها في orders: " + monthlyInvoiceNumber(item.order) };
    const contractResult = await monthlyTableRead(MONTHLY_CONTRACTS_TABLE,
      "?contract_id=eq." + encodeURIComponent(item.contractId) + "&is_active=eq.true&pay_type=eq.deferred&select=contract_id,customer_code,customer_id", env);
    if (!contractResult.ok) return { ok: false, error: contractResult.error };
    const contract = contractResult.rows[0];
    if (!contract || String(contract.customer_code || "") !== String(item.order.customer_code || "")) {
      return { ok: false, error: "لا يوجد عقد آجل نشط مطابق لكود العميل للفاتورة " + monthlyInvoiceNumber(item.order) };
    }
    if (contract.customer_id && item.order.customer_id && String(contract.customer_id) !== String(item.order.customer_id)) {
      return { ok: false, error: "معرف العميل لا يطابق العقد للفاتورة " + monthlyInvoiceNumber(item.order) };
    }
    const savedPaymentRaw = String(exactSaved[0].payment_method || "");
    const savedPayment = normalizePayment(savedPaymentRaw) || savedPaymentRaw;
    const savedTransferReceived = exactSaved.some(function (row) { return row.bank_transfer_received === true || row.bank_transfer_received === 1 || String(row.bank_transfer_received).toLowerCase() === "true"; });
    const body = {
      invoice_key: item.key,
      contract_id: item.contractId,
      customer_code: String(item.order.customer_code || ""),
      customer_id: String(exactSaved[0].customer_id || contract.customer_id || ""),
      invoice_number: monthlyInvoiceNumber(item.order),
      invoice_date: monthlyInvoiceDate(item.order),
      invoice_total: Number(exactSaved[0].total || 0),
      payment_method: savedPayment,
      bank_transfer_received: savedTransferReceived,
      is_paid: savedPayment === "cash" || savedTransferReceived,
      master_order_ids: exactSaved.map(function (row) { return Number(row.id); }).filter(function (id) { return Number.isInteger(id) && id > 0; })
    };
    const response = await supabaseRequest("/rest/v1/" + MONTHLY_CONTRACT_LINKS_TABLE, {
      method: "POST", headers: headers, body: JSON.stringify(body)
    });
    const result = await response.json().catch(function () { return null; });
    if (response.ok) { linked++; continue; }
    if (response.status === 409 || result && String(result.code || "") === "23505") {
      const existing = await monthlyTableRead(MONTHLY_CONTRACT_LINKS_TABLE,
        "?invoice_key=eq." + encodeURIComponent(item.key) + "&select=invoice_key,contract_id&limit=1", env);
      if (!existing.ok) return { ok: false, error: existing.error };
      if (existing.rows[0] && String(existing.rows[0].contract_id) === item.contractId) { already++; continue; }
      return { ok: false, error: "الفاتورة " + monthlyInvoiceNumber(item.order) + " مرتبطة بالفعل بعقد آخر" };
    }
    return { ok: false, error: result && (result.message || result.hint || result.error) || "تعذر حفظ ارتباط الفاتورة بالعقد" };
  }
  return { ok: true, linked: linked, already: already };
}

async function invoiceHasActiveMonthlyContractLink(order, env) {
  const key = monthlyInvoiceKey(order);
  if (!key) return { ok: true, linked: false };
  const result = await monthlyLinkMapForOrders([order], env);
  if (!result.ok) {
    const missingTable = Number(result.status) === 404 || /PGRST205|does not exist|Could not find the table/i.test(String(result.error || ""));
    if (missingTable) return { ok: true, linked: false, tablesUnavailable: true };
    return result;
  }
  return { ok: true, linked: result.map.has(key) };
}

// مطابقة هوية الفاتورة بين الكمبيوتر ونسخ المندوبين والماستر.
// رقم الفاتورة وحده لا يكفي دائمًا؛ نستخدم تاريخ التوصيل والهاتف والعميل.
function invoiceDigits(value) {
  return String(value == null ? "" : value)
    .replace(/[٠-٩]/g, function (digit) { return String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)); })
    .replace(/[۰-۹]/g, function (digit) { return String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)); })
    .replace(/[^0-9]/g, "");
}
function invoiceNorm(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/\s+/g, " ");
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

  // عند ALL نريد كل النسخ الحقيقية للفواتير المكررة عبر المناديب.
  // بعض النسخ القديمة قد تحمل هاتفًا مختلفًا بعد تحديث العميل؛ لذلك نطابق
  // على رقم الفاتورة + تاريخ التوصيل + (الهاتف أو اسم العميل) دون إسقاط نسخة
  // مندوب آخر لمجرد اختلاف هاتفها. التاريخ المختلف يظل مستبعدًا دائمًا.
  if (allSheets && date) {
    candidates = candidates.filter(function (row) {
      const savedPhone = invoiceDigits(row.phone);
      const savedCustomer = invoiceNorm(row.customer_name);
      const phoneMatch = Boolean(phone && savedPhone && savedPhone === phone);
      const customerMatch = Boolean(customer && savedCustomer && savedCustomer === customer);
      return phoneMatch || customerMatch;
    });
    if (!candidates.length) return { rows: [], ambiguous: false };
  } else {
    // في التعديل الموجه لمندوب واحد نلتزم بالمطابقة الصارمة لحماية الفاتورة.
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
        candidates = nameMatched;
      } else {
        return { rows: [], ambiguous: false };
      }
    } else {
      candidates = nameMatched;
    }
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
  // أمان الصور: لا نحذف ملفات Storage ولا نفك ارتباطاتها آليًا قبل إثبات الملكية
  // ومراجعة كل سجلات orders وmaster_orders_archive والعملاء التي تشير إلى الملف.
  return 0;
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
        const lockedOrder = ownedOrders.find(function (row) { return isFutureDeliveryDate(row.delivery_date); });
        if (lockedOrder) return futureDeliveryLockedResponse(lockedOrder.delivery_date);
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

      if (path === "/api/master/monthly-contracts" && request.method === "GET") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const [contractsResult, linksResult] = await Promise.all([
          monthlyTableRead(MONTHLY_CONTRACTS_TABLE, "?select=*&order=created_at.asc&limit=10000", env),
          monthlyTableRead(MONTHLY_CONTRACT_LINKS_TABLE, "?select=*&order=created_at.asc&limit=20000", env)
        ]);
        if (!contractsResult.ok || !linksResult.ok) {
          return json({
            error: "جداول التعاقد الشهري غير جاهزة أو تعذرت قراءتها. نفّذ ملف SQL الإضافي ثم أعد المحاولة.",
            contracts_error: contractsResult.ok ? null : contractsResult.error,
            links_error: linksResult.ok ? null : linksResult.error,
            hint: "لا يوجد عمود monthly_contract_deferred مطلوب في orders؛ الربط محفوظ في جداول مستقلة."
          }, 503);
        }
        const freshLinks = await refreshMonthlyLinkSnapshots(linksResult.rows, env);
        return json({ contracts: contractsResult.rows, invoice_links: freshLinks, source: "supabase" });
      }

      if (path === "/api/master/monthly-contracts/upsert" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const contract = body && body.contract && typeof body.contract === "object" ? body.contract : body;
        const contractId = String(contract.contract_id || contract.id || "").trim();
        const customerCode = String(contract.customer_code || contract.code || "").trim();
        const payType = String(contract.pay_type || contract.payType || "deferred").trim().toLowerCase();
        const cycleDay = String(contract.cycle_day || contract.cycleDay || "1").trim();
        if (!/^[A-Za-z0-9_-]{3,120}$/.test(contractId) || !/^[A-Za-z0-9_-]{1,70}$/.test(customerCode)) {
          return json({ error: "معرف العقد أو كود العميل غير صالح" }, 400);
        }
        if (payType !== "deferred" && payType !== "advance") return json({ error: "نوع التعاقد غير صالح" }, 400);
        if (!["1", "15", "last"].includes(cycleDay)) return json({ error: "دورة الحساب غير صالحة" }, 400);
        const amount = payType === "deferred" ? null : Number(contract.contract_amount ?? contract.amount);
        const advancePaid = payType === "advance" ? Number(contract.advance_paid ?? contract.advancePaid ?? 0) : 0;
        if (payType === "advance" && (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(advancePaid) || advancePaid < 0 || advancePaid > amount)) {
          return json({ error: "قيمة العقد المقدم أو الدفعة المقدمة غير صحيحة" }, 400);
        }
        const row = {
          contract_id: contractId,
          customer_code: customerCode,
          customer_id: String(contract.customer_id || contract.customerId || ""),
          customer_name: String(contract.customer_name || contract.customerName || ""),
          customer_phone: String(contract.customer_phone || contract.customerPhone || ""),
          pay_type: payType,
          contract_amount: amount,
          advance_paid: advancePaid,
          advance_month: String(contract.advance_month || contract.advanceMonth || ""),
          cycle_day: cycleDay,
          is_active: true,
          updated_at: new Date().toISOString()
        };
        const headers = monthlyServiceHeaders(env, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" });
        if (!headers) return json({ error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في Worker" }, 500);
        const response = await supabaseRequest("/rest/v1/" + MONTHLY_CONTRACTS_TABLE + "?on_conflict=contract_id", {
          method: "POST", headers: headers, body: JSON.stringify(row)
        });
        const saved = await response.json().catch(function () { return null; });
        if (!response.ok) return json({ error: saved && (saved.message || saved.details || saved.hint || saved.error) || "تعذر حفظ العقد في Supabase. تحقق من وجود عقد نشط آخر للعميل." }, response.status === 409 ? 409 : 502);
        await broadcastOrdersChanged(env, "monthly-contract-upsert");
        return json({ success: true, contract: Array.isArray(saved) ? saved[0] : saved });
      }

      if (path === "/api/master/monthly-contracts/link" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const contractId = String(body.contract_id || "").trim();
        const invoiceKey = String(body.invoice_key || "").trim();
        const match = invoiceKey.match(/^master\|([^|]{1,80})\|([A-Za-z0-9_-]{1,70})\|(\d{4}-\d{2}-\d{2})$/);
        if (!contractId || !match) return json({ error: "بيانات ربط الفاتورة غير صحيحة" }, 400);
        const invoiceNumber = match[1].toUpperCase();
        const customerCode = match[2];
        const invoiceDate = match[3];
        const contractResult = await monthlyTableRead(MONTHLY_CONTRACTS_TABLE,
          "?contract_id=eq." + encodeURIComponent(contractId) + "&is_active=eq.true&pay_type=eq.deferred&select=contract_id,customer_code,customer_id&limit=1", env);
        if (!contractResult.ok) return json({ error: contractResult.error }, 503);
        const contract = contractResult.rows[0];
        if (!contract) return json({ error: "العقد غير موجود أو غير نشط أو ليس عقدًا آجلًا" }, 404);
        if (String(contract.customer_code || "") !== customerCode) return json({ error: "كود الفاتورة لا يطابق كود العميل في العقد" }, 409);
        const query = "?order_number=eq." + encodeURIComponent(invoiceNumber) + "&select=*";
        const [activeRows, archivedRows] = await Promise.all([
          monthlyTableRead("orders", query, env),
          monthlyTableRead("master_orders_archive", query, env)
        ]);
        if (!activeRows.ok || !archivedRows.ok) return json({ error: "تعذر التحقق من الفاتورة في الماستر النشط والأرشيف", details: [activeRows.error, archivedRows.error].filter(Boolean) }, 502);
        const copies = activeRows.rows.concat(archivedRows.rows).filter(function (row) { return monthlyInvoiceKey(row) === invoiceKey; });
        if (!copies.length) return json({ error: "الفاتورة غير موجودة بنفس رقمها وتاريخها وكود عميلها في الماستر؛ لم يتم الربط" }, 404);
        if (copies.some(function (row) { return String(row.customer_code || "") !== customerCode; })) return json({ error: "تعارض في هوية العميل للفاتورة" }, 409);
        if (contract.customer_id && copies.some(function (row) { return row.customer_id && String(row.customer_id) !== String(contract.customer_id); })) return json({ error: "معرف العميل في الفاتورة لا يطابق العقد" }, 409);
        const total = Number(copies[0].total);
        const paymentRaw = String(copies[0].payment_method || "");
        const payment = normalizePayment(paymentRaw) || paymentRaw;
        if (!Number.isFinite(total) || copies.some(function (row) {
          const rowRaw = String(row.payment_method || "");
          return Math.abs(Number(row.total) - total) > 0.009 || (normalizePayment(rowRaw) || rowRaw) !== payment;
        })) {
          return json({ error: "توجد نسخ مختلفة القيمة أو طريقة الدفع لهذه الفاتورة؛ لم يتم الربط" }, 409);
        }
        const bankReceived = copies.some(function (row) { return row.bank_transfer_received === true || row.bank_transfer_received === 1 || String(row.bank_transfer_received).toLowerCase() === "true"; });
        const masterIds = copies.map(function (row) { return Number(row.id); }).filter(function (id) { return Number.isInteger(id) && id > 0; });
        const linkBody = {
          invoice_key: invoiceKey,
          contract_id: contractId,
          customer_code: customerCode,
          customer_id: String(copies[0].customer_id || copies[0].client_id || contract.customer_id || ""),
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          invoice_total: total,
          payment_method: payment,
          bank_transfer_received: bankReceived,
          is_paid: payment === "cash" || bankReceived,
          master_order_ids: masterIds
        };
        const headers = monthlyServiceHeaders(env, { "Content-Type": "application/json", Prefer: "return=representation" });
        if (!headers) return json({ error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في Worker" }, 500);
        const response = await supabaseRequest("/rest/v1/" + MONTHLY_CONTRACT_LINKS_TABLE, { method: "POST", headers: headers, body: JSON.stringify(linkBody) });
        const saved = await response.json().catch(function () { return null; });
        if (!response.ok) {
          if (response.status === 409 || saved && String(saved.code || "") === "23505") {
            const existing = await monthlyTableRead(MONTHLY_CONTRACT_LINKS_TABLE,
              "?invoice_key=eq." + encodeURIComponent(invoiceKey) + "&select=invoice_key,contract_id&limit=1", env);
            if (existing.ok && existing.rows[0] && String(existing.rows[0].contract_id) === contractId) return json({ success: true, already_linked: true, invoice_key: invoiceKey });
            return json({ error: "هذه الفاتورة مرتبطة بعقد آخر بالفعل؛ لم يتم تغيير أي رابط" }, 409);
          }
          return json({ error: saved && (saved.message || saved.details || saved.hint || saved.error) || "تعذر حفظ رابط الفاتورة في Supabase" }, 502);
        }
        await broadcastOrdersChanged(env, "monthly-contract-invoice-linked");
        return json({ success: true, linked: true, invoice_key: invoiceKey, original_invoice_unchanged: true });
      }

      if (path === "/api/master/monthly-contracts/deactivate" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const contractId = String(body.contract_id || "").trim();
        if (!contractId) return json({ error: "معرف العقد غير صالح" }, 400);
        const headers = monthlyServiceHeaders(env, { "Content-Type": "application/json", Prefer: "return=representation" });
        if (!headers) return json({ error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في Worker" }, 500);
        const response = await supabaseRequest("/rest/v1/" + MONTHLY_CONTRACTS_TABLE + "?contract_id=eq." + encodeURIComponent(contractId), {
          method: "PATCH", headers: headers, body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() })
        });
        const result = await response.json().catch(function () { return null; });
        if (!response.ok) return json({ error: result && (result.message || result.hint || result.error) || "تعذر إيقاف العقد" }, 502);
        await broadcastOrdersChanged(env, "monthly-contract-deactivate");
        return json({ success: true, deactivated: true, links_preserved: true });
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

        /*
         * المندوب يرى فواتير اليوم والفواتير المستقبلية من الآن.
         * الفاتورة المستقبلية تظهر مقفولة، وتفتح عند 00:00 في يوم delivery_date
         * حسب Asia/Dubai. لا نستخدم created_at لتحديد يوم التوصيل.
         */
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
          const cleaned = Object.assign({}, row, {
            plate_names: stripEmojiText(row.plate_names),
            plate_qtys: stripEmojiText(row.plate_qtys),
            chicken_weights: stripEmojiText(row.chicken_weights),
            chicken_qtys: stripEmojiText(row.chicken_qtys),
            customer_name: stripEmojiText(row.customer_name),
            _delivery_locked: isFutureDeliveryDate(row.delivery_date, dubaiDay),
            _dubai_today: dubaiDay
          });
          if (canCall) return cleaned;
          return Object.assign({}, cleaned, { phone: "" });
        });
        if (safeOrders.length && env.SUPABASE_SERVICE_ROLE_KEY) {
          const monthlyLinks = await monthlyLinkMapForOrders(safeOrders, env);
          if (monthlyLinks.ok) {
            safeOrders.forEach(function (row) {
              const key = monthlyInvoiceKey(row);
              const contractId = monthlyLinks.map.get(key);
              if (contractId) {
                row.monthly_contract_deferred = true;
                row.monthly_contract_id = contractId;
              }
            });
          } else {
            // لا نوقف عرض الطلبات إذا لم تُطبّق ترحيلة العقود بعد؛ لا نضع شارة غير مثبتة.
            console.warn("Monthly contract relation unavailable:", monthlyLinks.error);
          }
        }
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
            canCall,
          dubai_today:
            dubaiDay
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

        // الماستر يعرض كل الفواتير مرة واحدة: الطلبات النشطة من orders
        // والفواتير التي اكتمل تسليمها من master_orders_archive.
        // الأرشيف لم يعد مصدرًا وحيدًا؛ فهو يحتفظ بالمسلّم فقط.
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        const masterReadHeaders = serviceKey
          ? { apikey: serviceKey, Authorization: "Bearer " + serviceKey }
          : { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + auth.token };

        async function readAllMasterRows(tableName) {
          const allRows = [];
          const pageSize = 1000;
          const maxPages = 100;
          for (let page = 0; page < maxPages; page++) {
            const start = page * pageSize;
            const end = start + pageSize - 1;
            const response = await supabaseRequest(
              "/rest/v1/" + tableName + "?select=*&order=id.asc&limit=" + pageSize,
              {
                headers: Object.assign({}, masterReadHeaders, {
                  Range: start + "-" + end,
                  "Range-Unit": "items"
                })
              }
            );
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
            allRows.push.apply(allRows, rows);
            if (rows.length < pageSize) return { ok: true, rows: allRows };
          }
          return { ok: false, status: 502, error: "تجاوز عدد سجلات " + tableName + " حد القراءة الآمن (100000 صف)." };
        }

        const [activeResult, archiveResult] = await Promise.all([
          readAllMasterRows("orders"),
          readAllMasterRows("master_orders_archive")
        ]);

        if (!activeResult.ok || !archiveResult.ok) {
          return json({
            error: "تعذر تحميل كل فواتير الماستر من الطلبات النشطة والأرشيف.",
            orders_error: activeResult.ok ? null : activeResult.error,
            archive_error: archiveResult.ok ? null : archiveResult.error,
            hint: "تأكد من ضبط SUPABASE_SERVICE_ROLE_KEY في أسرار Worker ومن صلاحية القراءة للجدولين."
          }, 502);
        }

        // نعيد نسخ المصدرين مع وسم المصدر حتى تختار واجهة الماستر أحدث نسخة تشغيلية.
        // الواجهة تجمع نسخ المناديب والأرشيف في صف واحد، وتظل أسماء كل المناديب متاحة.
        const activeRows = activeResult.rows.map(function (row) {
          return Object.assign({}, row, { _master_source: "orders" });
        });
        const archivedRows = archiveResult.rows.map(function (row) {
          return Object.assign({}, row, { _master_source: "master_orders_archive" });
        });
        const combinedOrders = activeRows.concat(archivedRows);
        if (serviceKey && combinedOrders.length) {
          const monthlyLinks = await monthlyLinkMapForOrders(combinedOrders, env);
          if (monthlyLinks.ok) {
            combinedOrders.forEach(function (row) {
              const key = monthlyInvoiceKey(row);
              const contractId = monthlyLinks.map.get(key);
              if (contractId) {
                row.monthly_contract_deferred = true;
                row.monthly_contract_id = contractId;
              }
            });
          } else {
            console.warn("Monthly contract relation unavailable in master orders:", monthlyLinks.error);
          }
        }

        return json({
          orders: combinedOrders,
          active_count: activeResult.rows.length,
          archived_count: archiveResult.rows.length,
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
        if (isFutureDeliveryDate(order.delivery_date)) {
          return futureDeliveryLockedResponse(order.delivery_date);
        }

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
          "&select=id,order_number,customer_code,customer_name,sheet_name,paid_in_advance,delivery_status,delivery_date,payment_method&limit=1",
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
        const sourcePaymentMarker = String(sourceOrder.payment_method || "").trim().toLowerCase();
        const activeMonthlyLink = await invoiceHasActiveMonthlyContractLink(sourceOrder, env);
        if (!activeMonthlyLink.ok) return json({ error: "تعذر التحقق من ارتباط العقد الشهري؛ لم يتم تغيير طريقة الدفع", detail: activeMonthlyLink.error }, 503);
        if (activeMonthlyLink.linked || sourcePaymentMarker === "monthly_contract_deferred" || sourcePaymentMarker === "تعاقد شهري آجل") {
          return json({ error: "هذه الفاتورة مرتبطة بتعاقد شهري آجل؛ لا يمكن اختيار الكاش أو التحويل من كارت المندوب." }, 403);
        }
        if (isFutureDeliveryDate(sourceOrder.delivery_date)) {
          return futureDeliveryLockedResponse(sourceOrder.delivery_date);
        }
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

        const liveNotified = await broadcastOrdersChanged(env, "driver_payment_update");
        return json({
          success: true,
          payment_method: paymentMethod,
          payment_label: paymentLabel(paymentMethod),
          synced_orders: Array.isArray(updatedOrders) ? updatedOrders.length : duplicateRows.length,
          synced_master: Array.isArray(archiveData) ? archiveData.length : 0,
          live_notified: liveNotified
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
        if (isFutureDeliveryDate(order.delivery_date)) {
          return futureDeliveryLockedResponse(order.delivery_date);
        }
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

        const liveNotified = await broadcastOrdersChanged(env, "master_transfer_received");
        return json({
          success: true,
          order: rpcData,
          bank_transfer_received: received,
          live_notified: liveNotified
        });
      }

      if (
        path === "/api/gate-photo/delete" &&
        request.method === "POST"
      ) {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        return json({
          success: false,
          code: "PHOTO_DELETE_DISABLED_PENDING_OWNERSHIP_AUDIT",
          error: "حذف صور البوابات موقوف لحين التحقق من ملكية كل صورة وجميع ارتباطاتها. لم يتم حذف ملف أو تعديل رابط."
        }, 409);
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
        const photoScope = String(form.get("photo_scope") || "invoice").trim().toLowerCase();
        const customerCode = String(form.get("customer_code") || "").trim();
        if (!invoiceNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(invoiceNumber)) {
          return json({ error: "رقم الفاتورة أو مفتاح العميل غير صحيح" }, 400);
        }
        if (photoScope !== "invoice" && photoScope !== "customer") {
          return json({ error: "نوع ارتباط الصورة غير صحيح" }, 400);
        }
        if (!/^[A-Za-z0-9_-]{1,70}$/.test(customerCode)) {
          return json({ error: "كود العميل مطلوب لربط الصورة بمالكها" }, 400);
        }
        if (photoScope === "customer" && invoiceNumber !== "CUSTOMER-" + customerCode) {
          return json({ error: "مفتاح صورة العميل لا يطابق كود العميل" }, 400);
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

          // لا نعيد استخدام اسم ملف قديم ولا نسمح بالكتابة فوق كائن موجود.
          const uniqueToken = (typeof crypto.randomUUID === "function")
            ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
          const suffix = customerCode + "-" + uniqueToken + (files.length > 1 ? "-" + (i + 1) : "");
          const extension = allowedTypes[mimeType];
          const objectPath = photoScope === "customer"
            ? "customers/" + customerCode + "/" + suffix + "." + extension
            : "invoices/" + invoiceNumber + "/" + suffix + "." + extension;
          const storagePath = "/storage/v1/object/" + encodeURIComponent(bucketName) + "/" + objectPath.split("/").map(encodeURIComponent).join("/");
          const uploadResponse = await supabaseRequest(storagePath, {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": mimeType,
              "x-upsert": "false",
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
          customer_code: customerCode,
          photo_scope: photoScope,
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

        // لا نحذف صور التخزين قبل نجاح حفظ المزامنة؛ حتى لا يؤدي طلب قديم
        // أو فاشل إلى حذف صور فاتورة أحدث.
        const clearInvoices = Array.from(new Set(
          orders
            .filter(function (order) { return order && (order.clear_gate_photos === true || order.clear_gate_photos === 1 || String(order.clear_gate_photos).toLowerCase() === "true"); })
            .map(function (order) { return String(order.order_number || "").trim(); })
            .filter(function (number) { return /^[a-zA-Z0-9_-]{1,80}$/.test(number); })
        ));
        const deletedPhotoCounts = {};

        const syncServiceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!syncServiceKey) {
          return json({ error: "مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط في أسرار Worker؛ لم تتم مزامنة أي فاتورة." }, 500);
        }

        // حقلا monthly_contract_* بيانات توجيه للـWorker فقط، وليسا عمودين في orders.
        // نحذفهما قبل استدعاء RPC حتى لا نطلب أي تغيير في مخطط جدول الفواتير.
        const rpcOrders = orders.map(function (order) {
          const copy = Object.assign({}, order);
          delete copy.monthly_contract_deferred;
          delete copy.monthly_contract_id;
          return copy;
        });
        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/sync_orders_from_excel",
            {
              method: "POST",
              headers: {
                apikey: syncServiceKey,
                Authorization: "Bearer " + syncServiceKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ p_orders: rpcOrders })
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

        const monthlyAttach = await attachMonthlyContractInvoices(orders, env);
        if (!monthlyAttach.ok) {
          // حفظ الفاتورة قد تم في RPC، لكن لا نعلن اكتمال المزامنة حتى يثبت رابط العقد.
          // إعادة المحاولة آمنة لأن invoice_key فريد والربط idempotent.
          return json({
            error: "تم حفظ الفاتورة، لكن تعذر تثبيت ارتباطها بالعقد الشهري. أعد المزامنة بعد معالجة السبب.",
            monthly_contract_error: monthlyAttach.error,
            success: false
          }, 502);
        }

        let skippedOldRevision = null;
        if (rpcData && typeof rpcData === "object") {
          const rpcResult = Array.isArray(rpcData) ? (rpcData[0] || {}) : rpcData;
          const rawSkipped = rpcResult.skipped_old_revision;
          if (rawSkipped !== undefined && rawSkipped !== null && Number.isFinite(Number(rawSkipped))) {
            skippedOldRevision = Number(rawSkipped);
          }
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

        const rpcResult = Array.isArray(rpcData) ? (rpcData[0] || {}) : (rpcData || {});
        const insertedCount = Number(rpcResult.inserted || 0) || 0;
        const updatedCount = Number(rpcResult.updated || 0) || 0;
        const skippedCount = Number(skippedOldRevision || 0) || 0;
        const rejectedCount = Number(rpcResult.failed || rpcResult.rejected || rpcResult.error_count || 0) || 0;
        const rpcExplicitFailure = rpcResult.success === false || Boolean(rpcResult.error);
        const syncSucceeded = !rpcExplicitFailure && rejectedCount === 0 && skippedCount === 0 && insertedCount + updatedCount === orders.length;

        const liveNotified = syncSucceeded
          ? await broadcastOrdersChanged(env, "desktop_excel_sync")
          : false;
        return json({
          success: syncSucceeded,
          live_notified: liveNotified,
          error: syncSucceeded ? null : (rpcExplicitFailure
            ? String(rpcResult.error || "قاعدة البيانات رفضت المزامنة؛ لم يتم اعتمادها محليًا.")
            : rejectedCount > 0
              ? "قاعدة البيانات رفضت " + rejectedCount + " سجل؛ لم يتم اعتماد المزامنة محليًا."
              : skippedCount > 0
                ? "تم تجاهل " + skippedCount + " فاتورة بسبب رقم مراجعة قديم؛ لم يتم اعتماد المزامنة محليًا."
                : "عدد الفواتير التي أكدت قاعدة البيانات معالجتها لا يطابق عدد الفواتير المرسلة."),
          received: orders.length,
          processed: insertedCount + updatedCount,
          inserted: insertedCount,
          updated: updatedCount,
          failed: skippedCount + rejectedCount,
          data: rpcData,
          gate_photos_cleared: 0,
          gate_photo_files_deleted: {},
          gate_photo_file_deletion_skipped: photosDeletionSkipped || !syncSucceeded,
          monthly_contract_links_created: monthlyAttach.linked,
          monthly_contract_links_already_present: monthlyAttach.already,
          skipped_old_revision: skippedCount
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

        const statusServiceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!statusServiceKey) return json({ error: "مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط في أسرار Worker" }, 500);
        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/get_order_delivery_statuses",
            {
              method: "POST",
              headers: {
                apikey: statusServiceKey,
                Authorization: "Bearer " + statusServiceKey,
                "Content-Type": "application/json"
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
          "/rest/v1/orders?id=eq." + encodeURIComponent(req.order_id) + "&sheet_name=eq." + encodeURIComponent(req.sheet_name),
          { method: "PATCH", headers: Object.assign({}, H, { Prefer: "return=representation" }), body: JSON.stringify({ delivery_status: "delivered" }) }
        );
        const changed = await orderRes.json().catch(function () { return null; });
        if (!orderRes.ok || !Array.isArray(changed) || !changed.length) return json({ error: (changed && (changed.message || changed.hint || changed.error)) || "تعذر اعتماد حالة التسليم في الفاتورة" }, 502);

        const doneRes = await supabaseRequest(
          "/rest/v1/driver_delivery_requests?id=eq." + requestId + "&status=eq.pending",
          { method: "PATCH", headers: Object.assign({}, H, { Prefer: "return=minimal" }), body: JSON.stringify({ status: "approved", processed_at: new Date().toISOString() }) }
        );
        if (!doneRes.ok) return json({ error: "تم تحديث الفاتورة لكن تعذر إغلاق طلب الاعتماد" }, 502);
        const liveNotified = await broadcastOrdersChanged(env, "desktop_delivery_approved");
        return json({ success: true, order_number: req.invoice_number, delivery_status: "delivered", live_notified: liveNotified });
      }

      if (path === "/api/resolve-map" && method === "POST") {
        try {
          const body = await request.json();
          let finalUrl = String(body.url || "").trim();
          if (!/^https?:\/\//i.test(finalUrl)) {
            return json({ ok: false, error: "رابط غير صالح" }, 400);
          }
          let coords = null;
          for (let hop = 0; hop < 6; hop++) {
            const m = finalUrl.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ||
                      finalUrl.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ||
                      finalUrl.match(/[?&](?:q|query|destination)=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
            if (m) { coords = [parseFloat(m[1]), parseFloat(m[2])]; break; }
            const resp = await fetch(finalUrl, { method: "GET", redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
            const loc = resp.headers.get("location");
            if (!loc) break;
            finalUrl = new URL(loc, finalUrl).toString();
          }
          return json({ ok: true, url: finalUrl, coords: coords });
        } catch (e) {
          return json({ ok: false, error: String(e && e.message || e) }, 500);
        }
      }

      if (path === "/api/master/order/update-by-identity" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const identity = body.identity && typeof body.identity === "object" ? body.identity : {};
        const order = body.order && typeof body.order === "object" ? body.order : null;
        const orderNumber = String(identity.order_number || "").trim();
        const deliveryDate = String(order && order.delivery_date || "").slice(0, 10);
        const identityPhone = invoiceDigits(identity.phone);
        const identityCustomer = invoiceNorm(identity.customer_name);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !order ||
            !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ||
            (!identityPhone && identityCustomer.length < 3)) {
          return json({ error: "بيانات الفاتورة أو تاريخ التوصيل أو هوية العميل غير صحيحة" }, 400);
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
        if (foundOrders.ambiguous) {
          return json({ error: "نسخ الطلبات النشطة غير محددة بأمان. لم يتم تعديل أي شيء.", ambiguous_orders: true }, 409);
        }

        // ضم نسخة الأرشيف المرتبطة مباشرةً بنفس id + رقم الفاتورة + المندوب،
        // حتى لو كان delivery_date في الأرشيف فارغًا بينما orders يحمل التاريخ الصحيح.
        const exactArchiveCounterparts = archiveRows.filter(function (archived) {
          return foundOrders.rows.some(function (active) {
            return String(active.id) === String(archived.id) &&
              String(active.order_number || '').trim() === String(archived.order_number || '').trim() &&
              String(active.sheet_name || '').trim() === String(archived.sheet_name || '').trim();
          });
        });
        const archiveMap = new Map();
        foundArchive.rows.concat(exactArchiveCounterparts).forEach(function (row) {
          archiveMap.set(String(row.id), row);
        });
        foundArchive.rows = Array.from(archiveMap.values());
        if (foundArchive.ambiguous) {
          const allArchiveForIdentity = archiveRows.filter(function (row) {
            if (String(row.order_number || '').trim() !== orderNumber) return false;
            const savedDate = String(row.delivery_date || '').slice(0, 10);
            return !savedDate || savedDate === String(identity.delivery_date || '').slice(0, 10);
          });
          if (!exactArchiveCounterparts.length || exactArchiveCounterparts.length < allArchiveForIdentity.length) {
            return json({ error: "نسخ الأرشيف لنفس الفاتورة غير محددة بأمان. لم يتم تعديل أي شيء.", ambiguous_archive: true }, 409);
          }
          foundArchive.ambiguous = false;
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
        const requestedAllDrivers = !requestedSheet || requestedSheet.toUpperCase() === 'ALL';
        const hasMultipleDriverCopies = currentSheets.length > 1;
        // التعديل من الكمبيوتر يحدّث بيانات الفاتورة في كل النسخ المطابقة.
        // عند وجودها لدى أكثر من مندوب، لا نرفض الحفظ ولا ننقل النسخ إلى مندوب واحد؛
        // نُبقي sheet_name لكل نسخة كما هو ونحدّث باقي الحقول في جميع النسخ.
        // إذا كانت نسخة واحدة فقط، يُسمح بتغيير المندوب عند اختيار مندوب محدد.

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

        // لا ننقل الفاتورة عند اختيار ALL أو عند وجود نسخ لدى أكثر من مندوب.
        // تغيير المندوب يظل متاحًا فقط عندما توجد نسخة واحدة ويُختار مندوب محدد.
        if (currentSheets.length === 1 && !requestedAllDrivers && requestedSheet !== currentSheets[0]) {
          if (foundOrders.rows.length) ordersPatch.sheet_name = requestedSheet;
          if (foundArchive.rows.length) archivePatch.sheet_name = requestedSheet;
        }
        if (Object.prototype.hasOwnProperty.call(order, "sync_revision")) {
          ordersPatch.sync_revision = Math.max(0, Number(order.sync_revision) || 0);
        }

        // تعديل الكمبيوتر هو التعديل المركزي: لا نمسح طريقة الدفع من نسخ المناديب.
        // يجب أن تصل القيمة المختارة في الكمبيوتر إلى كل نسخة مطابقة فورًا.
        const statusRaw = String(ordersPatch.delivery_status || "").toLowerCase();
        const delivered = statusRaw === "delivered" || statusRaw.includes("تم");
        const paymentRaw = String(ordersPatch.payment_method || "").trim();
        if (ordersPatch.paid_in_advance === true || /مقدم/.test(paymentRaw)) {
          ordersPatch.paid_in_advance = true;
          archivePatch.paid_in_advance = true;
        }

        const ordersFilter = invoiceIdFilter(foundOrders.rows);
        const activeIds = new Set(foundOrders.rows.map(function (row) { return String(row.id); }));
        const archiveOnlyRows = foundArchive.rows.filter(function (row) { return !activeIds.has(String(row.id)); });
        const archiveOnlyFilter = invoiceIdFilter(archiveOnlyRows);
        const targetIsDelivered = delivered;

        // السجل الموجود في الأرشيف فقط لا يمكن تحويله إلى out من دون إعادة
        // إنشاء نسخة نشطة؛ نرفض قبل أي كتابة حتى لا تحدث مزامنة جزئية.
        if (archiveOnlyRows.length && !foundOrders.rows.length && !targetIsDelivered) {
          return json({ error: "الفاتورة موجودة في الأرشيف فقط ولا توجد نسخة نشطة عند المناديب لإعادتها إلى قيد التوصيل. لم يتم اعتماد التعديل.", updated_orders: 0, updated_archive: 0 }, 409);
        }
        if (archiveOnlyRows.length && foundOrders.rows.length && !targetIsDelivered) {
          return json({ error: "توجد نسخة تاريخية فقط لأحد المندوبين. لا يمكن إرجاعها إلى قيد التوصيل تلقائيًا؛ لم يتم اعتماد التعديل لتجنب اختلاف النسخ.", updated_orders: 0, updated_archive: 0 }, 409);
        }

        let updatedOrders = [];
        let updatedArchive = [];
        if (ordersFilter) {
          const response = await supabaseRequest("/rest/v1/orders?" + ordersFilter, { method: "PATCH", headers: H, body: JSON.stringify(ordersPatch) });
          updatedOrders = await response.json().catch(function () { return null; });
          if (!response.ok || !Array.isArray(updatedOrders) || updatedOrders.length !== foundOrders.rows.length) {
            return json({ error: "تعذر تحديث كل نسخ المناديب؛ راجع قاعدة البيانات قبل إعادة المحاولة.", updated_orders: Array.isArray(updatedOrders) ? updatedOrders.length : 0, expected_orders: foundOrders.rows.length }, 502);
          }
        }

        // النسخ ذات المعرف نفسه في orders يتولى Trigger الأرشفة تحديثها.
        // نحدّث فقط سجلات الأرشيف التاريخية التي لا يقابلها سجل نشط في orders.
        let archiveManagedByOrderTrigger = foundOrders.rows.length > 0;
        if (archiveOnlyFilter) {
          const response = await supabaseRequest("/rest/v1/master_orders_archive?" + archiveOnlyFilter, { method: "PATCH", headers: H, body: JSON.stringify(archivePatch) });
          updatedArchive = await response.json().catch(function () { return null; });
          if (!response.ok || !Array.isArray(updatedArchive) || updatedArchive.length !== archiveOnlyRows.length) {
            return json({ error: "تم تحديث الطلبات النشطة لكن تعذر تحديث بعض النسخ التاريخية؛ راجع قاعدة البيانات فورًا.", updated_orders: updatedOrders.length, updated_archive: Array.isArray(updatedArchive) ? updatedArchive.length : 0, expected_archive: archiveOnlyRows.length }, 502);
          }
        }
        const updatedSheets = Array.from(new Set(foundOrders.rows.concat(foundArchive.rows)
          .map(function (row) { return String(row.sheet_name || '').trim(); }).filter(Boolean)));
        const liveNotified = await broadcastOrdersChanged(env, "desktop_invoice_update");
        return json({
          success: true,
          order_number: orderNumber,
          updated_orders: updatedOrders.length,
          updated_archive: updatedArchive.length,
          archive_managed_by_orders_trigger: archiveManagedByOrderTrigger,
          updated_sheets: updatedSheets,
          driver_assignment_preserved: hasMultipleDriverCopies || requestedAllDrivers,
          delivery_date: deliveryDate,
          live_notified: liveNotified,
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
        const liveNotified = await broadcastOrdersChanged(env, "master_update_by_number");
        return json({ success: true, updated: orderNumber, live_notified: liveNotified });
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
        const pmRaw = String(set.payment_method || "").trim();
        // مسار excel-correct خاص بتعديلات الكمبيوتر؛ لا تُخفِ الدفع المختار عن المندوب.
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
        const liveNotified = await broadcastOrdersChanged(env, "desktop_excel_correct");
        return json({ success: true, updated: orderNumber, live_notified: liveNotified });
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

      /* سحب فاتورة مستقبلية من قوائم المناديب مع الاحتفاظ بأرشيف الماستر */
      if (path === "/api/master/order/recall-future" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return {}; });
        const orderNumber = String(body.order_number || "").trim();
        const sheetName = String(body.sheet_name || "").trim();
        const requestedDate = String(body.delivery_date || "").slice(0, 10);
        const allSheets = sheetName.toUpperCase() === "ALL";
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !sheetName || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
          return json({ error: "بيانات الفاتورة أو تاريخ التوصيل غير صحيحة" }, 400);
        }
        const dubaiToday = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
        if (requestedDate <= dubaiToday) return json({ error: "السحب مسموح للفواتير المستقبلية فقط", requested_date: requestedDate, dubai_today: dubaiToday }, 409);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط في أسرار Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=representation" };
        let query = "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,created_at";
        if (!allSheets) query += "&sheet_name=eq." + encodeURIComponent(sheetName);
        const findResp = await supabaseRequest(query, { headers: H });
        const found = await findResp.json().catch(function () { return null; });
        if (!findResp.ok || !Array.isArray(found)) return json({ error: "تعذر البحث عن الفاتورة في جدول orders", details: found }, 502);
        const futureRows = found.filter(function (row) {
          const savedDate = String(row.delivery_date || "").slice(0, 10);
          return savedDate === requestedDate && savedDate > dubaiToday && (allSheets || String(row.sheet_name || "") === sheetName);
        });
        if (!futureRows.length) {
          return json({ error: "لم أجد نسخة مستقبلية مطابقة في قائمة المناديب؛ لم يتم حذف أي شيء.", requested: { order_number: orderNumber, sheet_name: sheetName, delivery_date: requestedDate }, database_rows: found }, 404);
        }
        const ids = futureRows.map(function (row) { return Number(row.id); }).filter(function (id) { return Number.isInteger(id) && id > 0; });
        if (!ids.length) return json({ error: "تعذر تحديد معرفات النسخ؛ لم يتم حذف أي شيء." }, 409);
        const departureResp = await supabaseRequest("/rest/v1/driver_departures?order_id=in.(" + ids.join(",") + ")", { method: "DELETE", headers: H });
        if (!departureResp.ok && departureResp.status !== 404) {
          const err = await departureResp.json().catch(function () { return {}; });
          return json({ error: "تعذر إزالة سجل تحرك المندوب؛ لم يتم السحب.", details: err }, 502);
        }
        const delResp = await supabaseRequest("/rest/v1/orders?id=in.(" + ids.join(",") + ")", { method: "DELETE", headers: H });
        const removedRows = await delResp.json().catch(function () { return null; });
        if (!delResp.ok || !Array.isArray(removedRows) || removedRows.length !== ids.length) {
          return json({ error: "تعذر سحب كل نسخ الفاتورة من المناديب؛ لم يتم اعتبار العملية ناجحة.", removed: Array.isArray(removedRows) ? removedRows.length : 0, expected: ids.length }, 502);
        }
        return json({ success: true, removed: removedRows.length, archive_preserved: true, order_number: orderNumber, sheet_names: Array.from(new Set(futureRows.map(function (row) { return row.sheet_name; }))), delivery_date: requestedDate });
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
        const liveNotified = await broadcastOrdersChanged(env, "master_delete_by_identity");
        return json({ success: true, deleted: orderNumber, deleted_orders: deletedOrders.length, deleted_archive: deletedArchive.length, driver_departures_removed: orderIds.length, live_notified: liveNotified });
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
        const archiveDeleteResponse = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber),
          { method: "DELETE", headers: svcHeaders }
        );
        if (!archiveDeleteResponse.ok) {
          return json({ error: "تم حذف الفاتورة من الطلبات لكن تعذر حذف نسخة الأرشيف" }, 502);
        }

        const liveNotified = await broadcastOrdersChanged(env, "master_delete_by_number");
        return json({
          success: true,
          deleted: orderNumber,
          orders_deleted: found.length,
          live_notified: liveNotified
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
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط" }, 500);
        const body = await request.json().catch(function () { return {}; });
        const orderNumber = String(body.order_number || "").trim();
        const received = body.received !== false;
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) return json({ error: "رقم الفاتورة غير صحيح" }, 400);

        const baseHeaders = {
          apikey: svc,
          Authorization: "Bearer " + svc,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        };
        /* جدول orders لا يحتوي على updated_at حسب مخطط قاعدة البيانات؛ لا ترسل هذا العمود إليه. */
        const ordersPatch = { bank_transfer_received: received };
        const archivePatch = {
          bank_transfer_received: received,
          updated_at: new Date().toISOString()
        };

        const r1 = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,sheet_name",
          { method: "PATCH", headers: baseHeaders, body: JSON.stringify(ordersPatch) }
        );
        const ordersRows = await r1.json().catch(function () { return null; });
        if (!r1.ok) {
          return json({
            error: (ordersRows && (ordersRows.message || ordersRows.hint || ordersRows.details || ordersRows.error)) || "تعذر تحديث نسخ المناديب",
            stage: "orders_update"
          }, 502);
        }

        const r2 = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,sheet_name",
          { method: "PATCH", headers: baseHeaders, body: JSON.stringify(archivePatch) }
        );
        const archiveRows = await r2.json().catch(function () { return null; });
        if (!r2.ok) {
          return json({
            error: (archiveRows && (archiveRows.message || archiveRows.hint || archiveRows.details || archiveRows.error)) || "تم تحديث الطلبات النشطة لكن تعذر تحديث الأرشيف",
            stage: "archive_update",
            updated_orders: Array.isArray(ordersRows) ? ordersRows.length : 0
          }, 502);
        }

        const updatedOrders = Array.isArray(ordersRows) ? ordersRows.length : 0;
        const updatedArchive = Array.isArray(archiveRows) ? archiveRows.length : 0;
        if (updatedOrders + updatedArchive === 0) {
          return json({ error: "لم يتم العثور على الفاتورة في الطلبات النشطة أو الأرشيف", order_number: orderNumber }, 404);
        }
        return json({
          success: true,
          order_number: orderNumber,
          bank_transfer_received: received,
          updated_orders: updatedOrders,
          updated_archive: updatedArchive,
          updated_total: updatedOrders + updatedArchive
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
