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

  const isPaidInAdvance = (orderOrValue) => {
    const value = orderOrValue && typeof orderOrValue === 'object'
      ? orderOrValue.paid_in_advance
      : orderOrValue;
    return value === true ||
      value === 1 ||
      String(value ?? '').trim().toLowerCase() === 'true' ||
      String(value ?? '').trim() === '1';
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

      state.orders = orders.sort((a, b) => {
        const getInvoiceNumber = (order) => {
          const value =
            order?.order_number ??
            order?.invoice_number ??
            order?.invoiceNo ??
            '';

          const match =
            String(value).match(/\d+/);

          return match
            ? Number(match[0])
            : Number.MAX_SAFE_INTEGER;
        };

        return (
          getInvoiceNumber(a) -
          getInvoiceNumber(b)
        );
      });

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

  function deliveryFeeFromOrder(order) {
    const explicit = Number(order?.delivery_fee ?? order?.deliveryFee ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const note = String(order?.note ?? order?.notes ?? order?.remarks ?? '');
    const match = note.match(/\[\[DELIVERY_FEE:(\d+(?:\.\d+)?)\]\]/i);
    return match ? Number(match[1]) || 0 : 0;
  }

  function cleanOrderNote(value) {
    return String(value ?? '').replace(/\s*\[\[DELIVERY_FEE:\d+(?:\.\d+)?\]\]/ig, '').trim();
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
          `${weight} جرام - ${qty}`
        );
      } else if (weight) {
        result.push(
          `${weight} جرام`
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
      String(value ?? '')
        .replace(/\r/g, '')
        .trim();

    if (!text) {
      return [];
    }

    const lines = text
      .split('\n')
      .map((line) =>
        line
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);

    if (lines.length > 1) {
      return lines;
    }

    const singleLine = lines[0] || '';

    const separated = singleLine
      .split(/[،,|/]+/)
      .map((line) =>
        line
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);

    if (separated.length > 1) {
      return separated;
    }

    const knownNames = [
      'أرجل دبوس',
      'ارجل دبوس',
      'أفخاذ',
      'افخاذ',
      'أجنحة',
      'اجنحه',
      'صدور',
      'كبدة',
      'كبده',
      'قوانص',
      'قلوب'
    ];

    const escaped =
      knownNames
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

    const knownMatches =
      singleLine.match(
        new RegExp(
          escaped,
          'g'
        )
      ) || [];

    if (knownMatches.length) {
      return knownMatches;
    }

    return [singleLine];
  }

  function normalizeArabicDigits(value) {
    return String(value ?? '')
      .replace(/[٠-٩]/g, (digit) =>
        String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
      );
  }

  function extractPlateQuantities(value) {
    const text = normalizeArabicDigits(value)
      .replace(/\r/g, '')
      .trim();

    if (!text) {
      return [];
    }

    // الكمية في Excel مرتبطة بسطر المقطعة نفسه.
    // نحافظ على النص كما هو: 2 / 2 هدية / 2 + 2 هدية.
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const quantityLines = lines
      .map((line) =>
        line
          .replace(/هديّه|هديـة|هديه/g, 'هدية')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter((line) => /\d/.test(line));

    if (quantityLines.length > 1) {
      return quantityLines;
    }

    // احتياطًا لو رجعت البيانات في سطر واحد بدل أسطر Excel.
    return (
      text.match(
        /\d+\s*\+\s*\d+\s*(?:هدية|هديه)|\d+\s*(?:هدية|هديه)|\d+/g
      ) || []
    ).map((item) =>
      item
        .replace(/هديّه|هديـة|هديه/g, 'هدية')
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
          `${name} - ${qty}`
        );
      } else if (name) {
        result.push(
          `${name}`
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

      const prepaid = isPaidInAdvance(order);
      const oldPaidBadge = node.querySelector('.paid-advance-badge');
      if (oldPaidBadge) oldPaidBadge.remove();
      if (prepaid) {
        const badge = document.createElement('span');
        badge.className = 'paid-advance-badge';
        badge.textContent = 'مدفوع';
        badge.setAttribute('aria-label', 'مدفوع مقدمًا');
        badge.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;background:#c62828;color:#ffffff;border:3px solid #8e0000;border-radius:14px;padding:12px 20px;font-size:22px;line-height:1.3;font-weight:1000;letter-spacing:.2px;white-space:nowrap;width:fit-content;max-width:100%;box-shadow:0 4px 0 rgba(142,0,0,.18);margin:4px 0 12px auto;';
        const badgeMark = document.createElement('span');
        badgeMark.textContent = '✓';
        badgeMark.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:0 0 26px;width:26px;height:26px;border-radius:50%;background:#ffffff;color:#c62828;font-size:19px;font-weight:1000;';
        badge.prepend(badgeMark);
        node.insertBefore(badge, node.firstChild);
      }

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

      const chickenSection =
        node.querySelector(
          '.chicken-section'
        );

      const cutsSection =
        node.querySelector(
          '.cuts-section'
        );

      const hasChicken =
        chickenDisplay !== '—' &&
        String(chickenDisplay).trim() !== '';

      const hasCuts =
        plateDisplay !== '—' &&
        String(plateDisplay).trim() !== '';

      if (chickenSection) {
        chickenSection.style.display =
          hasChicken ? '' : 'none';
      }

      if (cutsSection) {
        cutsSection.style.display =
          hasCuts ? '' : 'none';
      }

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
            '.info-item, .order-section, .detail-row, .field-row, .product-box'
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
            '.info-item, .order-section, .detail-row, .field-row, .product-box'
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

      const coordinatorField = node.querySelector('[data-f="appointment_coordinator"]');
      if (coordinatorField) {
        const coordinatorRow = coordinatorField.closest('.info-item, .order-section, .detail-row, .field-row, .master-detail');
        if (coordinatorRow) coordinatorRow.style.display = 'none';
        else coordinatorField.style.display = 'none';
      }

      setText(
        node,
        'note',
        cleanOrderNote(firstValue(order, ['note', 'notes', 'remarks']))
      );

      const deliveryFee = deliveryFeeFromOrder(order);
      const orderTotalRaw = Number(firstValue(order, ['total', 'grand_total', 'grandTotal', 'amount'])) || 0;
      const productsTotal = Math.max(0, orderTotalRaw - deliveryFee);

      setText(
        node,
        'total',
        formatTotal(deliveryFee > 0 ? productsTotal : orderTotalRaw)
      );

      const existingFeeRow = node.querySelector('.delivery-fee-row');
      const existingGrandRow = node.querySelector('.delivery-grand-total-row');
      if (existingFeeRow) existingFeeRow.remove();
      if (existingGrandRow) existingGrandRow.remove();
      if (deliveryFee > 0) {
        const totalElement = node.querySelector('[data-f="total"]');
        const totalRow = totalElement?.closest('.info-item, .order-section, .detail-row, .field-row, .product-box');
        if (totalRow) {
          const labels = totalRow.querySelectorAll('small, label, .label, [data-label]');
          labels.forEach(label => {
            if (/الإجمالي|اجمالي/.test(label.textContent || '')) label.textContent = 'إجمالي المنتجات';
          });
          const feeRow = document.createElement('div');
          feeRow.className = 'delivery-fee-row';
          feeRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0;padding:10px 12px;border-radius:12px;background:#fff8d9;border:1px solid #facc15;color:#854d0e;font-weight:900;';
          feeRow.innerHTML = `<span>🚚 رسوم التوصيل</span><strong>${escapeHtml(formatTotal(deliveryFee))}</strong>`;
          const grandRow = document.createElement('div');
          grandRow.className = 'delivery-grand-total-row';
          grandRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0;padding:10px 12px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-weight:900;';
          grandRow.innerHTML = `<span>الإجمالي النهائي</span><strong>${escapeHtml(formatTotal(orderTotalRaw))}</strong>`;
          totalRow.parentNode.insertBefore(feeRow, totalRow.nextSibling);
          feeRow.parentNode.insertBefore(grandRow, feeRow.nextSibling);
        }
      }

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

      // Optional villa gate photo: show only when the API returns a valid URL.
      const gatePhotoUrl = safeUrl(
        firstValue(order, ['gate_photo_url', 'gatePhotoUrl'])
      );
      const oldGatePhotoButton = node.querySelector('.gate-photo-btn');
      if (oldGatePhotoButton) oldGatePhotoButton.remove();

      if (gatePhotoUrl) {
        const gatePhotoButton = document.createElement('a');
        gatePhotoButton.className = 'gate-photo-btn';
        gatePhotoButton.href = gatePhotoUrl;
        gatePhotoButton.target = '_blank';
        gatePhotoButton.rel = 'noopener noreferrer';
        gatePhotoButton.textContent = '📷 عرض صورة بوابة الفيلا';
        gatePhotoButton.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:11px 14px;border-radius:10px;background:#e8f2ff;color:#1455b8;border:1px solid #b9d4ff;text-align:center;font-weight:800;text-decoration:none;';

        const insertBefore = node.querySelector('.payment-current, .payment-buttons, .payment-options, .btn-deliver');
        if (insertBefore && insertBefore.parentNode) {
          insertBefore.parentNode.insertBefore(gatePhotoButton, insertBefore);
        } else {
          node.appendChild(gatePhotoButton);
        }
      }

      const paidInAdvance =
        isPaidInAdvance(order);

      const payment =
        normalizePayment(
          order.payment_method
        );

      const paymentSection =
        node.querySelector('.payment-section');

      if (paymentSection && paidInAdvance) {
        paymentSection.style.display = 'none';
      }

      const paymentCurrent =
        node.querySelector(
          '.payment-current'
        );

      if (paymentCurrent && !paidInAdvance) {
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
            delivered || paidInAdvance;

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

    return date.toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function masterDateInput(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  function masterPaymentText(value) {
    const payment = normalizePayment(value);

    if (payment === 'cash') {
      return 'دفع كاش';
    }

    if (payment === 'bank_transfer') {
      return 'تحويل بنكي';
    }

    return 'غير محدد';
  }

  function masterStatusText(value) {
    return isDelivered(value)
      ? 'تم التسليم'
      : 'قيد التوصيل';
  }

  function masterEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function masterInjectStyles() {
    if ($('master-runtime-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'master-runtime-style';

    style.textContent = `
      .master-page{min-height:100vh;background:linear-gradient(180deg,#f3f6fa 0%,#f8fafc 220px,#f5f7f8 100%);color:#172024;font-family:inherit}
      .master-top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 22px;background:rgba(255,255,255,.96);border-bottom:1px solid #e3e9ef;box-shadow:0 4px 18px rgba(25,42,60,.04);position:sticky;top:0;z-index:10;backdrop-filter:blur(12px)}
      .master-brand{display:flex;align-items:center;gap:12px}
      .master-logo{width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg,#172b3a,#286a58);color:#fff;display:flex;align-items:center;justify-content:center;font-size:27px;box-shadow:0 7px 16px rgba(23,43,58,.18)}
      .master-title{font-size:20px;font-weight:900}
      .master-sub{font-size:12px;color:#7b878c;margin-top:4px}
      .master-actions{display:flex;gap:8px;flex-wrap:wrap}
      .master-btn{border:0;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:800}
      .master-btn.secondary{background:#edf1f2;color:#26343a}
      .master-btn.danger{background:#ffe9e9;color:#b42318}
      .master-btn.primary{background:#172024;color:#fff}
      .master-wrap{padding:20px;max-width:1500px;margin:auto}
      .master-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:22px}
      .master-stat{position:relative;overflow:hidden;background:#fff;border:1px solid #e5ebf0;border-radius:18px;padding:18px 16px;min-height:94px;box-shadow:0 7px 22px rgba(30,49,67,.045);transition:transform .18s ease,box-shadow .18s ease}
      .master-stat:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(30,49,67,.09)}
      .master-stat:before{content:'';position:absolute;right:0;top:0;bottom:0;width:4px;background:#64748b}
      .master-stat.cash:before{background:#16a36a}.master-stat.bank:before{background:#3974d6}.master-stat.count:before{background:#64748b}.master-stat.delivered:before{background:#8b5cf6}.master-stat.pending-bank:before{background:#dc6262}.master-stat.collected:before{background:#0f8b8d}.master-stat.prepaid:before{background:#dc2626}.master-stat.prepaid .master-stat-value{color:#dc2626}.master-stat.pending-bank .master-stat-value{color:#b42318}.master-stat.collected .master-stat-value{color:#087f80}
      .master-stat-label{font-size:12px;color:#64748b;font-weight:800;margin-bottom:12px}
      .master-stat-value{font-size:22px;font-weight:900;line-height:1.35;letter-spacing:-.3px;color:#182630}
      .master-stat.cash .master-stat-value{color:#128354}.master-stat.bank .master-stat-value{color:#285fbd}
      .master-stat-hint{font-size:11px;color:#94a3b8;margin-top:5px}
      .master-filters{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;background:#fff;border:1px solid #e8edef;border-radius:16px;padding:14px;margin-bottom:18px}
      .master-filter{display:flex;flex-direction:column;gap:6px}
      .master-filter label{font-size:11px;color:#7b878c;font-weight:800}
      .master-filter input,.master-filter select{width:100%;box-sizing:border-box;border:1px solid #dfe6e8;border-radius:10px;padding:9px;background:#fff}

      .master-orders-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:12px;align-items:start;direction:rtl}
      .master-old-transfer-panel{padding:11px;border-radius:14px}
      .master-old-transfer-head{margin-bottom:8px}
      .master-old-transfer-title{font-size:12px}
      .master-old-transfer-note{font-size:10px;line-height:1.55;margin-bottom:8px}
      .master-old-transfer-stats{gap:6px;margin-bottom:9px}
      .master-old-transfer-stat{padding:7px;border-radius:9px}
      .master-old-transfer-stat-label{font-size:9px;margin-bottom:3px}
      .master-old-transfer-stat-value{font-size:14px}
      .master-old-transfer-stat-value.money{font-size:12px}
      .master-old-transfer-list{gap:7px}
      .master-old-transfer-card{padding:8px;border-radius:10px}
      .master-old-transfer-card-top{margin-bottom:5px}
      .master-old-transfer-invoice{font-size:12px}
      .master-old-transfer-customer{font-size:11px;margin-bottom:3px}
      .master-old-transfer-meta{font-size:10px;line-height:1.5}
      .master-old-transfer-amount{font-size:13px;margin:5px 0}
      .master-old-transfer-card .master-transfer-btn{min-height:32px;padding:6px 8px;font-size:10px}
      .master-old-transfer-panel{background:#fff;border:1px solid #f3c7c7;border-radius:16px;padding:14px;min-width:0;box-shadow:0 4px 18px rgba(160,30,30,.05)}
      .master-old-transfer-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
      .master-old-transfer-title{font-size:14px;font-weight:900;color:#9f2020;line-height:1.5}
      .master-old-transfer-count{background:#fff0f0;color:#9f2020;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900;white-space:nowrap}
      .master-old-transfer-note{font-size:11px;line-height:1.7;color:#8b5c5c;margin-bottom:12px}
      .master-old-transfer-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 13px}
      .master-old-transfer-stat{background:#fff5f5;border:1px solid #ffe0e0;border-radius:11px;padding:10px;min-width:0}
      .master-old-transfer-stat-label{display:block;font-size:10px;line-height:1.5;color:#8b5c5c;font-weight:800;margin-bottom:5px}
      .master-old-transfer-stat-value{display:block;font-size:16px;line-height:1.35;font-weight:900;color:#9f2020;overflow-wrap:anywhere}
      .master-old-transfer-stat-value.money{font-size:14px}
      .master-old-transfer-list{display:flex;flex-direction:column;gap:10px}
      .master-old-transfer-card{border:1px solid #ffdada;background:#fff8f8;border-radius:12px;padding:11px;min-width:0}
      .master-old-transfer-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      .master-old-transfer-invoice{font-weight:900;color:#8f1d1d}
      .master-old-transfer-age{font-size:10px;background:#ffe6c7;color:#854d0e;padding:4px 7px;border-radius:999px;white-space:nowrap}
      .master-old-transfer-customer{font-size:12px;font-weight:800;color:#24323a;overflow-wrap:anywhere;margin-bottom:5px}
      .master-old-transfer-meta{font-size:11px;line-height:1.7;color:#66747a;overflow-wrap:anywhere}
      .master-old-transfer-amount{font-size:15px;font-weight:900;color:#b42318;margin:8px 0}
      .master-old-transfer-card .master-transfer-btn{width:100%;min-height:38px}
      .master-old-transfer-empty{text-align:center;color:#718087;font-size:12px;line-height:1.8;padding:20px 8px;background:#fafbfc;border-radius:12px}

      .master-table-wrap{background:#fff;border:1px solid #e8edef;border-radius:16px;overflow:auto}
      .master-table{width:100%;border-collapse:collapse;min-width:1050px}
      .master-table th,.master-table td{padding:12px;border-bottom:1px solid #edf1f2;text-align:right;white-space:nowrap}
      .master-table th{font-size:11px;color:#718087;background:#fafbfb}
      .master-table td{font-size:12px}
      .master-table tbody tr.master-transfer-pending td{background:#fff0f0!important;color:#8f1d1d;border-bottom-color:#ffd2d2}
      .master-table tbody tr.master-transfer-received td{background:#eaf8ef!important;color:#155b32;border-bottom-color:#c8ebd2}
      .master-table tbody tr.master-transfer-pending:hover td{background:#ffe3e3!important}
      .master-table tbody tr.master-transfer-received:hover td{background:#d9f2e1!important}
      .master-badge{display:inline-flex;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:750;white-space:nowrap}
      .master-badge.paid{background:#fff0f0;color:#c62828;border:1px solid #ffc7c7;box-shadow:0 2px 7px rgba(198,40,40,.10)}
      .paid-advance-badge{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#fff1f1,#ffe2e2);color:#c62828;border:1px solid #ffb9b9;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:900;box-shadow:0 3px 10px rgba(198,40,40,.10);white-space:nowrap}
      .paid-advance-badge:before{content:'✓';display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#d92332;color:#fff;font-size:10px}
      .master-badge.ok{background:#e8f7ee;color:#16723b}
      .master-badge.pending{background:#fff5dc;color:#8a5a00}
      .master-badge.cash{background:#e9f7ed;color:#1d6e3b}
      .master-badge.bank{background:#e9f0ff;color:#315b9a}.master-badge.advance{background:#fff0f0;color:#c62828;border:1px solid #ffc7c7;box-shadow:0 2px 7px rgba(198,40,40,.10)}
      .master-view{border:0;background:#172024;color:#fff;border-radius:9px;padding:8px 11px;cursor:pointer;font-weight:700}
      .master-transfer-btn{border:0;border-radius:9px;padding:8px 10px;cursor:pointer;font-weight:800;font-size:11px;white-space:nowrap;background:#e8f7ee;color:#16723b}.master-transfer-btn.pending{background:#fff2d6;color:#8a5a00}.master-transfer-btn:disabled{opacity:.6;cursor:wait}.master-transfer-state{display:inline-flex;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:800;white-space:nowrap}.master-transfer-state.received{background:#e8f7ee;color:#16723b}.master-transfer-state.waiting{background:#fff2d6;color:#8a5a00}
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
      .master-actions-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      .master-edit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .master-edit-form label{display:flex;flex-direction:column;gap:6px;font-weight:800;font-size:12px;color:#39484e}
      .master-edit-form input,.master-edit-form textarea,.master-edit-form select{width:100%;box-sizing:border-box;border:1px solid #dfe6e8;border-radius:10px;padding:10px;font:inherit;background:#fff;color:#172024}
      .master-edit-form textarea{min-height:82px;resize:vertical}
      .master-edit-full{display:flex;flex-direction:column;gap:6px;margin-top:12px}
      .master-month-note{font-size:11px;color:#7b878c;margin-top:8px}
      @media(max-width:1200px){.master-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.master-filters{grid-template-columns:repeat(3,minmax(0,1fr))}.master-orders-layout{grid-template-columns:270px minmax(0,1fr)}}
      @media(max-width:900px){.master-orders-layout{grid-template-columns:minmax(0,1fr);gap:10px}.master-old-transfer-panel{order:0;padding:10px}.master-table-wrap{order:1}}
      @media(max-width:650px){.master-old-transfer-panel{padding:9px;border-radius:12px}.master-old-transfer-title{font-size:12px}.master-old-transfer-card{padding:8px}.master-old-transfer-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.master-old-transfer-stat{padding:7px}.master-old-transfer-stat-label{font-size:9px}.master-old-transfer-stat-value{font-size:14px}.master-old-transfer-note{font-size:10px;margin-bottom:7px}.master-old-transfer-list{gap:6px}.master-old-transfer-card .master-transfer-btn{min-height:34px;font-size:10px}.master-old-transfer-stat{padding:9px}.master-old-transfer-stat-value{font-size:15px}.master-old-transfer-stat-value.money{font-size:13px}.master-orders-layout{gap:12px}.master-top{align-items:flex-start;padding:12px;gap:10px;flex-wrap:wrap}.master-brand{gap:9px}.master-logo{width:42px;height:42px;border-radius:13px;font-size:23px}.master-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.master-wrap{padding:10px}.master-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.master-stat{padding:12px 10px;min-height:88px;border-radius:13px}.master-stat-label{font-size:11px;margin-bottom:8px}.master-stat-value{font-size:16px;overflow-wrap:anywhere}.master-stat-hint{font-size:10px;line-height:1.5}.master-filters{grid-template-columns:1fr 1fr;padding:10px;gap:8px}.master-filter input,.master-filter select{font-size:16px;min-height:42px}.master-table-wrap{border-radius:12px}.master-table{min-width:1000px}.master-detail-grid{grid-template-columns:1fr}.master-edit-grid{grid-template-columns:1fr}.master-title{font-size:16px;line-height:1.4}.master-sub{font-size:11px}.master-btn{padding:10px 9px;min-height:42px}.master-modal{padding:8px}.master-modal-card{max-height:94vh;border-radius:15px}.master-modal-body{padding:12px}}
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
            <div class="master-stat prepaid"><div class="master-stat-label">مدفوع مقدم</div><div class="master-stat-value" id="master-total-prepaid">0 درهم</div><div class="master-stat-hint" id="master-prepaid-hint">عدد الفواتير: ٠</div></div>
            <div class="master-stat count"><div class="master-stat-label">إجمالي الفواتير</div><div class="master-stat-value" id="master-total-count">0</div><div class="master-stat-hint">عدد الفواتير بدون تكرار</div></div>
            <div class="master-stat cash"><div class="master-stat-label">فواتير الكاش</div><div class="master-stat-value" id="master-cash-count">0</div><div class="master-stat-hint">عدد الفواتير</div></div>
            <div class="master-stat cash"><div class="master-stat-label">إجمالي الكاش</div><div class="master-stat-value" id="master-total-cash">0 درهم</div><div class="master-stat-hint">إجمالي الفواتير المسجلة كاش</div></div>
            <div class="master-stat bank"><div class="master-stat-label">فواتير التحويل البنكي</div><div class="master-stat-value" id="master-bank-count">0</div><div class="master-stat-hint">عدد الفواتير</div></div>
            <div class="master-stat bank"><div class="master-stat-label">إجمالي التحويلات</div><div class="master-stat-value" id="master-bank-all">0 درهم</div><div class="master-stat-hint">قيمة جميع فواتير التحويل البنكي</div></div>
            <div class="master-stat bank"><div class="master-stat-label">التحويلات المستلمة</div><div class="master-stat-value" id="master-total-bank">0 درهم</div><div class="master-stat-hint">المبالغ المؤكد وصولها فقط</div></div>
            <div class="master-stat pending-bank"><div class="master-stat-label">المتبقي من التحويلات</div><div class="master-stat-value" id="master-bank-pending">0 درهم</div><div class="master-stat-hint">تحويلات لم يتم تأكيد استلامها</div></div>
            <div class="master-stat collected"><div class="master-stat-label">إجمالي المبالغ المسجلة/المستلمة</div><div class="master-stat-value" id="master-total-received">0 درهم</div><div class="master-stat-hint">الكاش المسجل + التحويلات المؤكدة</div></div>
            <div class="master-stat delivered"><div class="master-stat-label">تم التسليم</div><div class="master-stat-value" id="master-delivered">0</div><div class="master-stat-hint">عدد الفواتير المسلّمة</div></div>
          </section>

          <section class="master-filters">
            <div class="master-filter">
              <label>رقم الفاتورة</label>
              <input id="master-search-number" type="text" placeholder="ابحث برقم الفاتورة">
            </div>

            <div class="master-filter">
              <label>اسم العميل</label>
              <input id="master-search-name" type="text" placeholder="اسم العميل">
            </div>

            <div class="master-filter">
              <label>رقم الهاتف</label>
              <input id="master-search-phone" type="text" placeholder="رقم الهاتف">
            </div>

            <div class="master-filter">
              <label>التاريخ</label>
              <input id="master-search-date" type="date">
            </div>

            <div class="master-filter">
              <label>المندوب</label>
              <select id="master-filter-driver">
                <option value="">الكل</option>
                <option value="Mandoub">مندوب 1</option>
                <option value="Mandoub2">مندوب 2</option>
              </select>
            </div>

            <div class="master-filter">
              <label>حالة التسليم</label>
              <select id="master-filter-status">
                <option value="">الكل</option>
                <option value="pending">قيد التوصيل</option>
                <option value="delivered">تم التسليم</option>
              </select>
            </div>
          </section>

          <div class="master-orders-layout">
            <aside class="master-old-transfer-panel" id="master-old-transfer-panel" aria-label="التحويلات القديمة غير المستلمة">
              <div class="master-old-transfer-head">
                <div class="master-old-transfer-title">تحويلات الأيام السابقة غير المستلمة</div>
                <span class="master-old-transfer-count" id="master-old-transfer-count">٠</span>
              </div>
              <div class="master-old-transfer-note">تظهر هنا فواتير التحويل البنكي من الأيام السابقة التي لم يتم تأكيد استلامها. فواتير اليوم تظل في الجدول الرئيسي.</div>
              <div class="master-old-transfer-stats" aria-label="إحصائيات التحويلات القديمة">
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">عدد التحويلات المعلقة</span><strong class="master-old-transfer-stat-value" id="master-old-transfer-stat-count">٠</strong></div>
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">إجمالي المبالغ غير المستلمة</span><strong class="master-old-transfer-stat-value money" id="master-old-transfer-stat-total">٠ درهم</strong></div>
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">فواتير أمس</span><strong class="master-old-transfer-stat-value" id="master-old-transfer-stat-yesterday">٠</strong></div>
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">فواتير أول أمس والأقدم</span><strong class="master-old-transfer-stat-value" id="master-old-transfer-stat-older">٠</strong></div>
              </div>
              <div class="master-old-transfer-list" id="master-old-transfer-list">
                <div class="master-old-transfer-empty">جاري تحميل التحويلات…</div>
              </div>
            </aside>
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
                  <th>استلام التحويل</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                  <th>عرض</th>
                </tr>
              </thead>
              <tbody id="master-orders-body"></tbody>
            </table>
            </section>
          </div>
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
      body.innerHTML = '<tr><td colspan="11" class="master-empty">جارٍ تحميل الفواتير…</td></tr>';
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
        body.innerHTML = `<tr><td colspan="11" class="master-empty">${masterEscape(error.message)}</td></tr>`;
      }
    }
  }

  function masterNormalizeDuplicateValue(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/\s+/g, ' ');
  }

  function masterInvoiceFingerprint(order) {
    const invoiceNumber = masterNormalizeDuplicateValue(
      order.order_number ?? order.invoice_number ?? order.invoice_no ?? ''
    );

    const fields = [
      invoiceNumber,
      order.customer_name,
      order.emirate,
      order.area,
      order.chicken_weights,
      order.chicken_qtys,
      order.plate_names,
      order.plate_qtys,
      order.order_details,
      masterMoney(order.total),
      order.appointment_coordinator,
      order.note
    ];

    return fields.map(masterNormalizeDuplicateValue).join('|');
  }

  function getMasterUniqueOrders() {
    const unique = [];
    const byFingerprint = new Map();

    state.masterOrders.forEach((order) => {
      const fingerprint = masterInvoiceFingerprint(order);
      const existing = byFingerprint.get(fingerprint);

      if (!existing) {
        byFingerprint.set(fingerprint, order);
        unique.push(order);
        return;
      }

      const existingIsDriverOne = String(existing.sheet_name || '') === 'Mandoub';
      const currentIsDriverOne = String(order.sheet_name || '') === 'Mandoub';
      const existingIsDriverTwo = String(existing.sheet_name || '') === 'Mandoub2';
      const currentIsDriverTwo = String(order.sheet_name || '') === 'Mandoub2';

      let preferred = existing;
      let secondary = order;

      if (currentIsDriverOne && !existingIsDriverOne) {
        preferred = order;
        secondary = existing;
        const index = unique.indexOf(existing);
        if (index !== -1) unique[index] = order;
        byFingerprint.set(fingerprint, order);
      }

      if (!String(preferred.phone || '').trim()) {
        const phoneSource = [preferred, secondary].find((item) =>
          String(item.phone || '').trim()
        );
        if (phoneSource) preferred.phone = phoneSource.phone;
      }

      if (isDelivered(secondary.delivery_status)) {
        preferred.delivery_status = secondary.delivery_status;
      }

      if (secondary.bank_transfer_received === true) {
        preferred.bank_transfer_received = true;
      }

      // احتفظ بعلامة الدفع المقدم إذا كانت موجودة في أي نسخة مكررة للفاتورة.
      if (isPaidInAdvance(secondary)) {
        preferred.paid_in_advance = true;
      }

      if (!normalizePayment(preferred.payment_method) && normalizePayment(secondary.payment_method)) {
        preferred.payment_method = secondary.payment_method;
      }

      if (!String(preferred.location_url || '').trim() && secondary.location_url) {
        preferred.location_url = secondary.location_url;
      }
    });

    return unique;
  }

  function getMasterFilteredOrders() {
    const number = String($('master-search-number')?.value || '').trim().toLowerCase();
    const name = String($('master-search-name')?.value || '').trim().toLowerCase();
    const phone = String($('master-search-phone')?.value || '').trim().toLowerCase();
    const date = String($('master-search-date')?.value || '').trim();
    const driver = String($('master-filter-driver')?.value || '').trim();
    const status = String($('master-filter-status')?.value || '').trim();

    const hasExplicitSearch = Boolean(number || name || phone || date || driver || status);
    const today = masterDateInput(new Date());

    return getMasterUniqueOrders().filter((order) => {
      const orderNumber = String(order.order_number ?? order.id ?? '').toLowerCase();
      const customerName = String(order.customer_name ?? '').toLowerCase();
      const customerPhone = String(order.phone ?? '').toLowerCase();

      // العرض الافتراضي: فواتير اليوم كلها، ومعها الفواتير القديمة غير المسلّمة
      // والتحويلات البنكية التي لم يتم تأكيد استلامها. البحث بالتاريخ يعرض الأرشيف كاملًا.
      if (!hasExplicitSearch) {
        const orderDate = masterDateInput(order.created_at);
        const delivered = isDelivered(order.delivery_status);
        const transferPending =
          !isPaidInAdvance(order) &&
          normalizePayment(order.payment_method) === 'bank_transfer' &&
          order.bank_transfer_received !== true;

        // الفواتير القديمة ذات التحويل البنكي غير المستلم تُعرض في لوحة مستقلة على اليمين.
        // فواتير اليوم تظل في الجدول الرئيسي، وكذلك الفواتير القديمة غير المسلّمة التي ليست تحويلًا معلقًا.
        if (orderDate !== today && transferPending) {
          return false;
        }

        if (orderDate !== today && delivered && !transferPending) {
          return false;
        }
      }

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
    // اجعل بطاقات الملخص تتبع نفس الفواتير الظاهرة في الجدول:
    // العرض الافتراضي يعرض فواتير اليوم والطلبات القديمة التي ما زالت معلقة،
    // والبحث بالتاريخ يعرض فواتير التاريخ المختار فقط.
    const orders = getMasterFilteredOrders();

    const prepaidOrders = orders.filter((order) => isPaidInAdvance(order));
    const cashOrders = orders.filter((order) => !isPaidInAdvance(order) && normalizePayment(order.payment_method) === 'cash');
    const bankOrders = orders.filter((order) => !isPaidInAdvance(order) && normalizePayment(order.payment_method) === 'bank_transfer');

    // المدفوع مقدمًا فئة مستقلة، وتُضاف قيمتها إلى الإجمالي العام دون احتسابها كاش أو تحويل بنكي.
    const totalPrepaid = prepaidOrders.reduce((sum, order) => sum + masterMoney(order.total), 0);
    // الكاش هنا هو إجمالي الفواتير المسجلة بطريقة دفع كاش.
    // لا يوجد في البيانات الحالية حقل مستقل يؤكد تحصيل كل فاتورة كاش.
    const totalCash = cashOrders.reduce((sum, order) => sum + masterMoney(order.total), 0);
    const totalBankAll = bankOrders.reduce((sum, order) => sum + masterMoney(order.total), 0);
    const receivedBankOrders = bankOrders.filter((order) => order.bank_transfer_received === true);
    const totalBankReceived = receivedBankOrders.reduce((sum, order) => sum + masterMoney(order.total), 0);
    const totalBankPending = Math.max(0, totalBankAll - totalBankReceived);
    const totalReceived = totalCash + totalBankReceived + totalPrepaid;

    const delivered = orders.filter(
      (order) => isDelivered(order.delivery_status)
    ).length;

    const moneyText = (value) =>
      `${value.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} درهم`;

    if ($('master-total-prepaid')) {
      $('master-total-prepaid').textContent = moneyText(totalPrepaid);
    }

    if ($('master-prepaid-hint')) {
      $('master-prepaid-hint').textContent = `عدد الفواتير: ${prepaidOrders.length.toLocaleString('ar-EG')}`;
    }

    if ($('master-total-count')) {
      $('master-total-count').textContent = orders.length.toLocaleString('ar-EG');
    }

    if ($('master-cash-count')) {
      $('master-cash-count').textContent = cashOrders.length.toLocaleString('ar-EG');
    }

    if ($('master-bank-count')) {
      $('master-bank-count').textContent = bankOrders.length.toLocaleString('ar-EG');
    }

    if ($('master-total-cash')) {
      $('master-total-cash').textContent = moneyText(totalCash);
    }

    if ($('master-bank-all')) {
      $('master-bank-all').textContent = moneyText(totalBankAll);
    }

    if ($('master-total-bank')) {
      $('master-total-bank').textContent = moneyText(totalBankReceived);
    }

    if ($('master-bank-pending')) {
      $('master-bank-pending').textContent = moneyText(totalBankPending);
    }

    if ($('master-total-received')) {
      $('master-total-received').textContent = moneyText(totalReceived);
    }

    if ($('master-delivered')) {
      $('master-delivered').textContent = delivered.toLocaleString('ar-EG');
    }
  }

  function getMasterOldPendingTransfers() {
    const today = masterDateInput(new Date());
    return getMasterUniqueOrders()
      .filter((order) =>
        !isPaidInAdvance(order) &&
        normalizePayment(order.payment_method) === 'bank_transfer' &&
        order.bank_transfer_received !== true &&
        masterDateInput(order.created_at) !== '' &&
        masterDateInput(order.created_at) < today
      )
      .sort((a, b) => {
        const da = masterDateInput(a.created_at);
        const db = masterDateInput(b.created_at);
        return da.localeCompare(db) || String(a.order_number || a.id || '').localeCompare(String(b.order_number || b.id || ''));
      });
  }

  function renderMasterOldPendingTransfers() {
    const list = $('master-old-transfer-list');
    const count = $('master-old-transfer-count');
    if (!list) return;

    const orders = getMasterOldPendingTransfers();
    const today = masterDateInput(new Date());
    const yesterdayDate = new Date(`${today}T12:00:00`);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = masterDateInput(yesterdayDate);
    const yesterdayOrders = orders.filter((order) => masterDateInput(order.created_at) === yesterday);
    const olderOrders = orders.filter((order) => masterDateInput(order.created_at) < yesterday);
    const totalPendingAmount = orders.reduce((sum, order) => sum + masterMoney(order.total), 0);
    const moneyText = (value) => `${value.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} درهم`;

    if (count) count.textContent = orders.length.toLocaleString('ar-EG');
    if ($('master-old-transfer-stat-count')) $('master-old-transfer-stat-count').textContent = orders.length.toLocaleString('ar-EG');
    if ($('master-old-transfer-stat-total')) $('master-old-transfer-stat-total').textContent = moneyText(totalPendingAmount);
    if ($('master-old-transfer-stat-yesterday')) $('master-old-transfer-stat-yesterday').textContent = yesterdayOrders.length.toLocaleString('ar-EG');
    if ($('master-old-transfer-stat-older')) $('master-old-transfer-stat-older').textContent = olderOrders.length.toLocaleString('ar-EG');

    if (!orders.length) {
      list.innerHTML = '<div class="master-old-transfer-empty">لا توجد تحويلات قديمة معلّقة حاليًا.</div>';
      return;
    }

    list.innerHTML = '';
    orders.forEach((order) => {
      const card = document.createElement('article');
      card.className = 'master-old-transfer-card';
      const ageDays = Math.max(1, Math.floor((new Date(`${masterDateInput(new Date())}T12:00:00`).getTime() - new Date(`${masterDateInput(order.created_at)}T12:00:00`).getTime()) / 86400000));
      const ageLabel = ageDays === 1 ? 'أمس' : ageDays === 2 ? 'أول أمس' : `منذ ${ageDays} يوم`;
      card.innerHTML = `
        <div class="master-old-transfer-card-top">
          <span class="master-old-transfer-invoice">#${masterEscape(order.order_number ?? order.id ?? '')}</span>
          <span class="master-old-transfer-age">${ageLabel}</span>
        </div>
        <div class="master-old-transfer-customer">${masterEscape(order.customer_name || '—')}</div>
        <div class="master-old-transfer-meta">${masterEscape(order.phone || '—')}</div>
        <div class="master-old-transfer-meta">${masterEscape([order.emirate, order.area].filter(Boolean).join(' / ') || '—')}</div>
        <div class="master-old-transfer-meta">تاريخ الفاتورة: ${masterEscape(masterDate(order.created_at))}</div>
        <div class="master-old-transfer-amount">${masterEscape(formatTotal(order.total))}</div>
        <button class="master-transfer-btn pending" data-old-transfer="${masterEscape(order.id)}">تأكيد استلام التحويل</button>
      `;
      const button = card.querySelector('[data-old-transfer]');
      if (button) button.addEventListener('click', () => setMasterTransferReceived(order, true, button));
      list.appendChild(card);
    });
  }

  function renderMasterOrders() {
    const body = $('master-orders-body');

    if (!body) {
      return;
    }

    const orders = getMasterFilteredOrders();

    renderMasterOldPendingTransfers();
    renderMasterStats();

    if (!orders.length) {
      body.innerHTML =
        '<tr><td colspan="11" class="master-empty">لا توجد فواتير مطابقة للبحث.</td></tr>';

      return;
    }

    body.innerHTML = '';

    orders.forEach((order) => {
      const payment =
        normalizePayment(order.payment_method);
      const paidInAdvance = isPaidInAdvance(order);

      const delivered =
        isDelivered(order.delivery_status);

      const tr =
        document.createElement('tr');

      if (!paidInAdvance && payment === 'bank_transfer') {
        tr.classList.add(order.bank_transfer_received === true
          ? 'master-transfer-received'
          : 'master-transfer-pending');
      }

      tr.innerHTML = `
        <td>
          <strong>
            #${masterEscape(
              order.order_number ?? order.id ?? ''
            )}
          </strong>
        </td>

        <td>
          ${masterEscape(
            order.customer_name || '—'
          )}
        </td>

        <td>
          ${masterEscape(
            order.phone || '—'
          )}
        </td>

        <td>
          ${masterEscape(
            [
              order.emirate,
              order.area
            ]
              .filter(Boolean)
              .join(' / ') || '—'
          )}
        </td>
                <td>
          ${masterEscape(
            masterDriver(order)
          )}
        </td>

        <td>
          ${deliveryFeeFromOrder(order) > 0 ? `<div style="font-size:11px;color:#64748b">إجمالي المنتجات: ${masterEscape(formatTotal((Number(order.total)||0)-deliveryFeeFromOrder(order)))}</div><div style="margin-top:5px;color:#a16207;font-size:11px;font-weight:900;background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:5px 7px">🚚 رسوم التوصيل: ${masterEscape(formatTotal(deliveryFeeFromOrder(order)))}</div><strong style="display:block;margin-top:5px;color:#1d4ed8">الإجمالي النهائي: ${masterEscape(formatTotal(order.total))}</strong>` : `<strong>${formatTotal(order.total)}</strong>`}
        </td>

        <td>
          <span class="master-badge ${
            paidInAdvance
              ? 'advance'
              : payment === 'cash'
                ? 'cash'
                : payment === 'bank_transfer'
                  ? 'bank'
                  : ''
          }">
            ${masterEscape(
              paidInAdvance
                ? 'مدفوع'
                : masterPaymentText(order.payment_method)
            )}
          </span>
        </td>

        <td>
          ${!paidInAdvance && payment === 'bank_transfer'
            ? (order.bank_transfer_received === true
              ? '<span class="master-transfer-state received">✓ تم الاستلام</span>'
              : `<button class="master-transfer-btn pending" data-master-transfer="${masterEscape(order.id)}">تأكيد الاستلام</button>`)
            : '<span class="master-transfer-state">—</span>'}
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
            masterDate(order.created_at)
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
          () => openMasterOrder(order)
        );
      }

      const transferButton = tr.querySelector('[data-master-transfer]');
      if (transferButton) {
        transferButton.addEventListener('click', () => setMasterTransferReceived(order, true, transferButton));
      }

      body.appendChild(tr);
    });
  }

  async function setMasterTransferReceived(order, received, button) {
    if (isPaidInAdvance(order) || normalizePayment(order.payment_method) !== 'bank_transfer') {
      toast('تأكيد الاستلام متاح لفواتير التحويل البنكي فقط', true);
      return;
    }

    if (order.bank_transfer_received === received) {
      return;
    }

    const confirmed = window.confirm(
      received
        ? `تأكيد استلام التحويل البنكي للفاتورة #${order.order_number ?? order.id ?? ''}؟

بعد التأكيد سيُضاف المبلغ إلى إجمالي التحويلات المستلمة.`
        : `إلغاء تأكيد استلام التحويل للفاتورة #${order.order_number ?? order.id ?? ''}؟`
    );

    if (!confirmed) return;

    if (button) {
      button.disabled = true;
      button.textContent = 'جارٍ الحفظ…';
    }

    const fingerprint = masterInvoiceFingerprint(order);
    const matchingOrders = state.masterOrders.filter((item) =>
      masterInvoiceFingerprint(item) === fingerprint &&
      !isPaidInAdvance(item) &&
      normalizePayment(item.payment_method) === 'bank_transfer'
    );
    const targets = matchingOrders.length ? matchingOrders : [order];

    try {
      for (const item of targets) {
        await masterFetch('/api/master/transfer-received', {
          method: 'POST',
          body: JSON.stringify({ orderId: item.id, received })
        });
        item.bank_transfer_received = received;
      }

      order.bank_transfer_received = received;
      renderMasterOrders();
      toast(received ? 'تم تأكيد استلام التحويل وتحديث الإجمالي ✅' : 'تم إلغاء تأكيد استلام التحويل');
    } catch (error) {
      if (error.message !== 'expired') {
        toast(error.message || 'تعذر حفظ تأكيد الاستلام', true);
      }
      if (button) {
        button.disabled = false;
        button.textContent = 'تأكيد الاستلام';
      }
      await loadMasterOrders();
    }
  }

  function openMasterOrder(order) {
    const modal =
      $('master-modal');

    const body =
      $('master-modal-body');

    const title =
      $('master-modal-title');

    if (!modal || !body) {
      return;
    }

    const chickenWeights =
      order.chicken_weights || '';

    const chickenQtys =
      order.chicken_qtys || '';

    const plateNames =
      order.plate_names || '';

    const plateQtys =
      order.plate_qtys || '';

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
              order.customer_name || '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>الهاتف</small>
          <strong>
            ${masterEscape(
              order.phone || '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>الإمارة</small>
          <strong>
            ${masterEscape(
              order.emirate || '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>المنطقة</small>
          <strong>
            ${masterEscape(
              order.area || '—'
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>المندوب</small>
          <strong>
            ${masterEscape(
              masterDriver(order)
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>التاريخ</small>
          <strong>
            ${masterEscape(
              masterDate(order.created_at)
            )}
          </strong>
        </div>

        <div class="master-detail">
          <small>${deliveryFeeFromOrder(order) > 0 ? 'إجمالي المنتجات' : 'الإجمالي'}</small>
          <strong>
            ${masterEscape(formatTotal((Number(order.total)||0)-deliveryFeeFromOrder(order)))}
          </strong>
        </div>

        ${deliveryFeeFromOrder(order) > 0 ? `
        <div class="master-detail" style="border:1px solid #facc15;background:#fef9c3">
          <small style="color:#854d0e">🚚 رسوم التوصيل</small>
          <strong style="color:#a16207">${masterEscape(formatTotal(deliveryFeeFromOrder(order)))}</strong>
        </div>
        <div class="master-detail" style="border:1px solid #bfdbfe;background:#eff6ff">
          <small style="color:#1d4ed8">الإجمالي النهائي</small>
          <strong style="color:#1d4ed8">${masterEscape(formatTotal(order.total))}</strong>
        </div>` : ''}

        ${isPaidInAdvance(order) ? '' : `
        <div class="master-detail">
          <small>طريقة الدفع</small>
          <strong>
            ${masterEscape(masterPaymentText(order.payment_method))}
          </strong>
        </div>
        `}

        <div class="master-detail">
          <small>حالة الدفع</small>
          <strong>
            ${masterEscape((isPaidInAdvance(order)) ? 'مدفوع' : '—')}
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

      </div>

      <div class="master-section">
        <div class="master-section-title">
          🍗 الدجاج الكامل — الأوزان
        </div>

        <div class="master-section-content">
          ${masterEscape(
            chickenWeights || '—'
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📦 الدجاج الكامل — الكمية
        </div>

        <div class="master-section-content">
          ${masterEscape(
            chickenQtys || '—'
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          🍽️ المقطعات — الأصناف
        </div>

        <div class="master-section-content">
          ${masterEscape(
            plateNames || '—'
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📦 المقطعات — الكمية
        </div>

        <div class="master-section-content">
          ${masterEscape(
            plateQtys || '—'
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📝 تفاصيل الطلب
        </div>

        <div class="master-section-content">
          ${masterEscape(
            order.order_details || '—'
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📌 الملاحظات
        </div>

        <div class="master-section-content">
          ${masterEscape(
            cleanOrderNote(order.note || order.notes || '—')
          )}
        </div>
      </div>

      <div class="master-section">
        <div class="master-section-title">
          📍 الموقع
        </div>

        <div class="master-section-content">
          ${
            safeUrl(order.location_url)
              ? `
                <a
                  href="${masterEscape(
                    safeUrl(order.location_url)
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
      () => openMasterEdit(order)
    );

    $('master-delete-order-btn')?.addEventListener(
      'click',
      () => deleteMasterOrder(order)
    );

    modal.classList.add('open');
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
                order.customer_name || ''
              )}"
            >
          </label>

          <label>
            رقم الهاتف
            <input
              id="master-edit-phone"
              type="text"
              value="${masterEscape(
                order.phone || ''
              )}"
            >
          </label>

          <label>
            الإمارة
            <input
              id="master-edit-emirate"
              type="text"
              value="${masterEscape(
                order.emirate || ''
              )}"
            >
          </label>

          <label>
            المنطقة
            <input
              id="master-edit-area"
              type="text"
              value="${masterEscape(
                order.area || ''
              )}"
            >
          </label>

          <label>
            أوزان الدجاج الكامل
            <input
              id="master-edit-chicken-weights"
              type="text"
              value="${masterEscape(
                order.chicken_weights || ''
              )}"
            >
          </label>

          <label>
            كميات الدجاج الكامل
            <input
              id="master-edit-chicken-qtys"
              type="text"
              value="${masterEscape(
                order.chicken_qtys || ''
              )}"
            >
          </label>

          <label>
            أصناف المقطعات
            <input
              id="master-edit-plate-names"
              type="text"
              value="${masterEscape(
                order.plate_names || ''
              )}"
            >
          </label>

          <label>
            كميات المقطعات
            <input
              id="master-edit-plate-qtys"
              type="text"
              value="${masterEscape(
                order.plate_qtys || ''
              )}"
            >
          </label>

          <label>
            الإجمالي
            <input
              id="master-edit-total"
              type="text"
              value="${masterEscape(
                order.total || ''
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
                  ) === 'bank_transfer'
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
                order.location_url || ''
              )}"
            >
          </label>
        </div>

        <div class="master-edit-full">
          <label>
            تفاصيل الطلب
            <textarea id="master-edit-details">${masterEscape(
              order.order_details || ''
            )}</textarea>
          </label>
        </div>

        <div class="master-edit-full">
          <label>
            الملاحظات
            <textarea id="master-edit-note">${masterEscape(
              order.note || ''
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
      () => saveMasterOrder(order)
    );

    $('master-cancel-edit')?.addEventListener(
      'click',
      () => openMasterOrder(order)
    );
  }

  async function saveMasterOrder(order) {
    const button =
      $('master-save-edit');

    if (button) {
      button.disabled = true;
      button.textContent =
        'جارٍ الحفظ…';
    }

    const updatedOrder = {
      customer_name:
        $('master-edit-customer')?.value || '',

      phone:
        $('master-edit-phone')?.value || '',

      emirate:
        $('master-edit-emirate')?.value || '',

      area:
        $('master-edit-area')?.value || '',

      chicken_weights:
        $('master-edit-chicken-weights')?.value || '',

      chicken_qtys:
        $('master-edit-chicken-qtys')?.value || '',

      plate_names:
        $('master-edit-plate-names')?.value || '',

      plate_qtys:
        $('master-edit-plate-qtys')?.value || '',

      total:
        $('master-edit-total')?.value || '',

      location_url:
        $('master-edit-location')?.value || '',

      order_details:
        $('master-edit-details')?.value || '',

      note:
        $('master-edit-note')?.value || '',

      payment_method:
        $('master-edit-payment')?.value || '',

      delivery_status:
        $('master-edit-status')?.value || 'pending'
    };

    try {
      const data =
        await masterFetch(
          '/api/master/order/update',
          {
            method: 'POST',
            body: JSON.stringify({
              orderId: order.id,
              order: updatedOrder
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
          typeof saved === 'object'
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

      openMasterOrder(current);
      renderMasterOrders();

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

      if (button) {
        button.disabled = false;
        button.textContent =
          '💾 حفظ التعديل';
      }
    }
  }

  async function deleteMasterOrder(order) {
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
        button.disabled = true;
        button.textContent =
          'جارٍ الحذف…';
      }

      await masterFetch(
        '/api/master/order/delete',
        {
          method: 'POST',
          body: JSON.stringify({
            orderId: order.id
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
        error.message === 'expired'
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

  function masterLogout(message = '') {
    saveMasterSession(null);

    state.masterOrders = [];
    state.role = '';

    window.location.reload();

    if (message) {
      setTimeout(
        () => showLogin(message),
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

              if (!response.ok) {
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

              if (passwordInput) {
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

              state.role =
                'driver';

              const passwordInput =
                $('password');

              if (passwordInput) {
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
      saveSession(session);

      state.role =
        'driver';

      showOrders();

    } else {
      showLogin();
    }
  }

  boot();
})();
