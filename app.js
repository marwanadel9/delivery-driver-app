const API_BASE = "";

const SESSION_KEY = "driver_session";

let session = null;
let currentOrders = [];

document.addEventListener("DOMContentLoaded", () => {
    session = loadSession();

    if (session?.access_token) {
        showDashboard();
        loadOrders();
    } else {
        clearSession();
        showLogin();
    }

    const loginBtn = document.getElementById("login-btn");
    if (loginBtn) {
        loginBtn.addEventListener("click", login);
    }

    const passwordInput = document.getElementById("password");
    if (passwordInput) {
        passwordInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                login();
            }
        });
    }

    const usernameInput = document.getElementById("username");
    if (usernameInput) {
        usernameInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                login();
            }
        });
    }

    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", loadOrders);
    }

    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }

    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(x => {
                x.classList.remove("active");
            });

            btn.classList.add("active");
            renderOrders();
        });
    });
});

function loadSession() {
    try {
        const data = localStorage.getItem(SESSION_KEY);

        if (!data) {
            return null;
        }

        const parsed = JSON.parse(data);

        if (parsed?.session?.access_token) {
            return {
                ...parsed,
                access_token: parsed.session.access_token
            };
        }

        if (parsed?.token && !parsed.access_token) {
            return {
                ...parsed,
                access_token: parsed.token
            };
        }

        return parsed;
    } catch {
        return null;
    }
}

function saveSession(data) {
    let savedData = data;

    if (data?.session?.access_token && !data.access_token) {
        savedData = {
            ...data,
            access_token: data.session.access_token
        };
    }

    if (data?.token && !data.access_token) {
        savedData = {
            ...data,
            access_token: data.token
        };
    }

    session = savedData;
    localStorage.setItem(SESSION_KEY, JSON.stringify(savedData));
}

function clearSession() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
}

function showLogin() {
    const loginView = document.getElementById("login-view");
    const dashboardView = document.getElementById("dashboard-view");

    if (loginView) {
        loginView.style.display = "";
    }

    if (dashboardView) {
        dashboardView.style.display = "none";
    }
}

function showDashboard() {
    const loginView = document.getElementById("login-view");
    const dashboardView = document.getElementById("dashboard-view");

    if (loginView) {
        loginView.style.display = "none";
    }

    if (dashboardView) {
        dashboardView.style.display = "";
    }

    const driverName = document.getElementById("driver-name");
    const sheetName = document.getElementById("sheet-name");

    if (driverName) {
        driverName.textContent =
            session?.mandoub_name ||
            session?.username ||
            "المندوب";
    }

    if (sheetName) {
        sheetName.textContent =
            session?.sheet_name ||
            "";
    }
}

async function login() {
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const errorBox = document.getElementById("login-error");
    const loginBtn = document.getElementById("login-btn");

    const username = usernameInput?.value.trim() || "";
    const password = passwordInput?.value || "";

    if (!username || !password) {
        if (errorBox) {
            errorBox.textContent = "اكتب اسم المستخدم وكلمة المرور";
            errorBox.style.display = "block";
        }
        return;
    }

    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = "جاري الدخول...";
    }

    if (errorBox) {
        errorBox.textContent = "";
        errorBox.style.display = "none";
    }

    try {
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

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "بيانات الدخول غير صحيحة"
            );
        }

        const accessToken =
            data.access_token ||
            data.token ||
            data.session?.access_token ||
            "";

        if (!accessToken) {
            throw new Error("تم الدخول لكن لم يتم استلام جلسة الدخول");
        }

        saveSession({
            ...data,
            access_token: accessToken
        });

        showDashboard();

        await loadOrders();

    } catch (error) {
        clearSession();
        showLogin();

        if (errorBox) {
            errorBox.textContent =
                error.message ||
                "حدث خطأ أثناء تسجيل الدخول";

            errorBox.style.display = "block";
        }
    } finally {
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = "تسجيل الدخول";
        }
    }
}

