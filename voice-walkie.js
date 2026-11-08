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
          "/rest/v1/orders?select=id,order_number,created_at,customer_name,total&sheet_name=eq." + encodeURIComponent(sheet) + "&id=in.(" + orderIds.join(",") + ")",
          { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } }
        );
        const ownedOrders = await ordersResponse.json().catch(function () { return []; });
        if (!ordersResponse.ok || !Array.isArray(ownedOrders) || ownedOrders.length !== orderIds.length) {
          return json({ error: "تعذر التحقق من فواتير المندوب الحالي", detail: ownedOrders }, 403);
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

        /* ⭐ المندوب يشوف فواتير «اليوم» فقط — واليوم بيتحسب بتوقيت دبي (UTC+4)
           مش UTC: الشغل المرفوع بعد منتصف الليل بتوقيتك (مثلًا 1:30 ص) بيتسجل
           على السيرفر بليلة الأمس بالتوقيت العالمي، وفلتر UTC كان بيخفيه */
        const dubaiNowMs = Date.now() + (4 * 3600 * 1000);
        const dubaiDay = new Date(dubaiNowMs).toISOString().slice(0, 10);
        const ordersPath =
          "/rest/v1/orders?sheet_name=eq." +
          encodeURIComponent(sheet) +
          "&select=*" +
          "&delivery_date=eq." +
          encodeURIComponent(dubaiDay);

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
            customer_name: stripEmojiText(row.customer_name)
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
          "/rest/v1/orders?id=eq." + encodeURIComponent(orderId) + "&sheet_name=eq." + encodeURIComponent(auth.driver.sheet_name) + "&select=id,order_number,customer_name,phone,emirate,area,total,sheet_name&limit=1",
          { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
        );
        const orderRows = await orderResponse.json().catch(function () { return null; });
        if (!orderResponse.ok) return json({ error: (orderRows && (orderRows.message || orderRows.hint || orderRows.error)) || "تعذر التحقق من الفاتورة" }, 502);
        if (!Array.isArray(orderRows) || !orderRows.length) return json({ error: "الفاتورة غير موجودة ضمن طلبات حسابك" }, 404);
        const order = orderRows[0];

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
          "&select=id,order_number,customer_name,sheet_name,paid_in_advance,delivery_status&limit=1",
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
          "&select=id,order_number,customer_name,sheet_name,delivery_status,paid_in_advance&limit=1",
          { headers: serviceHeaders }
        );
        const orderRows = await orderResponse.json().catch(function () { return null; });
        if (!orderResponse.ok) return json({ error: (orderRows && (orderRows.message || orderRows.hint || orderRows.error)) || "تعذر التحقق من الفاتورة" }, 502);
        if (!Array.isArray(orderRows) || !orderRows.length) return json({ error: "الفاتورة غير موجودة ضمن طلبات حسابك" }, 404);
        const order = orderRows[0];
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

        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/sync_orders_from_excel",
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
              },
              body:
                JSON.stringify({
                  p_orders:
                    orders
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
        return json({ success: true, order_number: req.invoice_number, delivery_status: "delivered" });
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
        if (currentSheets.length > 1 && requestedSheet && currentSheets.indexOf(requestedSheet) === -1) {
          return json({ error: "الفاتورة موجودة عند أكثر من مندوب. تم رفض تغيير المندوب حتى لا تنتقل كل النسخ إلى مندوب واحد؛ تم الحفاظ على نسخ جميع المناديب دون تعديل.", driver_sheets: currentSheets }, 409);
        }

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
        return json({
          success: true,
          order_number: orderNumber,
          updated_orders: updatedOrders.length,
          updated_archive: updatedArchive.length,
          archive_managed_by_orders_trigger: archiveManagedByOrderTrigger,
          updated_sheets: updatedSheets,
          delivery_date: deliveryDate,
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
        return json({ success: true, updated: orderNumber });
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
        return json({ success: true, updated: orderNumber });
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
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "غير مصرح" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "مفتاح الخدمة غير مضبوط" }, 500);
        const body = await request.json().catch(function () { return {}; });
        const orderNumber = String(body.order_number || "").trim();
        const received = body.received !== false;
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=minimal" };
        const patch = { bank_transfer_received: received };
        patch.updated_at = new Date().toISOString();
        const r1 = await supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(patch) });
        if (!r1.ok) { const e1 = await r1.json().catch(function () { return null; }); return json({ error: (e1 && (e1.message || e1.hint || e1.error)) || "تعذر تحديث نسخ المناديب" }, 502); }
        const r2 = await supabaseRequest("/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(patch) });
        if (!r2.ok) { const e2 = await r2.json().catch(function () { return null; }); return json({ error: (e2 && (e2.message || e2.hint || e2.error)) || "تم تحديث المناديب وتعذر تحديث أرشيف الماستر" }, 502); }
        return json({ success: true, order_number: orderNumber, bank_transfer_received: received });
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
