const API_BASE = "";

const SESSION_KEY = "driver_session";

let session = null;
let orders = [];
let currentFilter = "pending";

const loginView = document.getElementById("login-view");
const ordersView = document.getElementById("orders-view");
const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const driverName = document.getElementById("driver-name");
const sheetName = document.getElementById("sheet-name");

const ordersList = document.getElementById("orders-list");
const refreshBtn = document.getElementById("refresh-btn");
const logoutBtn = document.getElementById("logout-btn");

const statPending = document.getElementById("stat-pending");
const statDone = document.getElementById("stat-done");

const toast = document.getElementById("toast");

const tabs = document.querySelectorAll(".tab");

const orderTemplate = document.getElementById("order-tpl");

function saveSession(data) {
  session = data;
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function loadSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);

    if (!saved) {
      return null;
    }

    return JSON.parse(saved);
  } catch {
    return null;
  }
}

function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

function showLogin() {
  loginView.hidden = false;
  ordersView.hidden = true;
}

function showOrders() {
  loginView.hidden = true;
  ordersView.hidden = false;

  const username =
    session?.username ||
    session?.user?.username ||
    "";

  const sheet =
    session?.sheet ||
    session?.user?.sheet ||
    "";

  driverName.textContent = username;
  sheetName.textContent = sheet ? `مسار المندوب: ${sheet}` : "";
}

function showLoginError(message) {
  loginError.textContent = message || "حدث خطأ أثناء تسجيل الدخول";
  loginError.hidden = false;
}

function hideLoginError() {
  loginError.hidden = true;
  loginError.textContent = "";
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function normalizeLocationUrl(value) {
  if (!value) {
    return "";
  }

  let url = String(value).trim();

  if (!url) {
    return "";
  }

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  try {
    return new URL(url).href;
  } catch {
    return "";
  }
}

async function api(path, options = {}, retry = true) {
  const headers = {
    ...(options.headers || {})
  };

  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (
    response.status === 401 &&
    retry &&
    session?.refresh_token
  ) {
    const refreshed = await refreshSession();

    if (refreshed) {
      return api(path, options, false);
    }

    clearSession();
    showLogin();
    throw new Error("انتهت جلسة الدخول");
  }

  if (!response.ok) {
    const message =
      data?.error ||
      data?.message ||
      "حدث خطأ في الاتصال بالخادم";

    throw new Error(message);
  }

  return data;
}

async function refreshSession() {
  if (!session?.refresh_token) {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/api/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        refresh_token: session.refresh_token
      })
    });

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      return false;
    }

    session = {
      ...session,
      ...data,
      username:
        data.username ||
        session.username ||
        session.user?.username,
      email:
        data.email ||
        session.email ||
        session.user?.email
    };

    if (data.expires_in) {
      session.expires_at =
        Math.floor(Date.now() / 1000) +
        Number(data.expires_in);
    }

    saveSession(session);

    return true;
  } catch {
    return false;
  }
}

async function login(username, password) {
  const response = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username,
      password
    })
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data?.details ||
      data?.error ||
      "اسم المستخدم أو كلمة المرور غير صحيحة"
    );
  }

  const newSession = {
    ...data,
    username:
      data.username ||
      data.user?.username ||
      username,
    email:
      data.email ||
      data.user?.email ||
      "",
    user: {
      ...(data.user || {}),
      username:
        data.username ||
        data.user?.username ||
        username,
      email:
        data.email ||
        data.user?.email ||
        ""
    }
  };

  if (data.expires_in) {
    newSession.expires_at =
      Math.floor(Date.now() / 1000) +
      Number(data.expires_in);
  }

  saveSession(newSession);
}

async function loadOrders() {
  ordersList.innerHTML = `
    <div class="loading">
      جاري تحميل الطلبات...
    </div>
  `;

  const data = await api("/api/orders");

  orders = Array.isArray(data?.orders)
    ? data.orders
    : [];

  if (data?.sheet) {
    session.sheet = data.sheet;
    saveSession(session);
  }

  showOrders();

  updateStats();
  renderOrders();
}

function updateStats() {
  const pending = orders.filter(
    order => order.delivery_status !== "delivered"
  ).length;

  const done = orders.filter(
    order => order.delivery_status === "delivered"
  ).length;

  statPending.textContent = pending;
  statDone.textContent = done;
}

function getFilteredOrders() {
  if (currentFilter === "pending") {
    return orders.filter(
      order => order.delivery_status !== "delivered"
    );
  }

  if (currentFilter === "done") {
    return orders.filter(
      order => order.delivery_status === "delivered"
    );
  }

  return orders;
}

function setField(element, value) {
  if (!element) {
    return;
  }

  element.textContent =
    value === null ||
    value === undefined ||
    String(value).trim() === ""
      ? "—"
      : String(value);
}

