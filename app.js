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

  const apiFetch = async (
    path,
    options = {},
    retry = true
  ) => {
    const session = state.session;

    if (!session?.access_token) {
      throw new Error('expired');
    }

    const headers = {
      ...(options.body
        ? {
            'Content-Type':
              'application/json'
          }
        : {}),
      ...(options.headers || {}),
      Authorization:
        `Bearer ${session.access_token}`
    };

    const response =
      await fetch(
        path,
        {
          ...options,
          headers
        }
      );

    if (
      response.status === 401 &&
      retry &&
      session.refresh_token
    ) {
      try {
        const refreshResponse =
          await fetch(
            '/api/refresh',
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/json'
              },
              body:
                JSON.stringify({
                  refresh_token:
                    session.refresh_token
                })
            }
          );

        const refreshData =
          await refreshResponse
            .json()
            .catch(
              () => ({})
            );

        if (
          refreshResponse.ok &&
          refreshData?.access_token
        ) {
          const refreshed =
            normalizeSession({
              ...session,
              ...refreshData
            });

          saveSession(refreshed);

          return apiFetch(
            path,
            options,
            false
          );
        }
      } catch {
      }

      saveSession(null);
      throw new Error('expired');
    }

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        'حدث خطأ أثناء الاتصال بالسيرفر'
      );
    }

    return data;
  };

  function showLogin(message = '') {
    const loginView =
      $('login-view');

    const ordersView =
      $('orders-view');

    const masterView =
      $('master-view');

    if (loginView) {
      loginView.hidden = false;
    }

    if (ordersView) {
      ordersView.hidden = true;
    }

    if (masterView) {
      masterView.hidden = true;
    }

    const error =
      $('login-error');

    if (error) {
      error.textContent =
        message || '';

      error.hidden =
        !message;
    }
  }

  function showOrders() {
    const loginView =
      $('login-view');

    const ordersView =
      $('orders-view');

    const masterView =
      $('master-view');

    if (loginView) {
      loginView.hidden = true;
    }

    if (masterView) {
      masterView.hidden = true;
    }

    if (ordersView) {
      ordersView.hidden = false;
    }

    const name =
      $('driver-name');

    if (name) {
      name.textContent =
        state.session?.mandoub_name ||
        state.session?.username ||
        'المندوب';
    }

    const sheet =
      $('driver-sheet');

    if (sheet) {
      sheet.textContent =
        state.session?.sheet_name ||
        '';
    }

    loadOrders();
  }

  async function loadOrders() {
    const list =
      $('orders-list');

    if (list) {
      list.innerHTML =
        '<p class="loading">جارٍ تحميل الطلبات…</p>';
    }

    try {
      const data =
        await apiFetch(
          `/api/orders?sheet=${encodeURIComponent(
            state.session?.sheet_name || ''
          )}`
        );

      state.orders =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.orders)
            ? data.orders
            : [];

      state.sheet =
        state.session?.sheet_name ||
        '';

      render();

    } catch (error) {
      if (
        error.message === 'expired'
      ) {
        logout(
          'انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى'
        );

        return;
      }

      if (list) {
        list.innerHTML =
          `<p class="empty error-message">${error.message}</p>`;
      }
    }
  }

  async function setPayment(
    order,
    method,
    button,
    buttons
  ) {
    if (
      isDelivered(
        order.delivery_status
      )
    ) {
      return;
    }

    buttons.forEach(
      (item) => {
        item.disabled = true;
      }
    );

    try {
      const data =
        await apiFetch(
          '/api/payment',
          {
            method: 'POST',
            body:
              JSON.stringify({
                orderId: order.id,
                payment_method:
                  method
              })
          }
        );

      order.payment_method =
        data?.order?.payment_method ||
        method;

      buttons.forEach(
        (item) => {
          item.classList.toggle(
            'selected',
            normalizePayment(
              item.dataset.payment
            ) === method
          );
        }
      );

      const current =
        button
          ?.closest('.payment-section')
          ?.querySelector(
            '.payment-current'
          );

      if (current) {
        current.textContent =
          `طريقة الدفع الحالية: ${paymentLabel(method)}`;
      }

      toast(
        'تم حفظ طريقة الدفع ✅'
      );

    } catch (error) {
      if (
        error.message === 'expired'
      ) {
        logout(
          'انتهت جلسة الدخول'
        );

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
        buttons.forEach(
          (item) => {
            item.disabled = false;
          }
        );
      }
    }
  }

  async function markDelivered(
    order,
    button
  ) {
    if (
      isDelivered(
        order.delivery_status
      )
    ) {
      return;
    }

    const oldText =
      button.textContent;

    button.disabled = true;
    button.textContent =
      'جارٍ التسليم…';

    try {
      const data =
        await apiFetch(
          '/api/deliver',
          {
            method: 'POST',
            body:
              JSON.stringify({
                orderId: order.id
              })
          }
        );

      order.delivery_status =
        data?.order?.delivery_status ||
        'delivered';

      button.textContent =
        '✓ تم التسليم';

      const card =
        button.closest('.order-card');

      if (card) {
        card.classList.add(
          'is-done'
        );
      }

      const status =
        card?.querySelector(
          '[data-f="delivery_status"]'
        );

      if (status) {
        status.textContent =
          'تم التسليم';

        status.classList.add(
          'ok'
        );
      }

      const paymentButtons =
        card?.querySelectorAll(
          '.payment-btn'
        );

      paymentButtons?.forEach(
        (item) => {
          item.disabled = true;
        }
      );

      updateStats();

      toast(
        'تم تسجيل التسليم بنجاح ✅'
      );

    } catch (error) {
      if (
        error.message === 'expired'
      ) {
        logout(
          'انتهت جلسة الدخول'
        );

        return;
      }

      button.disabled =
        false;

      button.textContent =
        oldText;

      toast(
        error.message,
        true
      );
    }
  }

  function logout(message = '') {
    saveSession(null);

    state.orders = [];
    state.sheet = '';

    if (
      typeof saveMasterSession ===
      'function'
    ) {
      saveMasterSession(null);
    }

    window.location.reload();

    if (message) {
      setTimeout(
        () => showLogin(message),
        100
      );
    }
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

    const matches =
      text.match(
        /\d+\s*\+\s*\d+\s*(?:هدية|هديه)|\d+/g
      ) || [];

    return matches.map(
      (item) =>
        item
          .replace(/\s+/g, ' ')
          .trim()
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
          `🍽️ ${name} — ${qty}`
        );
      } else if (name) {
        result.push(
          `🍽️ ${name}`
        );
      } else {
        result.push(
          qty
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

      const chickenQtyElement =
        node.querySelector(
          '[data-f="chicken_qtys"]'
        );

      if (chickenQtyElement) {
        const chickenQtyRow =
          chickenQtyElement.closest(
            '.info-item, .order-section, .detail-row, .field-row'
          );

        if (chickenQtyRow) {
          chickenQtyRow.style.display = 'none';
        } else {
          chickenQtyElement.style.display = 'none';
        }
      }

      const plateQtyElement =
        node.querySelector(
          '[data-f="plate_qtys"]'
        );

      if (plateQtyElement) {
        const plateQtyRow =
          plateQtyElement.closest(
            '.info-item, .order-section, .detail-row, .field-row'
          );

        if (plateQtyRow) {
          plateQtyRow.style.display = 'none';
        } else {
          plateQtyElement.style.display = 'none';
        }
      }

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

  const MASTER_SESSION_KEY =
    'master_session';

  const MASTER_USERNAME =
    'zezo';

  const masterState = {
    session: null
  };

  state.masterOrders = [];
  state.masterSession = null;
  state.role = '';

  function saveMasterSession(session) {
    state.masterSession =
      session;

    if (session) {
      localStorage.setItem(
        MASTER_SESSION_KEY,
        JSON.stringify(session)
      );
    } else {
      localStorage.removeItem(
        MASTER_SESSION_KEY
      );
    }
  }

  function normalizeMasterSession(data) {
    const expiresIn =
      Number(
        data?.expires_in
      );

    let expiresAt =
      Number(
        data?.expires_at
      );

    if (
      !Number.isFinite(
        expiresAt
      )
    ) {
      expiresAt =
        Date.now() / 1000 +
        (
          Number.isFinite(
            expiresIn
          )
            ? expiresIn
            : 3600
        ) -
        30;
    }

    return {
      access_token:
        data?.access_token ||
        '',
      refresh_token:
        data?.refresh_token ||
        '',
      username:
        data?.username ||
        MASTER_USERNAME,
      expires_at:
        expiresAt
    };
  }

  function loadStoredMasterSession() {
    try {
      const raw =
        localStorage.getItem(
          MASTER_SESSION_KEY
        );

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      if (
        !parsed?.access_token
      ) {
        return null;
      }

      return normalizeMasterSession(
        parsed
      );

    } catch {
      return null;
    }
  }

  async function masterFetch(
    path,
    options = {},
    retry = true
  ) {
    const session =
      state.masterSession;

    if (
      !session?.access_token
    ) {
      throw new Error(
        'expired'
      );
    }

    const headers = {
      ...(options.body
        ? {
            'Content-Type':
              'application/json'
          }
        : {}),
      ...(options.headers || {}),
      Authorization:
        `Bearer ${session.access_token}`
    };

    const response =
      await fetch(
        path,
        {
          ...options,
          headers
        }
      );

    if (
      response.status === 401 &&
      retry &&
      session.refresh_token
    ) {
      try {
        const refreshResponse =
          await fetch(
            '/api/refresh',
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/json'
              },
              body:
                JSON.stringify({
                  refresh_token:
                    session.refresh_token
                })
            }
          );

        const refreshData =
          await refreshResponse
            .json()
            .catch(
              () => ({})
            );

        if (
          refreshResponse.ok &&
          refreshData?.access_token
        ) {
          const refreshed =
            normalizeMasterSession({
              ...session,
              ...refreshData
            });

          saveMasterSession(
            refreshed
          );

          return masterFetch(
            path,
            options,
            false
          );
        }
      } catch {
      }

      saveMasterSession(null);

      throw new Error(
        'expired'
      );
    }

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        'حدث خطأ أثناء الاتصال بالسيرفر'
      );
    }

    return data;
  }

  function masterEscape(value) {
    return String(
      value ?? ''
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );
  }

  function masterMoney(value) {
    const number =
      Number(
        String(
          value ?? ''
        )
          .replace(
            /[^\d.-]/g,
            ''
          )
      );

    return Number.isFinite(
      number
    )
      ? number
      : 0;
  }

  function masterDate(value) {
    if (!value) {
      return '—';
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(value);
    }

    return date.toLocaleString(
      'ar-EG',
      {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }
    );
  }

  function masterDateInput(value) {
    if (!value) {
      return '';
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '';
    }

    const year =
      date.getFullYear();

    const month =
      String(
        date.getMonth() + 1
      ).padStart(
        2,
        '0'
      );

    const day =
      String(
        date.getDate()
      ).padStart(
        2,
        '0'
      );

    return `${year}-${month}-${day}`;
  }

  function masterDriver(order) {
    const sheet =
      String(
        order?.sheet_name ||
        ''
      )
        .trim()
        .toLowerCase();

    if (
      sheet === 'mandoub2' ||
      sheet === 'مندوب 2'
    ) {
      return 'مندوب 2';
    }

    if (
      sheet === 'mandoub' ||
      sheet === 'مندوب 1'
    ) {
      return 'مندوب 1';
    }

    return (
      order?.mandoub_name ||
      order?.driver_name ||
      order?.sheet_name ||
      '—'
    );
  }

  function masterPaymentText(value) {
    const payment =
      normalizePayment(
        value
      );

    if (
      payment === 'cash'
    ) {
      return '💵 دفع كاش';
    }

    if (
      payment === 'bank_transfer'
    ) {
      return '🏦 تحويل بنكي';
    }

    return 'غير محدد';
  }

  function masterStatusText(value) {
    return isDelivered(
      value
    )
      ? '✓ تم التسليم'
      : '⏳ قيد التوصيل';
  }

  function showMasterDashboard() {
    const loginView =
      $('login-view');

    const ordersView =
      $('orders-view');

    const masterView =
      $('master-view');

    if (loginView) {
      loginView.hidden =
        true;
    }

    if (ordersView) {
      ordersView.hidden =
        true;
    }

    if (masterView) {
      masterView.hidden =
        false;
    }

    const username =
      $('master-user');

    if (username) {
      username.textContent =
        state.masterSession?.username ||
        MASTER_USERNAME;
    }

    setupMasterEvents();

    loadMasterOrders();
  }

  function setupMasterEvents() {
    const close =
      $('master-modal-close');

    if (close) {
      close.addEventListener(
        'click',
        closeMasterModal
      );
    }

    const modal =
      $('master-modal');

    if (modal) {
      modal.addEventListener(
        'click',
        (event) => {
          if (
            event.target ===
            modal
          ) {
            closeMasterModal();
          }
        }
      );
    }

    const logout =
      $('master-logout-btn');

    if (logout) {
      logout.addEventListener(
        'click',
        () =>
          masterLogout()
      );
    }

    [
      'master-search-number',
      'master-search-name',
      'master-search-phone',
      'master-search-date',
      'master-filter-driver',
      'master-filter-status'
    ].forEach(
      (id) => {
        $(id)?.addEventListener(
          'input',
          renderMasterOrders
        );

        $(id)?.addEventListener(
          'change',
          renderMasterOrders
        );
      }
    );

    loadMasterOrders();
  }

  async function loadMasterOrders() {
    const body =
      $('master-orders-body');

    if (body) {
      body.innerHTML =
        '<tr><td colspan="10" class="master-empty">جارٍ تحميل الفواتير…</td></tr>';
    }

    try {
      const data =
        await masterFetch(
          '/api/master/orders'
        );

      state.masterOrders =
        Array.isArray(data)
          ? data
          : Array.isArray(
              data?.orders
            )
            ? data.orders
            : [];

      renderMasterOrders();

    } catch (error) {
      if (
        error.message !==
          'expired' &&
        body
      ) {
        body.innerHTML =
          `<tr><td colspan="10" class="master-empty">${masterEscape(error.message)}</td></tr>`;
      }
    }
  }

  function getMasterFilteredOrders() {
    const number =
      String(
        $('master-search-number')?.value ||
        ''
      )
        .trim()
        .toLowerCase();

    const name =
      String(
        $('master-search-name')?.value ||
        ''
      )
        .trim()
        .toLowerCase();

    const phone =
      String(
        $('master-search-phone')?.value ||
        ''
      )
        .trim()
        .toLowerCase();

    const date =
      String(
        $('master-search-date')?.value ||
        ''
      )
        .trim();

    const driver =
      String(
        $('master-filter-driver')?.value ||
        ''
      )
        .trim();

    const status =
      String(
        $('master-filter-status')?.value ||
        ''
      )
        .trim();

    return state.masterOrders.filter(
      (order) => {
        const orderNumber =
          String(
            order.order_number ??
            order.id ??
            ''
          )
            .toLowerCase();

        const customerName =
          String(
            order.customer_name ??
            ''
          )
            .toLowerCase();

        const customerPhone =
          String(
            order.phone ??
            ''
          )
            .toLowerCase();

        if (
          number &&
          !orderNumber.includes(
            number
          )
        ) {
          return false;
        }

        if (
          name &&
          !customerName.includes(
            name
          )
        ) {
          return false;
        }

        if (
          phone &&
          !customerPhone.includes(
            phone
          )
        ) {
          return false;
        }

        if (
          date &&
          masterDateInput(
            order.created_at
          ) !== date
        ) {
          return false;
        }

        if (
          driver &&
          String(
            order.sheet_name ||
            ''
          ) !== driver
        ) {
          return false;
        }

        if (status) {
          const delivered =
            isDelivered(
              order.delivery_status
            );

          if (
            status ===
              'delivered' &&
            !delivered
          ) {
            return false;
          }

          if (
            status ===
              'pending' &&
            delivered
          ) {
            return false;
          }
        }

        return true;
      }
    );
  }

  function renderMasterStats() {
    const now =
      new Date();

    const year =
      now.getFullYear();

    const month =
      now.getMonth();

    const monthly =
      state.masterOrders.filter(
        (order) => {
          const date =
            new Date(
              order.created_at
            );

          return (
            !Number.isNaN(
              date.getTime()
            ) &&
            date.getFullYear() ===
              year &&
            date.getMonth() ===
              month
          );
        }
      );

    const total =
      monthly.reduce(
        (sum, order) =>
          sum +
          masterMoney(
            order.total
          ),
        0
      );

    const cash =
      monthly
        .filter(
          (order) =>
            normalizePayment(
              order.payment_method
            ) === 'cash'
        )
        .reduce(
          (sum, order) =>
            sum +
            masterMoney(
              order.total
            ),
          0
        );

    const bank =
      monthly
        .filter(
          (order) =>
            normalizePayment(
              order.payment_method
            ) ===
            'bank_transfer'
        )
        .reduce(
          (sum, order) =>
            sum +
            masterMoney(
              order.total
            ),
          0
        );

    const delivered =
      monthly.filter(
        (order) =>
          isDelivered(
            order.delivery_status
          )
      ).length;

    if (
      $('master-month-count')
    ) {
      $('master-month-count').textContent =
        monthly.length.toLocaleString(
          'ar-EG'
        );
    }

    if (
      $('master-month-total')
    ) {
      $('master-month-total').textContent =
        `${total.toLocaleString('ar-EG', {
          maximumFractionDigits: 2
        })} درهم`;
    }

    if (
      $('master-month-cash')
    ) {
      $('master-month-cash').textContent =
        `${cash.toLocaleString('ar-EG', {
          maximumFractionDigits: 2
        })} درهم`;
    }

    if (
      $('master-month-bank')
    ) {
      $('master-month-bank').textContent =
        `${bank.toLocaleString('ar-EG', {
          maximumFractionDigits: 2
        })} درهم`;
    }

    if (
      $('master-delivered')
    ) {
      $('master-delivered').textContent =
        delivered.toLocaleString(
          'ar-EG'
        );
    }
  }

  function renderMasterOrders() {
    const body =
      $('master-orders-body');

    if (!body) {
      return;
    }

    const orders =
      getMasterFilteredOrders();

    renderMasterStats();

    if (!orders.length) {
      body.innerHTML =
        '<tr><td colspan="10" class="master-empty">لا توجد فواتير مطابقة للبحث.</td></tr>';

      return;
    }

    body.innerHTML = '';

    orders.forEach(
      (order) => {
        const payment =
          normalizePayment(
            order.payment_method
          );

        const delivered =
          isDelivered(
            order.delivery_status
          );

        const tr =
          document.createElement(
            'tr'
          );

        tr.innerHTML = `
        <td>
          <strong>
            #${masterEscape(
              order.order_number ??
              order.id ??
              ''
            )}
          </strong>
        </td>

        <td>
          ${masterEscape(
            order.customer_name ||
            '—'
          )}
        </td>

        <td>
          ${masterEscape(
            order.phone ||
            '—'
          )}
        </td>

        <td>
          ${masterEscape(
            [
              order.emirate,
              order.area
            ]
              .filter(Boolean)
              .join(' / ') ||
            '—'
          )}
        </td>

        <td>
          ${masterEscape(
            masterDriver(order)
          )}
        </td>

        <td>
          <strong>
            ${formatTotal(
              order.total
            )}
          </strong>
        </td>

        <td>
          <span class="master-badge ${
            payment === 'cash'
              ? 'cash'
              : payment ===
                  'bank_transfer'
                ? 'bank'
                : ''
          }">
            ${masterEscape(
              masterPaymentText(
                order.payment_method
              )
            )}
          </span>
        </td>

        <td>
          <span class="master-badge ${
            delivered
              ? 'ok'
              : 'pending'
          }">
            ${
              delivered
                ? '✓ تم التسليم'
                : '⏳ قيد التوصيل'
            }
          </span>
        </td>

        <td>
          ${masterEscape(
            masterDate(
              order.created_at
            )
          )}
        </td>

        <td>
          <button
            class="master-view"
            data-master-view="${masterEscape(
              order.id
            )}">
            عرض
          </button>
        </td>
      `;

        const viewButton =
          tr.querySelector(
            '[data-master-view]'
          );

        if (viewButton) {
          viewButton.addEventListener(
            'click',
            () =>
              openMasterOrder(
                order
              )
          );
        }

        body.appendChild(
          tr
        );
      }
    );
  }

  function openMasterOrder(order) {
    const modal =
      $('master-modal');

    const body =
      $('master-modal-body');

    const title =
      $('master-modal-title');

    if (
      !modal ||
      !body
    ) {
      return;
    }

    const chickenWeights =
      order.chicken_weights ||
      '';

    const chickenQtys =
      order.chicken_qtys ||
      '';

    const plateNames =
      order.plate_names ||
      '';

    const plateQtys =
      order.plate_qtys ||
      '';

    if (title) {
      title.textContent =
        `الفاتورة #${
          order.order_number ??
          order.id ??
          ''
        }`;
    }

    body.innerHTML = `
      <div class="master-detail-grid">

        <div class="master-detail">
          <small>العميل</small>
          <strong>
            ${masterEscape(
              order.customer_name ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>الهاتف</small>
          <strong>
            ${masterEscape(
              order.phone ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>الإمارة</small>
          <strong>
            ${masterEscape(
              order.emirate ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>المنطقة</small>
          <strong>
            ${masterEscape(
              order.area ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>المندوب</small>
          <strong>
            ${masterEscape(
              masterDriver(
                order
              )
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>التاريخ</small>
          <strong>
            ${masterEscape(
              masterDate(
                order.created_at
              )
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>الإجمالي</small>
          <strong>
            ${masterEscape(
              formatTotal(
                order.total
              )
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>طريقة الدفع</small>
          <strong>
            ${masterEscape(
              masterPaymentText(
                order.payment_method
              )
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>حالة التوصيل</small>
          <strong>
            ${masterEscape(
              masterStatusText(
                order.delivery_status
              )
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>منسق الموعد</small>
          <strong>
            ${masterEscape(
              order.appointment_coordinator ||
              '—'
            )}
          </strong>
        </div>

      </div>

      <div class="master-section">
        <div class="master-section-title">
          🍗 الدجاج الكامل
        </div>

        <div class="master-section-content" style="white-space:pre-line;line-height:1.9;">
          ${masterEscape(
            formatChickenLines(
              chickenWeights,
              chickenQtys
            )
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          🍽️ المقطعات
        </div>

        <div class="master-section-content" style="white-space:pre-line;line-height:1.9;">
          ${masterEscape(
            formatPlateLines(
              plateNames,
              plateQtys
            )
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📝 تفاصيل الطلب
        </div>

        <div class="master-section-content">
          ${masterEscape(
            order.order_details ||
            '—'
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📌 الملاحظات
        </div>

        <div class="master-section-content">
          ${masterEscape(
            order.note ||
            '—'
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📍 الموقع
        </div>

        <div class="master-section-content">
          ${
            safeUrl(
              order.location_url
            )
              ? `
                <a
                  href="${masterEscape(
                    safeUrl(
                      order.location_url
                    )
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  فتح موقع العميل
                </a>
              `
              : 'لا يوجد رابط موقع'
          }
        </div>
      </div>

      <div class="master-actions-row">
        <button
          class="master-btn primary"
          id="master-edit-order-btn"
        >
          ✏️ تعديل الفاتورة
        </button>

        <button
          class="master-btn danger"
          id="master-delete-order-btn"
        >
          🗑️ حذف الفاتورة
        </button>
      </div>
    `;

    $('master-edit-order-btn')?.addEventListener(
      'click',
      () =>
        openMasterEdit(
          order
        )
    );

    $('master-delete-order-btn')?.addEventListener(
      'click',
      () =>
        deleteMasterOrder(
          order
        )
    );

    modal.classList.add(
      'open'
    );
  }

  function openMasterEdit(order) {
    const body =
      $('master-modal-body');

    const title =
      $('master-modal-title');

    if (!body) {
      return;
    }

    if (title) {
      title.textContent =
        `تعديل الفاتورة #${
          order.order_number ??
          order.id ??
          ''
        }`;
    }

    body.innerHTML = `
      <div class="master-edit-form">

        <div class="master-edit-grid">

          <label>
            اسم العميل
            <input
              id="master-edit-customer"
              type="text"
              value="${masterEscape(
                order.customer_name ||
                ''
              )}"
            >
          </label>

          <label>
            رقم الهاتف
            <input
              id="master-edit-phone"
              type="text"
              value="${masterEscape(
                order.phone ||
                ''
              )}"
            >
          </label>

          <label>
            الإمارة
            <input
              id="master-edit-emirate"
              type="text"
              value="${masterEscape(
                order.emirate ||
                ''
              )}"
            >
          </label>

          <label>
            المنطقة
            <input
              id="master-edit-area"
              type="text"
              value="${masterEscape(
                order.area ||
                ''
              )}"
            >
          </label>
                    <label>
            أوزان الدجاج الكامل
            <input
              id="master-edit-chicken-weights"
              type="text"
              value="${masterEscape(
                order.chicken_weights ||
                ''
              )}"
            >
          </label>

          <label>
            كميات الدجاج الكامل
            <input
              id="master-edit-chicken-qtys"
              type="text"
              value="${masterEscape(
                order.chicken_qtys ||
                ''
              )}"
            >
          </label>

          <label>
            أصناف المقطعات
            <input
              id="master-edit-plate-names"
              type="text"
              value="${masterEscape(
                order.plate_names ||
                ''
              )}"
            >
          </label>

          <label>
            كميات المقطعات
            <input
              id="master-edit-plate-qtys"
              type="text"
              value="${masterEscape(
                order.plate_qtys ||
                ''
              )}"
            >
          </label>

          <label>
            الإجمالي
            <input
              id="master-edit-total"
              type="text"
              value="${masterEscape(
                order.total ||
                ''
              )}"
            >
          </label>

          <label>
            منسق الموعد
            <input
              id="master-edit-coordinator"
              type="text"
              value="${masterEscape(
                order.appointment_coordinator ||
                ''
              )}"
            >
          </label>

          <label>
            طريقة الدفع
            <select id="master-edit-payment">
              <option
                value=""
                ${
                  !normalizePayment(
                    order.payment_method
                  )
                    ? 'selected'
                    : ''
                }
              >
                غير محدد
              </option>

              <option
                value="cash"
                ${
                  normalizePayment(
                    order.payment_method
                  ) === 'cash'
                    ? 'selected'
                    : ''
                }
              >
                💵 دفع كاش
              </option>

              <option
                value="bank_transfer"
                ${
                  normalizePayment(
                    order.payment_method
                  ) ===
                  'bank_transfer'
                    ? 'selected'
                    : ''
                }
              >
                🏦 تحويل بنكي
              </option>
            </select>
          </label>

          <label>
            حالة التسليم
            <select id="master-edit-status">
              <option
                value="pending"
                ${
                  !isDelivered(
                    order.delivery_status
                  )
                    ? 'selected'
                    : ''
                }
              >
                قيد التوصيل
              </option>

              <option
                value="delivered"
                ${
                  isDelivered(
                    order.delivery_status
                  )
                    ? 'selected'
                    : ''
                }
              >
                تم التسليم
              </option>
            </select>
          </label>

        </div>

        <div class="master-edit-full">
          <label>
            رابط موقع العميل
            <input
              id="master-edit-location"
              type="text"
              value="${masterEscape(
                order.location_url ||
                ''
              )}"
            >
          </label>
        </div>

        <div class="master-edit-full">
          <label>
            تفاصيل الطلب
            <textarea id="master-edit-details">${masterEscape(
              order.order_details ||
              ''
            )}</textarea>
          </label>
        </div>

        <div class="master-edit-full">
          <label>
            الملاحظات
            <textarea id="master-edit-note">${masterEscape(
              order.note ||
              ''
            )}</textarea>
          </label>
        </div>

        <div class="master-actions-row">

          <button
            class="master-btn primary"
            id="master-save-edit"
          >
            💾 حفظ التعديل
          </button>

          <button
            class="master-btn secondary"
            id="master-cancel-edit"
          >
            رجوع
          </button>

        </div>
      </div>
    `;

    $('master-save-edit')?.addEventListener(
      'click',
      () =>
        saveMasterOrder(
          order
        )
    );

    $('master-cancel-edit')?.addEventListener(
      'click',
      () =>
        openMasterOrder(
          order
        )
    );
  }

  async function saveMasterOrder(
    order
  ) {
    const button =
      $('master-save-edit');

    if (button) {
      button.disabled = true;
      button.textContent =
        'جارٍ الحفظ…';
    }

    const updatedOrder = {
      customer_name:
        $('master-edit-customer')?.value ||
        '',

      phone:
        $('master-edit-phone')?.value ||
        '',

      emirate:
        $('master-edit-emirate')?.value ||
        '',

      area:
        $('master-edit-area')?.value ||
        '',

      chicken_weights:
        $('master-edit-chicken-weights')?.value ||
        '',

      chicken_qtys:
        $('master-edit-chicken-qtys')?.value ||
        '',

      plate_names:
        $('master-edit-plate-names')?.value ||
        '',

      plate_qtys:
        $('master-edit-plate-qtys')?.value ||
        '',

      total:
        $('master-edit-total')?.value ||
        '',

      appointment_coordinator:
        $('master-edit-coordinator')?.value ||
        '',

      location_url:
        $('master-edit-location')?.value ||
        '',

      order_details:
        $('master-edit-details')?.value ||
        '',

      note:
        $('master-edit-note')?.value ||
        '',

      payment_method:
        $('master-edit-payment')?.value ||
        '',

      delivery_status:
        $('master-edit-status')?.value ||
        'pending'
    };

    try {
      const data =
        await masterFetch(
          '/api/master/order/update',
          {
            method: 'POST',
            body:
              JSON.stringify({
                orderId:
                  order.id,
                order:
                  updatedOrder
              })
          }
        );

      const saved =
        data?.order ||
        data?.data ||
        data;

      const index =
        state.masterOrders.findIndex(
          (item) =>
            String(item.id) ===
            String(order.id)
        );

      if (index !== -1) {
        state.masterOrders[index] = {
          ...state.masterOrders[index],
          ...updatedOrder,
          ...(saved &&
          typeof saved ===
            'object'
            ? saved
            : {})
        };
      }

      const current =
        state.masterOrders[index] ||
        order;

      toast(
        'تم تعديل الفاتورة بنجاح ✅'
      );

      openMasterOrder(
        current
      );

      renderMasterOrders();

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

      if (button) {
        button.disabled =
          false;

        button.textContent =
          '💾 حفظ التعديل';
      }
    }
  }

  async function deleteMasterOrder(
    order
  ) {
    const number =
      order.order_number ??
      order.id ??
      '';

    const customer =
      order.customer_name ||
      '';

    const confirmed =
      window.confirm(
        `هل أنت متأكد من حذف الفاتورة #${number}${
          customer
            ? ` الخاصة بالعميل ${customer}`
            : ''
        }؟\n\nلا يمكن التراجع عن الحذف.`
      );

    if (!confirmed) {
      return;
    }

    try {
      const button =
        $('master-delete-order-btn');

      if (button) {
        button.disabled =
          true;

        button.textContent =
          'جارٍ الحذف…';
      }

      await masterFetch(
        '/api/master/order/delete',
        {
          method: 'POST',
          body:
            JSON.stringify({
              orderId:
                order.id
            })
        }
      );

      state.masterOrders =
        state.masterOrders.filter(
          (item) =>
            String(item.id) !==
            String(order.id)
        );

      closeMasterModal();

      renderMasterOrders();

      toast(
        'تم حذف الفاتورة بنجاح ✅'
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
    }
  }

  function closeMasterModal() {
    $('master-modal')?.classList.remove(
      'open'
    );
  }

  function masterLogout(
    message = ''
  ) {
    saveMasterSession(
      null
    );

    state.masterOrders = [];
    state.role = '';

    window.location.reload();

    if (message) {
      setTimeout(
        () =>
          showLogin(
            message
          ),
        100
      );
    }
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
              ?.value ||
            '';

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
            if (
              username ===
              MASTER_USERNAME
            ) {
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

              if (
                !response.ok
              ) {
                throw new Error(
                  data.error ||
                  'تعذر تسجيل دخول الماستر'
                );
              }

              const masterSession =
                normalizeMasterSession({
                  ...data,
                  username:
                    data.username ||
                    username
                });

              if (
                !masterSession.access_token
              ) {
                throw new Error(
                  'لم يتم إنشاء جلسة الماستر'
                );
              }

              saveMasterSession(
                masterSession
              );

              state.role =
                'master_admin';

              const passwordInput =
                $('password');

              if (
                passwordInput
              ) {
                passwordInput.value =
                  '';
              }

              showMasterDashboard();

            } else {

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

              if (
                !response.ok
              ) {
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

              state.role =
                'driver';

              const passwordInput =
                $('password');

              if (
                passwordInput
              ) {
                passwordInput.value =
                  '';
              }

              showOrders();
            }

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
        () =>
          logout()
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
                      item ===
                        tab
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
          state.masterSession?.access_token
        ) {
          loadMasterOrders();

          return;
        }

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

    const masterSession =
      loadStoredMasterSession();

    if (
      masterSession?.access_token
    ) {
      saveMasterSession(
        masterSession
      );

      state.role =
        'master_admin';

      showMasterDashboard();

      return;
    }

    const session =
      loadStoredSession();

    if (
      session?.access_token
    ) {
      saveSession(
        session
      );

      state.role =
        'driver';

      showOrders();

    } else {
      showLogin();
    }
  }

  boot();
})();
