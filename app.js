```javascript
const API_BASE = "";

const SESSION_KEY = "driver_session";

let session = null;
let currentOrders = [];
let activeTab = "pending";
let toastTimer = null;

document.addEventListener("DOMContentLoaded", () => {
    session = loadSession();

    setupEvents();

    if (session?.access_token) {
        showDashboard();
        loadOrders();
    } else {
        clearSession();
        showLogin();
    }
});

function setupEvents() {
    const loginBtn = document.getElementById("login-btn");
    const passwordInput = document.getElementById("password");
    const usernameInput = document.getElementById("username");
    const refreshBtn = document.getElementById("refresh-btn");
    const logoutBtn = document.getElementById("logout-btn");

    if (loginBtn) {
        loginBtn.addEventListener("click", login);
    }

    if (passwordInput) {
        passwordInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                login();
            }
        });
    }

    if (usernameInput) {
        usernameInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                login();
            }
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener("click", loadOrders);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }

    document.querySelectorAll(".tab-btn").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(item => {
                item.classList.remove("active");
            });

            button.classList.add("active");

            activeTab = button.dataset.tab || "pending";

            renderOrders();
        });
    });
}

function loadSession() {
    try {
        const saved = localStorage.getItem(SESSION_KEY);

        if (!saved) {
            return null;
        }

        const parsed = JSON.parse(saved);

        if (parsed?.session?.access_token) {
            return {
                ...parsed,
                access_token: parsed.session.access_token,
                refresh_token:
                    parsed.refresh_token ||
                    parsed.session.refresh_token ||
                    ""
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
    const accessToken =
        data?.access_token ||
        data?.token ||
        data?.session?.access_token ||
        "";

    const refreshToken =
        data?.refresh_token ||
        data?.session?.refresh_token ||
        "";

    session = {
        ...(data || {}),
        access_token: accessToken,
        refresh_token: refreshToken
    };

    localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(session)
    );
}

function clearSession() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
}

function showLogin(message = "") {
    const loginView = document.getElementById("login-view");
    const dashboardView = document.getElementById("dashboard-view");
    const errorBox = document.getElementById("login-error");

    if (loginView) {
        loginView.style.display = "";
    }

    if (dashboardView) {
        dashboardView.style.display = "none";
    }

    if (errorBox) {
        errorBox.textContent = message;
        errorBox.style.display = message ? "block" : "none";
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

    const username =
        usernameInput?.value.trim().toLowerCase() || "";

    const password =
        passwordInput?.value || "";

    if (!username || !password) {
        if (errorBox) {
            errorBox.textContent =
                "اكتب اسم المستخدم وكلمة المرور";

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
        const response = await fetch(
            `${API_BASE}/api/login`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    password
                })
            }
        );

        const data =
            await response.json().catch(() => ({}));

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
            throw new Error(
                "تم الدخول لكن لم يتم استلام جلسة الدخول"
            );
        }

        saveSession({
            ...data,
            access_token: accessToken
        });

        if (passwordInput) {
            passwordInput.value = "";
        }

        showDashboard();

        await loadOrders();

    } catch (error) {
        clearSession();
        showLogin(
            error.message ||
            "حدث خطأ أثناء تسجيل الدخول"
        );
    } finally {
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = "تسجيل الدخول";
        }
    }
}

async function refreshSession() {
    if (!session?.refresh_token) {
        return false;
    }

    try {
        const response = await fetch(
            `${API_BASE}/api/refresh`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    refresh_token: session.refresh_token
                })
            }
        );

        const data =
            await response.json().catch(() => ({}));

        if (!response.ok) {
            return false;
        }

        const accessToken =
            data.access_token ||
            data.token ||
            data.session?.access_token ||
            "";

        if (!accessToken) {
            return false;
        }

        saveSession({
            ...session,
            ...data,
            access_token: accessToken,
            refresh_token:
                data.refresh_token ||
                data.session?.refresh_token ||
                session.refresh_token
        });

        return true;

    } catch {
        return false;
    }
}

async function authorizedFetch(
    url,
    options = {},
    retry = true
) {
    if (!session?.access_token) {
        throw new Error("جلسة الدخول غير موجودة");
    }

    const headers = {
        ...(options.headers || {}),
        Authorization:
            `Bearer ${session.access_token}`
    };

    if (
        options.body &&
        !headers["Content-Type"]
    ) {
        headers["Content-Type"] =
            "application/json";
    }

    const response = await fetch(
        url,
        {
            ...options,
            headers
        }
    );

    if (
        response.status === 401 &&
        retry
    ) {
        const refreshed =
            await refreshSession();

        if (refreshed) {
            return authorizedFetch(
                url,
                options,
                false
            );
        }
    }

    return response;
}

async function loadOrders() {
    if (!session?.access_token) {
        clearSession();
        showLogin();
        return;
    }

    const ordersList =
        document.getElementById("orders-list");

    const refreshBtn =
        document.getElementById("refresh-btn");

    if (ordersList) {
        ordersList.innerHTML = `
            <div class="loading">
                جاري تحميل الطلبات...
            </div>
        `;
    }

    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.classList.add("loading");
    }

    try {
        const response =
            await authorizedFetch(
                `${API_BASE}/api/orders`,
                {
                    method: "GET"
                }
            );

        if (response.status === 401) {
            clearSession();
            showLogin(
                "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى"
            );
            return;
        }

        const data =
            await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "فشل تحميل الطلبات"
            );
        }

        currentOrders =
            Array.isArray(data)
                ? data
                : Array.isArray(data.orders)
                    ? data.orders
                    : [];

        if (data.sheet) {
            session.sheet_name =
                data.sheet;
        }

        if (data.mandoub_name) {
            session.mandoub_name =
                data.mandoub_name;
        }

        localStorage.setItem(
            SESSION_KEY,
            JSON.stringify(session)
        );

        showDashboard();
        updateStats();
        renderOrders();

    } catch (error) {
        if (ordersList) {
            ordersList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <div>
                        ${escapeHtml(
                            error.message ||
                            "حدث خطأ أثناء تحميل الطلبات"
                        )}
                    </div>
                </div>
            `;
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove("loading");
        }
    }
}

