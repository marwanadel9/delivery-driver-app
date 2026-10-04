```javascript
"use strict";

var API_BASE = "";
var SESSION_KEY = "driver_session";

var session = null;
var currentOrders = [];
var activeTab = "pending";
var toastTimer = null;

document.addEventListener("DOMContentLoaded", function () {
    session = loadSession();
    setupEvents();

    if (session && session.access_token) {
        showDashboard();
        loadOrders();
    } else {
        clearSession();
        showLogin("");
    }
});

function setupEvents() {
    var loginBtn = document.getElementById("login-btn");
    var passwordInput = document.getElementById("password");
    var usernameInput = document.getElementById("username");
    var refreshBtn = document.getElementById("refresh-btn");
    var logoutBtn = document.getElementById("logout-btn");

    if (loginBtn) {
        loginBtn.addEventListener("click", login);
    }

    if (passwordInput) {
        passwordInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                login();
            }
        });
    }

    if (usernameInput) {
        usernameInput.addEventListener("keydown", function (event) {
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

    var tabs = document.querySelectorAll(".tab-btn");

    tabs.forEach(function (button) {
        button.addEventListener("click", function () {
            tabs.forEach(function (item) {
                item.classList.remove("active");
            });

            button.classList.add("active");

            activeTab =
                button.getAttribute("data-tab") ||
                "pending";

            renderOrders();
        });
    });
}

function loadSession() {
    try {
        var saved =
            localStorage.getItem(SESSION_KEY);

        if (!saved) {
            return null;
        }

        var data = JSON.parse(saved);

        if (
            data &&
            data.access_token
        ) {
            return data;
        }

        if (
            data &&
            data.session &&
            data.session.access_token
        ) {
            data.access_token =
                data.session.access_token;

            data.refresh_token =
                data.refresh_token ||
                data.session.refresh_token ||
                "";

            return data;
        }

        if (
            data &&
            data.token
        ) {
            data.access_token =
                data.token;

            return data;
        }

        return null;

    } catch (error) {
        return null;
    }
}

function saveSession(data) {
    var accessToken =
        data.access_token ||
        data.token ||
        (
            data.session &&
            data.session.access_token
        ) ||
        "";

    var refreshToken =
        data.refresh_token ||
        (
            data.session &&
            data.session.refresh_token
        ) ||
        "";

    session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        username:
            data.username ||
            "",
        mandoub_name:
            data.mandoub_name ||
            "",
        sheet_name:
            data.sheet_name ||
            "",
        expires_at:
            data.expires_at ||
            0
    };

    localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(session)
    );
}

function clearSession() {
    session = null;

    localStorage.removeItem(
        SESSION_KEY
    );
}

function showLogin(message) {
    var loginView =
        document.getElementById("login-view");

    var dashboardView =
        document.getElementById("dashboard-view");

    var errorBox =
        document.getElementById("login-error");

    if (loginView) {
        loginView.style.display = "";
    }

    if (dashboardView) {
        dashboardView.style.display =
            "none";
    }

    if (errorBox) {
        errorBox.textContent =
            message || "";

        errorBox.style.display =
            message ? "block" : "none";
    }
}

function showDashboard() {
    var loginView =
        document.getElementById("login-view");

    var dashboardView =
        document.getElementById("dashboard-view");

    if (loginView) {
        loginView.style.display =
            "none";
    }

    if (dashboardView) {
        dashboardView.style.display =
            "";
    }

    var driverName =
        document.getElementById(
            "driver-name"
        );

    var sheetName =
        document.getElementById(
            "sheet-name"
        );

    if (driverName) {
        driverName.textContent =
            session.mandoub_name ||
            session.username ||
            "المندوب";
    }

    if (sheetName) {
        sheetName.textContent =
            session.sheet_name ||
            "";
    }
}

async function login() {
    var usernameInput =
        document.getElementById(
            "username"
        );

    var passwordInput =
        document.getElementById(
            "password"
        );

    var errorBox =
        document.getElementById(
            "login-error"
        );

    var loginBtn =
        document.getElementById(
            "login-btn"
        );

    var username =
        usernameInput
            ? usernameInput.value
                .trim()
                .toLowerCase()
            : "";

    var password =
        passwordInput
            ? passwordInput.value
            : "";

    if (!username || !password) {
        if (errorBox) {
            errorBox.textContent =
                "اكتب اسم المستخدم وكلمة المرور";

            errorBox.style.display =
                "block";
        }

        return;
    }

    if (loginBtn) {
        loginBtn.disabled = true;

        loginBtn.textContent =
            "جاري الدخول...";
    }

    if (errorBox) {
        errorBox.textContent = "";

        errorBox.style.display =
            "none";
    }

    try {
        var response =
            await fetch(
                "/api/login",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            username:
                                username,

                            password:
                                password
                        })
                }
            );

        var data =
            await response
                .json()
                .catch(function () {
                    return {};
                });

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "بيانات الدخول غير صحيحة"
            );
        }

        if (
            !data.access_token &&
            !data.token &&
            !(
                data.session &&
                data.session.access_token
            )
        ) {
            throw new Error(
                "لم يتم استلام جلسة الدخول من الموقع"
            );
        }

        saveSession(data);

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

            loginBtn.textContent =
                "تسجيل الدخول";
        }
    }
}

async function refreshSession() {
    if (
        !session ||
        !session.refresh_token
    ) {
        return false;
    }

    try {
        var response =
            await fetch(
                "/api/refresh",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            refresh_token:
                                session.refresh_token
                        })
                }
            );

        var data =
            await response
                .json()
                .catch(function () {
                    return {};
                });

        if (!response.ok) {
            return false;
        }

        if (
            !data.access_token &&
            !data.token &&
            !(
                data.session &&
                data.session.access_token
            )
        ) {
            return false;
        }

        saveSession({
            access_token:
                data.access_token ||
                data.token ||
                data.session.access_token,

            refresh_token:
                data.refresh_token ||
                (
                    data.session &&
                    data.session.refresh_token
                ) ||
                session.refresh_token,

            username:
                data.username ||
                session.username,

            mandoub_name:
                data.mandoub_name ||
                session.mandoub_name,

            sheet_name:
                data.sheet_name ||
                session.sheet_name,

            expires_at:
                data.expires_at ||
                session.expires_at
        });

        return true;

    } catch (error) {
        return false;
    }
}

async function authorizedFetch(
    url,
    options,
    retry
) {
    options =
        options || {};

    if (retry === undefined) {
        retry = true;
    }

    if (
        !session ||
        !session.access_token
    ) {
        throw new Error(
            "جلسة الدخول غير موجودة"
        );
    }

    var headers = {};

    var existingHeaders =
        options.headers || {};

    Object.keys(existingHeaders)
        .forEach(function (key) {
            headers[key] =
                existingHeaders[key];
        });

    headers.Authorization =
        "Bearer " +
        session.access_token;

    if (
        options.body &&
        !headers["Content-Type"]
    ) {
        headers["Content-Type"] =
            "application/json";
    }

    var response =
        await fetch(
            url,
            {
                ...options,
                headers: headers
            }
        );

    if (
        response.status === 401 &&
        retry
    ) {
        var refreshed =
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
    if (
        !session ||
        !session.access_token
    ) {
        clearSession();
        showLogin("");
        return;
    }

    var ordersList =
        document.getElementById(
            "orders-list"
        );

    var refreshBtn =
        document.getElementById(
            "refresh-btn"
        );

    if (ordersList) {
        ordersList.innerHTML =
            '<div class="loading">جاري تحميل الطلبات...</div>';
    }

    if (refreshBtn) {
        refreshBtn.disabled = true;
    }

    try {
        var response =
            await authorizedFetch(
                "/api/orders",
                {
                    method: "GET"
                },
                true
            );

        if (response.status === 401) {
            clearSession();

            showLogin(
                "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى"
            );

            return;
        }

        var data =
            await response
                .json()
                .catch(function () {
                    return {};
                });

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "فشل تحميل الطلبات"
            );
        }

        if (
            Array.isArray(data)
        ) {
            currentOrders =
                data;
        } else {
            currentOrders =
                Array.isArray(data.orders)
                    ? data.orders
                    : [];
        }

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
            ordersList.innerHTML =
                '<div class="empty-state">' +
                '<div class="empty-icon">⚠️</div>' +
                '<div>' +
                escapeHtml(
                    error.message ||
                    "حدث خطأ أثناء تحميل الطلبات"
                ) +
                "</div>" +
                "</div>";
        }

    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
        }
    }
}

function updateStats() {
    var pending =
        currentOrders.filter(
            function (order) {
                return !isDelivered(
                    order
                );
            }
        ).length;

    var delivered =
        currentOrders.filter(
            function (order) {
                return isDelivered(
                    order
                );
            }
        ).length;

    document
        .querySelectorAll(
            "#stat-pending"
        )
        .forEach(
            function (element) {
                element.textContent =
                    pending.toLocaleString(
                        "ar-EG"
                    );
            }
        );

    document
        .querySelectorAll(
            "#stat-delivered"
        )
        .forEach(
            function (element) {
                element.textContent =
                    delivered.toLocaleString(
                        "ar-EG"
                    );
            }
        );
}

function renderOrders() {
    var ordersList =
        document.getElementById(
            "orders-list"
        );

    if (!ordersList) {
        return;
    }

    var orders =
        currentOrders;

    if (
        activeTab === "pending"
    ) {
        orders =
            currentOrders.filter(
                function (order) {
                    return !isDelivered(
                        order
                    );
                }
            );
    }

    if (
        activeTab === "delivered"
    ) {
        orders =
            currentOrders.filter(
                function (order) {
                    return isDelivered(
                        order
                    );
                }
            );
    }

    if (!orders.length) {
        ordersList.innerHTML =
            '<div class="empty-state">' +
            '<div class="empty-icon">📦</div>' +
            '<div>' +
            (
                activeTab === "delivered"
                    ? "لا توجد طلبات مسلّمة"
                    : "لا توجد طلبات قيد التوصيل"
            ) +
            "</div>" +
            "</div>";

        return;
    }

    ordersList.innerHTML =
        orders.map(
            function (order) {
                return createOrderCard(
                    order
                );
            }
        ).join("");

    ordersList
        .querySelectorAll(
            ".deliver-btn"
        )
        .forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        markDelivered(
                            button.dataset.id,
                            button
                        );
                    }
                );
            }
        );
}

function createOrderCard(order) {
    var orderNumber =
        order.order_number ??
        order.orderNumber ??
        order.id ??
        "";

    var customer =
        order.customer_name ??
        order.customer ??
        "";

    var phone =
        order.phone ??
        order.customer_phone ??
        "";

    var area =
        order.area ??
        "";

    var details =
        order.order_details ??
        order.details ??
        "";

    var location =
        order.location_url ??
        order.location ??
        order.location_link ??
        "";

    var coordinator =
        order.appointment_coordinator ??
        order.coordinator ??
        "";

    var note =
        order.note ??
        "";

    var total =
        order.total ??
        0;

    var delivered =
        isDelivered(order);

    var safePhone =
        normalizePhone(phone);

    var safeLocation =
        normalizeLocation(location);

    var html =
        '<article class="order-card ' +
        (
            delivered
                ? "delivered"
                : ""
        ) +
        '">' +

        '<div class="order-header">' +

        '<div class="order-number">' +
        "طلب #" +
        escapeHtml(
            String(orderNumber)
        ) +
        "</div>" +

        '<div class="order-status ' +
        (
            delivered
                ? "delivered"
                : "pending"
        ) +
        '">' +
        (
            delivered
                ? "تم التسليم"
                : "قيد التوصيل"
        ) +
        "</div>" +

        "</div>" +

        '<div class="order-info">' +

        '<div class="info-row">' +
        '<span class="info-label">العميل</span>' +
        '<span class="info-value">' +
        escapeHtml(customer) +
        "</span>" +
        "</div>";

    if (phone) {
        html +=
            '<div class="info-row">' +
            '<span class="info-label">رقم الهاتف</span>' +
            '<span class="info-value phone-value">' +
            escapeHtml(phone) +
            "</span>" +
            "</div>";
    }

    if (area) {
        html +=
            '<div class="info-row">' +
            '<span class="info-label">المنطقة</span>' +
            '<span class="info-value">' +
            escapeHtml(area) +
            "</span>" +
            "</div>";
    }

    if (details) {
        html +=
            '<div class="info-row details-row">' +
            '<span class="info-label">الطلب</span>' +
            '<span class="info-value">' +
            escapeHtml(details) +
            "</span>" +
            "</div>";
    }

    if (coordinator) {
        html +=
            '<div class="info-row">' +
            '<span class="info-label">منسق الموعد</span>' +
            '<span class="info-value">' +
            escapeHtml(coordinator) +
            "</span>" +
            "</div>";
    }

    if (note) {
        html +=
            '<div class="info-row note-row">' +
            '<span class="info-label">ملاحظات</span>' +
            '<span class="info-value">' +
            escapeHtml(note) +
            "</span>" +
            "</div>";
    }

    html +=
        '<div class="info-row total-row">' +
        '<span class="info-label">الإجمالي</span>' +
        '<span class="info-value">' +
        formatTotal(total) +
        "</span>" +
        "</div>" +

        "</div>" +

        '<div class="order-actions">';

    if (safePhone) {
        html +=
            '<a class="call-btn" href="tel:' +
            escapeAttribute(
                safePhone
            ) +
            '">' +
            "📞 اتصال بالعميل" +
            "</a>";
    }

    if (safeLocation) {
        html +=
            '<a class="location-btn" href="' +
            escapeAttribute(
                safeLocation
            ) +
            '" target="_blank" rel="noopener noreferrer">' +
            "📍 فتح الموقع" +
            "</a>";
    }

    if (delivered) {
        html +=
            '<div class="delivered-label">' +
            "✓ تم التسليم" +
            "</div>";
    } else {
        html +=
            '<button type="button" class="deliver-btn" data-id="' +
            escapeAttribute(
                String(
                    order.id ??
                    order.order_number ??
                    ""
                )
            ) +
            '">' +
            "✓ تم التسليم" +
            "</button>";
    }

    html +=
        "</div>" +
        "</article>";

    return html;
}

async function markDelivered(
    orderId,
    button
) {
    if (
        !session ||
        !session.access_token
    ) {
        showLogin("");
        return;
    }

    if (!orderId) {
        showToast(
            "رقم الطلب غير موجود",
            "error"
        );

        return;
    }

    var order =
        currentOrders.find(
            function (item) {
                return String(
                    item.id ??
                    item.order_number
                ) ===
                String(orderId);
            }
        );

    var orderNumber =
        order?.order_number ??
        order?.id ??
        orderId;

    var customer =
        order?.customer_name ||
        "";

    var confirmationText =
        customer
            ? "هل تريد تأكيد تسليم الطلب #" +
              orderNumber +
              " للعميل " +
              customer +
              "؟"
            : "هل تريد تأكيد تسليم الطلب #" +
              orderNumber +
              "؟";

    if (
        !window.confirm(
            confirmationText
        )
    ) {
        return;
    }

    if (button) {
        button.disabled = true;

        button.textContent =
            "جاري تسجيل التسليم...";
    }

    try {
        var response =
            await authorizedFetch(
                "/api/deliver",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            order_id:
                                orderId,

                            orderId:
                                orderId
                        })
                },
                true
            );

        if (response.status === 401) {
            clearSession();

            showLogin(
                "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى"
            );

            return;
        }

        var data =
            await response
                .json()
                .catch(function () {
                    return {};
                });

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "فشل تسجيل التسليم"
            );
        }

        var target =
            currentOrders.find(
                function (item) {
                    return String(
                        item.id ??
                        item.order_number
                    ) ===
                    String(orderId);
                }
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
    var status =
        String(
            order &&
            (
                order.delivery_status ??
                order.status ??
                ""
            )
        )
            .trim()
            .toLowerCase();

    return (
        status === "delivered" ||
        status === "done" ||
        status === "تم" ||
        status.indexOf(
            "تم التسليم"
        ) !== -1 ||
        status.indexOf(
            "مسلم"
        ) !== -1
    );
}

function normalizePhone(phone) {
    if (!phone) {
        return "";
    }

    var value =
        String(phone)
            .trim()
            .replace(/[^\d+]/g, "");

    if (
        value.indexOf("00") === 0
    ) {
        value =
            "+" +
            value.substring(2);
    }

    if (
        value.indexOf("05") === 0
    ) {
        value =
            "+971" +
            value.substring(1);
    }

    if (
        value.indexOf("5") === 0 &&
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

    var value =
        String(location).trim();

    if (
        !/^https?:\/\//i.test(
            value
        )
    ) {
        return "";
    }

    if (
        /open%20location/i.test(
            value
        ) ||
        /\/Open%20Location/i.test(
            value
        )
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

    var number =
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
    type
) {
    type =
        type || "success";

    var toast =
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
        "toast " + type;

    toast.style.display =
        "block";

    toastTimer =
        setTimeout(
            function () {
                toast.style.display =
                    "none";
            },
            3000
        );
}

function logout() {
    clearSession();

    currentOrders = [];

    activeTab = "pending";

    showLogin("");
}

function escapeHtml(value) {
    return String(
        value ?? ""
    )
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