async function loadOrders() {
    if (!session?.access_token) {
        clearSession();
        showLogin();
        return;
    }

    const ordersList = document.getElementById("orders-list");

    if (ordersList) {
        ordersList.innerHTML = `
            <div class="loading">
                جاري تحميل الطلبات...
            </div>
        `;
    }

    try {
        const response = await fetch(`${API_BASE}/api/orders`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${session.access_token}`
            }
        });

        if (response.status === 401) {
            clearSession();
            showLogin();
            return;
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "فشل تحميل الطلبات"
            );
        }

        currentOrders = Array.isArray(data)
            ? data
            : Array.isArray(data.orders)
                ? data.orders
                : [];

        if (data.sheet) {
            session.sheet_name = data.sheet;
        }

        if (data.mandoub_name) {
            session.mandoub_name = data.mandoub_name;
        }

        localStorage.setItem(
            SESSION_KEY,
            JSON.stringify(session)
        );

        updateStats();
        renderOrders();

    } catch (error) {
        if (ordersList) {
            ordersList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <div>${escapeHtml(error.message || "حدث خطأ")}</div>
                </div>
            `;
        }
    }
}

function updateStats() {
    const pending = currentOrders.filter(order => {
        return getStatus(order) !== "delivered";
    }).length;

    const delivered = currentOrders.filter(order => {
        return getStatus(order) === "delivered";
    }).length;

    document.querySelectorAll("#stat-pending").forEach(el => {
        el.textContent = pending;
    });

    document.querySelectorAll("#stat-delivered").forEach(el => {
        el.textContent = delivered;
    });
}

