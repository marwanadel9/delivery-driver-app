const SUPABASE_URL = "https://wnfibznjxihilgfedfij.supabase.co";

const DRIVER_EMAILS = {
zain: "[nasegypt9@gmail.com](mailto:nasegypt9@gmail.com)",
zain2: "[moomaro990@gmail.com](mailto:moomaro990@gmail.com)"
};

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

const user = await getUser(token, env.SUPABASE_ANON_KEY);

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

function normalizePayment(value) {
const v = String(value || "").trim().toLowerCase();

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

export default {
async fetch(request, env) {
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

```
const url = new URL(request.url);
const path = url.pathname;

try {
  if (path === "/api/login" && request.method === "POST") {
    const body = await request.json().catch(function () {
      return {};
    });

    const username = String(body.username || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");

    if (!username || !password) {
      return json(
        {
          error: "يرجى إدخال اسم المستخدم وكلمة المرور"
        },
        400
      );
    }

    const email = DRIVER_EMAILS[username];

    if (!email) {
      return json(
        {
          error: "اسم المستخدم أو كلمة المرور غير صحيحة"
        },
        401
      );
    }

    if (!env.SUPABASE_ANON_KEY) {
      return json(
        {
          error: "مفتاح Supabase غير موجود في Cloudflare"
        },
        500
      );
    }

    const authResponse = await supabaseRequest(
      "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email,
          password: password
        })
      }
    );

    const authData = await authResponse.json().catch(function () {
      return {};
    });

    if (!authResponse.ok) {
      return json(
        {
          error: "اسم المستخدم أو كلمة المرور غير صحيحة"
        },
        401
      );
    }

    const driver = await getDriverInfo(
      authData.access_token,
      env.SUPABASE_ANON_KEY,
      authData.user && authData.user.id
    );

    if (!driver) {
      return json(
        {
          error: "المندوب غير مسجل في النظام"
        },
        403
      );
    }

    return json({
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
      expires_in: authData.expires_in,
      username: username,
      mandoub_name: driver.mandoub_name,
      sheet_name: driver.sheet_name,
      can_call: username === "zain2"
    });
  }

  if (path === "/api/refresh" && request.method === "POST") {
    const body = await request.json().catch(function () {
      return {};
    });

    const refreshToken = String(body.refresh_token || "").trim();

    if (!refreshToken) {
      return json(
        {
          error: "لا يوجد refresh token"
        },
        401
      );
    }

    const authResponse = await supabaseRequest(
      "/auth/v1/token?grant_type=refresh_token",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          refresh_token: refreshToken
        })
      }
    );

    const authData = await authResponse.json().catch(function () {
      return {};
    });

    if (!authResponse.ok) {
      return json(
        {
          error: "انتهت الجلسة"
        },
        401
      );
    }

    const driver = await getDriverInfo(
      authData.access_token,
      env.SUPABASE_ANON_KEY,
      authData.user && authData.user.id
    );

    if (!driver) {
      return json(
        {
          error: "المندوب غير مسجل"
        },
        403
      );
    }

    const username =
      authData.user &&
      authData.user.email === DRIVER_EMAILS.zain2
        ? "zain2"
        : "zain";

    return json({
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
      expires_in: authData.expires_in,
      username: username,
      mandoub_name: driver.mandoub_name,
      sheet_name: driver.sheet_name,
      can_call: username === "zain2"
    });
  }

  if (path === "/api/orders" && request.method === "GET") {
    const auth = await requireDriver(request, env);

    if (auth.error) {
      return json(
        {
          error: auth.error
        },
        auth.status
      );
    }

    const sheet = auth.driver.sheet_name;

    const ordersPath =
      "/rest/v1/orders?sheet_name=eq." +
      encodeURIComponent(sheet) +
      "&select=*";

    const ordersResponse = await supabaseRequest(
      ordersPath,
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + auth.token
        }
      }
    );

    const orders = await ordersResponse.json().catch(function () {
      return [];
    });

    if (!ordersResponse.ok) {
      return json(
        {
          error: "تعذر تحميل الطلبات"
        },
        500
      );
    }

    return json({
      orders: Array.isArray(orders) ? orders : [],
      sheet: sheet,
      mandoub_name: auth.driver.mandoub_name,
      can_call: auth.user.email === DRIVER_EMAILS.zain2
    });
  }

  if (path === "/api/payment" && request.method === "POST") {
    const auth = await requireDriver(request, env);

    if (auth.error) {
      return json(
        {
          error: auth.error
        },
        auth.status
      );
    }

    const body = await request.json().catch(function () {
      return {};
    });

    const orderId = Number(body.orderId);
    const paymentMethod = normalizePayment(body.payment_method);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return json(
        {
          error: "رقم الطلب غير صحيح"
        },
        400
      );
    }

    if (!paymentMethod) {
      return json(
        {
          error: "طريقة الدفع غير صحيحة"
        },
        400
      );
    }

    const rpcResponse = await supabaseRequest(
      "/rest/v1/rpc/set_order_payment_method",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + auth.token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_order_id: orderId,
          p_payment_method: paymentMethod
        })
      }
    );

    const rpcData = await rpcResponse.json().catch(function () {
      return null;
    });

    if (!rpcResponse.ok) {
      return json(
        {
          error:
            (rpcData && rpcData.message) ||
            (rpcData && rpcData.hint) ||
            (rpcData && rpcData.error) ||
            "تعذر حفظ طريقة الدفع"
        },
        400
      );
    }

    return json({
      success: true,
      payment_method: paymentMethod,
      payment_label: paymentLabel(paymentMethod)
    });
  }

  if (path === "/api/deliver" && request.method === "POST") {
    const auth = await requireDriver(request, env);

    if (auth.error) {
      return json(
        {
          error: auth.error
        },
        auth.status
      );
    }

    const body = await request.json().catch(function () {
      return {};
    });

    const orderId = Number(body.orderId);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return json(
        {
          error: "رقم الطلب غير صحيح"
        },
        400
      );
    }

    const rpcResponse = await supabaseRequest(
      "/rest/v1/rpc/mark_order_delivered",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + auth.token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_order_id: orderId
        })
      }
    );

    const rpcData = await rpcResponse.json().catch(function () {
      return null;
    });

    if (!rpcResponse.ok) {
      return json(
        {
          error:
            (rpcData && rpcData.message) ||
            (rpcData && rpcData.hint) ||
            (rpcData && rpcData.error) ||
            "تعذر تسجيل التسليم"
        },
        400
      );
    }

    return json({
      success: true,
      delivery_status: "delivered"
    });
  }

  if (path === "/api/excel-sync" && request.method === "POST") {
    const secret =
      request.headers.get("X-Excel-Sync-Secret") || "";

    if (
      !env.EXCEL_SYNC_SECRET ||
      secret !== env.EXCEL_SYNC_SECRET
    ) {
      return json(
        {
          error: "غير مصرح"
        },
        401
      );
    }

    const body = await request.json().catch(function () {
      return null;
    });

    if (!body) {
      return json(
        {
          error: "بيانات غير صحيحة"
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

    const rpcResponse = await supabaseRequest(
      "/rest/v1/rpc/sync_orders_from_excel",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + env.SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_orders: orders
        })
      }
    );

    const rpcData = await rpcResponse.json().catch(function () {
      return null;
    });

    if (!rpcResponse.ok) {
      return json(
        {
          error:
            (rpcData && rpcData.message) ||
            (rpcData && rpcData.hint) ||
            (rpcData && rpcData.error) ||
            "فشل مزامنة Excel"
        },
        500
      );
    }

    return json({
      success: true,
      data: rpcData
    });
  }

  if (path === "/api/excel-status" && request.method === "GET") {
    const secret =
      request.headers.get("X-Excel-Sync-Secret") || "";

    if (
      !env.EXCEL_SYNC_SECRET ||
      secret !== env.EXCEL_SYNC_SECRET
    ) {
      return json(
        {
          error: "غير مصرح"
        },
        401
      );
    }

    const rpcResponse = await supabaseRequest(
      "/rest/v1/rpc/get_order_delivery_statuses",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + env.SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await rpcResponse.json().catch(function () {
      return null;
    });

    if (!rpcResponse.ok) {
      return json(
        {
          error:
            (data && data.message) ||
            (data && data.hint) ||
            (data && data.error) ||
            "تعذر قراءة حالات التسليم"
        },
        500
      );
    }

    return json(data);
  }

  if (
    env.ASSETS &&
    typeof env.ASSETS.fetch === "function"
  ) {
    return env.ASSETS.fetch(request);
  }

  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
} catch (error) {
  return json(
    {
      error:
        error && error.message
          ? error.message
          : "حدث خطأ غير متوقع"
    },
    500
  );
}
```

}
};
