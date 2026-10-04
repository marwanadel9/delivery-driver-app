```javascript
"use strict";

var SESSION_KEY = "driver_session";

var session = null;
var orders = [];
var filter = "pending";
var toastTimer = null;

document.addEventListener("DOMContentLoaded", function () {
    session = loadSession();

    setupEvents();

    if (session && session.access_token) {
        showOrders();
        loadOrders();
    } else {
        clearSession();
        showLogin();
    }
});

function setupEvents() {
    var loginForm =
        document.getElementById("login-form");

    var refreshBtn =
        document.getElementById("refresh-btn");

    var logoutBtn =
        document.getElementById("logout-btn");

    if (loginForm) {
        loginForm.addEventListener(
            "submit",
            function (event) {
                event.preventDefault();
                login();
            }
        );
    }

    if (refreshBtn) {
        refreshBtn.addEventListener(
            "click",
            loadOrders
        );
    }

    if (logoutBtn) {
        logoutBtn.addEventListener(
            "click",
            logout
        );
    }

    document
        .querySelectorAll(".tab")
        .forEach(function (button) {
            button.addEventListener(
                "click",
                function () {
                    document
                        .querySelectorAll(".tab")
                        .forEach(function (item) {
                            item.classList.remove(
                                "active"
                            );
                        });

                    button.classList.add(
                        "active"
                    );

                    filter =
                        button.getAttribute(
                            "data-filter"
                        ) || "pending";

                    render();
                }
            );
        });
}

function loadSession() {
    try {
        var saved =
            localStorage.getItem(
                SESSION_KEY
            );

        if (!saved) {
            return null;
        }

        var data =
            JSON.parse(saved);

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
        access_token:
            accessToken,

        refresh_token:
            refreshToken,

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
        document.getElementById(
            "login-view"
        );

    var ordersView =
        document.getElementById(
            "orders-view"
        );

    var errorBox =
        document.getElementById(
            "login-error"
        );

    if (loginView) {
        loginView.hidden = false;
    }

    if (ordersView) {
        ordersView.hidden = true;
    }

    if (errorBox) {
        errorBox.textContent =
            message || "";

        errorBox.hidden =
            !message;
    }
}

function showOrders() {
    var loginView =
        document.getElementById(
            "login-view"
        );

    var ordersView =
        document.getElementById(
            "orders-view"
        );

    if (loginView) {
        loginView.hidden = true;
    }

    if (ordersView) {
        ordersView.hidden = false;
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
            session &&
            (
                session.mandoub_name ||
                session.username
            ) ||
            "المندوب";
    }

    if (sheetName) {
        sheetName.textContent =
            session &&
            session.sheet_name
            ? "القائمة: " +
              session.sheet_name
            : "";
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

            errorBox.hidden =
                false;
        }

        return;
    }

    if (loginBtn) {
        loginBtn.disabled = true;

        loginBtn.querySelector("span")
            ? loginBtn.querySelector(
                "span"
            ).textContent =
                "جاري تسجيل الدخول..."
            : loginBtn.textContent =
                "جاري تسجيل الدخول...";
    }

    if (errorBox) {
        errorBox.textContent = "";
        errorBox.hidden = true;
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

        var accessToken =
            data.access_token ||
            data.token ||
            (
                data.session &&
                data.session.access_token
            ) ||
            "";

        if (!accessToken) {
            throw new Error(
                "تم الاتصال بالموقع لكن لم يتم استلام جلسة الدخول"
            );
        }

        saveSession(data);

        if (passwordInput) {
            passwordInput.value = "";
        }

        showOrders();

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

            var span =
                loginBtn.querySelector(
                    "span"
                );

            if (span) {
                span.textContent =
                    "تسجيل الدخول";
            } else {
                loginBtn.textContent =
                    "تسجيل الدخول";
            }
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

        var accessToken =
            data.access_token ||
            data.token ||
            (
                data.session &&
                data.session.access_token
            ) ||
            "";

        if (!accessToken) {
            return false;
        }

        saveSession({
            access_token:
                accessToken,

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

    Object.keys(
        options.headers || {}
    ).forEach(function (key) {
        headers[key] =
            options.headers[key];
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
                headers:
                    headers
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
        showLogin();
        return;
    }

    var list =
        document.getElementById(
            "orders-list"
        );

    var refreshBtn =
        document.getElementById(
            "refresh-btn"
        );

    if (list) {
        list.innerHTML =
            '<p class="loading">جارٍ تحميل الطلبات…</p>';
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
                }
            );

        if (response.status === 401) {
            clearSession();

            showLogin(
                "انتهت جلسة الدخول، يرجى تسجيل الدخول مجددًا"
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

        orders =
            Array.isArray(data)
                ? data
                : (
                    Array.isArray(
                        data.orders
                    )
                        ? data.orders
                        : []
                );

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

        showOrders();
        render();

    } catch (error) {
        if (list) {
            list.innerHTML =
                '<p class="empty">' +
                '<span class="big">⚠️</span>' +
                escapeHtml(
                    error.message ||
                    "حدث خطأ أثناء تحميل الطلبات"
                ) +
                "</p>";
        }

    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
        }
    }
}

function render() {
    var list =
        document.getElementById(
            "orders-list"
        );

    if (!list) {
        return;
    }

    var done =
        orders.filter(
            function (order) {
                return isDelivered(
                    order
                );
            }
        );

    var pending =
        orders.length -
        done.length;

    var statPending =
        document.getElementById(
            "stat-pending"
        );

    var statDone =
        document.getElementById(
            "stat-done"
        );

    if (statPending) {
        statPending.textContent =
            pending.toLocaleString(
                "ar-EG"
            );
    }

    if (statDone) {
        statDone.textContent =
            done.length.toLocaleString(
                "ar-EG"
            );
    }

    var shown =
        orders.filter(
            function (order) {
                if (
                    filter === "done"
                ) {
                    return isDelivered(
                        order
                    );
                }

                if (
                    filter === "all"
                ) {
                    return true;
                }

                return !isDelivered(
                    order
                );
            }
        );

    list.replaceChildren();

    if (!shown.length) {
        list.innerHTML =
            '<p class="empty">' +
            '<span class="big">📦</span>' +
            (
                filter === "done"
                    ? "لا توجد طلبات مسلّمة بعد"
                    : "لا توجد طلبات حالياً"
            ) +
            "</p>";

        return;
    }

    var template =
        document.getElementById(
            "order-tpl"
        );

    if (!template) {
        return;
    }

    shown.forEach(
        function (order) {
            var node =
                template.content
                    .firstElementChild
                    .cloneNode(true);

            setField(
                node,
                "order_number",
                order.order_number ??
                order.id
            );

            setField(
                node,
                "customer_name",
                order.customer_name
            );

            setField(
                node,
                "area",
                order.area
            );

            setField(
                node,
                "order_details",
                order.order_details
            );

            setField(
                node,
                "appointment_coordinator",
                order.appointment_coordinator
            );

            setField(
                node,
                "note",
                order.note
            );

            setField(
                node,
                "total",
                formatTotal(
                    order.total
                )
            );

            var phone =
                node.querySelector(
                    '[data-f="phone"]'
                );

            if (phone) {
                if (order.phone) {
                    phone.textContent =
                        order.phone;

                    phone.href =
                        normalizePhone(
                            order.phone
                        );
                } else {
                    phone.closest(
                        ".meta-item"
                    ).hidden = true;
                }
            }

            var location =
                node.querySelector(
                    '[data-f="location_url"]'
                );

            if (location) {
                var url =
                    normalizeLocation(
                        order.location_url
                    );

                if (url) {
                    location.href =
                        url;

                    location.hidden =
                        false;
                } else {
                    location.closest(
                        ".location-row"
                    ).hidden = true;
                }
            }

            var delivered =
                isDelivered(
                    order
                );

            var status =
                node.querySelector(
                    '[data-f="delivery_status"]'
                );

            if (status) {
                status.textContent =
                    delivered
                        ? "تم التسليم"
                        : "قيد التوصيل";

                status.classList.toggle(
                    "ok",
                    delivered
                );
            }

            node.classList.toggle(
                "is-done",
                delivered
            );

            var button =
                node.querySelector(
                    ".btn-deliver"
                );

            if (button) {
                if (delivered) {
                    button.remove();
                } else {
                    button.addEventListener(
                        "click",
                        function () {
                            markDelivered(
                                order,
                                button
                            );
                        }
                    );
                }
            }

            list.appendChild(
                node
            );
        }
    );
}

function setField(
    node,
    field,
    value
) {
    var element =
        node.querySelector(
            '[data-f="' +
            field +
            '"]'
        );

    if (!element) {
        return;
    }

    if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
    ) {
        element.textContent =
            value;
    } else {
        element.textContent =
            "—";
    }
}

async function markDelivered(
    order,
    button
) {
    var orderId =
        order.id;

    if (!orderId) {
        showToast(
            "رقم الطلب غير موجود",
            true
        );

        return;
    }

    var orderNumber =
        order.order_number ||
        order.id;

    var customer =
        order.customer_name ||
        "";

    var message =
        customer
            ? "تأكيد تسليم الطلب #" +
              orderNumber +
              " للعميل " +
              customer +
              "؟"
            : "تأكيد تسليم الطلب #" +
              orderNumber +
              "؟";

    if (
        !window.confirm(
            message
        )
    ) {
        return;
    }

    if (button) {
        button.disabled = true;

        button.textContent =
            "جارٍ التحديث…";
    }

    try {
        var response =
            await authorizedFetch(
                "/api/deliver",
                {
                    method: "POST",

                    body:
                        JSON.stringify({
                            orderId:
                                orderId,

                            order_id:
                                orderId
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
                "فشل تسجيل التسليم"
            );
        }

        order.delivery_status =
            "delivered";

        render();

        showToast(
            "تم تسجيل التسليم بنجاح ✅",
            false
        );

    } catch (error) {
        if (button) {
            button.disabled = false;

            button.textContent =
                "تم التسليم";
        }

        showToast(
            error.message ||
            "حدث خطأ أثناء تسجيل التسليم",
            true
        );
    }
}

function isDelivered(order) {
    var status =
        String(
            order &&
            (
                order.delivery_status ||
                order.status ||
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
            .replace(
                /[^\d+]/g,
                ""
            );

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

    return "tel:" + value;
}

function normalizeLocation(
    location
) {
    if (!location) {
        return "";
    }

    var value =
        String(location)
            .trim();

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
        )
    ) {
        return "";
    }

    return value;
}

function formatTotal(
    value
) {
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
                    maximumFractionDigits:
                        2
                }
            ) +
            " درهم"
        );
    }

    return (
        String(value) +
        " درهم"
    );
}

function showToast(
    message,
    isError
) {
    var toast =
        document.getElementById(
            "toast"
        );

    if (!toast) {
        return;
    }

    clearTimeout(
        toastTimer
    );

    toast.textContent =
        message;

    toast.hidden = false;

    toast.classList.toggle(
        "err",
        !!isError
    );

    toastTimer =
        setTimeout(
            function () {
                toast.hidden =
                    true;
            },
            3000
        );
}

function logout() {
    clearSession();

    orders = [];

    filter = "pending";

    showLogin();
}

function escapeHtml(
    value
) {
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
```