function renderOrders() {
    const ordersList = document.getElementById("orders-list");

    if (!ordersList) {
        return;
    }

    const activeTab =
        document.querySelector(".tab-btn.active")?.dataset?.tab ||
        "pending";

    let orders = currentOrders;

    if (activeTab === "pending") {
        orders = currentOrders.filter(order => {
            return getStatus(order) !== "delivered";
        });
    }

    if (activeTab === "delivered") {
        orders = currentOrders.filter(order => {
            return getStatus(order) === "delivered";
        });
    }

    if (!orders.length) {
        ordersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div>لا توجد طلبات</div>
            </div>
        `;
        return;
    }

    ordersList.innerHTML = orders
        .map(order => createOrderCard(order))
        .join("");

    ordersList.querySelectorAll(".deliver-btn").forEach(button => {
        button.addEventListener("click", async () => {
            await markDelivered(
                button.dataset.id,
                button
            );
        });
    });
}

function createOrderCard(order) {
    const orderNumber =
        order.order_number ??
        order.orderNumber ??
        order.id ??
        "";

    const customer =
        order.customer_name ??
        order.customer ??
        "";

    const phone =
        order.phone ??
        order.customer_phone ??
        "";

    const area =
        order.area ??
        "";

    const details =
        order.order_details ??
        order.details ??
        "";

    const location =
        order.location_url ??
        order.location ??
        order.location_link ??
        "";

    const coordinator =
        order.appointment_coordinator ??
        order.coordinator ??
        "";

    const note =
        order.note ??
        "";

    const total =
        order.total ??
        0;

    const status = getStatus(order);
    const delivered = status === "delivered";

    const safePhone = normalizePhone(phone);

    const callButton = safePhone
        ? `
            <a
                class="call-btn"
                href="tel:${escapeAttribute(safePhone)}"
            >
                📞 اتصال بالعميل
            </a>
        `
        : "";

    const locationButton = location
        ? `
            <a
                class="location-btn"
                href="${escapeAttribute(location)}"
                target="_blank"
                rel="noopener noreferrer"
            >
                📍 فتح الموقع
            </a>
        `
        : "";

    return `
        <div class="order-card ${delivered ? "delivered" : ""}">
            <div class="order-header">
                <div class="order-number">
                    طلب #${escapeHtml(String(orderNumber))}
                </div>

                <div class="order-status ${delivered ? "delivered" : "pending"}">
                    ${delivered ? "تم التسليم" : "قيد التوصيل"}
                </div>
            </div>

            <div class="order-info">

                <div class="info-row">
                    <span class="info-label">العميل</span>
                    <span class="info-value">
                        ${escapeHtml(customer)}
                    </span>
                </div>

                ${
                    phone
                        ? `
                            <div class="info-row">
                                <span class="info-label">رقم الهاتف</span>
                                <span class="info-value">
                                    ${escapeHtml(phone)}
                                </span>
                            </div>
                        `
                        : ""
                }

                ${
                    area
                        ? `
                            <div class="info-row">
                                <span class="info-label">المنطقة</span>
                                <span class="info-value">
                                    ${escapeHtml(area)}
                                </span>
                            </div>
                        `
                        : ""
                }

                ${
                    details
                        ? `
                            <div class="info-row">
                                <span class="info-label">الطلب</span>
                                <span class="info-value">
                                    ${escapeHtml(details)}
                                </span>
                            </div>
                        `
                        : ""
                }

                ${
                    coordinator
                        ? `
                            <div class="info-row">
                                <span class="info-label">منسق الموعد</span>
                                <span class="info-value">
                                    ${escapeHtml(coordinator)}
                                </span>
                            </div>
                        `
                        : ""
                }

                ${
                    note
                        ? `
                            <div class="info-row">
                                <span class="info-label">ملاحظات</span>
                                <span class="info-value">
                                    ${escapeHtml(note)}
                                </span>
                            </div>
                        `
                        : ""
                }

                <div class="info-row total-row">
                    <span class="info-label">الإجمالي</span>
                    <span class="info-value">
                        ${formatTotal(total)}
                    </span>
                </div>

            </div>

            <div class="order-actions">

                ${callButton}

                ${locationButton}

                ${
                    delivered
                        ? `
                            <div class="delivered-label">
                                ✓ تم التسليم
                            </div>
                        `
                        : `
                            <button
                                class="deliver-btn"
                                data-id="${escapeAttribute(
                                    String(
                                        order.id ??
                                        order.order_number ??
                                        ""
                                    )
                                )}"
                            >
                                ✓ تم التسليم
                            </button>
                        `
                }

            </div>
        </div>
    `;
}

async function markDelivered(orderId, button) {
    if (!session?.access_token) {
        showLogin();
        return;
    }

    if (!orderId) {
        showToast(
            "رقم الطلب غير موجود",
            "error"
        );
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "جاري التسجيل...";
    }

    try {
        const response = await fetch(`${API_BASE}/api/deliver`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                order_id: orderId
            })
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            clearSession();
            showLogin();
            return;
        }

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "فشل تسجيل التسليم"
            );
        }

        const order = currentOrders.find(item => {
            return String(
                item.id ??
                item.order_number
            ) === String(orderId);
        });

        if (order) {
            order.delivery_status = "delivered";
            order.status = "delivered";
        }

        updateStats();
        renderOrders();

        showToast(
            "تم تسجيل الطلب كمُسلّم",
            "success"
        );

    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent = "✓ تم التسليم";
        }

        showToast(
            error.message || "حدث خطأ",
            "error"
        );
    }
}

function getStatus(order) {
    return String(
        order.delivery_status ??
        order.status ??
        "pending"
    ).toLowerCase();
}

function normalizePhone(phone) {
    if (!phone) {
        return "";
    }

    let value = String(phone).trim();

    value = value.replace(/[^\d+]/g, "");

    if (value.startsWith("00")) {
        value = "+" + value.substring(2);
    }

    if (value.startsWith("05")) {
        value = "+971" + value.substring(1);
    }

    if (value.startsWith("5") && value.length === 9) {
        value = "+971" + value;
    }

    return value;
}

function formatTotal(value) {
    const number = Number(value);

    if (Number.isNaN(number)) {
        return (
            escapeHtml(String(value || "")) +
            " درهم"
        );
    }

    return `${number.toFixed(2)} درهم`;
}

function showToast(message, type = "success") {
    const toast = document.getElementById("toast");

    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.style.display = "block";

    setTimeout(() => {
        toast.style.display = "none";
    }, 3000);
}

function logout() {
    clearSession();
    currentOrders = [];
    showLogin();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
    return escapeHtml(value);
}