function updateStats() {
    const pending =
        currentOrders.filter(order =>
            !isDelivered(order)
        ).length;

    const delivered =
        currentOrders.filter(order =>
            isDelivered(order)
        ).length;

    document.querySelectorAll(
        "#stat-pending"
    ).forEach(element => {
        element.textContent =
            pending.toLocaleString("ar-EG");
    });

    document.querySelectorAll(
        "#stat-delivered"
    ).forEach(element => {
        element.textContent =
            delivered.toLocaleString("ar-EG");
    });
}

function renderOrders() {
    const ordersList =
        document.getElementById("orders-list");

    if (!ordersList) {
        return;
    }

    let orders =
        currentOrders;

    if (activeTab === "pending") {
        orders =
            currentOrders.filter(order =>
                !isDelivered(order)
            );
    }

    if (activeTab === "delivered") {
        orders =
            currentOrders.filter(order =>
                isDelivered(order)
            );
    }

    if (!orders.length) {
        ordersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div>
                    ${
                        activeTab === "delivered"
                            ? "لا توجد طلبات مسلّمة"
                            : "لا توجد طلبات قيد التوصيل"
                    }
                </div>
            </div>
        `;

        return;
    }

    ordersList.innerHTML =
        orders
            .map(order =>
                createOrderCard(order)
            )
            .join("");

    ordersList
        .querySelectorAll(".deliver-btn")
        .forEach(button => {
            button.addEventListener(
                "click",
                () =>
                    markDelivered(
                        button.dataset.id,
                        button
                    )
            );
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

    const delivered =
        isDelivered(order);

    const safePhone =
        normalizePhone(phone);

    const safeLocation =
        normalizeLocation(location);

    const callButton =
        safePhone
            ? `
                <a
                    class="call-btn"
                    href="tel:${escapeAttribute(
                        safePhone
                    )}"
                >
                    📞 اتصال بالعميل
                </a>
            `
            : "";

    const locationButton =
        safeLocation
            ? `
                <a
                    class="location-btn"
                    href="${escapeAttribute(
                        safeLocation
                    )}"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    📍 فتح الموقع
                </a>
            `
            : "";

    return `
        <article
            class="order-card ${
                delivered
                    ? "delivered"
                    : ""
            }"
        >

            <div class="order-header">

                <div class="order-number">
                    طلب #${escapeHtml(
                        String(orderNumber)
                    )}
                </div>

                <div
                    class="order-status ${
                        delivered
                            ? "delivered"
                            : "pending"
                    }"
                >
                    ${
                        delivered
                            ? "تم التسليم"
                            : "قيد التوصيل"
                    }
                </div>

            </div>

            <div class="order-info">

                <div class="info-row">
                    <span class="info-label">
                        العميل
                    </span>

                    <span class="info-value">
                        ${escapeHtml(customer)}
                    </span>
                </div>

                ${
                    phone
                        ? `
                            <div class="info-row">
                                <span class="info-label">
                                    رقم الهاتف
                                </span>

                                <span class="info-value phone-value">
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
                                <span class="info-label">
                                    المنطقة
                                </span>

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
                            <div class="info-row details-row">
                                <span class="info-label">
                                    الطلب
                                </span>

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
                                <span class="info-label">
                                    منسق الموعد
                                </span>

                                <span class="info-value">
                                    ${escapeHtml(
                                        coordinator
                                    )}
                                </span>
                            </div>
                        `
                        : ""
                }

                ${
                    note
                        ? `
                            <div class="info-row note-row">
                                <span class="info-label">
                                    ملاحظات
                                </span>

                                <span class="info-value">
                                    ${escapeHtml(note)}
                                </span>
                            </div>
                        `
                        : ""
                }

                <div class="info-row total-row">
                    <span class="info-label">
                        الإجمالي
                    </span>

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
                                type="button"
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

        </article>
    `;
}

async function markDelivered(
    orderId,
    button
) {
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

    const order =
        currentOrders.find(item =>
            String(
                item.id ??
                item.order_number
            ) === String(orderId)
        );

    const orderNumber =
        order?.order_number ??
        order?.id ??
        orderId;

    const customer =
        order?.customer_name ||
        "";

    const confirmationText =
        customer
            ? `هل تريد تأكيد تسليم الطلب #${orderNumber} للعميل ${customer}؟`
            : `هل تريد تأكيد تسليم الطلب #${orderNumber}؟`;

    if (!window.confirm(
        confirmationText
    )) {
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent =
            "جاري تسجيل التسليم...";
    }

    try {
        const response =
            await authorizedFetch(
                `${API_BASE}/api/deliver`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        order_id: orderId,
                        orderId: orderId
                    })
                }
            );

        if (response.status === 401) {
            clearSession();
            showLogin(
                "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى"
            );

            return;
        }

        const data =
            await response.json().catch(
                () => ({})
            );

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "فشل تسجيل التسليم"
            );
        }

        const target =
            currentOrders.find(item =>
                String(
                    item.id ??
                    item.order_number
                ) === String(orderId)
            );

        if (target) {
            target.delivery_status =
                "delivered";

            target.status =
                "delivered";
        }

        updateStats();
        renderOrders();

        showToast(
            "تم تسجيل التسليم بنجاح ✓",
            "success"
        );

    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent =
                "✓ تم التسليم";
        }

        showToast(
            error.message ||
            "حدث خطأ أثناء تسجيل التسليم",
            "error"
        );
    }
}

