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

        const ordersPath =
          "/rest/v1/orders?sheet_name=eq." +
          encodeURIComponent(sheet) +
          "&select=*";

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

        const ordersResponse =
          await supabaseRequest(
            "/rest/v1/master_orders_archive?select=*&order=id.asc",
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
                "تعذر تحميل أرشيف فواتير الماستر. تأكد من تشغيل SQL الخاص بصلاحيات الأرشيف."
            },
            500
          );
        }

        return json({
          orders:
            Array.isArray(orders)
              ? orders
              : [],
          username:
            MASTER_USERNAME,
          email:
            MASTER_EMAIL,
          role:
            "master_admin"
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
          "&select=id,order_number,customer_name,sheet_name&limit=1",
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
                "رقم الطلب غير صحيح"
            },
            400
          );
        }

        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/mark_order_delivered",
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
          return json(
            {
              error:
                (rpcData &&
                  rpcData.message) ||
                (rpcData &&
                  rpcData.hint) ||
                (rpcData &&
                  rpcData.error) ||
                "تعذر تسجيل التسليم"
            },
            400
          );
        }

        return json({
          success:
            true,
          delivery_status:
            "delivered"
        });
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
                "تعذر تعديل الفاتورة"
            },
            400
          );
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
            "bank_transfer_received"
          ];

          for (const field of archiveFields) {
            if (rpcData && Object.prototype.hasOwnProperty.call(rpcData, field)) {
              archivePatchBody[field] = rpcData[field];
            }
          }

          const archivePatchResponse = await supabaseRequest(
            "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(invoiceNumber),
            {
              method: "PATCH",
              headers: {
                apikey: env.SUPABASE_ANON_KEY,
                Authorization: "Bearer " + auth.token,
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

        // عند إرسال clear_gate_photos=true، احذف الملفات والروابط قبل حفظ المزامنة.
        const clearInvoices = Array.from(new Set(
          orders
            .filter(function (order) { return order && (order.clear_gate_photos === true || order.clear_gate_photos === 1 || String(order.clear_gate_photos).toLowerCase() === "true"); })
            .map(function (order) { return String(order.order_number || "").trim(); })
            .filter(function (number) { return /^[a-zA-Z0-9_-]{1,80}$/.test(number); })
        ));
        const deletedPhotoCounts = {};
        try {
          for (const invoiceNumber of clearInvoices) {
            deletedPhotoCounts[invoiceNumber] = await clearGatePhotosForInvoice(invoiceNumber, env);
          }
        } catch (photoError) {
          return json({ error: photoError.message || "فشل حذف صور البوابة؛ لم تكتمل المزامنة" }, 502);
        }

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

        return json({
          success: true,
          data: rpcData,
          gate_photos_cleared: clearInvoices.length,
          gate_photo_files_deleted: deletedPhotoCounts
        });
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

        return json(data);
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

      if (
        env.ASSETS &&
        typeof env.ASSETS.fetch ===
          "function"
      ) {
        return env.ASSETS.fetch(
          request
        );
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
