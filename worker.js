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
    const path = url.pathname;

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

        return json({
          orders:
            Array.isArray(orders)
              ? orders
              : [],
          sheet:
            sheet,
          mandoub_name:
            auth.driver.mandoub_name,
          can_call:
            auth.user.email ===
            DRIVER_EMAILS.zain2
        });
      }

      if (
        path === "/api/master/customer-balances" &&
        request.method === "GET"
      ) {
        const auth = await requireMaster(request, env);
        if (auth.error) {
          return json({ error: auth.error }, auth.status);
        }
        if (!env.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "إعداد عرض أرصدة العملاء غير مكتمل: SUPABASE_SERVICE_ROLE_KEY" }, 500);
        }

        const balanceResponse = await supabaseRequest(
          "/rest/v1/customer_balances?select=customer_code,customer_name,phone,amount_added,amount_paid,current_balance,notes,area,emirate,order_ref,updated_at&order=customer_name.asc",
          {
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY
            }
          }
        );
        const balanceData = await balanceResponse.json().catch(function () { return null; });
        if (!balanceResponse.ok) {
          return json({
            error: (balanceData && (balanceData.message || balanceData.hint || balanceData.error)) || "تعذر تحميل أرصدة العملاء"
          }, 502);
        }
        return json({ success: true, balances: Array.isArray(balanceData) ? balanceData : [] });
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
        path === "/api/payment" &&
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

        const paymentMethod =
          normalizePayment(
            body.payment_method
          );

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

        if (!paymentMethod) {
          return json(
            {
              error:
                "طريقة الدفع غير صحيحة"
            },
            400
          );
        }

        const rpcResponse =
          await supabaseRequest(
            "/rest/v1/rpc/set_order_payment_method",
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
                  p_payment_method:
                    paymentMethod
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
                "تعذر حفظ طريقة الدفع"
            },
            400
          );
        }

        return json({
          success:
            true,
          payment_method:
            paymentMethod,
          payment_label:
            paymentLabel(
              paymentMethod
            )
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

        return json({
          success:
            true,
          order:
            rpcData
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
          return json({ error: "يجب إرسال الصورة بصيغة multipart/form-data" }, 400);
        }

        const form = await request.formData().catch(function () { return null; });
        if (!form) {
          return json({ error: "تعذر قراءة بيانات الصورة" }, 400);
        }

        const file = form.get("file");
        const invoiceNumber = String(form.get("invoice_number") || "").trim();

        if (!file || typeof file.arrayBuffer !== "function") {
          return json({ error: "لم يتم اختيار صورة" }, 400);
        }

        if (!invoiceNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(invoiceNumber)) {
          return json({ error: "رقم الفاتورة غير صحيح" }, 400);
        }

        const mimeType = String(file.type || "").toLowerCase();
        const allowedTypes = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp"
        };

        if (!allowedTypes[mimeType]) {
          return json({ error: "الصيغ المسموحة: JPG وPNG وWEBP" }, 400);
        }

        if (file.size > 8 * 1024 * 1024) {
          return json({ error: "حجم الصورة يجب ألا يتجاوز 8 ميجابايت" }, 400);
        }

        const bucketName = "gate-photos 3";
        const objectPath = "invoices/" + invoiceNumber + "." + allowedTypes[mimeType];
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
            error: (uploadData && (uploadData.message || uploadData.error)) || "فشل رفع الصورة إلى التخزين السحابي"
          }, 502);
        }

        const publicUrl = SUPABASE_URL + "/storage/v1/object/public/" + encodeURIComponent(bucketName) + "/" + objectPath.split("/").map(encodeURIComponent).join("/");

        return json({ success: true, invoice_number: invoiceNumber, gate_photo_url: publicUrl });
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
          success:
            true,
          data:
            rpcData
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
