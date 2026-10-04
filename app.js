```javascript
var SESSION_KEY = "driver_session";

var session = null;
var orders = [];
var currentFilter = "pending";
var toastTimer = null;

function getElement(id) {
    return document.getElementById(id);
}

function saveSession(data) {
    if (!data) {
        return;
    }

    session = {
        access_token: data.access_token || "",
        refresh_token: data.refresh_token || "",
        username: data.username || "",
        mandoub_name: data.mandoub_name || "",
        sheet_name: data.sheet_name || "",
        expires_at: data.expires_at || 0
    };

    localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(session)
    );
}

function loadSession() {
    try {
        var saved = localStorage.getItem(SESSION_KEY);

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

        return null;

    } catch (error) {
        return null;
    }
}

function clearSession() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
}

function showLogin(message) {
    var loginView = getElement("login-view");
    var ordersView = getElement("orders-view");
    var errorBox = getElement("login-error");

    if (loginView) {
        loginView.hidden = false;
    }

    if (ordersView) {
        ordersView.hidden = true;
    }

    if (errorBox) {
        errorBox.textContent = message || "";
        errorBox.hidden = !message;
    }
}

function showOrders() {
    var loginView = getElement("login-view");
    var ordersView = getElement("orders-view");

    if (loginView) {
        loginView.hidden = true;
    }

    if (ordersView) {
        ordersView.hidden = false;
    }

    var driverName = getElement("driver-name");
    var sheetName = getElement("sheet-name");

    if (driverName) {
        driverName.textContent =
            session.mandoub_name ||
            session.username ||
            "المندوب";
    }

    if (sheetName) {
        sheetName.textContent =
            session.sheet_name
                ? "القائمة: " + session.sheet_name
                : "";
    }
}

function setLoginButton(text, disabled) {
    var button = getElement("login-btn");

    if (!button) {
        return;
    }

    button.disabled = disabled;

    var span = button.querySelector("span");

    if (span) {
        span.textContent = text;
    } else {
        button.textContent = text;
    }
}

async function login() {
    var usernameInput = getElement("username");
    var passwordInput = getElement("password");
    var errorBox = getElement("login-error");

    var username = usernameInput
        ? usernameInput.value.trim().toLowerCase()
        : "";

    var password = passwordInput
        ? passwordInput.value
        : "";

    if (!username || !password) {
        if (errorBox) {
            errorBox.textContent =
                "يرجى إدخال اسم المستخدم وكلمة المرور";
            errorBox.hidden = false;
        }

        return;
    }

    setLoginButton(
        "جارٍ تسجيل الدخول...",
        true
    );

    if (errorBox) {
        errorBox.textContent = "";
        errorBox.hidden = true;
    }

    try {
        var response = await fetch(
            "/api/login",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    username: username,
                    password: password
                })
            }
        );

        var data = await response
            .json()
            .catch(function () {
                return {};
            });

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "تعذر تسجيل الدخول"
            );
        }

        if (!data.access_token) {
            throw new Error(
                "لم يتم استلام رمز الدخول من الخادم"
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
        setLoginButton(
            "تسجيل الدخول",
            false
        );
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
        var response = await fetch(
            "/api/refresh",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    refresh_token:
                        session.refresh_token
                })
            }
        );

        var data = await response
            .json()
            .catch(function () {
                return {};
            });

        if (!response.ok) {
            return false;
        }

        if (!data.access_token) {
            return false;
        }

        saveSession({
            access_token:
                data.access_token,

            refresh_token:
                data.refresh_token ||
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

async function apiFetch(
    url,
    options,
    retry
) {
    options = options || {};

    if (retry === undefined) {
        retry = true;
    }

    if (
        !session ||
        !session.access_token
    ) {
        throw new Error(
            "انتهت جلسة الدخول"
        );
    }

    var headers = {};

    if (options.headers) {
        Object.keys(
            options.headers
        ).forEach(function (key) {
            headers[key] =
                options.headers[key];
        });
    }

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

    var requestOptions = {
        method:
            options.method ||
            "GET",

        headers:
            headers
    };

    if (options.body) {
        requestOptions.body =
            options.body;
    }

    var response = await fetch(
        url,
        requestOptions
    );

    if (
        response.status === 401 &&
        retry
    ) {
        var refreshed =
            await refreshSession();

        if (refreshed) {
            return apiFetch(
                url,
                options,
                false
            );
        }
    }

    return response;
}

async function loadOrders() {
    var list = getElement("orders-list");
    var refreshButton =
        getElement("refresh-btn");

    if (
        !session ||
        !session.access_token
    ) {
        showLogin();
        return;
    }

    if (list) {
        list.innerHTML =
            '<p class="loading">جارٍ تحميل الطلبات…</p>';
    }

    if (refreshButton) {
        refreshButton.disabled = true;
    }

    try {
        var response = await apiFetch(
            "/api/orders",
            {
                method: "GET"
            }
        );

        if (response.status === 401) {
            clearSession();

            showLogin(
                "انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى"
            );

            return;
        }

        var data = await response
            .json()
            .catch(function () {
                return {};
            });

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "تعذر تحميل الطلبات"
            );
        }

        if (
            Array.isArray(data)
        ) {
            orders = data;
        } else if (
            Array.isArray(data.orders)
        ) {
            orders = data.orders;
        } else {
            orders = [];
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

        showOrders();
        renderOrders();

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
        if (refreshButton) {
            refreshButton.disabled = false;
        }
    }
}

function isDelivered(order) {
    if (!order) {
        return false;
    }

    var status =
        String(
            order.delivery_status ||
            order.status ||
            ""
        )
            .trim()
            .toLowerCase();

    return (
        status === "delivered" ||
        status === "done" ||
        status === "تم" ||
        status.indexOf("تم التسليم") !== -1 ||
        status.indexOf("مسلم") !== -1
    );
}

function formatTotal(value) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return "0 درهم";
    }

    var number = Number(value);

    if (Number.isFinite(number)) {
        return (
            number.toLocaleString(
                "ar-EG",
                {
                    maximumFractionDigits: 2
                }
            ) +
            " درهم"
        );
    }

    return String(value) + " درهم";
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

function renderOrders() {
    var list =
        getElement("orders-list");

    if (!list) {
        return;
    }

    var deliveredCount =
        orders.filter(function (order) {
            return isDelivered(order);
        }).length;

    var pendingCount =
        orders.length -
        deliveredCount;

    var pendingStat =
        getElement("stat-pending");

    var doneStat =
        getElement("stat-done");

    if (pendingStat) {
        pendingStat.textContent =
            pendingCount.toLocaleString(
                "ar-EG"
            );
    }

    if (doneStat) {
        doneStat.textContent =
            deliveredCount.toLocaleString(
                "ar-EG"
            );
    }

    var visibleOrders =
        orders.filter(function (order) {
            if (
                currentFilter === "done"
            ) {
                return isDelivered(order);
            }

            if (
                currentFilter === "all"
            ) {
                return true;
            }

            return !isDelivered(order);
        });

    list.replaceChildren();

    if (!visibleOrders.length) {
        list.innerHTML =
            '<p class="empty">' +
            '<span class="big">📦</span>' +
            (
                currentFilter === "done"
                    ? "لا توجد طلبات مسلّمة بعد"
                    : "لا توجد طلبات حالياً"
            ) +
            "</p>";

        return;
    }

    var template =
        getElement("order-tpl");

    if (!template) {
        return;
    }

    visibleOrders.forEach(
        function (order) {
            var node =
                template.content
                    .firstElementChild
                    .cloneNode(true);

            setField(
                node,
                "order_number",
                order.order_number ||
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
                        createPhoneLink(
                            order.phone
                        );
                } else {
                    var phoneRow =
                        phone.closest(
                            ".meta-item"
                        );

                    if (phoneRow) {
                        phoneRow.hidden =
                            true;
                    }
                }
            }

            var location =
                node.querySelector(
                    '[data-f="location_url"]'
                );

            if (location) {
                var locationUrl =
                    String(
                        order.location_url ||
                        ""
                    ).trim();

                if (
                    /^https?:\/\//i.test(
                        locationUrl
                    )
                ) {
                    location.href =
                        locationUrl;

                    location.hidden =
                        false;
                } else {
                    var locationRow =
                        location.closest(
                            ".location-row"
                        );

                    if (locationRow) {
                        locationRow.hidden =
                            true;
                    }
                }
            }

            var delivered =
                isDelivered(order);

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

            var deliverButton =
                node.querySelector(
                    ".btn-deliver"
                );

            if (deliverButton) {
                if (delivered) {
                    deliverButton.remove();
                } else {
                    deliverButton.addEventListener(
                        "click",
                        function () {
                            markDelivered(
                                order,
                                deliverButton
                            );
                        }
                    );
                }
            }

            list.appendChild(node);
        }
    );
}

async function markDelivered(
    order,
    button
) {
    if (!order || !order.id) {
        showToast(
            "رقم الطلب غير موجود",
            true
        );

        return;
    }

    var number =
        order.order_number ||
        order.id;

    var customer =
        order.customer_name ||
        "";

    var message =
        customer
            ? "تأكيد تسليم الطلب #" +
              number +
              " للعميل " +
              customer +
              "؟"
            : "تأكيد تسليم الطلب #" +
              number +
              "؟";

    if (!confirm(message)) {
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent =
            "جارٍ التحديث…";
    }

    try {
        var response =
            await apiFetch(
                "/api/deliver",
                {
                    method: "POST",

                    body: JSON.stringify({
                        orderId:
                            order.id
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

        renderOrders();

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

function createPhoneLink(phone) {
    var value =
        String(phone)
            .replace(
                /[^\d+]/g,
                ""
            );

    return "tel:" + value;
}

function showToast(
    message,
    isError
) {
    var toast =
        getElement("toast");

    if (!toast) {
        return;
    }

    clearTimeout(toastTimer);

    toast.textContent =
        message;

    toast.classList.toggle(
        "err",
        !!isError
    );

    toast.hidden = false;

    toastTimer =
        setTimeout(
            function () {
                toast.hidden = true;
            },
            3000
        );
}

function logout() {
    clearSession();

    orders = [];
    currentFilter = "pending";

    showLogin();
}

function escapeHtml(value) {
    return String(value || "")
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

function setupApplication() {
    var loginForm =
        getElement("login-form");

    var refreshButton =
        getElement("refresh-btn");

    var logoutButton =
        getElement("logout-btn");

    if (loginForm) {
        loginForm.addEventListener(
            "submit",
            function (event) {
                event.preventDefault();
                login();
            }
        );
    }

    if (refreshButton) {
        refreshButton.addEventListener(
            "click",
            loadOrders
        );
    }

    if (logoutButton) {
        logoutButton.addEventListener(
            "click",
            logout
        );
    }

    var tabs =
        document.querySelectorAll(
            ".tab"
        );

    tabs.forEach(
        function (tab) {
            tab.addEventListener(
                "click",
                function () {
                    tabs.forEach(
                        function (item) {
                            item.classList.remove(
                                "active"
                            );
                        }
                    );

                    tab.classList.add(
                        "active"
                    );

                    currentFilter =
                        tab.getAttribute(
                            "data-filter"
                        ) ||
                        "pending";

                    renderOrders();
                }
            );
        }
    );

    session =
        loadSession();

    if (
        session &&
        session.access_token
    ) {
        showOrders();
        loadOrders();
    } else {
        clearSession();
        showLogin();
    }
}

if (
    document.readyState === "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        setupApplication
    );
} else {
    setupApplication();
}
```
