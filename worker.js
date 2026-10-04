const SUPABASE_URL = "https://wnfibznjxihilgfedfij.supabase.co";

const DRIVER_EMAILS = {
  zain: "zain@yourapp.local",
  zain2: "zain2@yourapp.local"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // LOGIN
    // =========================
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const body = await request.json();

        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");

        const email = DRIVER_EMAILS[username];

        if (!email || !password) {
          return json({
            error: "اسم المستخدم أو كلمة المرور غير صحيحة"
          }, 401);
        }

        const response = await fetch(
          `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": env.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
              email,
              password
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return json({
            error: "اسم المستخدم أو كلمة المرور غير صحيحة"
          }, 401);
        }

        return json({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          user: {
            username,
            email
          }
        });
      } catch (error) {
        return json({
          error: "حدث خطأ أثناء تسجيل الدخول"
        }, 500);
      }
    }

    // =========================
    // REFRESH TOKEN
    // =========================
    if (url.pathname === "/api/refresh" && request.method === "POST") {
      try {
        const body = await request.json();
        const refreshToken = body.refresh_token;

        if (!refreshToken) {
          return json({
            error: "Refresh token missing"
          }, 400);
        }

        const response = await fetch(
          `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": env.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
              refresh_token: refreshToken
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return json({
            error: "Session expired"
          }, 401);
        }

        return json({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in
        });
      } catch (error) {
        return json({
          error: "حدث خطأ أثناء تحديث الجلسة"
        }, 500);
      }
    }

    // =========================
    // GET ORDERS
    // =========================
    if (url.pathname === "/api/orders" && request.method === "GET") {
      try {
        const token = getBearerToken(request);

        if (!token) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        const userResponse = await fetch(
          `${SUPABASE_URL}/auth/v1/user`,
          {
            headers: {
              "apikey": env.SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${token}`
            }
          }
        );

        if (!userResponse.ok) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        const user = await userResponse.json();

        const mandoubResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/mandoub_users?user_id=eq.${encodeURIComponent(user.id)}&select=mandoub_name,sheet_name&limit=1`,
          {
            headers: {
              "apikey": env.SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${token}`
            }
          }
        );

        const mandoubData = await mandoubResponse.json();

        if (!mandoubResponse.ok || !mandoubData.length) {
          return json({
            error: "المندوب غير مربوط بشيت"
          }, 403);
        }

        const sheetName = mandoubData[0].sheet_name;

        const ordersResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/orders?sheet_name=eq.${encodeURIComponent(sheetName)}&order=created_at.desc&select=*`,
          {
            headers: {
              "apikey": env.SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${token}`
            }
          }
        );

        const orders = await ordersResponse.json();

        if (!ordersResponse.ok) {
          return json({
            error: "فشل تحميل الطلبات"
          }, 500);
        }

        return json(orders);
      } catch (error) {
        return json({
          error: "حدث خطأ أثناء تحميل الطلبات"
        }, 500);
      }
    }

    // =========================
    // MARK DELIVERED
    // =========================
    if (url.pathname === "/api/deliver" && request.method === "POST") {
      try {
        const token = getBearerToken(request);

        if (!token) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        const body = await request.json();
        const orderId = body.orderId;

        if (!orderId) {
          return json({
            error: "رقم الطلب غير موجود"
          }, 400);
        }

        const userResponse = await fetch(
          `${SUPABASE_URL}/auth/v1/user`,
          {
            headers: {
              "apikey": env.SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${token}`
            }
          }
        );

        if (!userResponse.ok) {
          return json({
            error: "Unauthorized"
          }, 401);
        }

        // استخدام نفس RPC الموجودة في Supabase
        const rpcResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/mark_order_delivered`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": env.SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              p_order_id: Number(orderId)
            })
          }
        );

        const resultText = await rpcResponse.text();

        if (!rpcResponse.ok) {
          return json({
            error: "لا يمكن تسليم هذا الطلب",
            details: resultText
          }, 403);
        }

        return json({
          success: true,
          result: resultText
        });
      } catch (error) {
        return json({
          error: "حدث خطأ أثناء تسجيل التسليم"
        }, 500);
      }
    }

    // =========================
    // STATIC FILES
    // =========================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", {
      status: 404
    });
  }
};


// =========================
// HELPERS
// =========================

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.substring(7).trim();
}


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
