```javascript
(() => {
  'use strict';

  const SESSION_KEY = 'driver_session';

  const state = {
    session: null,
    orders: [],
    filter: 'pending',
    sheet: ''
  };

  const $ = (id) => document.getElementById(id);

  const normalizePayment = (value) => {
    const v = String(value ?? '').trim().toLowerCase();

    if (
      v === 'cash' ||
      v === 'كاش' ||
      v === 'نقدي' ||
      v.includes('cash')
    ) {
      return 'cash';
    }

    if (
      v === 'bank_transfer' ||
      v === 'bank' ||
      v === 'transfer' ||
      v === 'تحويل بنكي' ||
      v === 'تحويل'
    ) {
      return 'bank_transfer';
    }

    return '';
  };

  const paymentLabel = (value) => {
    const payment = normalizePayment(value);

    if (payment === 'cash') {
      return '💵 دفع كاش';
    }

    if (payment === 'bank_transfer') {
      return '🏦 تحويل بنكي';
    }

    return 'لم يتم تحديد طريقة الدفع';
  };

  const isDelivered = (value) => {
    const v = String(value ?? '').trim().toLowerCase();

    return (
      v === 'delivered' ||
      v === 'done' ||
      v === 'تم' ||
      v.includes('تم التسليم') ||
      v.includes('مسلم')
    );
  };

  const statusLabel = (value) => {
    return isDelivered(value)
      ? 'تم التسليم'
      : (value ? String(value) : 'قيد التوصيل');
  };

  const formatTotal = (value) => {
    const text = String(value ?? '').trim();

    if (!text) {
      return '—';
    }

    const number = Number(
      text.replace(/[^\d.-]/g, '')
    );

    if (!Number.isFinite(number)) {
      return text;
    }

    return `${number.toLocaleString('ar-EG', {
      maximumFractionDigits: 2
    })} درهم`;
  };

  const safeUrl = (value) => {
    const url = String(value ?? '').trim();

    if (!url) {
      return '';
    }

    try {
      const parsed = new URL(url);

      if (
        parsed.protocol === 'https:' ||
        parsed.protocol === 'http:'
      ) {
        return parsed.href;
      }
    } catch {
      return '';
    }

    return '';
  };

  const telHref = (value) => {
    const phone = String(value ?? '').trim();

    if (!phone) {
      return '';
    }

    const cleaned = phone.replace(/[^\d+]/g, '');

    return cleaned
      ? `tel:${cleaned}`
      : '';
  };

  let toastTimer;

  const toast = (message, isError = false) => {
    const element = $('toast');

    if (!element) {
      return;
    }

    element.textContent = message;
    element.classList.toggle('err', isError);
    element.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      element.hidden = true;
    }, 3000);
  };

  const saveSession = (session) => {
    state.session = session;

    if (session) {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(session)
      );
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  };

  const normalizeSession = (data) => {
    const expiresIn = Number(data?.expires_in);

    let expiresAt = Number(data?.expires_at);

    if (!Number.isFinite(expiresAt)) {
      expiresAt =
        Date.now() / 1000 +
        (Number.isFinite(expiresIn) ? expiresIn : 3600) -
        30;
    }

    return {
      access_token: data?.access_token || '',
      refresh_token: data?.refresh_token || '',
      username:
        data?.username ||
        data?.user?.username ||
        '',
      email:
        data?.email ||
        data?.user?.email ||
        '',
      mandoub_name:
        data?.mandoub_name ||
        data?.user?.mandoub_name ||
        '',
      sheet_name:
        data?.sheet_name ||
        data?.user?.sheet_name ||
        '',
      can_call:
        Boolean(
          data?.can_call ??
          data?.user?.can_call
        ),
      expires_at: expiresAt
    };
  };

  const isDriverTwo = () => {
    const username =
      String(state.session?.username || '')
        .trim()
        .toLowerCase();

    const sheet =
      String(state.session?.sheet_name || '')
        .trim()
        .toLowerCase();

    return (
      Boolean(state.session?.can_call) ||
      username === 'zain2' ||
      username === 'مندوب 2' ||
      sheet === 'mandoub2'
    );
  };

  async function refreshSession() {
    if (!state.session?.refresh_token) {
      throw new Error('expired');
    }

    const response = await fetch(
      '/api/refresh',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token:
            state.session.refresh_token
        })
      }
    );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || 'expired'
      );
    }

    saveSession(
      normalizeSession({
        ...data,
        username:
          state.session.username,
        email:
          state.session.email,
        mandoub_name:
          state.session.mandoub_name,
        sheet_name:
          state.session.sheet_name,
        can_call:
          state.session.can_call
      })
    );
  }

  async function apiFetch(
    path,
    options = {},
    retry = true
  ) {
    if (!state.session?.access_token) {
      throw new Error('expired');
    }

    const expiresAt =
      Number(state.session.expires_at);

    if (
      Number.isFinite(expiresAt) &&
      expiresAt - 60 <
        Date.now() / 1000
    ) {
      try {
        await refreshSession();
      } catch {
        logout(
          'انتهت الجلسة، يرجى تسجيل الدخول مجددًا'
        );

        throw new Error('expired');
      }
    }

    const headers = {
      'Content-Type':
        'application/json',
      Authorization:
        `Bearer ${state.session.access_token}`,
      ...(options.headers || {})
    };

    const response = await fetch(
      path,
      {
        ...options,
        headers
      }
    );

    if (
      response.status === 401 &&
      retry
    ) {
      try {
        await refreshSession();
      } catch {
        logout(
          'انتهت الجلسة، يرجى تسجيل الدخول مجددًا'
        );

        throw new Error('expired');
      }

      return apiFetch(
        path,
        options,
        false
      );
    }

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        'حدث خطأ غير متوقع'
      );
    }

    return data;
  }

  function showLogin(message = '') {
    const loginView =
      $('login-view');

    const ordersView =
      $('orders-view');

    if (loginView) {
      loginView.hidden = false;
    }

    if (ordersView) {
      ordersView.hidden = true;
    }

    const error =
      $('login-error');

    if (error) {
      error.hidden = !message;
      error.textContent =
        message || '';
    }
  }

  function showOrders() {
    const loginView =
      $('login-view');

    const ordersView =
      $('orders-view');

    if (loginView) {
      loginView.hidden = true;
    }

    if (ordersView) {
      ordersView.hidden = false;
    }

    const driverName =
      $('driver-name');

    if (driverName) {
      driverName.textContent =
        state.session?.mandoub_name ||
        state.session?.username ||
        'المندوب';
    }

    loadOrders();
  }

  async function loadOrders() {
    const list =
      $('orders-list');

    const refreshButton =
      $('refresh-btn');

    if (!list) {
      return;
    }

    if (!state.orders.length) {
      list.innerHTML =
        '<p class="loading">جارٍ تحميل الطلبات…</p>';
    }

    if (refreshButton) {
      refreshButton.classList.add('spin');
      refreshButton.disabled = true;
    }

    try {
      const data =
        await apiFetch('/api/orders');

      const orders =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.orders)
            ? data.orders
            : [];

      state.orders = orders;

      state.sheet =
        data?.sheet ||
        data?.sheet_name ||
        state.session?.sheet_name ||
        '';

      if (
        data &&
        !Array.isArray(data)
      ) {
        const returnedSession =
          normalizeSession({
            ...state.session,
            ...data
          });

        if (
          returnedSession.username ||
          returnedSession.sheet_name
        ) {
          saveSession(
            returnedSession
          );
        }
      }

      const sheetElement =
        $('sheet-name');

      if (sheetElement) {
        sheetElement.textContent =
          state.sheet
            ? `القائمة: ${state.sheet}`
            : 'قائمة الطلبات';
      }

      render();
    } catch (error) {
      if (
        error.message === 'expired'
      ) {
        return;
      }

      list.innerHTML =
        `<p class="empty">
          <span class="big">⚠️</span>
          ${escapeHtml(error.message)}
        </p>`;
    } finally {
      if (refreshButton) {
        refreshButton.classList.remove(
          'spin'
        );

        refreshButton.disabled = false;
      }
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateStats() {
    const pending =
      state.orders.filter(
        (order) =>
          !isDelivered(
            order.delivery_status
          )
      ).length;

    const done =
      state.orders.length -
      pending;

    const pendingElement =
      $('stat-pending');

    const doneElement =
      $('stat-done');

    const counterElement =
      $('orders-counter-number');

    if (pendingElement) {
      pendingElement.textContent =
        pending.toLocaleString(
          'ar-EG'
        );
    }

    if (doneElement) {
      doneElement.textContent =
        done.toLocaleString(
          'ar-EG'
        );
    }

    if (counterElement) {
      const shown =
        getFilteredOrders().length;

      counterElement.textContent =
        shown.toLocaleString(
          'ar-EG'
        );
    }
  }

  function getFilteredOrders() {
    return state.orders.filter(
      (order) => {
        if (
          state.filter === 'all'
        ) {
          return true;
        }

        if (
          state.filter === 'done'
        ) {
          return isDelivered(
            order.delivery_status
          );
        }

        return !isDelivered(
          order.delivery_status
        );
      }
    );
  }

  function setText(
    node,
    field,
    value
  ) {
    const element =
      node.querySelector(
        `[data-f="${field}"]`
      );

    if (!element) {
      return;
    }

    const text =
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ''
        ? String(value)
        : '—';

    element.textContent = text;
  }

  function render() {
    const list =
      $('orders-list');

    const template =
      $('order-tpl');

    if (!list || !template) {
      return;
    }

    updateStats();

    const shown =
      getFilteredOrders();

    list.replaceChildren();

    if (!shown.length) {
      const message =
        state.filter === 'done'
          ? 'لا توجد طلبات مسلّمة بعد'
          : state.filter === 'all'
            ? 'لا توجد طلبات حالياً'
            : 'لا توجد طلبات قيد التوصيل';

      list.innerHTML =
        `<p class="empty">
          <span class="big">📦</span>
          ${message}
        </p>`;

      updateStats();

      return;
    }

    for (const order of shown) {
      const node =
        template.content
          .firstElementChild
          .cloneNode(true);

      const orderNumber =
        order.order_number ??
        order.id ??
        '—';

      const delivered =
        isDelivered(
          order.delivery_status
        );

      setText(
        node,
        'order_number',
        orderNumber
      );

      setText(
        node,
        'customer_name',
        order.customer_name
      );

      setText(
        node,
        'area',
        order.area
      );

      setText(
        node,
        'order_details',
        order.order_details
      );

      setText(
        node,
        'appointment_coordinator',
        order.appointment_coordinator
      );

      setText(
        node,
        'note',
        order.note
      );

      setText(
        node,
        'total',
        formatTotal(order.total)
      );

      const status =
        node.querySelector(
          '[data-f="delivery_status"]'
        );

      if (status) {
        status.textContent =
          statusLabel(
            order.delivery_status
          );

        status.classList.toggle(
          'ok',
          delivered
        );
      }

      const phone =
        node.querySelector(
          '[data-f="phone"]'
        );

      if (phone) {
        if (order.phone) {
          phone.textContent =
            String(order.phone);

          phone.removeAttribute(
            'href'
          );
        } else {
          phone.textContent = '—';
        }
      }

      const callButton =
        node.querySelector(
          '.call-btn'
        );

      if (callButton) {
        const phoneUrl =
          telHref(order.phone);

        if (
          isDriverTwo() &&
          phoneUrl
        ) {
          callButton.href =
            phoneUrl;

          callButton.hidden = false;
        } else {
          callButton.hidden = true;
        }
      }

      const locationButton =
        node.querySelector(
          '[data-f="location_url"]'
        );

      if (locationButton) {
        const locationUrl =
          safeUrl(
            order.location_url
          );

        if (locationUrl) {
          locationButton.href =
            locationUrl;

          locationButton.target =
            '_blank';

          locationButton.rel =
            'noopener noreferrer';

          locationButton.hidden =
            false;
        } else {
          locationButton.hidden =
            true;
        }
      }

      const payment =
        normalizePayment(
          order.payment_method
        );

      const paymentCurrent =
        node.querySelector(
          '.payment-current'
        );

      if (paymentCurrent) {
        paymentCurrent.textContent =
          payment
            ? `طريقة الدفع الحالية: ${paymentLabel(payment)}`
            : 'لم يتم تحديد طريقة الدفع';
      }

      const paymentButtons =
        node.querySelectorAll(
          '.payment-btn'
        );

      paymentButtons.forEach(
        (button) => {
          const method =
            normalizePayment(
              button.dataset.payment
            );

          button.classList.toggle(
            'selected',
            method === payment
          );

          button.disabled =
            delivered;

          button.addEventListener(
            'click',
            () =>
              setPayment(
                order,
                method,
                button,
                paymentButtons
              )
          );
        }
      );

      node.classList.toggle(
        'is-done',
        delivered
      );

      const deliverButton =
        node.querySelector(
          '.btn-deliver'
        );

      if (deliverButton) {
        if (delivered) {
          deliverButton.disabled =
            true;

          deliverButton.textContent =
            '✓ تم التسليم';
        } else {
          deliverButton.addEventListener(
            'click',
            () =>
              markDelivered(
                order,
                deliverButton
              )
          );
        }
      }

      list.appendChild(node);
    }

    updateStats();
  }

  async function setPayment(
    order,
    method,
    clickedButton,
    allButtons
  ) {
    if (
      !method ||
      isDelivered(
        order.delivery_status
      )
    ) {
      return;
    }

    if (
      normalizePayment(
        order.payment_method
      ) === method
    ) {
      return;
    }

    allButtons.forEach(
      (button) => {
        button.disabled = true;
      }
    );

    try {
      await apiFetch(
        '/api/payment',
        {
          method: 'POST',
          body: JSON.stringify({
            orderId: order.id,
            payment_method: method
          })
        }
      );

      order.payment_method =
        method;

      allButtons.forEach(
        (button) => {
          button.classList.toggle(
            'selected',
            normalizePayment(
              button.dataset.payment
            ) === method
          );
        }
      );

      const card =
        clickedButton.closest(
          '.order-card'
        );

      const current =
        card?.querySelector(
          '.payment-current'
        );

      if (current) {
        current.textContent =
          `طريقة الدفع الحالية: ${paymentLabel(method)}`;
      }

      toast(
        `تم حفظ طريقة الدفع: ${paymentLabel(method)}`
      );
    } catch (error) {
      if (
        error.message === 'expired'
      ) {
        return;
      }

      toast(
        error.message,
        true
      );
    } finally {
      if (
        !isDelivered(
          order.delivery_status
        )
      ) {
        allButtons.forEach(
          (button) => {
            button.disabled = false;
          }
        );
      }
    }
  }

  async function markDelivered(
    order,
    button
  ) {
    const number =
      order.order_number ??
      order.id ??
      '';

    const name =
      order.customer_name ||
      '';

    const confirmed =
      window.confirm(
        `تأكيد تسليم الطلب #${number}${
          name
            ? ` للعميل ${name}`
            : ''
        }؟`
      );

    if (!confirmed) {
      return;
    }

    button.disabled = true;
    button.textContent =
      'جارٍ التحديث…';

    try {
      await apiFetch(
        '/api/deliver',
        {
          method: 'POST',
          body: JSON.stringify({
            orderId: order.id
          })
        }
      );

      order.delivery_status =
        'delivered';

      toast(
        'تم تسجيل التسليم بنجاح ✅'
      );

      render();
    } catch (error) {
      if (
        error.message === 'expired'
      ) {
        return;
      }

      toast(
        error.message,
        true
      );

      button.disabled = false;
      button.textContent =
        'تم التسليم';
    }
  }

  function logout(
    message = ''
  ) {
    saveSession(null);

    state.orders = [];
    state.sheet = '';

    const list =
      $('orders-list');

    if (list) {
      list.replaceChildren();
    }

    showLogin(message);
  }

  function setupEvents() {
    const loginForm =
      $('login-form');

    if (loginForm) {
      loginForm.addEventListener(
        'submit',
        async (event) => {
          event.preventDefault();

          const username =
            $('username')
              ?.value
              .trim()
              .toLowerCase();

          const password =
            $('password')
              ?.value || '';

          const error =
            $('login-error');

          if (
            !username ||
            !password
          ) {
            if (error) {
              error.textContent =
                'يرجى إدخال اسم المستخدم وكلمة المرور';

              error.hidden = false;
            }

            return;
          }

          const button =
            $('login-btn');

          if (button) {
            button.disabled = true;
            button.textContent =
              'جارٍ تسجيل الدخول…';
          }

          if (error) {
            error.hidden = true;
            error.textContent = '';
          }

          try {
            const response =
              await fetch(
                '/api/login',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type':
                      'application/json'
                  },
                  body:
                    JSON.stringify({
                      username,
                      password
                    })
                }
              );

            const data =
              await response
                .json()
                .catch(() => ({}));

            if (!response.ok) {
              throw new Error(
                data.error ||
                'تعذر تسجيل الدخول'
              );
            }

            const session =
              normalizeSession({
                ...data,
                username:
                  data.username ||
                  username
              });

            if (
              !session.access_token
            ) {
              throw new Error(
                'لم يتم إنشاء جلسة دخول'
              );
            }

            saveSession(session);

            const passwordInput =
              $('password');

            if (passwordInput) {
              passwordInput.value =
                '';
            }

            showOrders();
          } catch (loginError) {
            if (error) {
              error.textContent =
                loginError.message ||
                'تعذر تسجيل الدخول';

              error.hidden = false;
            }
          } finally {
            if (button) {
              button.disabled = false;
              button.textContent =
                'تسجيل الدخول';
            }
          }
        }
      );
    }

    const logoutButton =
      $('logout-btn');

    if (logoutButton) {
      logoutButton.addEventListener(
        'click',
        () => logout()
      );
    }

    const refreshButton =
      $('refresh-btn');

    if (refreshButton) {
      refreshButton.addEventListener(
        'click',
        loadOrders
      );
    }

    document
      .querySelectorAll('.tab')
      .forEach(
        (tab) => {
          tab.addEventListener(
            'click',
            () => {
              document
                .querySelectorAll(
                  '.tab'
                )
                .forEach(
                  (item) => {
                    item.classList.toggle(
                      'active',
                      item === tab
                    );
                  }
                );

              state.filter =
                tab.dataset.filter ||
                'pending';

              render();
            }
          );
        }
      );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (
          !document.hidden &&
          state.session?.access_token &&
          !$('orders-view')?.hidden
        ) {
          loadOrders();
        }
      }
    );
  }

  function loadStoredSession() {
    try {
      const raw =
        localStorage.getItem(
          SESSION_KEY
        );

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      if (
        !parsed?.access_token ||
        !parsed?.refresh_token
      ) {
        return null;
      }

      return normalizeSession(
        parsed
      );
    } catch {
      return null;
    }
  }

  function boot() {
    setupEvents();

    const session =
      loadStoredSession();

    if (
      session?.access_token
    ) {
      saveSession(session);
      showOrders();
    } else {
      showLogin();
    }
  }

  boot();
})();
```