function isDelivered(order) {
    const status =
        String(
            order?.delivery_status ??
            order?.status ??
            ""
        )
            .trim()
            .toLowerCase();

    return (
        status === "delivered" ||
        status === "done" ||
        status === "تم" ||
        status.includes("تم التسليم") ||
        status.includes("مسلم")
    );
}

function getStatus(order) {
    return isDelivered(order)
        ? "delivered"
        : "pending";
}

function normalizePhone(phone) {
    if (!phone) {
        return "";
    }

    let value =
        String(phone)
            .trim()
            .replace(/[^\d+]/g, "");

    if (value.startsWith("00")) {
        value =
            "+" +
            value.substring(2);
    }

    if (value.startsWith("05")) {
        value =
            "+971" +
            value.substring(1);
    }

    if (
        value.startsWith("5") &&
        value.length === 9
    ) {
        value =
            "+971" +
            value;
    }

    return value;
}

function normalizeLocation(location) {
    if (!location) {
        return "";
    }

    const value =
        String(location).trim();

    if (
        !/^https?:\/\//i.test(value)
    ) {
        return "";
    }

    if (
        /open%20location/i.test(value) ||
        /\/Open%20Location/i.test(value)
    ) {
        return "";
    }

    return value;
}

function formatTotal(value) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return "0 درهم";
    }

    const number =
        Number(value);

    if (
        Number.isFinite(number)
    ) {
        return (
            number.toLocaleString(
                "ar-EG",
                {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2
                }
            ) +
            " درهم"
        );
    }

    return (
        escapeHtml(
            String(value)
        ) +
        " درهم"
    );
}

function showToast(
    message,
    type = "success"
) {
    const toast =
        document.getElementById(
            "toast"
        );

    if (!toast) {
        return;
    }

    clearTimeout(toastTimer);

    toast.textContent =
        message;

    toast.className =
        `toast ${type}`;

    toast.style.display =
        "block";

    toastTimer =
        setTimeout(() => {
            toast.style.display =
                "none";
        }, 3000);
}

function logout() {
    clearSession();

    currentOrders = [];

    activeTab = "pending";

    showLogin();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}

function escapeAttribute(value) {
    return escapeHtml(value);
}
```
