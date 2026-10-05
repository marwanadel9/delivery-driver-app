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

  function firstValue(order, keys) {
    for (const key of keys) {
      const value = order?.[key];

      if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ''
      ) {
        return value;
      }
    }

    return '';
  }

  function extractNumbers(value) {
    return String(value ?? '')
      .match(/\d+(?:[.,]\d+)?/g) || [];
  }

  function formatChickenLines(
    weights,
    quantities
  ) {
    const weightList =
      extractNumbers(weights);

    const qtyList =
      extractNumbers(quantities);

    const count =
      Math.max(
        weightList.length,
        qtyList.length
      );

    if (!count) {
      return '—';
    }

    const result = [];

    for (
      let i = 0;
      i < count;
      i += 1
    ) {
      const weight =
        weightList[i] || '';

      const qty =
        qtyList[i] || '';

      if (!weight && !qty) {
        continue;
      }

      if (weight && qty) {
        result.push(
          `⚖️ ${weight} جرام — 📦 ${qty}`
        );
      } else if (weight) {
        result.push(
          `⚖️ ${weight} جرام`
        );
      } else {
        result.push(
          `📦 ${qty}`
        );
      }
    }

    return result.length
      ? result.join('\n')
      : '—';
  }

  function extractPlateNames(value) {
    const text =
      String(value ?? '').trim();

    if (!text) {
      return [];
    }

    const patterns = [
      'أرجل دبوس',
      'ارجل دبوس',
      'صدور',
      'أفخاذ',
      'افخاذ',
      'أجنحة',
      'اجنحه',
      'كبدة',
      'كبده',
      'قوانص',
      'قلوب'
    ];

    const escaped =
      patterns
        .sort(
          (a, b) =>
            b.length - a.length
        )
        .map(
          (item) =>
            item.replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&'
            )
        )
        .join('|');

    return (
      text.match(
        new RegExp(
          escaped,
          'g'
        )
      ) || []
    );
  }

  function extractPlateQuantities(value) {
    const text =
      String(value ?? '').trim();

    if (!text) {
      return [];
    }

    return (
      text.match(
        /\d+\s*\+\s*\d+\s*هدية|\d+/g
      ) || []
    );
  }

  function formatPlateLines(
    names,
    quantities
  ) {
    const nameList =
      extractPlateNames(names);

    const qtyList =
      extractPlateQuantities(
        quantities
      );

    const count =
      Math.max(
        nameList.length,
        qtyList.length
      );

    if (!count) {
      return '—';
    }

    const result = [];

    for (
      let i = 0;
      i < count;
      i += 1
    ) {
      const name =
        nameList[i] || '';

      const qty =
        qtyList[i] || '';

      if (!name && !qty) {
        continue;
      }

      if (name && qty) {
        result.push(
          `🍗 ${name} — 📦 ${qty}`
        );
      } else {
        result.push(
          name || qty
        );
      }
    }

    return result.length
      ? result.join('\n')
      : '—';
  }

  function render() {
    const list =
      $('orders-list');

    const template =
      $('order-tpl');

    if (
      !list ||
      !template
    ) {
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

    for (
      const order of shown
    ) {
      const node =
        template.content
          .firstElementChild
          .cloneNode(true);

      const orderNumber =
        firstValue(
          order,
          [
            'order_number',
            'orderNumber',
            'invoice_no',
            'invoice_number',
            'id'
          ]
        ) || '—';

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
        firstValue(
          order,
          [
            'customer_name',
            'customerName',
            'name'
          ]
        )
      );

      setText(
        node,
        'emirate',
        firstValue(
          order,
          [
            'emirate',
            'emirate_name',
            'emirateName'
          ]
        )
      );

      setText(
        node,
        'area',
        firstValue(
          order,
          [
            'area',
            'area_name',
            'areaName'
          ]
        )
      );

      const chickenWeights =
        firstValue(
          order,
          [
            'chicken_weights',
            'chickenWeights',
            'chicken_weight',
            'data_weights'
          ]
        );

      const chickenQtys =
        firstValue(
          order,
          [
            'chicken_qtys',
            'chickenQtys',
            'chicken_quantities',
            'chicken_quantities_text'
          ]
        );

      const plateNames =
        firstValue(
          order,
          [
            'plate_names',
            'plateNames',
            'plates',
            'cut_names'
          ]
        );

      const plateQtys =
        firstValue(
          order,
          [
            'plate_qtys',
            'plateQtys',
            'plate_quantities',
            'cut_quantities'
          ]
        );

      const chickenDisplay =
        formatChickenLines(
          chickenWeights,
          chickenQtys
        );

      const plateDisplay =
        formatPlateLines(
          plateNames,
          plateQtys
        );

      setText(
        node,
        'chicken_weights',
        chickenDisplay
      );

      setText(
        node,
        'chicken_qtys',
        ''
      );

      setText(
        node,
        'plate_names',
        plateDisplay
      );

      setText(
        node,
        'plate_qtys',
        ''
      );

      [
        'chicken_weights',
        'chicken_qtys',
        'plate_names',
        'plate_qtys'
      ].forEach(
        (field) => {
          const element =
            node.querySelector(
              `[data-f="${field}"]`
            );

          if (element) {
            element.style.whiteSpace =
              'pre-line';

            element.style.lineHeight =
              '1.9';
          }
        }
      );

      const legacyDetails =
        firstValue(
          order,
          [
            'order_details',
            'orderDetails',
            'details'
          ]
        );

      setText(
        node,
        'order_details',
        legacyDetails
      );

      setText(
        node,
        'appointment_coordinator',
        firstValue(
          order,
          [
            'appointment_coordinator',
            'appointmentCoordinator',
            'coordinator'
          ]
        )
      );

      setText(
        node,
        'note',
        firstValue(
          order,
          [
            'note',
            'notes',
            'remarks'
          ]
        )
      );

      setText(
        node,
        'total',
        formatTotal(
          firstValue(
            order,
            [
              'total',
              'grand_total',
              'grandTotal',
              'amount'
            ]
          )
        )
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

      const phoneValue =
        firstValue(
          order,
          [
            'phone',
            'customer_phone',
            'customerPhone'
          ]
        );

      const phone =
        node.querySelector(
          '[data-f="phone"]'
        );

      if (phone) {
        if (phoneValue) {
          phone.textContent =
            String(phoneValue);

          phone.removeAttribute(
            'href'
          );
        } else {
          phone.textContent =
            '—';
        }
      }

      const callButton =
        node.querySelector(
          '.call-btn'
        );

      if (callButton) {
        const phoneUrl =
          telHref(phoneValue);

        if (
          isDriverTwo() &&
          phoneUrl
        ) {
          callButton.href =
            phoneUrl;

          callButton.hidden =
            false;
        } else {
          callButton.hidden =
            true;
        }
      }

      const locationValue =
        firstValue(
          order,
          [
            'location_url',
            'locationUrl',
            'location',
            'map_url',
            'mapUrl'
          ]
        );

      const locationButton =
        node.querySelector(
          '[data-f="location_url"]'
        );

      if (locationButton) {
        const locationUrl =
          safeUrl(locationValue);

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
        button.disabled =
          true;
      }
    );

    try {
      await apiFetch(
        '/api/payment',
        {
          method: 'POST',
          body:
            JSON.stringify({
              orderId:
                order.id,
              payment_method:
                method
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
        error.message ===
        'expired'
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
            button.disabled =
              false;
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

    button.disabled =
      true;

    button.textContent =
      'جارٍ التحديث…';

    try {
      await apiFetch(
        '/api/deliver',
        {
          method: 'POST',
          body:
            JSON.stringify({
              orderId:
                order.id
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
        error.message ===
        'expired'
      ) {
        return;
      }

      toast(
        error.message,
        true
      );

      button.disabled =
        false;

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

              error.hidden =
                false;
            }

            return;
          }

          const button =
            $('login-btn');

          if (button) {
            button.disabled =
              true;

            button.textContent =
              'جارٍ تسجيل الدخول…';
          }

          if (error) {
            error.hidden =
              true;

            error.textContent =
              '';
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
                .catch(
                  () => ({})
                );

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

            saveSession(
              session
            );

            const passwordInput =
              $('password');

            if (passwordInput) {
              passwordInput.value =
                '';
            }

            showOrders();
          } catch (
            loginError
          ) {
            if (error) {
              error.textContent =
                loginError.message ||
                'تعذر تسجيل الدخول';

              error.hidden =
                false;
            }
          } finally {
            if (button) {
              button.disabled =
                false;

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
      .querySelectorAll(
        '.tab'
      )
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
          !$(
            'orders-view'
          )?.hidden
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
      saveSession(
        session
      );

      showOrders();
    } else {
      showLogin();
    }
  }

  
  boot();
})();
(() => {
  'use strict';

  const MASTER_KEY = 'master_session';
  const MASTER_USER = 'zezo';

  const master = {
    session: null,
    orders: [],
    search: '',
    date: '',
    payment: 'all',
    status: 'all',
    driver: 'all'
  };

  const masterGet = id =>
    document.getElementById(id);

  const masterEscape = value =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const masterPayment = value => {
    const v =
      String(value ?? '')
        .trim()
        .toLowerCase();

    if (
      v === 'cash' ||
      v === 'كاش' ||
      v === 'نقدي'
    ) {
      return 'cash';
    }

    if (
      v === 'bank_transfer' ||
      v === 'bank' ||
      v === 'transfer' ||
      v === 'تحويل' ||
      v === 'تحويل بنكي'
    ) {
      return 'bank_transfer';
    }

    return '';
  };

  const masterPaymentText = value => {
    const p = masterPayment(value);

    if (p === 'cash') {
      return '💵 كاش';
    }

    if (p === 'bank_transfer') {
      return '🏦 تحويل بنكي';
    }

    return 'غير محدد';
  };

  const masterDelivered = value => {
    const v =
      String(value ?? '')
        .trim()
        .toLowerCase();

    return (
      v === 'delivered' ||
      v === 'done' ||
      v === 'تم' ||
      v.includes('تم التسليم') ||
      v.includes('مسلم')
    );
  };

  const masterMoney = value => {
    const number =
      Number(
        String(value ?? '')
          .replace(/[^\d.-]/g, '')
      );

    if (!Number.isFinite(number)) {
      return '0 درهم';
    }

    return `${number.toLocaleString('ar-EG', {
      maximumFractionDigits: 2
    })} درهم`;
  };

  const masterDate = value => {
    if (!value) {
      return '—';
    }

    const d = new Date(value);

    if (Number.isNaN(d.getTime())) {
      return String(value);
    }

    return d.toLocaleDateString('ar-EG');
  };

  const masterDriver = order => {
    return String(
      order?.sheet_name || ''
    ).toLowerCase() === 'mandoub2'
      ? 'مندوب 2'
      : 'مندوب 1';
  };

  const masterSave = session => {
    master.session = session;

    if (session) {
      localStorage.setItem(
        MASTER_KEY,
        JSON.stringify(session)
      );
    } else {
      localStorage.removeItem(
        MASTER_KEY
      );
    }
  };

  const masterLoad = () => {
    try {
      const raw =
        localStorage.getItem(
          MASTER_KEY
        );

      if (!raw) {
        return null;
      }

      const data =
        JSON.parse(raw);

      if (!data?.access_token) {
        return null;
      }

      if (
        data.expires_at &&
        Number(data.expires_at) <
          Date.now() / 1000
      ) {
        localStorage.removeItem(
          MASTER_KEY
        );

        return null;
      }

      return data;
    } catch {
      return null;
    }
  };

  const masterApi = async (
    url,
    options = {}
  ) => {
    if (
      !master.session?.access_token
    ) {
      throw new Error(
        'انتهت جلسة الماستر'
      );
    }

    const response =
      await fetch(
        url,
        {
          ...options,
          headers: {
            'Content-Type':
              'application/json',
            Authorization:
              `Bearer ${master.session.access_token}`,
            ...(options.headers || {})
          }
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        'حدث خطأ في لوحة الإدارة'
      );
    }

    return data;
  };

  const masterRender = () => {
    const root =
      masterGet(
        'master-dashboard'
      );

    if (!root) {
      return;
    }

    const filtered =
      master.orders.filter(
        order => {
          const q =
            master.search
              .trim()
              .toLowerCase();

          if (q) {
            const text =
              [
                order?.order_number,
                order?.customer_name,
                order?.phone,
                order?.area,
                order?.emirate
              ]
                .map(v =>
                  String(
                    v ?? ''
                  ).toLowerCase()
                )
                .join(' ');

            if (
              !text.includes(q)
            ) {
              return false;
            }
          }

          if (
            master.date
          ) {
            const d =
              new Date(
                order?.created_at
              );

            if (
              Number.isNaN(
                d.getTime()
              )
            ) {
              return false;
            }

            const value =
              `${d.getFullYear()}-${String(
                d.getMonth() + 1
              ).padStart(2, '0')}-${String(
                d.getDate()
              ).padStart(2, '0')}`;

            if (
              value !==
              master.date
            ) {
              return false;
            }
          }

          if (
            master.payment !==
              'all' &&
            masterPayment(
              order?.payment_method
            ) !==
              master.payment
          ) {
            return false;
          }

          if (
            master.status ===
              'delivered' &&
            !masterDelivered(
              order?.delivery_status
            )
          ) {
            return false;
          }

          if (
            master.status ===
              'pending' &&
            masterDelivered(
              order?.delivery_status
            )
          ) {
            return false;
          }

          if (
            master.driver !==
              'all' &&
            masterDriver(order) !==
              master.driver
          ) {
            return false;
          }

          return true;
        }
      );

    const now =
      new Date();

    const monthOrders =
      master.orders.filter(
        order => {
          const d =
            new Date(
              order?.created_at
            );

          return (
            !Number.isNaN(
              d.getTime()
            ) &&
            d.getFullYear() ===
              now.getFullYear() &&
            d.getMonth() ===
              now.getMonth()
          );
        }
      );

    const total =
      monthOrders.reduce(
        (sum, order) =>
          sum +
          (
            Number(
              String(
                order?.total ?? ''
              ).replace(
                /[^\d.-]/g,
                ''
              )
            ) || 0
          ),
        0
      );

    const cash =
      monthOrders
        .filter(
          order =>
            masterPayment(
              order?.payment_method
            ) === 'cash'
        )
        .reduce(
          (sum, order) =>
            sum +
            (
              Number(
                String(
                  order?.total ?? ''
                ).replace(
                  /[^\d.-]/g,
                  ''
                )
              ) || 0
            ),
          0
        );

    const bank =
      monthOrders
        .filter(
          order =>
            masterPayment(
              order?.payment_method
            ) ===
            'bank_transfer'
        )
        .reduce(
          (sum, order) =>
            sum +
            (
              Number(
                String(
                  order?.total ?? ''
                ).replace(
                  /[^\d.-]/g,
                  ''
                )
              ) || 0
            ),
          0
        );

    const delivered =
      monthOrders.filter(
        order =>
          masterDelivered(
            order?.delivery_status
          )
      ).length;

    root.innerHTML = `
      <style>
        .ma-page{
          min-height:100vh;
          background:#f4f6fa;
          padding:20px;
          box-sizing:border-box;
          font-family:Arial,sans-serif;
          color:#172033;
        }

        .ma-top{
          max-width:1400px;
          margin:auto;
          background:#fff;
          border:1px solid #e5e9f0;
          border-radius:20px;
          padding:18px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:15px;
          box-shadow:0 8px 25px rgba(0,0,0,.05);
        }

        .ma-brand{
          display:flex;
          align-items:center;
          gap:12px;
        }

        .ma-logo{
          width:50px;
          height:50px;
          border-radius:15px;
          background:#172033;
          color:#fff;
          display:grid;
          place-items:center;
          font-size:25px;
        }

        .ma-title{
          font-size:22px;
          font-weight:800;
        }

        .ma-sub{
          font-size:12px;
          color:#7b8494;
          margin-top:4px;
        }

        .ma-actions{
          display:flex;
          gap:8px;
        }

        .ma-btn{
          border:0;
          border-radius:11px;
          padding:10px 15px;
          cursor:pointer;
          font-weight:700;
        }

        .ma-refresh{
          background:#eef2f7;
        }

        .ma-logout{
          background:#172033;
          color:#fff;
        }

        .ma-main{
          max-width:1400px;
          margin:18px auto;
        }

        .ma-stats{
          display:grid;
          grid-template-columns:
            repeat(5,minmax(0,1fr));
          gap:12px;
        }

        .ma-stat{
          background:#fff;
          border:1px solid #e5e9f0;
          border-radius:17px;
          padding:16px;
        }

        .ma-stat-icon{
          font-size:22px;
        }

        .ma-stat-label{
          font-size:12px;
          color:#7b8494;
          margin-top:7px;
        }

        .ma-stat-value{
          font-size:19px;
          font-weight:800;
          margin-top:5px;
        }

        .ma-tools{
          margin:16px 0;
          background:#fff;
          border:1px solid #e5e9f0;
          border-radius:17px;
          padding:13px;
          display:grid;
          grid-template-columns:
            2fr 1fr 1fr 1fr 1fr;
          gap:8px;
        }

        .ma-input,
        .ma-select{
          width:100%;
          box-sizing:border-box;
          padding:11px;
          border:1px solid #dfe4ec;
          border-radius:10px;
          background:#fff;
          outline:none;
        }

        .ma-list{
          display:grid;
          gap:10px;
        }

        .ma-card{
          background:#fff;
          border:1px solid #e5e9f0;
          border-radius:17px;
          padding:15px;
          display:grid;
          grid-template-columns:1fr auto;
          gap:15px;
        }

        .ma-card-title{
          font-size:17px;
          font-weight:800;
        }

        .ma-tags{
          display:flex;
          flex-wrap:wrap;
          gap:7px;
          margin-top:9px;
        }

        .ma-tag{
          background:#f0f3f7;
          border-radius:999px;
          padding:6px 9px;
          font-size:12px;
        }

        .ma-side{
          display:flex;
          flex-direction:column;
          align-items:flex-end;
          gap:8px;
        }

        .ma-total{
          font-size:18px;
          font-weight:800;
        }

        .ma-view{
          border:0;
          background:#172033;
          color:#fff;
          border-radius:10px;
          padding:9px 13px;
          cursor:pointer;
          font-weight:700;
        }

        .ma-empty{
          background:#fff;
          border-radius:17px;
          padding:45px;
          text-align:center;
          color:#7b8494;
        }

        .ma-modal{
          position:fixed;
          inset:0;
          background:rgba(10,15,25,.55);
          display:none;
          align-items:center;
          justify-content:center;
          padding:15px;
          z-index:99999;
        }

        .ma-modal.open{
          display:flex;
        }

        .ma-modal-box{
          width:min(760px,100%);
          max-height:90vh;
          overflow:auto;
          background:#fff;
          border-radius:20px;
          padding:20px;
          box-sizing:border-box;
        }

        .ma-modal-head{
          display:flex;
          justify-content:space-between;
          align-items:center;
        }

        .ma-close{
          border:0;
          background:#eef2f7;
          width:38px;
          height:38px;
          border-radius:10px;
          cursor:pointer;
          font-size:20px;
        }

        .ma-details{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:9px;
          margin-top:15px;
        }

        .ma-detail{
          background:#f6f7f9;
          padding:11px;
          border-radius:11px;
        }

        .ma-detail b{
          display:block;
          font-size:11px;
          color:#7b8494;
          margin-bottom:4px;
        }

        .ma-lines{
          white-space:pre-line;
          line-height:1.9;
          background:#f6f7f9;
          padding:14px;
          border-radius:13px;
          margin-top:12px;
        }

        @media(max-width:900px){
          .ma-stats{
            grid-template-columns:
              repeat(2,1fr);
          }

          .ma-tools{
            grid-template-columns:
              1fr 1fr;
          }

          .ma-card{
            grid-template-columns:1fr;
          }

          .ma-side{
            align-items:stretch;
          }
        }

        @media(max-width:560px){
          .ma-page{
            padding:10px;
          }

          .ma-top{
            flex-direction:column;
            align-items:stretch;
          }

          .ma-actions{
            display:grid;
            grid-template-columns:1fr 1fr;
          }

          .ma-tools{
            grid-template-columns:1fr;
          }

          .ma-details{
            grid-template-columns:1fr;
          }
        }
      </style>

      <div class="ma-page">

        <div class="ma-top">

          <div class="ma-brand">

            <div class="ma-logo">
              🐔
            </div>

            <div>
              <div class="ma-title">
                فروج الزين
              </div>

              <div class="ma-sub">
                Master Admin · إدارة الفواتير والطلبات
              </div>
            </div>

          </div>

          <div class="ma-actions">

            <button
              class="ma-btn ma-refresh"
              id="ma-refresh"
            >
              ↻ تحديث
            </button>

            <button
              class="ma-btn ma-logout"
              id="ma-logout"
            >
              خروج
            </button>

          </div>

        </div>

        <div class="ma-main">

          <div class="ma-stats">

            <div class="ma-stat">
              <div class="ma-stat-icon">🧾</div>
              <div class="ma-stat-label">
                فواتير الشهر
              </div>
              <div class="ma-stat-value">
                ${monthOrders.length.toLocaleString('ar-EG')}
              </div>
            </div>

            <div class="ma-stat">
              <div class="ma-stat-icon">💰</div>
              <div class="ma-stat-label">
                إجمالي الشهر
              </div>
              <div class="ma-stat-value">
                ${masterMoney(total)}
              </div>
            </div>

            <div class="ma-stat">
              <div class="ma-stat-icon">💵</div>
              <div class="ma-stat-label">
                الكاش
              </div>
              <div class="ma-stat-value">
                ${masterMoney(cash)}
              </div>
            </div>

            <div class="ma-stat">
              <div class="ma-stat-icon">🏦</div>
              <div class="ma-stat-label">
                التحويل البنكي
              </div>
              <div class="ma-stat-value">
                ${masterMoney(bank)}
              </div>
            </div>

            <div class="ma-stat">
              <div class="ma-stat-icon">🚚</div>
              <div class="ma-stat-label">
                تم التسليم
              </div>
              <div class="ma-stat-value">
                ${delivered.toLocaleString('ar-EG')}
              </div>
            </div>

          </div>

          <div class="ma-tools">

            <input
              class="ma-input"
              id="ma-search"
              placeholder="بحث برقم الفاتورة أو اسم العميل أو الهاتف"
              value="${masterEscape(master.search)}"
            >

            <input
              class="ma-input"
              id="ma-date"
              type="date"
              value="${master.date}"
            >

            <select
              class="ma-select"
              id="ma-payment"
            >
              <option value="all">
                كل طرق الدفع
              </option>

              <option
                value="cash"
                ${master.payment === 'cash' ? 'selected' : ''}
              >
                💵 كاش
              </option>

              <option
                value="bank_transfer"
                ${master.payment === 'bank_transfer' ? 'selected' : ''}
              >
                🏦 تحويل بنكي
              </option>
            </select>

            <select
              class="ma-select"
              id="ma-status"
            >
              <option value="all">
                كل الحالات
              </option>

              <option
                value="pending"
                ${master.status === 'pending' ? 'selected' : ''}
              >
                قيد التوصيل
              </option>

              <option
                value="delivered"
                ${master.status === 'delivered' ? 'selected' : ''}
              >
                تم التسليم
              </option>
            </select>

            <select
              class="ma-select"
              id="ma-driver"
            >
              <option value="all">
                كل المندوبين
              </option>

              <option
                value="مندوب 1"
                ${master.driver === 'مندوب 1' ? 'selected' : ''}
              >
                مندوب 1
              </option>

              <option
                value="مندوب 2"
                ${master.driver === 'مندوب 2' ? 'selected' : ''}
              >
                مندوب 2
              </option>
            </select>

          </div>

          <div class="ma-list">

            ${
              filtered.length
                ? filtered.map(
                    order => `
                      <div class="ma-card">

                        <div>

                          <div class="ma-card-title">
                            فاتورة #${masterEscape(
                              order?.order_number ??
                              order?.id ??
                              '—'
                            )}
                            ·
                            ${masterEscape(
                              order?.customer_name ||
                              'بدون اسم'
                            )}
                          </div>

                          <div class="ma-tags">

                            <span class="ma-tag">
                              👤 ${masterDriver(order)}
                            </span>

                            <span class="ma-tag">
                              📞 ${masterEscape(
                                order?.phone ||
                                'بدون هاتف'
                              )}
                            </span>

                            <span class="ma-tag">
                              ${masterPaymentText(
                                order?.payment_method
                              )}
                            </span>

                            <span class="ma-tag">
                              ${
                                masterDelivered(
                                  order?.delivery_status
                                )
                                  ? '🚚 تم التسليم'
                                  : '🚚 قيد التوصيل'
                              }
                            </span>

                            <span class="ma-tag">
                              📅 ${masterDate(
                                order?.created_at
                              )}
                            </span>

                          </div>

                        </div>

                        <div class="ma-side">

                          <div class="ma-total">
                            ${masterMoney(
                              order?.total
                            )}
                          </div>

                          <button
                            class="ma-view"
                            data-ma-view="${master.orders.indexOf(order)}"
                          >
                            عرض الفاتورة
                          </button>

                        </div>

                      </div>
                    `
                  ).join('')
                : `
                  <div class="ma-empty">
                    لا توجد نتائج مطابقة للبحث
                  </div>
                `
            }

          </div>

        </div>

        <div
          class="ma-modal"
          id="ma-modal"
        >

          <div class="ma-modal-box">

            <div class="ma-modal-head">

              <h2 id="ma-modal-title">
                الفاتورة
              </h2>

              <button
                class="ma-close"
                id="ma-close"
              >
                ×
              </button>

            </div>

            <div id="ma-modal-content"></div>

          </div>

        </div>

      </div>
    `;

    masterGet(
      'ma-search'
    )?.addEventListener(
      'input',
      event => {
        master.search =
          event.target.value;

        masterRender();
      }
    );

    masterGet(
      'ma-date'
    )?.addEventListener(
      'change',
      event => {
        master.date =
          event.target.value;

        masterRender();
      }
    );

    masterGet(
      'ma-payment'
    )?.addEventListener(
      'change',
      event => {
        master.payment =
          event.target.value;

        masterRender();
      }
    );

    masterGet(
      'ma-status'
    )?.addEventListener(
      'change',
      event => {
        master.status =
          event.target.value;

        masterRender();
      }
    );

    masterGet(
      'ma-driver'
    )?.addEventListener(
      'change',
      event => {
        master.driver =
          event.target.value;

        masterRender();
      }
    );

    masterGet(
      'ma-refresh'
    )?.addEventListener(
      'click',
      loadMasterOrders
    );

    masterGet(
      'ma-logout'
    )?.addEventListener(
      'click',
      masterLogout
    );

    masterGet(
      'ma-close'
    )?.addEventListener(
      'click',
      () =>
        masterGet(
          'ma-modal'
        )?.classList.remove(
          'open'
        )
    );

    document
      .querySelectorAll(
        '[data-ma-view]'
      )
      .forEach(
        button => {
          button.addEventListener(
            'click',
            () => {
              const order =
                master.orders[
                  Number(
                    button.dataset.maView
                  )
                ];

              showMasterInvoice(
                order
              );
            }
          );
        }
      );
  };

  const showMasterInvoice =
    order => {
      const modal =
        masterGet(
          'ma-modal'
        );

      const content =
        masterGet(
          'ma-modal-content'
        );

      const title =
        masterGet(
          'ma-modal-title'
        );

      if (
        !modal ||
        !content
      ) {
        return;
      }

      title.textContent =
        `الفاتورة #${
          order?.order_number ??
          order?.id ??
          '—'
        }`;

      const chicken =
        typeof formatChickenLines ===
        'function'
          ? formatChickenLines(
              order?.chicken_weights,
              order?.chicken_qtys
            )
          : '—';

      const plates =
        typeof formatPlateLines ===
        'function'
          ? formatPlateLines(
              order?.plate_names,
              order?.plate_qtys
            )
          : '—';

      content.innerHTML = `

        <div class="ma-details">

          <div class="ma-detail">
            <b>اسم العميل</b>
            ${masterEscape(
              order?.customer_name ||
              '—'
            )}
          </div>

          <div class="ma-detail">
            <b>الهاتف</b>
            ${masterEscape(
              order?.phone ||
              '—'
            )}
          </div>

          <div class="ma-detail">
            <b>الإمارة</b>
            ${masterEscape(
              order?.emirate ||
              '—'
            )}
          </div>

          <div class="ma-detail">
            <b>المنطقة</b>
            ${masterEscape(
              order?.area ||
              '—'
            )}
          </div>

          <div class="ma-detail">
            <b>المندوب</b>
            ${masterDriver(order)}
          </div>

          <div class="ma-detail">
            <b>التاريخ</b>
            ${masterDate(
              order?.created_at
            )}
          </div>

          <div class="ma-detail">
            <b>طريقة الدفع</b>
            ${masterPaymentText(
              order?.payment_method
            )}
          </div>

          <div class="ma-detail">
            <b>حالة التسليم</b>
            ${
              masterDelivered(
                order?.delivery_status
              )
                ? 'تم التسليم'
                : 'قيد التوصيل'
            }
          </div>

          <div class="ma-detail">
            <b>الإجمالي</b>
            ${masterMoney(
              order?.total
            )}
          </div>

          <div class="ma-detail">
            <b>منسق الموعد</b>
            ${masterEscape(
              order?.appointment_coordinator ||
              '—'
            )}
          </div>

        </div>

        <div class="ma-lines">

          <b>🍗 الدجاج الكامل</b>

          ${masterEscape(
            chicken
          )}

          <br>

          <b>🍽️ المقطعات</b>

          ${masterEscape(
            plates
          )}

          <br>

          <b>📝 الملاحظات</b>

          ${masterEscape(
            order?.note ||
            '—'
          )}

        </div>
      `;

      modal.classList.add(
        'open'
      );
    };

  const loadMasterOrders =
    async () => {
      try {
        const data =
          await masterApi(
            '/api/master/orders'
          );

        master.orders =
          Array.isArray(data)
            ? data
            : Array.isArray(
                data?.orders
              )
              ? data.orders
              : [];

        masterRender();
      } catch (error) {
        masterLogout(
          error.message
        );
      }
    };

  const showMaster =
    () => {
      const login =
        masterGet(
          'login-view'
        );

      const orders =
        masterGet(
          'orders-view'
        );

      if (login) {
        login.hidden = true;
      }

      if (orders) {
        orders.hidden = true;
      }

      let root =
        masterGet(
          'master-dashboard'
        );

      if (!root) {
        root =
          document.createElement(
            'div'
          );

        root.id =
          'master-dashboard';

        document.body.appendChild(
          root
        );
      }

      root.hidden = false;

      masterRender();

      loadMasterOrders();
    };

  const masterLogout =
    message => {
      masterSave(null);

      const root =
        masterGet(
          'master-dashboard'
        );

      if (root) {
        root.remove();
      }

      if (
        typeof showLogin ===
        'function'
      ) {
        showLogin(
          message || ''
        );
      }
    };

  const originalLoginForm =
    masterGet(
      'login-form'
    );

  if (
    originalLoginForm
  ) {
    originalLoginForm.addEventListener(
      'submit',
      async event => {
        const username =
          masterGet(
            'username'
          )
            ?.value
            .trim()
            .toLowerCase();

        if (
          username !==
          MASTER_USER
        ) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const password =
          masterGet(
            'password'
          )?.value || '';

        const error =
          masterGet(
            'login-error'
          );

        const button =
          masterGet(
            'login-btn'
          );

        if (!password) {
          if (error) {
            error.textContent =
              'يرجى إدخال كلمة المرور';

            error.hidden =
              false;
          }

          return;
        }

        if (button) {
          button.disabled =
            true;

          button.textContent =
            'جارٍ الدخول للماستر…';
        }

        try {
          const response =
            await fetch(
              '/api/master-login',
              {
                method: 'POST',
                headers: {
                  'Content-Type':
                    'application/json'
                },
                body:
                  JSON.stringify({
                    username:
                      MASTER_USER,
                    password
                  })
              }
            );

          const data =
            await response
              .json()
              .catch(
                () => ({})
              );

          if (!response.ok) {
            throw new Error(
              data.error ||
              'بيانات الماستر غير صحيحة'
            );
          }

          if (
            !data.access_token
          ) {
            throw new Error(
              'لم يتم إنشاء جلسة الماستر'
            );
          }

          masterSave({
            ...data,
            username:
              MASTER_USER,
            role:
              'master_admin',
            expires_at:
              Number(
                data.expires_at
              ) ||
              (
                Date.now() /
                  1000 +
                Number(
                  data.expires_in ||
                  3600
                ) -
                30
              )
          });

          if (
            masterGet(
              'password'
            )
          ) {
            masterGet(
              'password'
            ).value = '';
          }

          showMaster();

        } catch (error) {
          if (error) {
            if (masterGet('login-error')) {
              masterGet(
                'login-error'
              ).textContent =
                error.message;

              masterGet(
                'login-error'
              ).hidden =
                false;
            }
          }
        } finally {
          if (button) {
            button.disabled =
              false;

            button.textContent =
              'تسجيل الدخول';
          }
        }
      },
      true
    );
  }

  const savedMaster =
    masterLoad();

  if (
    savedMaster?.access_token
  ) {
    master.session =
      savedMaster;

    setTimeout(
      showMaster,
      0
    );
  function masterEditStyles() {
    if ($('master-edit-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'master-edit-style';

    style.textContent = `
      .master-edit-actions{
        display:flex;
        gap:8px;
        justify-content:center;
        flex-wrap:wrap;
        margin-top:8px;
      }

      .master-edit-btn,
      .master-delete-btn{
        border:0;
        border-radius:10px;
        padding:8px 12px;
        font-family:inherit;
        font-weight:800;
        cursor:pointer;
      }

      .master-edit-btn{
        background:#eef5ff;
        color:#1769aa;
      }

      .master-delete-btn{
        background:#fff0f0;
        color:#c62828;
      }

      .master-edit-overlay{
        position:fixed;
        inset:0;
        z-index:99999;
        background:rgba(0,0,0,.55);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:20px;
        overflow:auto;
      }

      .master-edit-card{
        width:min(900px,100%);
        max-height:92vh;
        overflow:auto;
        background:#fff;
        border-radius:20px;
        box-shadow:0 20px 60px rgba(0,0,0,.25);
        direction:rtl;
      }

      .master-edit-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:15px;
        padding:18px 20px;
        border-bottom:1px solid #e9eef0;
        position:sticky;
        top:0;
        background:#fff;
        z-index:2;
      }

      .master-edit-head h2{
        margin:0 0 4px;
        font-size:20px;
      }

      .master-edit-head small{
        color:#77848a;
      }

      .master-edit-close{
        width:40px;
        height:40px;
        border:0;
        border-radius:50%;
        background:#f1f4f5;
        font-size:25px;
        cursor:pointer;
      }

      .master-edit-body{
        padding:20px;
      }

      .master-edit-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:14px;
      }

      .master-edit-field{
        display:flex;
        flex-direction:column;
        gap:6px;
      }

      .master-edit-field.full{
        grid-column:1/-1;
      }

      .master-edit-field label{
        font-size:12px;
        font-weight:800;
        color:#526168;
      }

      .master-edit-field input,
      .master-edit-field select,
      .master-edit-field textarea{
        width:100%;
        box-sizing:border-box;
        border:1px solid #dce4e7;
        border-radius:11px;
        padding:11px 12px;
        font-family:inherit;
        font-size:14px;
        background:#fff;
        outline:none;
      }

      .master-edit-field textarea{
        min-height:90px;
        resize:vertical;
      }

      .master-edit-field input:focus,
      .master-edit-field select:focus,
      .master-edit-field textarea:focus{
        border-color:#7aa9c7;
        box-shadow:0 0 0 3px rgba(54,125,164,.10);
      }

      .master-edit-footer{
        display:flex;
        gap:10px;
        justify-content:flex-start;
        padding:16px 20px;
        border-top:1px solid #e9eef0;
        position:sticky;
        bottom:0;
        background:#fff;
      }

      .master-edit-save,
      .master-edit-cancel{
        border:0;
        border-radius:11px;
        padding:11px 18px;
        font-family:inherit;
        font-weight:800;
        cursor:pointer;
      }

      .master-edit-save{
        background:#1769aa;
        color:#fff;
      }

      .master-edit-cancel{
        background:#eef2f3;
        color:#39484e;
      }

      @media(max-width:650px){
        .master-edit-overlay{
          padding:8px;
        }

        .master-edit-card{
          max-height:96vh;
          border-radius:16px;
        }

        .master-edit-grid{
          grid-template-columns:1fr;
        }

        .master-edit-field.full{
          grid-column:auto;
        }

        .master-edit-footer{
          flex-direction:column;
        }

        .master-edit-save,
        .master-edit-cancel{
          width:100%;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function masterAddActionButtons() {
    const body = $('master-orders-body');

    if (!body) {
      return;
    }

    body.querySelectorAll('tr').forEach((row) => {
      if (row.querySelector('.master-edit-actions')) {
        return;
      }

      const cells = row.querySelectorAll('td');

      if (!cells.length) {
        return;
      }

      const viewCell = cells[cells.length - 1];

      const numberText =
        row.querySelector('td strong')?.textContent || '';

      const number = numberText.replace(/^#/, '').trim();

      const order = state.masterOrders.find((item) => {
        const itemNumber = String(
          item.order_number ?? item.id ?? ''
        ).trim();

        return itemNumber === number;
      });

      if (!order) {
        return;
      }

      const actions = document.createElement('div');
      actions.className = 'master-edit-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'master-edit-btn';
      editButton.textContent = '✏️ تعديل';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'master-delete-btn';
      deleteButton.textContent = '🗑️ حذف';

      actions.appendChild(editButton);
      actions.appendChild(deleteButton);
      viewCell.appendChild(actions);

      editButton.addEventListener(
        'click',
        () => openMasterEditOrder(order)
      );

      deleteButton.addEventListener(
        'click',
        () => deleteMasterOrder(order)
      );
    });
  }

  function masterValue(order, key) {
    return String(order?.[key] ?? '');
  }

  function openMasterEditOrder(order) {
    masterEditStyles();

    $('master-edit-overlay')?.remove();

    const number =
      order.order_number ??
      order.id ??
      '';

    const overlay = document.createElement('div');
    overlay.id = 'master-edit-overlay';
    overlay.className = 'master-edit-overlay';

    overlay.innerHTML = `
      <div class="master-edit-card">
        <div class="master-edit-head">
          <div>
            <h2>✏️ تعديل الفاتورة</h2>
            <small>الفاتورة رقم ${masterEscape(number)}</small>
          </div>
          <button type="button" class="master-edit-close">×</button>
        </div>

        <form id="master-edit-form">
          <div class="master-edit-body">
            <div class="master-edit-grid">

              <div class="master-edit-field">
                <label>اسم العميل</label>
                <input id="me-customer-name" value="${masterEscape(masterValue(order, 'customer_name'))}">
              </div>

              <div class="master-edit-field">
                <label>رقم الهاتف</label>
                <input id="me-phone" value="${masterEscape(masterValue(order, 'phone'))}">
              </div>

              <div class="master-edit-field">
                <label>الإمارة</label>
                <input id="me-emirate" value="${masterEscape(masterValue(order, 'emirate'))}">
              </div>

              <div class="master-edit-field">
                <label>المنطقة</label>
                <input id="me-area" value="${masterEscape(masterValue(order, 'area'))}">
              </div>

              <div class="master-edit-field">
                <label>أوزان الدجاج الكامل</label>
                <input id="me-chicken-weights" value="${masterEscape(masterValue(order, 'chicken_weights'))}">
              </div>

              <div class="master-edit-field">
                <label>كميات الدجاج الكامل</label>
                <input id="me-chicken-qtys" value="${masterEscape(masterValue(order, 'chicken_qtys'))}">
              </div>

              <div class="master-edit-field">
                <label>أصناف المقطعات</label>
                <input id="me-plate-names" value="${masterEscape(masterValue(order, 'plate_names'))}">
              </div>

              <div class="master-edit-field">
                <label>كميات المقطعات</label>
                <input id="me-plate-qtys" value="${masterEscape(masterValue(order, 'plate_qtys'))}">
              </div>

              <div class="master-edit-field">
                <label>الإجمالي</label>
                <input id="me-total" value="${masterEscape(masterValue(order, 'total'))}">
              </div>

              <div class="master-edit-field">
                <label>منسق الموعد</label>
                <input id="me-coordinator" value="${masterEscape(masterValue(order, 'appointment_coordinator'))}">
              </div>

              <div class="master-edit-field full">
                <label>رابط الموقع</label>
                <input id="me-location" value="${masterEscape(masterValue(order, 'location_url'))}">
              </div>

              <div class="master-edit-field full">
                <label>الملاحظات</label>
                <textarea id="me-note">${masterEscape(masterValue(order, 'note'))}</textarea>
              </div>

              <div class="master-edit-field">
                <label>طريقة الدفع</label>
                <select id="me-payment">
                  <option value="" ${!normalizePayment(order.payment_method) ? 'selected' : ''}>لم يتم التحديد</option>
                  <option value="cash" ${normalizePayment(order.payment_method) === 'cash' ? 'selected' : ''}>💵 دفع كاش</option>
                  <option value="bank_transfer" ${normalizePayment(order.payment_method) === 'bank_transfer' ? 'selected' : ''}>🏦 تحويل بنكي</option>
                </select>
              </div>

              <div class="master-edit-field">
                <label>حالة التوصيل</label>
                <select id="me-status">
                  <option value="pending" ${!isDelivered(order.delivery_status) ? 'selected' : ''}>قيد التوصيل</option>
                  <option value="delivered" ${isDelivered(order.delivery_status) ? 'selected' : ''}>تم التسليم</option>
                </select>
              </div>

            </div>
          </div>

          <div class="master-edit-footer">
            <button type="button" class="master-edit-cancel">إلغاء</button>
            <button type="submit" class="master-edit-save">💾 حفظ التعديل</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    overlay.querySelector('.master-edit-close')?.addEventListener(
      'click',
      close
    );

    overlay.querySelector('.master-edit-cancel')?.addEventListener(
      'click',
      close
    );

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close();
      }
    });

    overlay.querySelector('#master-edit-form')?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        const saveButton =
          overlay.querySelector('.master-edit-save');

        saveButton.disabled = true;
        saveButton.textContent = 'جارٍ الحفظ…';

        const updatedOrder = {
          customer_name:
            $('me-customer-name')?.value.trim() || '',

          phone:
            $('me-phone')?.value.trim() || '',

          emirate:
            $('me-emirate')?.value.trim() || '',

          area:
            $('me-area')?.value.trim() || '',

          chicken_weights:
            $('me-chicken-weights')?.value.trim() || '',

          chicken_qtys:
            $('me-chicken-qtys')?.value.trim() || '',

          plate_names:
            $('me-plate-names')?.value.trim() || '',

          plate_qtys:
            $('me-plate-qtys')?.value.trim() || '',

          total:
            $('me-total')?.value.trim() || '',

          appointment_coordinator:
            $('me-coordinator')?.value.trim() || '',

          location_url:
            $('me-location')?.value.trim() || '',

          note:
            $('me-note')?.value.trim() || '',

          payment_method:
            $('me-payment')?.value || '',

          delivery_status:
            $('me-status')?.value || 'pending'
        };

        try {
          const result = await masterFetch(
            '/api/master/order/update',
            {
              method: 'POST',
              body: JSON.stringify({
                order_id: Number(order.id),
                order: updatedOrder
              })
            }
          );

          const updated =
            result?.order ||
            result?.data ||
            null;

          if (!updated) {
            throw new Error('تم الحفظ ولكن لم يتم إرجاع بيانات الفاتورة');
          }

          const index =
            state.masterOrders.findIndex(
              (item) =>
                Number(item.id) ===
                Number(order.id)
            );

          if (index !== -1) {
            state.masterOrders[index] = updated;
          }

          close();
          renderMasterOrders();

          setTimeout(
            masterAddActionButtons,
            0
          );

          toast('تم تعديل الفاتورة بنجاح ✅');

        } catch (error) {
          saveButton.disabled = false;
          saveButton.textContent = '💾 حفظ التعديل';

          if (error.message !== 'expired') {
            toast(
              error.message || 'تعذر تعديل الفاتورة',
              true
            );
          }
        }
      }
    );
  }

  async function deleteMasterOrder(order) {
    const number =
      order.order_number ??
      order.id ??
      '';

    const name =
      order.customer_name ||
      '';

    const confirmed = window.confirm(
      `هل أنت متأكد من حذف الفاتورة رقم ${number}؟\n\nالعميل: ${name}\n\nلا يمكن التراجع عن الحذف.`
    );

    if (!confirmed) {
      return;
    }

    try {
      const result = await masterFetch(
        '/api/master/order/delete',
        {
          method: 'POST',
          body: JSON.stringify({
            order_id: Number(order.id)
          })
        }
      );

      if (!result?.success) {
        throw new Error(
          result?.error ||
          'تعذر حذف الفاتورة'
        );
      }

      state.masterOrders =
        state.masterOrders.filter(
          (item) =>
            Number(item.id) !==
            Number(order.id)
        );

      renderMasterOrders();

      setTimeout(
        masterAddActionButtons,
        0
      );

      toast('تم حذف الفاتورة بنجاح 🗑️');

    } catch (error) {
      if (error.message !== 'expired') {
        toast(
          error.message ||
          'تعذر حذف الفاتورة',
          true
        );
      }
    }
  }

  function masterWatchTable() {
    masterEditStyles();

    const body = $('master-orders-body');

    if (!body) {
      setTimeout(
        masterWatchTable,
        500
      );
      return;
    }

    masterAddActionButtons();

    const observer = new MutationObserver(() => {
      masterAddActionButtons();
    });

    observer.observe(body, {
      childList: true,
      subtree: true
    });
  }

  setTimeout(
    masterWatchTable,
    500
  );
  }
})();
