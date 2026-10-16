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

  function hasActualData(value) {
    if (value === null || value === undefined) return false;
    const text = String(value).trim();
    return text !== '' && text !== '—' && text !== '-' && text.toLowerCase() !== 'null' && text.toLowerCase() !== 'undefined';
  }

  function hideFieldRow(node, field, shouldShow) {
    const element = node.querySelector(`[data-f="${field}"]`);
    if (!element) return;
    const row = element.closest('.info-item, .order-section, .detail-row, .field-row, .master-section, tr, .invoice-section') || element;
    row.style.display = shouldShow ? '' : 'none';
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
          `🐔 ${weight} جرام — ${qty}`
        );
      } else if (weight) {
        result.push(
          `🐔 ${weight} جرام`
        );
      } else {
        result.push(
          `${qty}`
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
          `${plateIcon(name)} ${name} — ${qty}`
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

  function plateIcon(name) {
    const value = String(name || '');
    if (/صدر|صدور/.test(value)) return '🍗';
    if (/دبوس|أرجل|ارجل|أفخاذ|افخاذ/.test(value)) return '🍗';
    return '🍗';
  }

  function invoiceTable(title, icon, names, weights, quantities, isChicken) {
    const nameList = isChicken ? extractNumbers(weights) : extractPlateNames(names);
    const qtyList = isChicken ? extractNumbers(quantities) : extractPlateQuantities(quantities);
    const count = Math.max(nameList.length, qtyList.length);
    if (!count) return '';
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const name = nameList[i] || '';
      const qty = qtyList[i] || '';
      if (!name && !qty) continue;
      rows.push(`<tr><td>${icon} ${isChicken ? 'الدجاج الكامل' : masterEscape(name)}</td><td>${isChicken && name ? `${masterEscape(name)} جرام` : '—'}</td><td>${masterEscape(qty || '—')}</td></tr>`);
    }
    if (!rows.length) return '';
    return `<section class="invoice-items-panel ${isChicken ? 'whole-chicken-panel' : 'cut-pieces-panel'}"><h4>${icon} ${title}</h4><table class="invoice-items-table"><thead><tr><th>الصنف</th><th>الوزن</th><th>الكمية</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`;
  }

  function renderInvoiceItems(node, chickenWeights, chickenQtys, plateNames, plateQtys) {
    const oldFields = ['chicken_weights', 'chicken_qtys', 'plate_names', 'plate_qtys'];
    oldFields.forEach((field) => hideFieldRow(node, field, false));
    const chickenHas = hasActualData(chickenWeights) || hasActualData(chickenQtys);
    const platesHas = hasActualData(plateNames) || hasActualData(plateQtys);
    const chickenHtml = chickenHas ? invoiceTable('الكراتين — الدجاج الكامل', '🐔', '', chickenWeights, chickenQtys, true) : '';
    const platesHtml = platesHas ? invoiceTable('المقطعات', '🍗', plateNames, '', plateQtys, false) : '';
    if (!chickenHtml && !platesHtml) return;
    let holder = node.querySelector('.invoice-items-layout');
    if (!holder) {
      holder = document.createElement('div');
      holder.className = 'invoice-items-layout';
      const details = node.querySelector('[data-f="order_details"]');
      const note = node.querySelector('[data-f="note"]');
      const total = node.querySelector('[data-f="total"]');
      const anchor =
        note?.closest('.info-item, .order-section, .detail-row, .field-row, .master-section, .invoice-section') ||
        total?.closest('.info-item, .order-section, .detail-row, .field-row, .master-section, .invoice-section') ||
        details?.closest('.info-item, .order-section, .detail-row, .field-row, .master-section, .invoice-section') ||
        note || total || details;
      if (anchor?.parentNode) anchor.parentNode.insertBefore(holder, anchor);
      else node.appendChild(holder);
    }
    holder.innerHTML = `${platesHtml}${chickenHtml}`;
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

      // اعرض فقط الأقسام التي لها بيانات فعلية في الفاتورة.
      const hasChicken =
        hasActualData(chickenWeights) ||
        hasActualData(chickenQtys);
      const hasPlates =
        hasActualData(plateNames) ||
        hasActualData(plateQtys);

      hideFieldRow(node, 'chicken_weights', hasChicken);
      hideFieldRow(node, 'chicken_qtys', hasChicken);
      hideFieldRow(node, 'plate_names', hasPlates);
      hideFieldRow(node, 'plate_qtys', hasPlates);

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

      renderInvoiceItems(node, chickenWeights, chickenQtys, plateNames, plateQtys);

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
    state.role = '';

    const list =
      $('orders-list');

    if (list) {
      list.replaceChildren();
    }

    showLogin(message);
  }


  const MASTER_SESSION_KEY = 'master_session';
  const MASTER_USERNAME = 'zezo';

  state.masterOrders = [];
  state.role = '';

  function normalizeMasterSession(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }

    return {
      access_token: String(value.access_token || ''),
      refresh_token: String(value.refresh_token || ''),
      expires_at: Number(value.expires_at || 0),
      username: String(value.username || MASTER_USERNAME),
      email: String(value.email || ''),
      role: String(value.role || 'master_admin')
    };
  }

  function saveMasterSession(session) {
    if (!session) {
      localStorage.removeItem(MASTER_SESSION_KEY);
      state.masterSession = null;
      return;
    }

    const normalized = normalizeMasterSession(session);

    if (!normalized?.access_token) {
      localStorage.removeItem(MASTER_SESSION_KEY);
      state.masterSession = null;
      return;
    }

    state.masterSession = normalized;
    localStorage.setItem(
      MASTER_SESSION_KEY,
      JSON.stringify(normalized)
    );
  }

  function loadStoredMasterSession() {
    try {
      const raw = localStorage.getItem(MASTER_SESSION_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      const session = normalizeMasterSession(parsed);

      if (!session?.access_token) {
        return null;
      }

      if (
        session.expires_at &&
        session.expires_at < Date.now() / 1000 + 30
      ) {
        localStorage.removeItem(MASTER_SESSION_KEY);
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  async function masterFetch(path, options = {}) {
    if (!state.masterSession?.access_token) {
      throw new Error('expired');
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.masterSession.access_token}`,
      ...(options.headers || {})
    };

    const response = await fetch(path, {
      ...options,
      headers
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      masterLogout('انتهت جلسة الماستر، يرجى تسجيل الدخول مجددًا');
      throw new Error('expired');
    }

    if (!response.ok) {
      throw new Error(data.error || 'حدث خطأ غير متوقع');
    }

    return data;
  }

  function masterMoney(value) {
    const number = Number(
      String(value ?? '').replace(/[^\d.-]/g, '')
    );

    if (!Number.isFinite(number)) {
      return 0;
    }

    return number;
  }

  function masterDriver(order) {
    const sheet = String(order.sheet_name || '').trim();

    if (sheet === 'Mandoub2') {
      return 'مندوب 2';
    }

    if (sheet === 'Mandoub') {
      return 'مندوب 1';
    }

    return sheet || 'غير محدد';
  }

  function masterDate(value) {
    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  function masterDateInput(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
  }

  function masterEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function masterPaymentText(value) {
    const payment = normalizePayment(value);

    if (payment === 'cash') {
      return '💵 كاش';
    }

    if (payment === 'bank_transfer') {
      return '🏦 تحويل بنكي';
    }

    return 'غير محدد';
  }

  function masterStatusText(value) {
    return isDelivered(value)
      ? 'تم التسليم'
      : 'قيد التوصيل';
  }

  function masterInjectStyles() {
    if ($('master-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'master-style';
    style.textContent = `
      .master-page{min-height:100vh;background:#f4f7f8;color:#172024;font-family:inherit}
      .master-top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border-bottom:1px solid #e5eaec;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px}
      .master-brand{display:flex;align-items:center;gap:12px}
      .master-logo{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#f7c948,#f08c00);display:grid;place-items:center;font-size:25px;box-shadow:0 8px 22px rgba(240,140,0,.2)}
      .master-title{font-size:20px;font-weight:800}
      .master-sub{font-size:12px;color:#718087;margin-top:2px}
      .master-actions{display:flex;gap:8px;flex-wrap:wrap}
      .master-btn{border:0;border-radius:11px;padding:10px 14px;cursor:pointer;font-weight:700;background:#172024;color:#fff}
      .master-btn.secondary{background:#eef2f3;color:#172024}
      .master-btn.danger{background:#c62828}
      .master-wrap{max-width:1450px;margin:0 auto;padding:22px}
      .master-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}
      .master-stat{background:#fff;border:1px solid #e5eaec;border-radius:16px;padding:17px;box-shadow:0 5px 18px rgba(20,40,50,.04)}
      .master-stat-label{font-size:12px;color:#748187;margin-bottom:8px}
      .master-stat-value{font-size:23px;font-weight:850}
      .master-tools{background:#fff;border:1px solid #e5eaec;border-radius:16px;padding:15px;margin-bottom:16px}
      .master-filters{display:grid;grid-template-columns:1.2fr 1.2fr 1fr 1fr 1fr 1fr;gap:9px}
      .master-input,.master-select{width:100%;box-sizing:border-box;border:1px solid #dfe5e7;background:#fafcfc;border-radius:10px;padding:11px 12px;outline:none;font-family:inherit}
      .master-input:focus,.master-select:focus{border-color:#f0a500;box-shadow:0 0 0 3px rgba(240,165,0,.12)}
      .master-table-wrap{background:#fff;border:1px solid #e5eaec;border-radius:16px;overflow:auto;box-shadow:0 5px 18px rgba(20,40,50,.04)}
      .master-table{width:100%;border-collapse:collapse;min-width:980px}
      .master-table th{background:#f8fafb;color:#66747a;font-size:12px;text-align:right;padding:13px;border-bottom:1px solid #e5eaec;white-space:nowrap}
      .master-table td{padding:12px 13px;border-bottom:1px solid #edf0f1;font-size:13px;vertical-align:middle}
      .master-table tr:hover td{background:#fcfdfd}
      .master-badge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:750;white-space:nowrap}
      .master-badge.ok{background:#e8f7ee;color:#16723b}
      .master-badge.pending{background:#fff5dc;color:#8a5a00}
      .master-badge.cash{background:#e9f7ed;color:#1d6e3b}
      .master-badge.bank{background:#e9f0ff;color:#315b9a}
      .master-view{border:0;background:#172024;color:#fff;border-radius:9px;padding:8px 11px;cursor:pointer;font-weight:700}
      .master-empty{text-align:center;padding:50px 20px;color:#7a878c}
      .master-modal{position:fixed;inset:0;z-index:100;background:rgba(8,18,22,.55);display:none;align-items:center;justify-content:center;padding:18px}
      .master-modal.open{display:flex}
      .master-modal-card{background:#fff;width:min(850px,100%);max-height:90vh;overflow:auto;border-radius:20px;box-shadow:0 25px 80px rgba(0,0,0,.25)}
      .master-modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #e8edef;position:sticky;top:0;background:#fff;z-index:2}
      .master-modal-close{border:0;background:#f0f3f4;border-radius:10px;width:38px;height:38px;cursor:pointer;font-size:18px}
      .master-modal-body{padding:20px}
      .master-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .master-detail{background:#f7f9fa;border-radius:12px;padding:12px}
      .master-detail small{display:block;color:#77848a;font-size:11px;margin-bottom:5px}
      .master-detail strong{display:block;white-space:pre-wrap;word-break:break-word}
      .master-section{margin-top:14px;border:1px solid #e8edef;border-radius:13px;padding:13px}
      .master-section-title{font-weight:800;margin-bottom:8px}
      .master-section-content{white-space:pre-wrap;line-height:1.7;color:#39484e}
      .invoice-items-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;direction:rtl;margin:10px 0;width:100%;box-sizing:border-box}
      .invoice-items-panel{min-width:0;border:1px solid #dce7df;border-radius:12px;overflow:hidden;background:#fff}
      .invoice-items-panel h4{margin:0;padding:9px 10px;background:#edf7ef;color:#174c2c;font-size:13px;font-weight:800}
      .invoice-items-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}
      .invoice-items-table th{background:#f6f8f6;color:#4b5b50;padding:7px 4px;border-bottom:1px solid #dce7df;text-align:center}
      .invoice-items-table td{padding:8px 4px;border-bottom:1px solid #edf1ed;text-align:center;overflow-wrap:anywhere}
      .invoice-items-table tbody tr:last-child td{border-bottom:0}
      .invoice-items-table .items-icon{width:28px;font-size:18px}
      .invoice-items-table th:first-child{width:40%}
      @media(max-width:480px){.invoice-items-layout{gap:6px}.invoice-items-panel h4{font-size:11px;padding:8px 5px}.invoice-items-table{font-size:10px}.invoice-items-table th,.invoice-items-table td{padding:6px 2px}.invoice-items-table .items-icon{font-size:15px;width:22px}}
      .master-month-note{font-size:11px;color:#7b878c;margin-top:8px}
      @media(max-width:1050px){.master-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.master-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:650px){.master-top{align-items:flex-start}.master-wrap{padding:12px}.master-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.master-filters{grid-template-columns:1fr 1fr}.master-detail-grid{grid-template-columns:1fr}.master-title{font-size:17px}.master-btn{padding:9px 11px}}
    `;

    document.head.appendChild(style);
  }

  function showMasterDashboard() {
    state.role = 'master_admin';

    const loginView = $('login-view');
    const ordersView = $('orders-view');

    if (loginView) {
      loginView.hidden = true;
    }

    if (ordersView) {
      ordersView.hidden = true;
    }

    masterInjectStyles();

    const shell = document.querySelector('.app-shell') || document.body;

    shell.innerHTML = `
      <div class="master-page" id="master-page" dir="rtl">
        <header class="master-top">
          <div class="master-brand">
            <div class="master-logo">🐔</div>
            <div>
              <div class="master-title">فروج الزين — الإدارة الرئيسية</div>
              <div class="master-sub">لوحة تحكم خاصة بالماستر • ${masterEscape(state.masterSession?.username || MASTER_USERNAME)}</div>
            </div>
          </div>
          <div class="master-actions">
            <button class="master-btn secondary" id="master-refresh">↻ تحديث</button>
            <button class="master-btn danger" id="master-logout">تسجيل الخروج</button>
          </div>
        </header>

        <main class="master-wrap">
          <section class="master-stats">
            <div class="master-stat"><div class="master-stat-label">إجمالي فواتير الشهر</div><div class="master-stat-value" id="master-month-count">0</div></div>
            <div class="master-stat"><div class="master-stat-label">إجمالي الشهر</div><div class="master-stat-value" id="master-month-total">0 درهم</div></div>
            <div class="master-stat"><div class="master-stat-label">كاش الشهر</div><div class="master-stat-value" id="master-month-cash">0 درهم</div></div>
            <div class="master-stat"><div class="master-stat-label">تحويل الشهر</div><div class="master-stat-value" id="master-month-bank">0 درهم</div></div>
            <div class="master-stat"><div class="master-stat-label">تم التسليم</div><div class="master-stat-value" id="master-delivered">0</div></div>
          </section>

          <section class="master-tools">
            <div class="master-filters">
              <input class="master-input" id="master-search-number" placeholder="رقم الفاتورة">
              <input class="master-input" id="master-search-name" placeholder="اسم العميل">
              <input class="master-input" id="master-search-phone" placeholder="رقم الهاتف">
              <input class="master-input" id="master-search-date" type="date" title="التاريخ">
              <select class="master-select" id="master-filter-driver">
                <option value="">كل المندوبين</option>
                <option value="Mandoub">مندوب 1</option>
                <option value="Mandoub2">مندوب 2</option>
              </select>
              <select class="master-select" id="master-filter-status">
                <option value="">كل الحالات</option>
                <option value="pending">قيد التوصيل</option>
                <option value="delivered">تم التسليم</option>
              </select>
            </div>
            <div class="master-month-note">البحث بالتاريخ يعتمد على تاريخ إنشاء الفاتورة المسجل في قاعدة البيانات.</div>
          </section>

          <section class="master-table-wrap">
            <table class="master-table">
              <thead>
                <tr>
                  <th>الفاتورة</th>
                  <th>العميل</th>
                  <th>الهاتف</th>
                  <th>الإمارة / المنطقة</th>
                  <th>المندوب</th>
                  <th>الإجمالي</th>
                  <th>الدفع</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                  <th>عرض</th>
                </tr>
              </thead>
              <tbody id="master-orders-body"></tbody>
            </table>
          </section>
        </main>

        <div class="master-modal" id="master-modal">
          <div class="master-modal-card">
            <div class="master-modal-head">
              <strong id="master-modal-title">تفاصيل الفاتورة</strong>
              <button class="master-modal-close" id="master-modal-close">×</button>
            </div>
            <div class="master-modal-body" id="master-modal-body"></div>
          </div>
        </div>
      </div>
    `;

    $('master-refresh')?.addEventListener('click', loadMasterOrders);
    $('master-logout')?.addEventListener('click', () => masterLogout());
    $('master-modal-close')?.addEventListener('click', closeMasterModal);

    $('master-modal')?.addEventListener('click', (event) => {
      if (event.target.id === 'master-modal') {
        closeMasterModal();
      }
    });

    [
      'master-search-number',
      'master-search-name',
      'master-search-phone',
      'master-search-date',
      'master-filter-driver',
      'master-filter-status'
    ].forEach((id) => {
      $(id)?.addEventListener('input', renderMasterOrders);
      $(id)?.addEventListener('change', renderMasterOrders);
    });

    loadMasterOrders();
  }

  async function loadMasterOrders() {
    const body = $('master-orders-body');

    if (body) {
      body.innerHTML = '<tr><td colspan="10" class="master-empty">جارٍ تحميل الفواتير…</td></tr>';
    }

    try {
      const data = await masterFetch('/api/master/orders');

      state.masterOrders = Array.isArray(data)
        ? data
        : Array.isArray(data?.orders)
          ? data.orders
          : [];

      renderMasterOrders();
    } catch (error) {
      if (error.message !== 'expired' && body) {
        body.innerHTML = `<tr><td colspan="10" class="master-empty">${masterEscape(error.message)}</td></tr>`;
      }
    }
  }

  function getMasterFilteredOrders() {
    const number = String($('master-search-number')?.value || '').trim().toLowerCase();
    const name = String($('master-search-name')?.value || '').trim().toLowerCase();
    const phone = String($('master-search-phone')?.value || '').trim().toLowerCase();
    const date = String($('master-search-date')?.value || '').trim();
    const driver = String($('master-filter-driver')?.value || '').trim();
    const status = String($('master-filter-status')?.value || '').trim();

    return state.masterOrders.filter((order) => {
      const orderNumber = String(order.order_number ?? order.id ?? '').toLowerCase();
      const customerName = String(order.customer_name ?? '').toLowerCase();
      const customerPhone = String(order.phone ?? '').toLowerCase();

      if (number && !orderNumber.includes(number)) {
        return false;
      }

      if (name && !customerName.includes(name)) {
        return false;
      }

      if (phone && !customerPhone.includes(phone)) {
        return false;
      }

      if (date && masterDateInput(order.created_at) !== date) {
        return false;
      }

      if (driver && String(order.sheet_name || '') !== driver) {
        return false;
      }

      if (status) {
        const delivered = isDelivered(order.delivery_status);

        if (status === 'delivered' && !delivered) {
          return false;
        }

        if (status === 'pending' && delivered) {
          return false;
        }
      }

      return true;
    });
  }

  function renderMasterStats() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const monthly = state.masterOrders.filter((order) => {
      const date = new Date(order.created_at);

      return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === year &&
        date.getMonth() === month
      );
    });

    const total = monthly.reduce(
      (sum, order) => sum + masterMoney(order.total),
      0
    );

    const cash = monthly
      .filter((order) => normalizePayment(order.payment_method) === 'cash')
      .reduce((sum, order) => sum + masterMoney(order.total), 0);

    const bank = monthly
      .filter((order) => normalizePayment(order.payment_method) === 'bank_transfer')
      .reduce((sum, order) => sum + masterMoney(order.total), 0);

    const delivered = monthly.filter((order) => isDelivered(order.delivery_status)).length;

    if ($('master-month-count')) {
      $('master-month-count').textContent = monthly.length.toLocaleString('ar-EG');
    }

    if ($('master-month-total')) {
      $('master-month-total').textContent = `${total.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} درهم`;
    }

    if ($('master-month-cash')) {
      $('master-month-cash').textContent = `${cash.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} درهم`;
    }

    if ($('master-month-bank')) {
      $('master-month-bank').textContent = `${bank.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} درهم`;
    }

    if ($('master-delivered')) {
      $('master-delivered').textContent = delivered.toLocaleString('ar-EG');
    }
  }

  function renderMasterOrders() {
    const body = $('master-orders-body');

    if (!body) {
      return;
    }

    const orders = getMasterFilteredOrders();

    renderMasterStats();

    if (!orders.length) {
      body.innerHTML = '<tr><td colspan="10" class="master-empty">لا توجد فواتير مطابقة للبحث.</td></tr>';
      return;
    }

    body.innerHTML = '';

    orders.forEach((order) => {
      const payment = normalizePayment(order.payment_method);
      const delivered = isDelivered(order.delivery_status);
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td><strong>#${masterEscape(order.order_number ?? order.id ?? '')}</strong></td>
        <td>${masterEscape(order.customer_name || '—')}</td>
        <td>${masterEscape(order.phone || '—')}</td>
        <td>${masterEscape([order.emirate, order.area].filter(Boolean).join(' / ') || '—')}</td>
        <td>${masterEscape(masterDriver(order))}</td>
        <td><strong>${formatTotal(order.total)}</strong></td>
        <td><span class="master-badge ${payment === 'cash' ? 'cash' : payment === 'bank_transfer' ? 'bank' : ''}">${masterEscape(masterPaymentText(order.payment_method))}</span></td>
        <td><span class="master-badge ${delivered ? 'ok' : 'pending'}">${delivered ? '✓ تم التسليم' : '⏳ قيد التوصيل'}</span></td>
        <td>${masterEscape(masterDate(order.created_at))}</td>
        <td><button class="master-view" data-master-view="${masterEscape(order.id)}">عرض</button></td>
      `;

      tr.querySelector('[data-master-view]')?.addEventListener(
        'click',
        () => openMasterOrder(order)
      );

      body.appendChild(tr);
    });
  }

  function openMasterOrder(order) {
    const modal = $('master-modal');
    const body = $('master-modal-body');
    const title = $('master-modal-title');

    if (!modal || !body) {
      return;
    }

    const chickenWeights = order.chicken_weights || '';
    const chickenQtys = order.chicken_qtys || '';
    const plateNames = order.plate_names || '';
    const plateQtys = order.plate_qtys || '';

    if (title) {
      title.textContent = `الفاتورة #${order.order_number ?? order.id ?? ''}`;
    }

    body.innerHTML = `
      <div class="master-detail-grid">
        <div class="master-detail"><small>العميل</small><strong>${masterEscape(order.customer_name || '—')}</strong></div>
        <div class="master-detail"><small>الهاتف</small><strong>${masterEscape(order.phone || '—')}</strong></div>
        <div class="master-detail"><small>الإمارة</small><strong>${masterEscape(order.emirate || '—')}</strong></div>
        <div class="master-detail"><small>المنطقة</small><strong>${masterEscape(order.area || '—')}</strong></div>
        <div class="master-detail"><small>المندوب</small><strong>${masterEscape(masterDriver(order))}</strong></div>
        <div class="master-detail"><small>التاريخ</small><strong>${masterEscape(masterDate(order.created_at))}</strong></div>
        <div class="master-detail"><small>الإجمالي</small><strong>${masterEscape(formatTotal(order.total))}</strong></div>
        <div class="master-detail"><small>طريقة الدفع</small><strong>${masterEscape(masterPaymentText(order.payment_method))}</strong></div>
        <div class="master-detail"><small>حالة التوصيل</small><strong>${masterEscape(masterStatusText(order.delivery_status))}</strong></div>
        <div class="master-detail"><small>منسق الموعد</small><strong>${masterEscape(order.appointment_coordinator || '—')}</strong></div>
      </div>

      <div class="master-section">
        <div class="master-section-title">🍗 الدجاج الكامل — الأوزان</div>
        <div class="master-section-content">${masterEscape(chickenWeights || '—')}</div>
      </div>

      <div class="master-section">
        <div class="master-section-title">📦 الدجاج الكامل — الكمية</div>
        <div class="master-section-content">${masterEscape(chickenQtys || '—')}</div>
      </div>

      <div class="master-section">
        <div class="master-section-title">🍽️ المقطعات — الأصناف</div>
        <div class="master-section-content">${masterEscape(plateNames || '—')}</div>
      </div>

      <div class="master-section">
        <div class="master-section-title">📦 المقطعات — الكمية</div>
        <div class="master-section-content">${masterEscape(plateQtys || '—')}</div>
      </div>

      <div class="master-section">
        <div class="master-section-title">📝 تفاصيل الطلب</div>
        <div class="master-section-content">${masterEscape(order.order_details || '—')}</div>
      </div>

      <div class="master-section">
        <div class="master-section-title">📌 الملاحظات</div>
        <div class="master-section-content">${masterEscape(order.note || '—')}</div>
      </div>
    `;

    modal.classList.add('open');
  }

  function closeMasterModal() {
    $('master-modal')?.classList.remove('open');
  }

  function masterLogout(message = '') {
    saveMasterSession(null);
    state.masterOrders = [];
    state.role = '';
    window.location.reload();

    if (message) {
      setTimeout(() => showLogin(message), 100);
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
            if (username === MASTER_USERNAME) {
              const response = await fetch(
                '/api/master-login',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    username,
                    password
                  })
                }
              );

              const data = await response
                .json()
                .catch(() => ({}));

              if (!response.ok) {
                throw new Error(
                  data.error || 'تعذر تسجيل دخول الماستر'
                );
              }

              const masterSession = normalizeMasterSession({
                ...data,
                username: data.username || username
              });

              if (!masterSession.access_token) {
                throw new Error('لم يتم إنشاء جلسة الماستر');
              }

              saveMasterSession(masterSession);
              state.role = 'master_admin';

              const passwordInput = $('password');

              if (passwordInput) {
                passwordInput.value = '';
              }

              showMasterDashboard();
            } else {
              const response = await fetch(
                '/api/login',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    username,
                    password
                  })
                }
              );

              const data = await response
                .json()
                .catch(() => ({}));

              if (!response.ok) {
                throw new Error(
                  data.error || 'تعذر تسجيل الدخول'
                );
              }

              const session = normalizeSession({
                ...data,
                username:
                  data.username ||
                  username
              });

              if (!session.access_token) {
                throw new Error(
                  'لم يتم إنشاء جلسة دخول'
                );
              }

              saveSession(session);
              state.role = 'driver';

              const passwordInput = $('password');

              if (passwordInput) {
                passwordInput.value = '';
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
          state.masterSession?.access_token
        ) {
          loadMasterOrders();
          return;
        }

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

    const masterSession =
      loadStoredMasterSession();

    if (masterSession?.access_token) {
      saveMasterSession(masterSession);
      state.role = 'master_admin';
      showMasterDashboard();
      return;
    }

    const session =
      loadStoredSession();

    if (session?.access_token) {
      saveSession(session);
      state.role = 'driver';
      showOrders();
    } else {
      showLogin();
    }
  }

  boot();
})();