function renderOrders() {
  ordersList.innerHTML = "";

  const filtered = getFilteredOrders();

  if (!filtered.length) {
    ordersList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <h3>لا توجد طلبات</h3>
        <p>لا توجد طلبات في هذا القسم حاليًا.</p>
      </div>
    `;

    return;
  }

  filtered.forEach(order => {
    const fragment =
      orderTemplate.content.cloneNode(true);

    const article =
      fragment.querySelector(".order");

    const orderNumber =
      fragment.querySelector('[data-f="order_number"]');

    const customerName =
      fragment.querySelector('[data-f="customer_name"]');

    const phone =
      fragment.querySelector('[data-f="phone"]');

    const area =
      fragment.querySelector('[data-f="area"]');

    const details =
      fragment.querySelector('[data-f="order_details"]');

    const location =
      fragment.querySelector('[data-f="location_url"]');

    const coordinator =
      fragment.querySelector('[data-f="appointment_coordinator"]');

    const note =
      fragment.querySelector('[data-f="note"]');

    const total =
      fragment.querySelector('[data-f="total"]');

    const status =
      fragment.querySelector('[data-f="delivery_status"]');

    const deliverBtn =
      fragment.querySelector(".btn-deliver");

    setField(orderNumber, order.order_number);
    setField(customerName, order.customer_name);
    setField(area, order.area);
    setField(details, order.order_details);
    setField(coordinator, order.appointment_coordinator);
    setField(note, order.note);

    const totalValue = Number(order.total);

    if (Number.isFinite(totalValue)) {
      total.textContent =
        `${totalValue.toLocaleString("ar-EG")} درهم`;
    } else {
      setField(total, order.total);
    }

    const phoneValue =
      order.phone === null ||
      order.phone === undefined
        ? ""
        : String(order.phone).trim();

    if (phoneValue) {
      phone.textContent = phoneValue;
      phone.href =
        `tel:${phoneValue.replace(/[^\d+]/g, "")}`;
    } else {
      phone.textContent = "—";
      phone.removeAttribute("href");
    }

    const locationUrl =
      normalizeLocationUrl(
        order.location_url ||
        order.location ||
        order.map_url ||
        order.google_maps_url
      );

    if (locationUrl) {
      location.href = locationUrl;
      location.target = "_blank";
      location.rel = "noopener noreferrer";
      location.style.pointerEvents = "auto";
      location.style.opacity = "1";
    } else {
      location.removeAttribute("href");
      location.removeAttribute("target");
      location.removeAttribute("rel");
      location.style.pointerEvents = "none";
      location.style.opacity = "0.5";
    }

    const delivered =
      order.delivery_status === "delivered";

    if (delivered) {
      status.textContent = "تم التسليم";
      status.style.background = "#f0fdf4";
      status.style.color = "#15803d";

      deliverBtn.textContent = "تم التسليم";
      deliverBtn.disabled = true;
    } else {
      status.textContent = "قيد التوصيل";
      status.style.background = "#fffbeb";
      status.style.color = "#a16207";

      deliverBtn.textContent = "تم التسليم";
      deliverBtn.disabled = false;

      deliverBtn.addEventListener("click", () => {
        markDelivered(order, deliverBtn);
      });
    }

    article.dataset.orderId = order.id;

    ordersList.appendChild(fragment);
  });
}

async function markDelivered(order, button) {
  if (!order?.id) {
    showToast("رقم الطلب غير موجود");
    return;
  }

  const confirmed = window.confirm(
    "هل تريد تأكيد تسليم هذا الطلب؟"
  );

  if (!confirmed) {
    return;
  }

  button.disabled = true;
  button.textContent = "جاري التأكيد...";

  try {
    await api("/api/deliver", {
      method: "POST",
      body: JSON.stringify({
        orderId: order.id
      })
    });

    order.delivery_status = "delivered";

    updateStats();
    renderOrders();

    showToast("تم تسجيل الطلب كمُسلّم");
  } catch (error) {
    button.disabled = false;
    button.textContent = "تم التسليم";

    showToast(
      error?.message ||
      "تعذر تسجيل التسليم"
    );
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();

  hideLoginError();

  const username =
    usernameInput.value.trim();

  const password =
    passwordInput.value;

  if (!username || !password) {
    showLoginError(
      "اكتب اسم المستخدم وكلمة المرور"
    );

    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "جاري تسجيل الدخول...";

  try {
    await login(username, password);

    showOrders();

    await loadOrders();
  } catch (error) {
    showLoginError(
      error?.message ||
      "اسم المستخدم أو كلمة المرور غير صحيحة"
    );
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "تسجيل الدخول";
  }
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;

  try {
    await loadOrders();
    showToast("تم تحديث الطلبات");
  } catch (error) {
    showToast(
      error?.message ||
      "تعذر تحديث الطلبات"
    );
  } finally {
    refreshBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  orders = [];
  currentFilter = "pending";

  usernameInput.value = "";
  passwordInput.value = "";

  tabs.forEach(tab => {
    tab.classList.toggle(
      "active",
      tab.dataset.filter === "pending"
    );
  });

  showLogin();
});

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    currentFilter = tab.dataset.filter;

    tabs.forEach(item => {
      item.classList.toggle(
        "active",
        item === tab
      );
    });

    renderOrders();
  });
});

async function startApp() {
  session = loadSession();

  if (!session?.access_token) {
    showLogin();
    return;
  }

  showOrders();

  try {
    await loadOrders();
  } catch {
    const refreshed = await refreshSession();

    if (refreshed) {
      try {
        await loadOrders();
        return;
      } catch {
        clearSession();
      }
    } else {
      clearSession();
    }

    showLogin();
  }
}

startApp();
