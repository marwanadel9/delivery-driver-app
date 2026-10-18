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

  const toEnglishDigits = (value) => String(value ?? '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
  });

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
      return toEnglishDigits(text);
    }

    return `${number.toLocaleString('ar-EG-u-nu-latn', {
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

    const requestController = new AbortController();
    const requestTimeout = setTimeout(() => requestController.abort(), 30000);
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers,
        signal: requestController.signal
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('الاتصال تأخر أكثر من اللازم. لم يتم تغيير بيانات الطلب؛ تحقق من الإنترنت ثم أعد المحاولة.');
      }
      throw error;
    } finally {
      clearTimeout(requestTimeout);
    }

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
    return toEnglishDigits(value)
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
          'ar-EG-u-nu-latn'
        );
    }

    if (doneElement) {
      doneElement.textContent =
        done.toLocaleString(
          'ar-EG-u-nu-latn'
        );
    }

    if (counterElement) {
      const shown =
        getFilteredOrders().length;

      counterElement.textContent =
        shown.toLocaleString(
          'ar-EG-u-nu-latn'
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

    element.textContent = toEnglishDigits(text);
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
    return normalizeArabicDigits(value)
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

  function ensureCompactDriverInvoiceStyles() {
    if ($('compact-driver-invoice-styles')) return;
    const style = document.createElement('style');
    style.id = 'compact-driver-invoice-styles';
    style.textContent = `
      /* العرض الخارجي مختصر؛ كل عناصر التحكم لا تظهر ولا تستجيب خارج الفاتورة المفتوحة. */
      .order-card.is-compact .products-section,
      .order-card.is-compact .order-details,
      .order-card.is-compact .payment-section,
      .order-card.is-compact .gate-photo-box,
      .order-card.is-compact .gate-photo-btn,
      .order-card.is-compact .delivery-fee-row,
      .order-card.is-compact .delivery-grand-total-row,
      .order-card.is-compact .driver-departure-box,
      .order-card.is-compact .order-actions,
      .order-card.is-compact .invoice-expand-toggle,
      .order-card.is-compact button,
      .order-card.is-compact a,
      .order-card.is-compact input,
      .order-card.is-compact select,
      .order-card.is-compact textarea,
      .order-card.is-compact label,
      .order-card.is-compact [role="button"],
      .order-card.is-compact [onclick] { display:none!important; pointer-events:none!important; }
      .order-card.is-compact { padding:9px!important; gap:5px!important; cursor:pointer!important; }
      .order-card.is-compact .order-card-head { margin:0!important; gap:4px!important; }
      .order-card.is-compact .customer-row { margin:0!important; padding:2px 0!important; gap:6px!important; }
      .order-card.is-compact .customer-location-grid { margin-top:3px!important; gap:4px!important; }
      .order-card.is-compact .info-item { padding:5px 7px!important; gap:2px!important; }
      .order-card.is-compact .info-item strong { line-height:1.3!important; }
      .order-card.is-compact .order-total { margin-top:4px!important; padding:7px 9px!important; }
      .order-card .invoice-expand-toggle { display:flex;align-items:center;justify-content:center;gap:6px;width:100%;box-sizing:border-box;margin:8px 0;padding:8px 10px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;color:#166534;font-family:inherit;font-size:12px;font-weight:800;cursor:pointer; }
      .order-card:not(.is-compact) .invoice-expand-toggle { background:#ecfdf5; }
      html.driver-invoice-open, body.driver-invoice-open { overflow:hidden!important; overscroll-behavior:none!important; }
      .order-card.is-fullscreen-invoice { position:fixed!important; top:env(safe-area-inset-top, 0px)!important; bottom:env(safe-area-inset-bottom, 0px)!important; left:6px!important; right:6px!important; z-index:2147483000!important; width:calc(100vw - 12px)!important; max-width:none!important; height:auto!important; min-height:0!important; max-height:none!important; margin:0 auto!important; padding:7px 8px 8px!important; box-sizing:border-box!important; overflow-y:auto!important; overflow-x:hidden!important; overscroll-behavior:contain!important; border:1px solid #dcfce7!important; border-radius:12px!important; background:#fff!important; box-shadow:0 0 0 100vmax rgba(15,23,42,.55)!important; display:flex!important; flex-direction:column!important; gap:5px!important; cursor:default!important; }
      .order-card.is-fullscreen-invoice .order-card-head { margin:0!important; gap:5px!important; }
      .order-card.is-fullscreen-invoice .customer-row { margin:0!important; padding:4px 0!important; gap:7px!important; }
      .order-card.is-fullscreen-invoice .customer-main h2 { font-size:15px!important; margin:0!important; line-height:1.25!important; }
      .order-card.is-fullscreen-invoice .customer-location-grid { gap:5px!important; margin:0!important; }
      .order-card.is-fullscreen-invoice .info-item { padding:5px 7px!important; gap:2px!important; }
      .order-card.is-fullscreen-invoice .info-item strong { font-size:12px!important; line-height:1.25!important; }
      .order-card.is-fullscreen-invoice .products-section { margin:0!important; padding:6px 8px!important; gap:4px!important; }
      .order-card.is-fullscreen-invoice .products-section { min-width:0!important; }
      .order-card.is-fullscreen-invoice .driver-product-table { width:100%!important; }
      .order-card.is-fullscreen-invoice .chicken-section, .order-card.is-fullscreen-invoice .cuts-section { flex:1 1 0!important; min-width:0!important; }
      .order-card.is-fullscreen-invoice .products-section-title strong { font-size:13px!important; }
      .order-card.is-fullscreen-invoice .product-value { font-size:15px!important; line-height:1.35!important; }
      .order-card.is-fullscreen-invoice .order-details { margin:0!important; gap:4px!important; }
      .order-card.is-fullscreen-invoice .order-details .info-item { padding:4px 7px!important; }
      .order-card.is-fullscreen-invoice .order-total { margin:0!important; padding:6px 9px!important; }
      .order-card.is-fullscreen-invoice .payment-section { margin:0!important; padding:5px 7px!important; gap:4px!important; }
      .order-card.is-fullscreen-invoice .payment-buttons { gap:6px!important; }
      .order-card.is-fullscreen-invoice .payment-btn { min-height:36px!important; padding:5px 7px!important; }
      .order-card.is-fullscreen-invoice .invoice-fullscreen-head { flex:0 0 auto!important; padding:3px 0 5px!important; }
      .order-card.is-fullscreen-invoice .invoice-fullscreen-close { min-height:34px!important; padding:5px 9px!important; font-size:12px!important; }
      .order-card.is-fullscreen-invoice .btn-deliver { position:relative!important; bottom:auto!important; flex:0 0 auto!important; min-height:42px!important; margin-top:auto!important; box-shadow:none!important; }
      .order-card.is-fullscreen-invoice .order-actions { flex:0 0 auto!important; margin:0!important; gap:6px!important; }
      .order-card.is-fullscreen-invoice .location-btn { min-height:36px!important; }
      .order-card.is-fullscreen-invoice .invoice-expand-toggle { flex:0 0 auto; }
      .invoice-fullscreen-head { position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;box-sizing:border-box;padding:8px 0 10px;background:#fff;border-bottom:1px solid #dcfce7; }
      .invoice-fullscreen-title { color:#166534;font-size:15px;font-weight:900; }
      .invoice-fullscreen-close { border:0;border-radius:10px;background:#dcfce7;color:#166534;min-width:42px;min-height:40px;padding:8px 12px;font:inherit;font-size:14px;font-weight:900;cursor:pointer; }
      .order-card.is-fullscreen-invoice .btn-deliver { position:sticky!important;bottom:calc(8px + env(safe-area-inset-bottom))!important;z-index:15!important;min-height:52px!important;box-shadow:0 -5px 18px rgba(255,255,255,.95)!important; }
      .order-card.is-fullscreen-invoice .invoice-expand-toggle { display:none!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables { display:grid!important; grid-template-columns:repeat(2,minmax(0,1fr))!important; direction:rtl!important; gap:8px!important; width:100%!important; min-width:0!important; align-items:start!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables.single-table { grid-template-columns:minmax(0,1fr)!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables > .products-section { display:block!important; width:100%!important; min-width:0!important; padding:7px!important; border:1px solid #cfe0f5!important; border-radius:10px!important; background:#fff!important; box-sizing:border-box!important; overflow:hidden!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables > .products-section.is-empty-product-table { display:none!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables .driver-product-table { width:100%!important; table-layout:fixed!important; border-collapse:collapse!important; font-size:14px!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables .driver-product-table th { padding:7px 3px!important; font-size:13px!important; line-height:1.3!important; background:#eaf2ff!important; color:#173b68!important; border:1px solid #d5e1f1!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables .driver-product-table td { padding:8px 3px!important; font-size:15px!important; line-height:1.45!important; font-weight:900!important; border:1px solid #dfe7f1!important; overflow-wrap:anywhere!important; }
      .order-card.is-fullscreen-invoice .driver-product-table img { width:34px!important;height:34px!important;object-fit:cover!important; }
      .order-card.is-fullscreen-invoice .driver-products-tables > .products-section > div:first-child { margin:0 0 6px!important; font-size:14px!important; line-height:1.4!important; font-weight:900!important; }
      @media(max-width:480px) {
        .order-card.is-fullscreen-invoice { gap:6px!important; padding:7px!important; }
        .order-card.is-fullscreen-invoice .driver-products-tables { gap:6px!important; }
        .order-card.is-fullscreen-invoice .driver-products-tables > .products-section { padding:5px!important; border-radius:9px!important; }
        .order-card.is-fullscreen-invoice .driver-products-tables .driver-product-table th { padding:7px 2px!important; font-size:12px!important; }
        .order-card.is-fullscreen-invoice .driver-products-tables .driver-product-table td { padding:8px 2px!important; font-size:14px!important; line-height:1.45!important; }
        .order-card.is-fullscreen-invoice .driver-product-table img { width:28px!important;height:28px!important;max-width:28px!important;flex-basis:28px!important; }
        .order-card.is-fullscreen-invoice .driver-products-tables > .products-section > div:first-child { font-size:13px!important; }
      }
      @media(min-width:700px){.order-card.is-fullscreen-invoice{left:50%!important;right:auto!important;top:0!important;bottom:0!important;height:auto!important;transform:translateX(-50%);width:min(760px,calc(100vw - 24px))!important;padding:14px!important;box-shadow:0 0 0 100vmax rgba(15,23,42,.62)!important;border-radius:14px!important;}}
    `;
    document.head.appendChild(style);
  }

  function render() {
    // تحرير قفل الشاشة إذا أعاد زر التسليم بناء قائمة الفواتير.
    if (document.body.classList.contains('driver-invoice-open')) {
      document.body.classList.remove('driver-invoice-open');
      document.documentElement.classList.remove('driver-invoice-open');
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
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

    ensureCompactDriverInvoiceStyles();
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
      node.classList.add('is-compact');

      // زر فتح التفاصيل يبقى ظاهرًا في البطاقة المختصرة.
      const expandButton = document.createElement('button');
      expandButton.type = 'button';
      expandButton.className = 'invoice-expand-toggle';
      expandButton.textContent = 'عرض تفاصيل الفاتورة ▼';
      expandButton.setAttribute('aria-expanded', 'false');
      let savedScrollY = 0;
      let previousBodyOverflow = '';
      let previousHtmlOverflow = '';
      let fullscreenHead = null;
      const closeInvoiceFullscreen = () => {
        node.classList.remove('is-fullscreen-invoice');
        node.classList.add('is-compact');
        document.body.classList.remove('driver-invoice-open');
        document.documentElement.classList.remove('driver-invoice-open');
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
        if (fullscreenHead) fullscreenHead.remove();
        fullscreenHead = null;
        expandButton.textContent = 'عرض تفاصيل الفاتورة ▼';
        expandButton.setAttribute('aria-expanded', 'false');
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      };
      const toggleInvoiceDetails = () => {
        if (node.classList.contains('is-fullscreen-invoice')) {
          closeInvoiceFullscreen();
          return;
        }
        savedScrollY = window.scrollY || window.pageYOffset || 0;
        previousBodyOverflow = document.body.style.overflow || '';
        previousHtmlOverflow = document.documentElement.style.overflow || '';
        document.body.classList.add('driver-invoice-open');
        document.documentElement.classList.add('driver-invoice-open');
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        node.classList.remove('is-compact');
        node.classList.add('is-fullscreen-invoice');
        fullscreenHead = document.createElement('div');
        fullscreenHead.className = 'invoice-fullscreen-head';
        const heading = document.createElement('strong');
        heading.className = 'invoice-fullscreen-title';
        heading.textContent = toEnglishDigits(`تفاصيل الفاتورة ${firstValue(order, ['order_number', 'orderNumber', 'invoice_number', 'invoice_no']) || ''}`.trim());
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'invoice-fullscreen-close';
        closeButton.textContent = '✕ إغلاق الفاتورة';
        closeButton.addEventListener('click', (event) => {
          event.stopPropagation();
          closeInvoiceFullscreen();
        });
        fullscreenHead.append(heading, closeButton);
        node.insertBefore(fullscreenHead, node.firstChild);
        expandButton.textContent = 'الفاتورة مفتوحة';
        expandButton.setAttribute('aria-expanded', 'true');
      };
      expandButton.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleInvoiceDetails();
      });
      node.appendChild(expandButton);

      // Button is injected into the existing card, so no HTML template change is required.
      const departureBox = document.createElement('div');
      departureBox.className = 'driver-departure-box';
      departureBox.style.cssText = 'display:flex;width:100%;justify-content:flex-start;box-sizing:border-box;margin:0 0 8px;padding:0;';
      const departureButton = document.createElement('button');
      departureButton.type = 'button';
      departureButton.className = 'driver-heading-button';
      departureButton.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:7px;width:auto;min-width:150px;min-height:36px;padding:7px 12px;border:1px solid #bfdbfe;border-radius:10px;background:linear-gradient(135deg,#eff6ff,#dbeafe);color:#175cd3;font-size:13px;font-weight:800;box-shadow:0 2px 0 rgba(37,99,235,.08);cursor:pointer;';
      departureButton.innerHTML = '<span aria-hidden="true">🚗</span><span>متوجه للعميل</span>';
      departureBox.appendChild(departureButton);
      node.insertBefore(departureBox, node.firstChild);

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

      if (departureButton) {
        const departureAt = order.driver_departure_at || order.departed_at || '';
        if (departureAt) {
          departureButton.disabled = true;
          departureButton.style.cssText += 'background:#ecfdf3;color:#067647;border-color:#abefc6;box-shadow:none;cursor:default;';
          departureButton.innerHTML = '<span aria-hidden="true">✓</span><span>تم الإبلاغ — متوجه للعميل</span>';
          const time = document.createElement('small');
          time.textContent = new Date(departureAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
          time.style.cssText = 'font-size:12px;font-weight:800;margin-right:4px;';
          departureButton.appendChild(time);
        } else if (!delivered) {
          departureButton.addEventListener('click', () => markHeadingToCustomer(order, departureButton));
        } else {
          departureButton.disabled = true;
          departureButton.style.opacity = '.55';
          departureButton.title = 'تم تسليم هذا الطلب';
        }
      }

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
        badge.style.cssText = 'display:flex!important;align-items:center!important;justify-content:center!important;gap:12px!important;background:linear-gradient(135deg,#b91c1c,#ef4444)!important;color:#ffffff!important;border:3px solid #fecaca!important;border-radius:16px!important;padding:14px 24px!important;font-size:30px!important;line-height:1.2!important;font-weight:1000!important;letter-spacing:.2px!important;white-space:nowrap!important;width:fit-content!important;max-width:100%!important;box-shadow:0 5px 0 rgba(153,27,27,.22)!important;margin:4px 0 12px auto!important;position:relative!important;z-index:5!important;min-height:58px!important;';
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
            'data_weights',
            'carton_weights',
            'carton_weight',
            'chicken_cartons',
            'carton_sizes',
            'weights'
          ]
        );

      const chickenQtys =
        firstValue(
          order,
          [
            'chicken_qtys',
            'chickenQtys',
            'chicken_quantities',
            'chicken_quantities_text',
            'carton_qtys',
            'carton_quantities',
            'chicken_qty',
            'data_qtys',
            'quantities'
          ]
        );

      const plateNames =
        firstValue(
          order,
          [
            'plate_names',
            'plateNames',
            'plates',
            'cut_names',
            'plate_items',
            'pieces',
            'data_items'
          ]
        );

      const plateQtys =
        firstValue(
          order,
          [
            'plate_qtys',
            'plateQtys',
            'plate_quantities',
            'cut_quantities',
            'cut_qtys',
            'pieces_qty',
            'data_plate_qtys'
          ]
        );

      const chickenDisplay = formatChickenLines(chickenWeights, chickenQtys);
      const plateDisplay = formatPlateLines(plateNames, plateQtys);

      // Build real spreadsheet-style product tables inside the driver's invoice.
      // This is driver invoice rendering only; the master rendering is not changed.
      // Product photos embedded in the website source so no Android app or external image hosting is needed.
      const driverProductPhotoData = {
        whole: 'data:image/jpeg;base64,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',
        thighs: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAGyAbIDASIAAhEBAxEB/8QAHQAAAQQDAQEAAAAAAAAAAAAAAAEEBQYCAwcICf/EAEEQAAIBAwMDAgQEBAYCAAUEAwECAwAEEQUhMQYSQVFhBxMicRQygZEjQqHBFVKx0eHwCGIWM0Ny8RckNFNjgsL/xAAbAQACAwEBAQAAAAAAAAAAAAAABAIDBQEGB//EADURAAEEAQMCBQMDBAEEAwAAAAEAAgMRIQQSMUFRBRMiYXGBkbEGFKEjMsHR4RUzQvAWY/H/2gAMAwEAAhEDEQA/APqeAG8mj8u2TQTjgUYJ5oQlAA3BzQd+aQgeAaMc4NCEecZxR7Ghc+360E45G9CEc8HasjxjG9IN/IorloWJ85rIbeBSb0oAHrmi0JOTzR2j1NKSCfelzj3/AEotCxAI8A0HiggckUAb8YFFoRx60bnzijG4xQM5otdpGw9TmjGfGKUgHfzSZANFriX2pOfUUE5PpRkD3otCUrjyaTHoaX7UY25oBQjHpk0p35JFY8+TWq4u4LVe6eVUHueaCQBZQAXGgtoIzyTSkgeaiZ+pLKIDtDyE8YAAP71GXnVdwB2wRLH3HHcx7sfp61Q6eNubTLNJM/gV8q0j0JAoJAqj3et3WCJLmY5G4Xb9dq0vLM8YKTSkD6hlzv71Qdc26ATA8NfQLjSvxOfTFJjz/SqBHeajg/h7mdCOcMQf2NT2g69cTZttUKq4/LL4ce/gGrI9WyQ0RShNoHxN3AgqxY+4NHv5qOk6g0WGT5EmrWaScdrXCA/sTT1JUkUMjhgRkEHOfsaZD2uwCkyxzRZFLPJ9KDtv5rLn2FJxXbUUmRSj70gA8g0vPNFoR3Y8b0hPqopc0h32BotCBnG2wozg0tFFoRz5NJx6mjf2ox5J4otCTz6UpH6UcHbFGSfSi0I2+9HPBoyRyKAB4otCAMCjyaOR6UHIPk0A2hLsBSY85OaM55o5G5rqEZA2NH0+CaWkIXNCEA/YUcjc/tQfQUDihCXK+9FJt6GihCM+DSjB80g9wKXA9KEJMn14pftkUg2P3oxnnmuWhH7ZpSdsc0mwPpS0WhJgY5xSjPqaMZ8Ume3IqK7SM/c0EnnNGSeKDgb+aFxGx3oA2xnejB9aMAc80Ltox6UYOd+KUcUmD60LiXGeCKx7j42pePWjO/pQhAJPNB/6aAM+Tij9jQhH9aTk+lLgGtF3eQ2UTSynAAyANyfYCukgCyugFxoLefc7faonVeorHTkYI4mmA2QNsD7ngVVL+/1fWbgS3he3t0Y/LgRiMj1YjkkfoK0GzEkgVoHAXfJ4/wCaVM7nWGj6rQj0bW0ZDfsFJS9XahKmSQgIyBGOB9zUXJrc07lHJJG7Fsn081nJZxSkI0pU4wFGw/0ppNZhSLcSBn5AHONv2pSQuNBxWjCyNuWgBOINStbhSsigkbDu2zxxTyG6sljDTFFB/Y/v6VESWZU9hw7KAXCnBA23rGK0W4xJbygqh3DcE+nHiqi4cDlMbARZNBSsjQP3NZj5rkZLZzt6cUxmmmgVJVuxEqZZgy5G3OR4pvaSzx3EyxII2jwe0ncA434qP1x7j5ayqWaSSWMSAjIOCA2+PIwcUtI8AWmYYdzg0nBVjTUYDam9fMqlc5A3I9hTGz1V9QlkWNMIhx6H/wDIp0ba3ltioQqDgdgGNsbD9MVFaGGmgM0ziN3nbtYbEHOACPPpXHOfYyotbHtcayuf/Ejo7p2/10Xl9dXdpPMgZWt3wjEbElSMEipD4f6lc9FMPwfVd9dWpP8A/GuMNH+g5B+1Ofi3pd2NIS9EObm1lVlxv3Kdjj/aqppyo1oJJsIQM7n+ldaxzSZGchaAk/cacRSGxx0XoPSviToF8oFxKYHI37hlf3qyWWpWGoL32N1HMPPYwOPuORXlprtI2CxykEjORsBUDp/xbv8AR9YY21w+IJCpIJBOKvZ4sWECULOd+mPPs6c5HQr2YT55pSM7g1W+hOrrbrLp6DV4GHcfokUeGAqyDB3raY5sjQ5pwV5OWJ0LzG8UQaKQ+maMgc70ZPpS7AV1VpDxQCAKMigY4NC7SN/BzRg+Voxg0uT+lC4kwf8ALSj7UHbjesQDQhZZ9TtQN+KTIxgE0DYbZoQlIGfWj9QKx4NLkDGd6F3KBk+3rQf9KQ8+lLjbY121xGT65o874o45FH3NdCEE+nFA4pAR96yx6V1CxwPWil7RRQhGCeeDRt9z7UYzuNqMZ/3oQlBBpMb7UoH2pNlzuDUEJf60AYOaTbmgffNC6UFiaBuM0fpkUZA4FCKQSPINBOeAaMAjfmjJ33xQuIA80Hbg8UZHrQT6nahdtKMHwc0EYOcilzttxWEjJGpdiFAGSxOABQuJTv8ApRn9ar+o9aaVZkpbd944OCIuB92P9qjG6p1e+bNvF+GjzjITuP7n+1V+ay6GSr26aQiyKHurk7qgLOQoHJJxUZc6/ZQkhO+bHJQbD9TValubhXb8VcPNwcMfPuKxWdJDgyKgPAAzmgvxfCtbps5yrC2uvPH8y2UID5cb1GzXTTn6j3HkknNR91N/DA+YWJ4wMA/pSW7SCNTGwOTuBuRUHSAAEq5kABwnLyhXUmNgQcdxHk+1a5C+cCQgn3FY4kMpLAAgjKk+KxLQmQxAFuNiMemwNVbqyOquDOnZaJ4JnzGkis437WYHHvUVfSCxlimnjmEgYDCp3E8c4qeItww+pFI3GRggjHB81B6tfz2skT/hpexz2/w17wRtjPkA0vMaBJTmnaXED/hbUuYZ5e+ArIHwc4IKHbkc4NYMrW8Blg7kQSESRIMnvJG59jWQVljW5KLIXGV7du5TjIzzke9b0uLFJI42uCMrs5TYcbH1Pj9aTIoc1/CaHcC0wjjlu2Erx/hJVAEUhbOTtkH1/tTd7DV4bS5t50jDMncqE5XuBBBUn9zmnOqoIYW7G7ELLJDjftfY/qDTSa/F5D+Ev5ViQqOzuOFB2584B59c1Q+gaN3+bTURc6i2q/kfCc6PrEt/rNrp8S/PjaNjM6bhW2IJPjPpWzT5ILK7u7JAj5ncEONlOcnB9fNNelhpuh6pNZaUF+UQjTdp2Lnkg+nBo1C0M2oTazbXsSQm57pQSMHGxwfBqUbjsBuyDn4XHsaZC0Cmkfcpv1vdrf6DdWjRMLiCJnjcDZgozkHx9q4/pmvQarAkmAJcYYDjI2P2rsfUMVtd2z6ZHcFGnjK7DZQwxkH9a8i6j1Jrmgahe6APlRS2U7wPIBhmwdj+oNMQSgE2mtLpxI0BuDavPV/VttZFtN0+cGcD+LIDwf8AKK51e3NwgF5GwJZiWxyPeoO9vpJi9y7kMckknmmXTs9/qMr3crkRElY08dv+Y1lahhkdhew0UTYIxn5916f+CHWesWOh2l5otwk5tLl476xMmGlibBBAPkb4PNesbeYTwxzKCFkUMAdiARmvAvwp1C60AXDRxBnWUlnK7gHjf0r0h0H8aLWG4h0rW3ZI5SFBbfsztkH09c1p+HaxsI8uQ4Xi/wBSeDyTyGaBoNZNc0u4H9qQjPmsUdZFDIQVIBUjgg8GsgBwcGt9eDPujAHtQDnk4pdvO9Jt96FxGc8UEZPjFG3gZo58bULtIzgfTQc0A+MUce/tQuIB25ozv7UYz5oPp5oU0pOKx5NKSRyKMefHtQo0jz9qM4P+9GMb8UbEbb0LiXY+9A22xmk9sYo+/FCEp2pAx/SjAoz2japBCXI9DRSZ+1FdQgEnxRsP5v0oI2NAwBg1woR3bbjml/QY9aQbZxvScY5qK7SUbbZoJHAOP0paQ4PmhASD3Jpe0g58UZ2xjFIvNCklyPIoI96CMYxil3A/2oUEmABWq4ube0ia4upkijQZLOcAVW+pOtE01m0/RrY6hqTfSsanEcRPmRuABzgb1Vpk1bUSP8c1E3UrbmNRiNT6KPT3pd2oztjFnv0Cbi0hcA55ofyVY9S+INrkwaLbvdycByMIPf1NV67v9Y1UH/Eb8pG3MaHJ+2BWJSDTl+to1T/Igxg+580zW6MrO8AEQz45+9QLHvPqN+3RPsjZGPQPqeVJW1tYwlWWMiRBkEkkjPn0rZPqiwRlQ7Kf8wBJP2pkq3BBnRiFUZLncn/en8NrDdW+WLtIwzmQgAfap1tFDCNvU5TT8UkwGBlOSe7c09gjt5FHYmQRnOMY+1NYli08mHtBJOTkZzTr8S4TvityyruSF2xUS4NGVLbZwnEsCHDSSkD8oZjz9q1o8EUxiDMpAz3Dk+orTdmWeLK9u4BAPAG24rGNDgtgPjBJ8fc12iTkYXABXOU7jHzB82Fe8g8E4J+9NbmG6jzO8X0kDYHOOOPNI93cRhZIVjRAwV1B3xtuPWtKTvCxjnuS4LEh25HBxj0qiRwBqq91dGx3OD7JtfaxqMFj+IfSknRcEmJskDIAYr+9ZPeS3MUc1swjkiGRGxwSCBsfvWbXkcTM0aRGOTb82G8ePOajb25a5mW0SwkcRDuE8bdpA22z5NJucWk0SfZPRMBqwB7osLnVLiSSG9tok7jwpIK4x9QP/eKc/wAJ7sd8kirkByqAqHHGR5BHpTWzmZGE9tdrdIow0Egw68f996jGtZZtQSSxv57eGZ/qicEhM4zg+hpWV5DAALNpuOMPcc0KU1d65bS20tvGxdgpUQEAr3DG4Pg58VCXLT60sV1Z2yCUfRIsh/LwN/UH+lTE0Fm0UllhEk/KWyMscD6u71qKW2vtPImvAssCbPOGADJtjuHGftVchLv7zY610U4Q1mWCj0tRlzHqltfJZWLmCaSIIl1Gv0rwSpFTCabbal05JayARH6vmtGTkSKcliPO/im9rBcStczySB3kkEiLEO8FNu37VqubI6ClzrF7qFzFZ3EitcxAFlBOAMY3GaTb/Tt9WDd30Tr3bwG2ARX1W3TdZivYhBcIC0QwshGCcDY/rXjL4v6utj8XupbRnAQ3CMAT/mUHNeydWSXUdOfXLSIQR9qpbxsAjSIBzj19K8C/+TvT3Wv/AOs7jS7Vu3qSKKW0lIIBZV7XUngEEb01pZS47ecYPdX6UMD9/HQj3Wc+tx6hqMOlR3SxRu4+fOR3BF87Dn7VeBcaZaSd1pgpgKrdnYGwMdwXwPao34d/AzXUtYNR6lmhtbSwja8vJgwdhCpx8wjyGOyryTXbLH4caD1pbi8stEbQ3QKkYRiUYAZUkNuTwTj1p4aV1EmgU87WxNIo4HPsn/QFhp2j9GXOuaqzo16pdkEYP8IA9u54yfNc+uurla8luo3wAxCb7gb4FXT40WGq6HoejdH6Bb3V3LKC0vyY2YsF28DYEnYVzCD4V/FW8gae36M1JlXchkCk/YE0hrGhpDAOE54aYnMM8rwNxxZ6L258AfiLB110els03de6V2wTAndl37W/YYP2rqQ332++K8n/APivofXPQWp6pcdY6BdabY3duqo8xXJcHIHaCTwDXo1uu9FgOJBcgevyjitvRatn7dvmmiMZXzXx3w7Zr3jSi2k2KyMqx7jass4HAzUbY9Q6RqSg2t9ExYZCk4b9jUgrKd1Ktv4Oa0Gva8W02FgujdGacCCsqTBO1ZYyMnb7UmPAqSgkydgaUg8gUAEnxQdvNCEmDQceaX6seMUgHJzQhA59RRkZ2FGecZowfI2oQjPg70cjYYNH2o3z7UIRuORRv4xS0hxnbmhCM8UpwMb0hA5JOaU7+akChJ9NFGP/AF/rRRaEb/b3oznzvR7AZowQeP60FCXfzSdu/pRhvegn2waihGPGaUDFJyN96AfQmhCAQOBvS80bZ3rVc3MNpA9xcSKkcYyzE4AFBNCyugEmglmnjgjaWaRURFLEscAD1Jqg651rc61LJpPSzMsaHE96fpUDyFPqfXmmHVHUk2shY/lyJahj8uEfmkO4DN7D04FRb2z28Qt/nJEmO4RI2d9+f96SfI6bDTTf5K09Ppmx+p+T0HQJ0qw2eO5zK42XHGSTkgeSfU1jd6jJBG3e3YSOSN/PHtWVhK8biVwA6Ht3GQo3/wC4rG8u/wDEpiqJEiIcgY3J9c+lTjaGmmigE0cmzla4Je9Fae3yQMlpDuffHAFZzCNsTJEQg/ME8j29q3HTDNbqblCFG4GcZPqfanBuktowJbUKyntVV/m/TxUi4gnKBWKGUpeFrT50szIv8kYGAKxslW6yPmFVHIBwadNa218u9yowuWyM9o9RTWC0jt+8GXAQ7DnuFcY5tA2jaTiisZuxJDG31hTs3BNPlmCplHCkDgEEGm8sNvIP4dwhlIz2Zzj9aS2hikh7RhX3ViPJ+3rU6a7IUbLeVl/+6mZZI0V4jn6Q2GB96zhaRSyxMkTMMHJwGHpjisbCwvIZHgklSUdpcZ2Z19PvWMrRmP58aEx84JyVI8H0zXGmxkUV0jsbCxe1uZVUtEUI23OADtg/aml89t3iaYF3jOT8tt2G22PNb5tUdrV7ULkOpCkn8oON81B2WnT2S/JlZmQnJJIyNxxvVEjS44GE1CKBLjnstc1xY6jcKVjYBGBAcFSh23x6U4lneEma3kBcAfMibcNjGDnxRcR2Y7bs3IR0wGZhs42/MP8ASlRLtIpXcIyqvdE8e7qNtiPNJkFpI69wnAQaPTilHWsJv7uSd4ZIJEUSpPbnJPGcryfT2qP0rXbu/ur/AE+K8hknUhgxGAVOM7eP96niBMGVGWC5UK6SK2ACcbg+AfIqMfTb6a+TUZNHAnjGHu7YgCRdvzLwf7UlIx5I28dU9E5lHd9PZaG6msUeLTbi2ZJpZBCYiD+Y43z6Gp6z02G6B06EOREwkdZFJjLbY3plpqLG8y3CpeEN3W5RQXCnGQSdwRTy5isnMQGvXsLPstv8wAlvQDn96ojY5oJkr4U5nNJDY8e/KeznULHVLB5LVCpcxvNCMDtI4PpinvzvlLJDqCJcxNIyHYHAyMZHmoKLXLyKCW3trqG5aMYKOcSDHgg85rbb9SaUsMeoXLfJ/EsE7XPD8HNd89jbs18qg6WQgYuu3JT/AF3SrHWrZbS6j+bDsyqjdpUjggjgiuDfHTQ7mPpJ9TtrL8ZNpE4lgnKZmgDbE4G7DxgV3rTu6a5lngUds5HewOQoHB54p9eX2laIh+RDEZjuXYAkH9f6CroojK4SjAHPuuR6l2lPlgbj0Hb5Xnj/AMf/AIZdR3+lprPVWn3NrY3hDg3mV71XdWETbsc7gnAxXeo9D0Syn+dEplKjCd7bKPYDzTWTqFipuLlu+SU4jQnx6msJNSkWIO0gQtvggYYew5rQJc8U3hLyukleXONX0HCc32owxnFmqpKds/LGT7Z5zURFdX9xdTfinnJQ5UlcArg7gePvTtQ08iXEJRezfLDdvuKfxXgDgfgfmHONnwCd9v8Aiqzo3SHdIcBV/uREC1gs9z0TCSa9EYNw4dD+VFIJ87/eo3Ub827qXM0oP5mC4EYwcdx8jH71OSwAxFvlhD3E5UZI54PJxTC40q2u5AyySsvaQ+ds7muO0+KA+6gycXZUNHcSW2oR4vUdJQWUk4K84xjke1TllrBjkYw6nMWBwO1yAefH9603PT1o1qUiCEnPYF/Xz/3NRY0G6hTv/ETOyHuIwFHnIHtSztO+LLM/4V/nRTinYPHHK6HpXVl/bITLKbiMeH5/Q1YtP6y0S+Ha9wIJR/JJt+x4Nclt9SuCTHcqIEQZVCORvvW+F470FoWUMOSDgj7imI9ZJDQ5HukZfDo5rNUe4XZo9V06X8t9Acf/AOQCs472zmJWG5icjkK4J/1rh19ZWl93abqiBw6nt+rB+4Ybg1R9U0DVdFujHpmrTg4LQFpCCw9O4HkU07xAhu5rbHXOVTD4KyV20vo9LC9XgA80pGPGRXmvoT4w9TdN6lHpfVEk9xZswVxPvJEM47lbkgehzXpC1uYrqBLi3dXjlUOjA5DAjIIpjSayPVtJZgjkHkJDxDw2bw14bJkHgjgrZufal8c5xSHOeaDvx+9NrPtHbRt45ox9zR2+QcULiAMnfag7cUYONzQDjbihCN+TQMeKCPOc0AE4xXQaQj9TRRv7/tRXbQl+5wKQc7E0YzzSjbigoQRn3rEY80o5NGxPBqK6EAenFHB2FA/YVhLMsMTyyMFRFJLHwBRxkoqysbu8trGBrq7nSKNBks7YAqg9SdRjW8RW6hLOFu/vf+ZhnBx59h+9MOpNUn1+8ZLhP4NvlkhZsJHzhpDwWPIXwKh3mwzrHMJmA+liMKOfyr6e/rST5fNsHA/K1tPpNlOOT+FsuZp51P4NRGW2+dKcEDfcCt1otlaIVV2nnI+qRl5O/HoKZiKQuks3c5Y4PfttvnAqXEtuYmiSPJYFSwH5RvsPWqy8AjbhOhmMi1GXV9K6omWftySFGxXfendnZC9KiD6u7cYPA35+1NGMQml+Tn5ajC5O+d8n7U6tVvYYDPbOU79gwOB53HtVnnUO6mYhWMKQukvdP7InYOiYIwcgD9/2pvezxtKAWBJA2B3HpvWuVbq4tP4srhy2GyeR/lO/JphCtxPdtDbQsHQEtn0HOd+fSoRmySgsAABIwpBBIGLxTFZD+U8hj9s8VvWzuFura7upSWERBiXcAnzzv71jZ3liZT88qIwqhQT2hHB3Vt/XxW+9vpkuYLWBWhjue4FkGSpAyB/6/wCmKkNr22FF+9rtvGFtQWUgMEVuO9PzMGwT6kDz/alIW2ZIYrgYnXvyF59s+DWqx7JEH8CF1B7WcOe/ncY4B809voIYokuUIESD+KnHcu2Cu+2DirgSG2FTQDqKws/nOpLxMEyCJVOB4+of3pjrTXNpNBJ2AHuxIBuJhtvzsabSarqxnmgW0+dFNhGQsFER27WznYEb001C51FrcWdyxcxAMJFOSOPfcjfNVCTf0KtbCWGyR8JzFdWYeXT2mDGQ5I//AKztg5pLlLCSMSlhMowsgL4YEe1Q8dvBbXIvDOZe4d23JJxz/wB2pZL2xMJuHt3RwQEBGzce9Qe53GFc2Nt2LSrbafeJLFOXYp9SIx8bY+/pTO41Sza2+XbvMjRgrlDh1GwI96z1C5mhg/E/LCuMAdu5XOOTTOO3NxH2OBHJIPmLIdiG2yD+1LvaXegBNxACnu7pdPnXVrZbe16jiaJcqyyLiQjbKn3qQKzWWjy2Nlq8STRDMTMcqeD285waiLewghuEe2hiDykPMpUYPG9b7OLQJNUnt7qEJI4HaGP0g7ZHtVDICwADk4u1fJK0k1dDNUnzPrOnR295e2aEXHahktx3AscYBxuPantvZmSKbUr6wZJom+mQp9eMDj2qMGtS9PJm1vDNbwSbwEhsLtx9q3XfxZ0qBQlwUKyYCHIyc42I96oexjHHe6vbnKsZ50jR5bQffjCaR3Og6vqt1ZsA07RLIr47JCODg8+KaN0fq2s3sNu9wq6NES08rZEkh/yKOAffxU9Y9MQ3WrR9W6jAbWYRFI4VbBKtvlsbb+BU3LPI8JjWNEQjtXfJA9APWuReGib1TDriuoU5fEDF6YD0AN9Dxhazdw2WnpZ6TbrHbwL2g52wBvjO5P3qh3GoRahPJeTT4iBKqrb4weRvuTVi1GSYqbX5pJIOWUbBfc+g9qizYNZpE8sqyPnuRQg7e3yT6mtGVm0BrRwldOWttxOSnVnC14iSyRSbDILDDY8HHpT63t45Lol8IGHb3sckY5B/2FNruftji+Vgy3G6IGDMq+p32Y+BRBqNzZTP3KrZUxllOSreo35q1lCgVU4OkBI+ifNayzXBi06YMiH6mdSqNzsPWrFDYwGAGVAANiAcju9vU1XdAjZi808jOpY4TPPud6tAaQQfxEXbhe7c/wC2KZaKGeqzNTYdtB4WDQqykBAJCcZBOBz/AK+lN1Qh3QBnQ7Esuwbfj1+1SDu8EKzx9pLDBxvj3/T1rR8yQROokCMRlSRnPP8A3NSNVZCWFg4KajKzFPlK5xntzjbff7VheQOyFXhJWQ47MZQk53LZpzb6fLdTtdCIxMdiS2xxn3rKeYWxcMxMQz3MNxnffHpS7qDc4VrcuxyFCy6TMoZFRVGCAO4EDnYZ/wBKj4dJ/wANn+e1s2OcM2w549RVmuAs0auixOnbkDtySN8GmyXKSgwNCyhM5Vhyd98Z49qrdC0nj4VzZ3AH+VEX1pBfxm4VuyRRnI2A52PvVa6otn1DQZTA+LmBS0ZB37gM/wBRVxliVj822ABGR2k5B5yPaq3qlq9vI86wtHGxyRnIB9QfSli0MftI5TsLrAcDwqX03q2ndQaWtl1QI43VsRXIYB0Izz7evrXevhrqtjYaAmkXGqxSi3YiGUyAhozuAD6jfY8V5K6l6Z1MdXzrYqVtJx85WJwFP8w55zU7oGoS6YFisL+eRwfqK5Cn9Kpic7SSbgPb5C1dZoI/EYAGvrrXYr1V1T8RunulokNzJJdSuMiK2XvOB5J4A+9aujfid0z1o7WunzSQ3aDuNvOArkeowcEfauJnqSS8hSGScK7rjbHJ8H2NVXTdYi6d6vtNReOS2uLS4WTKE9sgzuMD1GR6etdf4lOyYHGzqP8AlIM/TcDtO5ud4Fg9Ce1L2KCT7UY9TUV071FpvU+lw6vpNwJbeXj1VhypHgj0qV5HNb7XBwBBsFeLexzHFrhRHRIfbilyMbmjHptRz/LXVFBG/oKAcbUb+SMUnB9aEJcn0oo/eiu2hBXnGTQON/FLv4pAM/8ANdKEZ9BRn12NGPfesJpo7eF5pWCrGCST4AqJIAsroF4CJp4oF+bPKsaAgZYgDP3NVDqfXXv+/TdMn7Ik/wDnzjB38KPU1Gavrr6vcq0kPdHCS0cOdkO/1N4J9vFRttdyXgeWCEJAvcFZjgSN5I3496zZNYHHaOPytnT+HllPfz+FquLiCFCRaKUiBwsjfTnfdjyzZprpUsktw93DbxGV84JXAH2Hj/8ANbTZzzThryZJAfpVV2Vc52X1+5pzbRR28Jgt7lGd2IYpv28jG55pQy55WqImhtVZTO7eczMJsSzO2GbOAOdtvFSscM7KCkIRUHaUTcedyeBUXNC0E4uQSEiOFTy3rnepUOtzH8ySV3DbfLGwA32/5qqOcbyDypyRENBHCh7+zQ3IkQExjd1Rsk88b8VtN1boFeKYjHEbZ3525qZFrZ2cIcxrHGSMEEAZPuTuM1jqKWyqtutrGV7e5SuC7MM5Oc5/TNMPbjBoiioMkBIBFhaG1WO1hF1IgMUygYIz2kcEH/fk1ui1ayQs9kodmHdLOTgA+Ad+aYXV3dLcCDTQGtnUGRnAPY2+RjOP0rGFY9PkNtDeRwSsPmlZASrD0JyRn7cCpxyGybx/lQfCCBYytGuWy61GtwYQqxsAY0OAzE8tg8+RT6TU73pazim1KxD2uRGJY5u94z47gefc1iup6f320v46KH6iJIUGV+4wc4HjNPmvOn9RV4keJmCn6X27h/65O361ZG5oJLTkqMjXFoa5pI+FhcWU1xENV0t3SSUhsqQFZT5Az+9ZJL8y3dFkhuJ0ON9gW2yDvwfFNoUkvbRLfTAUmtvpE0khBhGeDg/VTaHSZrCEW810i3HcXaQPlJgTvydj6CmQRz0KpA/8TyDgdaTKfVJ21VIbGP5nYnbcwsc4x4yTufQ/pTiS0vLu1kvYZjYI64SJVBJ4/NngnjNaru/0Sw+XcwRTid2IKxDJcDGQ25B9jTFupoZ5gbOSWNB+VJDknjfneoNkjbYcbKvMMj6LG0B1K3RQi2t0SdC7gYBB3B2/Nv701eKeNXRiHB37W4HHH2rG41e4umeEsLcPgCVeRxzn/vNN9RbWAoaS+ilQAZKjDDjnFQLzfpGArWxEH1EWVpmupobSZBEzBRscZ7eOf++K0x6pHewQiRyu4LEcngGnuk2GqWsMtw06TxTjIUjBHHI981VtR1KF7N7ftETIW+WyjGSDxsaqdbRuJ+iviaJCWtHB5UxfX3ytQt10+VC5ibc/lx4zUDqGrpDCLm7YJMZQjnO6kkY39OP3qKvdffTbBdRu3HYhxkHfBwP25xTDpjTeo/iTrbxaNalbAlVurqUExRDbf/2b/wBRv9hVW4u+T0TflCMW40ByndndavqfUkWmaNDLdSXQAdYxkDz3Mc4Ue5rqHS3wk02x1OPX+p5orq6hIMEQ/wDkwt/mweT/AEFXHp/pnQ+ktMTSdDskRioMkhI+ZK231M3Lew4FF88hQxvMD3bdoG5/Y8VczSMB3vyfws+bxJ8o8uL0ji+pCwv8XEgjsCJQnONgP1zio4NAkjvclO4YBHOPZd9zW+3jumiMSp8qIHZM7t7sfStF0iT3EcIjXsTlQ2Cx8ljninBdWkBg0ThaL2dHgYWsagyrhSDsEHJ55NVp1mhuAs0rkAZUDwP34HkVaJNPDEySSdpjwAqHZfQD3plc2zgmXABO+TwftvQWbslWxShmAomW2dIHks0Adwe9hz2+fPJrbpNm5QG4iIjbaOME9x9Cd9s+TUrbxrEiJ2FmPG/H+5PpWu5N3A4t7azaWUEu2+FUerH19qre1rKJVjdQ5wLB16qV02xYSC5WMKU2OGyoHpzualTPE5HyIlQgbkH83NV+HV5XZIp0Eaj6SoOQPcb7mnf40liIAew+u7Hnf2FXxkPFhZ8zXh3qUt+KQAMwd8nAwO0Dn15pJ1aMCSMKQ31Bi2CBv48j/imH8WZwhR8kZCkZOd+N+fbxTqFmUukjZmUZUE7+3nx5oLbNWqgaF0sVkuZWl7EyqDtCs2PB535rJrlV+XE6ktIcFVUkKN+fX/8ANarlrkRZATAOZCGz3c788VsN0/4YrbkIzL3EjkjB+kemKjVD1KQycLJYu6YJ24XB5PHPHp7Vrunjtmd7aRzIoz9eCPO3/HtSs5QR9suA4yUY7433H/fXatL98vexcgNlQvgc7feoF2Bak1tnlNJJhcQl3HY8o/MoICtyPt/rSXEPzolUogDp9Sg5DeuPStvd2xPL2EAHtIJ/K2Dz96wZoTAIwxyDnY7j+vNUPiDxdq9sm04XJ+vdLv8ARr5bztJtXUhGUbecqd+fSqRbS3CqZLckRMTsBgH2z616B1K0tNWs3sdSxPa3IKFlwGU+D7MOQa8/a/8A4v0NrU+hamWmtA3zYmAwssZ4dd+cbEeopeT1gNPIW/4bPdtPP5U7pjG4kADYYjLDOcj1G9TUOq3Okym8idTgdsgZQ30+n1Z/pVR0SUXeuwGzcTpKpZVLYDYGSvNTF3f217eGZ0EGD8sxFshcbY5pF8ZaLWtYc6jkUpvpnrzV/hrOt7pU4vtI1OdnaCVsMj8shI4O+VI8bGvSvTHUundU6Lb63prZinXJUn6kbyp9wa8g65aLc2LWSthom74zn+b159KsHwr+JGqdA61aWGqLILHUQvzYm47ScLIu/I8+oqWl8ROmeI5P7Dj4Ky/FvAm66EzwD+oM/IH+V63wTuTsaQ58VjHIJI1dWBVgCCOMHg1n9zXpV89yMJDxxgfegDf1FHPBowOM4+1C4jb2oowKK7hCN/XNHPO1B24GM1jJIsSF5CAFGSTwBXTgIAvC03t9badayXd3MscUYyzN4/3+1VTqDV01WFIbVZOz83aylcnwTuMY8A0azrcd/IYsr2R7qDvj/wBj4B9Kq+q6pHZRrMGMgJGxfA87nfj0rD13iAaCAcdVveH+HEkOcDu6J0yRQRF/liQKCzEnAHPjzTCe7nuGAP0RHHaF2B5wD/tW+CSW6tfw5uIzM475ACRgHJG//c1GzyrZ3MaQGSeMHscRjABOcEb/AO9ZMmpO0HgLdhhFkHJCdTThgIImIbOHwdo13znfGTvgDgVuSKS0lVXKQr8tjCnJbnfY5z534FNxdwwRl7eP5gVv4jA4Aznc5P1HbGc1pP4yzvbaC6VmmVJHjUTB2MLbjO+xB/pVRlIO454+ArNhPpGOflTujW9sZvlyRnAUkszZORnOd/vn2ArK6uo7T5lykBSEZBkYZHnxnj7U2t9Rs9MQ3JdpPpKNhsALv9Ryd/cjnitNlrVzexMsA/gAkC5mARSN8AD+bHrTQlaGhoOfZKmN5eXEYRq0c97ZAXF1Hb20pV1MidzLgkggZ2Ht+9Z6TqcKSyC6uo7mZvpWdSMEb4AGdj61VevNYulhXT9Kb8ddStskZKgDyWY7AD08gVKaLJNNpkNhdrbvcRrutjEQFIzy5P7nzUYNVcxaOQBk9fZNv0ZGmD3cE/BHun+m6oD1DqFlbKlyhQO8YcKEODvknb0x60217VPwukSXNpb/ADntZV7EmAKdudwWzzyM1GXWgypdRwxJJC8/dI4WTu+ad/cYG+ftU5BcSRWL6bJfR/w8Bo3QFQp2x3envzmm2SucCw4/2q5IY2OD2Z4se3/K1nT7XX10/U7GCawZk7w0kZCEnhecHfjbFbryG3tYkXqGK1mcShYwh7WdhvkkY39RTSXX9KigbQ4NHe5kiYBVaYsFY8doBJAppc9O9Ra1e2g1JfwtjEMKFmy6nwDvsT6+lXNe3mMWetcWqtjgalO1our5rpScT9RaZbvLLa3bm5z2iCFWLKP8uc4I/wCim1nPLrDyW+pSNaPGRIkcgbtl498ipjUen7DSrf8AHTwz29xEuFkgbIJ9e3euf3Ws2ksZSDVJXuncsZ5m534AB2FSke5hAdXwrNPFHOCY7+TyrTrVzo0TQRKZYp4v/q5ygG2QcHcfbior/FNC1DTUNuyTyqx+sHHB5G/GfFRttIIoz3Ti4lkG/wDlA22G/FPtItrO3cy3dsnykHdGFwEO++QD60NcXGzQB5VhhEYoEkj+U0uYdcEqtDHBcxMAVR2KSqNt88GnEdlLJj51yEcLlQGyBxtn0qSmmTUmSSxcfOTYAtgFdtufFYTaX+LtZv8AEZxC4xiNG445PmusaCSWkkfwoukNBrqB/lRcus3WmWAuLycKkewZTwM881Ub7VdLvZDLBKHixyQQA5wSf1qZ6iEtraQw3EebYHDMTtgY534qj6xNeXOk3Nxp2kvHaxAlZCMFsY3Uf7VRNKb29k3p4Ggb+556Ld0t02/xD6l/+HZZpV0+IfNunVt1jyNgc7EnYHxufFemdE0nTentLh0zSLGKzsrVQscaLgAevuT5J3Jrg/wN1RLLSL+5ktzFdS3g+Y55ZO0FQN/GW29TXZtO1sXkifV3JjjwTtV+kIq+pSHiYkc6ug/KkjJ+Ln+dJtFGMrvz7nfim63Nu07GNMyYwqscAD/vNIryFTG7rGjnuJY7BR/qfamt1LCo/hLl2P0gnc+59qeJLQssNDjSkHuFRAmf4kgIyOc+w/0qMtY4Y5TFIe11+oseB999zWmQu0auh7CAe985x78+K1mVZoY4YwzljhSxwSo8nfz61wvPRHlgCr5Ty57CEkjckBjhj/N6nmowXEDZlbJLE7E4wPGN623VzLKyRNgCMflGwH/FQl9exquICWdiQxHCL6810yhgJKiyMuIAUnIR+ClminBYZwAd0/8AbnzxUfHrc4QQ3LYOwWMHcnBwSc7n1pqt9aRGVYGf5OMK5O7ny2M8envWS/h/xb3gXMkSiKFCeWxuTvyPPpS7D5hLrTFbBRCy7Lq2fv8AnE/Oc5QnJDHO43yAT6bmplpQAqSzQwMgz8vOCDg5P087+DxUJpFvPbahEJNQcySSGSRmAONj+UZ49KkIr23g7LeVzA8krH8RKgJlTfyT4GfapRtcwk3jsoTEPpvJ7p9cxXCQPeQ3CoCApAJPe5zsu/Oft6Zp3ZtdRTRm8heKRQAwLZLDfJ52J961XDyQJ3WNniIDKsXBkkY5+s/5RS273k9qFt7YKSSJO1u8s2+5JOce9Xhrt90lSRton/asJt7Wcv3SFFTcEtkHOffn24prPbtG8UcSlyGzjP5uc+dvt4yaTTLiWX5kDzJL+FOGiBA7Sc7Zz9RG2PFO7iOdC88IYkxjBJ/I3kHfkjP3Jq3LslL/ANpq8phPACZJ2UlxkZ8hhsBzSSl7WUh5lywDHYEKxG4O/FbLlmLSzW4IiVj3ZPgDfO/gn9sVojMM+S8intBYqTuy7781EjdQOFMGhab3Uswhk+UQ3zGCuANmB888+tNu0wg9rjvI7fqOxHqf7VtK5ADxExhmyM5IBz7+OTTO5nggSUOXMYP0yj03/MPT3qBaAbCvBsUsJ++JO9cNKwJUHGJcZz5qrdXabYdcaI2mKq22pQEtayS8RS/5Cc/lPH3q02ySXCmNFyUPdGWOf054pvrEFs0aXMsJhn7u0MDjJ/8Ab1FJTMIcXBN6eTaR3C8z9Pa3PYdVz2WtxnTpdJLCaNsgq/AHPnnI8YqUvZr/AFG7utejcm0jZSSdt24GM8+tdU64+Fmg9bRrqy3IsdZjT5X4hRkSheFkXP1Y8Nziucy9F/EXp+0uLcKbizeMxu8H8QMh34O/68iogCVtFb8Osa42DRwDa2299NdxoqHhe05GSf1rHqWBF0DTNdNxmWzuvwMiE7hG3Ujf1rTonUbdP6W8MxiHc38TuQFgfAGdwKEs7vq2wurDSlVrppo5Yo+7ZiCPpG/vWXqdNTSOSRx7rVhmpwccNHX26r178L9Xl1roPRr+aXvkaAIzZzkqSuf2FW4DOKrPw86bm6U6N0nQpyvzbW3US9p2+YSSwH2Jx+lWUEnYHFen0wc2FgfzQtfK9cY3al5i/tJNfF4Snc42pdqQ4zkmg5I2FXJWkmfYUUYHrRU0Wjjkmql1V1BbMsulxTYCY+eQd/8A7R/erLqF4lhZTXjrkRKSAOc+BXJNYaS3t5biId8s7l2LHOPJ/wCKyvE9SYmbR15+Fq+FaUTy7ndOPlbL6774iFUKuPpjHp7+pqq65dC+BgjcuFwSo8Ec+ePFPZtTCxfPySccE7MccVAMzTB0dxFISWYj9dvtXjdZIZPT3XvdFpxH6j0VustVR4hLc/TbMAhIODsMHBz+nsDWF1LFJJ2KiSzMcQ5bCQKSdyAfqY+B71HWVytzARbW5ldh8uFS/aI+3OWO/wC1MIdUmtrmOSCUR5lMZkYhjK2+AozsPfxUDMYwAchRGmDnOIwVdtTkvf8ADvnWNl3R2ww4TAVNjkkZ3J8j3FUhJ72O7mYSrHdXBQohBMkseSSAQSF22x6CpKJ457eWOQFEV2M6NMSDzgsM7j1PsAK3ab1NdxyS3um21m9jahommm27nOdlOcnxsPG1TlmZqJBZIx8/woQxP07HBoB/j6Wb5UzcFpbFG0+FhIB3iJgGVlGcr2kj6dsgnnNVTUeo9Wv9YS00u6WGytwDJIYsAYz3A9xxznAG21bdX1iO1sZBq+r3trZXDrPHOLbLF9yEU+BxyKqn/wATan1fqS9O6lcYjuX7UhCCMyjJwDg5yR/TNR1OpGGAkE1gdfnsmfD9A47pHAFovJ6fHchTi3P/AMa66W0mSXUY7NikkgPbAjb7ZGzH2GcGuh6emoW1s8Om3dnZJHgOgg7znfYucAE+KqdlY6J0zdfJubZV+VH8tLW2uCIoxv8Am33b/fzUdrvXVn8xtK0/Amc5Hyh9MfOBkH6j6EnFPaeVmlt8p9R5AKp1Gnk17mxQt9AqiQK+V0OO0he8idr5YXiBYKmWI57iSTuD5pnPHoUjfMsdbFusJIUMhAJzucE7iuYydRaksMokvXQnIftJJYDPJHBqvap1dc3LxQiUoBhQSCARnjPpTJ8RZtwz8rkfgkm7Mntil06fqLpfRbmZLyRLiaUkpNGxQj1HoP0qJPxL02ySWO2jcs2cyTSlmx6cgbe3FVG70q+1e0MUWm3krEfSywvkHHOSN6Yab8OOu7poobrp+cwxtn5ryKuV9MFs5/Sq/wBxqDQjFD2CcZodE0Ezvs+5/wAKbf4g6tqNxLBZtcyxxKS7EkKq/cnf9K32VlFd2ySC3AeZh2sDgMxI854qRsuh9UjQqluVYfSVLqAB6DFLddGdXad8ttN0triIb9sdwvcv2yRkUzEHtFvsqqaTTXtiIb9VOx6Tp2m2zWzRhpyv1ywkkhvcZqM02zuu0TtPGYmyCck94z6eDUx0/FrNhYO2q6PcRyNucsrHGONif6Ux1G6gESxW9sLIA9xPGT7jNNFwoHj2WWwu3Ft3Z56JrqOq6T09bLEES372CiQHJ7jjzmms+sQXNqttcXZFy7D5So2WPHO9OU6Mstcje91y+WVowfw9tGx7UbAwx3yT7eKZxabDpUYA0oJLJs1z5IGPU7fvXLlqzQHQKz+gcNJLgclbrfRLnW1azm1Ufh7cK8pEeQTgYXJO59q06/Nb6Hpr3GoXafhkXAxGAG42AHGf61nd9SR6VpUlkSIpgfqGcBskZYnNUrVepbfXLiK0uZCba2UvLjclsADbP22rhkYwADkqUcEshsj0gqN6b6ts5NW1FLTUFkjlKSLbquDFjbOM+a7Vok/zLS2ubd8r2q23p/vXl7RW0a2+JM8Okyt868tWBhYEY7SDkb+a9AdJ391b2sEF0Ajj+Q7bbf2q7SEg2V3xGMbQAr581Z7tY5HATIAJ3xwdvetAlkN29y0ZdAe2M5wQP83PBqH1m8FvaCa1djl0YHPC5GaktN1JJ775ETLKjrk77Lxz7Gnd4caWGYyxt1hDTSs5tACI5T3gnzjkDfinViqQyxm5lRFSIuMnnJ2HNR894yX88ZHekCsqYOO3u/X1/amN5qU1zMlvJLFAUURBmGAoG+SQef8AiqQ7bZ5PRddEZOMCsqReZpJ5bhXUqVIdCd+3P0435quardCONFtZQIfmfxDjHcT6+ceMU+u7+OOKU24PdKVjUk4+kctzTJ0a4j751HaZUwQMYwDsf/X/AHocC4bT9V1gDDur2CbXU0lsxvbodyOwEajYLj8qjf13rfaXzyiMzkD5QIMvAIJyzc7nwKxvfrtnjiz2QBZVVtyzZIK4zyT/AEpqJnAW4+UZgThYgcDuAPPooqprnRvJPHRWUJGAdVKaP+FZJZ45JhK7FVEjbJnJyPJYjbt8bCpeaaDUHWG8iDwwMY0LbjvA3Y78D09SaqcPddaiiXly0ZkYuxXYHGfpG+wPrtTm0tLuGNoIQ8l1IGKqrYSMbnOc8kY+9DNU4HIwoP0wObz+FO6t1NpPToiFzKzkEtBbRgkyPvuxzjA963TdS6TqNvHeu0gumH8SOJ+1QN8qN8Eeh5O9RtzYzXSxzXVqWFtAX/DAjuUeWY5zucbehNNLbTLayt31C8njVXJAUHliDsBngf61e2WQkkHH4S5hioXd9+6m9Qu1aKG96fkkCNIEkVQRk77Ak7kb7/arBa6jfXCBJmPfE+XAOCTv78DbPjmq7p3VFvdFIZLgO1uCIlIUKvO4AO59M7+tTMevwS/OhMBvJypAYqM4JJw2NgP71ZEQHF4PPRUytdQYW8deql5UjlJtpZYu6Tb5SuT3Mc7c+OftimafhEJAWLMZK9wYE4GckHP/AE1DzLqscap/DhyGHcrZdVOeAOT/AO36U0UB4xbWKSs0bBRIWySd/GePWr2y7uRSp8muCpW7u5FkkMUIdMEsrHLHncb7eP6U0nkd1A7Qfm7EAfSF/fj+9ajNqbMIgiOIzhwcZdt/fNZRi/8AnlHtSSxJU92ACM+/H96rJySLV4aA0cLfYTrZSCGdSAVymf5l9Oeaw1CAXLOk8mSxycncDfBG/jzWwvBEwu3YzOh+s/2UZ2xWtbqCe5uAGJcfxFbO3bjBXmq5HDAd1UmNOS1RrKZ7UQ4McwODJ3bNg7HnY/2qSt7r5QiEkAIddyNjnyBv/Sms1wDEB29qFsNJzv4z71viQODp0iE9+HHad4z4I34pd7Ky1XA4ymmpdD9GdSky6hokDytzIo7H++VI3qmax0wnw01az1zpvTnNiGUydrF1jcHIyOQD71cb0ajZ3id8hQlcBs/RKPH2NZw6x81CkpDxEYcMMjHkEGl3yBwyKITcLpGEZtp5F9F0joTrzTOudJF/YyKs0ZCXMGfqiY78eh8HzVpQk4rjHSOmaF0x1KNd0uL5BvI/lXMcbHsdCQQwGcZB3/euxwyhwGVgQQCCOCPUVr6SbzY/VyOV5vxLTM08p8r+05H+k4wfajcc4pBhvNLgnnimVmI29TRRgUULtqL6kPbot2eQsfcf0NcXk1cvPJaTLt3EjJ2wfHPFdy1K0/GWFzbeZYmUfcjb+teOPiXqXUmnm+XRtSksJwfljYHDjIIOeN/Nee8de6La8CxwvV/piEapzorAODZXQ7mNWtjMkgaJGbO+OwjOc77Y96qR6z6MmvkZustJAQNEYhdK5dt/C5O2K8ldTy/E6bUbmBNc1Y394TbTW6TMDOGBBVlBwRjz6V0j4b/DnSOj9NgmvvlfjSoaaeQbB8HYE8AeteeiaJ3CxXdfQpfDv2cW50lk8ALv7a3YXFqRoWoW98kWWl+VLkknOcjYjPGT9qrV/wDETpG3lEFz1FYQXVuWCxvKQ8bHOQB4Pp9qqen3Onx9X2cGnXaQz3bfI7g4CsGyMkg4I5+1WDUfhH0xa6gj6qbOe5Z+9fnEAu4JOwYgt/oRV0+gMgqPISEc0cLqlsYsYUTr3WV5eQH5eq/LikbCdxKmZTnfnPnbO1WLSfifommWkFlc2xleFQIXMuYw2DgsM853p7d/Dzp3qCw77tIh8tSY5Q+w53DA4I9hVQ6g6N6S0awaXUdVt7FRsss1wIwx3/zHfPtSH/SpYnl7Dkj5TH/UtNPGI3g0D8Lo8Ou6XeXdld9TyDU47jvLrn+FDse0qAcc+f8AapddR6b6etX1CK0tfxzowN0+GlVTkhQSdhjyK8u9W9TyaG8FnoPUW6fWyqe9WG+Afb7eKkoNY646x00i30S/QBcfNkykL87hmwTn7EVx4mg6Anv1VkWmg1NDcQ3twK+FfNZ6qfUHvbnS7qWKOPIQBie9jnfnYVYPhb0xcauUm1mdsOO8qGxnzufXH9K5VonRHVFsDc6nrEMQLZMUYLkHfYscD9q9BfBzQ207SJ9XvLppWuz8uIyHZUXkjHkn+gqfh+jdJKHSD3TPiusj02lLYTngd10GxGn2UAt7SGFYxsMR7H+mT9yayn1pQ/4dbA5HrGCD9hz/ALVj3/NKw9sj9264OAP0HA+9bBbt85kkd2QjKoAEAHnfmvUhpoAYXg7bZL8nnlNRcw30hugSjp/DOSQB7Yzz706glus9r2zSKRsV3wPfena2NvPGoWL5S8Ftmx7ZO1bOz8FGRCZLrJwDHEO4fds4/WrGxkZtVPnaRTR9CtP/APHZCIlTuzhQMFv6/wCtZp+IG6uTnco52/T2rW9vKLyO4WNSVyGy2WOfTfBp+FBQx9wWQcMvA/T+1WsZZVL3gAdVELb3ktzKtzbJgEFCJDgj7eK2Npem6lE9ndSQSgjDRhSSON88/rUiIplPYmX7+Txj754rRPaKSGdZI3H5WQ759j/vUxpwOlqB1BJ5rsmsGgaTZdkENt84Abd8hUqPY+ajtf02MWTxafHIkp37JDlDx58VLlriBczuzr5YgAjj96yBWYBY3AHqAD/Q1YYhW2qXGTOBDybXLLvpu/uJZZNQ0aXBQAHIcbY3yDn/AJqmX3T+nWNpOLUfKkc5YscOp8c16KMMezPDjH8yrsf2NReqdM6bq0Ui3VpHMGGMSRg7befWl36MVY591ow+LFppwoY4XiPQbm10n43aUovBM5iuCzMcn8vkZ4yNq9BNdXct9FqKZCIO3AO2MCmNx/4ldJHrJOuLTUNZtLod4jgiuFeFe4AHCsMnbO2atl30DrljaRx6eTfrAoXA+iU4A3KnYn7URRmNtOTU2shncHA/dOre6kn024iNo84RPmgqM/TtnNV2TWzZXloLGfAnJQ4O2MZ9f2q69ONeadp3/wC/spYJX+kpIhBxxg+3Nc168ih04yy26GOSCX5sbLsCueOeR4qZZtAdaWhc2R5YrPBqdxaXLvckISFeN+4EEj9eae3d6JB85IRMWJkkLnAJOCcD19PauWXfUa3EHy1ue8vECzKSAGONufFWDpfqS4urFfrEksI7SGPPgH/vipUDwpPhc1tlW62a2+S8iyyO9wCI1J/KvoN/39q3R3Uk9lHAqgfKJaQ+O7wTvxVTF1PHNFaS35REJbsjAyud8d3rmn1vcq1vHNLekn5pjWAHJY+S2/FUhxINilAwAAZvqpRtQjkmMZ2MTHtY8Bjyx34Hin8EIFtL3RiK3faMscFhyXY+5/lHIqtvPeGa4HyD3OwHuEG+OefapW6le/mgha5LgR90qrsIwAffnH96654HyFX5RwBwU4n064nje6dHuBOflgwDBjiXkgZ/b7U4sLqzklFrZ20hCD6lkbHGd29PetendZwW6i0ijKKhyGUcgZwBvvnz61HXFpcXFtLcG8FvNqErGNVOCBvlmOdh61S5zHUWnPVDWPFh4odFZJhI8jzSXqQPEjENHuGO/wBOx3x9qaCdxDHfXMMRVMm1icZyd/qxnkHjNU+ze4t7Znn1QLEpZFKEs0jDOyDPH/t61shk1O7l+TZwGKIklwzEsRvuSOD7Cqm6sBwaBlTOjJBNilJ3V1Y2873FrJmRyZJCsIBDbjPdwB4zUnpmv3b2QOnaPMFcnMpYYc75PqTjxTefT41Eaib5cMTK8srbd2MnsAB48Y8VjcazPHctc6WkhSdiPkCMkE7gBRnY0yH7STdewCpLA4ba+pKmpNCj1gR3lrq8ttdoCAXOATvsRn6T/oKcCDUrFIpL6+gtmBKdpHeZBvkrjft9jVekGtx3arqOn3OmiZSwaQd8ko3wFAz2k+pp5p+o3lhcFtbvFtkhYiJ5T3uM5woxnOc71NkoJJojueFQ6J9VYI6BTM2o3Gnxu91FEkDFjHNG2cDf6SvIrLTdaS+tRJawSCMnBdxgHGd1B3x71qTp+x+RLfm/hRHJlEsr4L87EZ2+wFbzFHCpuo5QsYX8rHAbnjfbfgVawHdZdjsqzsI2gZ7pPlTzNKw7Iohvljyfbfg0yMwaMFIyu+GI/wBB6Cn1vKl3E7TMfmKcLGPPuN9zTO9S7jAiZxGp/MjLjuPoTnc1Y5u5oIXGOpxBWUUkNxpxWCRWSGTNxGdiM+m/GPNabdlt9RVVuyySkFCW3C52B3/ao4wTSXiIrPAWys2diyjgHfk1JWOkThmfvRx3ZjDHDrj9eBVIJsgjhXlgaMHnopG9a+E7y3dshVwAQH5UcHGf3qMl061vGNxbOQ4/PGdmA9x59zU20VtDbvPcygOFJYkktn7f2pguo2LWi3caKXAHcc4I34Jz+1JzM2uLgbHOVbA4loFZ4UFZ6kRFIsiOGt3KhvJGdvPP9q6F8O+sJb25GhXoUZQtC/ducblT+m4+xqmahHFK4e2Do8oy0gAKtxsy+v8ApUDbajf9PajBdunY8cgeNgfpYgjYex3FVxT+S8OBx1+FZqNM3VRFpGensV6XTxWR39aj9D1WDWtMt9Ttj/DuIxIB5GeQfcHI/SpDGOTjPpXpGkOFjqvFPaWOIOCEY9zRRt6n96K7SisJGA39K498X/hFZda29zfaJewWGpSjMizAiGVhwSRurbDfg+a63cse04qpa8ZO1gpNK6qJk8ZY8WE9oZ5NNKJYjRC4l/8ApoGs4NS1vSLe31lbdba5uImDnK7BlbyCAD61zzrnRVTR72DuBaH6SyjGQc429v8AWu5akLoBwrsBnjwa551xp73mnXfyowHdO51A5I3zXn9TpWsbbOy9z4Z4nJJIPMPUL5/dRa71p0D1DLfdN6u8DxOXRZFEsYbfDBWyAd+R5rlnUnxX+JF3qMmpa11Fe39y7EtLPKzHzxvsN/Fegvit06ZLmV0iIKk+PG+1cM1nQoZFdJIQCCQc1l6d5bg5C+jSQxTMDxQJHKf9F/8Ak/8AHXTJ00/T+t5XsYImK2V3Gstui7/lVuNznOfFdX6U+Enxb+OUSdUa2kwtb094vtUmZIypycxR8lfTAA9DVo/8Vf8AxS6TuNJh+KvxI003z3bFtF0mYERfLUkC5lX+bJB7VP04HceRXsP8BcyJGkEYAChY40UABRwABsAPAG1axmIADBleJ1EcTZTZxfwFzz4XfBvRehLNJOoNXm6l1KMBY5LiMCKADhY15OP8xyav1z8q5YgxqiAYAzwPfwKm7HoyaaMtNJMJDzg4A52/5pzH8NUmd2u766EZGAqy4A581bHoZJMkcpJ+vhj4dwuY60EmaPT7H888ixRgf5mbH7b12/T7aPp/SobK3tSWtoUjQk5BIGDgenNVFvhhp1lrNjqFrJfNJbziZQ8/cjEZ5Bro1pYxq4lmy87AjtYnCjfOfG9TGmOncQeVRqtdHOxpBJA6e616aBcN811lkdhyDgY8nY4AqUE8USfT8ty25+Wwcj3JOw/1rCDToGWSPD9jbOhJCecbcihVgjuksTF2t2kxopAjKjk7f0zVu7YBXVZUj2yONcDos44ZbpQ5UCEflMjEg+4Hke5p5GjxDJdpc8A4UfcAVkrqAFc5IOAPJPvSrdQ5cRKXYZAHofermADJOUo97ncDCwW2jIdirsTuWY4UfatFnJ+KBSHMMSEjPZhmxyVJ8e9Ok+dJj5yZxwoOB+tY/i0UlLmePPAWME/vUryDdD8qG40aytscttIcRsHCDDDJI/fya3iJW7Wzv4ycYpnNerbRKVtmJZu1AcKD7kVidVj+WwVO8qPyxb5Pge29S84NNE5VflufkcJ5NZRyDBUEngE7f60xn09GcEMABz2nY/f2qMj1LXbiRo1tnVvMjbBV22yeP0p5Yw3Kwj50pJJziDcHjzVP7rzOAVcIDFyQsJoniYq0mFH5Tvk/pWlWgXd+4sf5WJyPfmpHEyOrnFui+WbLfqKHSO6YYi+YB/OQABxx6ipsc45UdyZKpmXtiijaVdwSSuB961yG5fO4DAcHwfTPNOmmhVBBaoXkzhuwbLxWv5BL/LkdVIGcEnJ+1S8xhwT9V0bhlNhdatAO6VInjHIJ7wOOc1AdS9L9OdWWki3tm9pK6kGe1wQM/wCZDsRVlm7IEHzUYIPOcmtEqw9yMrFS/wCU5xn9eKuDARV2utmLXWMHuF5r6n+DnWPS8ct9YSRavpceWE1qT82Nf/aM75+2aqvRnUyx6rOqOShOBg7Z/wBx/vXrfskgdpkTux+ft2P7eD/rVK174XdEa5NNevoUdtcXDdxuLU/KcP8A5gRtk+QRVboSKLVpReJbwWzC/cLj66nML82rzZEzd6tnJG++P7VYI/4E0TN3OZEYkLn6WB2HPkbmjqH4Sa5bLHcdP3DX80TZMDqElIH8w/lbPoKqWt6r1BZWUthc2s1mYj3SB0KsWHHO+KR1G6MXXVaELmTf2ldMhvja6ZL8tw85BMeTkljy39qjbad4IHuLq4KFlKtGD9UjnO/PGNqqmj9UQ2kVvqEqtOzqCVY7d2Nv/wAVLLrtrqMBcxBJlZnklU7EHP0+wpGeUB13mk3DAdpFYvlWPTrh7LtuktVmkYFI3f8ALGeTgeSNsVnDbX13dyPczu6PksF2O+fGdhjmobT+qI1jgZ2RlVhHCrbAMSd/0zVuEvT8NpPBE8hvW+qS4EmSTg529PSo/uI6AJ+6i+GRhOM9wl0vRra+ZoXlt7FI1I7CNwm/5T6n+1Z2/Vlhp07adp1zb2dtaZYyyqCZGGcHB3J/pSfj9M1GwWLTWW1S1HddXEv5mO+ceufSheltP6pmS8trZLeG3GRPO2DKd8Er6c88VHcZaERF9+6o2htmYGu3b3ST9U9J2tsj3d7NPcNIZWJjIjxvtjyDj96k7Dr+21KNpdNgMXYTEjGIRohGdwzcc5wKh5bGx/ESw6rqCyQwErmNAe479qqB5/8AY1PRdN9LS2ts0mhs4XJCz3faVzn6nAON9v60zC6TIDgPz90vPHAKJaT7/wDCBqGpRORDq1tdXM+zxxAynfILFmPgeB6U4a8sJrqOzvIR2QKTECO5mffuJ9DscUJoOhWnzYbX5enYBkaWJzKWG+AoHH2p/qdrNZ2ANvcwQxXXb2mODN1IN8E53Bpn+rtNnH3SZMW4ADP2W236W6e1+H8VqcYUhsqkshDAb4bGea03/Tvy79ZjqjXbMAsEAAUIozucHcY81jeWTp8iK5v0uZ3GVtlh+vG/5mzsRWQs7wSRJbXKNIVYTKowcHOyjPI4JpgObtrbnFnqqNjr3b8Hgdluv7zT7EJbxKLjsXtaO3XAU7/zVX9QF3dAXZvY4bSJu4GViWQjfA/vUyjXGm2Ythp5JZiUjYZdlycs3namlwglBkh085UEu8mD2/8A+vr7VJzy7/SlExsZ7+6h7OVGb5n4pXLMZP4mQ0npz6HgU706XUVtRDLEZ5XmJSUNjtX155p5FpcX4aPvea5Mj/MWTA7lHoMbAVK9yOkVtFA0cAbtZ1HB9BUNuLJVzpB0FhRt4/yeyISRMGI+aAc/LP8AmG/HrTO0so7t5ysZVlPy2cDCyA8HH9/SpS5tRNI1va2IRDgSSOMZHoM81sk+bAHe2QGQxjCt6r/fFRdFusnhDZKA28laopCJxbz28TFIx3hT/LsMj0Fb57LS5bc2cawlX5jmXuA439qa2oCmK/dikjExEsPzAjz9jWSwy24MlvEWkJy8RO5PqM8iki2rBU7sijX4Vp+G97DpyydNyzAYYvApYnGdyoJ/cfrXQF35rjWm62La+hup4TiNlY/SR+XHHoRvtXYLSeO5gjuEOVkUOvuCMj+hrX8Pl3s2Hkfhee8Vg8uTzAOfyt9FLv8A5/6UVorKTWdMrvneoLVLbuUnt/pVjlHcOKj7y370Oare2wrI3bSuf6jpwOfp3qoazpQdWIXcAjGP6V06+s852zVa1Kx2I7f+KQmhsUtrS6gtIIK8i/F3oZLYSaxHbj5TllwRurHOx/3rhXTvwjuOuOtbDRmhKW086tduo2jt1OZCT6YBAPqRXurrzo+36l0e50qSZrdphhZUUEqfGx5rmnQHQWofDybVrfUtYgvW1BolglWPsKQr3FlIPkkjb2rz80R0ziawvoWg8V/dafYD6xivburVcS29s8VraQCG3hRYYY0GBFGowqgegAAAq49MqwZQmGkcfzbkD+wrmVvc3Woa2NPtJmn75QqKqfU252+/pXoix0a30qCD8NYRwKFAkGMsTjlj6+tOeGsMpLz0WR4xKNMBHySFlbo6RdsmWB3JxxTkBJTkrnGy5HFSEAV8KFAyPSm11IkXcUxgbH+tb7T2Xky+ybCjA7vqqxtF/CiXuLejE1LNf2yn8HcW00SkfS7qO084wfFM7X5ZEs7lQJGwA3BAHj3prDqGntPMl7I7PkfJ7iSGG+wHrWTqJSJDZGU6yPe0GjjtynizwPDE8Ej7MY3jc4YHJ3/9gfXzWhrkx6ndW04LSJGhjwOVP/cn7U21+wGpmK5ikltngHdFMNmRgcgt6j2pnpF/rOt30+rTQJFGuIIU7cFwv5nJPAJ3ApIyHzAyuuK7d00yIGMvvFZvkdgp6Ke7VQLiNPnkFQUOe5PJPgGnSfJhgZifkQoMkAZc/fzTSS8itrdrjACKO5iRkYHp+uwFNYJJ5mW4lmaFpT3liMkZ4GPXH7U+HEU0ZKSLdwJOAnzzwXsSQ3TGKEnKx9xDnHk43Ap7bmGJO23gCqBkt28j1ydyajYjbx3DTxRN9Ry2dy+POfAFJddTCPGn6VAst1LnC5z2DyzH1q1r2xN3SEX/AO8Kl0b5SGsBr7fdP3V5FZr+6ito3GBnBcj7nzTdIVEYW2cQWcZ3c7l/180yXSTPFHNqN8LqZG+nt2QcHAp86RYQTzqoGAik88cDzUA1z3W4V2UjtYKab/CwuI7LUMIBLKqnLRqxCkbf0rbmYKqWkAhjUYyTwNtlArXPdWGnYWeTtec9qoBlm9gB4pZNWEX8C2tJZ3QAYRdhxyTXAI2WXc+y4S99Box8pwk6oFgdw2TurHJPHPoKbXFzNKzWtnEezy7tgDjitOl2F7cPKwtFWWU90hL5G52GfT2Fbri1likEUkwjce5wOP2+1TG6RgNEAqJa1jyAQSsbazitSxEYEpH1EZGeNh6Cso5Z5k/jokAVsqOTnbk8jNaZXkgUYlDkgEqpJA48+aBdtEglAEgc9vYRuD6k+lT8tgAFUB0XNzueSVIGNJ8GSNgRwDgEe4NN5dIQp3W7jDf/AEmJBJ249P8ASm0d39AiCHB2xuQB5FbIS7OOxPmBAMsZCCV/yn1q0Cs0qrPdMgt3bt2y2zFCcHtfLL7/AGpCiSOQAST9Jz/N/wAVKydkhAwQMY+rBJ9jjxTeW1VEDDIQnZs5I9vt/pXQ/bzwptN8cqGltWcHD97RNsG2KnwM+Pv5qH6i0LS+qLc22t6cbkKMcYlUeobz+tWadI8mRecYB8kf/wDX+tR5ghdX/h95yQSGOc+h9PvQafhMMeWm+y87fED4f630Xpd7rGj51DRolZ2kAzLaZ5+Yg3x/7Cqj8PusLTUIxY20kd1MFzhWBGTn6mPABr1c1jHIWkjZh9JVmI7jgjBVlOzDxvVF1z4M9I3NrPJ0/olloeqt3PHcWcfZFOxye2RRsAfUcE1k6rQud6o/st7ReJsaNkufdc/hh0GxnEGvRlp5GLRGN8RKTn080xveq7LQOoEu9ILziAZKlu8A78ng/bxVJ1jROvp+pRoWoaZdWSRSYd5QQGxndT/N+niumaB0FFOIrLWNXt7eIDJigQdzc7sx8+tedkikl9LhRBwV6Nk0MYDr3AjI5wpTTfi7o+r2hju7S2gvUbubCgIw33/Tn71C6z8R7q7u54tEmnnnuSUMcOSW5ACgeuOax1/4UdGdO3kurWuoXly0uyWruCsR3+rbc/8ANP8ASo+j9Niga20QQyI3dJOkpWRn3zhvQn9qXd57SWSPArr3VrG6UjzIWXfQ9FN6dBeW1lZW2tWd5LqQVp3ihBUL3AnEjecDAI+9Z2jzXt41jbo9wJpCHmJZLaA75yeWI9atXSHVX+IiaOK3EEAJSJxlnkJz9OTuef6ipzUdJv7exeS8iSCyXiG3QGWTnbbgZ88+a1IoBKwPYbHVYs2pMUhZI0AnhMtOv4tAEehaVOZZyrPIY1LsWGQc52UH+gqwaVPqlhHNqtzZL89gREsjd5iBzv6b/vUXAzRQRIlilm7phYIwGmK77lh/XNOY9IS3kNxe3N5OjtsplxHExztt6bfrWxETQ2lY8zGmw4Z69ys7yOZLYy3Gn3YuJT8w3GSATvjPoPbmmltFqt0ndc2k8NtI4ZrlGCmQgkAdp3Hj9KmLGJNUkeV9RlukgbCqzfShGcbfzH0NPrhdRkcSW4inKHDSTYCxqc8LwTjz4q5sf/lZ/wBpZ0pb6aF/hR5ftv3uBLHJOcLIq9z9qgYAJ44wTinhWWdi8VvmNx2yytsjKfQ+D704toPo+VbRssbEh3B2OdyB7n9qdtHYwyhwCAihBD3ZAPjI4z7eabjBOScJSR1EACyFHtotrKBcsssUQRVEayZUKPJxyaQWzpLFBGyJbwjuj3yJPufT3p3eSXUTPCZA7ycRhcAD028VqtbCZe1jemR2XtKCMdgXPn3FVPI3UB8qbbDLcfhM5J5r+8lW2wxiADNjIJ/3pbOPskE1zEiMAe8uDg++PapeSzETI0Ddrop2AH1r5BHitFrA6xyanPATI5+hX37VG2T70Fx4J/0uh7S3A/3aZSWRkge6unQoxAXAwO3IA/Wo29jtrQBZe9JyQEbJx4xv6f3p3fXrmJreNk7GPcQFJK8eP7VC3txGYxatcvMiqD/EGCvHFJeYHGqTbY3AWT9FlqE1y1pKscQd1w7Ark7YyV9+MiujdAdTW/UekBYyDLaBYpAODgDBH3A/cGuWwXfzHRDIfmRbBgfzL6/98E1KfCfqCyXqe9s7dlSO+c4jG3aw3G3vhqtgl8mducOwf8JXWafz9O/GW5v8rs/f70VhhvT+tFb1ry20JSM/rWqSPI9a2jc/ekKjegoBpRV1aBgSRuf61AajpbEEqM1cJI+7O1Mbi2BBBGarcy1fHKRwuX6no8ruQF84rh/VnUeJ5IYYW+chljJPCqCfqA5yQD/pXqq609Mk/LyRk4xnNeQfibJB+JfU7WJrWIzswUkfMP1EngeD496wfF4wGD5Xtv0tJ5krrHA5V6+Ami92rX+u3EPcyBYoCVye5t2P3xge2a728LyxMGXACk/b71UfhLpsGkdGaTmDE93apdTnG5eUd7E++4H2FdBihjmXDKSvkeDTuii8uEMWV4xq/wBxqnPHAND4CrouGkjKRt2MFIc+mM5/eoe7kjTuDzOSOR481YOoo007uuYYx2NhZABuBwDVd1F4ZYiwTAQbnHHP0+9MBxbYPISsYDgHdCnekQ301sHi7EjYns7+SMnfHv5rQTZag09hfWb/ADo3wTCMnu3wynnPvxUlawve2XYkrohjAjEfOcHA+1aZZNMhQuEe3u0QxyFWAIznJJ9PesWV2dziK62tBjtxIAz0pRTHVdWuotPtr947SMMZJpIR8yQgkYxxn3NZX13b2UiaXFeMqIvfKxO4UepHk1lpOtaTLdXPyZ1e2gjEffF9QQjJbLY33/1qr2CT61e3eqmErFdSlYQd/wCGpIH6eaWbJdFpsk/wn2x5IeKAA6ckq1LcfihF9J+QSJAG8gcd3tWdxrOnL8xhOJpUBCpFuc/8/wBKY3M2Bb6dNnvlbtcLsQg2GfvzU7a6fo9hbOYo40CL3NIBwMefc+a0mbnXtIFck/4WdKGMrcCb4A/yo6wkv7q3jmuYTFJKc/Lz/L4B/StX+I2rS3MOliCDsOJ7qRdieMAeTmtEOpS6haO8KvGLlzFGVzlUBxkfen9po2mabEJJ8OybjuGQp9h5+9SEL5ANpx1J/wAKDpWRk7hnoB/lYRaSjRiSWaZiq9zHuxk7b48e1Sml2tspFwkWXG3c5JZftmm0cjSsfw8eDnLPI3H3Hr7UpeRAFieS5kPEafQp48+B70wAyKqF0lnOfJi+VJIpy8zoneH+g4yQNuD71sWe2LGMuqRRHDBeXbbI+1Ql3qVzZ6eJiU+cuy43AYkbD1A801tNUt7WQXNzcRxMfzBge1jtuBjgc1U6drXhtV1NrrdO4tLrvsrJFfStK/yYflQxDHYB9ZJxW1YXuV+TcAIwIb5n+Ubb58n/AGpnp7K0QuonJklPzFc8Hcc+gHinZ1GBWVvp7gcwwk4BOwySeRTW4MaC48pctJcQ0LXcwWiuVhkHYmAB58bim6WkxDlEXsI4YZBP9qk4YLXD3JdHZh3Ow2IbbZR+1M5ZOyJRJMYw2yhVyDuDk/bPFSyAHOpQBvAv6qLaOaL+KULEEAhhgY2/pW+ad0IMcnaRsu3NbbiCWaaNQSpiy8hkGDjHJHoPFMxB3yFRIC+3cDwF2wfeuM5LicK2gQB1Wme/cKApRHXJYAHLfr4pUmnuIw8OQBvv5PvW6Rre1tHleRCQSGYnI8YFN0uYoYw2GVSMrtvVILJCc2FdRaBQpDRvJ9U9vnG+Vzke4PrTSe1llkR4yUc5Uk//AFF9D7imqa3cXFw8MBKoWySeVHqKkUMc6EuhLJk/ScHPtXWttvpGFIksNFNkW4SQw3EHcMZSaNwCPZhWJvLgsP4aZU4ZSv5vY/707eMSRiQZVgMgMNx96ayRDAmYdrSEgj+VscgHwalhuCUA3mky1+z07X7MQXMMVyEOTC+0kZ9VblTXL9e6ZvOlxPqWmTz31sFLyQsuZ4efqOPzAe29daMJDF+2Mgj6e8Zz7A8g/fxWAhIIdLNQiju+Yrd3bzvjkH248UlrNI3UDPPdaei1p03HHZc66J6n0DXbUS3EUEnZ9E/cvcCd8MPIB3z6VKdQfDzpHWLC5udItTbXkikxNFIQobfA7eAPX0p7dfDLSVvZtd6aSGyvLoFpol2trg7nOP5GPnG2ar1pN1RZdRrbNai1iibEgnOFkO/DcHPtWPJCYmCOZoIOLpbMconcZYHlpGSCf4VZ6V1jqPoTVotO1+xaOOKUyRORsVORlT/UV0yw6uv7559XtIYzGz9rSSyZCqAdlXxtyfWpHqDpu26n0swXwiEuCYhGclW33zVUs/hjq9lbp8jVkMhP8SEqcLzuDwx/TekRBq9MdkJJZyM8JzztFq27p6a/g4u10rRnhv4ZryG4WJAD3ydvJwefQeMU5intT2S6iI0tYj2xkIVWRz/My+RVE0C01GxuX0vWbvERJdRECBKcHdj4GKsaNNCZJrWznvO1u2GKQjAbfgHx6VrafVPLBYojn5WJq9G1sh2usdOmFYNRiEUDJpK2sFzLundGT385OB5x68UsNlFDaLJdmQqgyyncsx5P2zwKbjUo9PhaeaFxdFO6SN9mJGRsccePenmkrrF3arqmo20YjlOY4IwAUXfcn1xtitNjw9+Oa46BZL2OjZZOL56lOYYiCZYy0SBCeznI9fTJ9q3GK1tbd5gndKwUIZNwrHwPt5PrWi2uRBEWvZIYwZCAM4ES78+9PJI7OU/N+YpgAGCd1wPTHrTLTY90o8EHN0lFtbxN+IuJFeeYBQVHI9APT3rYtq3aIR9PlwBkk+Bn0rZHHHcSK3ynUAdwDjcgefYDwK0S3M1np8t0VWTtJIMhwMZwCTU6AyeFRuc7AKaalG0cZljhkkmGAFUgFt8YyfFY3No8dkY72RkkYZIBz2nxj196SK4+bdwG4mWVR/HkkX8hAGwFVP4gfFDp/pyQvqOoxW7Ff4UbMO9h5IXkk0rI6NoLiavonoI5ZXCNgs8qama3tVChvrcDAG3HlvvXFfjZ1/pfRl7pMct+Y7i8+YQigs7IMAkgb4ztmqjr/wD5F6jd6q1h09owm8rLcN2Rkbfyj6mx6bVzPW113qfX26i1+c3d5KFHcVwqIv5UVf5QM7DydzWTNOHimBep8P8ACnseHznFcLotp8U+qNb1G1h6e0VEswrCWW6/+bKCuMIo2XHIJ3OKlOhbjUOlertM1/UNSeQTSIVlJIMiggMrL4YDIP8AzVQ6Yee3vIB8v5QiIyPU5GRn/u9dO13QRqdtaalbQ4e3PdKoH51IALgevH/RVT2+ZHvBJLSCEzKxkDvKoBrgQvWsciSRrIkoKsAwOeQaK4ZpY+I0emWaWzyiJYIxGPm/y9ox/SitceM//WfsvDHwPP8A3Wru3bzQc+KCAKAP2reXn1iy7VrdARxz4rbtj+1YspNcItdBpM3h3zjOK8S/ErS5m+JK6BG3ebnVfwCKQcAtIBjGOcNnPsK9xuua4T8YuibNfiJ0/wBX28AH4aeG6uFUbs4kEYfjkBhn7VmeJQeYwO7EfZel/TuuGmne0/8AkDXyOFc7BEtrcWi5RY/4a48Kuyj9ABVqsZYZLVBFKPmIMYzk5Ht5Fcn1bqe706RFtoPnHPa6kn34OP0qwaL1BEiOJojFcgBnSRt0BBwTjbGN80aeQA0q9VpnuG7urRqduvypLi7miMcmVYOcjt3z9j7VQNXvoWMqfilSEAqDjGxz9IFS2tamL2NU+aCiAgAbZ5yceT71UNUsu/tkSIkhgcY3O/n71a87mkt6KWnj2UHnKt8X47/BC+mW3dLHCRErv2nGDnJHk1TNQ0xus5tH0LTvnWkRZp9WKEiRlX/6eedz/Srvod1duhtVhzg4JI3XGcknHA8etQmkWN7o19dzQTdjSzMXnK57YsnYbbknP25ry+pj8xzC6yDg/TOFt6aTyt5bQcOPqKyl6gt7fSunrnSdMtSjyD8NBFEuFXJwWO3g53p9p9nb6fb22jwuFkt40LudgDjnjxTiO0jv+6JCSImE02OcjPZGDjcA7k+TVd6oW5k1m4s7ORj3WaRMUzgEnLDOOcZ/erj/AEB5gGDQACgwmc+U40eST9Flpt3Ld6yLpwptJnZYjg5CrsG44JyRWOt3Mur6jHotjO8Vu5/i9vLAHcfan1pp4hhhkhhKKsYWKN9sJxgn9K06bp9xPf3OsR24lGPkQqowGI/MfsOPemooiWBt2SbPwqZZWh5fXAofKdnUbewuF021sJJXiCqGC/w0Hpnz/apN5bYxj5kjySY2SMZYH0HoKbxmZyGkYEJsQFwFJ9B5rTDbXHzDaQxGJQcuwySQTtv5/TitJgc0kk2DwOyzHhrgKGRye603FvrmpGOO07LGAt4JJIGC3cR59vWtsmoQQXv4b5/c6AKqA8cc49fNPJZGlmjt3k+XFb4VY1O5bbJYjxTm1stMsRNI+noY5FwtwR+YnAwSR5O/6VFkZDjIDj3XXTANDCL+PdM7V1uiJHjaZlUuWIwsaDG+KdtpdtO8McrK4lIIYDIAwCPt9qZx6jBpyGG3hMjyqV7iMAbjJ/XjPtWu1vLkYtYYVV3IERkJwp2zg+2xzVu8dr+igWnJBr6qUu0ubYPCpiij7grfMOA3GwNMmvZZL6Gz1qxM0MeyBR2nG2Pv4zvxWye8mv7a5t71e0W4AErDdpRj6l23B4/WmS6u80Yi1KH5gGAhjGMHbHceCT61Fzg+twoIY0gUMn2VkW/jRUkSMwwkhYywwTjGyj396jv8Wvo5mjurWa3hj+uM9pzHnBG+Nyd/tUJqWvzukEP4dpZXYLEGU4UDGDx4/wBKwj17XUhkiNgTImC89xJmPG24B/Wq3vLnUAaHZSZCGts1Z7lWO3vo7m0kmt/mNdPhTE2zA7b5I3z/AEqJuEutQuZhBBLEIsR26qCCTt3ZOOOK02Qv7t0vdUmLiPf5aAqAuB/MN96cahf2dvE8cDShWIVVDYCnb6s4yftUpCzywH4HbuiNpa87MlansrGzhWaaSYysw/hOD2EjGQBjgePWn13fwd4hjgMsgQMUUDI4xn/u1QF5e3t7MZ8rdzQKI4yq7Dj6iMcehp4XtFSPDuSI83IU/Uzn0OP0qqGRpxGKCtlYcF5srVJHCZkcRCzmdvqAYFT+vj3NPLdXm71t+1wmxPgn0+1Mjpqzhb647xAxKqAMnA8MeFo/HxWqSJYERZUBEbcsffbf7frV2/YPUcfyq9u/jn+E9u5JwgVIJ/mfygsMZ/v9qZp3yRSp2shDZkjO4DDhhtTWy1DVLmWSK9RgyjIbtOAONsjx6jmnlvMF74pYWOQytKBnII87f/ilcPPmElMAFg20PonaIYUUSqSjgDPgex9vQ0iAm5ZPmFJUPgYzng+/uK0W8wtkS2+f804IAY7lft6U9cRyYliIMijDAem/9qaY4EClUQWk2sXVvkshwURj3dq4K55B9RWxLKFozHLGksEqkNFJuCDnPb/uN60zukhMpRlCrudwSvv6it7XMQiwQhHaGjYcg74wMbiq3hptWMkdQATP/CZrCFxp8ryCPJETHLBd8BT/ADY8CoFzrd07Pp7pIjMc97dpjO//AHFW9bp8AoqK7jHd25Xu3/Y1Ea41zFAbi1WOK4R8SKRhZMjYk+D/AO1ZmpiDRYJAHQLU0eoc521wBJ6lMZLm+09I2d453Bw0aIW7c5yRsc+tSdjqGjnvlWISyZJkllcqQ2/A/lPtVSHXdtZvKl9G0E0WVaNhhs7+fI9D5qBl+IelCWcG3hf8QcseCf2rP/eRxnn7rWHhss4/tPyCurrqGh6lGyFjNdouYXlY9pxnb7D3pP8AG5zLHp+nh57gjdM4RTvnHjA9aoena7pepotrEixqR3BhsR6f9NP1vr6/u4NLtLkRiHJLKPqbAOd8b/6U2zWbgK69uqSf4cIyQbx0PAVsbSJbqZ7jVrxJNwiQQn6FJPJPmrBa29ppkscSuHwNlLfR3euP+4qqWYWUwSyXTNAmS0KjDF/dvIqRj16wshLbvbo6TnZSclD7H0H+tPwysZkivcrK1Mcj/SCSB0AoK2/iY7jvKSAsp+twcKBjYY8itEtzZwW4mv3WaN90iOMD1JFU19dtIyflSv8Aqef25rjHxm+Msuj3o6Y0S9Q6lMoaWTGVtUP5SwH858DxzUpPEWsbxZVWm8IkneGA0F13qzr3QdBLSfOTMoxFaxnLu3oq+h8muT2nQH/xfq911P1FG0tzdv3KrZxGg/KinwAPTmucdPPF+KXUb7Uri/upD3NKSzMT/wDcePsK6tpnWDW9oIRDL2YAwxz+g80k3Used0vHQLcbon6Ru2A2eCVvufgl0nfWD3EFo0c8P1LLGcMnqft655rmnUmlx6RZRS25MiQy9jShSARwG48mr1rfxc02xtJdFe9toL6WPuNqZQJXUkYZl5Arm+v9Y2n+HD/GdVgtoZcIvzGCBjyNsfUQP2pefUxyGoxWFqeH6bVDMxJF4HsmljqgF2jFQGyABjGK69o+qxGbT9Hnkf8AEz2vzWCjPy0ZgFyPUknb0NcV6ek0rUO6a1vDfPFhlVBhAMjBd2wMev2rtfwc6WuOo+pk6luV+fBCyG4uCQIyUAKxRj+bcDPgAZ81Vpd75AxuST/Cu8WMUMLpH4DQfv2Xo6x6V0i1sre1Hzj8mJI8lzvgAUU+/GD3or2I08fYL5MdRNfJUr+xo4FBz7Yo4GwplKJDnn1pSMjejGfO9LQhajgZzVJ+I0CmO3vRF3v2vAVxkFThsffK5q6v5qtdcWputEZ0lVHgkSRSTgZ4x996o1A3MITWjfsmBK4v1LqkmhXVvP8AhBNHcYXLD/5QOck7cgVdodJ0a6ggMwcn5aKskOQ5BBOGOOCAcDwTXNusbi51hpYCyolpB2hiMA4bk7c5/wB6iLvrWfTtKSxsbmWSVYRCztwo3yqjyPc+nvWDFrWMe4OF9l7Y+HyamFmw0eqtmr9Q6R09cG+V5pbUtvCxy6qSd845p3b9VaRrUsSaTOG+awGwww3PjHj+tcktbPqLrCaWCMoAgLO0hwijcAHbcnjNRvS2kajoHxD0O9l1FhbfjFjK4PY6tlRtjjJxirG6iQtJAoFXy+GwtFF1vaF6f0KSN7i5N2vyxEO0gnCsozuf6/fFOdGu7fVZbu/llj+VEWSJBjZcHL4xzTSC0+dGIZVyksrd4PhR4zituqRDRbBZY4Y/n3JEcEKrjuJzjIxwAc0k0vYA4iwLJ+vCzJAx7i0HJoD6LVo10lpaXE/ySjNMxjjI+pgSQABjgmm1gqXbPbNEFa6mzK4G3aDvk49iBUpY6XEiobt3lnVu+STJBL4O3sBxtTKaO8jSSRI4xEI8xtHt82RjgDGMgAVa1pDW7uAOEb2uc6uT1UVqdy2qamui2hY2cRYuwODKF4UH0HrUx/iNrpGnRCYoikZ7FGGffwPApmmmpb3kNwv0CJGjCDkk/m8b4/rTm/0y1l00z3IWJmlUfOc/kXydxVumbKGufYuzz0Cq1JjcWMztFcckqPN/IsP+IxRsxuJMnHhfQ7f6VpWS9urgXUMsltBCDHG7Hc5/MSMYxWWn2iC4+cJXFs57YFPHbnBIGPNTM1pp6KLCVjIJF3RRsBzjNNNjEjQXn6e6oe/y3ENH1TeyEGnI8lzhn7Qys24kXbnbjNRt9eyI8cV/qAaB3ykaLgKu2TjHgZA9c1r1CG71PTnitWSJ4v4EKEEntyM528jP2rBNNjW+T50RlSOJO4EYLAYwONv+KlTnkNqmjhRG1g3E2TyntnqEEhl1G9gCI7qlurqSiqMBSwA4ArfctZdwa4czxqMs0TABmwCvb5UU4t76W+sJnBhiichGidMgAY9tiM8e+arWqGARCC3lDOpx2Kc44yDt5pmNwe2xwlywh2R9lIJBqWoOq2KAmMjZmyEGQASTz4pnqCXOlXq2+tRkwA90fyD9Lnbf7Z5rK3e5s44p7SUySFe7CHBPH0nx+pqIudX1XV9QWO9smSCIfV3DZRsM8b/bxVWoBBa1oySr4Ou4igPqnq9RxzRGZ7YSOX7YpANxsNjtximr6rLNJHHd/XA5/wDlglMbDYe3v+1OU0FJ7SaTS0kIGHnZuFG3nH+lMJtJtWtf8Qn1MB+7tCsO4tjH/RQ8mIAPNrrQx5JaFsude1J1FsRLDbIQFWEYZV2weNzTy11K2t3Z5bR5MKPko3MfH1EY3Jpq+pJaWBS2tRJOBvM+5HGMbc1G2ut2oBBs2Wc/m79wx29thn7VW9oc4ED6kKbT6SD/AAVYEmjvLpJY5iARiR02yB428jisRqSW0h/D2jtKDiNWUkg/5iANz7VD2Gpy204vJ7X50cRykajA7/fbdRW+76izI94dr1V7gVGD/wDbxtj1pd87W44PwrWwOd0sV3UrdQazFbSQiUwG5IeVPb14/oKztrEysiJGhRN2EjAAk+DtkZ5qnz9Ta/eRi9SzlMKE9spBwD5wMb1ts+o9X1SeP5ulWkFpbHMskjMDIfTA3JP+WlpNUxpyD7WrmaWSrBHurzb2ii5uAl00s0S5chiwjHodtsVlY3ZDmVUxbyd0W67ynfBG3k1ES3erxWqx22myIl3ukSL2u4xszMeAfSnti000MLzW6QYcqyMd0IG7AnnGNlFT8/cKaCPooeTWXEG0likepTRXc9n8t4WZADkHbkccGpo2scsoJygUZyNiRTfStNmuXN7bgiEOxYNhQefq3AznnFSEsrGX5/y1Hadgu+fvir4CBGL6qqYkyU3om9yYQyRwvG/e2GVj9WDncDH+ta7e1fvZfw/YYyR2gbfpt5p07wRSd7rDG8o2AXc59fTNJE7KxVs5I+k45G/t4oDg5xygAhmAsLe5kcyRPZ4jjPaSCDnzxWq/7LhO11V43Uoccjz/AM1ulQRvLNAv1suWHhsZ/r/tTK0M0l0JjCTFIO4MvAODlWHiqpHbhtOVfEADvGKXMOu+k01wNZXs8ttNCG+RcRY7gN9iDsw/9f2rzu51XRutr3p/V79GFqAYmTZZFYZV/Y48eDtXrT4g6ZJHPbalbEkN9BHgMvA/UV59+M3QNvc6PddZaNbsNZ04GdxGCTdQ8spGOQN1xvsRXndVo9ryQOF7jwrxAPiDScH+Cnek6hLAomS7JZD+ZG8epH+tW7TviNPpDfOnjjdGHb8xQMgHx7V5n6V+KttqenMluWMmCAGGCDvz+tXLRxf6pAmZ3LOO4gHYDel2MlZlhop6VkMv/cFhegYfidbSJ3BvlmT82PNPoNZF3GksDl0O4I3/AENcq6d0a9tZEmciaLyGXJHuB/aujdPskcnyRCOwfVsMAevimo/OeaeVkauKCIHywoP4q9fah0d082oW6CXUbtxbWMRGQZDuXYeijc+pwK5H0Z0xf6rdNqOql7m4uHMs8suS0jHcsT6/6cVbprG/6x6hl1bqGcSLFI8VpEB9EEYY4VR78k+a6Ro+kaVo9kbq4CRpGuS2OB/vTcUBlNk4STtSNNHtaMnsmnT3StpFGnzYQABxjxTTrvW008ponT8kdpOE+ZdXfaCYkG/apIwuQN28VX+rur9ceV7qx12HRLC0YH5JVTLL5BcH6sHwAP1rluu9edU9bWd1pUemWNsLtflzzxxsZpY9sqCThQfIAyQcZq+R0YbsApR0unlfIJXHHbsudq8bdcal1dNcDU4ppXnMkcneSFxgliPGNs81WdU6vv8ArbqCO8mjMNtABHawg5EaZ59yeTSdb9M6n04iyafI8NlfMFnijyEDDxjHFOejtG+bNG7x/UME7c0i70jhe407WuAeDdDC7D0xHLb9KRWUcZBvZgzsBsyLgBeOMmvZvwd0l+nuj7Cxm2nkX58g8hmwcH3AwK82/DHpk66NNsJE7Vtp/mkEYIjOCw48kV6x0Jcle1cAcD0rZ8H0/qMx7UF89/V+s3Vp297KtgkOBRWsIcCivRL5/hWs8cYzRv4OaB3emaBgnkg1alkuwG4zSMDjal87DNYvxQhaZNhmqh8R9Tg03pi5mmAd2ZVhXOO585/oAT+lW2biuHf+Rur3On2uj2yZEUpnkZsbBgAFH7MaR18xhgc/2Wn4Vp/3WqZEe/4XP+truC105b6G5Vo5wWBU5DIwyM7eMcH0rmi6o9wQVcAAZyRudzzt6/vT3Xri6bpjSoipEJiZgCOQZHA8egIqpvcNGO+NCe78xx99v1ryDzb7ArAX1jQ6YRw0TZtdQ6dv10+2/FTW6yBwxRFBdz2Nlowm3d3bfUdh70vT8Gq9adTRWlzpN7Y6aJfn3MiKpkZlYsvdIcKpyACFGBmoPRbqERWcEEriWSMLIJGwkbSEiOMMBkA5+rjxmrx0OkTdR6a66j+DuNNlNvcafdSlHVcMCIxw4J4BGds1twkuiAvAWJrf6TnOAyeq7KdStbOEQS90ZfHcwGcLvgZxv962tM1ze/4gYjK6j5UPcDhQeQBjYnbema3NvDdi5YJIyk4QjOTvuRjn2qSWVYprVIERzGjSTE7AMRsOOaVDi7JOAVhyN28DJHKbancWtvG0DXfye9gZUVcsy7/SNtj4rEyxzyQ3QRkhhOFjxvjySMc+Kr8nzpriWa67vmpcK4IGxbJCjOOMb1YdXMelaP2xqyythw5XyDzx67Y/WqmyGXc44AVj4WxbWg2T/wClbYJYrH5s9zG0t7ck9kYUllXfAxj+tVrqeW81W3TRUykKSJJeynASNAdkzjetumWXUd3rs93fPJBDFGE+auxYsMgLtwPWpW90ZJY4tMMR/DyD8RcHnCqchScb5PmrYjJqI8ggdu4UHtZppQSQT96WiC2nudTE8SBrS2QIoA2YkcjbwK3axFPL2X0QCwWqZeTYE8bYx/3FOm1D/Dlb5sSojqCQBgRE8Dj0qna7q+sz2k72qkQXc4WKIDbuA5O3pTkk8cbdgsn2S0UMkr92AOlq2WD2FpZJd3MLyM6d6hEyZGJBwdtvHFVi01kXl7czyCQiST6QmAVIxgHbkf0qU06DUk0mzj+aVlMfZGpBKlT5xjwePXGagLS3l0ayWe4h7y0xSbI5Jbfx6448n2psOdYJwAFSI2gEDJtOboXEmL61kEBRgY1zgs22fpxvkbUytoSbmW4mhCo27YGADtsNvXFTJW2jmS4ltTKz8t3fSq7b4xzmom4K3OsoXcmDIDKNgRtjx52qYphsdSuWSKPZbrDULC1UQyuSXcg9w/IhI3O3k1q1O6jD/NhjYgkdxJz3NtvxT+Sx06SWXVJbCV4gPlxEKAGO2ST+1VzVJPk2sk8ALRjAC43PGBjHj+9SYXi9xBHRRDWuotBvrasNzfahZaQlpaQskU69y4GCzHHttn+9U59MutMjSaS4V55GJ7QcooJB7eP+mnuodQXN5ZpFISQY1UkbHtwNzt4pimsmGzFpJZq0WMM53J48+PvUXxgneM/4U49zRt47+6dfjrdoMoCCRgow2U7Z3xuKdWMunpbCK4SMuTksRuf6b/pUTHZxy3ct1G4FrKFMS8ENjfxsKbW9nax3EqXDyTTfmWVmOFXbA7fFLu1T2vDQB9Va3Ttc0klTE0du30rcPBa5y0g5xtkDbmkvtV6dZMGNIkiTAOfqxjk+Wz6Gmcsjy2xSQYK4yCNj6E7U31C0trqxLx6L2hBvLnAB9vWl5WveS4ED2pWxljQAQT9U80fVreSwEv8AiKRKWIityPqYZ2PGAPSrE2qdM6Zarc6hpUd3eYykcSbD0LeCfUYrnaC7uLTumtVSOIH+LjBwB42q0aT0x1NqFtFJLDZxW06BlnmlUN2HjC87j2pGSWYelos0mhFDdvOE+tOsda1mUma0itLQsQJJQQgx4Gw7iPTiptjprQveXc7l5l+TG0gwiD/OFAzj77U0l0a0jiW36h1W0NhCoWOKEjvlO+M7bfoKy0626WSEKWl1C6yRGjHCou+FbOBj1JqsOkYKkIJPflWkRvosBAHZT8GkSTWsbXEwl+kBJFclGGDgAAfUaffgFtCiEiFMdzBWJdjvz/f0qPknvJVha0nhheDYPEnfHDzkKQPqb7HAprPeyQxtC342VpD3OzMqPId/G5A9qmJmMGAqPLkkN2pO4bTnR3Z+4qfC5bO/jHFZyOZ4gYJe04z3DkH7YqGi03U5ZoryHTWgER4MmSyb5zn/AFp7cT6fDNJF3ESsMO5Jznc7bcipRyk2SK/yuuiAIAN/4T2Bp5WSN3jRw2WbIwV38etaleG1heW0mX5gYn5ZOx3O2Mfrmoixt7hJmnkV3jBJEpfOed+31/0oN9bv86OQg/LY4YHcbf2/vU2SkgEij7rjoacQDY9lj1bOZ9JvFcBHiQSMh5ODkMNt/wDn2rnYtBrNsDHlGH1BW5HqD6j/AHroQvLHU7eaG8KEfKZMnGSuCNtv6VW7LTGtraJYyD2fSHxyuT2nj7j7VUWGU3yFo6OUQN2nBteTfjd8GNR6R1xutumLDOnzsW1KKBdoHz/80ADg5+rHB381L/DO6jmVJZ2BCqAoB2+9eoNS0XT9Z06ayuomaGeF4ZADg9jAhlzj0OxrypqXReq/CrqcaP8AjTcadMS9jdduDIgP5WHhxwR55FKTs8mj0W9pZzqQWHld30UQSoOxAAfBG/vR1L1PpWi276TaXsB1O5XtMSsC0SkbswH5duAapk3V56S6N1Hqy5jM4sLfvji//skJwi/YkjPsDXn3ovqPVNX1i91jU5AbzUZ2nupGJwzk8+wHAHtXWPBAPdLnTOkcb4C9NWFv+HthLAgkIXKr3AAnwO73NVGbrbqPqW9On3Mn+E2ltOVkiUkZKncs5G4xxjaq3qGv3sNgbiHUXtoYgCWUnvk8H2AH23phca1pt6IlvdZFwTt2uwAP3H+9Wl7WNoWow6YlxLqPb2UXBHca1rt/efMlngnuW+XJISS6A4U7+PQelX/TLOw6esTqVxCGAZVUY/MxOAKa6YulxhW+dEBgbhgAR9/AqH6q1o6zfwabpcwNpaEMWHEknk/pxS10dy0Wt81wYMDqmHX+gpc2tzbyMATOt1CMfmRtyV28HxTXofRdOjkJCOyAgDK7k7Z/Suo2PScHU2iW0hl75oBlHI3U7dykY4O9Vjp3S+++Npp0Lv3zskYC4Jw2PTbHrXHguojqtDT6hkcLmONEcrsfwg0eT/EXvflssaQ9q7YBLEe3JxXoLQ7YqFyK558OtEbTLCK1bDOfqkYDYttx7Cus6XbBUX6a9boITFEAeeV8l8c1g1Wpc4ccBPhGMDeingiGB9A/aitBYO5S/wCuaDjwaTxuaUkY2FTVKKSQgCjbO9I/oAKEJpOcAmuK/wDkULhtCsp1jD2yySRSqRnDMoKnj2au1TjIO1UzrzpuDqrQL3Q5pOw3Mf8ACkxn5cg3Vv0IH6ZpPWxGaFzByQtPwucafUMlPFry9rcdnqnSOi3cKYQWxtnAH5ZI2IYce4aue3zfhHOVDAHDAcf981eNBbWNCv8AXegdf0sGWBxdrE2cZH0sVONww7SGqp9TdOym7afSbgyQN/K+zxHJ+lvXfg+a8q6MkBwGeCPhfVNDM0AsJxyD7FY2es2tnFMs9lHewXURhmikJXuUnI7WG6sCAQRxjzU7Y9YaKuraZqup64pktpoIhDe25muSAxCiNlxkjIXuPI5FUGVLuCQLPEypjYEff6h600ugnzVlQlSpHafKnOx/Q1ZFO5noPClqtOx43dfZexJLme1Mk3yyXG6hvLHjO3ipG3n1G4hXTrR0mnkGZCDjc57iTjYD0qA6Q1o9Z9G6Jq8iqHuLdWuCB+Z0JVvH+Yb/AHq1W620JKw4ikdShxuQpzt/zXXQ7TzheYdLYqshaDO0lvGixGZrZ/w/0LlXZST3ccf6VbLaNblVmu0WSQlQRJuqnOR+39ahBKmn5MaBLdUxIBz3b4AOMn7080y4kuojDeRMsgBKpGM5G+x9KnpztfRyT9sJPUjeyxgDr1ypC51ODvuIYgDErdxI242O+OKjoNW/xDUhb20TvEpHe4GEVQfJxgk+ntTS91KOw1GW0jt4mcQF5EJyq44ycVTtG6zv7rWLnS0j7YVYFj2kKFJ8DHrtvVc2vDHgOPWqAVmn8OMsZc0cAZKntYN7r+uDTYSEsll7mCghpVG7E7bD296XWp7fT9PZbm33klWW3XGD9OAoO3pUy9vFZPHq6hYRZwkE4yWY8g7b71C6lplx1Fd2upajcLEFja5RCMr2qRgHbknir443MDiDbibvsFUZGu2tIpgFe5Kd3WqNHpy6i0cjzyoFjQIQANt128U2kih1W0sraVy6EgKV5L5BORjzx/WrMslq+nmO6uQ1zj+KrKAicYAIG9UqCZW1CW406D8SIJAs8i7CMEjdRwDtTjiI3AuddjhKxjzAaFEHlSGoD/BbmRJJoZohjCggkYxjIx+lMbMwzCS4a3QPJwFHA2wOPNRuvxQXEcTR3SmaWTCgHJI2+pttjQ0F18tII7kqsABLnYE7b++avZONpvj5XDBx3KNfu7mxtEjjuiUU5aPOVAOPGP6etNbU2H4Ufiss0gw7SNhVBxsK035bVUEdwixCL8wXljtuT71psdPtrtRFcBniTZUXYnjc+nO1RjIu2deLU3D007kc0tE/4OKKa0ikjl+r6JE3Hbtxt4qvst/JMLKGGSRScdoUkHjnarS9lo1q5heDZhhQmQc7U8h1mz0y1jh/BgAjAcLktx7b1MS+W2pD9lEWTbBd91Vm0nWrS3MxmWKNeFbfJ2OAMUytVu4LgTanc/LEp+ll39NuOantS1n8ashhiyHHaA25Qbc/9/aopulru7sg9xdhJDvHFyDxgcefFZsr3Syb4xgd04yg2nmiUXOpGKTCzBrSP6iXwCTtsdq1t1xZ6hIttczJFaxAFhkDuxwMYzit8mgaDZWcM9/33c7AAwlzgHbII22z5NWKOPofTdDSWy0uyGoXP0rF+H+aSds5B/piuFzudwHWuVGmihtJ6Aqq3vUWm6/JHp8Uq2tgpBnlYYDKP5V23qQgHTV8JL2bqa9nhjYRwWkOQdhgBRjcfYVNw9IaWifiYdJkW7hjNzNCsaLCm2xbIJOecePSnlgNNgtY7ptCnMrMpeWUfSisOR2gHHgLSU0hcfV1TcYa0ei8LToOjafcsTd9PXJdNxEHZmZPHcSRj9M1c9P0C3lje5j0PT7PAKA3DZC+xA2B9zuawtYbyY4hjWBcZ+XCO0qvhu7GwxWnUeorfQsCFnc8MZG7gW9QOP15NEeyJu54x37qmV8kztsZz27KZEFmqEXk00f4fYhWChjvuqjkfemqLpOnyNNaqzM47u6QgkZ9McZrnPWHXcVtp0sqsBcv9KNncsc/92qA0a96711Fj0+xlSJxj58v0IPUgt/tXBO57gImXXWla3SU0mR9DqCuqtrLzySyyXPZF3EIAcYx/NUfNq2iQuWup0Mo4OeRvVXj6I1qQKNX6lKRruYrVSSOf5m4H2FO5bfStFtJEsYo5bl1KRB27nkc5Ayx/wBRTIbNXqaB8qDY4i6mEn44S3/VeoX072uhWLyRIpDyEYB2OwzUNp+gdaXcbym4itzISWU/U2+f0FY2un9ZogSG4sYySSWJLHu3z+tSfTvUN7pk8tjr8qPuSsij6c75zttn33qDtM95DpbH4T7XtiaRDR/KeaZ0Ys1lEJrydJ1DLP3nJL5P1Zxx/rTi1sNQ06Y2j5kUOGYY2kU549Cf7VtuerbEXASB1YkZzkAMBkYrTqXxH6Ys7+GzvNQtopzAJRG8ihwrZ3wfG1W6YxsfQNUlZG6iQZF3muysiaZb3ThowAhBDeCR58eKoHxO+G+l9SWJtbrMEsT/ADbedVyY3GwbjcEbEU/u/ih0zahnTUYmY7hI2DEnffA4qLPXdxrMDzukYt1OOxjlwKlrHQvbXJTXh8GrjdvogDuvOHxzmvum+grbp25QpJcastvKRwVjQtscbg9wNc46W0SDUWTIIY4P0nGa6j/5g3003THTY0fRHu557+SVZwWwgSMKysoGCSMc8AVy3obXr6KJYpOmNTWUADCwEjPsdqzAy2iha226irDjRtXe66bvr5UtJrvNqmG+Wq4LHwWPt4qrdYS9I9FmCLXL5YZ7oExRxxGRyo/mYD8o9zz710DSdO611Z+620r8Ej//AFLggv8AcKNh+tSVv8BrPVbw6hr4N5PJgvJIMk+32HpTEene/kJGXxBkRoFcHk6mhn+VFbX6NBKSEKPgsPQjkVd+mNoVkeQAHB3IGa7jov8A49/DxQDNoEBb1Aq86N8D+gLUq0GkhCPucfvVn/TZX8Fc/wDkMMTeDa5d0jrt3bWzR6bE0rsCFJUhAxGAxPt7VdOgenZrWYEQF5pG7pZOzBYk5P2GTxXWtF+GfTVuFEdmABwKuuldKaXZdot7VARwcVpaXwzy6JPC854h4954IZgFNOldEeOJC6YOBnar3Z2YjA24rCwskiUDtAA9BUpFHgCtxjA0LyUspeVj8o+37UVv7R7UVYqbSnAxSk4HApPpH3NH2xQuIA5OKQ7g1kB4NJwcAbGhCbTDYg71DajHlTtv7VOyqNyajL6IFTUHKyM0VzXq3p/S9SJv7qxRry3jdYrhVHzFXByM+QfQ15+v47BLx7GVE7p1ZoGOxYfzLxyNiK9O6vDyRXEPjD8Np+oNPfUenSI9RgPzRGG7RIwzup8N/Q1k6qL1BzRxyvWeDa0R3FIcGqPZcy1LRoJYhbTyEwyElZU3AbfJG23utc16w03WdBldHHfC+6yquzDf9j7VOW3XsmiXT6N1TZXFjMT2zRXCdhyCR3r4YjHI2Iqce7/xG1aBWgukZcorDKupycqfH2pGTTteNzeV6uPUuZh2Qr3/AOMHVo1HofUtEZS1xo100ig8COb6lA28EMK65ayOWZmy8sqljgc84x6Y3rjHwEsm07U9f+RpywRTwRGRwQQGBPaB65BPPFdYn1JbZ/kxj63T8wHA32H/AHxSmptgBcs14DpXBo6qcsb1lnia/fvijJUnkDnfjx6U5W7NhDLPYXskckhy78jtJOB4wRVUi1aGKJ45pJY4mbvKLyWwRgZ9fWmMt7pyI0t7dMIwT8qzDElm35P96Qdq/LbQ579VY3SeYbPGMchWotp7zNHKyu7x5mZH7ixJyFJ435zWVtpFu6NKsMayuwiRkXDTMdyTtkADH7VTrTTtQtbu2ktGj7Jf4jBmykfdwCMZ+2eDXRNA028guI1u5RPO6GR2ByEUcKpxj9fNc0pMxO5vVGqrTN9L+i2RzJcz/gtZuFhhtRkt4ZRjcDHJ4ps8NrERfTXJjgMgMYJ3UfyrjGAMb55prqejwXN5DdTXEjD5x+eRkAr6jbwdtqi9X05tSH4HSZmZYSflq5xggjYNjBA8mn2yyNBsA0cZykBExxFOIBGcYH/6nNnLddQO8aYgs0ftebBIAJGFG25I/as9Zs7HSJrTTYXMUU7fxkU4dgADucb5H7ZpQms9K6KDZWubYgNK7DJMn8zEY496qggvtd1FL2WSVgh7mcklVUY2G39a4ZKIjDSXHknt7KTYg4l+4Bg4A6n3U42lJBMb+KON7YnKxlvrPGBxn0NM7drjVXmT8OLh1JZmLFUjBx6cn2rJbieO6ndYyQ6fLGRkRnbzjmndxr0DIkelaSV+WirIUXkjGSfWmwWNwcAdO6VcHkWBfv2UZpdm1pdOlzMHVl+YrNsCBj28b08h1K0WAWlrbJ2gk9yjLFiRnfzTW8ja8s/xJ7V7ZFBjGzb43+x/pTe4tGtiPw0xVgoy6rtnbaiyB6TQH3US0PPq5Wy708T3KXRYpICMqRkMNtuNqkbi309oYxfAkuAY4iMFuN2PgHxUFYyan+IPzGIxjEhIwvG+am7fTzfT/Mv5D+GjAAJYF5TtsD+1cOpJbQGfdBho5OB2UNe6ebu5S3jt0tmQAKsYyPG7HG9L2NpkiWsZWVnIUtJuIgSMsTirHJpttNHBafi5LcyZLKoyQo48c7Vo06PSNPBkezlmuXJWIyAEdoIAIHqftvUJJQ5u0mr/APaXWtzdXXRY2eg9PR6rbiSZL0MO+V2yqBwMkAY4xvTqK80xr2XVrOwtobS1DIt0QFLuBt2jG36b4rTBa6lNcPLmCwV1ZVaUAIF27sA7nA/fiten6NJeyx2gl/FQxM0gaYdvzFAyQqnZVJ8nfxVBlIADRVlS8sEkuN0FJaSD/hK3CxyC4u7gySsUA+aDwF2zjHk/pU9a6VaiI3EsYSLJeQSgAyN4ULjgePJrXp80VvqEF1JIFf8ADhpIiNlXjA22A8e1VLqnqxbq7lf5pjCsVVQcAY8f3rjntiFuye3+VFrXzO2twOSVI631T+Biks0kCKCSWXYsP/Y1xHr74xdP6LdCDUdSQMm7Roe5wPZRvk1TPiz8Z3uJ5OmOkLpbnVpT8uSZCHW2zsSSNi/ovjk00+F/wMt7iJtZ128W9vp8yl58ykNuSXU7keuKIdHLrjbsBasbItI3c/krf0x17q3WvUTX1roE4tYTmA3A7Yokz+djjbJ8+K7hHe/ECSSS1t59PAhi7g8EbzqxAJxtjgb5p5o/TejW9q0KW0dtciBogiDKElSCYmIyCeSp4qPin1WxmiFvepHLCnyPmwkxGVQCACcADbY53ya3YtG3TtDc/RJyzjUu9IArumEmo9fXL/J1Oe0iQk9rwklW54J/0qL1XoTXdQljv11eZZoj3xlSQFO5BHpV5sZrXUFImjaMA9pJG2dzuP5h7+asFpYRrFhwpiAOGU5zztj+1cdpI5Mm/ugax+n/ALWgfRc7trrrjTsPcWMF6QmGkWUxsy78gbH7+cVXuorfX5pDetJcQiQkqI3ygO/JA/rXZZ7S3EJKocDJAC7/ALelV+5tLeOCSOeMBSTsRtg5/pVMzC0VZITOm1LS7dtAPwuRp1p1BpLgavYwajbg9rM0fa45HI+/NUT4o9G23VOsWXVNvbTRK6iCcK5JjwT2HPoQce2N67fe9LWruSAGU5x3fy87VDzaXBEj2Zj74pVMZGNu0+n25rJk/uAW9BKxpD2DKofS/TFrplo4ssyyoO51JyxXyRngVZzcJBEnysq4A7h4Ix/cUwvIpOlHjklKO7khWYfmXftYY9tsUyl1FbuUSx5QA5Cnj3HuM1S8BopajAZBuBsFZanby6l8rTriQPCZxLGpGyORg4+4q26B0akZXNuoA/8AWoTT7Vb9gyD61w4z7HO37V6F0vpuKW1guFjA+bEr8eqg074UzzNzO2V5T9SO/bubIME4Kp+n9MxIoAi/pU1b9M5I/h7VdrHp1Bj6BtU3BoUakfQNvat9unAXi5NYSVQ7Ppoqwwm1T1joYXGU/pVri0eNf5AP0p9Fpqrj6RVzYg1KP1BdyVD2OmFQAV2/0qctbMIBtTiG0VfFO44gMbZ/Srg2kq+QlJDFxW8AZAFKAPAwaMAc81NVIwPU0UdwooQlG+dqANyaQec0A7nFCEpbPnijj2pN/OP0ox7mhCwkUnimV0mxA5qQPG2/imlxHkHzXCLXQaKqGrxHtbIJqk6qpwwx610nVLbvU+dqous2hBcBTnelZWrQgeuN/ETojp3q+ya217S4btEyUZh9aH1Vhuprz5rnT2udDd0egyS3FpExaOGZiWj3J+lv7HavVur2zEspX/mucdWaGtxC+IwTv4pV0bSVsw6uSMAXhL/486zddRLM17pcuny39k7tHLgdzxS47hjwc5Fdav7S3YxOwAZVOWxsQdx/UVEfDXp60tdJttVhtyn8FbVfpwQAMuR9zt+gqbuwXdoJVKPExC9w2ZTzg+tZurA6haEUxkcSD2UdJo1vqcglN2yXI+n5ZTII+44FYx/C2WXv1NryO5lDYjhU7k+Dg8AelOreQws9wSACcA+oFb7vrkaXa/KVwCxzjbuJ9jzWNINOAXShaTXanDYCpPTLRdP0x4L2xUXEZJlEqfSfR1I5HjH61Cah1xKYG0zSHK3E7LHJMdhEucYHt71G3fWWrajAI5Y5HXu+pu07L5B25qLvtQ01Ej07S9NFyZ5AzOmTKT6Af9FJS63c2oTQArjJTUOiokziyc84H3V6kvtOs43k1LWUnuRD8uC3RsIpwAMAcknz6010XTtQvpLS/vZpRGWZVtYT2/O7dyScYGP7VW1sbGMPJfWDx3SENFGV2J2z3+hHoKwm+JElrANMkZAkAIj7f5R7H0qQ17GUZcAcAd/dQ/Yvc0iHJPJPb2Vu1rqu4sLhbaUM9mMLLHIQWI22z6DxWmfVDe2wkt4xbWCgEyKmARtkqPNVHQri21J3u9bieSOcYgjYkBgeWP8Aap2K1vdPSIC6Mtk5xCpOQPYjHFNafWvkt14PTqEtNo2Q00CiOvQrK41O3MIt9MkItcZ7GOSTtkk+p/pWdhqMVihjuo2QncYHPHj7UXkVgW+STCJUwVZcDP3FMjb3UzE3TL2AfSqnPdxvTTHvL94Nn+Eq9rSzaRQ/KaazqO8X4MgxySgMw4Vdj+2alLdZ7yNRb4IO5BODvjIBqEltpHkMkEQQAYcAbeMMf++K12d3cWubV7p4yNyqjc8GhpyS4nJXXMsANAwrCbOK0X5UyIO4Et2t3Evt2jHgVttEQdufmByMDtX6TjHBPH3qF/x+K37Ga0Jz9Kkgsc7bkU8stRS6j+TD813bBJZcEDb9hVZlYTQzSBG8CypN5bkzSNb/ACnk7R3TDYINgc+Bnipu0m0vT7ZI4JUM5X+JcsoLAnGQg8YHBqvKj3Ma2xYIiElu3gn1b19KdaatjbWaNJCfnyyESGY5JXkBfAGKkxxGR9yqJAHAA/YKbnuLIPDevayrDPiOEle93RfKg7A53J9jUWwuJrue900xQiFgUgmJDsxxt759DtSv1RN80zOEMowkbMPpVRjAA8Co6TVIbn593dTl7h5GZmIxnjgDgV18rHnB6rkcT2jI6JtrmtX1vcq8jR/iipZuwfSo47fsK8n/AB5+L2rTalc/D/o64eG7J+VqV7GcmAHmGMj+cg/U3gHFXL/yH/8AIjQ/h5C+laLdRXnVN2OyOKMhxYoRgzS42BA/KnJO5rzv0HrGmzXxnurZrp5WMkskjZeRmOWJPqTvmiCESyhz+FrwQObFuA6LpHwq+E+oW1vHe2cMVzKR3EM+5PknO+fU16H0S7vtEtkSbTSJQO3GM4I85A49q45p/wASNO00p+BsHRUGPpbBB/vVy0D4+ppP8BNLMUTtmT+EJCfsTxXpmPhibQNJGXS6mbIba7TpN5a6jaIl7e/4bOQSzRoXJXfkDdf+awvtJtBGZDqcd+iHP8WIx7HO3cRufeudSfE3oXqZvnT3hsJx/wDU+W0ZB357djVt6Vvump54m/xGHWFG/wAr8USCd+VJz96kJmOwCD7pR2mlhG4gj2pStvbWtvmWJo0D7YEgODk5549/G1TMfZaWzhJkeV1yEQ5A53z61tudW0+YFl060QKO0KYgQF32+39aYTX+ntEfwdvDbuT9RiGAw32/WoPcAcKtrnSVYKkrFluYll+YySj86twTvuPesdQgt7pRFIiiQbAkbE77GomPU1tQZAwGOATv5/7mqx1n8QrfTo0SBe+Z9lAYEHnn9aTmlbtNlP6bSySyAMCleoLI2KRySlUBPYAGGCB/b3qu3c0B74gR3Kc5Ow871SLrq7VL1jFPKzKXLgsc4LZG3t4/ep2zZNSsvkykZK4LZ3x/wax5Xhx9IXomaOSBgMhTySz0zWu221GBJgCcd3Kk7ZBHmuYzNPaXM1myY7ZGidGXcEEgfY10HSY57S6MUgyYzgMfI8Ef980z+JGgSyWsfVOnWwJgYLfhRuFOyyY9js33zVYd5jCeoTukeNPLscbB49io3pyV5eyRf4ZjYBt9/Tj0r1z0nCt303pkx5a1QZ+wryP0k0NxqEapGQNsk8H/AH9K9k9I2bWnTemW7xhGS3XIPjO9aPgQPmPPsF5v9akNYxo5tSdvahNu0bU+jtwPBrKKMYGKcxptnFeoA6r5u9ywSHHjOfasxEB4Ga2hMVlgA781JVklYCPHgVngjigjPAx70gz6E0LiU78mjzjxS7EUmMHbmhCywP8ALRSfXRQhJjz/AKUEjP2oJyNh+lBB9DmhCN8c4oyR70Z9jSA42NCEu5OTWt1BB2zWw8bUEEj7UIUXdwdykAA1VNZ00vkhdxV3lj7gc7VGX1oHU5UftVb22ro30uNa7pzKzkrvVOv7NWz3rt7+a7PrOiGYkBNiPNUbVunWViO0j9KUewg4WlFKCMqT6XlNt0hpwkiCFIgF8Z3OD+tNL4r3zKzh/mHv34B9vuKcWWF0O3s5WwI0KH2Kk4qO1CdTbtIACEUkkeQOay9RkEHotfS4II6qIupUjzDG5KFsju8etNVii+YHmhVnCkoxGSK2RXMT3aW7xB4rnIUk47X3wfb7Vrt3kMBlkX+IGKsB4IJG1YE8fVehhfQpSuk6+ukxgSWuUH8zAb/71JW/V+hwzPex6XBFcynsLpGA5HnJ8VUdbvnW2Cli5PHoPtUMbd3RTM7LkbAePb70o7UyReiPIHccK4aOOYb5MX2PK6Tqeq6LrdottNPEgZsqxGWU/fz9zVSv/hPBPqcN/ptzJeSSNn5EpAjY7fUGHgelQdnpOpX0rtbOAkZALyNgZPj71YbG41/SMR3NzEqAZjxLkHHpS7phqHXPHY7hWiF2lbWnkr2Klb7pxdOjjj1fVIGuyQVSNSURRjOTyfSlttWh0+GW3urS5dJn2mnTtAXbHaPGK1/46UAvLzDODkMQCSfcUwueq4r2YiVC6jcRscjO2MjzVjpIovUzB+/3VLY5ZRtkF+/GfZPYtG0x9SF89wLgSoXjBbAPGc/2FN7q7hs7gOpKowAEfIHGCD43qv3cmoTyC/slACsP4YYAeNh9qlLJ5Uiaa67S7DLAjIPG1Sh1u70NFVm1yXSlvrcb9k9Sb/8AafMS8jM87BmVeCu2P9d6a3sloI0e6tyJUwwwpyOOT6GtsOrRT9s2YgItl+kDtp/FqUV8hgeVnfYFFAOR6CnGSh2AfhJvjLMkdU007TZWX8bM6Ykwe0cqu2PsP7U+ikjWORJHcEN2gxgBnG37CmmoagLLtjXCBB9IA+3NRv4x54vxb3LRBOFG36n71aXNbgc9VTtc/wBR46KZa8htWKL3l3UHCjJ7Rjz60kdxJIkaydgDHKDGSM+T/tUNZam1w7OIVYbAyNsARjj1+1PAfoM0zlUO4IO5Pt6V0P3D2USyjxlarq6ezNxFcY/KSpO4AP8Asa8vf+Rn/kfd9D2UvQ/R11nqW+U/MuFwRp0Dfzn/APyMPyg8Dc+Kvnx7+NFn8PdEe2tJkn17UEaPT7cnJB4Mzjwi+/JwPWvJXTHw7vuq5H6i1bXLCW5v75o5Wu7vtndzgtNJsQsYzgMfsBtVmmgEzwawFowQkN3vwFUtB0q5v5jd6iZpnlf5ksrks8hJ+pmY7kn1NegugvhJHfiayivHsLwSBYGZhPaSfSGw0q/lOCPsasHRXwQ0K6LRxdXadJcxIflxW8ZmEkyrkoG4K44Pqa6J8Obix0nQL7pC7tHtridna1McYxIG/PET/K2RkN+lb8GjYK3AZU5tS/bUZ4XMYujOorae9gm0tpG02Qw3SxMrmNhvkqNyCN+4Dg1k8KLEuAAF5Od/tVo69fVbXqK3ntpEiVLZUS4gJWSRVJHc7DckflPriml5onWurR2MsnT9zdf4j3fhJYoF7rntz3YK7NjHHNLyx04taDhOQOIaHvIAPuq9LqqQoIu0LFxjHGf7Uxe7mNz22dxJFIN1eFirA+mR5qza78LOtbSygvrrQZWt5oTOpgkErRqCQ3zFG6kHbB4qtxdP61ps/f8A4fcpKSVT5sRU9wzkLn8x8YpSRr24IIT8JilHpIP1U1pvxg+KfS8xtLq4i1qzQZ+XdEiQDfh13/erlp3/AJHdPTKq6vZ3+mTHY9y/MQc/zL49sVz/AF3ROq7G2hN3pFxbJeRtOJXj3lUEgn2AOQaqz9P3TuJZEO5wPY5O3+9LunlYav7qxvh+ln9VC/Zeh7z4zdPXelzrpF4t1duhWJV/lY5HcfQD0rnNnBeRzG7luWd2buYsxIJOc/pvVIHRhjuEvoZ54rpBlXibHr44I+9dN6C0TXdYjMN5GLmdHPayR4LL/wCw4z7+aWfqHPIBTkOli0TC5nHW08ggu5gsyBvqyArcA75Ht/arHpxu0ljCIU7TlgTyN8j7VYF0nSdF0tr/AF7VNN060gBMk1xdxoidoJOSTnxxyareofHX4AQtHa6V1K+qSMAWlsYWaJOe7LtjP2ArjmuqyQB7pI6vzXbI2F3wFfdI006tdosELNjYsPJOc49qu+n9PR3COGWKe2mBglRCGGCCGBHrj9sVz7R/i30hLYo/TUjXUrjEESp2ANvgsTx64q1dHXUthEr3kv0sweRk2HezZ/bJNXQyxtcG3d8lYmsbqA0uILa4CoXQXTEkHXM/TswJNpetbD0IB2/pXr+2wirEoHaihR7ADFcP6K0uKz621nWblVeee9kaE42VTjf712zT5e9QRtW94TB5LC7uf4Xl/wBSa/8AeSsAN0BfypaEHAIGKdJwM1ogGVGDuacKMCtoLyTuUuxG+f0ox6GjccYoDHzvXVFGMk5pAxHFKME8UoOPShCQEA5ODS92diN6TtOc0Y3z5oQloow/rRQhB9qTJ8k0Dc80bDnehCN/vQCDzRk/YUHbwMUIR52NB225FGccUA/vQhYsmRTeWLu58U6285yaxYbHFC6DShrq1VgQR+tQOp6THKDlB+1W2ZBgntBqLu0ABJGfaqiAr2OIXP8AUtJNrA7qhYD6iBVeuYo1YCLDhh3ug8Kc7iuj3pVVYMoIOxB4Ncx6pt7zT9QhvNNwYwSrg+FPI+3msfXM2EPAsHlb3hsu8FhNHoqv1JZywwSJZSHMZVvpO/ZyCPt5rHR9Uh1GFJ0lKmHKzQ+O88E+xpda1FbxDEuYp91VhsCD+Zf1/vVUjjutM1Bb+wJKgds0BO7rnce+PXxWPKwOOF6OA02ncq0axNC06JLhATsQcgmiSZCoQKDgft+v+lbriwhuo4niUPBcr3IwOcE/7Hamcej3MsvzBK0USEqSwzk+grLdG9riK5TzXsc0EHhOYL+4s7XsjjVkyWBxv7ioi66iae6BaMsI9sAZyakbx2sISI1MiD8wJ3BqLsVtppTPNIYg5ySoyR+lUSsJpoNKyNw/vItMpNUlV+8TtKGO64IIHoKnYtY0q9giikhVFg3HZgHxnuPmtGpdP2d5Oh+bIYyoKmM47vvinVv0v09JAoiaS0dAAfw792Tt+YHzS3kyAkCvr1VzpYnNBN37dFKW8+mXPZcW9miOh+rJIU8eKhbtNau7totOQNbBst3HBA249aeNJDZw/h0kBEYAUAYLccisY9YJUMHIRRgEHAB2296lTXEA470qhbctz8pqulXUSKsgcJIe+Vs4J7cHtB9Tvv4NZRyTWDte2RlRST2ud+0HGVJ8keTUvZ9So0QhdQzEgAtjAGRinkk1ibcrHggn+IAPpVtqZjjY4Ww0lZJXtNPFqDeBtQVNRe/GUOZEkO7cefWt0cVvJCwniYRFSyAHc4ArAwWNnKHlZX7zhFZthx4rRqbSNEYbGQtJMwVsH8i7ZFWNJZd8/lVOAcQBx+FNWN1ZS6b+Bt7NVnEYLMRhQPBzVJ6/6qsujemdR6o6g1D5VlpsDSOAcdx4VF9SxwAPerWA1pp6whgXOAWzjPtn/vmvF/x268vPi51KekNFZ26e0a4YBgdr25XZpW/9Ruqj7nzT0UZloO6KqFluNcWuLT9Ta98R+sr/AKt1+R3ur+T+GjHKwRA/REo8ADH3Ndp6Dhh0uJTH2CU8kqpA/wDuByCPaoPpj4YmxuAl2hi7xkAnGT6Zq/6Z0s9lGYrcEHySQSK0W1HW0Laj2uaG3hdP6L6l1az/AAlnpb2ZaIOo7rRe5g/5u5lwfXBG9dHu+ntGvrPtv7eWDUVj7vm2Ns0vePBZVP0kfv61wm0guNOdDDMyuMMCDuD61e9D1zU1ijSLUrmGdjlpI5SpA98HemG6/YKcLVUnh3mHdGaTvqDpi96jgGtfIIi0diLsTr8kSxkjAUHfuON/en/T+sdE9L6RfLHcaxchnkl061LYFkXUgsj5/MTt9qa6zdavqdjLb3N7d3OR3AM2RkcE+v3qk22l38GoNFrhltrRozKqAZeRvCj/ACg+W8CqT4gGusDnqU0zw4Sx7JDgHACtF58QLnVdKt9MSFYpLR2Q3ucSNCScRuRyB3Hu5JzUlea9Lq/UUTXiRPp8EhCtZgypGrKe9o8/UzkgE+h4qsXWpYsRplpbRwWoPcI1UEq2+SGO/sSfSpPplbpAFtJZLYg93zEbBUb5IPGME5PnNUP8QBOc8JtvhzI2FwaBXur/AK7q3S91o7W19adjz2qfhjEf40bAMASp/KMklgeSc+K5fddP22r3aOYzJOR2FlUAOBnwNs42zU7o2majfSTapc2Pebmd5AJZSMx5IUbZIJG+fepTqHX4OjNCvdZ0zp6S9v4oyLa1XcSSHIUM38qDkn0FVSPl1RsigkGzwaH0REuJ98Wo3SvhRGM3er6hbadZIO9pJ3AJXf8AKCdxUN1v8QNO6dsz0t8Og8S3IKXGpttLKNwREOVB4Le+1cFv/iL8a9U1W6ute6Qdrucki4kkaURjcYSNfpUDwP61r6VudVk1SaXqNrp9RkyVNxsWXB2UcD9KnHHCw1dnupui1eo/qSEbR0C4x8RdOu1641e1uLiWWzjkEkUbylwGYAk4YkZBJ/etnR1pKJV/EAhHb6cnirX19onzupBOmTLdoJZ1P8rZIA/YVM9MdJCcxBwAFIOP++KQ1AJJHRejgnZFG0jmsrpfw1tZ/nxRxOyjI2Br1T0jqNnb234S+bJVRJITvhV3I++39a8+dFWkGmTRqSDOBlVAzj3Pp9q730bpst7bDMB7ZSGLHcsB/bNR0GlL5Kb9fheb/UGsbt3OVy6MNzf3pupEKmZzJ2nxk7D9sV2XS7dkiXu5xVM6R0MQMrtHgjGNq6JaoEUDA2Fe508e1oC+V6yXe4lOoV2G+K3ZAArGNcDkf7VmRjY7U0s8pMfoaOeRQefQUYwfNC4lx+1IRj/mgk+cUH7UIS7kZ3xSDY80tBwfWhCXPsKKx/X+tFCEbZPigHBxyKCRnjejf1xQhBz4pQM8iju+1JvznFCEZ8AUYOfShSfTNKR9xQhJnxzQRmjg7ZpSQfTNCFplUHwaY3MPcCccVJkbVomjyD5rhFqTTSqOqR9qsceK59rKiSRwd+a6pq1l82MjGMVzrX9LlikZgCAc0jO0kWtDTSC1zHqa1aKNphEZANyFbDfofWqre9X9Jdqxarfvp86DBNxGQrEeSw2zXRNQtmfuV1JB2x61R+oui7XU0c/LGSD4rJfCLsLdg1Lg2iVo0X4ndMabIbV+oNLubJz3Fo7tS0Tf5gpOSPUVdBqdpcWyXdreQzW0wDLLHICjqeCGBxXmjrX4G2N+JDJYRPkncxqf7VW+kOl9f+HGrW8mnXl8dJEuLvTPmkwTRnZsKThWHIIwcilpYA7PVaEUwXrd7aO+TKTRyDghZBuPQ4NM5tLVQVW3CY/mDZJqs6Z0pprWg1np7UpPlXYyjwsR3D/KRnYjgg75FN0TrrRpHXTJEuYn3Md0SUOPIOcis2WJrRkZWhCXSH0OH1VmikltyjRzFGz2c5BB9K2EQ2P8HvaPJyzA7k7VzS/1/wCJ90ZJNP0TT7tom7XigkYPn0UHz64pLX4i9dgIus/DvUJAigkxJ34Axv4xSRa1wzY7YT/kSA2KPcWuoXBhnhDOvcAMB84bx/r70wttOQP3vCyuWwzM2QF23Aqmaf8AG3Q/xQtdY0XUdOKkKPmx5AO35vNWzT+vul78BbS+hYHGR8wFjxtg+aGQNcbsFUyebGKLSnVxZTWrvcSzFyOI1XfG3+lFtcyGRQGKIcd2/wBv61tl6q02bNtHNHjHaCTv42G9MJp7K7gMdtdoz4wEU5bxzg71L9vsNtVXmOcPWE9eSO+Z444u8RkAODgZ24NbLKxR7kIbhwF+qQBsAn0rRbXY0yySKUBHI+lSwJGcfU2/7Vzf4ufGWD4TdH3mvR2Ul5eHMVpDg9rzkfT3N4AO58kD3q+OIOcLFkqp24ggcKG/8nPjhH0DZf8AwF0xdo2t6lbn8Q4kBNjbsMZ5/O4z2+g38ivN/R7XFsUuY5nBP1ZGCD9zXFjP1N191Ne691DdTXup6rcNPcTvklnY+AOANgAOAABXWOmel49D0xpJmupJYsd4mlMaqTjA7Sc7f1rZjg8vhWxMAYABldh/+NYn05bLUY4JXUDsdmCOv7c1oXqaOGWK5e6+TFCQzHvwAvqd+K889baJDLam40vUbmW4clmBVkCH7k8ewqh2Nh1Rcieznv8AUHSMhViMzFC58EZ9KmWtPJTkcUjDgYXtC9+KvSVuYpf8atb1J1btW1PfLGwH8y8dp+9RNp/5ASafcgjpv5qA4B+eASPcY/pXm7pcHpufF8wNpcEKxbGYnHr7Guk20tgyLFLbxuGGVbPj3OdxQYWOFlMxvczBC7vZ/wDlHZiDtXox+/GxkuwAD74GSKd6d8c9F6l1G3turNHOmI30R3cEpkSIsf51OCATjccVxG1sbKfAjVlHkZzn/ipBbW3jX5IBJxhSffxzvVD4GkUnGPa3IGV6Y1DVeiOmIorjWrmR2nYiGKNcvKAM5C5/LjH1cUdM9caH1qk8PT0YtbaFzHLHJIpmfHkgcL9ua8j9WdRx6Ne2EWoalPPcTq0ECySlisag5Aydk8YqR6V1qKO4W80+ae2mG/cr9pH2I/0pdkLIyC4WkdZO6VhY00V7V/xOKwtwphd+0YAUf92rgvxr/wDJbRuldQHTFpAbu8Rs3NtCe75exwsjDZTx9IycVCv8Rut54Ht7fqKSKMKVaYhe8Agj6WI2281U9H6d6aiuGuItP/Gzu5dpEhMpZiSSSx5JPJNMzSh7drVj6WBkD98uV0HoX4tdJ61Bb3epabqtnPKc/L/D96KN8HuG+Pauk31x0jrLRO2nLNEBlmmTtfz+Ucj964xY9GdWanryX2naaltaKFVI5DggjycV2Ox+FdxrkdsdcuHRYRkRW7MoYnkseTWeItQ9+1vHdajtXpI27ySD2BXIeuek9Is7651iC6Qq83bFB3dz9vp9hvUdpceqXHbb6ZamI53cjJ/QV6g034VdOWKAR6PA58l17if1OTVy6f6F0qJlKaVbof8A1jAP+lOjw58nJWfL+oWsHpC418LOgNRvLlLjVXdkJBKhTlvYn0r1h0l00scMf8AIFAAGOBWWgdOWluF7LZFPsoFXjTrQRKFUYHtW1odAzTNxyvH+KeKya11uPC3WOnrCBgDapWKPYY8VhFDxnJpwo7a1migsB7iSsvyj1oBJOKXn81JtnauqCCN+aCfG9BGaPqPAoQlAxRQA3JooQg5PmlwcZJzSEfel3Azz96EJMn0FFFFCEhwfNA523+9GfY0c7GhCN/agktQQAeDQo5oQjf1pQR4JzSceKO7nY0IS8HxmgH2oG/kUuTihCQ/fH2rFlzWXnIxSZJoQmdxCHBGKr+raQs6H6QT9qtTIMZzzTeaEMDtmoOaCpteQVyHWunyncyJiqdf2EkTEMuMV3XUNJjmVvpqo6x0wJMkICPtSUkHULRh1NYK4/dWEc+VeMEH25qEv+lLK4U5hHttXSdR6blhJKqcDxUJcWbRZVgR4+9ISMLTlacUwPBVC0C0u+k9VM9oWe0mIW4gzsw/zAeGHr6bVdtSuS1vK728nYF71aJc/MTkEehx4+9N5rNH8DNPLJ3ithBGGZ0P0gk7r/wAf6Vm6lhIsLY0cwDqIUPY6UdReFNLv/wDDVuFLSTfK7jsAQCN+33P3qcFpcSQDT1msL+6ZQrXdqCssoGMLgYBx/wDisYHtradnuJzbhxjtXYtnGQBnA981Pw9QWen2CxadYxW5OAXiGZCdvzMd/tikmFjQdxpaErpHEFgvt/yud6x05fX84a96dMrZKgkA5IwDgnf9N6p3Uvw/0RlI1Hp25sZBxJGhUjjgrtXZrq+1FLdhb3FsiSfU0RbBOcHOTxmoqx164kvUTULSZQAVYEZQ8YIPj+9LO2WACbKcjmeG3QoLill0pGIyulapKQmAwLd5xtyDvmpS00LW4JYzDP2g/T3RbbbfqM11G86W0ad5L6MC2nY5WSHCAcbbbY9c1wn4q/EH4k/CbqazhsbfStc0zUITLGLpTFLG6sAylkPGNwcb1cyAvItc/cCT0s591ddX1HSuhbGK+17VYbYXMiwp85wBI5x5J4HJPjmuIfGzrnQ/iRDb9A9IiO/gFwstzfZ7ImdRgLGT+bc7twfFVXXtS6w+LGuDWOqWWTsXsgtYVIigTY9qKTknyWO5qT0ro3SZ7bMClJEGxBGxGNm34+1acUQibQC7HpwSHSHPboqpb/Bvq/T7mCTSdPEjBgZI7dlJcbE4Oc4x6bir5afCePU7fTte6lsNR6estPU20qur3DzKWB+Y7Me5RuVBx6YJxTyxlv7G0/DWzRTFCMxXESuAARuc7/tVmtuv+oH0yLQrkwR2zn+HGqkpIcAksrHONiSOPQCmWzR8OTA0suNlfPsuefEv4TW/TuirqVpNAkE8qCNEnEndbsoIKtnLOD+bYAcGub9O9Mr+AMk0gRBI0hIGSTnY8+nFdgup59Xto7P5Vv8Ag1dyqqi5JJ3JOc4zxULqui2un2UnyW7SwOI87kn03qpz2l1jhXAPYzY42b/hczl0Cw1K5mVtOJjnyQGbcADf75G4p1H0+lppH4nTonMMDLGrbkKx4BJPJ9KvWj6CTEjygdx3GDuPv7Vuu+nI37jAvywck9rYGfUjj9arL7yrrDaCo2nW9w8Yct80k/UoftYH7elTrvHGg+fMQgHJ3OadTada2TBe0zzkY7UXLH9uB/WnuldG63rMwkezc5OyKCQo/wB66xpfwk9VrWQCuq5p1H0jb9W6uuoXNuSsKiOHJOQuc59smrJ058MPpRUvLuNTyqybf1rtOhfBzVZFDzWTKD6iugaL8KZoAoaDGPbirvILsUvOya0biSeVyzpz4XaWvY89u9wV/wD7mZxn7E4/pXTtF6Ptoo1jS0RQNsKoAFX7SuhRbBR8rj2q0WXTEcQGI8fpV7NL7LPm11nBVN0fppIiCkIH6VdtK0PGO5BUxZ6GFwAn7CrBYaQVI+gim2aais+TWkirUbZ6FGwAKZqx6dokaEYTGPantppRBHpU5aWXZjbFOMjA4CzZNQStVhpyrjapiC3C4rKGAKBgU6RMcA1eG0k3PJSovaN6zG/FIQc4ozjmpKCBkckUHn1zQBvkeaU77UIR7nigj0JpOBS0ISD0zvRxzx7Upx6GkwMbHAoQlOMcGkxjfP8AWlwR5BpefQUIRn2FFGD6iiuWhYkDOQcmlxv70jcUDOPFdQjOOd6OceM0HbiggnnFCEE4oAO+BnNKNqXJFCFjjPNLtS7DzvSE77jNCEbcbCgHORtSEn0o39qEIzvikZcj+1Kc+f6Ub+P60ITd4c/rTWazRwcqN+aksbVg0eRXCAV0EhVi/wBChmBHYN/bmqrqfSkbliI9/XFdKkhz42ppPZI4OV/5ql8QdyEwyct4XE9Q6WmjZmjQ7HIqCntri1kywKMpyK7rdaMsmSEByPSqxrfSiTxsVj3HtWbPo8HatTTa+iAVzFhDeRfOyC6nDDO4b232+9MnmKEKxAJ+kEHA8f1qT1bSLjTrkzW0eJU2IPDL6H2/0qLDfjS6lTC4bLRtvj3B8j3Fea1Wnc08L1mi1bXtolbpJdwkoDMoHdxnx+m39Ki+qes+mehdFfXeodRS1sox9IJzJM+30Iucsx8Afc4FNesNYuOltAu9WtYRd3KIRbRM2BJKR9IY5yADufYGvAnVVz8Vurtfm1nqK+bVrkyN2BgwSNc/liUbKo4AA++TvS0baOeVpMjbLRJwvS+ifFTqDrzWLzVZo5YraWQLZ2EUoxbxg/SD/mc5yzYxyBsBVZ630vXuodRnEkhkSEBVLS57QMbDLc+vG1Uv4X3Op2dwF6h0e8sOwYSZUZkPGdwMr+orr2kppV1EYILiC4LEsVaQZyceCR+tNxuoZV4EbHWzjhcn0s9Q6aZQneiKpV3QAkg4B5PP+gq29O22UiNvJ+JDY7kIOSdvU8+tSPVMtroVvMNPtpdQu5MfLsrYM7s22O4rkKP+7006WvOtrx4/n/DjVLQghgYUY77eGUf61a2SR+AmPOgYCXED5pTkmiyGVb/e2aA9/wBRBOBgkHJwceQa571L8Q9D1G4uBpWqifUZQYhIQY4ol2Ddp4J8A+ldhX4X/FLre1m06w6du7CC7UrPLMSHZTjKgnAUH2yasfSn/g8VSMa1JbwIMZVB3sf1O1MR6WWTgFZ83jel03LgT7Ly7pXVNzpMptYlm1GQr/8AJt1L5bbAJGwqS0/SviNr1w95d9ITuHbMYiJLKvgY4zXvfpL/AMZegulo1MOmJNIBuzqDk/ar5Y9DafY4W2s4o0HAVQKcZ4VI7+40Fiz/AKqYHf0237r586H8NPirdTB7XonUgDsPmJgfrmr/AKP/AON3xI1oBtZli0uJjlgXXP64JP8ASvbo0GJVAWMD9K1toKt/KB+lNM8LY3kkrOm/U88gpoAXmnpv/wAaelNDIfULqW8lG7EDAJ+53xXSNJ6I6Z0mNUstMiQAYz25P710humomzlN/tWK9NopICU4zTtYKAWPL4hJMbeSSqiukWQwEgUD2FbU0iDI7Yf2FW+Pp1QPy4NO4dDVDkjFWiNLHUFVCDRO47RkfpUhD0/nGVq3QaXGv8oGKdR2SAbKM1IRhVmY91WrXRFXft/pUpBpSrjbiphbcKNlFbVhAH9qmGgKoyEplDZooG1PI4FUjGK2rGo8VmFHNSApVkkpFGB4xWXH2oOOBRwNwK6uJcgY2pOSD4ox6GkPHFCEp9PPpRvxxQONxmlxkbUIRsBuaTJHjNLjbfekDUIS5OMYxSHbnfNLnNLjO+1CEn22pQD6UYPpSZ8b0IS7e9FY4PrRQhGBkg0EDPBNBGPFHj0oQgYPig5G/igDG/OaO7PgUIQMgbc1kQD+asQT+lKftmhCQnHFAIPNKATyKTAHmhCXnfNAwfIpNzjGaUc8ChCKQjalGfTGKDztkUIS7Y3rH22o2z70bep/ahCGUf8A4rW0Yx6ZraAT9qQkfehCbtD/APn1rRLaRupBUHPrT8jzWLLn0rhFroJCqOs9I2t+pIQBvBAqh6t8P7pHLRwlsflZdiK7QY881gbdWz3KD+lKy6RkvITcWskh4K8q9W/CvqnXY2s11PED/S0Yh7Sw9Cw5FJ0j/wCN1hZFZ9Tt0cjGEC7frXqR9Pt2OTEM/asBp0YOyj9qWj8KhY7dVlOv8a1EjNl0FyrTfhXotsojXTYe0DGOwU6m+DHRF8we86asZWHlogDXT0tEU47RWYgx4FOfto+CB9kl+9mBw4j6qkaP8O+mdETs0zQLK2Hn5cIBP3OKnIdGt0wFt0GPRRU6IdvashCvpVjYmNFAKl+oe/LiSVGx2SqAAuK3LaAU+7BtgAmsvlgeuanQVZcSma2/jA39q2LbAbkCnITbxSgAHxmurllNvkD0pRbAjdRTjx60o3FC4mxtwNgoH6UC2A3KinBOPGc0bnkbULtlNxbr6UoiGSMVvGAcCjIzsKFxahEAeKyEY8DH3rPJzjNKBihCw7AKyCj2oGfNG3A5oQgnxS+MUmCOOaMn0oQg77YxRjA96MEkHFBG+9CEeeKU7jAoJUeKUDAyKEJB9jikPG1Gd+aXBO44oQjmge+1Hf7b0hO+9CEpANINjzWQ34OKMD1oQkzjzQKC2PAooQl3/wAwoo7f/UUUIWJyxwMUYI53o87ZxRv6YoQjG+/6UE48UH33oGDtxQhKN6AN9gKTAHJzS+ODQhJnc5pe3JzSb5pcjHO9CEY8UZxz/pRkGjBHJzQhJkgnFG7Vkftisc5NCEvsRSb+MUuM+DSYGeDQhJnHGc0px5oGaCccUIQD+lGxJ/3oAB9qU+maEJM44oGT4oz2+9G/2oQl2ydsUnaDS/V96PHG9CEmADikA9c0ux3ozkYoQjGM+lIBmlP/AHajxvvQhHH3oBxtnaj9NqMZ/wCaEJaDzxSZ9qMZPG1CEu+OKx7TS+e6lHvQhIRuOf1oPFKV4I3xQfehCTGRtS58eaTG/pS7eooQkHodqMDO2aAMUZ9jQhZEnPgikPvj9KQgn0oxg8UIQNvFKATzigE42pMDPOKEIxk7HegAilxjzmkJycGhCUDycUEHwf60DH3pPtihCMeoFGPc1lkeRignPHihCx7RnmlAx6YoCj1oPuDtQhLyfSk84o5/5oJGBjmhCXPIxSb+1GSeRR996EJMe5opaKEJDxRkgY5zQxzmgYG3mhCM4PG9ZZ9hRnJxikwBxQhITjkZoz3bYAoJB8UecDgUIS7ccUhAHvWXb6EUhJPpQhLgjGKTg0ZwT7UbZGOaEI25yaBk8UHjcE0gbwKELLjwKDuM8UhIOM75o4Gc0IQASOdxQCODvQPORtQc4yMUIRuN/FFBzjz+9Jls0ISjY8mkyBtgH9aXmsgNqELDBG+dqUY8mjfO9Hbg7ChCQ5FGB9vtRnGxrIAc+KELHtFLv6UY5NIeM7ihCXOaAc8nGKB4xvQy0ISnA4xSY80i9ueayIyMjahCTPoBSZzvxRk+B+9GTjgChCXOdgaQkHk/0pQCecYoKkcUISHfagYJI7RRwMEUvPtQhBwMeKBnijceBRk4xtQhB296UDNJgDY7mg7eoFCEHHg0AY3OaMg8Up+kbUISb0Ywf7UbnnilyAcYzQhICBzt7UgP2pSSaD7ihCKPtRzx4pNwcHI+1CEb/ajfNKcA78Uh7RjGaEJT96MD1xSAg80vPFCEnB5NHHqaVh6YzQAQDQhH0/5aKMfeihCDzWI5oooQsqVaKKEIPNB4FFFCElKeaKKEIPApB4oooQlPNB4FFFC4ElFFFC6lXmkoooQlPmkoooXAikbiiihdQOKB5+9FFCFkfH2pKKKEIooooQiiiihCKUePvRRQhB5rE+PvRRQhLgelC8/rRRQhFKfH2oooQkpTzRRQhJSnmiihCDwKTA9KKK4UIpRzRRXUJKX1oooQsDzWS8fpRRQhKeBSUUUIQ3miiihcCKVeaKKF1Jk+tFFFCF//2Q==',
        breast: 'data:image/jpeg;base64,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',
        drumsticks: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAGyAbEDASIAAhEBAxEB/8QAHQAAAAcBAQEAAAAAAAAAAAAAAAEEBQYHCAIDCf/EAEcQAAECBAQEBAMFBwMDAwMFAQECAwAEBREGEiExB0FRYQgTInEUMoEjQpGhsQkVUsHR4fAWM2IkQ/EXcoIlU6I0NURjksL/xAAbAQABBQEBAAAAAAAAAAAAAAAAAgMEBQYBB//EADcRAAEDAwMBBQYGAwACAwAAAAEAAgMEESEFEjFBEyJRYXEGMoGRofAUI7HB0eEzQvEVUgdikv/aAAwDAQACEQMRAD8A++x76iAbdxAy5epgwLa2sIEIkkjbWDCrm1heCUdeogZrDQGBCM3MFax31gBBPSALjQQIXV7DWCF7weW++8EUK5GBCBV1MBGgNoGXLzMDKBqdYEIDU7mBaDURfYwWTMBsIEIEhMA+sQCrsYPPcbGBCIaC3OC3Ou8GlVzrHSUc76d4ELkpHt7QYFuQgK33EErQ9YEIlEk25QaQR7QMttoMpzDtAhBRAgxe3XtHAO40FoMDLAhAq9W35wCbb3EBSbcxAAA13gQhckaWgZum8D5z7QAAN7QIQzFI1EEDY9SYAPqjspCh0gQuDcn+8GR7CCtl56wYTzO8CEYuBvrBAXOtrwZN03JFo5Dra9ApB9lCOXCLIwDffSDIyncwAkCC8xObJmGbe19fwjqEZ26wRPM7QfLXWDKhYaQIRbiAbga6wWRJMHfKdjAhBOvaBbKd4AcudRpAVYnaBCCgL8zAKrDYQEpA1gWubmBCIpN7wCCYBVc9oNKQocx9YELkEdBB3AOn4QYTyOsEEa9IEIG4+7BZeYN46AsNbmCuDrAhAHXXeDNiReC22gKUQNbQIRL0MDVI2jq9htAJsNxaBCK2YawaU2G8C1xuIJKriwECF1f2gQPLPf8AGBAhc3KTeAo5t1WgaA7wAnMddIEIgBa28GFFPtAI6CAE6bmBCIi53t7x0k2Glj7QSRc66wROQ6bQIXVyTrA2gs1xtBjr+UCEALbmCJN9SbQRJUekGbgan8IEIwelxBfKddYG8EDbe5gQjvrvp0gz6hppHJII0FoAOvWBCMKAT3gJKljeAQLcxAvppAhEpB6fWDCtLAXg0HTrBHXU6QIQsOwgwc214IenuIPTpAhEUjN0g8o3BvAOvtAQADvAhFludjBfe05R0Ba+sEb9IEIJWDv+MDbuIAQFb3EGkWO5gQgBbXSDAKz2gioE7/lHnNzbUhKuPvLS200nMpStAkQEoAJNgunHUsoUpZCUJFyTsBDFUsXm5RKt/wDyVz9hDFUcWOYpmlIZWUSqD8g3PQmG5CZiTnCVept02Se2mlu0QJagn3OFc0+nAZl58EvcxDPVIgZXXATaxVlA7wskx5LZUtTaBa99k8ucc0+npbCUobT1JKtb6fQQomJhllvMpba1IHqSACBtra20Mti/2cVIke33GCwTbWazPCRcal58Ml5Nm1BeYJP6xV9Hx+/T6zOMVIqXPyKsjiVrN2zca33tsfrDxiXilSX5OZQpxLU7LLOVHO9xqNPUNREC4gYNncWYrFapDqEzcxLtial1KyqWABZxJIsfTpY72ijq5QJ2SNN7dL9PTxWl0qmaGujmbtDutrZFuvgQrxb4ouyFHZmkuNvNqHqDh05Xsd9IkuEeIlNxmgplXwmYSLrZUfUO46juIzdhHhhiBqddViVx2nUiTbCmm1OgCYWbaJO1hufeIrxKxXVeFdTlK3SX1FEo6FJKflNuWn3Tt9YvWVpDN5GPqq+TQIJnmKJ4LuhHHkFtgW5m5gKOuphi4d44Y4g4IpFbl0lLNVlUTKUndOYaj6G8PpJCttIs2uDhcLGSRuY4sdyMIWKtwbQRQE8/xjoJHM7xyQAesdSEDYbflANzureATl3gG9uQECEYTlG14FoG9rwFG2gF4EIEm3OASYGYAWO8AKtvtAhH77QWgNwRaDsN9bQWqjtAhAEXveCJzm0GG7G50gLNoEIBOXSAE3uTBIVcmD+Y6QIRJIBIIEGpSRsPwgj7XgwB7QIQt3MCOrd0wIELg3AgH5ecAk8oBJI1ECEWo3MdZ7jrHINtDHQOmkCERVASjmTtHQ1HWCUnJAhAK5XEEE5eekHoRfaAE3HWBCJQBF9YJCe2sdJ0O0Am+4gQiIJMBItB6HlAsANLXgQgpQVyMFaxvHWpGhghcDUGBCMqKuYjm5zW0gA97QABeBCO1jvBKTmVvAOu94O+XY3gQiKrGxg1HMNDHJBJ1FoGxtewgQgo8o6IBEEB2vBjQ6/hAhESBoIBBG+0DY8hBlYy2gQgm3f8YBIv094CSDfSAAnawgQhY33EQ/iXiFh6XepSk5kLSC+eg3AHeJXOTCZKVdeUbIaSVH6RUlQmV1CedmHXAVLJW4Da1+XvaI1S4gbR1VnplOHv3np+qV00syzCUNIDTQ1A5q/HrCtNaQh4N+UqZeOgCdAPrEVn6wyhaEFRU6RcMp+blY35R6yMy7K0wzc0oIbbItl72tbqREMPAwFoDSlw3O6qVoq7JcUh59n7BOZTQOVHLTN1iC8RuJSHGEE5mFj0sPMkWRsMpPOIZxx4uuUVAlW25n4N0Zkh4AOE6ap/vFKSPEOqVSdKZUvOrWoJyBOcWuNx1iqq67JjarnT9CcWid6tuhVBunyU67NGUEzNLGV+2dYSLE5O4ve/0h3lFv4Mmkuzqfj0uNgNPnaZa0JQdNCN7/SI5h3CAo1XlJqqSqvhXkp+JllG4l3NCCD07RN8SY3piKetM+GnALEBNraW1Ht+cVksOxm6Q2I4/tOOqN0oawbgef0wmuu8d6ZXFSjUysVFtKwluVAKkq2HyjmOvOHiZThfFDs7TavRpZ6RaaSpSSg5QNNVAbfSPLCeFabh9S6rSqfJvVCpgLSkWvy+UfdPWHqepL9Mob6qbTgh6c9U6VKzOKOnpF9xCWNqw0vc+/WwF8dB98JMklJcRxNLRxfdbN8nyt9VJ+GONsPcOsGyNGpgtTqcgol21P5ltovfLdW4F9Is6j1hiu0tmclXEuy8wnMhQO4jGmMJ2ozFOXOPMNtScqcgfQAAg6AZra25RdPgmrc3UuF8+1MKzIlqisM+rNlSoBVvxvFzo+qyTPEMotjHThZ/XdGjhiNTG65vnN+f3V12FoLKm+kEm60iDCcsaZZFDNZWmsHa0clMBJtoQBAhApCibC0GCEiBkF731gKSVm0CEAq51IMAJve0c5LdDAtbnaBCMek3Jg78ze0EFWFriDOg11gQjA6Axwr06iOiNBYEQAARtAhcgFI5QAsgX0jrLY87d4Fh0ECEQvvBpczdYABJtaCAyq0gQutO8CD/AP8AMCBC4WbCCBB7QCc3IwewNwIEILAA01giDyvBpIXvp7QdwdrwIXNzyvBg5oF7DaAk3B2gQgSNrbQM9hsbwAbK1A1g16nQCBCJOm94PWx0uIIq0tfWAUkW1ECEaSbcvaOSbnpBlJBGogvmOuloEIwm2pNu8BXq2MHmO1haCN0nW0CEEJKuQMCxB0g81tQNILzLnrAhC5PSAAAe8GVEjXT2ghsdoEI72sb/AEMBR/4wQvaBc31gQgTYW2gWCk7XMGoZdzAsd9LQIRKGXW2sdWC+QvBEBA5wABAhEQoG5EGABrBnQb6QWYEcx7wIUQ4t4kFJo4l0ErdeNy2ndQ5A9iYrxEk8+tLz6G0vtpuCs+hq/Lv3h/xviFmq4rV5CwlxDRAum5sn739oYqYZuemVCcayyygPKCj63Nrk9BFTO/dJytpp1P2VOLix5PjlFI0pdQQHhMKddUdClIsoAjQDnHXEDEEtg7CiA8iVmFf7i0uElaTpY9IUqnDQVJalZRx7zBdtKDlsoch7bxm7xS8Sa1T3m5ZUs4l2bUEIShQUVKJAANtidog1lUII8DKt9O091ZUBpPdGel0x8UeK9MxDVrvPqeW4sBd1XITcXA6WiycBu0Z5co/IIblWpUXabS1dRJtqeZJ7+8QjDHhQpdKoKKhX5x96tPAOKQhQSzLKNjkt94jmYuDD+CZM0yWmwE0tiWs2lqVP2kwoAG5vtCaCGRhL5bXOU9rNXAWNjgJsLjy+XVewSp6QW8855iSNighLaTawsd7xEKHwZpOM61NuTtZnBLsqBVIIcCUtjTdW9okOOMbiTprjSVrTewS44MxUdPx6do54NYSncOUuefmW0omaisOrD1isJt6Untzh2op2zytaW3Ave6poJ3wROeHbSeFIH6MmjSjS6V8IA0LJWFkqKRYbwjqFZqCVLmJGbU9MJTZxCrfa7aW5GElQqyqlLqZQEyTrS9LCwO2nseUQ7EeIkUyruJm1PyM6hm6XGjdt4ixAMVdS7acCw9bf8+Km00Zd7xufS/2PRQ3GOIZqtMPuJdMuHnFS78uvRKr6XI7fnFg/s+OJjuG8Y1XBNUWEuvqzMqJ0K0i4t2Uj9Io/iRVXalSHKwy+VTrC7zCL6LTprbqNI8eBeLv3f4lsL1J9boaqHkuuKT1QrKf1H0imppjTVLJvMfI4Kva2lFVRyQeRPoRkL6cpOYWHLnHQSfrHkzcvK21Md2ynXcx6aF46UakkCCR6j194BUU6aR2E2F+kdQuTfNrBgZB7wFKvvaCQnNzgQizG9xBqIttAXe+4gKuBpAhc5OmsGcw6QAbnv0joEK02MCEVipO9oML1tvBEkG2hEBJIPKBCI3vob+8EQOavpHZuCdBcxykZjc30gQiub6E/jHYBA2tHKiFGwAgx6TbWBC6zf8vygQWbsIECFzfqm8ESDuDAsU846uBzvAhcnfY2gXvoI6JHPaCVYbQIR7COQR0+sAAncQZTpvAhAqI32gtzYXEHoekAAA3vAhHpawgFISNtYOxUNIIHKd7mBCK9xqkmDvYbQarqGmkEBYbWgQi1O2kADrvB2IOpywV787wIXQI9zBKUbnpACLQCCTtaBCAsRsbwWS+vODJtpciADY73MCEVjfWOlGw3gDTUGObkna/eBCA01tASoEwCQNh+EEFajSBCMpsdDvAJuNfVHRvl5Wgja9rwIQSvSwFoZMcYrbwnR1OLUPNcBCATt1P0h6JSBe4sNSTFQ8QZz/V1bW8p0iTlVjKb+nIk/wD/AEYj1EuxuOSrPSqMVE1n+6Of4SCgPOzmd99lMq7NEryk3cWkfL7DnDpKyqqglAesl4qGx0J0sB2tCSRkZj4tJbaF5k3ddX/2kjYQ9NsfANPTCUpcUyLJQs7A9YgNabZWmqZQCdvKj/EnGScK0V4vllTovZKFApQnTS/XrFA4Gbc4lcTUzKJB2dRIqMysZLoTbZR/kO0F4g+IMzVq/wDDS10ILmQtp2Sbjb/N4sThU0nhpgkuPFLL7qM2QfO64QPyGkVDXOqanOGNWhEX4Cgu3MkmEmo2Ap3ihWHvh3n5KUklfbTDqDlSdPQBzV3iSV2VlMPykpLPOSxaYVlCEGxWo2uVHmTr7RXmOuONdw/RmGZZ5LTr93EsZCXCi4u4q3yg8rxUPEfijN4zpKUMvvMuNnMkm6SlWm/9usOT6iyFpDG3d5qEzSqiocHSOAZ0A6ea0QwtGNeIkm2ZZhtcqCtsOEBKAAPURz9vrEsrzbWH0/a5ns2htqRt/aM28G+Ic2xRvj53PNTs255BcWq2QJsPoYk7/FSellzjEtUFPhIAcCiCpA5hJiXTVd4dz+TlVlVprhNsacNx/KnOIXxI0RJWtiYmg4XW0IV6sp5HqYpDidxOkptpbKleUoaJSvdva/4Q2Y+4lTTzrRC3GmEaFadCrbW8RqSlGcVzb6XlCZadCSFkWUoXsSOkVFXukO1mFcUUIiG+TKR1J2XkcRtp+IdckZqTdLxJvlIT+nOG3hDilU1NYKDYWotTrxC8vzAKTlSD3ttHrWWGKHhpiUUSozTjrXmndpNiEX9yI9OClPXRHcE5VDJK1AOOpOoSVOgJ/NP5xnK922zRj/oWhpQCCTnw+Tsr6vUtwuyrThBSpTaVEHcEpEKSkk3vftDWnEshKlKnZphsrSFWKtriPVnEtPmhdqdllDs6I9TbKzjcF4k6F977T8kvV8u0EF2G8eUvPszZs2824bX9KwY9SgW0tDoIOQmiCMFHmFtBeCJCxtrBAa77QAn1aax1cRkenW14CVHLYwDYHXWDSSBeBC4AsSb2jvMFDWOSc57wYTbbQwIRFIEBJI2sIM672EAJBECEAdefvBX9WxgwNdzaAo9YEIrAG94BTmF4K/XaOgdNDAhFkECO7HoIEC4vNVuZg7ACAFDpeBlttAuoibm3KD0PMmDKL8x7QWWx2MCEADzjq+UawRRfmIBsDa+3WBCLvaDGo7QSrdRBg3ECEEq102gEAm4vABAV3gwcx1gQhm13MDc76Rzsd4Fyo6CBCPc8jA566QRBVppASADtrAhGpYGhgWAO5gEX0g730gQgoC145zHntAW4ltN1EJ9zaE8xWpWTQVOTDKUjU+qOFwHKUGk8BKRrvAFxpDHLcR6NNP8AltzqCb2zWIT+MPLEy1NICmlpcSeaVXENxzxye44H0KXJBLH/AJGkeoXoEWGukAJCveCJt1hPN1SXkiA66lsnqbmHbpsAnASjKUnWDNidD9IZpvHFOlQrM8VZf4U6H2MMc5xPdd8wyzCEoTpnUbkfSEOkaBcp+OllebAL04g4wUhmYkJRClLy5XXL2SL/AHQevUxWdNolUqOJ2zNKbVKyg8zy06NJUflFvvH3h7nJNyfmPManSZhSipawjOGwTrbkSYcae6iiSpaSl05iTndVdSlHmTFY4dq/c/gLV01qSHZFknyyvZLLrAClLzqtccwfaGvHU1MMYTeebWGilskKSrU9t+cLmHk3CPX6z/uX+TUaGGXi3IS7uG1Oi7SkpyLOa3Tvv/KCW+w2SISO1aHeKqDhHw3/ANQ1FutT07Lu/GOEgEXDYCrC9zubfnE44l16g4QlAhRaUDZLjhUCtI05wxYTwSJXD7MpJu5HppS1pcKvTobnnoIgvGbhM7MUt6XXU3xN5QoLNsqBpcEf5yiG2OVsO2Jo9bq8ldFUVV5ZDYcC3RR+tcfadQ2J7/aecfWSXiBmWgWyi/IDpzvFXYddqOLZqcxIhaFyUq+AJBSbF1A1LgHQdId+H3hym8UYncXMzQ/drIAS0sEqcXpcnXaJZj/B7mAKaiWabS4XEeU062cqUjS4tFbJHI1m+XgcK27SBrzFCe8bX9FXE9xMclZSYMgsNMvLzrZvodrH3iJyvFEz07NNJmCh9DYKEA38w3AHP6HrHhiyUZobrsjMKLjSF+alaNTZVtx+MRmmyEk9XxMoWjM0nQpNisaDa8RmNebFylmOIA7VL8O48nnaox561FLl0LbUbpPpBG/5xLsIT3m01l9dmzKhwrt/CTf8+UVvJ1REu66/PWsEqRLpTuokC31HOJbhGrS0pTFNOElbCEuTOu5IGVO+8PXtyo0sd8AJHjesTIbm5ZxLZmak82G0k2Eq2lOZSuxESXgSw9iPFVNpWRTaUuNTcysfcbb1T+J/OKzxbXvisUygUoqMyt1Tihre9k/hY297Ro/gLh44dwgxMzCPLnZgZnVEfaJSNEJP05dYy3ZmqquzHA59P7V7KG01MHu5P6/0r+cxY/WH/KRNFtKBckAE9h3MLpOadnW0FpMulCR61uWue8V/SsZpbfQy6ptpki4Ujc91c+xh5mawiXWHg8y64rYJVr9ddAOkaN8XissQB3WqZUuqol50LZnVtTLSvSpoZb+3X2iYUfxAtyVTblagG3U2sp1AKXAeuXY/SKdmMQmRab+LmABMq9CVWGvUa3y/rDPL8UWp2fcZlmvOKCUKKgDfv7QCtfSkBjreX9JmTSGVgJe2/nxb4rYVIrcrXqeiZlHm32HflWnYwqQLc7RmvhRxqeotRWzLrW8yVXebLZ8sH/3bA+0XXQeLtHrEwhhbxlJhdrIeFkq9lbGNRp+qxVTL3sVidU0KopJC2xLfvlScp9W0GB1giu5HeOgm2osItVRoinMdLwAMg1MGSVCCy21/WBC5vdXUR1paBvtrBgkjTSBC5CinQwCe0Dn6oM5SOZgQiOvKBlO40gDbTSANNzAhH64EdeZ2gQIXA0T1g9xqbwPm2MBYsLbwIXLjqGEFalBKEi6lE2AiC1rjgyirvSNNl/i3G0Z0uE+lwDfKB787RD/FHxlYw3IinomUNoR6niFaKVySddhz7+0ZKxH+0JofDjzqh5yKk1JrDU38OM5RqNFkGwPSMDrHtUBV/goH7bckZPoPC3it/wCz3sZPWQfiSzdfgcfP1Wx3+KNcm1NqdDssl42S0lKUqP6mOxXJieuXHyRa+bOoq/WK/wCEPF2h8csG03FGHXxO06fbOVwq9SFDQoVroUneHmdqMxTAu/mKUjWxTYoP8QPMDpyER455Gd+WQvB8SpD9PYxxiDA1wwRbqpWai42ULL7xH/JZN/wjxXjp2Rm/L85wK+ZIBIBH46w3UqrGbnUMOZQ6+0HGspsFjnbXrHpibDj0xLhYeLHl6qKUhVx7Rq6AsfHvjKpqhoa8MkCc2OMM1LvJCVh5J6kKH17Q/wBF41SU6+pmYbLbqBdXlqzadbbxVqMFoDzc03NzcwwRcywI8tSv1HsIM4BYRN/GqVMsTC/TdToIQOlosA54FwmHUdLIbHCvqQr0pVmfMYfadTa59Vin3HKFZJKbptbtFBimVugS0wsTEvUEZczSL+Uob6KJ5QKXxLqEm0GphTsm6pILLTa1OAq5puNB7QkVZGHNsmjoBcC6F4I+/j9Ffl9OhghdJ/pFTSuO6iW0h6edZdOzZNyrfS8ODHEaossFDi1tuJNk5khZXvHRWNvkKK7RZhwQp5iDEcrhqnqmZpzKgaJA+ZZ6ARXtc40OLJUlaZRkmyQD6j7n+kHWKpN4kYR+8JFolH+2XboGva8IxTnqky423LSsuE+louoCrnqB0hL5yTYKTTadGxt5LX9cJBM8TXZtlS2UTU25bQISVXP9I7lqJXcUyQffmUUltQuEOputQ9hrb3h4k8PzNPlLzczLlad1t3SBvyvHs/N+RLAg5rC+b/DDTm7h3wpILWH8m3qmeTwSw0B8XUnVPA/9psITf2h0lAzSHSpl6ZU6PvZ8o/AaRH5ufL7rry5kKbRoEpNgjffXWGKe4nTDeaWkkeesnKpYTfKOg12hhjIY8tblSHRzzYJuPopriXiJUJVKQiaXqbZeZ/CGepYjm2Aha1LcUsXUFGxB7c4aZmrTdHabmSMoWm/qsR9P6w6YccdxMrPNtLl5cfKsi2c9Bf8AWJwva7lHETWe6Ak0nLO4jcLgWphANlKWSEjta+p9okjVBZEsEOLV5bYshJ9CT7jcnuYVJkGJZTeVKW1NiyberL2Gsejci2ppxSip+YOoUoiw9ukNEFxt0XTM0WcEkYUJJOTI20kfLkOkeTk6zMpA8wLXfRKTqPaGybrJFUUw8yvM2NkH9NYWUmR8yYDyWFovuSd/aOhtsBdc8clOMiX1TzIQ2220g3KM19Ou8R/iswspQpxCVypWM7ZOhOlr/wCaxJqjOsUSVBYI9Rs4U/dP4xAOIOIpypUyYZYUlaFC2Q/MCLbd4bmOCEUoLnh44TamfEnKMoS0UvMTLqhfVIQQLc/pFU8X+ILk5OTCEqKXWtCknUbWiyXsWsSOAwZgDznT6VgXKToNddv7xQfErzKlMEsOlTk6yAVJ+YELAI33ivmLxtbdaCgY0yOc4cXVhcOppjC2FUGYdCppYzu66gmxtvyiseNfEZdRlZiVYmEpmZR9Kr3vpprvtHOMBWMP4eQh4KDhGcG/qITbQ67mxMUZiTFDspVGAmeS5MTKfMmHCb5QSLDfU/1isq53btlrAK40/Tw9xmvcleWK698HWHH3nM+di5zG5zaaHXnEGal35lkT0x5qWisFttr5lXIFh02/O0Pc+81WJlCTOhlxfrZukEvWy66naJJhSgSYam0JeW4gXTmJ9QVYAka8jb84U2S4U97BH6popbapx+Xfm2VgFYaaIczW20t178rQ+1jEDFGlnZUIUZibd85RQcxXa1gNfziH8V+MNE4MYXbem8sxMtoyy7SVfazKtNRr6feKW4O+LesYx4iFuriQkpaacAacQ3mSwLiyVX3BiHUFzu43qlwhpO5w4W1+CfB41R+XxJPvSzc2iypKXuHEMAfeXyKjzHKLlqtWUGm5mZQmUcAsp5nVKu5HLtFN4Qri6OJcts/AIeAKnZNRfkXdBqU3ug+2kWphGt/vxCmzMy77aU5Vsgldz77299InUlJHE3YwZPPmqOuqJJX73nA48h4LwrNcDSQsTDT7yftEqSSgDuT0hnoXEx5quzynWvh5kIHmtoVmC/4SkXvY89NYkkrhP4lb7LBe8sE+hQ+0lydxqdQYZ1YGl6DiGSq6FiYRL3l5lB0IQTobE6KB3McqadxAcE5SVEeWHqvZxM5jBbaVsTMqo6lC3c4Vuc5N9AIdMJ4Zq8wpJl0IMupeV2YJ+UC+2uoiVSlIabSw8hKXGnyEpavo4D3voesSGlTHwTTzK2kyaJW5W2NUtDtrsYhf+PZu3OKlO1KQN2sAt+ifMP4fEhS22SoFCxa/Xf8AMweOsKTdWwpMy9KeUisSiPNlQP8AuEf9snYgjT3jqTrDXwLS0Eql1g/aFWiib99P5Q90mrOOU4kAg3sCR8w1094khoHdaqaR8l958ev381QOFPHljHCbpkn5hK1Siy05LzjF1NqGhSdiCIvvgn48KLj99EnXGW6RNHQPoVdhR731T+Y7xE+L/hno3GS03Mf/AEut2ypn2Ui7vRLib+u3XfvFeyPhJZwVPLS9iRpuaCfSFy5Sk763vtDUVTqUMl2nc3zVlNS+z9bBZ7Ozk/8AqDz44FiPVbplZpqdl0OtLQ424MyVoOZKh1BG8d5rKsSYobw64lqvDaV/c9VelJykKUVMvtO5lS5P/E65T05ExdEriumzqR5c7LLv/wAwCY2FJWsmjDjg9QvMtS0uSlmLG95vQjqP2PknKwGxgs4HOPNp1LyQUEEciDeO0kqiYCqtA68vrBpQU7XgZrG1hAym9ybR1CCiAecA6ptaALK31gZrdbQIXPl94EemYdBAgQuPvcrw040xIMLYYqM+v/8Aiy63AOqrafnaHYd7xB/EYy47wpnvLWlJum4JslY10Pa9ojVjnNge5nIBspVDG2SoYx/BIv8ANY3xLNUPibxHlEVmrPzs8XbtUwLysqNgcigNV9wTFoU/hBRadh16SThKmtSUyPtZdqRaSh29vmTbU+8VZ4esFsu8X6liOpNAzFCZDcq0o5kpdcJGc66kJBt7xpCQxAqdTrZRtsN0+8ZLQNPibAXuYAXHwyfVeie0OqSRTtp6d5LWgdbAHnFlVOAcf4X4CSMxSUU1vDVLlJsKbl/J8lsIXbOu2251MXZWpNdbw8zNUZ+UeLiUuIUpd23kEaEEducVrxbw5IY+w/N06pyLc5LTKFNrS43rYjUA8jEB8AVcm+E1WxNwxrNTmajL0BxFQofxCru/u54kBvNfXIu47R2WmML+zfmN3BGCCuPcyspzWR3ErMuachwwLj0PN/FWXJ1iqMYlRJysm2t9m6VsKeCXGTuCm59SedhFxSzRmpFCXBd9SBmG2ttecRGo4aodXxCsqcYenJuXUoWXZxgp1Cgb6GCpuPm5xmUknJpMzMJYKlPNquApOm997RJ0mF1MHb3Xvxn7yqrU3iqDTE21ucfeMf8AUsxJR1y0oC04lyYTrZ1eRJPTTY94rPGeIKy9VZeSl5mTpjDyVBxQuuYuN0pvpY8jEmx9jOfmqXKzFOabmS+ry1tqNs526w0YgwyqosS7lQzSy2vU3MS686pZWt0kcwOkWrZw+7Qk00fZAPktfPr8kmofEeSF6ZLuuTHwv/6h15eZXPcX19oklF4jUusF2Xl3Gmkt6BItZW+tuQimsYMtUuZM5LqRMTDUwkInZbRtQub5xfe2/eIPjrCWJ6Rjp6YkKpLy0rPg+U6AfKSCDdK7bdf5wiSV7MgXCuqeghnw52026+PVavpeM5auOLTKzCAiSUEuKSEklWvpSSdIdqdiFicSsMrQtKFELVnCltHXvp7RkNutYl4XYamG5mYbcUSV5mVlQIVfUkkX/kLxLaLxddwzhtBbHkqmAlbxSPnO5JN/8EM/jwD3xZOS+zpIvC64JsFp8vEkueShSQNH3lXJ31AhpfxciVnDLrW44tYWsLSLICRe5Ov+GMu8QPHFPsVNl5xTYZZGREu2qybWPf8A8RKsIeJaWlcKrrU/MMuz04SMiVelpOtkAX35nrDbdVhe8taeE2/2UrIoxJI298ADx+/gr0exvLzrbKWyHwtJUnMrIkJF9Tc3jiexZLSVJXNzE4HUqvkCRkbG+w3P10ihZjj/AE6rzRqk6G1+Q2coJsANdxf8BEVpPEap+IHEq5WXnTTae2sIbSlJUt7fQAbCF/jSR3BcnhJHs+W96Xutbyf2CvKZxcnEtZlkCVDkqlC1Lbb9KVH7pOuoiR4IorimJxfkNuqsQgaBIUb877W5RG5HC03TfhW1TDErLy6QC22c63bC1r3smJYuuKk5BtDCWkN8wtZsn6D5os4WlozyqWrka7ux8JTT5EyDTTc840+hhWYBQzm/bXYQ5TtS+IspuXcOQXGtgPp0iI/vianJ4oMw5dOiQ2kJSPpuYkUhLTUnJh6feeKdwCEi3uesLdnlQXtIzfK8JrEs3KTAQWEBRHpUVXtDdNTk4qoJdeW46395KTkt2t/aHV6qU154rCVLI3Pm2BjwfxrKMhUuhhkoV92+YHvHBZdF74akpqbb76LyypZN7Zs1zfvEkTL/AA1AK/PLYAuLC/4a3tEUmmXPhhMoZQGeWU3I/PaEaMfTEk0WCpKmxsDrlHbtHHldMe621PU3Xm5OmhtwZGnkn17699fwiI4ir8p+7AlKlJVopeQZiSCNtecdVDGPx0sJcoypDoKl3tcdN+8RjFVUk5eTUW1lEyyr7p0VrqN/wiASTwVYRRBttwUKPE1mn06eZmG1LZdWryllVshuN9fwiIUHiPT0YjkXFsFxuWCi6MuiO9r7agxM5jDcjiJudZWguS07ZwKHpLatL215fpEbxFRKPgqWLaVBRGQu5eak2sLk7b5usV8kcrSHbhYK/p3QvuwNNyoJxS8QkniKrzMvLKUFZFtNZwU5CUgBXtqIo6g8P2XqtNys/NrW0lhEz5gVY62uN+0TrjDjqQr80lTDDPmyuYhaEgXGh1PMcgD2ihOPHHZPCvAkxPSy2nqvOoQzKy616rOmp12AteKqRxkl8StRTQimgwNq8ePPHbDvBOdlKxVXS222lUrJS7YzvPk2KilN+WuuwjP/ABM/aI4hqNBLODZF+l2XndmplIWsp00Qm9gepMQyuYTq3GmoqrFXmnJ2dt6Sr5W06elI5CJZJcCXXMHLeRL2JRY6ach/5ifDEAO9yq2eZz3d02CbsETtQ4lpVUarMvTkw8nMtx5eYnrz0HYd4lOCcAGmV9uaYKnGlEZTa5QdNLQ/8JuBMzJtMIWtaJVdg4bE5NtbX1EXHgXhGmlVl5tofGMSpGSYCClCttNTAaUvdhDZ9gN1aPA/ES38KSvmpdYdlPSkBVgtB3G+3vsYvnAzSpRcsZFLSlNJzhechTQP3Ml9YqTC6SzIMNSaGrjVxsi6htdFr7HlFlYcm2WTKOtzOWYdGa2o8q26b3tFkymDQFUzyF/KtJOK0ifl3UuKlJ62VWt0rHTU2Jh2SaZVJCcMyy0t1of9QwDqQfvp158zFTzOJhV6fNqCwpEqQUvA7q67/wCGGabxXVEzLk+ypYCmw2t6/pWCLWIv/hjpdnxTLKMHINirywA49LSTzsklbkg0oobfcIUUDmN9bQ/T86mm0szrrSrepBWpQs+nW5GsQrhLX5Gm4DQ7PqWkMhSSM25se/zw/VXD09XsNMyaZhSnE3nG281ils65bX3I5RDcxwG1o6JwlvaXebC/zCkkhTmG5RtpqaS4tZExbZCNLgDW1u3vCxxMwuooaUtS3HwbJTpkAvqNdrbR5ppzFLrsu2XEmQnAkNqVoWSU/Lv1+U9jAqEjNy1TTLpCmZdkEvs+Z9p6ibLCj939IafHYcJuOQPdg8i+VI6dKOTs0DNrcU0ynIgZtVD+LeGXjVg9eK6B5shNOfHSSVKQhacqnE80g9ekLEVNFJlwlKXnEp1WAq+TfXfWFSZh6flVOpBMudlbgb994WY2uaWHqou98Uomb0WdaJV8QBzJJTM0tajbKlCr84sHDmIMWyDKEzzKZgHlcFVu9toJeM0UrFk5IqKQ2n7RBFha97jfrDsMTsZLJUlJJ36xTx0jWk98rVVNcZWgdkLHyXozjao0qa81mZnZBxJuEJcIA+l4muEPFm7KthirSwnFIIAdZUEKUO42J/CK+cr0pVCth5aSU732iJ41pjlFQJllWdlRtcH5ex7RHlqKmkvLTPx1/wCKIdNpKy0VSzPQ8fVbQwjjSnY4pSZynPpeaOihsts9FDkYcwATfeMy+D/FiZLE8wiZmPKTNoDIC1WSpW6frvaNNcrDeNvouomtpWzOFj1Xmev6UKCsdA0kt5F0CoX2MdE50xym43EdWFusWypVz5XcQIOw6CBAhGfliufFHVGKNwSrkzNOlllhoLCr2soHTnE/Uqx6Rn7xvcQZROGzRlIRNBCc7jKlWQ4vSwVrsB+sV+qSbKZ1uSLBWmiwGWtjHQEE+gWafCHxGleI+DsQTcnPiemUVYtzKhceUAkZBv0uYt5WNVYem2EfGGWczpKydStOl0784zp4JuJaG+MGL8MzzNOk1zrLc9KNSqEoTZtRSsabqAIPteJL4qsVzeEptKmnFth/0LW2kFRSLekX26xmo3n8Ixrj6r0Kror6rI0CwIBHxAWhajxioMrJOrk5tyXTultSw4nNpdNje0VrW+JsnXuKuFpiXxBP01htbzNQlWmGstQbKMyELURmRlUL6ERj2e41TvwLk0y9dMsvKtJXdKu+/wCcKPDVxcXxi41okXGXJiQo8m/UJrK7lLISnKhR119R2iLVVJIsAplPpAhaXk+P8LT2NOK8rN4qLaH1IlkJJcWHCM4A1O+xhJh3jlIUOtUxdKftKz6FCZY1Al+WcXOmm8U/UaqzNY4DK1ecptsrUi+ihbnrt2hPifiJLV2jIpMj5EvNzKxLuTDKQAhA3y252jL0lTMSZXGxvj6LRSUcRAisSLZ8PUrZU9xVZmWZCVkJcJk5fLdxRuXD+OxhyxliZ2mtAtoW75qg2pQGYIJGxA3BjM/DTii7T6aae8tL83TCGg4TcrTb0qOsSV3jxNUaTU6XgqzoWQT94fWNrFXAtuTa/wBFkXaO4SWYAQPrfqrBqAk6dIzzaHUSj8ylX2bg0QvW1032/tEaxO9U8F4FaxM9IpMvJN3n0Nr8xrLe3mAX0HM9jFX404ruYpxYqszcytqWLRS4lBtmUAbc4ha/FLU5mg1Ohqm/Nk5ltxh1u90qSoEEHWHBWDO74K3p9JkO21r43fuLq4Kh4lsM1KitTCGmUpS4kmXXZTboubi1/wDAYinFzinSHJZdQw8+3KBxB86SKwplR11R/Ceo2jO8zQ5Oj0SmurqhWta0jyQqxtrtrvDDjt391zc2Ka8/NGZIQy1f5Sbgga7RWT1UrgQ4Ba+i0alZI10bji/PHxU0w5hCr8b8UsCjIWlx5z7UldmW0XN1K6ewi5qh4ansO09DSa6+/PiwCQkBkHXQa39jEJkcEz3htwFTplvECJisToQt+UaT6EKUPlB3Va9u8aR8PvA2v43kJOv4wm36ZLPgOt04JImXU7grv/tpPT5vaJNDRMvsey7voFF1zXHRs7aOQCMYAtklQzBXhLr1YnENPzSppp0Ar9XlMNb3zHckdBqY0zw04S0XhLhJUnTpdMxNKF5idWmxcV0Tc6I7b9Ydph9ukobaZ8uXZQLJQE30/wA5wmXNS09MWmZh4ckJtZI373jT09NHGO6F5ZqGrVNZ/kOPALyamZlh1Sg7LspF/lRmIEIJnEUyFuI9bgJ+YpsSPaDqkjMJnT5L/wBj/wDl9YcKK6qmybrkxLFxCtEOZyix12PMRI44UHu2ucpBSsVlh5IZUhLtt1aBHa/KF6qlN1EHNMzLJ2cQpzMD3Avt3hjq83Kqn1TMu2WF7LQVXCjrrDbU6y4mRztunys1la2KT03gtfJXTEL91WIxhiRRQkurUhw81Ic2PQa/lEOr841SapkKy8CLoCT6vYmGuRrj0jIqb+0SHh8wOgPW3SI7Uqs8ueaQoK81ainff84SSb2XYqcgkuKmLWPpqnSakJAcbcFgM17fWI6aw/OPDP8AZqSr1lJuFJPSFtHkDOyKHZgGXPO52tzENOKZgYffJQUqS5oDfQjnDErWtNyU7Ha9mjKXtzPlKUy4rOyvUdR1EMVblGqhU5ZKZgFkLyK152uOcLaZNfvdlxLhSFss5hrv7/zivKzLVSl1d+YbU5+7VFLiVblJHTWIMoOLBTYLOcQTYqUnHsnhhh1MyLhxtTemmRWgvv8Aj7xWmJp13FMktsAoEwoJQ8dgNNd/x9oeG6NO8SKY8heVASFOIUoWzEWJG8IJmoLw/g9+Vfl8pbbSppSt0rBB687j3iDVE7Ru4VrRMa1/c96+Vn7xfT0hwC4cT85KqDs0uWUxLBW7sys2SbX5AZvYCPn9haiVLFc/51VmZidmb/7jiio8tBr+FounxZcZ57jVxoqFKQhYpuGXTJtDPcOuiwW4dfoO0OfhYwBSq1i1lustTbkkAVFuVWG3XFC1m0qOxJ5wimizbi6sqiYlveN7Lx4M8LfOQC+jy0EgC+g5ag3/AB6RpHC3AiXm8Opl5YocKsqn2nDlcSPT8ov6hvoIl1A4U4bpFODrbUvITanChLSEPKXYlBBCV6BKRob/ADHMekOM2yxWMRtOsLUEypCQ5sHFAC6rX0B5iLeKBrRlVL5S89zC5whw7p9ErQa+CQqSPossepJsPULnQH9I853AcxQlPu0+y5RLxLjCheybi3P/AARJZirreQZcqAeKErufmyDbnrC3F1RDK5clvKlxIJTycVYa77cjEsbRwmGiQHKhb6Gpqpocl2/hV3CEuZuZAFyekeuIlzODzKSTTi3S6DdwnVF97a/hEzm+FjztDRUr5JF4XRr6x3326QtTgVNYw02QoTkwDZGQEqJHURyQbrgJ1k7BY9FHMH4fcnsPrmG5wKUQq7WuUEcjr83aF1GdZmsGurdBQ426hbRCvnQTZSDrunl7x7UPDT9GptSeTMKZcbQpJZOgUbfMddPeGbBmE5t/Bi5xx9Lb4StTcss2UpI1Kjr9REQMseE443ub4uFavCWjTU9xHblLImZCouqclm1i6EFKRmO+43ixuIOKf9NS0zVZhRbKB5yH2z6Xi2S2Ub6ApVvzIisq5jF2n0fC83SkBoSC2m0KSbec46n1Am+xOhixeMz7M5JO018pl5RFPUxlOuRSkldxryULCOyNtE7byoYBfURl4wenof3wluL69MSPDeQNRQhlaWkOSszey0ixKUr16Wt31jwpvF6Vq2KKAmfl5hUzPpEpJpRclaje6r3sQDrr1hsnMN/+sNIo4qLzpostTEqmSh3yy2tCcqsxJ0Omm/0h+w/RV06SpsrLyan2ZB1K5GaUcx8r1fKb/Nb+UVcjJSQ4HGPO9rKWz8OxhY4d/vX6Wvfr+oUqTKTVOm1FL0siWU4QSBnKN9bHpz94a8d4wGDqbMIbu43YleU++trwsrs5MUKnPzCUl5Wt0g7HX1DXl+t4qniLUZqYkfMLoUmYB15A699v6Q7K7aCByodPT9q4F5wmDhRxaoGI+J9WlqlJLnX30pQ2sIK0y/zXvY6Am2sWhjjh7h2YkwuWqUzSXGncqlMr81te5t6u3MRR3hhbq1Ox7XZehPLZqM3OJDoCG1JfZy/KSvobmw5RN+Jia1Sas7K1OcfmUNqV5RICE2ub2ANhr+kVkTrU5dI2+T0/daKrpm/jWsgftsBi+TgdLWSqoM0ugTqUStRen0rHqccRlKDrv1hfLpaqcsuVKgUPCwubjXaKvXXHpNw5jmbv+EPGGsTFM63dZCSfTrtFI+paXWIwrR1E8MuDcjqrO4VUtM1VWqZkBm5d+Xml9Eeqyb69NY14gZFfSMYYTxG1Sa5Vat8S01KzRbbW6pVghSE2H57RoLgTxacxU+9SZ99K5ppAdYUojzHG7bHqRyPMRpvZmeNgMXU/3Zeee19JNIRMOAM/G1/krNzEqgyq+/5QQFxoYIdo2KwK7sn/AJQILOrofxgQIXhUZgScm88RcMtqWR1sCf5R81/GXxhqlGqcxVUJaeTnLjqHb5XEkglO++9o+kdZZNSpM1LpVkVMMraCuhUkgH84+cPiMwP+/ROScxdbiSW1Duki4/KMr7SyvaGBvW63/sE2E1DnSi/Hyysx4eXWaZ4s+G+JJd5qmv1wuuIpaVFa1Shb+0cdI0SgjUk9BGguNHEei8a+E71Qo023PNyD6pd55Gllp0I168jzESHgVwKaawxX+IFVkW2ajW2RS6ekjMqWkm9FBNzp5itNNxaKB4jcT5yQmK3TadQKZTKc0wpLqZNGVy6QLOKF/Uqw0HvFLHJMxoBHdOfNehSR01ZK90Rs+OwvcW5yPE82HoqwxPPS8jQ5llqyFZTcA2Cu+/4wg/Zy0pyd4rcQq8X3GmaPRfITr6XHHXNEnXYBMUhj3j0mbpz2afl6OpsqU6qblnXFlAtq0E6Em+l99YvLwTySsNeGCcx67VWZgY7cU3JsNK+0aaYUUlTiQfS4T93kIiS1Ie0lo6KRPTGKPs3nJIS3E2P5uq4wqaGnFsusMED1WKhfXn+MLKLi1ufm6SJO7DLKM7iidyBcqJv+cRdRkqituZbWtyecfyfNkS0nmD1BhylmkT0+oPOoZaZ9IQkZUhA32O5iNTU4sE5JKrC4PYuM7ixE4aifOqiSyuWWbAAH0ka3ic4zm5pcs4l1SQplwDKk2zJOxiqMNy8vMSgfDA+MuVMrb0WhI0SBrp3iwKniOYr+HUMPvsylQQkZlAArIA2IvoDFtHBdtlAdJaUOUQ4i8UPhKY82tzyEsoKbHTLof8EVE9xKCsNzDdLsuZUCSsmxuTqT/KFHF7FsnL1L4d9yz615QDqSe8Qh6YKZGYakmPJWrUqUdzrrbrDzWYyreAWGE+yk/Nocamn6gC6ixSlRJCiBsNYvLwzcPK5x2n5qWo9ImKjPMj7RaRlblgb2K1k2SOfXsYhvhF8L1Y8UOLmG5Vt2SodPympVRxBKGv8A+trkt1Wumw5x9UuHmDqbwuw5J0ql05qmSUq0lpIbQGy9a/qWBuo7kmJdLp/av3HDVWa17Q/hG9lFYv8A09f4UB8OvhAleGbzdXxK61WcRtD7Ja/tJemjX/bB+Zf/ADI9hFvzc2UuEp85SDc5gcpV36wS3pyfCi0048lGoQhBI+sN/wATUKm/5S1FlOaxAGUX/WNJBEyNu1oXmdTUzVMplndc/p6Be6nFFKiEga9bn667QlmZEtqDoSSnmocux7QtnqTMSpyOgjS4I2UITStZNMbUksrcUvRJUqzaBr+MSL2TAyLhIHsWOreyeW0lKdEgaddze8K5nHkpKspCJqYZWRlcYdQFtq3vbp/SPHFU18RL+Q4ZKaUU5kOs2Sts6nU84ZZ7D9RqSFTYLaQpFiHDlvbQG3XrHNqWGtIu7CU0bEkizUZlx9pDjZR6ArVKD/SI7i7FUvMTy5dDZQwsXzIFgD0MN88zOSaXG32VZjsQbBXa/wCkNTLynlrQ8cigLEHl/b+cMvBJBBwpkTGDJT03xHeYp/kWQ4lsZblNzDezioIeaWpAzOuDysxvbv7R64rwi0zRJOZlVeVZv1uA3JPeImk+UtCXf929kkHQHqOxhLmkZulM2OB2hTrEePE0yVDDt86xpY7xDqlXZqsyKEurGVDlkknfn16Qx4rq7786Eu5lpb1CxvDvRGWpinOuuqSvzwFsqSdjEEwOkdueVIAZG0bQlhxIiclv+iK2n205DmOhHMGElBxJOTsvKU1SQt0vK8xKv4NDrrteOKZTnKpTnHUONMvJXk9Xyr9/5RI8OU6Tpr7DjhCJgD7VxW/LQw52br3JTRkYAW2ulkzIomJFmWlyW33FAGwspG3+e0V74h5F+j4Kq7yWXJmZpksuaDTein0tjPYd7CwizJhT2IXlzkm6Eqk/9pIFr7Xv7xXPFXiZ/peXXXKmlS0UhlyYmW0ozF2XQi6xYbnKCIi1e1zcp6iLxILdP1XxywtiWbqmMp+szT6mnqpMrmXEAZgouLzWt2vGhuF7TuHJxpybZcZZeSF2WLXGmt+sZwwzjyl4o4kvzdPZMrTpifcmJZlViWGlOFSE+4SQPpGkOIHEduekKdTJdTdlpC3Fp1KdtAYjsOVfmO49Vpvh5xncdkSppaJp5SQhLkwfMUgWAuCe0SGmKLKCuVdQ4ZlOZy/M9N9CdbWjNfCiqPSk0hrPmBsSAdBtz/WNC8LUOVud+HUsNKVYgq0G43P+WMWUb7jKiPpwzLVKESfxEy3MNtnMoAg876ek/wCbw80Hhs9iTFNOlXHlBudcCSSbeWNzz00GkP8ANYTZw1T2J5D/ANs0pK1ovodtu4iV1muU+ew6sIaS45MoSVrbGRSALaJtz/URIBj8VWSVEtrNHKS4kxHIJrExTG1JTTpdv4dgciE6def6wy8PcUHCU1MOtJLsuPQpSdS3roe3eGWkTqHpqcXMyrIbbFmrKzLAHP3/ALxKuCdXp+F5OouzgQ6qoggpVqlIvpoeRjhZa8l03YBmy1+FAMUVqZquIJyZCggvLKsqdrHtfftEmrVNl6r8ApE8l1iYbRLOPhHlBCiOaQdE30v9IaHzTF4rcJkU1KSClAN+aUWJ6KHMdId6XL0+rU6YkXnXmLL1aCrFASbpsef9IQ1oIueVLe4ggAWAXlhmqSdGlmfjiZyVo008lhCVEBxfI77DkI6xhxvl8SNSssUraVL5kvPKXdLqb3Sd9hziJ1ubMnWJuntqSplX2iSOZ11Gu0OfCbhXOcSKgsyy2kKbdSh1taTZKb3zg8k3EMyNfI3Y3qpTGwxuE8vTKvvh1SU4sws3LLl3XKay4p5wBWUTKiCok63CACLiJMjiZJSFRnm2C2WZiYR8C02DlQlKLHLY6JBFojMhLTU3T8QtNzyZNmXUBMIScoHoyJy66DTl1h/4M4eaoCDKVRuXbVS1Lel1vp/3GHATdKuZB2Tyhotc0tYz5+mFUSOjdvlkz5Dzsb/O3wThNMVXE822yptuVbmr5BaxCdbk6/lDNirhPTavhxxJ85pz1+TNpV6XLX1Iv8t/5RM53FtJZl3p9L5WJl0y6DcjKkbqGt/8MQriBj2TpNFnlMPB5mXYccbSFXCAASQNewMNTGNoO43Sad0z3gMG0KneC9fp2DKRVHJ6ekfJbn3VBoazLyxpbqEfWPLHHFdnEj+VnP5JUVlKjfKTe4B6cr9ozdgjia1iKWdmEujOtalKJN9yT+GsS6mV1+ruoEm2ty2pVy5xmpdRPZCNvC9Gi0RrZjNIbn6BTqdnmphy9/SeRj1elJuWw3PTUukXDR8tatr31I13tDNJsOFxSptxtpCBdRSbkHWwtEknaE9UcBTCJVam32j8SwpRJuQPUk/8VJv+UUchLi6wzYqdIREG3OLhSnw9Ut+u4OCplfmtszRJacGYOi17G8K8XcUJnhp4qsLTrB8tmbkUoWgGyVlCykj/APybQg4U4x/09h1S2EhbTpbcI/hBNiT3iMeLTEcrIcUuHcyk5lPPPoAB1UApJt+caHQdgotzTkW/VYvVA+XVCx47rg4D/wDN19HKZOt1CSZfaOZt9AcSexF4UWsYhfAirGq8KKK8p3zlBkpJvcix0H0iZ+aTtHoTHbmgryGZhZIWeBXpkECOLq6iBCk0vMsqUDsIzH4w+Asw0zN12lSzjzEwS5MIbSVKZWd1WGuU9ucagCrjSOHUBabEAg6EdYgajQMq4uzfjwPgrPS9SkoZxNHnxHiFlDFJaw/w6pVObBLbEqw0k2sVEpKibdbxgLjtRZdOOalUJt5culjN5TKbj4lRAARv9TH0r8UkmzL4pkm0oShL5StQAsPltGQeO/DKUqsw4fJQ8vPoeYMUU1I+9gfdwvQvZ7WI4gXOB74/dfPzi/wRlMVYZcXMryWuoFs6AnUC99bcoUfs98FSmGuH3ECnGYUZmVqbLjbK1myW1N/MkXsLq3i+OJ3DpqkYTnXjKpCkIOXKLEm2w/rEL8MHDqo4R4C4qxG9TUl3FlS8mVWT6ky7AylQHO6726xUV4bGzaVqo6k1A3DxC8qph5mmOuomghxE4m6WUmyr8rdNecMbLc9TKWiZaT8qyjyHfVfXQg73iQMutvSaHW2lmebdCFlSrhaentHpLToxPVpiZbnA18Cvy0IbbGVChz13MVtO8HKmuY8GydMG1VUy7KzLri23GEloobIbSgHe46++8K51K23ZhcmpiWW/dCVFzzXOfPl/K0P2D8GP1ajTk68W0uvlJyFAAdA3Nv584VUXg9N4s4j0eg0eXQ3MVyYRLp9BKUZjqtQHIC5PtF5ETYKA9zRck2sqJxzQGZSWdEzKurmluZg8tQNzrqLfeja3g+/Zr4Ka4X0rE3ECk1er4gqaPPRSJtRZlJJBuUEoBuskWPqPPaNB4T/Z0cKMG05uTn6GrFFUWEqenZ1ZK8wN7oSDlQm+wi6l0eTpFGKUBSlpTlBWq500t7Wi4pKLa4uksVmNR9pO0jEVPcZyeL/0otw4whI4OkGpOh0uSp8qynKhtlkNtMjXRKRpfvvCmszjTL7pU0l4pNirzNSddx0hRTa205PJYdUchNlJRoRvtHhxBw+ijTLbskhZYfPqzHY/0i1aAMBZ0u3Sd/kp7onEiZkqMJSXlm0JtYqSi5P+dYbpt9VYW5coCj8xUbZTrqT0hPK8W00KQMqqTZS7lyhSU36x5muS4lW/h0pacmFXdedOnPQdoU0prsHNJO211JafSlLkfJfmmptTYulbZv5e+h7d4Zp/DzshKvzrDCg6hZHlOJzMvHXkTpfrHnUp5xqUccDsplQDkU26SVDX0gD8rxE5zG7iqg9LvBx1lDKi0X1n0q1vmSNk7wu6RFC8kkFQzF+Jp1mvKkmpF1ucdcKlsMArKTc6psf7QpnOMjjGVudknWpphJSlaklBJ11IO/eJhg6tyFOqsrVksNsiVCmZlCTmy31zpJ5fpBcV8TUfFMs4hAZeZc1KrAqQddUneEONjgqw3AuDHR4HVMPD/GshiWnzTE+ptxSiVICtAR279ojmI8NiemRMy+YtNkjLm1A/qOkRhc43JTDrLOdCmDYvIFwnp9Y96fiRymBSkvZgo3IBuF/0MNguHPCkugAcXMxdSqXwfVHsLvL1dldS22tVlKHUdogLsq5UJyXZupkKdDfrOqFX59Ikk5xUnM8rlSfgnAWxr8qhy/pDBXFPuVVdRSkqQghS0E2zdx3hPaA3wksje03cQnniFgGYwvLNOZhMy7mnm2sUHoYVcP8AAjOJcJTrGVSEsHzGlg6pURtHFU4iO4lwcqTQytS1gJzKHygde/eGvC2PJrB7kw0hClyqwAs769RDe8lpwk7XkWJykkvMok2fg7qCkuArI+7Y8oksrTFzjC3WGQ+gqzOAnYm2oPSGehT5xDPu5G2zL3zBWW5udx7RKpavfuGgmWSyfNJuSBuIUbBm4pLy7dtbyiRhifwvT1Oy7yFreRnS0TuNNjFO8cq0ukYQqk5UWvLYXSppLhVyCmykp/OLGn+JNQnnpYIlsyJX0qVfRX+fyiuPFXiSQnOEM5Tqm2paq2tEozlFrKJCie1gkxXzkPGBZTqQOY8b7G6+fnhr/Zt4axBQ1/G4pxB+83k/9M9LNNoaYOlrpPzd4t/D/wCx64hMUOYn5bHWG6nOtgmVkly7rKphItZJcJISojta8aH8M/DOSlKhJpVMty8qkjM4U3UNth1jTSrUuotS1PmGTKlI+1WnbbSO09GXd56lVle5r9kS+b2F/D/xO4UNqcr2AsRy7UufW+yymaaAFtboJJH0iWYZ4zNMzqGJJD65oJzLQhpZU3a17i1x9Y+hDznwrYyVBal2+VIsfoIR0FuUkZt6eTRWFTD3pXMCXbQpXubRLdRXFgUxHqjvee2/0WKGfEYaoBLuzAISfUkK1G3KJ/w1x2MZVBDHxS0MoTchBuVHTQRc3Evwv4T4rl5+ewzSmHnRq+yPIdSdNQtNrGIhwp8BiMKVhbkrXqsqSJORDraFOo9l/eHvDLaZ0eALp91ZBI0lxsopiqtjD0482VAqI9Kwd/7x7B398UmU8p0peWLFANgRpv2iR8YPCLiyXQqapzstVWEC4azeU9+B9JP1iBYTodfpLLrk5RaxLCVJSpbkqvKCOVwCLQ4ZHAWcEhjo3C8brlWNhrh6pdJ+KA8uXXewJ9SQnn9esRjGs24aimbCg0iYVkBBtqna/uIS0fjgmm0OakXnR5yQoJ1013EQKS4hGp1tqUnFlbRzON6/e6wwandgKRFA8O3OUqnwmq4hpbQcU2X3EsuOc0BSt/oI0JRq1KcGJFVNlGCmXKjld3dmSQbqUel+WwijsMcPJhugs4jnXR8Klz/p27+p3XVR7RKOKHE1NXlP+gPnOrAyA7pNrf51iPPVujbcGxS30zZ3hhy3IPqpbRcQMuVLFVSnp3ywyhCJeWC9Zh03O19UpHOLSwbU6liDhc7MVJwshTeeUQACsAXuq/JJ2v7RQHD3CrctRp+dqCfjJuaY8tlSzqhRJuodxqAImtJq81hLC70miadDzreVSSq4Smx0HvzHWIkdQ4d+TqD+vVM1dM152RnII+QA4/dKsb47S+4GQ5mzaLsMvlkixA997xBeMFVfwPwkxNNJVmW3TH3Wrq9IUUEA36awjxBVcjzaHAsrcN83Ip1/O0RjxRV9R8P0/KKcKzN+XLJtqVBSwf0BitLy4lx5VvDCGvjjbwSP1WVuAdFcdpxdccdccSrIGwbI23PXXlGkKdXxT6WxJsIQ0Qm7xSblw669h2iquE9DVKU4jyEfDncD7p7f1iz6HSG0hstk2voDv/5ivLNrbLX1FQJH3d0Ulps78auXMwAtLVwf+W5urraJniTEDdMwIvygFGaUmXCx9wKvdX4C0R2Zw2l+iFCFfCp3feUbBtOugMeVffVUcLTbcubSssG0t352VoT/AJziF3m77eCrqhzZCw9AU4ytYluHnCKqTkwla251SZGWSjcOrOn0G8QPxStCrcReF7BeeROtpmFoI+VYGU666E2MSnGeJXMJcAVz6mGZv4SqsKAeGZCScwCiOxiOO4zmcR4JbrjsnI1Iyr15ibmU/aICicoQfu97RO0l7W04ivyAfrdVM8TzV9uBw4jnqW2H31W1/Bzj5wyrlEmMiGVoS7K2PqKgPWD+saCacujSMIeG7iixNVanTTJUy7KOpUpBVfTY27Wjdcg6l9pK0apcSFDuCLx6Fpr7xAA3Xk3tDTGKqN22J59UpuOogQLDoIEWCoVySTuIMJAg4C1+nXeOoUC468NFY7w6HpRpKqhJeptPN5PNPvzEY/4jUZNOcdDqFIWkkONrBSoHoQdjG8338o12irvELgdOK6IH5aXlTMoVleUpoKWtH8yIpdUY9jHTQi5HI8Vo9CqWiVsE2AeD4L5y8UsMzGNJoNtZpWnIFnJhYsDp90feUBtyiOYomZSVk6dLyanJeVpLSZeVaT8qEJ7fxE6n3Ma2kOB8hjqeqMjWA+HmGQ6wtleW6L2ItsCCIqniZwMkcANuLlpFqYSg3IfJUXLdTHn08VXUfnGwBXr1DNRxfkNuSFnCa4cPPTkwXGVfEzS84Q2MoGYXt2HeH/C3BObUpMsGm2UKZLrdm/vdz1PMx48Q+ONewTOqmqZTaNKrV6HPNly+lY7gnSIlI+MPiTiHGFPo9EkKG7U6o4mWkpeWpmZyYcXoEWvzOp6AQ7SUzg4biplTM8MJaAPUrRGB+H7k+JOTmWQ1OXSwkIT6bnT0jn1tG3+DnB2gcIaKn920xhU8psCZn3UgvvLt6rKPyp7CIl4evC1IcMqXIVmtumpY7flG01Oece82XlXCLrbl0fKhIJsCLk2OsW85LLmDlUSltA0HM9zG3o6Uxi7uV5bq2qCpdsYTt/X+l4ysuguKWSAVm5PXtCn9xSFXZKpsEEaAXsAO8eb8qGpf7FIzHY7j6x4JDhCA+LG9lBOxPaJm7abWVRYuFwbKDY8ww3hyrIm5FakthXqSTe3cGOa5jJ6qyDTLqEhCeYG/eLDqmFZTEsiZZYyKtdKhug9YgEnRF/vOZpbqUiYaJBzDpzHY/wA4Wy98dVMimY9ve5amP92t/FIUpJUom5HUdYlS8EBUs3NSM9Z5IvlU3nQN/StB1t1IhHXcLPSAafpwdfaQRmC03U2sE6X5i/4CGjFWKcQ1V95qc/6MoaK5eaab8vylAkALtuP1MSm45C64ulsWOsPvovRNaZqNXmZZ5oNvS6VB/wCHN0JGpzi/L9IbRSGMYSRLbiJlLRPl5RZ0DXc8+x5xGahJz9cEtN1RZSnKptb0oSlS7g+ly3MG2h3vCleHqrTKXJOU2cS5MOI+0bR6Ska6J7e+xjvHRSDEG8OsfonxHBB2bw8udYqSGkLvaXUDmO+hI2PaK7npVjD8+5KziH73Isk266e0SGT4h1jBReW4HFoUSVpN9Fdf6w0VvFCMbzjMy7LJQ5mypNrXvyhhz2k2AynYmSgkuN2rxodWZosrMy0xLpSw9dSFqAVm7KPOI+uXpzLommkFxtSiFoBtcfyMTzFfDSVpNLbmDMFt5YBLYN0Dtbp3ERWWw20l0uPILYJucuqHRBc8JTHtN3DqkmKl0r/RXkyZdLwfS6lSuX947elvgsK+a562nGvNbNte6Ycl0KTbwzNyosQp0vMlWpt/D3hifrL7NGYlFqHw7Kvky7a8z25QjtBfKLE+74r0wfUWahSplaXPJdSn0Ai+c94V4anZJ2onzmkho6OJ3KDzI7Q2YQbk38SiVQlTcu7dKVq6/wBDD2MDtUWbeJWS5mvlJ2T/ADEKuLXumZAL2yua2qTpI/8ApVsiCVgJ2J527RIMDVpqdoMwqoNIQl05W/MGw6X/AEhlkP3W06qaSlRSkai9xfqBHjOYqExTnpaWDfkTXK18p7dDDcjiRg5XGNudrgllCrFLVMzEuoBTThKVKPLkLdhGfPGg+7K0qmS7LqVhFR+YalQDarGLWYoC5XzUJzFSU5weg6xk3j3xFqVS8R0hQZgkU2UlUvI//sW4oi/0CdIgzbjZpVxQxNMpcw8K/wDwxoy0tt99JW8kDldLe23KNBUiUdr8v5jSQUNi906JTtziveAOB5SrYWlmmpv7RaRlZQ39mm9vmVFwyuFnMMyfkKC5h1IsG0+ltO2pi1hAsAoNVJ3ieqR0XAbFTl1OrqLkuUnVAQNNvxhY7SXGnG2Ct1/yQLKvZIHtHgzMrpq0iZKQFn05RqDp/l4f6bhKYxOxnQ+lpCNSCr1D36QstsVHfIR3nHC7w5gal1eTU/OVP4QoOjYI07m8HJ4ffqE643JVBapdo2SvLbP7QzTkizITobU4yvyjZRWqyYVsV1c3MJbk3GUpGhcByoSPfmO0Jcmi12SDz9E5PedRJlKnz8YAcpbWN/YQpUSUgpklyvm/KnzbDXnbaGlmUecqZ8yZQ+EC4cbJIha2gLUrzZltu2huq5I7Q2W4XC0Cyg/GDwf0Di+j4maaTJVMpsmdlGwy6PcD0uDsYzBiTwG4/wAP1YSlKRIVxth4qZmUTIl1BB5KSvY+xtG7ZNbUrJZbF4g3K3Dy7QnrU9INWyjJNZbpCBnBHe/KIslO1yk0+ozRGwysUcQ0Ys4X4dlpCv0ioU1lpOVKnEZmj7LF0wn4NZalV01aeWEykur0NK3dV1PQD9Y2xUBT8WUZyRqEmy7IvoKHUOJztOX3uk7e4isp3wf4Xp9PeTS/jZCXWsrQWXvNDN+WVW6egiskoCH7xm3irSLV2mMxyDaT1CrvFGJZHzmjIKLCE/aeUTtvqO94YZ3HKqu3MLfe8h1aioHkTEd4rcO8X8NsVTjho9QqlKyEsz0q0VoUnXdI1SeoiDy/FBuaknVFN3GyRlI1vroR16xTVMri4h4sr2lpW7A6M381edGrFOrFMlPimm3wkEJB3SrX/LRTPjQ4jCmzdCoDRbS1M55t5tI2CTlRb6kws4SYsmKmsskXIdKhrte8Zr8RXFhvGvHmrvMKcVLU5YkGc4sUhvRWnTNmiFNVlsR8Va0Gnh1WD0AJVrYUr7bLSG0JJKxYAf5/mkTWj1tGHnPiJxYQlAzBPM7xQmEsVPiWBQsp01tEhaqE7iKZbYcWtTKjckHfeKl9W5xwtAaNvU4V11vHa8bYRm7umWkm8psk2snNqT3iQVGpJqnCefYp6FKmFTDThN9SgKsfwAivpbB80rBNQblrO/FNJZQi9vUFXBP0FoeOG/xUnh5qSdfD7jSVSrrifvkXJI+toHFzTn/YEKtmbHt7h90g2+Sm3EFhic8MuI5abUlCFtIcSo6esOpy277w+8KeF1PxRwZfo7YBlJ6T8sL55iLhfuFWjHHiy8RdcTxcHD5tfw1FpAZefSBZU0+pGe5PNKQoBI942H4O8QuTvDmXaz3KRY69Yt9FlYKlsJ6Nss7rtPNHQmoabFztw/ZQvgJJ1HDGLTJPkhcmVNPA9Qbaf5zj6XcKq0iuYIpMylYWHJZNz0I0IjEz2CTK8SZiaCMpm0harDS/ONkcDKcaFw+pcqrVaG8x+pvG306IxOLBwvP/AGlqxVNbKfewpzm/5flAjnze8CLe6x6Ii4glC0GRYCwjk6jqY6hJJy5SbGIzXULKVA3t7xKphoKGsNNWkAtBsLmGJGXUmF9lTldkP9N1hybbYStDyChdk2Vbff31iuOMuDXKzKkpF0Opum3PSL0xTSPNZWFJ/tFc45m0UelyzbjK3Grlsup1DPQK52PWKCrpWtbYcLZaRqLzIPFYs4ocHUzUtMoeQElIOqhGhf2cvgfp3CzDqcd12kpOKauFfulbvqXT5Qi2dKfuOub33CfeH7A3CGW4oY+QJpOemyZD83po4L+lv/5Ea9o0gp9LfpSAnKiyQkWCRa1h2A2hrTaNocZXfBWXtBrMj2CljPOT/H8prZQzIgrB8xTarZd/V0EK2Kj5s0ltxBStwXCbH1Q10xTaqktDY9LJzKJ2JiQInVIaSpCUOEb6Wt9YtASeCsu8bTa10qalAtAJGQjlCZ2WUqY9KkoSnVRy3KR0jt2qFxmyAkLOgCtI8VJ8popcVkB1KlGwVDu4FMta4ZXm3OIlKpZtQeS6DcJPqQeveK64k1P4bE6ZpSX5WaQrMlSNkKHPukj8xE7qqF+QpSUpeRa4W387R1se8RnHUm5PYcYm0sebNsKCloKb2tfW3MafW5hiQm1h0yrGjDWvDnC98JFOVR5U4Kk6+JWQmGQhxGoCnFAg2TzB5q5RH8RS8/RcPVGSl0fEM1BxSftV3MqQSdCdwQBaPedqDE9JqnZiayTjKw4mWdFklIzXS32IvcQuxBVqXUcMKMi75nxSb5VG4SQD9QRsOwETI37he6d2bCBbr4Yx98qBuYyaeYfQZJ0sTLiVOICrFLqQfUjTVRNiREfrHEF6g1wTsih5ZZuHGV803N9twf1j2nZV10WUFvsSgUWEn0hJNzc/8r7QHsMSOIcMed8SpucUklSdvLWL+i3TvCSSeqsAyNpyMFI6txn/ANWy0y8piWW4s5U2Tbyt73H6mGObqa5NpJcRkQ4LtrQNFjW1oRULD7Uw7dKSy2teVbh+VIub37DeJHNYNYaknEys8t5pCrWcTZB39Semsdv/AOycLI4zZgwm2v1mqOUxsLmFqzp+zub3EM9Pqs7nbaL6nE3tlOlveHF0zEm8JV5hSCgAtqWNCL6WPSF+OkSq5SUn5BKfiFNgTKEj5VfxGGuzGSF3eBZpHKYcYys3T5tCg4tSVAFBBsO0OHDuqS87IzbEyhF1k3WvmOh9uUecy3M1jD4DlktgZ0G3qT1APSE3DzDwTiAicBMq6cjiLkAHkqG4w45SJS0M2kpPT3GqdUgFO3bS7oRuU3/UQ/Y/rCZB2Wdl3VKuMupvcHl7fzjxx/w/Rh2dafYUXGXDdCud+h7x5VzDaazhxE8heRcuMoR1SP5wp7SbJprmGzrrxAc/dzbku5lS793mP85wroVBmpg/FNBtAbASEp2WdL3hqoVeQFyzbzRu08A5bZSTaxh2VX2aRiV5AXklb5080k9P86wS24KAHXs0JqxzihinqaR5qmn0NKSpsG1rjY9oyhP16h8RPEJUHHTmVS0MSISdMxSMxv8AVX5RfvHCvys6s1Aj4dKG1FwrFitIFyT9Ix74DKnTuKPFSrVueWVfvSoOzLQ/4lfo/wDxAiHcbwHFXVHCREZALYX0Z4JTQkaRLNspUllIF0J0JGmkWzPT6ZxlCWHFEJTqVGwvpoOo6kxVtAkKZhjDkupicecnnTq0hI8plGlvVuTFh4BxKmlSDj3waZgpSQFrFwja+Uc4vKcgt7qztU1xdusvGTabnptKnSsgGy7fNy0EKKvMpkZN4Ss4tsZdUhWpFhpfnCNNQE5ndl2EtW9Sr6JbvaPGmU2RmHjM1GZdShRACW27qWe3aOldb4lcYfYlJtgzD4dfWNbOHKlO2p6wvaqrDJyI8goO5bbJCPa/+GF9fZocnTGpeQYmpl92xUtYIDd7ctyesMs5KpYm0pQnI4iwPmnKB26CGg4XTgIfnKdEslxkuSInH3h/CPSPeE7omlqSlxK23woEADVP9oeaHV5ijUvyVPS6kpSXCmTHpQP+StrnpCCdbeffMw7MBKnz9oQLkDoIbD7m1kgXToy8uYlrrcShCRcNpNzfqfeOHQ9NhtwgIQlBunYnuf6Q3KqNNQ4G0F0OJ0Kgbj8OcOdOnS8yS2hIabH3xe5hLj0CQG2yldGmHVsrQzlTm0UVJzXj1QzMoesEhQOoyG4jilNKbdzIMvnXu2RYGO3pqaKlodbCVDUZR+feG3EXSMk4XstkoeBmQkE6HLcERVnF3wlYS4izC5lct8FOOqzLmJOzT5Gu4+VX6xadLLrqVF1aGu6zfNHjWCiZSWXWW3VJF0rbVa3eIVQyN/dcFIp5pYn3YbLMTvhee4WYmQ/SJ01elEgLDjflzMtqbFSdlJ7iMI+LTDjNO8SmMhKhDWWdzlOwKi2kqt9bx9eJ7DTipJLjavPa2yKHrbPYxk/xR/s/qDxhxJM12UmJyg1t83cmmB50nNKAIHnNn1INrXUnptFBqNB3LNHK1miawGzb5XXsLf8AVi7hz/8AUmmRcmw1EXBhqmFsJ0SgWuSeUVwnhvWuDOP5ij1uUXJzTS/SVD7N9JvlcQdlJUNbiLbwuhiaaSguo80i+Qn1e9ooI6cNdYrYTVm5u9pwVMsHVVU641KtpUWUrBKyLFZ1/KPXB821QsfzVLLrZdVMLWlu+qhqdvr+cdUCaYobPmKBUUa2G6zrpCCdxnh7h1WH8S4gnqZTnlIK1PPuBHlo7X1/CF1UZIYGng/RVIlF3kjBH1VY+ODwyVviLxWkMSUVlCVJkUtTKtiVNk5fysPpFt+APHCaaTQamsMVCXAuys2UpOuoHSKTxr+1EpmJsQPyWHKFPVGntpLaJl0eV8SdbkJOoSdN9SIhWAaxjbiFxOXiBiXXJTcwtPlqZSR5SRolKewEQzuiqhLCcoN5qH8PU2AthfVSrOybFTkVKyFxR+Xmoc40Rw9e+KpjDiRZKkiwHKMfeErgfibETLFUxPNzT7i7EF03WofyEbVwdSUUunoaSAAgACPUNMc97Q94tdeM6yGMf2bHXsnfIe0CO8ye0CLdUK5t9PrBWA13EdDXS4gsuXfW8CFyQF30uITzcsCkiFQ12NoJxAy2OscIuug2UVrdH8xBsNIrbHmEfiGl+k7EHTQxcs5LZ0EACIximnts05512wShJMRpYgRlT6WdzXAtVEf6gc4bYTVKSTaW5icmFLVc+p07D2SkfnpDPVOKOK8KU9ieZm/3g4wnK8mbA8t1O+TTUHoRtD9VMPtViuLeX6llJWdfkbHIDkL84rnibWs6XBnyJSLISDYJHT3jPVH5YLr28F6DQxtmLWFoJ5Nwrn4E8Yabxawq9U0S66fMyzymJuScVmXLujXUj5kkag84n0tV0TMtnzpQm9gesfOqS4x1Tg/jg1KnOKMpMkNT8vb0vtg7/wDuTuDG6OFFalMaYSkZ2XcDzE00HEL3zAjQ+/aO6fX9qNh5HKj65oZpXdsPcdx5eSmchKN5lOAFZV97eFr8uJxlIKUOBO6b7/3hJKU5+UacMu6UuDUJTrccwY6bqbsqpZFPS8yfmWg2dSdeX84tA62CFmXXJu03svNx4UNbq2ZYuKINsw9CVe24MMbmMG61Phl1rJNgZiQMotre47/2h+qBlahKpdZecuwfUFpyqA10PXt1iDYqlHatWW5nOZdLaCkOpHqvyJ025wl7nNttUqmYx5O8Z8VHOJ1MZpky4w45aQqFwm2vwzh5jTQGK7xBgR+SlPiJGZcS6E+vKv0PWvZVuStNonmNaY+9TXWZwJfQ4LpUNcx1soabxB6diBmepU5KVGWcD6V2D6SUrZUkEAHqNjCWuBO0q9gBEYIN7cpqY4nNyOFPgJpjJNtuKVMeYk3Xe9lDTT+UMc7W3lZnpd1Kmn9iD82+u3zDpzhyxZT36gtlx4NuJldUOoRZa0km9zz9oQVHDkvLIlphK0pMzdKgnVKlC9lEcr8+hhVnE56KQ3s2i4GSktMqjkkVjzLLCrhCtA8De/sYc5ytzCihLKg8wq2ZCvmRv6e4hGxRGWZJ9UyVmYv9kobc7g6R51umzcjJtKQ2l1pJ1sLlG/5d+toeLbhNlwLk+YhrAqFHHnILrjFsnlEAoPfrpCKRm0ushabKQoeokfkRHUvUET8iczORtoWKsvrPuedjqOsenD2iS9drNTlplbsuAm7WTSx6kc/7wC90y4ta044T1SMOfvSgqeYfaZsSENkXuR35QwUuUb8icKHFNTbKtibgdvaPWUU7h6ZWgLdcQVFK0pF8pHO3ePKfwvOuy01UGiAlwXUgH1ZesIa91yLJktbySkM9Uq1VEoC0eZKp+ZY1A949GKpMyiH5dLRWgoClXFwIccPYoRQsOvSz6CEPJKc5TcC+42+sN9HqOSoBt9JLIRc5eY9+4hBY0DaF3cTc2TJTZA1CpZ20qbWgeoDZA/z9Yd6pIS5w9nWAmYZV6r7W0/KE9cq8ka+6xJ2SyEgnLpfa4/SGLEjM9OUt15l5amJUaptYqTpqYS4tLLjKeia4vG7Cpzx2cTW8M+HnFdU8tSzTaPMBJQLkqUjKk6dyPwjK37NHCNQnpGRm3c8swQkCw9SrW/KLS/aJ8XRw58LuI6aVNqmcZLaoTCVi5u6oFRGn8CSe0Sb9nXgeWkMDU1Lp2SknTUbfjDMLQ6YA+CvGuMdM4t4vZbW4ZUND0kwlbRXYAAAZjfTbrFmrqTMvKolENBLzCPtSPlRe1kg8u8NmDcHBVMZylcskJFkJNiRpuYccLYTmMWVVTLQCGm3MjaNs6tLqUekXbZG+61ZKZ1zuceE0VJh5yUaEtlWhxdktp1UpRty/rC6Toz9Omg1OhSFpTdYaGcoGmmugF4c8W4UZoHmMyC/jZtv5nkKyNsq02PNX6Q2T3EhFJw2xKOIb+JWr7Vd7lahbS9tuvtHTYoa57gCxSWmVFumUwh1bEmrkQnzH1bc4aXHabO+a5MKabmUqASlxJV5iNLqURz6CG2i0+exCVTs2tUrIgXypFlL2Nk9BtrC2WZlKO6iaDBEuDZd/UDa2xtqf0hki2F0MAJIOUldnGDOI8hTgSjQlfpQfoNgOpjhx745xttw/9O2rK2poXJ/5W5wtTPNVV11xTDbEsU2DLabKUOROmp7R6UtqUk6c4hRWt9SbIUlGiE356coRsvgJe8gZGUEyNOkqm0HnCDkHobF3B3vyvCmcngy+Uy7QQjLdDajoD1PWGqWnU014pdaQ6FnV3Ncj3sOfQx7VPFku8xMsM05xp8osHVpI0/i2hJs3JKOzc4iwunDDTMw/PBTz7SlqJ9KNAOwhyqTbiXSEzbKAdxmur6GIphiXmX8vm3S41vfSw6/2h5dlTnCm0E33Lhyp/DmIacdwBCU5ga/lPVIbl5gqQpZSUi4VAeRJEqvMKQoC9yPzhK0/LyQsXEqcI1sMoA/pHgsMPlanFoUVXFkawzICeLJtrc3N1wqqKQsoYmfLKtbkXSqG+dl31Ta3ClBK0+o5fQv3ttHnXhKNS5SHAl29xYHf8I4XR/iKW3MoqTJcWP8AaS5ZQ3094hyG/dOVLY0Ns4Yv5KLYywFQMXteRV6G3OJTdAZnGw62oKvcNufMgnlYiPnr48eDNZ8L2MjWqUqtTWF3lZpd9tsrckFG/wBi8QNAPur2UO4j6cU+ozCZZbDjXnrIIIKb6WNyRbX3EJarTaTjOiTNJqdOacbdbLDjT6PMYfQQfSOoP8B06WMVdXRslbjlW1BqclM/xb63+K+R+GPFbjvE8iJeRp8qzpZMxMozLHfKNITynhorHFvEa6piKfm6rOPqzEvKulPZKdkgcgBGueOXgso/CCtyM1hqSnk06dU4HmVJ8xuVUDdJSq18igdAdRbeJ1wJ4Iomy0pTVxodohw0Bc6wUyr1UNZv6KkeB/gJadfZPwQI03TG1+A3hJpuFEMuLkmitFjqmLL4Z8MWKXLNhLIFgOVotSjUBEu2kBI07RpaHSI4+84XKw2p69LN3AbBJMLYdbkG0IQhKUpFgAIlso15KLQnk5INm9rwvQMo6RfMbYLKyPuUeb2/GBB3HUQIWm0Q9Q00gzdI3gD1DSCI11OsCEEG+8HvuIInTrAB7GBC4cQFi1oqzj9jNrDck40twIZlJdU3NHokDQe/9YtNbiWkkq9KQLknkOcZY4uPPcWJyflM1kVd8JNzYFpKtE+2UfnFfqMxZHZvJV5oVIJqjc/3W8/fpdM2DcSPqwlMV6eSUzlfAW00dBLsD/bQPpqe8UzjDEn7zqzyTc2Nu0XDjNXnzglWEpQ1LgMoTaw0TYfkIo7F1ONGqLvmAgrXcX/WMRqUzgGt6BeraLCwvc+2TwPLp9FGsS4fFasw2yFvOqyg21v0jR3gekKjQ5B6TnFuCisqyodIOVp2xulJtbWKRpLTqag080AXUn06XF+kPdbxviii0aXplEddYk21WLY1Kple6gMu50HaEUdQ2N3aEE26BTtVp31MH4VpAv1PRa8msZl2tolpRxSB5npUfmIF9DEgmsSy6GFrcbfbOUpC0pIuelwLj35xhOi1jijwz4nprNTkp6qU+lsH96SjCC58K0rUrUlINinQnnGqOGXGuicRZCXfdmxMS6k5wWXNFDXTQfQmNDRVpfcPG0+aweq6N2G10ffbbJapPXcQB19tt5E35Sk2KyuwUdfTpofc/WI3VxUTPKYlHW5nzQcjSxZznoeo/wDMTIVuRnGyiSlZfyEGxQU3uNdL8vprEcq0iy0847TnVyboUVZVetvNr+EPytccg39MKFTSBuNtvXPz8FHalPP06QLM9KuIW0SNRcc7g6dP5RXGMMZyNPqR85THw82myXLatrAtZWmxEWBVcRzD9TIm0FLgTlcSnZSddU6flEI4pYIomJ5AOutJYfbdHmZUnKtJvY2t3OxhntS03aePFW8EIuO0HPgo63W2qe/Ly6HPNl5lXpUTdKRrztzES+vcOqU5hoz1NmkrfSjOpsnRY1uLcucVJi6gCmslmQLomJQhbiCSUvIN7LTpvHNFxJO02mvuLeU8lWhQk2PPl1F/8tExlR4i6dlpSQHMda31UhqE49JNMuuD/pnh6FoG2+h05R5zNZeZYQ6462/KgZUqbFso/hIhllKh+8HWZQuL+G83OUW1b115ct4mOJcEN01aTKqZDLqLqbKgCd9RpuekOtffKbkAYQCl/DzF8i5TjTp5lACyci1AWdHQnrCWryDWGay45JOXIBUjXl/CfaIzJ0d5y7Q0ZaN86tAN9v7Q6SVJmqlLHyymZSjYLNiR2MLAdwoz2NBLgV7LLjp85AUX1JzAbZveFdIrk2ijlpEr5i1kq9X3Ot+sJKKzMJmHg45lcUQCFIsByA94dZaddw66vzpcqcbIKgU/MOp0hZCZc3omF91Us4gLQFJe0AA0J9oaXagqn4jY8plSjslAHy3+m0P2IUiqvFco35Uu4cwCt21c+UM1OmDJzjdQzlzy1kErHquNxttDLn4KdjFjkJnxJMJlahMtusCTmjZRFrX27coQSvEsS7VQpz7KEfEM3SSNQcuvLbnD/jXGVLxbX0PNyo8yUZJGcb2GxiqeJuK2ZmeE8PKWsS5SSgWsbAAHTrEESXFh0VjHEHEbxysC/tOMZDE/FTh3htTgW3KzD9TW31OjaL/iqNu+BnCzkjhWmTbqFMsthKvULFe1v8+kfNfinj6Q4q+OioTcutL0ph7y6aCs+kuNkqct2zqI+kfTrwccQ11LDbOZDJZCQlBUn0k6a7Q7Ri8lyrOsBbTWYMLWzeMXfhgWiUtoGx+m/vC3DWPHJaVfaSgpD9gtQNlpFxoDyB5xDKPUFvJZUttQQ2LjKmwO1zaJBhqjpqVRLwSW0E5iDqGxpqesW/ZCyyR29QpS43M1GWQlKFWULJSAQfbbmIbmuGbdSqyH51baWpaynElVkX5AnmewiQ09bSgPi3XA0gWbSg2W7tufupPXcxGsR4jaqdTS1KFS0ypBUWx6b6ABI6jqfcwyx45aUML77RhPtenzSKUkLlnFpf8ARLLmBkb5ahA1Ou3WEFKxYrEs2uWmEtrl5G0uyvLZpSk/OoC3LkecIn3GZtJn6k1Mzjyh5MjL3KvNdtYEm3yJ30j2wzTWKFSUyjyVpfZSLrSLB0kg2vbT1X/WIbJHGYgnCldkwQ5He8f49OE8Tkm2/S7Utp34lhQcU6oAIaGl76c/yjlaaczR3KnUJ6amFlWRLcuMiQu3ypPbryhK4ZmeaYlHakw1IuXWJeXTlcXzUTpsOZMeGI5urS01IfCMSknINkD7Vkqsi2h2tbtv1iY6SwJaMqIyIuIaXWz9i9v0TmaNJ4ZoX7wXLIQtxV0mZN0y6Tre1vUvnzhnnsUrr7ueQUtSEH0zD4zFZ/4i2ggOUWdqT61vqM4t42u4kvN3HS9kjrpfpDr/AKKW7SwWUoTm0IStJ90gAadT0iOQ55zgKWwxxC7jcld0yoyclLh1alPukesJSAAroLjbrHM4+5NIC31LYQT6QE3V9ARoIUow6zTqehEu9mmlpuFKTYtjsLadjuYRzlPDUuorUuamCmwQnXTqSdvpHXnFk0zaXbk1YmraKY0jy7qU4dCdVA9bR3QZtyRk3Jg5FvunRKtUDf8AE84UMYLnqhKX8ttppW60t53D2CjoB7RJMM8LWH5ZpxMvMr8tWhmHfSSO3SIBDy66lunhZHYn1UPq0rVcWzpW2y7NIlwcwIyNc9Akbw54Y4eP1CX8qeYmGVLJKFto9IGu+n5xZjUixITxbcLGYjVLabZN949JmvsUp3K4UNZhcA/Md9bc4YMbQ7c9yjPrXubsib6KOHB8pQJEMIqC1rt95F18+fKEE5QltNo8phlKlAqCl6F0a6A8r99ecPs04usTaHEFAaJuo29ZGuo0huxPUVEK8qVLgbOmbQnfbvCJZRtJ6dEiFry4A5PVIX6KJ6TDLkuWUahVxmPOw2sR7w3UWjyWGawsmXQhpPqWtlPpt/Fb9bQslpt6YUpTJeYTa6krGid9Nvz7Ql/1b8YXSG23FS+ZCm1pt75VaEQiFzWu3tNinJmPc0sIuFcGFZZl6SadYWh1pwXStBuFCJRJMZE7RRvCjFzOEq8uzsymQndXJdfqS0eTiNPxH1i9pJ1L7CHG1JcQsXBSbgiNNRzdqy/BWO1GnML7cjolDKABfn+kGbqjpI02EEk3N+kTFWIshgR6ZzAgQgD6dI5AChvrBn3tA8sD7xgQiJUNjACrHWBok7mBmBECE3Yqm0yGHKg+oZg1LuKsOfpI/nGSqvXPhsQNZTlQJe6bdfwjU3FOY8jh5WFm4tLKH4kCMR4txCZB1oTCsrLTxZWrm2FbGM9rc2wtC3XshTdq1587fRJ5jiMJ6YfZfXkmW3SoKv8AOBsqGzHNEexfIlxIuSLoUne9togvG6nil4oeKQ6zKKSl1lSD6gLXCu8Sbw8Y1NZlpmlPuh4utKclirdKwM1h7xki7tXGJ69PNIIYhVwrnh3J+S9/1BJWn0m4005RYYwzJeRKzFSD0tTJpZR8ZLWdUwUgn7RI2tvbcxGau5KS+WabQlKJsBSkjSyu35w34wx+pdGRSaYt1unpd891StFvuciojknlEWCqZAS1+bceZSKmnkqXB0eL8+Q/m6s2iV6l8TJeqLeqFVkKvUAacZ2TJbYqQCSEtOJ0CVEAE9biKMxHSpvwy8UHnqMymVw+95fxlNU8XV0t1V059tErI1F9Lw4T/ECbpmFWJJCsuVxayALZir7yrD5hyMVP4huLlWqXD0UIzbglHXfNcT99462zKtcgE7RaP1OKSOzh3hm48UxR6PKyYtYbscbWPh4/wOnQgYW15fjo2KNJS/kNttqSCotciefe35wdQ4gmqnzHH205E2zNCwUNd+8Zi8F/FiX4pYFXSJ94msUX7Jeb5nG/uL79PpGqeG+DKHh6nfEPEVKovJIcDibNNJN/SE7E9zE6mqZ5yCCNtlnNQoYaJ5a5p3A/P+kzy9VarE00pJcdyKzEpGtudtIeEuU0VF2VC23kOJIsRuk3uk6biJFVsLUuakEuyDDMo6NUloZRfXcd/wAohU5KoXMKecaCS2qzhA9SCDv3H9YkyBzObG6gRysmyLi3RRlHD41TEa33yPhkNLYbUBbOLntuB+kVTjiiVPBtcLbyUKF7JcHyTCLka6aK6xoCfYW7IOtSik5HfWgjdtWt+WxiIYmw01XZcPTYJcllZ3ARcKTeygdNND+hhxrg0WUiKY7yTxwqopLANbaemM6HGVBLdlFJb30PXTnEtr6qiwz5iUB2TbF03+dKex5gRGeI+BJrCldLcm8t6Wds5KleuZBucl7cthHoxjabcoqZWbS4MoAB5gi9iRziXGQRlKlBdZzVKKDOk5phwrcYcTcpA+XuBaF0s87TZpzyCQ0seYUWspH/ACH9O8Ryl4hW68FLHlAWJDeiTfTN2PbaHOsTS6cEuEOXSMqL7i3TsYf7SwUUtO5PkvU3padYqCEJc8sggDVKh+Gv8oltWxBTcTsImkJAfUnKpIGoPQxX1NxOt2SbDrKUMq+UITZJPfTeHPEVPlZGkys7LPet02WRsodduUAeeiiyxjcN3Kc6nhuRksMPutzILytfLA0HaGfAuCGcZ1VyXn3TLspbDhKAPX09jEUrczUqglXwrpcYGrhPzW52NtYYJ7ixPYPbdEl61kBIPIDmNogTVLxkNUiKl3d0Oz+icuKlKZwjWKjT2X2nGPh1qbct61G3M2jKnHrirT+EWBahWavMfDyFLaXNPKtcmyRZAHMqVYAd4tmer1RxxiwvOOKNmyVX5ae3OPn/APtcuKPwOAG6AlWtUqLLCh1S3dxQ22uB+MMMLi3c4ZVxFEGkNuqM8EuFk8ROIU1VaigoVUZtc26OhWsrIP4/lH2s8JfDvD0lgmVms4ccQpLaZYCwA0sT2j5A+BxhuRQ04PSo2I7bR9GPDvjGpSzrYJW3L2ASgfeGn5RNoieRyn9SjLow0G1ltXEGJJSlvqMu0lwJSnS3tb+cKcMYp/edJmgG0sEIJyD5uX6xXWGnJiq1CUTMBxluZbLhK0m9ha525xNqbNNtKLUo0luW0Sq4upw6bm20WwcTg8rMOia0cfFOBXPVdoJStLbRAAJNlrGlgOl4WSMgmhlcusJbyDMsnQkWF1bdNADDDJqU5Wy4pTjnw5AYQPlzaeq1okkmy5PzrTi20vTTuraV/LfT1q7aXiKYy3utSnv6nhPVDqyaglt9bLcuyyjKykpAU2jmrbdUJcSUpdeK5JSESSypD5S2qxcQPlSRa4G9yfwhTISiXmMiJ5axJ3VMPsIypCtCQk21V9RpCN+sM0+VdUuVfZaKr+TfzJiaUbWzkA79Lw06zRYpmNxL7s6JJOzSqHOJXN5W1pypllloKU4bAZym18o5bXMdz+K0UNj4U1OquBAzrlZZXm5CfvKJ0HtyjmlyU1UZ16pzjIfnnNGhlu1LaCwGmpTc7aDW8QzA1SpmKp6qySJt6ZnW1OJSqVRnbacB1U4u1jfpyhu7hYHF/FT2RtcC4522vb76KxaYpisrbdLzqJZlAKUzMyU+Xf75Ttc9IVnHUh5ZYlTKvraJS8q2RlI5AnpzJUd9gYY6NhqWdmJdhYzzKE5lNj0gjm4s2BSk9BrEqkuGdNZPxU2GlpSLJaSjI0nsEcz3VvHHOcBhMPMQPfv5Jko1SnMTzzzzC0KYbVf4hScqcw/gJHTmYllDpTk2tJmHVvtqOiyknX8Neg6w4092SkkIZTKaOf7aUIzOK6WGwH5Q8fCOrcQ4izKWwSGVICgo9VWG/aI4mA4Nz1UeaW5tt2jovOdk/hpVVmmy2hOqlrsLW/AiE1Bm5iqSakqMu20CfW0s5covpe2vsIUO0tMwoqeSl5x1RCS6CpIPQJ2AEdPyyadLNtPJXnJ9IaaNldwANIZklc5+44CYaGhm3krxl5hqlzCkuJDnxC7IUlFgka6Xtt3jiofCOVJxfw5XMj0FRRt2BOwhRMzXw6kpdYeUhenpbzXPtaPObpb1UfQ2lCpCW++67Yur30SPug9TEd5cRtbn4ffzTjXNB3Oxfz+/kvSVl1ty6gluWQVakk3tv0jwcpak5i9leBBByIsR21j3VJSsg+vK/NzhQLJSpeYJ326x41OSLKg6p99t8jRIPoR2taHNxtkceaQMu558k0VaiuuSZ8tLnpNrKAF0/wAOgiE1+XdogMw0wHHM3rb/ANtaxrYpVb5h0MT1NT82aW2gqbcR/uG+h+lucNNaryZaYU082lxBSokEXOl78tYiyuZ797KfC57TsIuoxT5h8sLbZbU2259o0h9GRbatdUkaRYHDLjP+5UiXqDb6G0/7jZTctn+JNtwe0VdVKw/OyREjMJVLldxLOpspGpGiuVtLQz0riwarKzOYKbMmu6VW9RTmyq5bg7jYw7Saj2bgLorNME8ZuP5C2ZSKtL1ynszUo6l9h9OZC07KEKU+k684z14cuNa2cRooswLS068W0jYy71r37pV+UaGQDfWNbTVDZmbgsHW0jqeUsd8Eebun8IEd5BAiQoV1wRfXQQQuDc2MBW2sGEAi+sC6i0Kr2IgyAfeBqIPMR0gQmzFDCZrD0+04gOJXLuApOub0k/yj548bkLYlp19CFuNzTRCmkpuSrlbTe8fROuU81alzcrmW2ZllbOZJsU5kkXEfO/jNT5ilSzMjMuOJdTMFtK0fOFA2B212jNe0F7NJHivQvYS3avF+ox81G8USM3iXhrR5h5IdnpBlDE4Em5SCNFHTlEN4VTj2B8XhTqShymTKXrfxNFWo/WJjgZ2oYbeeZrUm9KtO3Q8XAAl5B+8BuSN4XYi4XrXXVzDZzgypbzjULBFwQe41jIlu9wkZyF6kypEbXU8num9v4Uv4r4OVS6MtxghUo+758stOxbcGYfnFVuzDkoUlWpB5xZmB647jfg1MUJ5SlVjDajkQr5nWL6Wita0wsZwQrMATYiKvU49sokbwQjSpCWuhk5af+H4pPOTrU00pBC1KG5Ox9orjHGHhiyrMy8s24886fLQ2lNysnkBEuU4Lg3zX6dO8PGHcOBydfmG2WHFrZLeV1vODm0Nh/FDdK8SODSVZO/KBeFDMGcFZ/gnjWn4lpvnuztISmYrLCFpU03LuEANhSbhSrG5IJGoA1BjY0ri5nFFPZmJNYbZdQFJ0ykpO0Zj4n4im5RKJRTrjsrKpCEq+U7KFiALEC5ATsAIjXDTxDvYTxW3SpyZcVJur/wCnUtdw2rX0m/L9I08VRDBdjeCs5qNDUVjRM6xc39PvjyW3TOtykk02h10uWutRNr3vpDdieUn0U5yoSjS5htSftUoF1G1/Va0QOm8R1VNLStClSbXHPuYsahzU1RaGHWny+yv1qQRqi/MRIZO2VxA4Hh0WUlgfAATyfHqo3h6Xqa2Wp2RS4Wnk5i04PSsa3t9eULm6ymrzLgdl8jiCUui2oGu45jvDhUK0/TpQOIl1pCrrQBoFp5kCPOWrbNTSmaaaSXkC+o1UnmDD8cgttBTcjSSXFvyUQx/gyaNNblG0Z2m1eZKKO4G+S9uXKIVNTqEzQZqcm2hwggKAFl7j8T/KLumnvjac7LuAZE2cl12+W4NhtFRYil2kuOzDkrml3VFMwhxJORWozp00idBJbATTCXYcE1M0jOS0gm3mZklP3geUSGdpTS6ehaHVNutgDy16ocHSx2MRHD9Zfp86pCWQHAT5VjmQsa7Xh4/1Dml/PfUQ8V5Qnofw/OHzKLXSnxv3WCdE4anafh5wZUKlivPlI+0ZH4bQgnHlSkmy9Z1Upms5m+VB/pDxLYyl0sOsgOrcdaKVoc1A9j/KGuXx3Tk4anGHEgJblVpyLGt7cuusNds297pHZyW46qBY84rppUytqnqZAtZYSbgdxDNVK807wpn5tbTapxlASkW9SiVAg7RXU7P/ABjDq16LZ9YIGu8PWBK1Zx34xAVLJQQpJ1Hb3iOXFx3Ke2EM7oCY8PYzcozc1NThU2S0pKTsSTp+EfLr9qFXZuseIqRpClBVPp8ombYV/wDeU6SFKPsE2j6T8YF/GU5apWzaXHUtIBNgn3Ptzj5NeJyuL4n+JLEFQbfS/JSj6ZCWUlV0Ftn0kpPQrzawprs3Ug9AByVefhEwXUKhh1ueZSoS8sQSQPn20j6Y+C+VlZ+ry05PoJabSC0HE2BULb6axhLwkcSKXhvhzKUgpKphxOUrCdBci8bY4U40YRRZWUlUhpCAASnQqItpeJVK4W7q5Wbi2xWrq5WJWdnW0lIu2my8uhQDbQaf5cw1yFRmpQuuIUfJSLBR0JTpp7xHuHDaJygvVJx5bynl+U2VanMbXO0SbEb7Jo9O8hgOLabyBA0KzcGx+vPtEy9uuVTgEHaOE5UHFiafIFarIWoWzEaoGn6x5yXEltms/CuPNtoW2S2pxVgOqb25/wA4gc/PTTryWHgppXzoS0m4O3I7wlpdJmKlUUK8rKsEEhYzFI0so6QyGyFxupzYI9tz1V04ZqzUwllqYcWZRseYllN0pcVvdVhy5dYcZLEJXXyv4dKpYI+xLjebyzzWUgbW7xH5Lh7OzcvJrTMiTCQCM6sqVHTTUakbxY9JwxL01tDMxMKk2pJoOuuKIDkws69NRzt7Qq23lVUrmbrjN0xYqTWcU4fTTaQ0v4ypJ8lc3MApWhBAulpCflBH3jYDuYccJ4ARwqwwzRabIyykMJBmJhDeRhCudr+pbg6m8SFT7CpJDSVmUlHNSlF/PmSbG6jvY9P0hzl5laJVLLEujz0JuS4myWByvzJ6wh8rSS7k/fCZ3PDQy1m3vb9yfLwTdRMKMUxkVApUXybrUsepy+19New5R1+6mZmoBYdcW6FXDKRnsP4SLad46nK4ioTSZeYeTmkvUWm0GyT1A5n3juUm8n/7fLqbU6R5jj4CSR/EQN+0U8tQ15xwpTGPaLuOfpb1Uhpzwl3EiXYLji/TZXpt1vzse5tC4+cSsLQ4lZ2CiAj2BEdUemzDcn5jYl0tH53XzbzDCKt1AS044svtTEuMqUhggnU2NxyiR3g0Ocq0lr3lrUqalFTLyXC4ylbYshIT6Ud+8OLZWiyVzTipgbhDegOvLl7mGB6s0+kFbr02onMShtHpCB36w21biwxIMf8AT5UpB9fPMP5wkzxRi7zn1ukmmmlNmD6KWVOry8lJuPrWG229FKUMoSfbuYSSLqp5C1TKEpJUfLSdSU9T3ij+MXiWaYkyyFt5XFJTY2I0OnLYQ1UjxVSklIFb0yFvAZisnU7xXnXKc1BYXYAVvH7NVZpxI1uSVfc++USr70qh37O4sUeXmOt7aQxVyvsvy7JUt9pxQBCFG2mtx+sU3O+NiQmGlNzL6EgX1zAaa/51iDV7xtUOYq5YVMBTTKrpcCSQo66jTbtDNRrNI3LXcqdSey+oOOYzcLQjk8wt9a21KC9ioHWPB0IQfinXfNebVZKSNmzoeW8UDNeMrDUrLOKbn2kuKvbMlVk767R64I8UdKxHNKZRUpeZW76UJSTcq1sNREc6pTPIAIUh+gVzGlzmEAeSu+qyktLTcvMBSC284E2tqDfbbXeKepNHThzjLWZdN10x95QcQoaNZgQbaa/2iYzeKJdqhk1FwSzAsS4tWXLbXS/MAHTnaMH8QeMGLeLPE2pTtNrE81QX6ktTCGnCjIASEg2F9R+F4fmlZtDrcEHCNN0+WVzmbrC1rn6fFbJwbjCRc4gmWl6jJ/HyTzYdQh5KlsqSSEk257aRuDAGJ0YxwrKT6FpUpacjoBvlWnRQj5XYr4XVCjUam42p0qUSs40lqqKZFixMp0S6ogXssaX5ERtD9m/xOVirAtUprvmLdlVpmAs6ix9JHvpF1pNYWVHYPFtwuPNUHtLpLXUgrInX2mx8uhWnLp6mBCfzD3/CBGquvPtq9lG3O8DNbW4gDf8AtAUoX0BjqSiSoHeDsQYCST0gzqdIELl0em99Yyzx14RMTXH2Ubca/wCjdV+80kjRIAJWLdiBGpnbBF4pTxHYgkcP8UMLfELIVVGHZBXp0Tc3Qb+4Iip1ljHU939CFoPZuokjqiIuSD+l1U9U8NEhiSedqzxfKnbrSlSib+3QRXeMqrM4MnykoaEmwkMMsEWC7ahI01PQRpOZraXZYISALDKQnoOX0ioeLsmzIzaJ5VNaqSZR5MwptZKbAblJ5KA1BjE1dE2BofAbeJXomlalLPLsqRuHQKrq1iNiWfksRUiVmJOaAPmNOIyLUPvIULR4zlQlcbP3ZQznebLjCkf9xHNJ0+dJ07iLS4gcGnMWMMTUgHmkzrSXsr4s48lQuM2m52BiqsY4HVghlbraFyz8qfMUUDVKhfKsab8iOcRp2yEESDH6q9o6ineAYj3vqPI/FQSvYXfpU4oBBCb9NonfDugNSVHdqFUmvgmSkNMWb8xUwrfIkcjbmY9KPV5XiZhlM+lCWpplXlzLaRpfktPVKvyhPXas9TpQtS5KEDXKdRe1r25HleKiNrYJNzuOit5pnzs7Lh3VQLiXVGa/UZoIQEIBKUjnYX3jPnFujAsrLOZLjeoKdCk621i8cQSKmlKcJN1HcnUmK44g0tIYUsovcG46xIbMHi5VjTNEZACtz9njiBziNgB9dcn3JiYp00qV8lIspKQLhSjubg/lGnJ6qtUF5LSUuLlQm4AF8m+8Yb8BuMJfCnFqr05bgb/eUuFtoJsFuIN/xykxtehYrlHEZXVtZlnUr+9vr/aLikc0xANwfFYzX4nMrHEi45A9U6Vqts1KkS00yoZZe97fwn+kR6WryadVXlS48xggOqA+5e9/z39+0Pc7S5NtlxySSHfNuVMhVknfUf0iIsYWfpNWbShYAdQspudCCTp9NImHfeyoo9m0/oVMcT40lpDCPnSCm1PKQMmbUWN7iIVIVNOK8QLlHyn4ebYC1C2lyNeUNlVobmKFyjNNc+Hl0rLkwlV72BO3cnSFs5SEUb4FxlWRwOrZHWw11hTJ5N4PQW+KOwja0tv3jf4Jnx3gZrCKG0tvqU0VadU9vpETqtR8x6WmAorQ6QhWmhI5nTmIleLJV3FNMmXluKSJY3a72PqiBsPLkWXpNxppbja7oUo2SL6gxLknDhjASoGOAyblTPEVGZkpKUngtWVJCSBySYr3iRMOLl/h0KaaU+okrN/MycrjbWHOrYvmZKnMSry0PJbcGexulKeQ94geOMRuTldMwlIKM+VaVbZeUNGRpdtCdiieAC5HwjwZL4jrNVE85laabAba5qJ5/SPSi8PZurzlRWz6JGm+m/8AEeQHcwhwlMrpCnppguuO3PloA9JF91GFcpxuGGcMrp6205piZL7zv8SNz+cOvvYAJYvuJCoL9qrjak8C/D/UJFifRJVBuiOuqcUr1vTL3obbSNyo3+m8fKXCgXUKHKzrRzNPoF7fdI0I/GL9/bC+Ig8eOPaqE00W5XDhzvKP/efWgWH/ALUJNh1zRQnh3qiZarO0CZSFS82FOy190OAapHuPzESWNAjzyoQkeajbfHHxWmPDbMGXnpBD2iTZVyPaPolwIpVPVSpOZmHUltZCVpB2Gg/zrHzs4QSbkvJrm02UzKLyACNX8DsQTk5M01CHF/CurSoi+hGn/iCnftKs5QXtsStySlcZlaYEU9xkyiQEhIGpOnLvHMtjKYam1rW2FtOAXBP2qRprtt/SIbw/qqanWnl5bMJFttFWtFjSNMkpukvOqY8yfnTbMN0C4yoH4j3vEvtGk3PKrXRlmLXCcsI4MnOINS+IS0tQCAlNhsnTtsYsHCfB9qktpfm1iyDfIdANvm019o98Oz//AKZ0OVkmB58+4gEoTpa9rlR5CFs9RDiGTE3V3ZrOTm8htZbbI0sDbU3hT6kjux8qCXvcbk2aePErmoY0k5uvopUq0ifqTiPTlALUukW1zW3/ACh4ouSpvuSynVTSmwDMTStQLfdSet/whDTMO0ltoqebTKMpAGRByqI00J3t2hQcSCQp/mUuQU5LtKyAIFte39YrJHkHdKbqQ1rSNsQI9fH1/ZS2hsonXm32W8qkApQVp/2+tv6949pRt+TmH0+Z5jpUSTyUepPaElBq04ptpyYabkkrABF/Ub7CHSdnZaky77802lbaBZLf/wBxXQ9hC3yt27r2soLg4P22vf4psTJt06WdmzkaaUq78woWCz0HXtyhvnOKVDpbLzhmWpltJzJQpXlhHUnreKp45+IIpkH5NK0ZV+kITskDkOwiD0Hh/O4rwWa3OzrcnKLUQC68lBKRu4c33APrGRdqc005goWXsMkrVQaKzsRPWv23NgArE4qeNxh7NLSik+WyLJSjRCbRT89415ykuuOGaQhF9QVWEUdxFxCZ3EE5KUJpwyjbhbE45r5wHNPboY8MEYAZ8wzE4lUy5e5U56sp9orJotRmmvLJnyW0otJ0unp7bL38eVc6PGVUcZT4Zp8lPTy1bqaasge6lWFucI8V+ITFyZPyZajzBB/7jjqAlINxe4OxMJcIUmnzLwlJppBYWblIJSLa725dRFq0TCLFFanmpOSbVTpOQVUpqdfpLc78E4q6cgRcKUwTpcaptFpTaQZBd8hJUOeso6ci0I+v38LKk3KdXMXzkp+/JlVMQ85cKQguFJF7i+wtp+MSiS4SytHqaFzCnZuXduBncJyHW5IA5d4ujD3h5TiWhMz1qK/KiXUpU5L1EyDSrpUsgpcBOVJIurmLdIhKmKdSJqbl1zUrPuSy8jb0sorY0zaZlAFdthYBJ3iYdIggG8t56lMjWu3eY4DbbyB93HxUexPwvp8u6lttlCSdSALgXuRrbmOUR+q8MJNKVhbSUgDprz/LtFglcupKnlPhuW1CGV+pby9SEgDQJvuo+0MU9OlxxSnVXUSSTzJ1iuqhGOAMqbS1E3G44Vc1LhOzMIy5LhRNtN94k+GfD2/QsJTc5Kpbam3GiWlrIQls75ifugC6r8ok2FGU1CpBrJmSFZvbWC8ZPEJ/AHAqZpMgjPUcRsOtqy/MzKpH2ihp975foYbpYIiDI4YCarq+oc9lOw5cVj3jB4kZqrV+bptMq8/WZNtBlnalMOqJfNzm8lJ+Ru+l9yBCzw/YoTJVhCZj/YmFhp0HY30Ch7G0VTTG6K9RLpU7JPpWQtVvMSBY6gW2vpb6xdfhm4OOY9+FmFTfwbDruWWSWiVOkXsr/in9Y4Ksk2aFY1FLFFEdxx1K3JwOqEtjjhvPUGeSVSzpLb7Q081BBSb+xsr6RZn7M/Ca8OyOK0lSXEysx8Ln5rIUbH6i0U/wmpz/AA6qLQfQ244/6XEJVfJbr0I3jTnhCwx+5KzjB9tHlS83MtrCeSiU5sw6CNppP5r4nOGW3H0XkXtC8RQTsYe6/afiCLq7LHr+UCPSw6iBGtsvOLheilHlAFh2gEa66wMmYXELTaMK2sNYBNjrHPyjvAN1QIQfIyabxl79ojT6l+66HPyqBkkitxtY3DqVZgPqBGoVi1rxD+OGBZXiFw4qMlMFKVNoL7Dh+44kafQ7H3iq1qldPRvjYc2uPhlXXs9Wtpa+OZ4uL2Pxx+6y87xZcwVSGKvNsrmKfOS7c0tsaLSFAE5b8wb6c4kU9WKXxFwdLVakvtT9Nn2yEOp5/wASFDkocwYh3HPDqXOH0tT1H7WVk0MqHK4G39IpHgXXqtwSx95Mw68cNVpQbnWFfK2o/K+kclJOhtuI83GsGOqFLMLsdbPgf4XqzdIE1KauA2kaTj/2A/fwWpcD0mrY0wU7MvVlxDtLdMlJNBICPLQPvHe5v+URXFEgnFUyumVmW+GqKkltt0j0TAIOh79+cTzDFPXQ6bMIaUFMvr89JB0Vcb/WHbEODpbEtIS46EeahIcZc6f4Y00mlF0QMZ7wGQTcH76LJR60I5zvHdJwQLFv9eKzpIYKcwcgSqm8vw92x6bZ2yTofaGPHtMTTCFXC0rFwRzEXjOzMvipbtOmWECpMpOmxfA3UO45iKt4h4YckiELIVLg6FRAKPx5RntRpgYtzOn0Wu0vUXOmAkwT9fRVTNybVTYKFpGh0VzBiJ4ywDMKl1KLZdYsdUi9t9xEhxay5QZlQBUEg/jDWniA+y35YesByMUEEoB2uWy79g6PIVHqoj2BOIFPqrLaiqWmEkJPpzXNrXO177xsLDsut2UQ9NIMu8RdTal5ig66XG/vFEcT3UYrpp85tClFJAIFr7xdHCKQXiXhVRporXmdlkBwk3JUBlOve0XFMLkgZ6qq1mXcxkjsHhTvBbMzVJ1Ql3SptB63BOukOtdps6yh9KG3Pipf7VtvmTfUDsReEVEr0pgyUbSwQ0UDdR1O/wCMODnFCXmZtmeW6FOS+iRyWNfTFnCYmt2udlZGZ0pfua3CbZVosYxmPKtlSylSgk6Am9x/P6QixBiMuzE6txhHxMk8hxCEjRQOlwPaPGqYuSziBudkGkremCtD7adljVVx7QnmX0ibmqgSLOHKT9D/AOIX2wtZp6/Rd7K7rvHQfNFOVyWl6UtkhFlocKuwN4rfE1RbqMk3PoQhhkS+RRTzKbgH3MO9XllLxAXXyfhZiWXZI2T1EVnjWruMTEnTmVgslwvOW2UBt9DHBUOkdtPClR0rWd5pyklMmihbyJl1SCskpJOw6e8JWkrrlTbYmG1NsNq1FrZo9abJofqb+crdeQq+o9KBvp3h/lKnLhLajLOJdlEEgEXDi9gLxPp4SHXsuTPBb5rypFOU2t5oJQCsKVkVpa2xtFJeJPHNF4OYQcr9fcfYpzaC7MeWnM44AbZEjmpa7JAi55NC6RV3ZybWtSmmSt+//LkI+f8A+1n47t48xLTsHU/KUSJROT6UG6Wjb7Fn3Fyo/SJ+0ONlWySOjFwViPjlxEnONXF/EGK5mUTIKrc0XkSqDmEs0lIQ23fmQlIueZvENU5M0+YbfYcW08yoKQtJspChsQYn72GCsaphpqeFVFJGU37CJLXtVQ5j73BV/wDhpxzN1zhwxNPEF6ZdUh+wsCtKgL276fjG0+BCZijSctJOtkkBLrasvypVb9THzi8OnEN/h/WGaDNoS5SqpOJUlZ3lnVWF/wD2q0B6aGPonw34gFb9MedtnYlxLO2HIWsf5RFfZr8K+pZC+IX5C2FQcOTGB8Gy81OJCXpzLkbGvljSwPUxPeHE8ifqUipKwAyrzUJV/ELaH2OsVdOcaJbGtGpUmkZmQpAdXsE7D/PaJ/hiX/d1SKWhdRAKQD94Wt9DEWWra33UtsDiCH9VaOJ8VoorAm2h50ylQXe1y4dP8Ah8wtX3sXNKmZtSmi0LpaOzZ01P1iMYFmmZhlL76W1raUFEK1yq0/vaHCfnUyk2tyXukzq7nTRG0NRTW/MJ56JiSIH8oDI6/sphhCUDtIfdnQ25NTCihorsQyi+qv6Q+s1eUekkhjIENjJcDTS34/3isDOrnF5G3HUNNj1pCrZwLaRJKJPobYbcWAlsIBAA0tpa8Dao32gYTE1N/sTnwUtXMOvSTc5NpAaYOdpsfePJR7RUXGfjjMVKdFIpqkuVCYBFyqyGk81LPJIhv4y+Ir/TtLVT2HQuZWotoTe9r/03ipaJKqxBWFvFxwNvWLzij63z36J6CK2oc6seIYydv+x8fIK60yhELfxE4z/qPv7KmOBZKTplZTMKaaxHUL3dfmU/9Oz2QnnbkYleOcMUdrBs289TmJienwqXabfWQ0FK1Uq2yQBsITYQw8yhUu219mAsAKA+Uwp4oU5xvGOHpHLLutlLyXJd4/Zk779dv0i9jp46eDbG0Afym5JjLUC7j4/JUPVsHlLrLqmPhWnvs0OWzJJAsDe1rHkISSzC6RMqbygcjY3CvYxrLhWxRZugPsVKUkmpNlKnJs5B5MuFaL0XqHQbEgbA6Qkk+DeHKtxYdlpinUhMq/T3kuyqFKSJR4IK2ygH5luN+pIT0IiG7TXOs5jhkqa3X2MLmStPdF/X7++VnGQQG55p2U/6iZY+28kJuBbr/OJthLi23h1ozFRkpxqZzqcaek5ksTDJUCCcpFinoCN4YsVYbY4YBifkn3LTS3HJdxbwS+E3OQKbHy6czvpEBqlbcmnXHXHFuOLUVFSzcqJvvFRNVPpja+VooaFtW25F2/VWvxJ8Sc1xCCJDLkpcsmzLbllOqNspcWoDVRFrgaabRDRWVFB8twkA7j9Igr055SiVKI5m247Qpkq6VsZG7g31J3EUtTqkkhJeblXFPpEcLAyIWCnzeJCqWCFC9vyj1aqQnXQV6qI07xHaO05Ny+cnIBzJsDv+UDGmLJfADDTRyTVWfF2pQG5QNfWu3yp7bmK900h7x4Q6JjXbG8qeSOMJXCAQ0koVPzRGRJ2bB0Cj2iuOMqaxxp4/okZJ9aJaWaRIoUkXCWkp9RtbXMokjrDZhWTnpjE7qKh/9WqVQcDgaQf9lWtgojYAWOUaWh34q4jf4RVxNAaLTddrjImJ2aZV65CXWTlbFtlObnmE26xZadHPVXjOG3F/T+SqKvnhpJA9neeQbfz6BSoeFnh0/T/3XNysrNvtEl12TQP+kXrdSlj5rHUpHK8R7h5TJugYmmKWinNyb0u4GGlJHp9KjksO4GluvaJDgjEjGF6Y2s5ENMIsEfxqINkxIMNTMvUeI0gFJBXT2GnFED/cUE+kfXT8Iv8AUaGJmxsWDdZyl1Cch5mJcCPr5J1xZNqwPiuuTSngl2orZeSFK0SpTepHtr7xpvwDVR6t0CrzSnnHm1IZTmUb5lAHX8Iwr4iOJ0hX+IDVOZyvy9DSTPTCF3S/MHZkEbhsaHvG3f2bks6eCkxU3VpC6nOn7MC3lhAAidoJJriG8C5VL7Tw7NJa947x2/fyF1pTzD3/AAgR4eef4hAjdbivLUttlGl4Fs25/CADyFoGXLuIdTSFsogDQ73giRlPKBchFoELlxWlhDdVmkz1OmGXSA042pKidgLb/SFyh1tCCvJC6LOAfel3B/8AiYal90gp2K4cCFQKcHUupzDs5WG01DOSllhRIayg2C1fxE9OURLiLwzwnUKeWmKc5JK/il3SrL/8Vb+0OuL68qnS6Uo2Sgc9ALRXdX4hmXK0uLCkp3N/81jLjTqV0W1zAb9bZ+fK3EVXWdrvY846A4+XCV0HF87w8wnPU2bm0zktLNlynzI+8gbtnmFJ6Ql4B+Js4ix1N4PqTqUuOJ+JpzhUCFpPztX/ADEVBx74gtTmE5xTCnE5UFSktOZFLtsR3/WMRcP+MkxhDxV05MlNzoksQtLUnOs3l5lGoWn+G+ottFY2rkpahtOTcfstjTezcOo0MtQcP9OvivrJxWw66ytNSl1rRNS5zhSDZRtsQeo/OK24sVtvGOE0VFJDziQfOCNPUn5tOR7R7cDvEoninSUU2tqQifSPLD50S6bbK6K784LHOG0cMKwuoTN1UKoHyqgEi/w5OiHrdr69QY7q1KCwyxe67ny81SaS+SCYQVHvt48x4fwq3xg01iSiy05L2cbdbBuNwRoQe4is5rDy3qoc1/Lb3HWLPwC3K0bFmIKAXW3kt3mkN5r5Re2Yf8SCk37x4VylqmUqLYS6zc5VBNloIvoesYuSlLzvC9BgreyJj6dPiqkx00tqlLsogJGhET3wp8XjM8O1UhTllUp9bZTzyKJUk+2pERjHlFcMqtCknIRvyMRDw4odonHVcnmys1SVcQpH8SkepP8AOH4JHxvHnhLqmMnp3A9MrSuIKwioypLqUlA9VibZYR4cpExjJAaYUlopXmDivlSReHhfDtpVEE5NlxwO38lsKypI11PWPKTrRpc2yynIhKAEgIFgO0S2RntN0vBWcMg2ERchK5umO4fxEyhxCc7aCorRqlY11hDjWZ+JoBWy5/05eDhA0zA6H+cKsdY0YojKJh0hZU2UpTupZinqhiGoVemu09SFtyynS4UlditGvo9u/eJkz2svGOE1SwvkLZXYtZSKtY/ZZfeaP26GJRSEZPVmXzEVe9UTNlT6UOrXmAIUmwSLm39Isig4GbqEiZto+RKqR6ktiwQASSPcwhoODG5qSmi6MjKw44Cr5jfYe+kdpw6+8p+V7GgtCjaXAmTRMu5mWV28ttvdfv1iY0NTcw7LPPM2TLgfY2+909+keEvTmZuZpjCZbzcm99BcDl7Q8OOylHm/OStLnwyDlCTfznT37RoYDdqppngFQzjdWDT6BWp9nymVtSrkxZw2ShTaCRf2O8fISryU3iSpzFTqDipmdqDqpl9xW61qNz/IDsBGy/G/4p6jirFVZwRSUIlqYw58PUZoH7SdVopTQ/hbBsDzVGeG8NB5oegD9DEtosFWyv3O9FVkzQBb5SP5w2zmHfM0CfraLZncHek2SbjtHjK4BVMX9Fx7Qiy63hUTXMPKZSSlKgoagjQgxr7wQcS08WcKTLM9Mtt4goS0ImGSQDNNGwS+BzvbKbbGx5xUGIeGqkqIKD+ENWFsOzmAcXSVbpjrstP09wLQpBICx95CuqVDQiEuaDzynI5HtNxwvqXhXCbmFW2fM9TE00l1FtQQQLfUHT/xFpcNZ2fnqe3UHlqAQ/8ADG/MAC34WjN/hY8TkjxtwlLy5cMnNUpYYmJV03XLFWwv95CtbKjRNBxPMSDRpflNuyK1hbigcq2zdPqR1HX3ivmh3C6tI6i9hyrEZqTso6tSnPLcV6uygLfmIe6NiZ2eAeWSW0gIReK8VJ1OsVtuXdSlLrZzoUk3StOlj7cveJxJNIk8KpUEAuBWXJm1Cri8QxG4Z4TkjmmwClOHplSnVTKkjytgjtpvCvE9VRIYcccl1lJUCVXPyAcvwiPyuMJeh0MNvtqU6BclO5ioMVeMilmQxDQnaTOifDKmZdaVAtjMLXWdwRCnOaG7SclJhpJZpNzRcAj5KsmcQvY4x7OVJbi1tF1Tcum+iUA2v9YtnAzQbdCl3Gl7ch3iqOG0rIKdaMsslKAMyFDUHT8YuTDi0eSVH59LdhHaZoiYGhaOss82AVj4RnmnHZZtJUglwZiofLrDlx1kGpvFFKUy40EFz4cPqNkNr0sVEa6c4iNBmy282UpuptV7HY+/aJ3TMMs43p70rONsolS2oqUhRDiCdla8gdL7mJpmL4ywcqgkh7GYTdBf6pmksI1GnYhQxWa+ifbLZclJkKSpnzAfW2tJ0NxspW2kccRONNClMOJlKXPzUxUqPOqdp3mP5lMLcvneCrXPl6hIOgubQ/p8MdEYoUsapiKprIRd5tlScpSL+ka6EdYqHjaxhvBs40xhWQMu2gnzZmYcLzs0ddydk9hEOtqn08RcbNv53KnaZBBWTtZlxHkGt+PrxhVXjiaROzQyOKzHW176f3iPVGaSwgNlaluAfKk6pjutCcqVRddaDrjqlFRCU/KTf6AfpDen4LDLinanMl2aUPTKS5zK/wDmrYRiXyOmf3V6nFE2JoB+QShmYmaktIQ0lJQABkFyff8ArDlK12kUNTrtRmPOXLNla2ZYZ1m19CRoP7xHpnE7lSadl5dCZNk3Kwg3Vz0J3MNk9S3MOy7JbaSpc2CVNHUuA3ypPudfpEiKkt3n9E1UTi23i69a3xqncTTCVsSqabKFVpVrNmUTqAq33j32ETvhNw1mUycxUHUGYqU8qzSnDnVnO6iT/CD7amIxwp4KTNYrxn6oouOC6jpoyOYA2G9gOt41Bw9w23TmmkeSErsEpT/AOSR/PreJ2nUH4qe590LGe0WsspYuzhOSm3C+EaR4fuH1UxVUw285IMF0hZsqZcOiGk/8lrIHYX6RmKgoqOKa9UsTYimUqm595yem5h02S2Te5/8AakWSB2Ah08RXiPd408b3cL09uY/07heYXLtpCCPjptIIdetzSLFKOwJ+9Ed4lTS6lLow8ZFapNp5Bnc7ha+JXu20i2pCd1H6Rq2GnibtjGG/UrL0tPUPcJKg96TPo1Sd7FCas5Lzsu8iYpcuoiVSldhOLF768hcb8hpziSsTWO0cL8U16QdpS6glPmLdlyrzJWXOi1NjYkDTtrDfgrhE1MoYfnhnKUhKWm/Q2ynWyUgbJ/MxdWDqJIUSnTks0ylmVmJN9EwkG4UgtLufwiukpqiebtHYb9VKqNRpYGCKIbiLdMc8LL2AKszX5yn0ttNkMqS7MrJuXFHUC/M87x9evC7gg8OuDdCpykhMw418U+Nsq3PVb6C0fKbwCcJV8T+MVIkwlb0qmY+Lm129KGG1XJPvYJj7CYeeCgkpFhsE9ByH4Wi49mofelPoP3Wd/wDkCsBdHTMPmf2Ukv3P4wI8PM7CBGsuvM0+aAx1bW4vBZgRbnHNrczD6YXRFtxaORvppAyqGu8GBnG8CEndve0IaipLjK23LlDiShVt7EWP5GHF5GUwhnkXEIeLp2M5WScatv0XEtQw9OBSZqRBdl1q2mWb6KHXQxRXFSeNHS+lbyWkLuElW3sY2Z4leHysR4eaq8g0F1egqMw0kbzDP/da+o1HtGSeOWGHK7QxNU9tLqXQFpzbKSeR9oybmSQEwnNsj0/kcfJej6bPDUbZhi+HeTh19Dz8/BZix7xC+KvTCXFuOEpyoGYa7i/I/wBYacTLl6nhagU+ew+huu4cfP7sqcu0M62VXzMuga310J5xYNK4G1KqYg84NoLazdeb7vcRN/8A0bEtUWXElQccHlrUDYqBBG/eIMlHJM3tHcjhbH/ylLTObE03HJ9eFQlI4h1fhvxKlXXGXkyS7S860RZSTy05KAja+GcVNYxweiUqDqJyUfayocOoUhQOh7EbHlFFTfDs1kzbC2kzlQp7GRxLpHmTTI0Q7e/zI2J3Ih9wJUqjhfBJYnGz6VLQw2ndQ10A5AnbpCqWTtIyDwmNWo2TFr47Bwt/RWZvErxZqnhy4rrmJSbW3UMLvKZlnlDMiallJKkNuD7ycpKbdLHlF6eEfj7TPELhBeIWPJlpSdcUzOSQeDi6bMpOqTzsU2UOoMZo/aTYdrORM++C3+9JZthtKRcpdSog3O4Vk5/SEv7N7Bk5wGwviaXnC8HcQOImwVHYoC05d9wCbxnQ1sMjg7i+AtnW0kE2mRyM/wAlhc/r/K2rxAw3LPSjhYWlxBve3+bxm3iJIzWG8UyM9LuPy70vMoUlxlWVY9QvY9xp9YllG4tzlLxG45MOPTDL/ofaGqVjWykHkeducSjGuFZPFGHm6hLPtOoWfNacB0uk3+liNRDJtJ3mqgiDqZ22Q3BWicVTBfoEolGdIDKbJPtz7xV9cn3pecWpDedCEkqWVWy7xaODsTSfFbhrJVYp8p7J5My0D/tup0UPqdR2MV7jmXM085KMNeUyo2USfUv+kS62MhweDhUFA+xMZGQcqHUBqexlXHp2bcDtk2YQDdKE66D+sO2C+HLc4oJW4qYWHFOOqUb+ok/lytDrguny9PnHXmkXTk8q42V1t25Q5u1Z2k1dxmnJbZdIzuuKFwi97JA6mOU9OHtDneKlT1LmuLGYwlVfmZTD9FcpzSEpUE5VAfdHQ9zDFQyiRW9UZlIdyDy5djkP+NuvePBVJnKlWZp99woZzABJOq7akn6w6S1PZfk3XyCUspLTKf41HcxZxMuRcKvlO0Wvzyo8qSNdlZhKUBN0lTqgrKlsDfXkOQilPEf4j6ZwXl0S8ohqoVvygJSQGgUvktdvkbSbHXVVosvinxDpvCXBM1MTM1aUbILpHzTbpOjaR0/8xiGuzz/EfGlQrU2i8xUHStV9cifupv0AizgYLZ4VbUy2Fgq8VQaji2vzdTqLnnztQeXMvuZbZ1qNyQOQ6DpEilMEFLIBSRaLAoWEE2T6ASYf14THlAJR6rRNvhVw5VRKwTmXlKYf8OcNw8nVAtbe28TqRwWX5kDJc94n2FeGy3Mo8u1h0hLW3Kec8AKhsS8JvOb9LWtukRFXBt5+a8sMk5udo2wxwW+OaSC1ce0dN+H3yXM4ZvzvlhZhPKa/EN4WMMP8M8R8KK+muUCzU0lOR1txN25hu4JQsdNNCNQdo174cOPFM4kNyjE0+ZKqNo8qapr5+0YUALLR/GjuNxYHaJU1wcYdkvKcYSDbciKn4k8A5zDVYZrVEDknU5FfmMPtpGZB6dwdiOYMKMY5XI6otwCtbYaxEFuMgpH2AyoeScwynQX/AE94dGJbzUh9K1KWw7lcF9gTv+MZy4G+IPzHUSlf8ikVNSg0tknKzNE5RdonQX/hOoOsadwrS1zavskkhxORZta5FradbRFkgDxlTY57G90lrDLchLOTU2pDTLSC4pSjokAa39v1jGkyHMQ4wrFTQlXlzsytaB/xvYRpPxVVxySo8hh1Cih6rOWdINj5SNSPqYregcLkJls6H0hnS4y68vyiomYC/HRavSHiOLe45d+iYMF0l6nTbBaJJmNEjmD/AEi8MGUmeLSGptkNOWuVJOZB7gxFZaUYoLbRl2E5kCxWdSBziZ4Y4lS+EkgLWp0LSFFBt5ah2vtEMv71ibK2mDntu0XKsTCmHWcicpLi+Z6f2iRz1XTh9q7fpeb1SoW9P9ogmGfEzRHby7kuxJkfKUqFle8NHEXjQwZdapZpx640WFWT9T0hT5rR/lm5VU2imkmtK2wTrj3izPz7SmVLCUnTK2mwP05xWGJcVSixlncrikXOUK2Pc/yiJYr4qz1TCmxaVQrQlu6lH3V0iJy887PPrzlyyduhHftFDJFJI68huthRUcULRtx6J9xHxEbm2HZeRBQPlASnKn+8QVVOUupAqst9WoBN8p13/pD18RLNvLK3ENgaEp1P4QvopllEql2vUk3Di9x3h2KHarJ1QGN7oXhh3BR1cmFFtpr1LzaFZ1/Lr2j0lJ5uoYibWhPmvTKiGlHZhkaFQ7nYdIW1XEQqdQboEq2XJ1+3xLpP+0D9wdzzMOs1L0/ANSYQ40uYnFNgoaToAmxsonkOg30vC5+80sZgDkqiqKog7n8ngKdOYqpPCGSopqwebZqK1rcU02XFJyD0psO5h/qnFZWMaQpjDctOSiZkFCpyYQEOFOtwhPInqdoaKJhp7ixOS9Rq7bDEjIt5ZdhI9DY167qPWIL4msYvSk7JYJouaSNWZ8ycmGlWcEuTlDaSNs5Burewtzi2p5JY4T2eI/G2SsJO2OacCQXk65wP+KneL+BV8W+M1PmMO1afTJ4dl1MTMzIny0z01mJuFj5g2NM3PWOqIyxQq6mTaXMTk/q69MPLKwm9zlSTvfrF7VXAkvwi4BqflUIl35lAl21JFi2g/OU//EW+sUKuqh3FqMnqcUMi1p2SjXL/APiBFhTUrWgSP5KmNq3SsLGe63Hqr8whWnajIN5jlRsq2nWJZi/E8rgXhDXKk+pIV8IuXZubErdBQPyKj7CK/wABLbqnlNtKUlpoDS+/vEurmDJbidXZClTalrplGeTNPspVYTD9rpQr/ikbjmTaJ1QT2dm8nCz3cEwc/wB0ZKsb9nHw1e4eYIVU5lpLE9XylSGstlMy6fkB7qPq+sbewi2osoJ3tGeuDFJcQ60baC2w0EaSwhLkSrd7C0XGmwiOIMHRZDWqt09Q6Z/JTvkPeBCvyew/CBFptVBuS8/gYIE/+YFyDrpAI11N4cSUZWeZH0gH1DTSCJ7W7wCD7wIROjMkQjmUXTqLiFxTmTCZ9JjhSmmxUarcta50PvGK+Ps1NeH/AB+5L1Zlx/BlaeU5Jz6UX/dalG6m123bBPuAb6iNu1tgrTpeKx4n4Xk8TUeZkKjKMz0nMJKXWXk5kLH8j3GsU+o0rpWB0Zs5vH8HyK0mh6gymkIlbuY7BHXyIPiP6Wb5HDxlMxCUrafAWhSSClQIuFAjdJG0e8nh0OVJCnPWGlZ1dxEW4oTtW8KcrT1UiXer2DZZSxMU99WaYl0qN7NOfdy65Qr0nbSLF4d4goXF7BTWIsLVBuo02Y+zXYZXZZY3adQdUODmD9NIhQT77xvFnDp/HkrqrhcxomYbsdwf2PgVX3GnBxwviGSrtPWWnJdwHMNloV8ySOYIhVh5tFOrLzMy6xMS76PPlEzCQlSkKST9m8NCRc3Sr6GH/jJKLm8HONlSR5IOqjoEi5ufbnGYuCnioaxDXqvhbEzPk0uTmFt0mqkFbDzevodtqBe+VY5aRRyTtpqssOA7PldanToJquh3tzswfG3T5KzPELw3p+J6OZp1hmcbZQXE+YkKBFleodIpHxBNp4PYTl6zIy6Fty6W1qb5OIKM1vfUxpGs4VXivAsthrDDiKlUqlmQFMrLjFPZWTneccHpCQm9k7m9og3jx4N/B4Ho1DkAHlzim5VJURcpQmxWddrCKrWKbc4yM8vmrfRq1rXNhkPU4Ph4nwWelY2p2O8NSlWpra22ppsLyqGVV+Yt1B5xBsa+IGrcO5R1uWDTrDqr+UpagpahexFvz6w8Y4bc4WygpzE22rI3lS2hANhY7dBEP4c8NpjiXi9M1PBxxhhwOPKX8osdE+5iLE5rXbTyrwRgtLz7q134G+OC5nhezRqvS35CcfcMyt5K/MQouE2zc0nYRZuOsBTqagFqUlhh7da1ake3OIV4XX6BR8fO0yeWww9NsI+DLiglta0kktkn7x5e0XrjphotlbgHmJ0ClG9t4tZaUzxNPQLF1NQIat2wW3Z/4q5bflcPU1S7lKZdN0kp9TiuVh0hrYm3ZxxMyZdTYUcxKl+pV77jrCzGGJpBpaJNu8xNum6lH5Wxrqe8I5ZMy84FshDadkrc1UR1Sn+Zh6NojAaE2STdx6+K7lJ1dQqLynk+Swz6Akm/uT3hDijGPwkg6jMJZASfTcApT0JPPme0K6pW5OhynqUEqTfO4Va36DueZjNHHbjA/jqpTNIpRBkFHJMTCSczmuqE9B1POJMbTwokrwM9Aq046cQqhxjxr5KHEqo1McUmWSi+RxWynP5CDwhgQkJ9Ih8wzgfyykJbAA5ARZmDuH6pnKA3+AiyZbgKpkcSS4qOYe4fkpT6NfaJE1w7zJsU69LRaOGOGay2kZNfaJXI8KVrdT9me5tElsdwopnAVM4b4X+Y+FFu/TSLXwLwjL4SQ105RZeC+C/mqSfKOvURcOB+EaZVlN2tu0S4qc9VBqK2yqTDvBfNlu2LW6RIE8GEFq3lflF80zADTKQSgXEK3sGpDZsgWiV2IVeawkrL9a4T/DqOVu1u0MVQ4XsTsvkdaBvpqI09WcEJdSq7YN+0RCrYBDSyckMvhtwnmVd8LHvFbwsyVXknFIlkEnUabHrCXgvx6rPBOuSdCxU25UaKXEstVBR+3kwSAPM/jQOavmA6xq6qYUQtBQpGkVhxS4ESWJJRY8pOYjQ2iK+PqFNiqL4KrHx2zSqJUqXiBpkzUnLLCHlIOrba7esduftEdwniVIZTmAW2sAhXUHnEpnMHz0jg+bw7U3XJmT8solHXRn8gf/bVzKeh5RWPDhE9TKbMUiqS625ukrLbDl7pmWL+lQN9xsfaM/NG5kpB4OVvNKqY5IGtvluFPqhJL8jzpZQcaVrbpEFxHNzBaW2SWykkj1bQ7ymMzS3VJKSgp/zUQ1YjqUvWEuelkrc1ylWWx6e0VNRF1C1tDIQcqqsY1moJcIbS2sJOis51MMMjxoxhhiaK5V5wMtC62jZ0ODuFGJniTDE0sXbaWL6XAvftEHxNgidfSpCVOJRzSnS/vEDY5puCtMyWJ7LPAKl9A8SVAxUGmqk+ii1Z05Qy62Q2o9lDT6GJbL4VmK22Vl4utr2KF3SR9OUZ9PDR7NmDZUq+lxqYlOEMP1OmgeXMT0sALZGH1JSPpeFl4/2UQwBv+I2V30/ASWkJCghIA9rf2jqrOsYdpk6aa8w5PS7RUFq1Q0o6C/U66CIXhug12rpTLofnZt5RJUt105EJ6ntHNVnjS8T0+jtKLrJmUh0j/wDkOam/cDlHWuFiQFClvfaX3VxcBeEMrRaYut1J1aiEKmZiZeN1qABUtZ7WvEN4asTPE3iLUaw8szMtNzKnG0XuhpH3UD2SB9L9Yu6l09Nd4cztNculuekXJc2NvnQR+v5RHfCfQJSQ4Uyrsw2iXmZUrRNFfpyqQSCTc6AW17Qk05eY4m8HJWalryDNM/JFgB4KRY1xJLYDwy6/MOiWkaeyXnlHQDT/ACw6kRQPBimVHjXxInMTTqFhyfcHkNqOrLQ9LaPw3+sQ/wAVvi1p/FDHU3hqlvKeo0m6A28hJQzOqF8ysx+ax+UDTS9zGi/CDJy7dElJhhCVJIBSRY30I/r+cXEkrJZm0zPdCpPw8lLTmrlHedx5JZ4mqbNtUKQpaEEtSksXFJ5KUodPYRmzBvDuZNaWGw5lWr0KO4Bube/eNr8WpFqrZ3XbFwptbmAAQPpaKVxXiej8MGA882HXnzll5Zr/AHH1a6J6J6k7RfVAjZZzjwqjT654iMbRkr0w1IN4GorajlVPPqySzR++vr/7U7n6DnFwcD+GDkyptfqWpZzrWrUrUdST7mK28P8Aw9qXE2vqrFSSS48QEJAshlHJCR0H5nUxs7hfw8TR5RtITlsBsIXSwmU7yMdFT6lWbLsBz1T9w5wcmltt+kXFotvD8vkaTYWtEeoFIDeWw2iYUpjy2xprGgiYBgLJTybjdKfLP/H8YEeuvaBD6jL0AvvaCIAO5gKsobiOU+0CF1ftB5so6Rze53tABtygQjIMebybpj0CrdPpBKTccvrAhNNQlwtMRLElDMwFeneJ2+xmGtjDZUJFLqSLGGXtT8Ulis88U+GjNapz7LzKXmnklK0KFwoHkYwtxAwPi/wV8S3sVYMm3GaVUFZJqXdSXJWZT/8AafRzt91Ysocjyj6h4lw18S2r03vFV8SOEkjiijzUlPSrczKzSChxtQ0UDFPW0Pad5uHDgrV6NrRpzskG5juQeCvmx4ivF1jnjLht6TbRTaBT3kFLzEmVKW8OYLirEDsLRXGAuOjGF6E3LYgpLs+iUSEtTsgQiaQgXsFIOiwOUXP4q/CZW+EC35uly03WMOm5WtpBW9JJ6OJGpT/yH1tFFUrDEnXgFtKR2ubj6a6GMlPCTIROO8vWaCppzSgUlgznH7/2tX+HXxg0ugUtKaNiNdQp7/z052lurmWleq4CEjRfc6Xh1x3NTeOG5/F1dE23UHT5FOkpiyPgWCbAFIOjijr7RRPB1uo8K8UoqNJU0h5bRbWCPQ6nU2Ou/O41izJ5eKeKlTlH555tEgxNoeDDKcocsonMdbn3hh8TsNbcgcBQpGRtlMmBfk9T5cKCV/govEmIVPzABLpvnP1/y0PTGCZXCtMEnKoS0hu5V/zPU94t2t4aS0yClNxbUg6jvEDxJT/LeUVKK09Tyhh8IjvYZS4610oAvgKssUNTE06rKU6fL1Nr/hDlgfjLiTDVUabnJidqkgSG1NOOlSmwTa6STuOkKK+60znWU5QnUm8U3x88RNN4c4WmCHVonXEKblJdg3ecWbgH6bkxIpA66TVFrm2cFtGWwu2wlc+79s6+nMhKeQPL+8eLjz0yy4lToYQi+dSNgOl4zT4MvEy7UuDDUnXq7MfHy9wszq7Oka29R3H5xMMQcf1TMuZShtqm1q089QKWW+6QdVGJ5Ic6zFn3Fzb7yvbjDi5p1iYp7S1TE26ktBKTZEsk7k6/MRsIgeGcCBoJCUC1ofcN4VmJ1wuPZnFuqzrUd1E7mLGwvw/U6UDIYmQxgcKsqJi7JUdwvgYKKR5YN4t7h5w+QnKPLubdN4X4O4dKUtKQ3b6RceBOGxaSklFotKeAlU1VUgYTRhnh+kNpPl3PtE5oXDpL+QFvbaJfhnAyUBIyXic0HCCWin02tFrHCAqOWpN1GsMYAQw2k+WARE2pGGg0kWTaHin0VLSRoIdWJEIREprLKvfMSmhuihKBtHS6WCLWh7TKpCdrwFSg6QqwTe8qLTuHkKTsIj9Wwsld7JtFhvSI6QhnKSFjQbwhzE4yVUziHCPqJCSD2iH1bD+QkKT+MXzWMOhxJ05RCsRYVKs3p+sRXxqfDOqPxBgZieSpKmwb9RtFP8QOCCZepJqEmgpmGb6DQKB3BHSNPVXDykOHQxFK9Qg4FXG8QJ4Q4WKuKSrcxwc0rFGPsPzDDq3EIWwtB9SSNR2iDVWpLbyhxGVQ3VaNS8bOEb1bk3H5NSmX0A2I2PYjYxlzHDsxg91xqryTrQTcec0gqbPuNxGfqaNzeMhejaTrkbwGyYKQO1pbAyJUoc7g2IP4x6u4vaLCTMMreUNDkFyYjK6/KzqQuUm2XEDcJUFD68xCddZaeSftLW0OsVphIWqZVRuFwVJ28R0WbeyL+LlEn5itsKH1traHRGKcPUBohlTs68R6TkKUJ7kn9Iraarss1mSpwEkb32hvmMYyEggqXMJ9H/KG+wB6IdO08uVu/wDqc43LlMrMJS0seoI9IP03tEIxFUxVazLusvKaek3fPQtKtQvkYgk5xRkWbhLqRfnePOl8TqQ44558400UC41vf8NzHPw54UZ07G3K3L4eOLknxHw+ltflonJVPlzDYVZSDb5rX2PKPHj5LkYSqVOkVBDU76pkN+kLG5v0Sba/WMB1nH05VJ22HkT7DhOs0Vqav7AG/wCMLV4MxnxMaDNcxHXqhLEWLDs255RHQpBAI97wrsH7NpWbkdE2ftGH4Jejihwtr+K5ymTtVTKTMmstLeMu58M4oXBCHACkj20i9fD54jcI8IJtiXp2LpKbpqlXWyrOUoGvy6XB7RT+GfCEhSU2lrbDRNot7hR4L1zU62EywTruRBDp214dHcFNVurGRhZKQQpvjDxi1jijUnZPCdELDKiUpqE8CSrcXQ0PyzH6RLuA3hBqeK6oKxiB5+ZmJhWdbswbrI6AbJHYRbnAvwsUrB4ZecYS/MJ1uRok9o0PhrCrcslKUoCR7bRqKbTC8iSc3KxFZq7Y2mKmFh4ps4Y8KJPC1PZZl2UoSgW0EWph6iBgJsmE1BoSkBNhEupNOyAaRoI4gBYLLzTFxuV7UuRCSOUPcq1kEJ5aXCOesLEJOW2l4kgWUMm66seiYEH5fYwI6uIkg21EFcA6c4Ga/UQAm2+sCEaiANheAPf6QBrsIAVdVoEIBIO+kBVr21gLTreAkgDnAhcqbFrdYTvMC1oVAWN9YJYC4EJmnZIOII094jlbw2Hgbp3ibusBQ2hHNSgUDppDTmJ5kpCp3E3D1mcBKmwTryjNXHL9n3hPH04/P05l7DdZdJUZqQASh1XVbXyq9xY943BUaKl1JBFojVXweHLnKCDFfU0TJRZ4urih1WanduicQvmHirwjcQ+FD4mAynEFOZuVOSJs6U66ltWt/YmE2C+M7OHZwSkysslKrFt4FtaDroUq1EfR6sYOuCMtx3EVpxH8MWFuI7K01miyc0tQ0cLYCx9RrFNJpLmm8R+a08PtMJBapbfzCzxK8RpartDIpJCxpbW8Qzibi2nYWprs3NzMvJsJBJcfWEJ/OLKxZ+zYoXmrXRqjWKZzCGptYSPzitcWfswX6vMl2ZnH6ipPyqmFqcI/EmIEunSuOQrOHWKVuWuWSuMHivVieYepuFmlvpUSlU6tBS0N9Ug6q9zFc4X4Vu1urfH1Bbk7OOm6nXdVe3YdhG0pj9mxMUp37NkWHRMPOHPAvNyDybtGw7Q62ic0WAXJNXY7/ZUPw84VsNoQSykkWtpFwYU4aIWE2bH4RcuFvCW7IpTdtVx2ie4f8PK5S32R07bw/FROvkKrqNTYeCqrwjw3SoIARqO0WfhThuQEWb/KLDwrwXLCgVNa+0WLhzhcGSklH5Raw0luVRVOoX4Kg2DOGxzp9H5RaWHcDBpKRlsLRIKDg5EmBlQLxJpCkJRb02izjhtwqeaoLimujYfRLBNkiH2TpgQL2tCuXlA2No90NhGoBiQBZQ3OJXDbIQBpHqB0gAEnt0gxodrCOpKMpFtRBD0ntBbnTaOjytAhERc2jzcYCjyjvLfaOr5RqBAhN85JJUk6CGSqUMPA6C8ShSQvlHg/JhYIH4QlzQUtryFWNewqFEnLEJxDhIgKOU6xd8/SAvleI/WMMJfSbp0iM+K6mxVFlniuYdIzJU3oYrLiHwCkMYS6wtlBUrtGoMRYIuo2TpEQqWEVMrJCdIgSQeKuKettYgr54cX/ANnk1PTDkzINrl373ztEoV+Iilq34N8bUN1aJepT5bv8q7L/AFF4+ss1hhK0qztg/SGaocOpSdBuyi/cRDdR34VtFrDmr5LznhkxytBQt1Su5ZENLng1xTPrPxExMZSdQlOUR9aZng1Ivp/2EfhHgeCMkNmED6Qz+AKlnXiRYr5dYd8DE2tafiUTDp/5ExZGGPBEzJNptKISeZyRv48HJdn5WUj/AOMesrwpSlX+2Le0cFB4pDtbcRYFYyofhGaklJJYTYdon2HPDsxKFADAuO0adZ4VpUr/AGx+EO1N4UBNrIt9IdZQBQpdWJxdUvg/gky0UAsj8ItjCHDBqntpyMBOnIRPMPcNRLlN0GJtRcFJShPpsPaLGGkDclU1TXl3BUXwvg8S6U3SYmtGoASUm20PVLw0loD03h4k6QEagW+kWDI8KpfLdJqXS7IF0mHqUlQ2kbiDlpTIO8KkoyDXWHgLKMXXQQgDexMdZSBfaCHp15GDV6uojq4h/wDIQIL0wIEIEW20MGBp0gEAdoBBvvpAhBQKRveCBvpaDPTYQD6RteBCGwtb8ILblYQeuvODyX3NoEIs1xpBBVz0tHRTl7+8D03+WBCK1zuI5cazDYR1oDtAWbiBCSvyoUDcQhmab5lwALQ73voY4WyF7RwgFdDiFF53DyXL3ENFQwmFnRMTtUrmBuI8HKcFcheGzGnWykKrqlghRJITYw2O4UcbNim/0i2n6OFG1gYSvYeQ4dUi3tCDCE6Kg8Krf9KIcFlNJPuI7bwOypX+ykfSLKVhdCr2SI9EYdSlNgkCOdkPBd/EHxUCkcENA38sfhDpKYIaFroH4RMWaEE7gaQobpYBGm0KEQTbpio5I4UbasAkfhDxJUENgaAfSHRqTCbaax7Jbyq5gQ6GAJovJSdinpbhShkIHIR6tpuOUETbkIUkIAXOmkBXpEC9+0GDe4IgQiSdO8Ebne8HlF9NIBJG0CEMx6WgLV+MAjTeAU8wd4EIBRI6QL2PeAk2PeCuL3OkCECsgaQYFxrBEZthAuU7wIXm5L+Z0hNMSGcH0wuCs3O0C2msFl0FR2doSX0m6REfquDEug2QIni2Q5pYR4OyCVXht0YKcZKQqmqGB7KNkw1zODy2rVJ/CLifoyXOQ+sN83htDh+UXENGFSG1BVQrw4pHK8E3Q1EaJiz3sIIUfl1EeP8ApBIGgt9IR2QTn4hV43hvzLXTtCuXwmFrHpieNYWCTqPyhZL4eSjXKBHRCkGoUKksIJv8v5Q8yOFALekD6RKWqILWCYVs00JFiLQ4Iky6YlMchh1DZFk6w7StKTa1gPpDgzJhAhQlkgbQ6GgJpzyUnl5AItChLOXpHaWyOto627wpIRWyjTUQAq8C99tYIgg7WgQjUke0Aeob2gKBItuYMIA35QIQ8odRAg7jp+cCBCI3tygkqzQCq/KCSL6b2gQgdFcyIO1+0EdDYQYTY3gQhbuYBGUaawCT7QDbfcwIRpNv7wRN97iOknMNY5NlG28CEQF+/vAsNjaDCdY6tl3IgQuRoO3eAm19oATqTHQUN7QIXB0VoDaAUZuUGbk72gAHntAhc5ARzEEqXB947USR26QEjKNQYELz+HBgw0E72jsKBPODKRAhefl66aQYRrrATr7x0VFKesCEFWHaBbL7QQHPe8GdR1gQgRm2MEEm1tI6B02ggRe9iYEIE20gwRbWBYK3glG4trAhGkk6aEQfy8tI5CTbpBosd4EIXse0EUc9NYMnXaDuANrGBC5Fz2gWKTprAKjfWDB6C0CEMxPK0Few5mBY33gC99doEIgSocoGx3Jg8wB2vAHq1gQivc6Qd9dQIPVWwgKTpygQuHG767RyZcKGljHoL26wew1ECEnVJC8cGST0hWE6biAdoEJJ8EBHSZRKeQj3CrdTBhV+WsCF5oYAP946U1ltBkXOukGfUIEIJHaBlUnoYAUQCIAN+0CEWpPMQCLbEwdj1gWECETfODIzE6mCSq14FzfS4gQgkWVHWytLwRCrQd7JNoELrMeogR55j0gQLlkQVaOx6RtBKSVDlBXsf6wLqMk3HSATruBBpJcgyCTsIELnLfc6QCAdoPfS0BQsBygQiGmm8dEAHQawLWGw94Ga+8CESTrqNYJSeZMEbcrmDBKukCFzmsdNY7FwescrN/pBhQ5wIQNjzN4JV0846WARpBZMsCEEkJ3Jgyoj2g8g+sclBSeUCEBa9wdYM3VztBe/5R1kvAhckhPLWCuL73g9TcAQaBcWgQi3OmkAkg9oBSUnlrBpAUdbwIRE3ToYNB06wEJvoPzg1WTvoYELnVR6QZMFm1gZsx5fSBC6FiOkAiw01gk22uYJRyG3KBCMkexgbjbbnBDUaQYIA1OsCEAm+0FYg7x0kZk6aQPl6GBCGUHntAIBEApA1F451v2gQjSQTYm8A2B0F7wY22H4QAc3a0CEQVlF7QMxVuBAK7Gw27wFIum41gQhYpOm0AnvABzaa6QMp6QIRhGmm8Fa41VAIIIghqdIEIABJ1MC19jBqbsL2vAHy9IEIg3zJJg9CNLwRFhpf8YHyjWBCLVBJgyCrXaD+YXMEkHpcQIRquANdI5BBOwjtSdLiCSCRAhCwB5QCbnTS0BCCIIix1ECEajfcCAmxG1oBCjsBASdNYEI7n+P8oEdf/EQIFxcc4Fh0ECBAuoWEGT6RAgQIXJAEHAgQIRs7QUCBAuFdL3gl7wIECEafuxyReBAgXUIMbwIECEadjHNrwIECEIMaAwIEC4UUGv5oECBC5PzCOvufWBAgXUE7iCV8xgQIFxGrYQUCBAuro/IIJOxgQIFwoo6PyCBAgQVzBj5TAgQIKKDR80CBAgoJ+YQZ2PvAgQLqCN44Vy94ECBC7PyCCSTmgQIELlWsGBaBAgQuT84joi8CBAhEnaOkfNAgQIRQYO8CBAuFBHzwDuYECBCK56wY3ECBAuolakwY+UwIECEUCBAgQv/2Q==',
        wings: 'data:image/jpeg;base64,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',
        liver: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAGxAbEDASIAAhEBAxEB/8QAHgAAAAYDAQEAAAAAAAAAAAAAAAEFBgcIAgQJAwr/xABIEAABAgQFAgQEAwQIBAYCAwEBAgMABAURBgcSITEIQRMiUWEJFDJxQoGRFSNSoRYzYrHB0eHwCiRDUxcYNHKC8SWSJ3Oiwv/EABwBAAICAwEBAAAAAAAAAAAAAAAEAwUBAgYHCP/EADwRAAEDAgQDBQcDAgYDAQEAAAEAAgMEEQUSITFBUWEGE3GBkRQiMqGxwdEj4fAHUhUkQmJy8TOSshaC/9oADAMBAAIRAxEAPwDvvqIO8Ar1nm0AJsL9/eALnmBCFrHgQCnvsfsYO4HcGC5N7WgQhbSmCAIVfbeMiQTAA0niBCJdjyIBUCOYMi53glJTf0gQisCPSMkL08wQFhtuIMAafSBCIi/EDjYbQFcd4JIIECFlpCfeCSd9rwCnV7QB3sCIEIab83gXI2EGm57EmAUjuLH7wIRWA7bQFK9AYCU2PFoMX1QIRBGvvAUAna14Mi/BEEm47QIQKgBYjeBsBsd4BJ5tB2BgQglek7iBqCjxtAACuYGwHpAhETpNgLQAd+IO3pvBWUeIEIHc3sTBcng7xnY25tGNjeBCBTb3+8FfSeRBp2EElQHYmBCMLUe4glEEwahfnYQZVpH0wIWN9I5EAJt3jMWV2tBWSNoEI0kpHtGKjqgzY8bwFDeBCIHT94AUdW0Gbg8QANidoEIabb3gj5jBabKNxBlWrYCBCI3B4gFW24gyNA9IAJO9oEIrC3MC1/aDsFWubQALneBCAvf1EBQ39IF7K72gja/BgWUNN+IyI0j1jEAHmMri228CwgF78fygcq4EEbq54gX1CwBgQiIuuDIAHJg7gD3ggCD7QIRoAA7X94JStR3MAhI7XgFIG9oEIaT6mBAuPUwIEIar/aDG3MEQO43giBztAhG4B2jEnbkwAdXNhGQJ4G8CEewHAjE3J34gHnfmDBN/b3gQjGxtAIB7mC725g9OkbQIQCgLiCKCeDeDBO97QRIJ5tAhGFaRuBBA77CD0Xgyi3BECERNz2gC/feCJI53+wgJt7gQIQub+0DUL8CBYlXe0GCACLQIQNveC3A9YAsDtvBqBPpAhEknsbQdgRARtwIBBUeBAhEV22teDJAEDVpgwna8CFjq1HsICr23IgwLeloAOo+32gQiR5RAA1C4sIMgK2G8BKCOxgQi1ewMFysdoyPO0AC3pAhAm3vAQmw94AGsxkUAesCESrnkQV7nk7QYJ7QQJGxtAhHyOBBJ3PFo8pmfZkEFbriG0gXJWoJA/WG5Wc7cI0FBM7iahSpTyHJ1AP6XvGpcBuVIyJ7/AIGkp0FNvaAQLdzEZr6wst2nSj+lUgojYlIUpP62hYw91C4IxS4ESWKaI6tXCDNJQo/kY1E0Z2cFM6hqWi7o3DyKeaST3g9j3IjxlKgxOthTDzTyDwptQWD+ke3B5iRKkWR3sPWMQO42g/p5vBFdzxvAhBRKh6wEIJMHew7QRG/MCEFi5gEkG20HwYBTY3tAhFc/aDtt7wSl3HH6wad09t4ELEi/v7xlaAlWk7wSlalAcwIRjj0gkklXrB6drwN9MCERTcwRO9r2gb7cwYVcbwIRXA7QaV+8He0ECTzAhHAgQIEIciCCR6QekEXgvq4O0CESlWNrRkCYICw35gb+0CEN73ttB2J4P5QACNzAAt7QIQKvXmANxsIGkJVybwdxf3gQiJtsN4xKd99ozCieAIAAUd9oEItJ/iEBQ1DbeBa5teAUH8oEIgrSLEGDPHeAEgjeATta14EIrX73g1K8uyoCSTfj/KBa2/MCESU23g7dyCIMHV2/SCtcwIRg254ginbYweoFNoxJCQbkJgQsgm47CCUnb1jFcyhhsqUoafUmwho4o6iMCYL1Cq4ww1IKT9SHag0Fj8r3jUuA3KkjhkkNo2k+Aungkj1tGX0i3rENVHrowAqXcVRqmnETqAbIp7rStR9LqUIjnE/xL3KChakZd4hWhP41vAp790JUO0ROqYxxVjFgldJ8MZHjYfWytVa24MADUfSKNVP40chQZlSKhgOptobNlFmcClJ+6VIBjfw18bjLatvht2TqdPWTYiZQqw/NKTEQr4P7k47srioF+5J8CD91dU77QXgkRUmtfFVpU7Lk4Vw9KYpmCLpZRiWSkFq9gJgoMN+lfF6q9CnFf0xyEzTo0iDb52lNtVxgD1KpckW+14wcRgBtf5H8LaLsnikgu2MeGZgPoXX+SuwEWEA2bG8QvkD1+5Z9Rs69I0KuKlavLp1uU2qyy5CcCfUNuhJUOb2va0Hnf1uYEyiqxpD9epL1YTLKnHWPmk/8uyBcrUB/d3iX2uHJ3mYWSLsDxBtR7K+FwfyIN7c/DqnNnj1FUjJOnJ+YYm6rVZhBXLU6TSC64B+NajZLaAfxKIHpeKRdQvxd8SUOZVIUeXkW5946G5GmJMyu52CVPkeZXshH5xQzr3+IviDqwzTqS2MSJpGG2VlmUpjDpl1TSEkgOLA3UT2BNhEN4cx1PYUZbfYmZ2WfSoOIfS+pDqFjgoWLKFvYiOUrsVqJXkQuytXs2AdgqKlgbJXtD5SLkHYHl/Bfqro4i+JjiOeLzGKsGTk1WFL/AHaZubmAAPQtqtv9hCbJfEskKZNNN1jA2HmtwlSEyocdHG9tj/OKX45zVxHiyoMvVSq1OpJlyfBM3NOPFN+bFRvf3vC1lBidc3iqWYXTafPtPOAqlptrWh0A3IKjYgW5IhLv5f7yuojwejtl7oDoCbeS6P4I6hshuoaQap88k4Orj4CWXFNqYlpkm1tDoJCVH+FYhtZj9LKZGZLuGsb1NKFWsiZlkzDLKyRZCnmlKA5vcgWBjOl5vdPWEMI0GaxBgtuSXUJTUG2JW+pRsghlIUHHEk8EnbmGhXOnaSzJW5O5bSOOcBOVD/00lWGlutPo8tzqbOttJ9F3i1e1pYLkOPTQrl4IxDObB7G/7rEeXFNymZ1ZxZKVh1uj1GXqCJZenxpKZV4blrcFJAP6RMmVfxnMxMFONsYppbM6hBAUmYRdR+yhY/qDFcMz8uMd5QVCQplcmkom1t6iadNJdQ8m481gLo+3tCarBlSraUNvTLjzDoBJdHmTx7QgamaI+44hXcuD4dWxh08bXX4rq70+/FXy3zo8CVnpwYeqTth4cwrU0o+yuR+YizFMqkrWZFuZk5hiZl3RdDrSwtCx6gjaPnkxdl9VMLOeJIq+a0ea7Z3FrbxJ3TN8S3MHppqMukTE1NUnUA7KvkrSoC19jsTb7GLKkx53wzjzC4fGf6cMcDJhrrf7Tt5H8rusE3BJ3gBPsBFb+kn4mGX/AFOyMtLoqUtSK66Akykw5pQ4r0ST39j+V4sciYC/p3jo4ZmStzRm4XllbQVFJKYahha4c1kDbY7wVhfciAtJ54gbHsDEqUQKQrvtBWTeD8O/BP2gwnQOBAhYEAdtoOyRwbQdio8CC0gnfaBCMeYbG0EPKeQYAG2x2ggkE8m8CFnquPWC9jveCPoDvBpIBF4EIA6RzvBWBg1ix9IIDV2IgQjgQIECEAm43MEUA8cwROrsYyT7WgQi0g9oBsBtxAULnciALcG1oEIC4O0Go6oI2J5EGUi3ECEEkg9oBG8GLWteC2SOLQIQtqHNoAOmCPm4F4MXv6QIRg2VvAWoniBqvyRBKdSUqI308n0gQgkG/aDXsPSGvijOPCuCpRyYq2I6FTmmvqU/PtIt+V4j2Y+IZkzLvlv/AMQqA4oG37pS3f5pSY0dKwbkJmKiqJBeNhPgCVNYTdMFfSbRFuFetbK7GM2liRxtRnHVGyUrK2gfzWkCJGkMQSNWYS5LTkpMIXulbbyVg/oYy17XfCbrSWmliNpWlviCFuK/KDJCBuQB7941n5gJGykn7G8Up6+vi5Ufp9dnMKYE+TxJjNolqYmVHxJGkL7g2/rXR/ADpT+I9oiqKmOBmeQp7CMGq8SnFPRszHjyA5k8B/N1ZHqa6tMF9KmDlVbFtUTLuOJPykgzZybnVDshF+PVRskdzHOrM34yWamf2J3KDlzK07Bso6VBD2hM3OBO9yt1weGj/wCKCR6mKV5vZv4jzoxRPVzFVXqNZq84SVzEwrUE87AcJSOyRYQ36NjTEWAphmYlJRuZlbhXiNoN+9vMBsr7jaOalxSSZ9gcrem/qvbcI7AUVDFmqAJZeZ+EHoOPifkrw4W6cMyuqypFnFebuKnfET4ikzM++hsp3+hoBCFelhz6WhYmvhE5RyiZlFWzdZRUJc2mG1vy2ppW/wBSCoqF7d4a+QXxBVU2lSVMrmCM2H55aQ6ymiU9c0lYII8ROwXc7EniLO4fwDl71F0UTlZwvUaBUamgtlysU9NCrSh5uHCQo/fcxaQxQFtwLnrdUeJT19LKRmLGD+0NVPs8vg7ow/ICtYIxQ5WqelJLrkqkPN6d7m7KiQq3a1hEFVuezN6SsTsSbFfqjsk0nx5LRNOOSzyd7q0m9iCbFJ8wMWrzr6Xm8gM6UqwXX8yqXRZhnS5WpSsszhYmFaiEloWW40Lm5JvDS/8ALBi7qOln5fET1RaMs6VtVSaS2h1w+ay03AJuOyiLb7mK+UNzWYLHoVdUdW50QdO8PYRxbY/cXTSwT1lNZttS8vjSjNTjcw58pdmwdZcN7KQk+c8jc3HMKk/llQ6RV3PGkHlTKVFSWA2lBKd/quPteJcyj+HUnKeYbqlNLNcqBBQZ5yaS+4gnV5UBK0JRe9iBqt6w+650iT+M6G9OzDSKVMMEtrEw6ELQoXsRquSOwurc8RgskI11URrKRrvcdlHj9lFeCcD0TE9HWl6loS+dkpWUrSnnf7W9I3p/pTxZTGP2xg56Zkynf/lZssKVzuNJBH2P6w269gTGeVk+6y5TZxbLZPhvtNKUlSfUWF7QjTPURX8Lmyp+dklg/T4R2P2IG8Q3Zs4KcQTk3gcCDz1CkWiz2cqECVrtMm8TyR8pYqsqJwKTYg2UoeInbulYMJeNujPCOadMrb8/gXHOBK1W5dLDtWosw/NtJ0m4/wCWmSpOn1AWNoSqN1w42lNKZeqKSnnxHWEoKvztf+UPPDXxJsZSDGlyvuuFBsoNBK0j7+W0blsLvjJPldQSQ4lEc0Aa3/iSPla3qFQfN74ReY2B8QGo4ZrOH8bSziyplvxP2TVFewl5nSlavZpxcRxPZZ4uwZiuXolew/XqXVl+VMjNyTqHj7oQU+Ye4uI6vzHxInMSyRlsR0miYklwNmp2QbdsPX0B/nDbqPVPlXXnGXHsJVCgTbF/BmaBUXJVbfrpQSUge1rRE+GK3uG3inKfE8TB/wAxDm6gj9voqN4L6CMzMdhLn9HnKNIqUB41XebkWx6H94QpQ+yYlqgfClnpdlK6rjjDrRAutmSZemSD6XslP5i4i1GFa9hPNNAaw9mC0mdXa0viSnNa/sHm7XPuRCzi7KXGGDaQ5UJWRcxA6lu4clJtDjbnsCN0p/KFzRuAva48fwg49KXhheGHkRb5uVesFdLNRy9rtFmWJk1eYoY0SExMS6nS0k9kAiwA3tsbesTUzhbF1bmQ09P1BlSgCpBdIUOOUp3P3MQpi7rWr2Xa1M1qkymHnfE8PwfEUX3D68f3QksdWGHcbz6Ham7MS039PzMvNKad7c3O8LiRjdNVZy0VXKBI8A9RYqYcVdNKJuf+aqT1RCjbU74XiHt35jSkskcIKnUsKxY8w+LXRNS+kDjv2hrLxxVlyLcxhzFVTnEqFw266lZUNuPNv9uYQ57PWrNzPhVmmsTikncuM6Vn84yZWclFFT1J0L/t8ipNq2V9Uwky4ZKn4br1McFg8gXUobbHuIi3FqcIyaFSmIMu3mmyTd6lTpacTve+lYKSY36XmxTJtotssz9KdWbktOFSBxyOYyqtcXVWCFTcvUWzyHLBfb9Y0dIP9KahgeNJPUXB+Rsmlg3pvy8xlWUzGE8yZrB9WJCmZavS3ytl3Fh4yCWz+dov30n9ROZmSEjLYdzSpLtXpDSQmTxBIOCZZdb2AUFpuDb+E2PpfiOeOJsKSdSWpsS5Tq3shQFvz/zhRymzSx107TRXhvElZkJO4KpR0iYknB6LZVdNvsBDVFXiF1yLeH4VRj2AOroSwuDuQcNR4OGo8wV3GoOIJXE1IYnZJ9ualZlAW062bpWI3Qnbe0c6ulj4vNIw7MIpuN6IijtTKv3k9SgVySlm11lk+ZonvpuD6CL74BzNoOaFDZqNBqcpVJN9IWhxlYVsfUciOupayKdt2HVeIYtgdZh77TsIHA8D57JdBVfa0Amyt4LcHYwZJt6w2qdGSbbEWjEoJ9IBA09oAaJ3vxAhDTtsTGQOkX5gr7b7QIEIkqBgFRJsLQahYdoxFinvAhDdPuYyBKhvBJtwIPg+sCEIECBAhAbiMU3A4gxe3FhBXJG3ECECBe5g9SbcQQ8w3MZJOnm0CFiNPqYzSdub/eC1C5sOYG4va1oEIHc+8Apt9UBKrcm0M7PXPPDvTzlpU8WYqn26bRqU3rddURqcPZCR3UTwI1c4NBc42AUtPTyTythhaXOcbADck8AniXEtDVfYC59obGYecFCyzww7V6pUJdqVQnUhKFhbr57JQkG6ifaOPPWD8dP/AMw0+9TcLzdXo+Gmj4fyUkFByd4t4zibFQP8AIH98MPIHLfMzq3xA3MyrFTo1HSQFT9SWtpDaNr6EHc7en6xWuxJp+Dbmu6Z2FlgaH1z8pG45dL338AVdjPT4pubFWnJmWy9wJTqfL3KWZmpTCX5lforwwdI+xvFfqrQurvqonv/AM7VatIU1xV/DVOiTlkj2batcfeJPp2OshehsS0piHGaK/ihRALDF5+ZUvbYNt3Cd/Ux44q+Nhl3hCrrlBhnGS/CtbXKtNc2t5CokfnFZNXU+bLPLryv+F1mG4LWZc2GUQI/uLfu4qOKp8MDHclJtO1FxzEk46reXZnFt/ndQ4+0adZ6PsOZTsl/GeKqFhUMpClyTT5nZse1uAfyiUql8WWvZo4GE/l1gbEVVkXFKacaZoLsypSha6StJKR+QvFE+p7NHH2NcWTM9ifBE/hNmbUSlC6TMS1//mtG59d4imljFjC0nxBsr7DMPxKVxZXvbH0BGbwtsPRTXNdXuXOVbwl8KYYVX3Gtvn6w6QFn1DY7Q6MI/FTr0m3/AMs1hylspH0S8kpZT/P/AO4oZQK3Ta7UxLKnGTqWEqKFpUtH3Tte3pEy4Xal+migNY4mJaRqNWmdX9FZd4BbQWnY1NxBAuGlbNoULKc8xuBEDqyVgzE2Cuz2bopbR93ncdrm9z47Dr0Vr+rH4meLMusCjCMnWXGccVyVC6ophjw/6OsOJulgG5/5paCCr/tJUB9R2pJT6hZZW674hcN1FRue997fqYjNnFLtfxJO1KpT03O1GeeW8+46sqU4tZJUtR5UVEkk+8O+Ve8WQCGg3qVbcm5H29IVkqnynNJ5KzpcHpsOiNPSixPxEC1z+BwHLrcpXW1M1KusU+mKROTM84GmEa0oJWb2RqVZPsLm0Sh0rZ94HyZxTOy+YNHZm1KJlUyVRknXEybtyFLcbQUrGm1iLKB7Wiv2IJ56moKlfKtpTyVqCSR+faJoy2mpTqMkVNTeGsRzs+lhDLDkrIqnknSkjyvFOpPAN7kDiMsOt491FVsvEW1F8p3sbH1XTDp9zGwJW5icrWEcS4UQmoy6GZhErNOjUEX0ANuqCm7AcH84Xq6zKV9991OKplwKuHBKMMoT3vdxKFH/AAjnPROj/NmgzXh4WwzPszTw0NuVKXS020g35vYfnf7iLD5fdMeezVMYbqc9l5TkobCFKl2X5hzg3+lOi/uO8OtnnLcrmLiKvD6RkneMqAb87X+6kPMDJ6mTbgmPFU9pXq1Pr0lzcm+rToO/bSCfWEk04AKbbfmpyWYBC0FbPhhW5tpDgBN/4haBTMks1cGy1pOfpsw0lwqKJhk/Lnm40gEi/qbH2iS5HC7bNNTMVJpBn/Ds6JKVUtCTvcAqSVWv3JMaBpO4ssOqWRiwfmHRRLU6suVQqao9VewhXEEhJYk9TSxvs6kKLawfax9ojfMvOfO1NVZnThzCuPWZRQJ+UfclFvJSSQhTJUAfcC8WXnaAxVmQJd9a0p7LToWjnbiGpWMOmnPKUhTLQH/cb378HYRo+/NTQVDCbka9fzuoJzA+NjjjB7a6dWco8PU1lxOkytUl3klJsRsokAj03ivOY/V9iXMlS6m1Ly1LkXVakSso0BLsk38urzK/U7RdnGGF5DGVFclZ9qXm0EEFDzYdR+hH84rtmX0oUaXdcmaPKop0xvdUmstgg32UB5T+kaPle4i5urChZSxX7qMNJ/nFQDTsy5ipvJXUJtxCphVkrdBDR/tXtc/YQ6qZSJefUbV9hOvchlYTr/36HeHTQ8LM4GromsS4alcY0RUoZGYkpizLrY7OsupFkuD3Foh3PbAlGpL7c5haQxLISzjilOM1FCHEsov5Q283cLPY6rRlruKsQ/MbajroQn0/RHZOYKGqgstet7E/n3EeE3SZxCCWX9alcgG5T/LmINfxdVpKYl26fVRNBX9Y3MsqaLJ9L7hR+0PGhVbF1MWhx2Zl0ahtraVx7bRMHMIWpDxsn7TcQz2GJoKKnkK5un19SbRKeW3WtibLp5tUrVJnSLXR4hsR7DiIRksWzc2074qmp10EFQaYWT+ZEak/MipJBMpNtL5Cg3a3+cYbcasKhmiZKMszQVeaQ60svuoqkt0PM+hSE4275UzD8oH0tk/ivstH3QoWhmZt/DDkq1SzXsp65KTcg6nW1Izkz40uo9kNzFtbSvRLoI/tiKfCuO0+YSVsr8NP/VIsT/lE09PnVfW8o6s2/TZ5aEKsHWVHU08n0UngwSObIMswv14pAUc1N7+Hvy/7Tq0+XBQ3iSsYiymxQ/R6xKVCiVOnuaHpV5PhrbNxvbgg9lC4PYwsjqLrdLbCVziag0QCEujWQP0vF1MQYjys668Npo2JJFum1xTZEq+ghL0usj6pd07gX/6arpMUi6jeh7GvTLiAKmz+1KA+5aSq8ug+C+LiyHBv4TluUq29CYrZKMs95hu1XVLjDJyIp2ZX8jx8Clai9R0rNOJcmZdcutPK2V6R2/WH7hbNihYgebKqolgEi4eb06uO44iqzEhOTk862pjwkBQ1KCFeG1e31G23PB39Iyp88ZefcYKjYbJWfLq4iExndP3aTZXafqtDfYCG3Gg46LoUhZUngbgw1qpUHKa8Ww+4kk+UOcK+xiAMG5hz1BCfCfCm0m+lRBSeO3ESJSc3KZXpVDc+VMKJtb6kX23HcRpc8VK2EDUap2Ldl51weOgtuH8QGx/1iRMiOpbFnTVWmp2gTzj0gFBb0ktZCFDuU2+k+429REaIk0KYTMSrwfaI2KTqBHvAkphTLdkkq1chW+k9yP8AKNmSvjdmYbFQ1NJDURmKVt2ngV2L6Teuyh9QmG2HHXm2JtICXwqyXJdR7OJ4A9FjynvaLCJUCkEEKuLgg7GOBmX+YVVyyxA3UaPPvyE5Lm6XGzYKHcHsQe4O0dF+hn4lMrj1uVw9iQtS1RSNKbbIdt+Ju/Huj9PSOswzGGygRzaOXivansNJSk1NEMzOI4j9ld1SgBuIxvY8kAx40+pM1aSbmJZ5t+XdTqQ4k3ChHvZPe94v15uRbQoWA9/vBe20Zb29YxtqO8CENBHeBY+0Ha5txGOg8bQIRgaT7wYSRuYCTY8WgWueYEIQIECBCIn3tGIuTsIyKb8neBueYEIiD6WjJOw3EEVWP2gIve94ELIWH4bQQBvsDBH1MBKrK2MCFhNOC2gkj3jhL8eDq4rvUx1QIyxo89MJwhhKYMmJRhRHz82NnXl25AN0J9AknvHdWaZL0wQkgHSbH3jgVIZUBnq1x+5Wx8xVkLdmEzKxcAqeV4m35mKLGg+TJC3Yk38uC9a/pSKaCapxCXV8bQGdC64JHUAW80r9MmUmBsiMtFV2sSC5+ZlEpIbbZBdfdVbQ0jbYqI5hv9Q3U3mBjOkvyEtNt4SorXlFKpi/DUhO1g64PMpVuQPeN/OjPzDPSzhiQZxo3UnHZmYE7Iy8ikF4JACQ8on8G6iPtEY5zUuQmMMv1Sh1Fc/L1SU/asm9bUZplQSVm9trHeOexCOV8ZbFsN7L17BGUjZxPWi5ebtJ1HlwSzgSUykysNLlcx6/WJeZrEmmoOzmG32H3JfxLaGnVKBWF/xWO1438a5UZT4nyRrOIKHS8T06eSAKTVX6kmclZlQKQ543ZKrEWAHMcts38z6gxiR5oOqAQs2IPHvFivhs510yYxxRpLGImpzBzj7srVpZtQJLLjRSpxCDt4jdwpPFyIzSUmWIPc1oB4/krGI4rC+qfFDK8vbra9gba2aBz21unri7PueqTNUqDeJKxhdVFlpaRpUnSJlUq0ojYuqQi17galEWVcx70Dqdzww1hGVfXjvFdWo9Yb+bk5dVWXNnS0oEurSdRbCSL2NriK99QzkjhrMipUykTz9QpcnNLTJvPtBl+Yav+7WtH4VFNriFei5xu9OlRLVFrrM/PTTBZdnJZF2m0OtgONo1C52JSq+0NQPePi18Fmu7hxvGQ22vvAWB5Hlr4q2+TvW1mliLD6017DeF8zMOT761OoreHmnwpRUkOpbmUJDiSm4J32BBhrZ2VWp5sZz1eRodKdblZVfyslTpVJU1TmEAWaTe2ltJJ3V94cPRNi+lY0fljhV4yrcyktIpC3i4xJVB1oomXVoIsWUstl4L5CvLDMzpzlXVqnOUmguqlKKHFJW4jyO1M8eK6obkKAuE8QrPLnkbGdQL8VZUFI2GKWpZZriBqBbQ34bE6b8deSbjOXLWHakGa3iKmSLyV+diSBn30etynS2PtqVaJlwrXco8LSDYmMPYgxXMJG6p6rLYaUfUNMaRY+hUYrqmWcceRdQShBvt39oUjWBIpIudSew3t6xiSF+7TZItqaaxDw49bkfSys9S+pyQwhSnnsI5U4OpqJdV1TYo7k+pjY/U4sKA/MxpVP4m2Zc02tmUxEJFDQsGaeEMoZtf8KQLCIVw/wBUeO8uMLytNoOLa5SJCWmlTzUlKTSmmUuEWLikDZRIsLKiRpP4huIs1J8s5i4Yy5xbJuaAmZqlAQoU1Cb6vBbb0pUtfGpVyTG5pXln/kcD8vkUr/iNOyQj2VjhzJJPzB+q9pr4lua8jNJcXiOoTCk7BK31Cx34I3F/vtG3SfieY+nZ5hD2M8aU6afdCEhE+p6XuSRcjlKf1iL8xpqj5o4yeqVPw5SMIU5aQlilUpnwWGE7kEjcqWeSSfbgQnUqnSdNU48lkICTZJA8yjvbtFfLSH/U4nzKs2V0DgMkTRfhlafsrk4M+J/mrgjw9OMHZ3SqxRNNomNt9zt/fEoy/wAaPMFyXQy+qnySdNlPS1NaUpXO/m4ikmV1Mo2I8RSkviOffpdJcUUPTknLh1+U2VpISdlpBtcc2v3jHHdKmcv6y9T54Ptqas40otlAebULtuJBH0qSQoH0No1b38Y9x5t4lLy0GFVD/wBanYXb/CPwrzU74qDs8sCpuM1EqWdSnZRCb88lHBiT8H9TOCs3XGW0zdLkZp/YMzxLaCr0C9xv72igXS5hLDObuaMtSsWprUpS5iUeSuZobWual3EpKkv+EEnxQLHUn0N+0KeeuSFZyDqhmJOYmKxhaYIXI1tuTdl2ZhCgVI1hY8qiiyhY6SCbG4IG5fUtZ3gOZqrZsNwySb2dre7fa4sLA/by3XRDE+WMzLy5f/ZaUMOC4el1621D1CkkiGzL4IpEwhTc2Zti+2pABUn13teKZZN9c+McnFS/yFYmAyghRlnD4rDoF9lIO1vtFrsouvnC/UDNLRiiRwRQ6mE/1z827T0PDf6VAFN/vaJIquN+h0PX8qqqsMqqYae+3m3Q+h+xSzP5F4bq0mpqUr0qHSk6UzadF/ztb84h/H3ThUqO8t2TZZmmwd1yUwhxBHukf5RY6pZVYFzZaUzRa9LqmkpCnVU6ZM9LtX/iWdP8rw2cQdDOL8POB2lIXU5VY1JelF329wbEH78Q0e8I91t/BV9PUxxutLJlJ4OFvnoqe13p2eksRNVqUZmaNVJc3TMSiPBUk+pTYpUfX1h9z8/LYrYpsrWKBSZNUtLCWXP0Fr5eZeWD/XPsLJQtXrotExTOFcWZev8AgzkvOpKfwTDBWn/9rEH8o0ativDtQQG8TYZbmR/3pQlp0e4sIGz5d9PFNTEykOaL22IKrxmFkziymSryaNPN12mqOstsAMv27amyL3EQzXma9S3HA5ITKXkGykOtKSU/lbaL0KqGCKtoZoU8WdIt4dYbKy37BaTBVTBSp6Qs/S5SotW2cZHjJHuBfUPyMTCdqA5zW3cPXQqgwraapdmakXlqXsoBOr8jBOUcyjgVLys4na4s3/hFoMf9OVGxIl1VNmBI1BJ/q1b6j6WUAsD9YgnMnLLEmXS/GelnXWUGxdbusI/9217RIC13FMRTAjaybVOxw/R1jzrZmEEGygUnbgiLI9P3Xsl6TGGMfhupUSbSGPmHkhekGwAcBG//ALuRFYZ2uLqDKfFlkTDRtdZOyTtsCP8AGE9+Wa8RLjCVCw87azcAff0jIYWG7SiaJk7csgVzutvBs3ivAFLRhxqUfwvJy4clnZMhTc0oquXH0pHncSnSlKuwHrFE8U0Z6RYU8UN2SQlQS4lTibgWJSNwLbcdomzp/wA76nlbOiUeW7UMOzZHzMgtVwgfxt3+lQ/QxIud2RNMpuBaljbBdHouIZCtSup4PSgdelgCFFxruhYsQpPpA5rJNTulqYupGiLcE6fv1VNBWQ2wCBoWLbp7xut1ZUzLC4bWbD6U6VH84SZup06dLzqm22DuvSi4CONgP8O1o0MO4plKtOGXlXFrcSjxClSCggXsRFe6NX7J8trlSPl/mlP4UqADby1sKHmQo3B/1iTaTm3J1lJQtpHiHfUhVrfcRAcrUHJSbUVstupdTpSTtY7b/eFiUqrcw0lNw28kbLb2UD6ws9ttU9E5rt1OBxEX03ZduSfLuLqjYpGJJqkT7Uwy6tl5pQWhbZ0kKHBHoQYh6kYpm5KYZQ48JpN7KunSsD+KHi3iBcygKT5jbzX4P2iPqFLLG21jsuq3w4Ov5zEzSKNXHSt1pI+aSfxp4+ZQOxH409+Y6ASz6ZppLjZQptaQpKkm4UCNiI+evpqzTcy9zfpE+mZLTZdDa1/hTq2ufbsR6GOznSFnyxiqkMUeZcCTcolwVXLCxupk+3dPsbR2GC1zpY+7kOoXg/bvs4ymm9qphZp1IU+6re0ErfteCB1je/5wCSdgLRfLzZGD/ELQAUntGJUdgYyBAHECENv9IPntaMSRzBi9r8QIQgQIECERgfYwCLe8AgD7wIQJHobiDF1ekEDtvzBhergwIQKgNrXMFck32gwRfe0BWxve8CFgps6riwMcqeqPpxOVnVrjWrvq1ydQllvMIsLuBxQUEj3uq0dWQoEbm0UX+LLltVK1hlc9SmzNVV9bUvLNoUA4SFhWoepRpvb3ivxEhsfeW2Xb9hJj7f7MTYSC3z/7Xz5/EqzixTVc8KxTqrMImZGVUEU9Om4ZlxbSlJt2tvCB0z9cTmD8MyWEMUMqfocq6r5OcSm70ileymyPxNkE/btE4dSfSfVcQYrnalXaFX65PuHzCXcSNagALEp5/LiI26Zvh+zmc2eMjSK5hytYew9Lq+ZqDy2HDqZTb9ylZFgpwkJB7XJjnaaVjW348V7XjNLVPcGt1A+Hx6ckxMf9EuOs0JlzEOFsOT9Vw9UHlfJzzaQlmYFx9BURqG/MPzp3+GHmvhTMGgz9YkmKXS/mUOvy7c2l+ZebFlaUspB1E7bel46b1XA07PYZVJU5lqQpdPl0yjEnLuJYlpVhASlDKVnbWNgdP3Jhl4Yq6sncZOqbqiFzyGQ0JtlWp5gG2pllVvqt9R9Iq5sWlYzIxtm8yuioex9HUS+0yPvKNbA2Fxbc2vbnzTdd+H1hvGUpRqtjHAWNaWXlrRLLYFPYlppoiwQUuJ8Ui291bi20VZzi+EDWWsSTc3hzENMcpCNTxS4wsrkWh2WlPOm9iocxdim48rebNfblZGVn6i/Mfu20vLU48obC9jsgH1iUsIdOWLsKzclU0PoaqjboKla0BiVG2y3DcK2/CRbmI6arqLgsuR5J7FcIoBGWVZaHnUAEgcbbkkfzTguZnTjk5iPpyw9jCadeljNPSglJaall62/Ad3ecSq1wdAAsdwFGGw7XHqkF6kIEssaVMgWt9j2+8dBOtfA1FlKW801T6BS3ZplxyZmqCoiSqZUk/wDMeGdm1ggpIGxO8c/ZKn/Nuol5ZPiuuHSg2sB9/aGQ8mQvIuUlG1gpGxs0Ftjr8+PRb2HcD1L+jjtZQ1MKpLM38n460HSXLatINrGw5jUndMw+Q0TpSLhR2/2Ic8vhadw1QHpMT85MS76/GcYKz4CHLWK0o4v794b7zDk4ytDaEOPFdtRVawHb3h48FzriRceiRRJrm1FQUQsK3T3vC/QZBxh1N2tGg6iVJ5PY29BG5h6hWmAooSVDvzb/AH6w4DTw46tKj5u1hGHS8FiOE7r2pCGJZpbr6dSlg2P33P6+sJ82845U0y6QFlkFzyjgq4v+UZ1ZD3jty7aCoJ3Kh3V6Qr4Yws6ynxFpJW6dSlHufX7e0JyOvunYW22XjTHXRMpbU0stDdQQrSpab72PYxPvVP1Gq6vJfB705hKjYeq+F6SmlPTsk84tVUbQAloLCtkpQlJA73Wd7WiL6ThZTkyVqNk3vbtffeHPLYdJlSVFDKVdj9R5/lC7qhwaYxsU0aSN8jJn6ube2/Hfx816ZJY6q+S2MKXiXDU89SK3SnC6xMIQFFtRCkq2IspKgSkg7EExaDH/AFsYTxbljVKli6kVTEGJ8RSMhSHJaXmRLy9OVLrUpyclk20IStJ2btYLB7EiKrv0V9QWWSClAuSogazvwPSN6nZbVWvlKn0JbZG6Un897RHHWSxAtB0KhrMLpql4mkFnDiDY2Bva41tdNfHbNGnsa1E4blKumirmFGQTPBtM0GbnT4gQNAV66do9HGkzdNbkl0insOtK1CaQV+OvnZQJ0kflEgS2WrbbykPEqKE3BaGxPvHlVMBzMsNbTbbiR67EekIyO4hPMsLAm9kz6HUJ6jTKfCceQpJ28FxTRP8A+u0T3lB1Z4/wK0+xIvVaZMk18whyXnFhSWxzqA8pANrk+b0BiJaBLyVPrhNTli+lhQcXLLJQmYSD5kkjcC3pvFtsPYBwZW5SRmaLTMEMUyqMf+loUp46phRvssOr8RSknuIYooXPu5rrEJDFJ2BoZJHmB4nZZSHxiMeZdMMs4hwpL4klphGoCbZ8QuD11pAIH3jOW+Ktk9mtNLl8VZb1nDbz+y5ukvInGgfUsOBJP/xN4eGCci8ONSjhep8u22hyzhmGkMIR7AKO49/yiXMPdA+Cc15Jlc7g+l1BlYBDiAhlah6pUOPsN4voaWseMucHoRf7XXGVcuDU5Mr4yzq1xb8r29VBtAy2ycz7WE4Wx1RBNvfRLulUk+knspt0ghX2Kk+0eVa6CM1sA1AO4aqjM7KueZBE34SvYG4CVX7EG0Sxm58GrKqYpc5OU2s1/B0xT5Zcy7Kvyq6kwlCRcrQkAubf2Df2ilaMwM5OlnD0pXsJYvq0/gKqzj8pS5tXiOylQ8E2WRLv/vWx9/QjmIqij7o/5iPzafsVPh2KCsB/w6e9tMsrefJwsCdCdLp+1DMjFmCZ40/MPDRmUJcLJXOS3hqChbZDoFlH7Qv0xWDMYSyBI19+jrVYfLz7XzbA42IPnSPsTDMp/wATqYx7h5uj5j4RksQyC1BalSE4qUDpFhr8NQKNQHpaEuYw1l/m894mAsSzNGqSraaNiJIZcJ28rMwnyr32AVa8JizTeJ2bodCrgsLxaoj7s826t/bzHmlLPLo//aVMVV2KBIzcqpN1VXDD5Jttu6ybn73BiqePcpanhxtyZpL4qko1uvQnRMN8X1I/vtx6RYrDeKsXZR4jclFTtQps7LEa0a9N+N9tlA/oYesxivC2bAC8WUoSFV4NYpKAxNHjd1k+R4dzwYnirGnR2nih1JPC24OdvTf0/CohhzE822QhyXUWwbggWVfbcf5RNPTn1PuZa1tdOny4vD9TUBMII3l1nh4D133HcRIecHRkt2gu17Dz8tiClDzPT1JQVlvj/wBRL/1jR9SLiK3Yvw9N0ENuLQlxkfS+3ZSVcdx6/wC+YatxCga9krS0rd6++lpzBU0/jnC7aXKNOWmJ1lgXQxqN/mEW/Adrj8JPoYq3h6pTM06p9tzQ432v9o6A9LWZaMZ0NWBq4UqbeSpFNdfRqQkkeaXXflCgTt3BI9IqT1a9Ms50x5srlm2XRQKwpb0gVb+BYjXLk9yi4IPdCkn1jIbmHVL98YpA15uFo07EstMeEFvh1RSNZt39BCyl0JQ262UqKlaQB+P7RHDs2ZVhIPh6SBbSLGN2WxmW5dtsEK0Cyd+YVfERoriGpB2UnSkwsqSoJ0rHr+GF/DuL2yssPJShfCSk3SsiGDhzEDtSo6ZlJccb+lS7fSodiePyjKXq7U06EqQtIvbUna/+sKugI1Voydrha6lJyshiXLzGxB3HFvf7xfros6il1LL+k1z5pSZmSWiQqmk7tuJP7p+36X9o5p06snw1trf1aU3QVHkekS90XZtPYSx3NyLiz+zq0x4bjV9tuFfcRNQymOQKlx6hbUUxHJfQ5lFmG3mbgaSqjZR4q0+HMJSfodT9Q+x5/OHQTv3vFK/hu55GaqZoMw8S3OJ8IXPDqR5T+Y2/OLqNgoFiY7yCTOwOXzdilGaaodFw4eCI7ngxkU27wd787xjqA42iVV6Mm+2xggCOTAtcX4g1DaBCECCsr1ECBCB5gJUCd4BVvAHlO8CEFJH3gXt7CDSB3EHYkbWH3gQgQm3rBE6UEkC0AKCeb7RoYlrUvh2izdTnZhErIU9hczMurNg22hJUpR+wBjBNhcrZrS4hoUJ9ePXnhToYypcrtbdRNVWbCkUylJcCXZ1YHJ/hbTtdX5DeOO2Kev7N7rQzSmKpN/NSFElkKemjJNlpuRkhY+GypQ3Wq+xFySIj/wCIP1B17rP6mK9jacnEfsqmTbUrTacpV/l5crIYQhPc2BWv1UoxYDBFFxmzgWUbpr9IwsicS2uYqc3oD/hAIIQy1+Ha9iBcg2McjLUe2vJefcGw59T/ADRfSuBdn6fs9SR2aDUv+N7v9OgJa3fQbEgXJ6aKYemHB+XWcuTE1KzGGZ0V0PtNTKpp91uYbbKWyl4LIAbBB4tckiG/n8hmn4VrCKKiek8J4TR4023IahKy4ASCp1w+ZajYgjgE3hh1rrVOW1cdkapVanQpdsXlZmVlCpM4qw1rWtQusnt6E+0Q5iXradquW+J8KJrtSVS8UtOy83KybAT46HNIKio/Sogfrf1hOqnje0RtG3IeivMOw6qjmdUl17kEBziQLnW3W23JVi6g+tWv4vxu27J1Z1inyLg+SYbWfBlUp02SEjY7AAk8xLfRVjHE2f8Ai+s4xx4pMzhBhaWVTCGwyX5oaf3bI4ISANduLiHFlP8AC6yUxblFJYqrNbxM3UZi6kUQ1+XYembKA8Ox8ybjv7w6898yKLkhllTJOSw/TsF0mjsiXptMbmkzcws6R5lpTcXNzdZ3UdzCkkDYYsx1KvabFJqus7qO7Wg2NtNOnTqFcnKjMbLDJfClXXIVaVTUXpdC2Uy0v4rtTUbXStav6tAuBYc8w6//ABsozOmXruFl4TU60kCfSkzEm2tQBCXUbiygeRv3McN6v1F4tzDxQmRw2xUJlxbl0Ny6FOKH9pRG1vvsIlec67s4sHGSpVMo06JmnS3gtM1IlSHRpt9KzpKgSSDvzDFM6dzBdlh/N7/ZUWK4bSNlc8TFzjuSTfbS1t/MFWX69K1TKZiFEumpUmRXWZFbEu0zNIXKFYc1JCCONQJO9vSKy4Ny5VJ1FTjvkXa3m9P8vtFUs+87sw58SrmKaLM0qWmphbjbr8p4SX1g+YJV9O3oOIdOVHVNiXCFPZbanGZuTAFmJxHjIA9AeR+sOQsMTf1Gqukqo6h5ZDJfKBe4t9VZ3FUoqVa8oUmWHlcctwPS/p7QxcZTKGkJnG5ZlSWAllqXZGkFPoD3Pe8b+HOpE51ZfTuHZeQUxV0uicEtLjxEzAGxUjv5eSD2hVx3hOTwvUpOnpdQ8iXlkLLqSFJU4RdRuObE2jSR5ve2i3bCCA0HVN7Dc4XXlBsDcX1HsPX/AAhdlaYt1xRDykqX9Xv/AKRr4Ny2qOIJ11dMZWpKTdRUdKE87X/nEhUrJKYlXVuLmlLb2CvLpse4HqkQnI4DVNwwu4pBomH1rWFeG2Q3yPX2hxyFImJlpttqWS0tdysFVwnn+XELkrhZunNpQ2UpCTa1x/vf+Ub0nIIZeWkLK3OAq1h349v8oSfMVYMgFkdHwqZKmr8VYcdCSUhOwvv/ALvC7QsMGYQi8qtxTuwJGw53v6QclL/IjW4StShqseTzv7CFqQxYpRLKleC2g2UON99/tCxnF1sY3W0W3TcDsSzpSW2y4ne4F7Hfg+kbUnMNmrLk0upbLaSdVuft7R6zEwJiTUVzC1KJ0toQoJSjm5tHhM0pDaPEROSzi2xqSd0q78e3YRo55KjDf7kcw2wagptlxBca+o3Gx32948Kj4iWwhkJ8TlWq2w32jSaw7LzqlzC1sBalEBAcOvve4/xjfl8JNOPtJSEIClBJcKjpbBO6j3KQNzERKnbGBuV5y2RFazMo85M0unGZXIDW7peQlxsb3sCfN+UI9NylxlgOoSyjTHEMzCg6hE3KOtlzn6VoGtCjxcQ9E0aXptQbZlZ9Dh8UIVOMqV4ei9taUjcpAuTeLB5VU/GNDxYljBOZdCxWW2S8w2Z4y7zShwENugi99rd4apmNcRYG/S3yGiq66sfACbix5ggebgCB5hQfOZT1XN1xmTYxdR6XXVrShFErNVfl3kj0b8ZIS4n0JtEx4XyV6hOkhUo7I4rZVKzbfjN067lUYeAFylxSAUt7fi9OIkN/qzzWy1rT7ONcqabi+YlrFypVCnoaMo3/AG30JLYT73hSxl8SiqZc0hqap+WFBnG6m0HVTFPqq35Rsj8Kij6regHtFzE6kZdz3ua7wcD6a/VcpV1WLzZYooGSRnhmY4HwJsR5tuoPxl8VSs4ipz+C8U1EZe18zba2qkqovfs8EEWDbyP3rA767FJ4IiMqRgaazNxlUpaUxLLYhaw6XZh+bkUzFZpyWn1a3FIdSBZS1HdNhY3MP2i9UWHuqfNaSpmZuF8pZNioveGur1CgrCW0EjS1qQQUk8Aq29YkXqH+HPgjBU5S6blZibEGXbeL2nHZpVCnFLpMw22kEqcSk+Xa9gDwY3iLqpnetfnaDbkfRbufBhsgpnxdy94J0GZvU3tfa+mq564wwfNs4tqVNRLompyUcUXGJey0hIsbo9gCB67QgU7EYpq/DmPGQtBGjy9xbYpPBifsJdPUrlhjJuYlpuSxKuSmplrxMRTBplOLKWhaaStBK1LK/pSeSIhrHlVoi0EvS8/MP2Op/Y67EeYK/wB3EVL6c73XXRVoccrRewGv7J7YV6gKjRcKyc3iGQFVoLzipaWcW6C6CkDUgH6k6QbgnYmFGWzCo+I3lKkZp9DII8JEwkB1I2sFW5+8V9qOIB4RQ1ctixAUjSona3tCfSceuU5w3ZspO1go2Rxv7QGM2W8LgDc8VaihZh17Laqs1Sj1B6UdG+tlywcTtseyh6gw+UVHAPU02WKmqnYCxi/5TUUS96XU3DbaaYH0FX/cRYiKo4PzimXC3Ku3dZUbjV9IO1wr/AwtztVZrfmZV4Kztur+Rt6esSxSujS9VRxT6nQ8xv8Av5qRsb5ETmQeKmJPEkk5h6YmFBVPm21/M0yoWI0rlZlOxN9whVlQ7c/8t0dUWRKpSYWzMVhppKpeaAHkmUXDTnqAVXQr2X/ZENvJrqWquCcPPYaxRLS2LMFzZAmKXUQH2dO26e6FAcKSQYnDAWW1HouF3sS5fzc1izAUwk/P0tSvGq+G7gBSVJ5fYA4WPMm294taeZkh00XMYhBJAAZdeRG3ny+i4x1isTMrWJiQnW3JaZkXlsTDKxZTS0qspJ9wRGKS4H/FQrW0rYj094nL4oGAaVgzPFnEVOUytnEyD8wpu2l19FrPAD/uI0k/2tV4gSjz6azNS0pKJW/NTFkIl2AXXlk8BKE3UT9hDUjbjMEtBLlOVx1T1y3x5OUeVqEmzMLTLT6UtzTHKHQDdKreo9RvDqaqDbyhpukEbpPb7RHVGpsw1WUtoaWzMsr0LSsaFJPdKkncH7w+ZSnKlWru2uoaiE7/AJwqQBoVdQSO3CWUOhxAsdzzfgw4cA1KYwzV5WcbdBVLuBaTeGZOT/7NkkLWdKAbRlSsaD9sMyy0Wl3k3DgP0qhMtN7tTxlaW2dxXUDokz7CK7IVSWUGlJWgqF/pUN/847C4UrqMUUCQqLRBbnpdD6bcDUL2/W8fPL0b4hdptXILhLKiFEX+k3tf9bR3B6E8zE46yJlWFOBUzRHTKOC9yAfMk/zMdVhU5e2xXivbfDxFJ3jeB+RU3EgcARja3IsYxSdQBH84NaSOTtFuvP0FG44t9oM2AuYJKrE2AMAkkiBCGr2MCDgQIWNz7QaTq9oJQsRYQYTYbwIRhNueYA3O4vAKiIJYCefzgQjc0oSfeKPfGXzAx7iTLCnZSZVU2p1rFOM3ddUTKjwmZKni4u++qyGULXa9zcpSocGLC9QHWDhbI2kuF2aaqFSN0tSzSxpCvRSuB9hHKHrL+LBiDMKtVKlYdmy2XFlM3Nt+VlvtoSPxkcXN7dorsQnj7sxvO/Lddp2PwqrdWMq4mCzDcZhpfgbcbHXxCT8tPh9YI6fZ1M/mjmO1XKy2UuGjYeIZk2ljSbOzbl1OWO1m02v3iUqn1o5ZZfU4SVKpFLbnGgEobYlTOPHixU45e0c88SZiVWsTJmnp91Tx+p+Yf/fOXtcAngfYQ/8ApMyPrvUZmbTcOUNtsO1BRccm3tmZRhNi5MPKv/VpHrybDvFHE8A5IG2XrVbA996jEJi+2p4DyA0+6tJO5o/+cVIwzIYKTXXX7EsPMoV8uNvOpYA8JPveNGh/DBwZlzMuVrFbFPTSWBreenqm43TZZWx0ISn95MK7aRtfvEkT/VtlD0C4MnMIYBlji6sJVon6g4oIbnnxbUXFpuVtg/ShOwt3iuOOcz80etWuJnUUXENaZbOmXZkZFYlJRO1kpvZI5G8TyOYCBbM/5KCgjrJAXH9GDqbOPkdv5ul/HOcmUmXUi5S8E5c4eml30KrE/KXdWRbdCVE2TsLRBmOa/TMd1NmanJddNmWFXUZRtvS+NtlJII3GwtxD5w30oYsxXiAyKprBlPnEq8Mys7iOXE1r28nhJUVatxtHvU+iTMN1EyiXwzPTapE/v0tpuprixUCdgexiJ1J3gu8XXQQ41DS3jgeG9SdfUn9lFmEqTh6k1R0s1DEuHmZogLVJNsqAG3YC5EODGuRWGq3hyZqTGYs3iJxhHifITKUoedt+EA8kem0NSv4Zq2Gqq7KTclMyzsuopdC0eYkcp9IwTOsqebClIYKBe9/qH2v+W3MbtaxoygLWaaSU5y76aqBs38QopVRYDFNl6tQ2FpdXR6oozkm6sC2rSogp9tJG/MQFMUX9pViY/o+iZmkeZ5UgtsIm5YE3IShJstI7FF7DmLIZwYLdk6g/NSyVvU58le+5YvyD7ehiCsX4OdEymblVuMTDC9bbrKy2ttQ7pUNwfcRpHJrlelsQoMwE1Nobeq1sr6+/TsUtOMPvy76dQS42strQeDuNx3BEW8yFw67m1l5My0kyZio4cd+YbbBGpyWc2WkepSoA/aKTMVtNLemJioPzX7Y8YOJdUAW5pB+vURayxzfg794mbKTNKpYcErU6NUZiSmmzqQ8wvSpH+Y9jtC9W3Kei2wmXO0tIs8K8s8JfLKly0mUpR4UolSQB5XHlDcn1IEICccLnnfCKrD1/XaN/p7zupvVbh+bwjik02SxepvXTn0kMoqigCdAvsh4c24XxDLzDoE5ltMpTMNPN3cU1daSm6wSCCOx/vipmiJ94bK9gnGsbtCPmlmYxQ0xNrQpY25tvbn9YWpGuszgC0oCU8BWq+rnf7RDMxXZlaXLKUQ6SAhIuVHe9/tDzwrUXGw20pCNKGwbk+YqTchQP8NzYp4IhZ8N27pgS62spBfrRRNB3xNegjUk+gvt9o8Xqo5M+IptJdKrkBRsL79/tCVIeGoEOBJWCTYq7b9vSFNuopTc6AAkEaU9udv8AfEI5HDgpc4WzK19ySbU44uzTaQQL3082Hv6wvyWOJTS2FrIUFXNk3CBvv7xHtfqgS2UOlLDSllZ0+YA+8YNYjlJZkIQ6Fnsb8c7+8ahjtyhxa7RS3NYglFTBU20wAeFtixPPPpDjy4y+xDmaZ56ky4eYk29byi6htCU77JKiNRJ7CIVkcRSqZMh2bLFxYEbk8/yhTqWZNSpNMYZkJpbnhA6HPCBsd/oHpz2iWMNv7+ygmZLltCbHmdfwrlZI9CtfqM6Jyry00yxL2cMswwiYdnE7nSnzBJHY2O0LmcWQWWtDq0rL+FiDLipuq/cz1ZpTqJTxje13UKOlX9obARQmTzDzexPOMIoqccT7rCdLAkGZhxTKRf6NAsBzChhLrwzdwzKzdOmsX1ubp9y1MyVSCZxtJBIUlTbqSUm/PpFuHUjYspjOvE6/j5KgkocQfP3gnGnAXbb/AOgfMK5w6B878wsO1CmU7NOj1nDkyrS4w1X3XZaZSeAtJud/4TzEMZn/AAy848nJtuamac58i2NKZ6nzanpVgeiko3R+loj/AA58QjF2Dq0zVKUqnUuqFID7krL+C056FTQOkk8biJQrvxo80TRpOWpE9LUqcS0ETU2tlM064u+5aSbBAt2N4hLMPkb+oHgjrf6ot2ggfanMTmHcFuU+N239beSifFPTXjrD1BNSco0zOSSidUzJkPpV6k23+9xGngnqGxNl9JIkJKo1CSQzcBouKAbuLKsk8XG1rQ68QfFAzNxDOvOGpSMs662GlzErTmmHpkjl1wjZS/W3I2huSOY05ndLuSb2H01rEE26HET7DClTiwLXAQgWP6Qq5kLDencf54K5hNVJH/n2Nt0N7eNwP5wWtUcyZqtUmYadmlJEy8h55pSElLikiyTuNrD0tzDYq1YcmkqSqTl3Sd1a0Ai+249IlrCnRlmJjhkuU3BleWhtJUS5LFqwFiTZW8Md/AFQamJn/lJkIkzZ4+Gbsb28/pc7C8TN7wAEgoEtM4lrHAkb2I0Uavy9LqrS2pilmXmADocaOgki2xSfKoH1HENWcwsyp79wUzCiL6VDS4kbc+sTO/hAzZs5LIsBueSr8oRKrgCXYSVtHS5e9lDZPG+qNxIeKHMadAooRJTFMlCuXaSVI5ChsBt/v843sMYxamE+C+2lh4G1wbJ7b+1oc1dpExIJKlIuTuVIG47XMMWfopdmVLCxcK5HrtvGSQ4LVt26p1TdRdlFN6bjfz2O1trKH+UOrJ/NvFGT+Mmaph2fckZpCgo6F2D3HlIva5/QiGDRKxpYSzMKCtAASSb/AGt3hyUpMuvwyldt7279uDGrbt2Urmse2zhcKauoHp3wH8VXCCDT5+Ty1zmp6Ctlp/yUTEayOFgf1DqjsHE7X+oRX2jVPG+SleksN1bCtGy4xdgSaaCZekUdqmz7Mw2AlEyZg61PaxchYOhWq8PCTrzsg8lxJKSwoLafbVZabWsYmdrM7DnV1gmUwdmjNJpNcpaPDwzjhprxJikKPDE0Bu9KKNgRyjkWi1pq/TJJp1XLVeDdxIZ4BmbxbuR4cx035clG9SzirmLMbUvFGMMM4Ox42mZXMzEvVqM2z+0CqwW268xpKlA3t6H1iIM+5mRx3mPUqph/BdKwXS5hy7VMprji5eWFrWCl7k+sSzijKTFfTxjH+iuOpMyS5hAmJOclX/GkKqwfpmJZ3hxtX6pOxhZby9lvDTMAsuNKA32UlQPtDUjyRlcsU8cNhNFytptbw2VSa/l7PTbKEvIIb5ABBSf9Y0kZdOSag60tSCkWtyD7feLkYr6bW6zRKdN0llktTwWhy7yW/BeT/wBPfbzDcRBeKsAzeFqw41MyrsupGxbcFtuxhVwI0TcT43G/Fb3SVjlWEseyjNSaeXTHlfLTL6UkhhK/KFqPaxI3jsx8MKYqWFMe13D9TuFztKamm1A3bmC0vT4iDwQUKBjjbk9mO/ljilNRk0MqV9ExLPthbcwjuhaTykx1++G9ntg/MWXo1SoyxS3ZFKpd+mur1plgsWUltR30330niLbC3tBy31XEdtKZ7oXSBtxa1/mFfBtPktGQ8psRGDbl7EEEEXBHBjJV18bx0a8XQVtsBBWIPf8AODtpHoYO1x3MCEWsQIOBAhADf2gXueNoBItvEedRnUphzprwQurV2YQHXAUycoFgOTSx6DskdzGHODRcqSKF8rxHGLk8E8cUYrkMG0lydqEyiXYR3UfMs/wpHcxSbqh+JCJ01WnUSYRIUynDTNzAVwf4VLHKv7KfzMQ/1SdatRrmE5nFOKJ92nSDwLVPpsudLjurhIHa47823jm5nl1E1XNFSZKXKadSGVksybCrJUrutZ5Uff1inrMRt7rF6P2d7H94e9qNfoPyU7eqzrUrOPK9NU+lzjqzMktOP6v6lH/bQAfqPdX3iGJaZclGQNQUvlKSLkn+I+n+MIFL8WWny80kOqOyCrj0vztEx9OmQdfzyxCJeSSw22El6ZnJlYbl5ZpP1uurvZLaRFOcz3cyvT2RRU0Vm+6Am/k/kzV8+syqPhuiyL1VrNafDMsym1z3UpSjshCRcqWdkgHeLKZv5qYF6MMI1HAmD0MY2xVMaWa/XVzLrNNSUWvKyyEEKW0lV9Sif3hF7WtDbzj6j8J5F4LmMu8mppyeqdSb8DEeLktFMzVU7apZk/8ARlQfQgrsLk8RTvFucCcMt+LKvOzVdQ6FNum3hSSk23F7har+uwtG7nmMZGb8T9gp6Ki793tNUCGDZuxJ/ud05DzPITU31TYqp7cs6DQKY2t9KF06k0+Wl5ltoFOpS3XgtTZI+nY3O5ib8P8AWbkpK4VmXa3Vs/pupFpCpOlOVxh6modASSHvC0hbSiLEBI2BjnDN43mq5VnZ2deW9OzThcddcN1OqO5KvWHJlzSKtmpjOj4doMjM1auVybbkpCTYTqdmnlmyUAX/AL9gASdhEbZZGGzdfmrKajo6huaW7QNbg29V0wp3xa+nzAOOZFzDuVcxSac+wlmanJOkMMTkksFOlcsglalqPBJ8xtcRZGnpxD1UdR9dpWEsVSuHncF0+URMV2qLW3KSTky2lxDCZNRHzM2Ef1ninQ3qG19o5MZfUGXyVzweoWIZp3CuI6RPrp83V0Sn7Rew8tslL62GE3S5MXGhtZ8qVKv7hfzCzmmcUU+SpyVut0SjOOppzTznizCC4sLW++7fU/MuqGtxxZJubCwAh2PEHZf1Oew0+i56q7MRPk/yTre78Ru/c6HXQ6aWvsbngD0s6g8wMj8oaE1RMe16azIx7TkFufawVJop0ite2kuX1IQ562VvvtHO7G0/J4rxtVJ2m0GfplOmX1LlZVaVvfLN9kldgCffiJM6a+rPGeBaOwulYQwpU00xr91VKlTNTEmmwBX4jyw1q7kg79hCfnd1Y45zQn0tVnGr1cYeTqcYpcyGJFgH/phDSUpNvTzD3jE84kFx6W+53U2F4VJSvMd83Ml30Y0Wb6qHK9RHJ5tbZBU06ClSe5B2N94jesZJrUlxhkKW2BdII3A9/t/OLj9P3SZj3P6nqqWHsEVau0pCi2ubSUy0nqHILyyE3HfeGNm1guUlZt+STJrln5BxbT6S8F2Wk2KSQbab7XEIGR1xpurjPDmLGOBLdwCLjxCoZm5lDMNU97w0AuouUgdzD6OVJysyww6+g0+alq+0J6QqMpNh9M4gDS+0tN7tOtOEBTagCNjwYkPNnBiETbrCg4ydAKW3CFGxHqIh0Ln8v5qcaLHzNKqJtNSpAuFcJdbP4XU/oobKvDUeV7e7kVNWNkjkFTTC/Mcx06rZnKs9SVszLbxQUqBBCtJSRwQb3HHIiyGTPVPI49w8/hrM+ZnZymTiAGawhPizdOcFwlxXdxI4/iA33iqWJ0JlUy7hmRNys0nxWHwNIdTcgm3Yg7EdjDiwBiWXS18vsVjdKrwtKzJsp4arvjqdCrrS/SjPSdPfnJOsU2qy8w2HpBcqrUl9mx89/RQ7cg8w1pWRVSnlBepCmiQQr8PO0NLJLqorOVdIDMitqcpiVnxpJ4+UDe5bP4FHk9j6RJGPMUU3MemNYnoDodlZryTrRTZ2Td9HE9h2CuDCE8bXDM3Qq1ppXMdlk1B2KSJeamXXnVpaAWblJJtbn+UejFbmpFpwzDqErvf90b2Tv+sIapx2WmkJUspbJ8wJ+/P27xKnTj06VrqmzWpuFcOIR81UVklx02blmxfW6q2+hI7DfjvEEMBe4MaLkpmoqY4mOllNmgXJ6KNa/W0TcipbKytXBC9j359vWGw/U3EpILqUpTe1j9PP8o6W56fBmy76ecppvFGPc33MPUynn/mZ39mAhZKTpbZbKtTril7Acke8coq9jeTZqL3guKdbS4oIKk2UpNzYkX227diYnq8NkgID7aqswvHaPEGufSuJA0vYgeRI1+ydKq7OKGlLidSfXtz/ALtE6dGHVvN9Oub9Hq9UZNQoaF+HUWGZZh51yXJ83hh4FII57GwIEVeZxY2+olLvlHAvxC7QK63PzDbbj6JdKlgKdcvoa/tG29h9oUZnjeHs3Cs5WQzxOhm1a4WK+gTK7rEyj6k8Jz0nhDGApk8U6jSH5kUGdU4VaWVI2BCFL2BFwYrn8QTpdwXK4XmqvX8KYxpVXRKBblaw/TG5yVcmiVFQnHAbOb2CllKbFV945QSuOJilTLDzE14LkqnxGVBV1MLB2Ug3ulV9wRvxC7I9WeO5fClUorWMcSs0isEifk/2i4Wpsk3PiBSje53O+/eLqbGRNHkmjBPy9D+VxVN2LNFUCSinIbfY7/8AsND5tSZil5qWrcyhhDjSW3ShqX8b5hSAPwlyw1Hve0eElWbPhtQIWfpB2H5GEp6vuTcwQoha1WAKOfsN+I83KsHFOJc0oQk2Cr3sRtf9Y51zC4rvGPDeKdTNYalp9Lbu3BUnjT6RYrJ3OHJTAmDsOvVaWzZw7jWnPqdmMR4UrTSHJkE7ISyojQkJIva58p5vaKmy86kvpPiDSgHUo7EflHmmspJUFrHh8hSuEj1/0jancYXZgAfEXWKuNlTHke4gdDb15jobhdS8uvjZYUyXm6hJCSqGYszOlv5WtTClyM7MtpCQluZQ4SkOJHKm7JUe0Hhvq+yd6i8wJqt49S9gGrV6U+TmpVyTWinPLC0lmZUtP8OwNwL8xynq06uqEBNg4kgpJO3bn0hzYfxe69T2W3Zp5Skp0/vnS5o+xJ2HtDrsUqLAGxaOBH8Kom9lsMzPfGHMe4WzA6+h930A6K5PUxKYaXmrWXMGVeSrFBaftLuyadLIFk3CN/MkE8/aIxqNSTM0pfiNJU8mxQ6k2UkbfV6iIVbxZO0JhUvLzTzTEwpKlBCrAEcfb8oX8P5nvSrfhLKXQO61bp4794SfNncTa11cw0ndxtjvewAudz4p2S7jcw4tCkaV2B397X+8Neu0ZiVmlobZQ6fq0kd9oUqdiWWqaydRbdSdhbZXt7RtVGTS+wFpF1DcEc/6xljgpnMsFGtfkGnEJWlvw1oVcWPHH6xpU7EKg+ppL7ilpt5DvbjiHDiWTdff0BIKHNwonTv6f6QzqphxyVR80CW3lGwF9z/OJ2pa+UpxiqzMo2herxQo3UkH6feF/C+JAXBqAQBvqHKfy9Ii6UqtQlR4illZB/XjYRv0rGAqM+Gyko2socAmMuZcIbMAVezp0ztwrnZgFrKLMt3/APBuu66BVxYzGHJs8KbUf+mo/UjgxGmfGU9e6Z8YTGHa5JBTzQ8WVnJd0/L1Bg/S+0eCgjkfhNwYgXDWIizPpbKzdJ8hvt/fzF2un7PXDHUllwxltmq86iXYNqNX27Gbobp2CgT9bRNtSDsR6HeGqeUECKQ2PA/YqixCmfTPNXTi7Dq5o/8ApvXmOO++8U5KZ5t00Lp1Vl0Lp05Ztzxk60+xPoR2IiW8a9MCM0sMszFMdl6m1p1NEqHigHsD3HsYjDNrp7rXTRmE/hvFbEuUuJ8eQqLBK5KryyvomGVfwna6eUnaHJlRmHVMmKq29LPqepi7KXLuLukp9R6f3w5Gcpyyf9JOd4lYJqUjXXoVFuK+jSpyc46ptPnav5VCy0fcc/peEzLDGmJ+m/GaZiScmZB1KtJIupDg9D/rF5p7ElBzxw187IOy6JsJtdVrA/wuDkD0IiCMy8qFVuZ0uqmJCYbuAHklbBPql0bj872iYxAEOYUnFVmUGKceIKuv0FfE9kcwJJiiYjV4M02AkhSrlI/iT6j1HaLy0+os1OTbfYdbeYfSFtrQbhQPBjgJhim1nBGLm1rSW5mVXcLRa9t9wR9V46b/AA/urBNQlJWhVScQpiZslpTiv6pztYngE7H3i5oqwmzHrzrtP2aZHeppNuI/CuWEkD7wLW72jFt6w35g9Y4Ii2XnyECCt7QIEKP+pTqGoPTLlJVMW4heQiSkGz4TOqy5p0jytp9yeT2F44xznVRX+urPSu5hYimFjB+GCfBTuJUKTulpsX3SkbqPeHH8efqlrXUb1IUnJnCLzi6fT5kSj6mlXCnNvFWftxfsAYhXqsxbTsjcjsO5Z4aKGWZlvVMuN2C3207KVzuVr7+gtHN11UXvP9rfmV7N2ZwFlLSsJH60ouT/AGt5DqRv18FDPUV1LVTO3FsxMzE24xRZFxSJNm+wBIBVa+6jYW9BEeN1b51IBJAXsok729Oe8KWEMtqhmbihuQpko5PzKzYJb+hA23KuAB3J/KL69Jnwt6LhyiqxfmDNysnRqQ183MzUwrTLsITY3APP3Vz2BhSGF0x0XW1dZBQRgOOg2A3Pgoe6NugqpZ0yb1Zq6BJUSUb+ZmX5pzwJWUaFiXHl/wAIHCRuY8uqvqtw7TMDrysytlzLYfL6U1asqSUzFfcSbJTa90y4O6Ufi2J3ja65/iDO5uU9WAsv2F4dy2pqyEtJ8j1YUnbxnyN9J5SjsOfamMxmxPYFq7VQos2uTq8o6l6WnUW8WUWkgpWi9wF3GyrbdoJHsb+nGfEp/DMNqJj7ZXC1tWs4DkXcz9PFTB1qYFpXTdgfDDUjil5rFVdad/beF1slM5REI0BCpty/ldeJKgxYFCNF94qVN4gXOvakKJJ+oE3v7RjjbFE/iytTU9UJyZnJ+deW/MzEw6p1x9xZ1LWtSiSpSiSSo7kmEVWqWsAPq3G8aNiG4TtRXkARk35nT7cBsNzbckpdokpPYmxDKyMk0uZnppfhtNA7qNrkc2AABJPoDEu9J3TVmd1JVesTeXdHqE3/AEVknZ6fqTEx8m3Tm0tkk+OVJAcKQrSlJ1EXtEPYcVNoZdmmQQsD5ZDl7AKcSQRe/dOr8iY6N9JXU1gPA2U8vl1WaPPVXBGHFqqVIEhMmmzNUq5b0uTU8b/vWVFZCWz9CEADvDkDIybSGypaqoqWtLqYZum/jpcX8LjmomzJx5TZ2jyFAoJden8RS8jOYnrE2ypuZqs7pSlDA1lSm5dom5Ug/vFKKlcAQgP5b1iTmZxpUpMTP7PuZh2XbU4ylAIT4hI4QT+IgAxZlfxNsP5V1wHB2AMNVudVKolVYkr8olVVm3f3Z/dhPlZbQU2QkdgLmEao5wV/OCgYnnZd11UhW3WZ/Es+9ZqVU82lOlDigoJKEqUT8uncqsSIiqmxNbcOueg6fzVWGHy1JNu6DW6audqbkcANNNh4CwUH0iWbkHVMTzjzol2gvTMrU8iUG2+i5Sgelt4XaNMSMxLfNqnEfLtqAUpBAUniwO/lB7EiHnU1oq2F5Sv0NMgnBWGngapIvOIExNPI0KWqYBILynwToSDZKRYAWhpZdY+wbWMU1KtyE3J4cnnJhT0jRXGCuQ8JRH7vxVBbYtc3Dw0Adwd4TizEXdx+ivZHtN8g1HqDyP1PJW9rHVVhfFnS5hXBGVmD6zQMQGqIbnvGrPiS8y3o3u4XEoV4ityNI0xEmOsDYgy2r6UZiUCoUJM4kGXeKf8AlXza+lLySUEeoveFKlZXYbzOwO88qi0ilzKk625/D5MvLqXa+lyWcKmXN+FMr097w7ME4Vx9Usg8R4On5z9lUCtywkmFV+Z8ZCAFXJYQQVtqVawXuADsYa7tj35nHhpb8LnDCKeMin4k5g4kuN+Idc7ciFWnONFGnqYxOSDrDwYeLGgTAccQlVyBe97g+1gO8QLmN8tNyzhWpsKR3G35c8xN+MuhzHLdUcckaRT51DGyfkak0+pdr8ea527cwyk9OuMmp92XVhGpF22kh2VJ0fa+0LPlObZWsEDRGbOCqZmHWZxmnql5cpVIJeMwUFI1IXaxUk8gEbEcGw7iHZ/4M4ywXg2kVmdpM8witSJqUtLraUH3JW9g+Ei58MnvttEo44yKqeFqisVehz8i4bkfMSim7n72taPSgUyq0SSD9Nqc/SXkBSErlplTSgDyLg/SfTvDPtEZGVwXNz4NVd6ZYXDXgoewvmY/KKUnVpCrpueBEs5SZnzGHZ5MzKzBa8UFtYNlIdG90rSdlJ9j9xEbY7wq4qqPPTQ1zTiioupAQpw/2rbX94TMOVtzDztlE6L735SYiniD23Yp6GZ8Und1IVynatI4uo7c3KqQh5gXeY1X8Mb+YeqT/KJDyH6hqxkXXDUKPiau4Xb8IqnZqjNsrnloTfS2gu3SApVgSdu9ja0VJwZmSZZ6TmGllBaWNW99STsoHf7w+80JmZoVHUhwlr5oeKzvcuNm+lV78HeKr34nBzTYrogIqhhieLgpz9cXxEMedW2KROYurb0+3IJLVPlLhDEkixB0oTZJWofU5a6vYWArK7iRwOlSgSr2G1t9ueIQscViaD673CtR39PbmGyziN+RnEgOrBVtub2vfmHooHP995uSqKpqY4AIYWhrG7ACwHkpVouIW33dKXNC17WPY/4w8KZPzMshKQ5Yq2BNtoinC76p6rKZmFIDgTqStNhqBv7xKNJaep7DZ/rA2m5cUe+/AvwIiqKctU1FWZxdbxmltqW47dXhmxHcn23gJdQ6r94hzm+hR7wo02maWwFtrS8seIdXKr8QH6SXHgEAqcSfpAv94rzobK3AuLlCSnFomraigp3Gk7ge3tG3MpVNyqU6dGlWpNtwox4tyTqp4lyXcQgJtqI2P+/5Rvy/gS02kJQEACytKrg/leNTmB1Wwy2Xi80kobJQFPgWJ9vf1jVfbShBTbWpQvY8o/nC8rwG0XRa6+5NgPzhKqjyZVWpyXDXhCxKTsoep3gtcrDnWCTQXkBCx4gTbSbb7enO8bck6kgJTZPYkH+6MnKcifUw4FLS4sXA1W2MZOy4aaCUtkFH1WO/5C8auHBbMN9UqydRQiW8MLDpTbUoHj+cbEvOsS7YSrW2VHkC94bjsu2h9DjZSoKA42AO3vG0Z5bygkmwT27iISxNxu01TgXW/kgn5dweIDsL7HjjeHRQcdKdQC4ocWtfftEZOuLW5qXqCQdlD8uI3ZSsOLQQpaGykC1rWPHMbAWW51UnPziJ+W8wQ6hwbpI1C+3a8Neq+OwjRMy4KL2QoK2PFrH1gYTqiKihKEJd+Z/EAd+3vxC3ONB9hGppK0BW9z9J2sYlY/gUvJFcXCY87Si0srUBa17g3HbiE5MqGXw7r/eE9+LflDxrdIcpSg+UF6VeAC992Dtvz9MJE7SG2GgpKAb8G9rf6RPm5pQsWpKzqkzPmOgIPA3Ah5YUxo7RptDiFrAFjqJ59xDMEuQkptY8n2g5SfeaUC0sgJPbcfeNXNBUjH20K6PdMvULSuqDKZjLDFa5Vyu01ZmcJT0zYhD1t5NSj+BwbC55tDTmMBUXH029RETyqHPoeWwZOfbDfyr6bhSNadjZWxCgPYxTHBWMpmhTTDjT623WFhaVJVY3BuDfsQYtjmLV15+5LjNiivFeJMOpblsaybeyphsWSzU0pHtZLtu4CoZilc8ZTqR8x+30VDU0UdLIXxmzHn/1cePg76+KjusVvF/S9mNMyriVSsxLn9405dTE232J/iSexG4iYMpOp7D2aLhl3ZlzDlaPMq4sLl5g+wOyvysYbZzDpPUXk/MSFYWlyvURrVJzKbF0ot9RN90j8XtYiKsYilHpCvOSkyn5V5hZBP4RbhQN72PO3Ihljy3Vuy0dTMnBbKLPHHmr6VPCMjiqZUZduUddTcOCXVqsfUoO9vcQmUioVPLOua5RP7tpWrQpe6hvun/IxUCj5t4oZlGJZjEM7Lpk3A6y7LL8N7bgKXypHsdosdlrnw3m/RUs1NbDdSb/AHTyxYJcVwF2vtf++Gopw42OhVbU4c6NtybhdYeiLqOYz4yvbDzl6rSkhp4KPnWjhKj7jgxNqQXBeOYPQLmZM5OZ9ScvMPH5CpH5d0KPKVbb78g2MdPmXdarbWPpHT0kuePXcLxbtHhzaSrIZ8LtQhoPtAjOx9DAhlUC4OOZfPU3G85W6ilJxnit8rddUbqp7C1alWP8Srnf0EQJi7Kur9V3UHVZyVeVKUORcRT2XbEhuXa8oCd/qWq597xaLHtLqdTxNXJxKtc4f3eq9ktLc2BvfYIT+kP3LDC2EOlDJpOJcSTDUrJSLYmFLXu7MuHcBKfxOK4QOw3Mc2IQd9gvc3V74zmbq46ABa+WWQeDOkDKFeKcVlmh0CnaS6VoC5meesClkJ5ceV2QNk8nvFP+sTr7xh1k4olMPUmUnaXhNqYSzSsPSZU8/Ouk2Qt7T/XPHskeVPb1hn9VvWBi7rczjlEiXnDTmHhI4eoEmFOlkLVZKUpH9Y+5+JXJ44EJOdWO6J0pYGdwjhifk6pmPWGVNYpxBKOhxqhtHZVJkHB+PkTMwk3UbtIOkLJglqLjK3Rv1XS4VhJiLampGeY7Dgwcz+dzsEy8ysYUTKXCeJMLztDbrGOHphtpFcarPiSNGZASXGmWmxpdfKroW6tZQiyglJPmiv0xW/mypQcC9R+n9P1jCt1YzSnFBSk2FlIBsO3A7ewhJamCgt3OhC9gedXHH++YijaHC6eq6pzHlrTvv+3Lw2RzSluoD10FGrSElXmP5ekCmU81GcAUSAsi9zsOOY8Uod8XWtvSlZslYN7jb35iYuj3pomuqPPuhYQFVlqHIz6y5O1FYKvlJdACnChAN3HSPKhA+pSgIZjhLnAM3VRLVsa0yS7DUpXoS5NrJmg4VTSksOmrP4geqS3LqqIW0hhlsJ7IbCF73N1LVe0bC0OSSlMpCg3pAsTYuJ225ib8QYYqPU11G0/B2HX5E0/Bcl+ymJqdUiTl/DaUUrfUBYN61W8lvqB7kwz8w8sahhGsTFIdlwpUq6UOKbGvxVAA3Cv4bb72iWeJ2a+4Gnot6WoiDLDRx1IvzUc01pt2uMJcfcl2nXW2XH0jUZZtSkhaki/mKUkkfYRL1SrLmMUIpcg84ihU50tU+UBKGUNiwS5ovbxVABS1nzKJ3MRRMUp9ydAQk3SeeP1h64cnX6MyhphDi5hZCEhIutSjayQPU+kVtSDbRXmFFrpC52yeOXTNS+TquGZZDjzdRnZWeccZQt9+T+X13UhtJN9YXpKrCwHIie6P0u5bZW4qdqVQU1J06YabeS4tlTj6HilKlJaknzoYav8AS49qVfgWMMLA+CJHJnAslibGdIqdU/banHJeSlqiJZjwUkoSqYKdSilToPlOi+gWJ3iLsys16jjyoqW/MLWFGwuTx2G5PGwBPAiOETEBmnmrCoiheTICQNdranQeotbb1Vj8QdW0lg51cvhVhDpQPDTUp1QfmCkdk8JbT6BKUgdojrFnVHP19/xJ2dmp2ZHYHj2vfYfaIZp7mhoqEwVE7bncn7X4j1Q0hhYuSG1HfuYabSnibpRskTNWt158VIzeejziwoOPS3bnYe1wbwoSmadRe/ernnbcpUFlQHtzuYaGHMEzeI2FBMs4pKBfYXCR7nsYX6r0/YiolCRVP2fUWJBZsiYWwtLK/svg/e8MCncPhCjdVxA2e4ap74fz6rEo0luZmvmpO9lMzAD7ffYpVcH7QeYOTGEc7dVWopZoNVUBrlEG0o4ux3Qb+Qk72OwiEK65UcOzay64hxKDp1tr1JPt7Roy+aE1RQVIm1t6iU+GCfP6jniNSzMLPF1GZWMOeM2Ka3UDl4cKYhnaXMJ0zMkstuj+E/r+Y9YhGdlwgvyqmVOPOqT8u4HQhIN90qB5BF7G4KSByLxbl6eoXUDKLptfmhTMRpZ00urlVm3VJB0sTQ7oI8qHB5kG17p2Fccy8ETuGarMyM3LOS85LqKHG1ghSTv/ALv3iNlojbgla2L2ttxo4JnUeoLpbxZK1aVH92b8cix3/KJ9zgk3pjDNEqUtcy05TZdY3vY6LHv/ABAwx8h8iKZm3U5in1KsLozcqyp5yYS34ypNvf8A5nwr3dZQf65KPOlKvESCEqBcGIMaLw5g6Xw5NzsjNroK3ZTxpZ4PMuALJCkLB8zatlJPoeITxCK2WRuxKmwGW8klNJo5o4pnUrL5OJ1OmYmWpYJSSA4CrxeRtvtaEHMrJ+n0ejtKk5tC5yWBLhSonx07787H/CFao5mS8nKqWSlqx5B2vv2v/sRHmKs25YmYUpTqyUlICexN+94bgGgsqrFsrA7OU7sH0uSZxG1UUzLc7KsMJDjaVeZJI5IvwLRNNOmpdIbWtvyKspB5HqPy9opvl3nKafPoY8AaElTbigvdxJPB37RYrKLNuRxJTmqS84hmdbOllTy9CXhvYA3+qJauLmqzA69jm+6eKl2n0pWIXVpS7pWN1Edh7e0PrCuBpKRklrmFNIITcr9Pt3tEf4dxInCjzrUwy426/wArWbJA9t+IcVFxlLPOMlmZS81MrKEEKvqUO3MVncsabrqW1JcMqceJKrhWl4OcIeW/MPq8NJ0aSFeg9vWIxfkpacccdbc0KT+G/wDrx/ONbOCfn5muNNgJSywNbWg7C/KjvDQqNTm30oQ3MLV6i4BH33hSb3ymoxkF7JyTjyi0paHPEUnYICvp/nGlNV911lLSgCk8eg/nxDfbxBMNTxlWm0rWRdakq2t6AXjZ+bUGC+lSUJSLpSo6tR94hEdluZQ7ZK66nMMBL4/eaRawPb/fMbXz4m5ZBSFb2UUKcsTxCApsvthRc0FdlKRfZXH849pubGhLgVa3Avxx7xq5tlu16V6hOqk1ByxQhwcFWo223B7/AHhOexMG1NFslLrY8xvfVuNxv+saVXqTraFWb1+IkBCir6B68wmsvIeaTrQdTRAKSrTcbXF+0ZDRZb5yNAnoJ1T8k08o31DUFji+3HtG62l0hKSlCSRqG/lPHvxDYlKg4WksurJSB+6A/wCnxsPz5hWw9U2Zy6JlBumyTc20cd7xjulk1BBsEvUqsTFKn0OyyvDBGlRHKhtccw65OrNzoQTpSki5Uncg+vMMuqMNSrKf+ZTYjVvcEccwdIqbi0eKyvUG+9/txEL2EJuKW5sVKNKfcdldkJXbay9goG3Pt7Q3MQ0p2hOBlwLRJvK/dO2v4V/wK/wMeWHcUF+WQpbhSdQsL7E7bcw+KY/LTci5LzreuWeG+9yg+ogjfpZyxNFpmao0qlMflwlSLG34r3Cv5948UOmU0qWlIJ30J7/nD0rmDl0xbaU3mJFf9W6k/wBX/OESbpCmH1MzCQmwu2r19om4JQWukdl8vBS/DU24pV9jcRLvSJn/ADmQeacnVEpRN02ZSZSpyT3mZnZVwaXG1g7EFJPPeIncllsTAIUtCEen98bEhNmSVdICu9+8aiQscC3daSwNlYWSC4I1U8dReXsp0hZ5SVYw+ubmMBYsaNTw48fOnwFbOyTm/LRNv/bY9oZebCqNidn5qmvOLQUeIz4v1oTY3bVv5rdj3Aia8jZlrrQ6W8RZTTzqP6SUlBq+FJlz6mphtJPhg82WAUkd7xTjDuNHZhxVNnw5J1CRcWw6w5tpWklK0c7KCgRFow5xnGx+RVFTuyOMMp95nHmOB/nG6Vn5xUuwl1pJCUHVzc//AFC1l5mKzQccy8wp9bcvNqCXGgdx69+x3hB+bU80hxPlSLpKL7H2+8aNZpDc5NsKl12mb6hp2tbvzGuzk45uZmivhldjNUzVpN5h9Tjks6mywdyO3eOx+UOJv6VZaUSom5XMSiNRPOoCx/ujhr0oTxfkae48o+Mf3bpP8Sdr/nzHa3pXcLuQmHlE3JYP6ajHVYe6/mF4924iaA0jcGykLxvYwIKBFovOVynq2XEhhxrEk1iOYSzR0TRmJsqVpHgsbq1G+ybjf14jmb1jdZtW6sc21fLh6Ww3Kv8Ay1FprYJskq0pWUj6nXNrfcARan40XVaJSYmMA0Z0MPVt0zVS8I2LctqJQ191nc+oEUTy6xpOZJz1MxpRZwSWJKXMmYkX/CQ4ZRQTYPJCrpKgT5SRcHcbiOXrJW3LBsF9FdmcLk7ptZKPfd8N9gOfnz5KcMxMaU/4f+SjuH6Iz4ee+LJZbGIKq8jTMYDkVpANPlL/AETryFfvnxu2hWhJCiYo/UKkp54K1pKDtoB8thbjfiFvGuNpnGVemZ6em5mdmJx1Tr00+tTjjq1HUpS1E3Uokkk8m8NWcSkLStLay0hV/dfG9vSFm5nAFwV7M9kOZsRJJ1J5n7AbAcB1uT4PvkzQdKvKTYA8njmNeclAhaVpNgdgL/3R7a0OpDhvpPGrkQGVMq1Akk9oYY2yp5nZt15ybS1LGkqUTxf8ouB0rYmn+lLp6reLKTWGpHH+PECjU6RVK6pmRpZsXZ3WogNeIsBLak+Y6SeLEofwysjcL5hZ9UKq4/kUv4Lp0ymYdYnG3WafV/DUnxGXZhIIbQkEEk+VRsgkao6kZgdAtI6nM3pjM2s4kl5OlzMsy2KVS2UTSES7TSEy7TzmoJQRqT5EJCSALARaUlO8t7xu/D8rm8TxGKN4gfct3J4Xvo38qL/gl9JlRGC6rjTEVLlJujYqUZZtVQYDwcQhSQVHzahqWom6R5lJT2vEyZhZWMTmZD+EsL0V+XqLtFeotOolXeblJd9lyynZ1UwP3i7BRCUk3ukb22iFOsvq1x/0K5/ZZUOlNSdKkaBhtjw5OWnlPyNVSXVIcUtBUNG4KQNyCLgw5GOvl7MaiTElW6T/AEhzHxHpl5GnUkfLyeGmRZaGwtJ1LdTcuOWuQEje0WDHxtHdclRPFVNIanQtdtY7cr+W+yrt1Z9Mcv0l0PDdEq83IvYqrrr1Tn5OUd8ZimyyCG2G1ObFThIUVbW3HMRRh6bQ1OFSJdtt5KQtcwVfvGEm3lSL2Ss/xcw+OuOqU9rMaiylIq8tiNFOorBmZ9hxa25uYcUpa1ErUVFQvYg2tbiItozz8vRkJc1Kdm1eO8onc9kp59N/zjna6MGc5dgvWuzchbQMdNq51yTa3Hkn5ndnfNZkSFLpbEqxR8PUKWTLSFNl1kttjlS1km7jilXJUe52tEVvM62y7ykeh3PtCxOKDxSFnzcAAG6o3qZh1plkOKR5lG2kn+X3jSMHdNVMoHuN0CbVPpDjul1bjjV1cJNtP3h6YewwuoVKXQtwqUtQAFrfnt2jycpyZd5LZSbrUAB6ev8ApDowbJFusNrYR4ikqF/T7HfiGYySbJBxGXQq3vS10wmq0dqo2cSZVSXGlI0nw1dlaTsv8xuftHQzCVbNOy6laZWaaK49M2lXUlltbTyFA3WpH0JQAbG1orX0hVlui4Fkp2fdDcq0zcptu2eNrHm/09uYwzN63Z7p7zdn5B+SdquH8SygnqGULCFSkwjyvyqiT9PDgHIF46qMMjYLryHG+/q6oxt1tspWzC+HRldmrQ0yKaBK0CWSVKbRTggNqUSbmx273N4ql1Bf8PlSZ1p6cwbjZUlNgKV8rUJUFtXJsFII3Pa+0XAyixJi6ToZxRi6ekZenVCVE2mVRcJkGrFQUo33Tptxc7w/8PZoUjG+G0T1CqMvMS8wbInFtqLHB3sq19hsbW4jd0ET/iaqmPFq+mdaOQkDzC4A9QnRZmH0wzLjlbpM2xKsuW+YKdCmwSrQtSQo2SrTdJBIMIlbx/K5z4dmxjtieqNbkKe3J0WqSrrbKpctq2TMJt+/b0XF7hQsLGO2/wAQDAtPzDy2ps2rCi8azFKdccapoKdD5U2q2sKPmAVe6QLgHtHKPqI+Hnj/AAI/KVQSlKVO4gS/OIodJUVuU5lOparpHlCQngXvsQd45zEqAtu6PZendmu0cdUxoqbNfw1t+/jwVZZ+Rcy5qTE1KNzbcwU+PKvqQ4wR9QDrZNtQPFxt2iJ8fSs5iPEk1MomkyZf83gloJZ1C/Gni/P6xafKzqQptMpruFs0qJUMwcJJYWxT21T6pepYbc3/AHsi6bhAvsppQLarcA7xFmbOBG6A6l5lp5ynTaVOyT7iAnx2iogEb2NrWNtrgxRkZRpqOq7Kdpmc4vblcNiOI+vjcKr+LZetUzUXWC42j8aF6023iOsRYvUoqRayuNzxE+44lC027pOhTqFAi/sf1EV4m8H1CtTbjrLDikKUdJ9dzFvRhjtSvLu1TqqKzICXF3mtCiVRUpUEr1cq3iYMIVJMwW9Sj5rWVDIwdkzOzNQaVUJCecktX7wS7iW3bexUCAfuIk6Tyb/oVloutqxBKqmpV1al0mZYU0/4AUA2ppwXS4s3JKCE2sSCYlqmtf8ACdVVdn3VNKD38ZynjbbxUmYPzimqTImnz4RVqdawZmDct+6Fcj+6JBwDmZJS8tLJlHkuhpR8KUfshaFG/wBLg2P35is0pjqWn2UrQpIt37gxu0rFHhLXpXqCvw34PYj3imdAeK9Dir2kAsKtpiCbGIqOy662uUnGgboJvpJ7E34iL1VVDindSfoUdwbd41csc2f2oGqfVJpaRp0tPKVfT6JV7e8beIKSZValAoSpKiFJvssE7EH0hKSIA3AVzFUOc3UrVl8TiUmioNlrQNtO9/8ASNmUronFnxEEj6ki/EIU9qlQVOkJSn3ufsPWMpOqtqCVlK023texEQlhWwm4XTgbmnX5hBTqSlStIN9h+cCdd/Zrvh3Jv3JsPzhIp2J22m5jVrSpRv6gfbeE97FallSQ4FNf20+Yfa8a5CStjKAN0tTdTUXLuBQUfMTwbbe/EZ/OKWUEKuAANu5hEXOmYkyUuBThSBudxxb8o1pWqGT0rbdLak7kHcHjYiDKVsJQNynSzWFU9woCytYHfkcc772g6nmG/KuyxAHgr30k8L2v3vvGlLVduopQ54TabWuQb/y7iNWq1Fbhbca8Pw9elY0hSrWFjvGWtudVrLLZuhUgYexm1XqUNZueCCd08Q78M1OmTMohoyqUKRsVJVpvx29Yh+g1lFJShKkhvWdhpNlHbiHdRqolpZcR5nXFXWdVt/bfiNXiynp6jNoVKLuGJd1hp+WcIKSFaCrzdtxCjRMQLU0Gn1J1tnSAD/Mbw0sP4ktKqeTqXotcJ5F425SuszLiEMoabeUblX4VnbY78whPGfiYr2mkb8LtQpQpc4iYkfEbfSNPlcaPf35jDEmF/naaFJbKmkp1BaN7ff2hk0PEzcutdtSVg6Vt3upB/WJFy/xg7LzSHWVIdCPrRpK0kdwoC+33jWOW/wAS1qKR1i6PVRbWEfKvJKl608D1EaraUzhCVeUJ3SoHg+vMTljTJSRxzgmtYkw0w6pWHmRUKrII85YlVK0qmG+5ShVtY7A3iCVzLDSnNDiXUceU8f77Qw9htmA3VTHUC5YdxuFIHT3mbO5R5o0isSrpl3pKZS5cdxfcc8H0ha+J9lFT8u+oCUxzQkIbwpmvLCtyakfTLTgATNs82uFWXb3MQrOV51kpUlarNfSAf97xYfEJc6sfhpYrorJM1ifLF0YopSRu4thsWmm0+xaKjb1EMUBNzE7jt4qqxYBpbWR/6dHf8T+D91W0z6pSbCXEEL03vqtqSRsoG8KtCnHJlo3SPmJZWoD+Md/yhqZVYrbx7hRqTfUlc3TReXdvutpW9vf2h9YfoPys0lxCfOvY2P1CJ3MIOqYiOdtxsVYzpSqhm6l8sq6FIcS6E+xH+n6R3D6UJRct07YUKzfxpIO39lKJH8rRxQ6UsDVCt45o9NprJeqFbebkGO+6lbq/+Kd47w4MorOFcMU6ky4AlqbLNyzfulCQkH+UdFhLy55HIfX/AKXlH9Q8sbY2jdxJ8hp9T8ko6T6wI9IEXq8uXyjdW2LpvH3Uni2pTiy889UnEDUr6EIOlI+wAiJcycUrEi3KJUAAkIA7BI3/AN+8Th1m4TbwbnLXZtggMz75mEtqF7KVzb2vvFZMXVJc5PtpWUlCyQR6RxQa5zrFfXbZIo6drmbZRb0SaXlhBBUsIG9r+U/7/vjxcqDjim7XXbkHcn8o8ZhBeaKLqSNW5J2IgmWlqVq8QAoNvS/ufvD4bbdcvI8kmy9y05MzASE6k/ivwONz/veHJkdlT/405lSdE/aDNIkVHxJ2ovJK0SLAtqcKRuTuAkdyRGkuYlqDh591wPIEwErUkWVrULWTfsmFHJPGLtLoNXVKFIM860iYUP6woT5ggH0vv9wI2DSlpnt0adyumHTx1MVXojxLTcC5j0ORncGUeS/Z8nQWUttyszKqWlQfURfxws/vnAq2paE+kW2n+u/LbFVUlJelUuYqD0stiZlGmiiQTIIWpmy3dJAceRc3TayUpHFo40VnHE/i19qeqk9MTr/hobDr7hWrSkAJTv2FtokLJXPuay+qCZ2TbS5NOONtoXMHUhDaVJU4DvyvSlJP8NxDUWIPbZp2VTUYFTSfq2s7poCeau5n7lY7nL1EYyx7jiew1Lfs+sJw7RaTOzrhXISbIBEz8ugFbpKFFxAFgpZuTDG6TMmZ6czDxBXRLNVTB+HZOZnq6hyc8BFRp4Rq8NL2o6Zh5KBqAuoBRHeHlj/qew9nznJhnMai0uap80/SXKbiBkv2dWVNK1htVxZxEuVJbNrkgekRXnj1VzdAyDqdBlHadTV5jOy0+ik0wj5WiUFhOmTllFJt4rpGtd/PZN1HzQw+Vgu++3zSVLR1EobTBti+w/4667dLm6jxnBLOZvzJpcu2zMTD63RKhZLcpLnz6QSdktoATf7Q3JxpM7U3Et2G+hI4GkbAfoI3cBSlZwpgKdqb0y41OYiaDSGL2W1KXvdQ7Fw2IH8IEJSZd6WSlWrSpw2G8UYJOp3K9NP6YDGfCBYLep9IZAU6sgqG2/8Ad9ozXMsNoKFJV4h2BHaMJRlxhOjULnsoc/6xsPS5CFNgpWruLd/SGGEBIvDnboNJXMTttIUBYqHr/pEv5OYXdqlQlkyMsFupUFFJFwn1Kt9h7xFNNZcYqaA5qZ0pF0q5V94nTIGYRM1uXSXzJi+zgO6D21b7iHaOzn2KUq2FsRcFdPCbQdwbJSdJ8FSnLNLcBGjWBuDvtY9+21orZ1j4oxXIZqTmH8PKfr0vgKSl6ziJTdM8RmjTLq7NMuvX2UtBuoA6rbmLDdLlQkpHEf7Em6jLNvoUHXQwVFthw3KUuLOySoc2vvaJ+peXeH8vsHz2HKLTmKbTarOuTE485+9cn5t25Wt5RN3VWAAJvbYC0dI+PvGgXsvLqqq9kqScubjrxvx9NlFPQTmjM9QOXFYnJ6qv1N2Zm9Dsm/a9P0o0+CEXt4J/CLeaLCN0anUqnOkzMlLysm0UrAIR8ukA7lN/KkDj0MUQzvmGOhjPWXck3cUSmHcVS65ibn5FlKpKWSFEFEwrhLg1DzHe1wIa2a/xKaDhPCVXfoVelaz4rKpcOtvlLLq7qIOk3ccULDmyTGRKIxaQ7JSbCJKuXvKb4XajTZOf4hPX/hXL6tYfbYphrGJ8LTLs1ILenjZpRCkeI42ghJbVpBFze99t4qLjb4xmM65l/UqGil0WUmZx0LYqzIWmclgFqUpKjezmrVayuABFYc0MdOY3xbN1L5iZffnVl5551IbK3CTcJSDYI9IZswwpxSje5Ud/URzNZir3OIabBelYX2apoY2tezMRxPqlda6rmFipLMiiZqFWqszpbZZaLr0y6snZKRuSSeAItRTPh8dQOB8p5hvMbLHEf9AJdo1BTrb0uqo0i50l5lGoq3JGpo+UjsDYwy/h45MYrxLjusV/CqMPMVLCFPXUnJ2v1RMhIyDIuFKWD5nVK2SEDbc3iQetL4wuaPUrl6rChmpbD1Lnlh2rqpbqwqpKTs20kk3alkhKT4Y+pYKiTtFeDF3V3k3OytppK11U2KlDMotnuTcX2sB0vb8KtOcfSq/QKFM1envN12gIcLZnmGlNqlFeYaJhlXnYWOPN5Sb2UYrzM0l7Dk38u+yhtTIsFaQPLva+/ETbI9Q2J6RWH5o1uccmZgFD63l+J4wOrZwHZxG52VeJ36QZbKLNmvTaczJSsirPK/8Axk1TFS8lT6emyi4/MXSS4QT5WgNKuIhhNja9vFP1dOHtL2MzEchrbw6KrGWM8xNlaKnLhyVQPK9LkJdTzuR3HrC9mll61U6A+uTu7KBonUo39d1DsfaJdzty/wAF0XGLow0yxVJDV4jdSbaMg86Lk3clwSlJ+3NoY2ML0emqVMNgy8yg+C4FXsd+feMCQuOilmoWMiyyHcfzRUPxzSJzBmIHC2VIQVXA7GPegY81LSFEoc7gmH51ASiKgwXwkBTaiD/r7xBr7+l022tF/A0Sss4aheE4zK/DKw9y73TrZTVQ8X6XAUuWvEk4RzBK5ZuXnFKmWE/QrVZxr7HuPYxX3BFMmqvLLdYmUFDSRZLgOtS+6QB273iQpTC9bp8ml1pUs+BY6UrKT/OEqilsdF0uE4/3sYc8FTmqnSlfCEMVSXQ9p8iZkFpQ9r8RoVfCc7S5TWpgqS2fO4y4HEn9DtEZU3G1Qk5fwp2Rm0eHtctlSR+YjcqeIKhh5DYmWKpTETKA438zLPS/ioPBTrACgexG0V7oXcQunZXwOAcx3knHOVRMuizdwBuf9I1DNNzcpqWAlRF0knjj+UNdWNypuxdQfTcX/KD/AKUB9tNwbgbC2wiMwFSitYTa6dCZhK9CkqIUO45HEeLri3VFRVdINrj8oRHsTtNob0avDCbHY3v3vHgMWy4QUrUdV9h3HEYETlsapg4p2ftFci6gpNklPbg8Q4MKVWVqawh0FLp2AJ2PHB9YjRvE0upaFLcV5ON+BDioeJ6a0huYQ6lp9PAKvp44jaOC7hdauqxl0KlXQlxoJWlBS2AEi30ccbxpGUekQVJfQlKuPNew2294Yr2b1Moqhqfcmz/CyLnt3hCxJ1JMyUwkS9MDKgOZu6j23CdondTDkohiMbdXOAUuUuvTBSWm3lLVe6kIurX+kbE3jyTwrVWG6tWJGkrfAIamHdToG3m0J4B97RWXEnU9iKZuzJzfy0rfcMIDSVfpEaVStTdXqTs1MvOzEw8dS1rUSpX5xvHhub4tAquu7Ysp7Ng98g68AujGHczKIZ5l6XaRWgLHxHnrtL43DaDdX2JF4ck/8QabyPxoimU+vzzsw5Lhx+VpknKpk5IkjS0UEEOKtuQCCk7XMcwZStTcsryPzDI/sLKf8YceEcTvSM6hZUVqvcm+59/vCMvZ5jSXuOZWlH/UeSoDII2ZNdTobjwsu7nST1H0evYgRWNEgtvGtCm6JN/LI8Nt/wAdoi5RfykKte/eKeZjYdXl9imcpy29JkzoWB7eW/5/zhJ+HlnHhuiYan6tVq1Jy66ZdwsuvBCkC25SCdyTYAD3h+V7E9Pzpr81WmlomnJ1S1qbQsecW8g57cmFqGN3s5ifuCVeYvJG6u9og2c1t7cSo6aYE8sttqut0EJN9h7xZD4buJ0ZdZsyjU+hL0jPKMjOtK+h5pwFCwfUFKjED0zCq5OdStzUp0K0JSkeYq9APT0h24Mx4MJ5nUunyxSp1p0GccSbpQr/ALY+34vQxE6BzSHjgpKZ7JmvgfrmBCh3NTLX/wAsvU/jDBmtbbOHa3MSDC72vL6tbB548Jbf6RJOX9YW/PeAs+IDuhf+/wDd48/ietf0o6+MQOSTa5uYqNMo808hlJJDypNKVA272Qg/mItP8Nb4YGKuoWp0+qYkkHqFhpopK9X9dNJ9B6AxLPL7/dRjM87AfzQJWlq4aajFTVPDWga34npzKuJ8GXprerE+rMKpMH5SmNKlKTqGy3Vf1ro9gLJB9zHR8JKEDbiEPKrLyl5V4Jp9CpEq3J06nNBpltCbAAQ5SgKTvxHY4bSGCENf8R1Pj+2y+f8AtLjJxOudUDRuzRyA2/J6lavin+1+sCNjwU+h/WBD1lQ3XzWdcuElzmKKlLvsLZm5KZcYdbULKbKVEW/S1vYxTTFuWiqlOFLS9BG9+xj6DOv34ayM7EPVWnMsymImk2D4T+7nkjhDoHf0WNxHIXqU6YMR5FYodkq5RpylOFR0FxN2nfdDnCgf1jjy50T8kwsefAr6ZwXEqXEKZvs7rkDVt9R5cuqqBWMPzlBc8OZbWQFAlYBKVgdrxozS0pQh4KBAITYcq4/nE4VSmKba8N1rUD2UNjDbqGXtMnzqVLaVE3u2dG8Nt1C2npyCcqijEtdVPsLZcV4YUna2w7Q6umrBkzUDMtvNONpmbFpw7cf4f4Qrt5e06WmS4iTDqxwXTqA/KH7ldKOjEEpps2lSw3qIsE3237CJWWCqKine4hx4LcqGCn6dTUpKNSWyEqUOAdozD5lW2lLWjRLIDaEEWCRsbW7m+5h9YjkpvDEnMJm2SQs6VJIuFkW4/viNK641UAEyqi0sG/hOK2Vx3iF0RzaJlr2hoJViOn3GSsPSs9U5R+l1Wk0WXD82Z1vww+p5HhJaYRfV8yVEhChwlKlG1obWUeC5LFlafmZxCRSKSvxHyokiff8AwtXJ3GwKv7I/tRGWTkpUMVVU0+XSXH23Ahk3JClqsCPQ2HfsCTE+4npkvgqhydElCFIkh+8UB/XundazbuTsPaEqiU3EY4LocNpgyMzcX/IBa2L6+l+YdccWlS3TcWO3sB7DtDeM3LzDYAS4pV7X4tAU2ZidSohRAG4O5vtv94zfaCWFWABIFlCNWvKaey6ylH1PEBq6VoV5gvck+0eyHDLTKNSSA52VtqjXWoIbtpuPW/IHYwcq4mdQtZSvU3sFdvt7f5w0wpV4sbLbM8fnSbEpKrhV/Mf99okHBWKHaclK2JkMjay0pFyT2J5/1iN5x1TEwS54baUJGrbcmFGj1Ft5CPDCwQb6if0HtDkDw0peRhcFefpZxdMT/mqL4dcUkBC17eMDxrsd1A9+wizzOOqZil1pfhTU1NYdSdBbWStIV9SkJvZZB472jnJlbnW7QkhLExrddslTLidgeD+Z9eTFk8tOomUwXJuzVYT8gS3cPOuWFvfuFf3COmpZ2uba64HHMKe6XvWjXhZTJnvmjlRM5dz1PxhXcO1WlVFGmZkJhzUXBcmymvqBB5v3EcyviDY1wNi7Mxr+gWHcNiRo1PTJ/OMseEy4vnyNcEpGwV3N4sR1QZpZY5wN/wBIpiuUCamqU0papNyUSXJywNk6wAb39Y584lxOlbjplU2LilH/APrBJOkfaKfGa14HdNsb8Vb9mcCYz9aTMCOB0Gv1TFqkq4ytZtyTe23r+gjfwrhl6sVxErLLYmAGfmHC4vwkJSkalJufTjbknaJQyY6NsxepHDNVr2E8LVmq0Ghakz9SlpRT7bCwgrDYSk6lrItskbXBMRg5SH5SoKYmrSjiFFCw7ceEQSFBQ5FiDt6xzjmODQ540K7KN7HSFkbgS3ccr80489cSYfxZjKo1rC9A/oXSHWmkS9BZnnJtqWIbCVkOqOpWtQK7HjVEd/PPTIuokgbLSNzffY+0LNRebcdU2074tr3Ufxc8e0aKJRp2eKV3QkEBSr83JF/yvBHYnZRTuMbQGk2A5k/M6lM+tOIbqRBNlIClWJ455hcwriWak9KWnC22r6gDyN9vtDfxjhmYodWS07fUlxbRJ/FzYn73tGWF54Szw1m5QdJJ/lf+6GjGLKtjqnh29lOVKmP2pJMza9SkoI1j+Ib3/OG3mahwyUqlRJadcUUpvx/v19YxpeMGsK0Fb807pbWrypG5Ud9gO/vCbi/G0nVT4ingnwpchpF+CRx9vWNGt5Keaotq43Vfc7GUifmGhs2o8E9+8M/LHp5ncxauXVMPM05s3U6pJAcPYD1izGW+Tz83MvVDENNcRPTSguWl5xhSC20RdKwhVidQ3B4tEp0HBK2XEBMv5eNITsPsInNY6EFrVy7uzUeJTNnqB7vLmoYwN08y2FpZKUsC6iNgOIkRnJmWYk0OOoSL/h9PtElpw2iTlFrUhIAHl9oSaFJltl9fgzDrqlHwyv6Uj/KEjVudq4rroMAghAbGzRNOnZPSTza9bYSgixSre4Pr6xIeJ8M1nHuGaW3U6hUqtISUsmVlfnD8whhCbANpv9IHp6Qo4NwDX8cpSaXQ6jUQ1sXJRgqaSfdw2R//AKh1O5I47pUuxIzFPEhIzS9el+qyjTKVbbqPiHTGWvkOovZNew0rCA4C/VV+m8paBRlzCXqLRZ0ujStpyVCv0Pb8oRv/AAlwcJcBWBqM4o8kTMwgj8gqLg4a6X8OJmQKziKiTDhbu4iSqyC2wqwtrd8MgjftHhVqZlflJIstVmSkcQzbZ1TDkrVHnkOglNkhtLabG1u8btbNxNkvJBQXsI8x6D9wqbyGWOA1uran8v6WkJI0OJn50hfG3lcFoV19J2XWYHy0vRKOxQagtPMxX5r5aYVt5UldygngatiYsQM6MpK5WbN5NzbsiogKmRUXETJ+m+lAFoVkZj5ZVKkPsUTLimy9VSUJlmKlKrdQobEqcf1C59BaJxI5osXj5/hVsmE0shB7k/L8qsMz8NadYkUKcw3UWBq/rUzanUu8fSsK0KHuDCWroso1OmFMzUlMMOI2UhbigUnbsTF3cG9Tc5lY+HaPhSi4dS4gNlDDK35ZYGn/AKThKQduRGWKeqGczRfbTWqThqaSjYKTTG2ieNiU72jBu4XzLeOhiYcphFuf8/Ko8jpOw9Jt+Rl7UDfUl4m3841Kz0s0uonW4h5xR/EtWon84urMyVCr77TjtBpMskHSrwm9OsWH1Ecf6RmvKvDjzfguyPhqKvKpDmlQ4/KIs727FS/4XSP+JiolOdGlNeSQi4V6f6QhzvRxKoVpQVah29IvzVunyQS6lcs7MNjT59YCgBt+v2huVDJVg3SJhTiB3U1pN/vzvGhqZls3AMNcL5VQuu9KxppWLC6Rv3hnVLIqYlVL8IKSAfw7gx0Qq/TiiYl0OImbtKHmStGo/kfWE+d6TaFPoSWZ2cZJHmC0BQB9vb2jDauQbqCo7O0JHuABc25nCc/RZ7TreadSfKQTzE1Yf6ia7kxQaLJUJ2kIfqMr406pMspyZZe1adC9e1yLKBTtYxaRjoHkK7UCzNVOUlpd5J+Xmw34iQv+FaTxCLWfhZYirzM0zJTVHnn5bdseMWVuehQTx/dGzqnvLe6q1mDinJ7uUDbw+aYOXfUbjjGMsqWmqk4yl26dTckhtxQPbWBqA+0Wk6LumCuZh4slJpFFqM+0hwLKUNFIe3vbWrYA9z6Ru9AWSOIqTWKhRccYSfD9CbS6iorlhdTWrT5yNlW7KHbmOvHSLgenUykMGXlmUCwtpSLRBBQSznV9h4JDFO1TsNDoxCM3O+njooZ6b/hCyU7mTO47xo0zOVysTPzTzaRqQzsEobTf8KEJSkfb3joRl7gGSwTR2JOSl22GGUhKUpTYCPaiNhphIAA2hblRZMdTR0ENPcsGp3PFeP4rjNVWm8ztOA4Be9gO20GD+Q94GkkG0HzsdofVKhceogQLe5gQIWjUKO1PJOtCT7GI/wAzemzCma9GekK/QqbVpN4WU1MsBaT+vH5RJpBJ2gtOq4MaPY1ws4XCmhqJInB8TiCOINlz4zY/4fzJjH047MU2XrmF3XSTpp84S0D7IVcCIXxp/wAM/LO3/o3mI42P4KpIJc/mmOtqmAuPJcnvxFe/CKV3AjwJH0K6mm7d41Da02b/AJBrvqCVxcqP/DEY3n1H/wDlTDUk2rksUxZcP5mEqn/8MtX8A1cVBrM+dnJhA82lq7bg9FIVsRHbUyZI3J/zjz/ZCHU2WEkH1jDcGpwNC7/2KZf/AFAxaQ3kLT//AA38Lhbnf0IYoypoplcRSf7Tl5ZOhFTlWzwONaeQfeKaZx5XSmHi6tSUrZG4W3xH03ZkZQSGLaY62uXbcCwQQpNwRHHf4w/TLgDLXMPDGDsNsLlsbY2WupVINO2lqTSmidcwtHAW4oKAPo2fUQvVRPhbcm4+a6fsrjhxGobSuFnHltbieiqZ0w4aawhgwYhdaAmZwql6cDt7Ld//AOUn2ML9VmFJfUu375R7ixPH6RtYpnGGGZWUkkCTlJJtLMs3wG20gBP52Fz7w1qvPvya2wVeKXz5juQB6xzOa7l7NkDRovGdnnf2ogIaKi4LK7JHHMbLckFNoLmpR5BHY7b29R2jWlXlF/TYkK7ne52v+f8AjGw5MugpRpQW0ApSoCxV63MMs6JY8ytGZLjk4httQJcGkBJ2A/zjKZmni2lrW1Lttc3FtR9/WPel09yTmi7o0tEbpc5Eebp+amVXARvdJUPq94Y7zgEu5mlyvFIW/dSnAdW11cq97QaZtEs6pTaXGgDYJKr/AJ/4woOS7b0p4qtl2sk/iV/9GE6ZaLjKlFN7jcgce0bh5WoaBovCexdOMTKVh1djt5NiP8zGT+P5qadCHJmYW2g2HjOFQJ9xwBCHU1rlgNXmN7GPCYkQ9o3Gvm3NvYwd+5vFa90HFSBirNqgzmUc3Q00Cn/0hmZ1l1NTbb0ral0BWto+pWog39ojSnUIVF6wT9X8+f5xlPtoYmroFrHSb8E+hjdoU+hM8nWTLIvZS7atI33IhaWYyOBKaghbE0246rpJ0zdFMjl10gGu4R6ml4HxTVqb+2pqjsVpuRppcLa9CHiTrbVYaSr1A2tHMrOOfdncSzUy5oXOTJLk06HQ8h1xRUVKCuFE73V3MWKw71rt4BksOYddp9HncK0momseHP0didmXHC2W3G3VKH71g8+GfUekQJnFmhh/GtYrzcphmn08VVwOMzEsgtrkVh1aylhsHQltYISUHgccQ3UPZIxrWaW8VTYdTVNNJNLUHNnNwbNBAvtoATpzvZRc6kfMoUFAhpQIVfgekZ1kvok5thTKgt9IA1JKVN7378XH98LeEp+QwtUJadlg5OT0i+l5HzTKVMKUlRUAUd0XtseeIUsZVl7HFenavPviZqVVfXMTLmgJ1OKJJNhsB6AcARAyzNyt5y6Q6DRRdmXW33pKbmX1+O4nSoq7+Ww/u/xhHlJJyrTcuZMErmCBpJsCTe2/sf5Q+8T4Qbk6Mvxk6m31rFz3uOD9+35RH8uzVJBa2afLJfEp5UPqNinm2ofxC232h2ORtlRVEcgeCdl7ZrYr/o7XEyjbqXnJJsNGxultVjqv73jc6ZJJOYObjLz70qWaIyuqzDMy5pEwhq37pPqVKUNvS8RHi+qvszkyHCoPIUdZXzfe9/eJk6GUzCsLYiUhllSau+2288UXdShq6koSeQkqUSq3NhEchLIzIeCxSyGorGUrRvv4DddMMqsf5edQWXc3QcUTshScX1ipNqexLPyHzimJNKbNS7Kr3ZQ2E2VYWtGnjTI6mYXySmqjT6ZUqrNO1GZaYrUo8FSSpRnZSiwBrSCo/wBYqw3ir+AaCKfPqnHa7T6UhpzytuKUuYUbH6W0j6b+sT9hfqEqWWGG8ZNUh51H9KcMroJlFvl9tTzyh401e1kkgHy+/tFO2oY9tpdNN/2XavopYX3pLkXBynblod7W4ajTZRJhrL2o4ofWtypNJlQbpJ31D3PpEjUjK+XwK5WKdiaTWmsNJZVJibJYakknzFbzJ8zi1JtpSbJANzDp+H5S6Fl0cX43xXUZWTp2XtBXUaf83K/NtTNSWfDkmyydnVaxqDZ5tfgRAWO87KzmHiSdrdam5meq1ScVMTUw+4VrcdVuq59OwA2AsBsIlp6cd22Vx32HTa62qq9xqH0zBZrbXOu51sOgG+vEBWFynwxI9QmL/lMS4jrIo8kAluRlHhLNL9koTZKEjvsTF68jOhrJujyMk9IYVw28+8Bpen1fNPOna9lLJST6bbxx5pWYM/TKkl5madYcSdig2I/zET7kj8Q3EmWMo/JzYTUJJ8JBStRBuOFXHp2taxi7o62CIWe3XmuYxyiq6ptqaQt6DQfJdh0ZC4WptEXIMYdoss0safAbkkNgH32/2Yr/AJpfD2mMeYmklsTUgvD0mAp+mzzCG2nLrBK1rA1r22AuBtFUWfjOYooVAdkabqmpgo8OXXUHAW5dRIAKhyoA777xZ2jdXFEwzlRSqZX6jVcXTDssibn5tkLUatMr0qVbRuGwVaUhOwCReLdtTTVGg4LhxheK0Ds+a5cfHxOu3qnPX+jfDeGHqXJPS2HqbJTbBKH1SqiSUhOpCdCToSQDzzDOkfhlN1bMpiflqZRU4dl0B0VRuptTk66bJOhEuLJIJ283F4kzp/zMzUxlW6bW5p2QwTg+YRoZo70iZuemGLJSFOE7NLI4v2MblC6L8pMl5xybwxl3PVypVh9a5ubnatMuiXLiwtSlpKwEpuTYIG20SvpmPAOXT+dFWjFKuncWGT3rcNR1vctAI8XBRviXohp+aWGyKM5TlSqgUhualA1OEpISQ6kboFxFWsa/DRxRScZTDTXgsoZb8ZJaBc1puACE887e0dLq5lhWJSq0p7CNWlKZTKdLJYXSJqTPyk1ZST4njf1qTp2F77gRCWMc2sV17N2rYbfwzjDDAlWA5+0KnKMTDVUUCgBmWmW1WBXe41ep9IxNTQEe+NU5heP1gJDHAi19dx+fK65wYqwNN4FrD9NqDL7U1KgBbYSbgbEEesakm65OvtsurWGxsAoFJVxzeJo6/wDGEjJ1hmn091h7EVNQETD7Swp2Wvp8iyNlOA31ARCmW+DsS46oLtSkWXKo0wgrU2iYQ5NlKSEqUGfqKUnk+hjmp4mtlLGm69Oo5zLTtnkFrpwS85MSdkOSrimxwpLl43GZiUmkgqJCv4VbKEFh1hE3IeOmYUoo2cbKTqaO2xB3jwq0ipbgebsk/wBofUPeISE60racpzQbK2taSN7DdP6QizTyZd9SXk2S5+LRZIPp/rBTBmWWlKUpSABe4Ngn/SCka4txsIcLTqOFb6vzAiJ7FghNyruPyDrigFFonck+Vwe/oYXcK45mqW5Llcw7MSS/IoHd1g/4pjTxVOydBdamlPf8otQS7L2J1X7oPr7GFVGDmpthNSobzcw1YHT3ST2UO0Rx3zWVfVAZdQp2yIzfOGJ3WZnx5Z3ZSVHUAD6X7Hi0Xu6U8d0etrTLSKkMvFHiJYvsRz5ft6do5S0Wm1NqQM+0kpfbWQ62AQm45Tb09D6xN2V2eM9g2aoNVlZh2VWhxKPFvbw3L3Tf2O6TF5TSlu68/wAdwxtS0lp1XYujfvGEnvaFdnkDmGDklmHL5oZdUivS2kIqLAWtKT/VODZaPyUD+REPyVXcd4vGOuLheSTxljix24WzqFuIPcpFhBWsO0BJHaN1AjgQIECERIPrAC7dr/aAoXIgW0jYwIQChb0gWHYwX1b2jICwgQgkADi5jHQDzYCMk3PcQSjdJG0CExuoPOGm5AZRV3F9WDr8lRpYuiXZF3pxw7NsIHdbiylI9zHBLqIxxX8YZt4ixRjKaZmMc4xdTMVVtpetqkSwsWKc2eyUDTqA50p946t/F6zrlsDZXylEcWkqCVVZ5N/pDYKW/wBVFR/+McW6hiA1yZVNvL1OTTpceWs3JKje/ueI5jHan3hEOC98/pVgwjpn1zxq/QHoOHrqeeixnJxxetwHVbZRPB4/T1hOTMI1AHWPFPCVWJ4uN+BGri6phgIDOpStVvIe236wiy84UTDTq/NqIA7XHp7RSRi4Xps4sU5pVKVLJ1qCQoAJVyBtb8491nxk6ghwpvpsObdrx4yJMy+glJJBFkgbkbfzjfk5NIdK0+IQo7A8j/WJACo3lttkbazMKWFgnxUi5Ha3+EGiVW6pLXhBSCbXI+o+nsI2GVOOzKmilLaVbFWn+Rh4YQwT89My+txLqXFBNk8HjY+3vE8TSTZQSFoF0kYTwArFLvgvImpdlpKnHHm2fFUlu1z5Tyb225hLxzlwiiTZl6dV5KuShbS8p+UC0hJI/q1hQBStJ2Ii6vT/ANOz2ZjdSplLpk3Plhpsrcl/DbQ2sn6nVq4SO1hvErV7oCw7IScvI1SXpwxPOtKDipdaiy8i31C45T69yYvWYa57QWBchWdoqaCYxyON+Qt681yiq9DWuaQ22CpdvN7n0hHcSZNzWTbRdR9Tb39YtV1QdHEzgCtU2QoyajUZ+tOONttNMkoYQL6AtQHlUqx5294iLMDASMEdPWYP7JqjGIKPK1mjKacskTMg4sLS+XkEa2/MC2CLpVt3hKaheCQ7grODFIXNa6M3vb5myhRFWSpZJNipRtfve/MObDlNnsSKmTSKauoLlGPEcDfmcSjgkJ5Vv6RFnzjzztnLJCfw8C/v7w7MucRNUzE1MWKs9QXkzSUuVIlRZlUE21kJ82lIuSBzFayMZtVbOnOUkLZxphCuztUp/jyPy8y8PDl20WS49ckAqT+FZI7ww6/VjRnphS0FL0qstPMkeYEEg3t3Bv8A3xbnFXTJLzGIp6nsYtwpXGlSaaz+0JStNrZn2FXs62o+fxOxQbKTEAYpy/psiuaRKS5UAVXUoklzn19fWJizI+xS4d30WeI8LqNjjZ1xhVkoSyTwhNjbfk94ceX84MUvLS2U6mh5gfT0iP3aozSsXIpYsoOueGL8AEnb8ok6ns03Bsi6unMKStYu6pW5Vz+n2jZ0N9VXsqm80vYhoaXKA9LlbbqiLgD8JF9j+W0QxXMXuS0nOSSSENyriloCU2IJ5ufY8faH+vF6ZyVUpleouAkjv33iB56vTEs5OqcUlZecVr1Dvc/7/OJGxJGqrGt2Ca+MpGYxSJxTCCuYbaXMOAblaU7qt6mxv+sWk6LZOg5c4UaksT/OyqZhkLS423cJWq5V4ncAwxek/KqSxi5OVWZ8Yzrb/hyyEGzcvLpB8d1e2/iEpaQONnD6RYI4ZlKdLTa1Smt1wKSQbaUq3tc23AH6RitmayMRJfAqR8lU6sFxpYfdKmIMylUybElRZShLp7Vi1MMyoU46N7aid7+0OfB4qGYCFBUk4ibQkqLEpLqcQpI3KtCQbWHJ4A7wkdOWQlSzHrBkKZTZifn31EpSgW0IFypaifKgAfiUQLCLf5QyJycy8qGGsACoYnreI5pum4orWHJZTy25W91UenP6bFxwX8Z/6UgkA7RUMjErrO2/my7GWpdTR5mWc/TS9tOZPAfU6BQTifC0/WsCJw7SZZ55takz8yGxtNvAWFzxpQnZF+5MQbX8OO0mYLLku60+g2U24LFPtb/ERdfrNbyro+Om2J2cq9OrUyhC6lhbCM027I0opSEoYdmlEBTwSBq03Gq8MuSxhl+vLeblKbk1KVeUKgyajVJ6Ymptt5Q8g8ZuwSschsDzQ0Wd27JmGiUFaJomztYfe52G/UnXpbfgqhfJJlni4shKVbff2+0SHk301Yhz/kFN4cqGFlzQd8JuRm6qlmccVccNWJ078naFjMPptmaZhljEUzWsK0+kvpu6VzoD0kq4AaXLf1vin+EDg3MR7lhnjjHprrjuIsFTjtNnZ1pdNTNpa1KYSqxNgR5V6QSkngRJGG5h3uyXmkc5h9lIJHpfkUkZq5fVzK/E0zRq5IzEhOSbimleK2pKHCNiUqIAUk9iOYe+THWJjfKCjpkqBiOalmWE+RtBbeLI2+gqBKB7D1izWEOpabkmsGVbOuU/buCsz5P5+am5yRVNz8nJNOBDTrBUkWs83qKAPMFEXsYZEizV/ia5oNYawdhTAuGZKmTripV6n0dNL1BawlJdKNRWoosot3skxOYyHfoOIcdhxUAqGFt6tgLALlxPu8ja43uDp4Hiord6wcdtzfzLWK8Qyzzqtd259wEK2O+9re0e0z1+5xJQhIzExYhIsABNgKHG99P/ANQodWnRBirpFx3TcPYxqGE5ZqalHZmVqzFQSqWWlAClJdRbxG1k7JSoXNxaK8MVBE0ErUsJ221qtoG3rEbn1MJs8keabhFBVMD4WtcDsbD8KbKb1CZl4/qagMR40rM495lJYnJl50gW8xS3uAPW1ocE/gLNJihJn6hh/MIMTKyGVvtzgDi0pC1FKb3OlNlE2sAYfuTWJMT9E2U9AxDI4cRWaNiyly2Iq7NqnXaYun6J0iVZamW/3mstoBLBGlXjpJuBG3WPjwZ2z1XU+lOEUtMreVKodp7j70mHFagA8XAtYSTxslVkhQsLQy1kRaDO8glIPq6kPtRQMcwcSbbdADbXnw8VVatYnqEhU1l9U0h5tXnDoWlxJ251ea/reLg/Cq6lcmMvcdeLmXIzNJqCFJMpW/EWthJKkDQpCR5EWHmJNiO0U1zYzzxPn1mRUcVYwqi6xXKssKmZtbLbQXYAABKEhISALAfqTCFI1NxL3hEFCUr9/Mdv5QnFIYZc8etuasaqMVdOYZiW5hrlNreBt9R5LsR1Ps9NOauMJ9vDeaVEkcSzEo7ONTjY0U9boQFhlTwAB1WsARccXiiE1mNPyaitCmJiWBOxWL7HkH+6K3u4tmWEOMG3gnaxFwONwI828bOykupKXHCoHZIO9/8AKJqirMxzFoB6LTC6FtJF3Jlc8C3xW09AN1ZCazZYlm0meYIZeFgpBukf6xnLVhl9AVLPMOS6hdKuFJ/OIFo2M35+TDToslY3BFxClTMRGiO6W1upUjzeXdI94gMllaCEO2U1TKGqzTHpV8EtOpKVW5HuPeHplXiRGX1Tps2uVlq4w234FSYvpcmWTtqQDt4iREDSuajb4abWG1OfiLZKdQ9/SHNQsUSc/bXqR3AvZQ9wR3jXMCcw3SdRTEgtdsVfbCmR1BxyyipYcc+Zkqmz4qQkeVxPrbkLSdiOxERX1AZHVrANJqEt8s4mWe/esrSNkrG4H5xGeS/UdW8h5tyaptSdXJ6hMhKh4gl3RwsJ7pUPKtPcb8iOgWSeeOFeu7KBbwpppdYZb0TcqbONJXY+ZlzhbZIvY7jvvFvSysk906FeeYvTVVC7vSM0fPl4rd+CNn89mXltXcNTa9cxRyicbCjukE6HB+ukxfWXbNvS0cv/AIeOXVQ6VviKz1Hmbs0PHEhMpk77JTMJGtTX5kAj1vHUCUWVgWtvFxR3yZTwXmPaaJoq+8Zs8A/Y/ML2122tGVrjeCKbdvzgbj3htc6jgQLj1ECBCI3HvAsVekBKSe9oH03vvAhAJFrQLkbdoFgrtGSFWGwvAhY39owdWQ4BHqFC/Fo8J1QShSh+FJP6CBZAuVxn+M1nE9i3M/EjDLviNmbbprQvsltB02/UKP5mKHPrXJo02QpR9vKeO0WC+IbOu1THk5MuOKCpipKcKeQbqUfSK2ztltaLhSl7jSb+kcFVvL53OK+v8DpW0uGQwt4NC0p0PPqQkkrSDdNhYngW+0e0lJiYeZ1hVyRZXrxvaFKhJ0KcYWtrUtHmKmypdgAbD0J/yjYdlkSlQlWVSzrbZSL28yje25+/p2iWJtwsTSWdZbkhSnmas2G13bIurf6RtC3JMfKoK0qJJVpvz6XMa72pISWUhRUAC4dtha+3Pt9o3JJ4oZCCEqKh6bKiNwF0B9xZKEhKtS814KrOrWRqI4HHJ9YkzBCktT7LZZShFwlsW3P3/wB7RFEk6tM4t3UCARYW2v6fl6w/MD4qbVJLW0v5idlXmylki3ipJ81jbmHaa2YBKVBIbddJemHBCcG4BbrjDD8rMzSWdD7VwpaTtZSeCAeL7i9zDozbzTl8CyblcnJRqZek2F3l7WMwn/tAkbXVbfvEL5A9a8vSMBLolTk0oMq0VIDgsbEcHba59IifqBzUpHUVMStMmsVmXrDswFS0hJgeFLm2lIeURa9jzvHXRzxhgDCvIpsPnlrHPqG6X330SH1F9TU/Vs0sM1iXeNMpU0lEwumS61MPTIQu3juEJ/eBDhCUpH1AHaK+/EgwlIyuYmLK1R32pinvVBiTmJmSBblHVut+MWQnSAQhwFSb35PcRdmqZEYFwbhKQrslLTs1VMDU4l2ouBUwxLBpJWppxa0aUuFf0kiyLjk7Rzh608/5bNLBtOWHFU+a/aTqk0oru42zpJS65ZIBV5ikE7neFMSZ+mcx1O30V7gU7XzMMDSGt90+tx8hv1VdqujVMix8yTdPoP8A6jCn19uRqTanVKU0lYCylAUQL72B2O28I9RqRdN0KuB/u0aK6w2tPlQpK+NxsI5bKQdV28koI91TlUMd0uVqs5Kyc5SGqOyvxpCcepCGnmwUXKTpJIJJIN72tzCHVcy11PDs2iTaS7OPXAKdtadztt35iJZ2sfMNFtd9YFgr1HYHaHxldkBj3H89Ms0+kOyaZGVE7MzNXmG6XLy0ub6XFuPlICT2tue0Sd01zrtGqhFfI1uR2yjebq8liCoKSQJabl16khY0uNqBO+/O8bmNMc1qcwk78ihCptFg4WvNdIO5T7+sSRi/IdmXmm/mq3RMQzCQVTC6TLuuNMEFQ0/MrQlDpNr+TUCDzGhMZXMeGt9DIlnEiwXLJKCm19iOD/nE5OQglV5p3ytcG6X47FRdhXHUxNPpnZqZYC0N+EWUDSBa+5/tbcQy6dODFeYErRvmZeQFSnky3zMwrS1Lha7Faj2CQSfyiT8XZKOoe/aapFM0pBuXpcFJuL7qQOfvErdAvS/h/MOvYrq2KMMydapqWpWQYbmm3PES84/qWpjTa7uhGgdh4hJ4iZskVi9x0VBNS1rnNhY33ibePVLnSthiSwlgqen5fxXmKhMGWlnFIICpVklKVbjhStavuYlajYWfx9UEStOlpmaS0kqUWmS6tI3vcAc/eHxndhWi4fZNFpzctKVNh0MTEnLMeHK0JpGoJZva7rhAvdPHuTCDKBzLKgzbMpiwSUo2dbiGUrS/Mu72BQkXP3JsNuY5eqnMkmYbL1LCcOEFKG7nwNuv7KUMMZXY0byqrDMpT5+l4Rk2/Gq7cttMTKB+J9SbrWkEg6baB3BhAx78R3GdLyyYwDhiYGDcJS7AlvlKQAy49zqU48POorvc2I5txDKe60ZmkZcTNNozFUpldnG3JSbqyKwtxEzKrvraMuUWSVdyFW9or5Xa+/8AMhdyU2I0jkD/AH3iaNxZrG43I1StRGyS7amNpDXXaLcdrnUi/I725KbMjs1cu8PrxR/T/BtRxYKlT/ApS5SpmSXSpnVcvhW+q423B77RljfrdrjeHl0HCEnJ4FoRSkuSVH1AvLSLeK44u61ukcr2IvtaK+y9WeeltSbpKjwew9IxNQS24gruBpvxukxO2RwaGhVz4onSGR1yTzJI8gdB6JZm8bVWv1RT82+/NPr+p11anXR63Ubm21yYu/lR8K/EeY3w938xpan1JeJ5lxmfpFPQ2SZ2W8TS65oUnSoKTbSonZIMU7w/Q5nCmTj+KH5F1DGKpp2gUyaUPIUNALnFpuNyQUtX7aiQbxfPpc+NfTcj+h1WX2IKPVcU1ynSD0lTGHWm0SCUlYLKHHgsLLKRe6CkkmwvaHKBkBcfaOIVTjU1eImOwz3iHi46Dfpa+hSDmZSMr6d0VTK8dYbxRI4yw5Ly0hTqqmon5epzyXFB6Vkpdf0yjaAApSdrqURcxAVS+K3mVhPAyMJ4DmqflvhdpAbEjhuSbkvEHl8zr3mdcWq11LKrm/aIdzXzvxFnViecqmJaxO1Oem1lZW+vyIuR5Up+ltAsAEpAAAERjU3lKWUJ0FKD2Nwfz9I3dO7NePThyv4qeKhia0tqBn1zWPvBpNtr/wA5WTsq2ZrmM8bio4odqVXS88lU6sTRM3MoFr2ec1EGw2JvYmH9iLO/BtBdoJy/wYjDqKU8Jxb9bmG61NzUxYAKWVIS34YH/T0lN94gxbgTMtgpcSVjUNQ2I2jPxlPOBQVYj6R6RCXG26eORzgSNvT02UhZo52V/MytOT1cqEzUpx1fjLW6ryhWlKdSUABCfKALJAsABDbDqn9N3G0iwNtXrbaEh1n5vSFkK2tb0jGRW5JzBQAEi2jzi4iMt4lMNcCA0aBOYSiCLpWlSQAQR2O0ak+H2Qktg78kfh4jUbqjku+024gp0+32hRa1MLLxBUkjZPYRgFZLBZa61B6RC0L/AHqNin0hGeK2nCC5ZV7+8LExRrLS8ylYS4Pw9vYxouS61pUbJBSeVJvaMgqIt1Sph+rF95DTzhBGylenoYeFPmGCgoCSlSeCf74j2mD5eaC0X1gXN+5h0CeS/LIVYgEfa0YO6cifZuqccrOstrUNDa0KGlSSPKff7wHFobSQnWbcWUQR7w3vHCEptdJHpG43NBbiSLhQH3BgDeSmMjTulmXxNPyWzEw8SN9BN7e/vD/yD6qMVdPmKmalh6puSPiuhUzKLJMrNf8AvSfpJ9REUtrSp0oW4lkaSUuLvpuBsNuCeI13ZtLD2n6kqTdWreJWE3S80UUjCxwuDuuzvTl1c4M6xX8NOuTTGGsdYeqMvPsJmVBKFONq8yQv0Wm4/MR0xbKVpCk2srcEehj5U8FZo1HBNUYmKfOOMTMuQpCwdwPQ+o9o7O/CM+KMznVQJTBeLJxKapKhLMs+6vdJOyUKJ5QrhJ/CdjsRa8oK4XySbnivIO2nYySOL2ui1Y3dvEA8ui6IEEbGAVE7doJKiedjGSU+hi6XkiLR7n9IEZQIEItPuYxuYzKrD1gkKJ9IEIJ4gwbDbaAAVX3tBEaT3IgQjAPc2jwnToaWewQSf0j35EeT41m3Y7GMHZbN3Xz7fEKlfAxnU9SNVp66Bb8JUqK7MlLzCEpSDfcm32i8XxhMnXMv8eVyzKghEyNKtOym1kqQr9Db7gxRHDk6hDOgkE3urb7e0efZiXG++xX2bQFs2GQzs1aWhOGkSqmSSULBvvfYKO3e0KU9LNio3RLq06QR5jfYC49oxw8wqqMENL1IQq6krVbfbcQteKyy0obFS0lOojnb/CHGE20VPKQH3KbTdeAmNRWlvV5QnTtbt+ceLdZJdcOuwQe3f7e8N+pvLpb62pnyupJ2/i32tGi9UEtM+IlSrqO9uLRCW66rZsg4J2f0jWmX7o1KvY/iHaFnDOLVFehRCVDgk2JHpEbLrSmpdSyFKR2J3JjBqqPTYuFqbCEnSrgknv8A6RKx1lq599FL2IuoB+TW3Ir1TrPC1FzSoC24B+228RzNZvvVbFL9QlwqWS47qbRf+qCdk3NuR6wzcR1BctKjdSnnD4f+faEVuoiWWfqC+AANj/lE3eF26TcGtNwFZHMT4g+YFUyQTg1NXW9RWUaRTiyhLDh1ai46ANTqgeAo29orZmHgysU2aZcqUjNyz9UZTNsh9Ju8hdyFjb6edu0L2WOAMQZx4qTR8PyS56dU2uYXqeQy0w0gXW6464QhtCRypRAiy2MPhf4twt09VDFMxiCTxRUqE23NzdJoDiai3R5JxKiX5ib1BKQAPoZ8Q+todaJpWkm5sqd0tDTSCMWYXHYDcnj/ANrn5PToRUHGklxQRcGw3JF9zHvI4UrNbbS/KybpaeUpLbhSQ28pPIG25HeHVWqTLUVczKtoaT4mpTi2gVLI3sgKI3Frdt42MUYFqWXL8ukveLKOttvy7zD+qXUXGg6UpUnYKAVpUOxBB3iDMCNlYOpi13vFP+gdNWX+I2sKyErm7TZSvVVChWl1ihTEjS6EsJUQgzA1KdJUNN0otexvEw5Q4mwjlQ9PVLFmKm8fVsoXTLoacnVOySEqSAicmblltQsiyEFxKPpKSYp3UswH2aaUMsNtuJcKlPblxSbH92e1oTHsyZxxvwwrWFG6lKJNjvtGha8HMwC6khNPqyYkjy+oHl5K2GdeecnjXMMzzjEtLUiYLKUU6QY8KXk5RAPhsMpI3SE286iVK5JN4a+KMSUFFCo8tRWqkJ0yV6o9OKQW1zRWs2ZAFw2lvQnzblWo7bRGhzmr2ctcljiCbXU6ixKtSTL7rSEKRLMo0NtkISBpQgADv7wqzD0mtpbSH/3rZstSk2B5tbaNO8eQQ/VDoY7tfHpYbA6cuO6WmGJCmyxcXVJlhW6lISnZHJsb8CJ/yuz0wPhfK7DkrgXEr83iVEs5UKqJ2kpaUxOKUUOJRsQ4hLYSgdyCTtFKs5MQKlqMuXlXhdYs4tJvtv5ff7xB+HM2axhOrpdk51TX7OcU42lStrr8qgm472F/WNDQmdjgCkantBFQTxulbcA/ay6C0CrVLMfPiVlnp1xyanZ5tC3XFatJUuwWduEg344TEqfEVzKwyjMNOFcImQ/o1g5j9lyr8mjyz6hu6+VlILhW5c3VwNuIq70N57LpGZEtiJL6kVSm3nJZz8TT6d0K4/Ce1uwjczKzHdxZXp2cmlqfmZt5bryyLqdWokqUduSTFXNE6O0QH8C6ujqo6j/Ok6AEAdTxt0AsPErWIV4XilV0L3B7AekaCZoPuKSoLDiTp4vGWHkOTbDyShTSWl6ktqP6xnixEthyRdfW4kOOpGgdyfS1u0TtaFVzSu1KS595CZ4NguovuRuNUOfAWAZXHdZk0VWpTNDw0mZbYqdZblVzCpNCgVaUISPO+sAhCfU3NgDCXk9gCoZyYypFJcn5WlSc0oOT9VnbiVo0qD55h5VtkpHA5WqyRuYmjMrHtAoUsjBuC6hMz+AsNTq5mlKdkPlpitzBSErn5y+6nFcJSRZCLJA5MTtiHxcFXuldI7um7njyHpa/IeaYWcePJrH+I5RiVkHKJhahsCnYfpJWVN02TSfKL2st1wkuOL5UtR7AQ2n2VS40rCgfftEu0zPnEFWos3+1pldQfQEiS8VhlTMoq4v+7KCkggWt2iOq8ymcnHH/AC63lFZ0pCUgqN7BPAHsOIzI4E3BTUMLo2ZSLAdU1ZuXW8jYeW/8/vGguQ8FflSB/hCvUHFSaChCPKe/aEucmLlASCSrtbiMs1Ub3WWExKoXLhKk2XawJN9PHEJz9LcaliSR5dyY3zLqCQbgLJ2EBxJKyHAkNpGr2HH6xIGhRGQkWWlTJxpholbgKkkXUBqsNuR6x5PVFC5lXhr1Itvf1FvbeE6r1n5J3U3L2SvhQTt24jCWnEu+DdIS4kXJHrzaNiNLoY/WyV5OYUtwLVcWtcHew7Q4qPPScwop+ZVdKbpSoWsbCGo2pRQl4WSpQ8rZO9tt41UzgKwlpKy+nc24TxELmEp1s7WjXVPIzaZVZCgtSiNglREazNUacCy5ptx73hJRP+EsOee60AFC+fyg0TzaBqKUr17m2+kRqGFbGZq3HZMocBsrcXAHaFmnPuiSQl1OojYevtGOFFInJpCgNRQOCNrQvfs5iXeVbWEna6gLAxMG6aqHvCDotFJSSlSlWGn6f4feMkqIIIOkD23gLaCHCknzgXvzHkUKIKTYD+cZy8lL3/NerkyG1k3IAH6RrOzCXUHzg3Nxbt7wU84XEJB/6YsNoCUeAyhaki1r2tzG7RYXUZlN+i8lEJ2SpSV3vfsPeJGyMzOn8q8aSVZkHHETEmq60i4DqPxJPsR/OI9kHJdmosLmUPOSuv8AepZt4lvUX2v7QqNVEIcUhpdkbgEjTcXNr+kbFhITcFQzKWHW6+kT4cvV7K9UGTUqp2aTM1amMI1rJ88wyRZK1f2gRpV7gHvFjkr1JuLxwU+CX1OzOVeftLp8zMEU2afMs4nV5S06dKh+Rsr7iO88uf3mnfaOhoJzJEM240K+ee2uCtw/ECIh7j/eHTmFndXvAjKBDq49C9hxeCSe/EGAAmCBNuLwIQF1HvaMgAnvaMQbnkiDKiFbbwIQ3v3glp0pJ2vAub3jIe+8CFSz4xvTy3mTkj/SEMBSpIfKTqgnzBtR/drJ/sr2/wDnHDPFmHXsE4hdk320IXr0pcVsFDax+9u0fUPjrB1PzAwnUaLVWETVLqkuuWmGVDZaFCx+x9D2IEcPfiY9ANTyFx67LPsrnKPPBTtKqGiyZpAO6FEcOp7j7EbGOJxumdT1PtAHuP36O/f6r6T/AKQ9o4aqhdgdQ79Rtyy/Fu5A6t105eBVQKTigUtWlN1JTbV72t/dG2cWGYf1kaUk8DYDi0NCpUOZw4+pBcISDYJc5HEaZmlNtqbdmBpc5CRY9uIiZISNF2FfROjkIKdOJKrJ1dGlxlLq0f1at7j2vHg1QW5+keG3LutThtpGrUlfH6Q25dSPmW1tuqWG7WvwriHTRqv+/QpJOm2m9vpPe4iUQudqVTOlaw2Tdq8w3R7S67+IgedJG/8AdGi7Um5RrUpVgdxbj8veHhVgiYmiHUtvAjzFQC/8Ib2IcCSD7AWPGQVcBtZt+hjV0ZastmBSDUppNWS2lsalk3BHH69vvGNPwt86svPqJZSdCUo/6x/hB9B6x6UHCiEJn/2iVMSsuE/LrSTebWT/AFY27Dcw5qW8w4EBCUJS2nSlAFk29BGQHDdZZJHLe2yVMsKVJnEDbFRWxLUl5SDOpfCixNIQrUllxKbFSCffteLJ9UnWBl/kH0sHLGl1mUzMxXPSimJLEcqlUszhunPLDi6ehsHdYN0kkG/eKmV3E6JKTe0p1On6AO8RFilhypTanHQVKUf9/wD3FhFVOawsA81XVeGQyStleTZutuBPAnjpy48V41fE6J6dU4FW1H0/Qfe0ec5XlfIKSEpN/wAX8PJ3HeNRGE33gshtWhPe3r245jxmgJBYZUTcC1ynbvtEQam3TF26Ra6tZcUFG4dNyEm23qdvzjyclPlXGktJJC+bi+nnfjmN2eaD6T4ACSogpKxzzG/SZBTroToSXCRuobD0t/hG2YgJJ8YLtE6MuaYqnUmYfCB4zqtGsj8I3CePzhZqmttTcw9ZbBBQ4gixI3vvaPegWfpy2W0ISto6VW47+0euIaTaRCVjWgJ39uYwC0jVYkY8D3VDmYDL0xJPPMtlEo4VaE31KCd+YivCuF5jFeIksyrAfdQ8VlKtkBI51HsL7RK2Npp2iSLrIT4iUk6Ae3NhxDuyvydw8mam3JSbn3RNsMh5DiAlS3fDBdQCE7oDpNu5AhqnLWtJXKYnFJUTMYRtulnpg6esQYtxDOztAbZJpEkqcmWVL0iYavpKWhputW97DgJJMFi7AmKabW1KlJKZnkpWQUMtqWpPPa0XL6asWz3SD041+ry6UyU9mO38nKPqZ0OOU9lavEcaUU3SHndSVWO6UDtEB4kz6xDWavMM0pSkqWSdDCAVAb+2wHrHPVFWHT2brbdehYThcooS5+gJ92x9bjhroo1ouKahQagWapTahKL0G6XWFBabe1r2HrDpy3ylmM/sSOPGepuH6PKFKZiqVVxYl2AfwobSkuPuEcIaSSNrlI3iU+l7BjWNsZ08PTdYruZdWq7crJ0aXnksyKqWElc2ubmBdaLpCtkcJSTyRGWcuKWanmHPu0ymUyjUeXcVL0+n0xtTclJsJJAS0FXVpVa5UolSibnmH2sjDBIVWXnlldANAOPH0+h20K8q1Q5fCOEhhujvldFamPHccLIafqridkOzNidRQP6tF9DYOw1EmN/Jbp5reeWOKfQKFKiYqNTdSy0lXlSCe6jY2HvDOkpybfmzcEhHY8IEW5+HD1A4DyYxPPYpxTVZCjVDC8suYk2lSxmHKqVbFltBGkr91fcRrTAPmDXmw+yary6npHSQNzOA043PC9lY/EPQxlZ0l/D5xTLY1bpeI69UVuOST1Sp/wCzqhJTiUaVCTWm7jqUqII1eWw9DHKrEgbv4TbRBbAB277c7d4un8Rz4i2EOrujYZZw7QsQUuboqXETcxUZxDiZhCgCEJbRcAhVzq5ttFPJ2oNT6CWtCyRa9rlN/wAonxCSN8gbF8IFhZVnZ6nqYaZ0lZfvJCSQbacNLaWtqmHNuH5hTTgIVa4NrgiNJxluVRZwkAi3v9odU9TEJaDiE3ue4+0JNWw9rfSpSVApHlsNhx7Qm02Vo5pKRHpezXithToAtY7EjaEiqzTrLatIUtRHFrenqNoWasyuTZC9KgGiAAB9O/2jVm5b5sanigjTslG9uP74mYL6qCQkaBNCszz86EqQjSgJCQjsniNCZS4ltCNC0LFjqvdNtuIcM1QSbFSSnzeUd42f6OpUzcgCw2Ftxx2iW9lA1pJTRVXHUTSEG5Isk/5R7M1NyUmnG1EFajfVyO0etTpTcnOBTgGngJRuoxrsU/8A5cPtWcsuxSobp+8b6WUXvA6FLTjqnvDUolTiQALm/ptGcyrQwFsEXdNyO7YFgTxCbKTZMyjxAhSBspBBAA2/xjKnzjko8tshJW4QUm19PFyNt9oiI5JpsnNPvAsw9UGAk+Qyw07D87/pDnVU1LlWzZIJNr23A9YbuCUFib+W8MtrfbBvbYJtv25hUDXywLaU3Q35RqN9vv6RgEjQphoaRcLafTbSqwJG/PaNRx4OOK2UlQ40i9o2AWxKK5FuRbcGCXLhpCEqWWyUE6hzeMgocRwWiqYW2hRuARyT3gv2mVtpuAoEf/rGIlPELxLhJbGpIUm2v7RorQll1TgdSSeEjt7xM1oKUc9wSk8klKVlQFxpCANheMZQrS5pB1W9RewjXkJtD0kUOKSlaSbFXHraPOTn1OPJUlCkeITZKd9Nv8I3HJbxuGhCmnpfxYvB2ZtNnG1aFNugkp22vf8A1j6ccr6quv5eUCoOG7k7TZZ9Z9SppKif5x8yfSjl1O5jZqUSjSbJcm6pONSrKUi51rXpH6XMfTngmkIwzhmm0to6mabKtSjavVLaAgH/APzDuFXzv5aLz7+qBZ3dMP8AV73pp90sQIECLteRIja/vBp2vvBFJI7QYSPWxgQi21cGDOxv3gE2tvtBEb/5QIQQbxkCAd4LZQta1oIkX2G4gQjI1Khn53ZH4ez/AMv57DeJZBE/TpxPl7OSzg+l1tXKVp7H8uCYeABJ3FhA2B4vEcsTJGFkguDwU9NUy08rZ4HFrmm4I0II4hcL/iJfCexhkDMTtXl5VdbwulRUzVZRvV4SdrCYQN0K/tfSfUcRQXEeE5ykOFKwFA8EDYj2j6xZyns1CUcZebbdZeSULbWkKSsHYgg7ERS3q/8Agg5X9RQmajh9LmBK6/dZcp7YXJuqPdbB2H3RYxy8uCTU5zUxzN5HceB4+a94wT+rNPWRCnxxuV407xo0P/Jo2PVtx0C+feVbmGVFIUmyiL35/KF2i1MSb+v6hsNJ7+l4t/1J/A1zryUmXn6RSZHHNNRcpfpDwS+R7suWN/sTFTMe5S4qynmlNYlwvibDy07K+fpbrST/APKxT/OF21IacsgLT10XTEU1S3vKORsg/wBpB+W48wlVUwmeYQ4kI1HkJ2tCdWJs0+XQmwKlG4BHA9eOYbUpjaTl0qUmbYUpA+nxBe/2jKn1YVt0OOuFwLULnm3v+UORRh5uqerrDCzKN09zQv2hlfMKQgFTrviNLI3Q4kbEbdxsYimUxSt8lCh4LiDZQG247RYCQoi2MDJkx5igatQGyri8V9zEoKsO1515KCWH13O30q/1hiWJt7pOiqX5bXWU3PJdmvOslD4uLjiM5GiNtP8AjPoDqAb6VcH+zCbT3g4QXhdKTqT7KjcfrqTLLTpUF2sBbaIsgCs2TX3XjjLEZVLqBbl3JgqJWsJKdCNwEADb84YVWfbnX1Le0NtpuEtoG5Ppv/fCvieYSpD1rpK0+bV+E2NjxDSYkFToCVv3Uj6lrvpA339fyjSxumA5pFrLBx4OTiWrlITdQIF7HeFmlNuvTDYlEuOhZspaxub32JttCXNSrbSHQ0W3nkbB1AISpO+9jwYcuWj3zE9Lsu6vCccsQDYKO+9u5F4ilcbKSGME2KlBmiM4coDDSdC3XBqWu31q3v2/KEarVouSy0qQEBAPrdQ33hYrbXhyelCtVr2ST94bVUkx+ypmYWsqCW1Eeg2O0bRtBCWrJnN0amGzS149x9J02WkZuoeZyYdZlWlOueE02pxZ0gE2ATcm2wi2OTfw78R1OlOyOHHnqzXZGTkpx9kyvy3jvvsqceS2tdkhMsnZRUQVhJITtEC9GFMXS8Yt1+UxDMUqtOqnZEfLulpyVllS9nXVK/EHAtSAjvpVFlql1PftGZZl52pVl2j4Vk3P2JLIUE/NTmopQt4j8IC1kk3JACeIxPO2MBoF0rh1FLU56guAI0Gl/O3HluOJWz8QbHDeIMdy9BlJiks0zDMk1RaemmrUqQbbl2tJLRULlK1hSrnuTFOJ+svJfVbxEarg6VEFXsbQ9Mw8bO4hqLi31Fa1klR/iJJv9heE+g4HGL3lTK/DMu0tCFtkkLnFqNktNpAuq5+q3A94o4GHMXuG+q7CpmyRNp4jo0Afv57p79MqZvBrLuJW1uy0xPNrlZRxF0qDR2cWk27/AE+4hfxBU1PTi1AeVP1DufbiHZmEmn0XC9LpknIKYqtNBbqC0jTLsuW2YZTbZKRyTuTEW1yoFlKwXCHDsQfxQ28a2Cgp/diu4WJWU1X1zLqrKKE8egA9DClTsWv0Gk1CQZmpZUtU0IEylpKXPFCDqSnWU3TY7kJIvDS+b2GoFSj2A3jWm50TT+luySNiPX+UZDStHSA6FLS6mp1R1HyE/b9YKm11LcytDawNW1yNvfa0JAm0tMLGpSyPwnkx4SSGjNKVdRcSAUpA2VfjtGzdN0vI7NsnyVOqSlw3cTaxHdJ9eI8np3UzdWrQBwNwkfaNDDtUdt4aylItZN+38o3pqoMSLVlaCo725tGwsVGXFoSDWvCnEuJSVNtgX3G5459o0V0xDTZKXdG17jaNmrEKY8ZCQA8fp7ISLf4wkOuLd0pVqCPb+6JALbKDPfUhajrnzE0UqP8AVpsLjYRkKshLrYUd0ixJ/KEmcc+WqqkqcV4R337CM0vhlwu6ULbP0kj7RsVCw3KUKjTZdDpcUlJ8TdOkX1jb2hNmZVDbIUlhtJcGq4vunaFKTBnJUOeUJSLAfwj0g6BQTVlaAlS1LVa54SL/AMhEYe4mwU5Y0C5TcnZUTehLCPFcWPMEC6hxa8PHDmC5MPMTM6CXEJGlseu1rw55HD8jQ20pYS2hwJ3UE7k7bwlVOyn0FSghV7i2wtEuXml3P5LKbr7EgpfgNgK4BtuITkYlU7ffTbue0Jc84tZWlQDalKJKr/UP8I10uENqB81triJMihE9uKWUVol8alK8LhVuSY2zXkvMpbQU+Q6itXAhqkPFN0p2AvY9x/lBgzBdu2lCU8XVyI2EBOt1qa0DgnE9iYtq0AAIULgg7RoKmzPPEpSdXYgcx5U+jqmAVOL2Tvb1hzU+hNIZCkII1b7/AN8SABuiyzPJqNklSdFmXwkKCQVC9/SHFRMLKdUhASpRSb3A7+se1Poy3VhIBCosr0L9FmK+q3HjFOoMioSDDgE9VXEH5eTHcA/jX6JH5wvNMGEAak7BWEbGRxmaY5WNFyTsFYn4KvTJNT+b8piyYlCtNKB+WJTs2si2rjkDj7x2zpTJZkW0nkACIn6VOlSh9NmXchRKW1f5ZA8R5Y/ePL7qP3MTCkhtNrR0GH0zoo/f3O68E7WY2MTrjLH8DdG+H77oQIF/YwIfXMItUGd9oLTc7bQBYHcwIR30/wCsEb+0BSj94LQTAhZJ8o4gEgQQJ9oM2UN73gQgASNt/vBBJJ32gwdIgikkXvAhH4dhe5gcg2MENR/KDvvbaBC0qhSm5tBuBcwzMYZXytdl1tzMuxNNLG6Hmw4kj0sQYkAp1bGxtHm4wHRYgWjVzQ4WcLrdkjmG7TZUpz2+FpkznW28cQZbYbedXe78tKiWe++puxvFSc1P+H4wLTA9MZf16t4cfVciSnnDOSij6ebzJ/Ix18nqCiZSfKDDSxPl+iZSpSUWPraEzQQg3a0Dw0V7T9oq1gDTKSBwOo+a4K589PmJOlOeZoGI22FPqYS+0+woraeaO10m38jxFdMyqUzUVrVp1Nuiyhb17x3N6/OitHUdlM9KyrbaMRUgqfpjyxYLv9bCj/CsfoY4v5h5Z1TANenqPV5R+Um5R1SFNvJstJ7pMKStyuyleh4HiHtcIcD7w3Cr/Uae7QlWUpS272Qe9vSBKzKnJhCrbX9OYeuJMNBTmhQ1IULccQy5+Vco74bcFkq+lQHIhV2i6uFpcNUnZhyX7TlluaglVwSALXt2hiT05Z3wxxfzEf3Q/wDEg+Yp0wq2yGioEdrDiI4+bZCNKWy44sXWpW36RESnsuUaLP5oUyaKllxLS07KCL/73h0ZXTfj4vldSrtsJW7bgXANu3NzDTnp5ZbRuC2drWuQd9zD+yvoSKVRlVCbASuaGlsEbhHb8zEbgOKjzu2anlO1EvLsLgq+k255hj5sYybw3SVyDawZqbTdSR/0299z6Ew96GUVZhyZcHgSrCiC45sFkX2EV86gK7L0vEcy5LKcmDNr1pW79S7E7/8At7CMMkzOyMCWrQIoTPK6wT8yKm3ZV96bsUpDW23Ynb9P5w/anUHFygCQQFbC/I52+8Rx00Zj/wBKTNtTMuxpsELaQLaBY6VD+78otphrCdGwRlRM1CaknHKvV2XBLPOs60ttXCfBQCPK6q5V4m9kpIHMQzAl+U6WTeGyt9mEsZzA7fzooXomTGJ8asick6BWJmTJCBMiVWlhRUSlKEuEWUpSklIte6gR2i3mT/RRU36tg+l4PwjW6piB1luenK3PM+DJyzm6yiXCh4aEtbJcdUSpRuRa0N/A/UlWMsmMLMSiKjMOUKnJlEyrlTX8s9pVMlpwp/6Xh/MLIQm3mOo7xOXRngDHvXbPYfysmsxZHBuCMLMuPJlWnrTkw24slwNpuC+6b8rJCR2MZZDG5way5J8P4FHU1U8bDNMWsa25J1OmvAb8NNN+i3a/0x5HZdSNdrOYGZTbjFGmfGekaVL3exQ/YqUxILt/6fVZC5g7FQVYi0c8sxsVyGJ8b1SfkaXLUORmplbkrTpdaltyTd/K2FKuTYWuom5N4s58S7KmYyOzqm8LqVT1IpEuiTQiScK0MJRcISq4GlwospaR5bk2imNcZdWpzwwq9/rtsmIZfjyZQLKxoYcsIqO8MmcAi9rAdAOfXw2SuKgHtRSQgtDYn/fMagUlokgq8T6htwb9/Uw3vnn5VxCVEhTg8pI2MLVCZcmJ0gla786hsD942AAF1tfOUHmZqbebSmzeo3JO5T3t+cKtOkXFya1q8PUN/ObH8vWDUptPlTcqR2UNk/aNeZn1zCAEFCQjYjvGmYlZMbWardlJsuPpul1YRsbDcH0hSZnmJguhbdy2i6Ra1/S8NiXmyw5r1EEj6gbXELMs6wuVC0qBcWLKPP6xoTZYALghOVAsggoG4BsRCRPzy2pVSSnQlfmTbi4ttDmm6GwZfTMhxxx6SKpfwnNKmHioaVOC26bA7e4hDqMu6WVsoS2GtCmkBSbkpO4P3vtEsQLkrNK1gTNmJwT8+grcACN7n8uY3qe0288popUlJ8wvuDxeG54Bca8c3Cknf15tvC3L/uWEui4sBaMudZRMObgnRQcLlwrUlRQzbYubG+0LEihuiseG35CfqP8AF9/aE+Qqi2KMx4iQStIKVf4GNSaqbkyUBAK7cBIuSduYmYLaqGSTSxSjUsSBlk/SFA8nmEdFSmazM/u9KUJ21kbD1t6xkihLnVBcwnSgG5QFXJ+5hWkKcHFJCEhITxtxE7Wk7pR7yvCWw6hyXDmnxHO6lcxrVCRMmLlI/wDaBzDulZVqn05b8ytLLTYub7D7mGRVsw6bUagWpRL846TpS3LtKdJ9thE2jRcpEuJdYLNs+IwSkIseNtxGLVNStaVFR9x2EP8Ayl6W80s85ptGF8usSziHDYOuSxZb+91dotjlH/w/uduYKGHa2qhYTl3ACovPF51A/wDamNG1DXaR3cegupHvhhGapkazxIB9N/kqV0mlIWry9xz2h+5e5S4pzVqTVPwpQaniCbKtOiSZK0pP9pf0gfnHWXph/wCHVy+wLOMTmNalU8aTbZCiys+DKA/+wcj7x0Dyj6ZsIZN0ZmQw9QKZSpZgWSiXYSi36CN20NVKbkZB11Pp+6qqvt1h1G3LTgyu9G+p1PouTvRD8A7FOOZ+TrOacymj0sELNJk13dcHo456eoEdcckOn/DGRGEJSiYapEpS5CTQEIbZbCfzPqfeHtKSSJdACUBIEbASLbbCLOkw2GA5hq7md/28l5zjvaqvxQ5Z3WYNmjQfuepWIQEjbb7QZTcXsINKtJ24girf2iwXNoWT7QIOBAhEDYdhA097iAopIgtWoWgQstZtsNoLkXJggLG3cRkPc2MCEDa3vAF9Pe0ENzxBpNrwIRagL8wYQLQQ3PEC5UbciBCMKvteCKSfb/GDSm/beATbk7wIQ027QZSD3sYIKPfaCBF+bwIQV9wY83pZLyd7bx6kC+390DSQbWgQm/WsKtzyFDQCD7cxTj4h3wxJHqfoblUoaZanYtlWyG3Vps1OpHDbhHB9FdovMpNhuLR4vSiJgbpBH2iKaBkrcrk/h+JT0UomgNiPQ9CvmDzyySxHkhjecoOJ6ROUyoyqiFsvt2Kh/Eg8LSfUREGN6QJqVNgq17pUBuPePqK6i+jjA3U/hhym4sokpUkaSGnlICXpc+qFjzJMcq+s/wCAni/AMzNVDLtf9K6SNSxJOqS3PND0ST5XP5GKKeCWHVwzN5j7hew4F2soK60Uru6k5ONmnwdt5G3muQuNJSqStBdZlWlTKnxpUpHKU/b1hkigzDaEH5SdL9rKSWjpB9otbmd04Ykyyn3JevUKq0SYbNiiek3GT+RIsfyMM9rCDrmyXmEG9vquYS9pidq1wXcNpHDUjRQrRcv6pWnQkSboSogqW6NCQPziUqbllMVqoB5U08iXSA2hhtPlSACCL+ph3UfLyZm5pKGpaeqKzwlhhRBP3MS/l10vY4xeylqSoM5LhzYaWVOO2/SwiLvWk2vdL108FOy97FV+zRqS8FUJqTpsgzUqs4NDMusXbYG/nXb09O5iFZjpwxTmBVnJ6oIfnJ6ZN1EI2HolIGwA7AR1ryU+Dti3E82l+epvyKXTqcdmd3FRd3p4+ExhfAEs2uflGp2at5lLQDvFlTwSuHuCw5ry/GMZie/NK+9tgFwGyC6FMcUPGUpNytJmVNvHwnWikp8VCuR9+4+0TvjgYpotJEjOqXMOUpr5OSlnBYSqATquLfVzv7x3Xq3RzQsJgPytPYAb3FkDaKFfFK6X0YTrDGMKPLaJKqHROJQmwZmEje/oFjf73hetoSwiV504q47KdomvcaNgtfUeP/S56ylTfYSEvtvKeIupdr+IfUmHRlljWewZi+UrUhOOy09Tl/MMvNLKFslPFiNxHhNpZfnwXLJUk224/P8AvhZqODmnaCmYlm7LfbUEOX377H1vCMwLBdq9ApiHuyvS31RdXGI+qmdM5iBml/tBTSGHZ1qWCZmYQi4SlxQ+o+/J7mIFckpWWZKFpAeeWUpSdybc3943qu6uUURqWkDykBVj6WhnYtnF06ZUhsOJukFOrZQ/zhBr3Ofdx1VpHEyKMRxizRsAlCu4OlQ2hEx4aGidV0rBW2fTaEtzwqK0NLilJvYAH+8Q3Jibesl7x7AXFgrzD1vGtM1hc2yUJeSoJ+kdodDL6EpN8mUkgJVruICy2XkEflCa3XVTTJSdgvuOTCTMTAfc1LW4EJFvMOT3tG1hylCqzpaZSq+m5KlbJ+8S92ALpF05cbnZK8gl95gMhXkcUCdXKQO8PDB9DRKSxdWohVyW0q3ATcbn1vHhTqfL0OTQhIS47YalKHeM5StKmJqydKktqvtuAf8AGMtj5qJ0wGjSlWoTCJG/iqSFkb33Pba0NyoT8zM6fCZQytKrh129zx2hdp9Ocn5hS7FSibqWreNeq0kiYQq30cD9OYbij0VNWVGqZTWCZtwWaMu4krKiVEpNyQSLQorwfPzCQkol202GwXcA7Q55ChurKlkoBUb27CNhFMdH1A34uRxEL6cXTdPWXbZIFPoT8hTkMOzJd07kBNgB6X9I3ZGQZl21JCCnVzvueIVE0dekJU422o91KESVk10tYxzcmW2cO4WrFYWsgeKmWUhkf/IixEBkZHYOK2cy93nQc+HqowYpy1tjQ2SrgbQu4Ky7rWNaq3IUGlTlXn3VBOiXbJSg/wBpXAEdIulP4Cdfxi5Lz+Ys4mlyeyv2fLHzq9lK5jo7kF0EYC6fqSzL0CgyjK2kgeKpsFRPrD1PTzyi7W2HM/jf6LjcX7T0dMTHG7O7pt67ei5N9LPwJsTZxmWqWZEyqQpWyxT2rjV7K9Y6L9PfwsMp8jpRhNLwfTHZhoD968wlar+u4i2NPwa0wAPDCQOwG0K8lRWmB9I2i0iw6FmrxmPMrz6t7RVc5NnZRyGiZOG8rJSiMpalZRiVZQLBDTYQB+kOmSwo0yAClO0LQZShOw/KD2CdgIdAA0CpHPLtSteXkEMJsAAB6CNhKEp42+8AnUNoJNx94FojV5juYBAT62gXvztBjzjiBCF/TiAlQUd94BATtq/lBIt2gQjsPQQIECBCxQb9oMm+xA/KAbdjaCBFtgYEIKFh6iAnZe0A/rBpAJPaBCASSebQegau5MBSoI3A3tAhZBBJ9oJVibbwEcc2glHf3gQgU+Ge8Am+4gAahuYGoD8oEI76+1oChcekYgahtsIyBvzfaBCCSSORaCT5CIMkaoJVyrYG0CEajq47wViR+GC2vsN4ySVH7QIRKFxvHm/JoeRZSQoHkR6KTY7Wgyq+xECE1cT5W0nFbemdkpSaT2D7KHQPyUDDJq/SZg2eWS5hTDLxO91Utm/8kxMGjaCUhKhuN4jdEx2pAU8dVMwWY4jzUKyvShhSnKvL4XoDJ/sSSE/4Q4qRkxI0/SGZOVl0j/ttJT/cIkYtpvuLf4xkEjtaBsMY2aFl9XM7RzifNN2SwMxKtbJFx/ON2Ww6hlVwBCoLAkWg1Aj0tEigLiUlzuHWptpSFJBBFogvqJ6dKdj3ClUpE9Jiap1SaLbqBsU+iknspJ3B9RFh7a7+8adQpaJ1JDiRv6xpLG2RuV2yYpaqSCQSRmxC+dTrP6DsxenHEM9NJpM1iXDRWpbNUpzBW40i5ID7I3SodyLgxFWTuM0YjosxRHnx47bhXL6tlA90EHcH7x9J2Ksm5GuIUS0jURzb+UVh6hfhKZX53VIztYwo3JVIG6arRj8nOoPZV0+VdubKG8UM2GysBEZuORXquF/1AgeGitaQ4f6m/cfg+S4JZq4ceTXHXGVradvZaD9C7e3YxHmLZ5bjyEzLa2loFhqHkV9jF5ut7oTxZ09Y2mmqpT52YpKXCmTq6GCqWn2vwqUpN9DlvqSeDFbKjhdt5C2nWGphB2KSApP+hihLWh1huOC9VppxPG2Vpu12xGoUJOttS5UspOpY3F73hNcUhts+C2lO9ye8SvWcuKS6z4Ql3WLclDhuPaEd7LmkMPXDMwsAbpW7yfWJI2yHgsVAjB+JRtMOtOPoA1HbcHc6odOCKJOSqX3ksFhLwCUqdG9ueIeNEwzIybgWxJtIWnYK03I/WN+cbYbIDrzKFnYJK7qPtYbwy2NwN3Ktmc22ibTVFW48VuOLmFDcgmw/SFCm0VSFjyhIvwBYfpEr5OdJmYedsw03hXB1bqDbpAE07LmXlx7lShuPtF4emj/h+sT4telpvH1S+WlzZS5OUuhP2Us+Y/lDcYz+7GLn+cVzWIYpT0ovM8N6cfTdc/cE4Tr2PplFJwrR36rUl2TdKCWmPdav8IsVkz8BfNPN5TdQr2J5ykIfspSGwEBA9ALR2U6cvhy4G6eaKxKUekSyC0B5/DFyfX3ic6ZgNmUbShLSUpTsABaHo8Lc7WV1ugXAYh2xc5xFM3TmfwuTOWn/AA4tApcu2a1mBi6aXtqSytKU/wAxEt4b/wCH1yblAj9oP4tqpTz41RKQf0EdHWsKsNjdIjaaozTKQAhP5wycKpj8Qv5n8qn/AP1mJgWZLbwAH2VRsnfhK5KZPzbb9JwDS3ppr6Xp0GZWD6+aLE4ZyukcPy6GZKQlZNlAsEMspbA/ICHs3Kob4AEeyWUhItvDEVJBF/42AeSqqrFKupN6iQu8SSk6n0JuVt5ReN5phKAdoyuRtx94FynaGLpAlZJbSB2glJB4gk3v3P2jM7m4G8CEQIAsQb+0Yk3NuxjLbk8xjbfftAhGToTtBd+4gwQob8wAop/0gQj8QW3BvAAsYK1zcciDJuLW3+8CED6kbwAT7bxj9/0jNKr7DeBCK49RAgWHoIECESVBI3EFffbiDBud4Ft+IEIDzdoFr/igym/t9oxNvUwIRkFPa8Am/MGb2grm/aBCPv7QWyoyKdueYxCb+0CERA7cwewG4gEgH3gzYj/OBCGnbaC4PN4JNz3jIJ+14EIleb2gjcHk2g7m5vxAF1Ha0CEV79ozSu6YxF79oO1u5gQiUQff7QE8ciDUQna1oIIsO1oEIFKiduIMCw3H6wLBXF7iAfN3N4EIknV2gaVX2G0BItzAAIO2wgQj2HsYx9r3EZFPraCANt+IEIJsL2F4O4PJgh5Ad4AVtxtAhAN3HYxgtlK7gpBjMm49oCtxAhIOJcBU7FEk7LzkrLzDDostt1sLQv7pIIP6RXfNz4TuS2a7rrs/gSksTLt7zEiVSbl/XyG1/wAotNewta8AoChuBEMtPFJ/5Gg+SdpMSq6U3ppHM8CR9FzXx3/w7GWOIXFKpVdxjRL38iZlEwkf/sAYaDX/AAzeD3ZkF/MLGKkX+lLLKSY6rGXRbiAGUg8QocJpSb5fmfyrxvbXGQ3L3xPiAfsucGCv+HAyYoriV1WexdXinlMxUPDQr7hIiwmUPwo8j8mHGnKNl7QUTDNrPzDPzDn31LvFnFIANrCBYJFu8TR0NOz4WDz1+qr6rtDiVRpLM4jxt9LJuUPLmk0JhtuUkJWXQ2LJS20EgD7CFxmRbZTYJA+wj2tYdrQYKbe8NAAaBU5cSblEEbcWEGRpT9oCU+toO3pGVhEndO5gCwOwBglJI/ODFinbmBCBABgweLQRt6bwEnfiBCBUCbwZHcC8BRTBEk9rfnAhAXJ4t9oNKyk2O0F/Iwd97EXgQgpQV3gXsIGkX7WgEjtAhC4J5EEbEm17waub7iDI7i8CERIA7XgAgb7QSRq5gyCg7QIRc7wArUOwgWVztAF/aBCO3uYECBAhECQdgBBlRPJgwq0Ync7CBCLSL87xklIB/wBYKwH3gDnff2gQsi5YWtGAN1wZ83BgeGU/74gQjNrQLki0Fb13gFW+w/SBCM2SOD94AG3IjEk33NxBq3GwgQgb/lASdNrEQeoERjbzcbQIWdtrneMdVlQSTY+0GAD6QIQWLwQ8ve8GE77H8oFgo82MCEX1m3EGdjY7waUewMEo32tAhDnvtGRtbvBJ2HfaALnvtAhFbRxGXbiCCh22gKPrAhAAn0ghdPvA4MGVe8CERJJ7QZOkQRIA4gAknfiBCNI7G0DTbuDBABJ2NxAtvsdoEIwe8EfPvAOxg7DVtYwIRK2EBBuNtoNR24tGJ52/SBCO9h6xiNj94zTcH0gHzHiBCLSB7QNzxAPl5F/vBDcdxAhGLW25g1JuIIGx4gyAobWgQivb1MAHUfT7wd9oJO5tAhA8wAnfc2gwAOf5wLavQwIRnyji8BKb7wRB7G0CxTyYEIKG8DSSNjeC2vzeAEknYWgQgTbtvAG25/lAWq0BHmBvvAhGd+DBG43EGBv2EFqKTubwIQUSrm0GklI3F4K4v6wCqw7mBCyNyNrCMdzzaCSNRMZ+GBc9xAhFAgQIEIvpPHMDUb7QZAI3BMY3sRbaBCASSb7RlbbiCItxAteBCANt+8Hc9zBj2NjBfVzzAhC1h2gjb84BST3giAOxvAhHbjtAKFEdoJKe/EZKVb3gQgeOIIeb2gWtvAJB7GBCCkn2gydI5ghvza0H4YIuDAhBNhc94Gk+1oAuRbaDJsLEjeBCLXvsYO3MFuk22MAE37CBCMAGCPlG1rQCD6QNhAhBKfyEFex23gwR23gWA7QIQ1G/FoCrEwAbiC77AQIQKL8QAdrQRVv7wYBI5tAhGBcWsIMpPptGItbY7wZuQN4EIibnbmDBt94ASL3EAkA+kCEAoknvBWIPaDKb87/aAqxHpAhCw/OB4mnkQX2uIFr94EI0q1QXJta8GW7i99oIDbY2gQh4SrxkUkCCTYm3MZKATAhYo39oJdwQIAV7QRB+8CEaATzBlFjzBpNhuYJRvxaBCBSCNoHpABsbEXMC5JtsIEIEwFpPN9oGmx5gyCDe9xAhYKVttxBpUBztGQTfeBYJ5IgQsTdfG0EkgHeMgBb0ECwG4gQhp72EGD7CMTzzeDMCESxdW20AbbHkwZMElJAgQjgQIECFkngx5q+sQIECEbn0iDTwIECBCyT9BjAfUYECBCzRzGMCBAhGj6hAP0iBAgQsUcQcCBAhY9lQaPpECBAhBH0iAfrECBAhAfWYzXzAgQIQ/wCnGMCBGELBH1CPUfQYECMoWCeTBwIECFgj6hGS+IECBCwj0a7QIECFkfoEeSuTAgQLCyRxBL5gQIFlBX0CMoECBYWZ+iMBxAgQICJrmMneYECBZRn6BGCeTAgQIRwQ+swIECF6fj/KPP8AH+UCBAhHBj6TAgQLAWSOI81ciBAgWwRq4MF+D8oECBYWKeRHqfoECBAhYwfaBAgQigQIECF//9k=',
        gizzards: 'data:image/jpeg;base64,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',
        hearts: 'data:image/jpeg;base64,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',
      };
      const driverProductPhotoFor = (productName, isWholeChicken) => {
        // Keep the existing hearts image only; show labels without photos for the other product types.
        const name = String(productName || '')
          .toLowerCase()
          .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
          .replace(/[أإآٱ]/g, 'ا')
          .replace(/ؤ/g, 'و')
          .replace(/ئ/g, 'ي')
          .replace(/[\sـ_-]/g, '');

        if (/قلب|قلوب/.test(name)) return driverProductPhotoData.hearts;
        return '';
      };

      const buildProductTable = (section, title, firstHeading, firstValues, secondValues, firstIsWeight) => {
        if (!section) return false;
        const names = Array.isArray(firstValues) ? firstValues : extractNumbers(firstValues);
        const quantities = Array.isArray(secondValues) ? secondValues : extractPlateQuantities(secondValues);
        const rows = Math.max(names.length, quantities.length);
        section.style.display = rows ? '' : 'none';
        if (!rows) return false;

        const table = document.createElement('table');
        table.className = 'driver-product-table';
        table.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;text-align:center;direction:rtl;background:#fff;border:1px solid #dbe4ee;border-radius:8px;overflow:hidden;';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        [firstHeading, 'الكمية'].forEach((label) => {
          const th = document.createElement('th');
          th.textContent = label;
          th.style.cssText = 'padding:7px 4px;background:#edf4ff;color:#173b68;border:1px solid #dbe4ee;font-weight:900;';
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (let i = 0; i < rows; i += 1) {
          const tr = document.createElement('tr');
          const first = document.createElement('td');
          const second = document.createElement('td');
          const productName = String(names[i] ?? '—').trim() || '—';
          second.textContent = String(quantities[i] ?? '—').trim() || '—';
          [first, second].forEach((td) => {
            td.style.cssText = 'padding:6px 3px;border:1px solid #e2e8f0;white-space:pre-line;overflow-wrap:anywhere;color:#111827;font-weight:800;line-height:1.45;vertical-align:middle;';
          });
          const photoUrl = driverProductPhotoFor(productName, firstIsWeight);
          if (photoUrl) {
            const cellContent = document.createElement('div');
            cellContent.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;flex-wrap:wrap;';
            const photo = document.createElement('img');
            photo.src = photoUrl;
            photo.alt = firstIsWeight ? 'الدجاج الكامل' : productName;
            photo.loading = 'lazy';
            photo.style.cssText = 'display:block!important;visibility:visible!important;opacity:1!important;width:38px!important;height:38px!important;min-width:38px!important;max-width:38px!important;object-fit:contain!important;border-radius:7px;border:1px solid #dbe4ee;background:#fff;flex:0 0 38px;';
            const label = document.createElement('span');
            label.textContent = productName;
            label.style.cssText = 'min-width:0;overflow-wrap:anywhere;';
            cellContent.append(photo, label);
            first.appendChild(cellContent);
          } else {
            first.textContent = productName;
          }
          tr.append(first, second);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        const heading = document.createElement('div');
        heading.textContent = title;
        heading.style.cssText = 'font-size:13px;font-weight:900;color:#111827;margin:0 0 6px;text-align:right;';
        section.replaceChildren(heading, table);
        section.style.cssText += ';padding:7px!important;margin:0!important;box-sizing:border-box!important;min-width:0!important;';
        return true;
      };

      const chickenSection = node.querySelector('.chicken-section');
      const cutsSection = node.querySelector('.cuts-section');
      const chickenWeightsList = extractNumbers(chickenWeights);
      const chickenQtyList = extractNumbers(chickenQtys);
      const plateNamesList = extractPlateNames(plateNames);
      const plateQtyList = extractPlateQuantities(plateQtys);

      const hasChicken = buildProductTable(
        chickenSection,
        'الكراتين',
        'الوزن',
        chickenWeightsList,
        chickenQtyList,
        true
      );
      const hasCuts = buildProductTable(
        cutsSection,
        'المقطعات',
        'الصنف',
        plateNamesList,
        plateQtyList,
        false
      );

      // Keep both product tables side by side on the driver's invoice.
      // RTL places the cartons table on the right and cuts on the left.
      if (chickenSection && cutsSection) {
        const productsWrapper = document.createElement('div');
        productsWrapper.className = 'driver-products-tables';
        if (!(hasChicken && hasCuts)) productsWrapper.classList.add('single-table');
        if (chickenSection) chickenSection.classList.toggle('is-empty-product-table', !hasChicken);
        if (cutsSection) cutsSection.classList.toggle('is-empty-product-table', !hasCuts);
        productsWrapper.style.display = (hasChicken || hasCuts) ? 'grid' : 'none';
        const firstSection = chickenSection.parentNode === cutsSection.parentNode
          ? (chickenSection.compareDocumentPosition(cutsSection) & Node.DOCUMENT_POSITION_FOLLOWING
              ? chickenSection
              : cutsSection)
          : chickenSection;
        firstSection.parentNode.insertBefore(productsWrapper, firstSection);
        productsWrapper.appendChild(chickenSection);
        productsWrapper.appendChild(cutsSection);
      }

      // If the template has no dedicated section, keep the product data visible
      // rather than silently hiding it.
      if (!chickenSection && (chickenWeightsList.length || chickenQtyList.length)) {
        const fallback = document.createElement('div');
        fallback.className = 'driver-product-fallback';
        fallback.textContent = `الكراتين: ${chickenDisplay}`;
        fallback.style.cssText = 'padding:8px;border:1px solid #dbe4ee;border-radius:8px;white-space:pre-line;font-weight:800;';
        node.appendChild(fallback);
      }
      if (!cutsSection && (plateNamesList.length || plateQtyList.length)) {
        const fallback = document.createElement('div');
        fallback.className = 'driver-product-fallback';
        fallback.textContent = `المقطعات: ${plateDisplay}`;
        fallback.style.cssText = 'padding:8px;border:1px solid #dbe4ee;border-radius:8px;white-space:pre-line;font-weight:800;';
        node.appendChild(fallback);
      }

      const legacyDetails =
        cleanOrderNote(firstValue(
          order,
          [
            'order_details',
            'orderDetails',
            'details'
          ]
        ));

      setText(
        node,
        'order_details',
        cleanOrderNote(legacyDetails)
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

      // Make the driver's note easy to read on a phone.
      const driverNoteElement = node.querySelector('[data-f="note"]');
      if (driverNoteElement) {
        driverNoteElement.style.setProperty('font-size', '19px', 'important');
        driverNoteElement.style.setProperty('font-weight', '800', 'important');
        driverNoteElement.style.setProperty('line-height', '1.8', 'important');
        driverNoteElement.style.setProperty('white-space', 'pre-wrap', 'important');
        driverNoteElement.style.setProperty('overflow-wrap', 'anywhere', 'important');
        const driverNoteRow = driverNoteElement.closest('.info-item, .order-section, .detail-row, .field-row, .product-box, .note-box');
        if (driverNoteRow) {
          driverNoteRow.style.setProperty('min-height', '58px', 'important');
          driverNoteRow.style.setProperty('padding', '10px 12px', 'important');
        }
      }

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
        let totalRow = totalElement?.closest('.info-item, .order-section, .detail-row, .field-row, .product-box, .total-row, .order-total, .summary-row');
        if (!totalRow && totalElement) {
          totalRow = totalElement.parentElement;
        }

        const labels = totalRow?.querySelectorAll('small, label, .label, [data-label]') || [];
        labels.forEach(label => {
          if (/الإجمالي|اجمالي/.test(label.textContent || '')) label.textContent = 'إجمالي المنتجات';
        });

        const feeRow = document.createElement('div');
        feeRow.className = 'delivery-fee-row';
        feeRow.style.cssText = 'display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin:8px 0!important;padding:10px 12px!important;border-radius:12px!important;background:#fff8d9!important;border:1px solid #facc15!important;color:#854d0e!important;font-weight:900!important;box-sizing:border-box!important;width:100%!important;';
        feeRow.innerHTML = `<span>🚚 رسوم التوصيل</span><strong>${escapeHtml(formatTotal(deliveryFee))}</strong>`;

        const grandRow = document.createElement('div');
        grandRow.className = 'delivery-grand-total-row';
        grandRow.style.cssText = 'display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin:8px 0!important;padding:10px 12px!important;border-radius:12px!important;background:#eff6ff!important;border:1px solid #bfdbfe!important;color:#1d4ed8!important;font-weight:900!important;box-sizing:border-box!important;width:100%!important;';
        grandRow.innerHTML = `<span>الإجمالي النهائي</span><strong>${escapeHtml(formatTotal(orderTotalRaw))}</strong>`;

        if (totalRow?.parentNode) {
          totalRow.parentNode.insertBefore(feeRow, totalRow.nextSibling);
          feeRow.parentNode.insertBefore(grandRow, feeRow.nextSibling);
        } else {
          const fallback = node.querySelector('.order-card-body, .card-body, .order-content, .order-info') || node;
          fallback.appendChild(feeRow);
          fallback.appendChild(grandRow);
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

      // Villa gate photos: support multiple URLs while keeping compatibility with the old single URL.
      const rawGatePhotos = firstValue(order, [
        'gate_photo_urls', 'gatePhotoUrls', 'gate_photos', 'gatePhotos',
        'gate_photo_url', 'gatePhotoUrl'
      ]);
      let gatePhotoValues = [];
      if (Array.isArray(rawGatePhotos)) {
        gatePhotoValues = rawGatePhotos;
      } else if (typeof rawGatePhotos === 'string' && rawGatePhotos.trim()) {
        const rawText = rawGatePhotos.trim();
        try {
          const parsedPhotos = JSON.parse(rawText);
          gatePhotoValues = Array.isArray(parsedPhotos) ? parsedPhotos : [rawText];
        } catch {
          gatePhotoValues = rawText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
        }
      }
      const gatePhotoUrls = [...new Set(gatePhotoValues.map((item) => {
        if (item && typeof item === 'object') {
          return safeUrl(item.url || item.publicUrl || item.gate_photo_url || item.gatePhotoUrl || '');
        }
        return safeUrl(item);
      }).filter(Boolean))];
      node.querySelectorAll('.gate-photo-btn').forEach((button) => button.remove());

      if (gatePhotoUrls.length) {
        const gatePhotoBox = document.createElement('div');
        gatePhotoBox.className = 'gate-photo-box';
        gatePhotoBox.style.cssText = 'display:flex;flex-direction:column;gap:7px;width:100%;box-sizing:border-box;margin:10px 0;';
        gatePhotoUrls.forEach((gatePhotoUrl, index) => {
          const gatePhotoButton = document.createElement('a');
          gatePhotoButton.className = 'gate-photo-btn';
          gatePhotoButton.href = gatePhotoUrl;
          gatePhotoButton.target = '_blank';
          gatePhotoButton.rel = 'noopener noreferrer';
          gatePhotoButton.textContent = gatePhotoUrls.length > 1
            ? `📷 عرض صورة بوابة الفيلا (${index + 1} من ${gatePhotoUrls.length})`
            : '📷 عرض صورة بوابة الفيلا';
          gatePhotoButton.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:0;padding:11px 14px;border-radius:10px;background:#e8f2ff;color:#1455b8;border:1px solid #b9d4ff;text-align:center;font-weight:800;text-decoration:none;';
          gatePhotoBox.appendChild(gatePhotoButton);
        });

        const insertBefore = node.querySelector('.payment-current, .payment-buttons, .payment-options, .btn-deliver');
        if (insertBefore && insertBefore.parentNode) {
          insertBefore.parentNode.insertBefore(gatePhotoBox, insertBefore);
        } else {
          node.appendChild(gatePhotoBox);
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

      // البطاقة الخارجية كلها تفتح الفاتورة فقط؛ لا تعمل أي عناصر بداخلها قبل الفتح.
      // عند فتح الفاتورة بالكامل، تبقى كل الأزرار الداخلية بوظائفها الأصلية.
      node.addEventListener('click', (event) => {
        if (node.classList.contains('is-fullscreen-invoice')) return;
        event.preventDefault();
        event.stopPropagation();
        toggleInvoiceDetails();
      }, true);

      list.appendChild(node);
    }

    updateStats();
  }

  async function markHeadingToCustomer(order, button) {
    if (!order || !order.id || button.disabled) return;
    const invoice = firstValue(order, ['order_number', 'orderNumber', 'invoice_no', 'invoice_number', 'id']) || order.id;
    const confirmed = window.confirm(`تأكيد التحرك لتسليم الفاتورة ${invoice}؟\nسيظهر إشعار في الماستر باسم المندوب ووقت التحرك.`);
    if (!confirmed) return;

    const originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = 'جارٍ إرسال الإشعار…';
    try {
      const result = await apiFetch('/api/driver/heading-to-customer', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id })
      });
      const departedAt = result.departed_at || result.departure?.departed_at || new Date().toISOString();
      order.driver_departure_at = departedAt;
      button.style.cssText += 'background:#ecfdf3;color:#067647;border-color:#abefc6;box-shadow:none;cursor:default;';
      button.innerHTML = '<span aria-hidden="true">✓</span><span>تم الإبلاغ — متوجه للعميل</span>';
      const time = document.createElement('small');
      time.textContent = new Date(departedAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
      time.style.cssText = 'font-size:12px;font-weight:800;margin-right:4px;';
      button.appendChild(time);
      toast(result.already_marked ? 'تم تسجيل التحرك سابقًا لهذه الفاتورة' : 'تم إرسال إشعار التحرك للماستر بنجاح ✅');
    } catch (error) {
      button.disabled = false;
      button.innerHTML = originalText;
      if (error.message !== 'expired') toast(error.message || 'تعذر إرسال إشعار التحرك', true);
    }
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

    const requestController = new AbortController();
    const requestTimeout = setTimeout(() => requestController.abort(), 30000);
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers,
        signal: requestController.signal
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('استغرق الاتصال أكثر من 30 ثانية. لم يتم تحديث الفاتورة محليًا؛ أعد المحاولة بعد التأكد من الاتصال.');
      }
      throw error;
    } finally {
      clearTimeout(requestTimeout);
    }

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

    return date.toLocaleString('ar-EG-u-nu-latn', {
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
    return toEnglishDigits(value)
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
      .master-orders-sidebar{display:flex;flex-direction:column;gap:12px;min-width:0}
      .master-day-summary-panel{display:block;background:#fff;border:1px solid #cfe0f4;border-radius:14px;padding:12px;box-shadow:0 5px 18px rgba(30,49,67,.06);direction:rtl}
      .master-day-summary-head{display:flex;flex-direction:column;gap:4px;padding:0 0 10px;margin-bottom:10px;border-bottom:1px solid #e5edf6}
      .master-day-summary-head strong{font-size:15px;font-weight:900;color:#102744}
      .master-day-summary-head span{font-size:11px;color:#64748b;font-weight:800}
      .master-day-summary-grid{display:grid;grid-template-columns:1fr;gap:7px}
      .master-day-summary-card{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;min-width:0}
      .master-day-summary-card .label{font-size:11px;line-height:1.45;color:#475569;font-weight:800}
      .master-day-summary-card .numbers{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:left;min-width:0}
      .master-day-summary-card strong{font-size:16px;line-height:1.3;color:#102744;font-weight:900;overflow-wrap:anywhere}
      .master-day-summary-card small{font-size:10px;color:#64748b;font-weight:800;overflow-wrap:anywhere}
      .master-day-summary-card.cash{background:#f0fdf4;border-color:#bbf7d0}.master-day-summary-card.cash strong{color:#15803d}
      .master-day-summary-card.bank{background:#eff6ff;border-color:#bfdbfe}.master-day-summary-card.bank strong{color:#1d4ed8}
      .master-day-summary-card.prepaid{background:#fff1f2;border-color:#fecdd3}.master-day-summary-card.prepaid strong{color:#be123c}
      .master-day-summary-card.balance{background:#f5f3ff;border-color:#ddd6fe}.master-day-summary-card.balance strong{color:#6d28d9}
      .master-day-summary-card.pending{background:#fff7ed;border-color:#fed7aa}.master-day-summary-card.pending strong{color:#c2410c}
      @media(max-width:900px){.master-orders-sidebar{order:0}.master-table-wrap{order:1}.master-day-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.master-day-summary-card{align-items:flex-start;flex-direction:column}.master-day-summary-card .numbers{align-items:flex-start;text-align:right}}
      @media(max-width:650px){.master-day-summary-panel{padding:10px}.master-day-summary-head strong{font-size:14px}.master-day-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.master-day-summary-card{padding:8px}.master-day-summary-card .label{font-size:10px}.master-day-summary-card strong{font-size:14px}.master-day-summary-card small{font-size:9px}}
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
      /* Professional compact invoice details */
      .master-modal-card{width:min(760px,100%);max-height:88vh;border:1px solid #e5ebf0}
      .master-modal-head{padding:12px 16px}
      .master-modal-body{padding:14px}
      .master-detail-grid{gap:8px}
      .master-detail{padding:10px 12px;border:1px solid #edf1f4;border-radius:11px}
      .master-detail small{font-size:10px;margin-bottom:4px}
      .master-detail strong{font-size:13px;line-height:1.5}
      .master-section{margin-top:9px;padding:11px 13px;border-radius:11px}
      .master-section-title{font-size:12px;margin-bottom:6px}
      .master-section-content{font-size:12px;line-height:1.6;overflow-wrap:anywhere}
      .master-actions-row{position:sticky;bottom:-14px;background:rgba(255,255,255,.97);padding:10px 0 2px;margin-top:10px;z-index:2}
      .master-actions-row .master-btn{flex:1;min-height:42px}
      .master-section-title{font-weight:800;margin-bottom:8px}
      .master-section-content{white-space:pre-wrap;line-height:1.7;color:#39484e}
      .master-actions-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      .master-edit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .master-edit-form label{display:flex;flex-direction:column;gap:6px;font-weight:800;font-size:12px;color:#39484e}
      .master-edit-form input,.master-edit-form textarea,.master-edit-form select{width:100%;box-sizing:border-box;border:1px solid #dfe6e8;border-radius:10px;padding:10px;font:inherit;background:#fff;color:#172024}
      .master-edit-form textarea{min-height:82px;resize:vertical}
      .master-edit-full{display:flex;flex-direction:column;gap:6px;margin-top:12px}
      /* Master invoice editor: keep each weight, cut, quantity and gift in its own field. */
      .master-edit-products{display:grid;gap:10px;margin-top:12px}
      .master-edit-product-panel{border:1px solid #dbe5ef;border-radius:12px;background:#fff;padding:10px 12px;min-width:0}
      .master-edit-product-panel>summary{cursor:pointer;list-style:disclosure-closed;font-size:13px;font-weight:900;color:#173b68;padding:3px 0;outline-offset:4px}
      .master-edit-product-panel[open]>summary{list-style:disclosure-open;padding-bottom:9px;border-bottom:1px solid #e8eef5}
      .master-edit-product-hint{font-size:11px;line-height:1.7;color:#64748b;margin:7px 0}
      .master-edit-product-rows{display:grid;gap:8px;margin-top:10px;min-width:0}
      .master-edit-chicken-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.7fr) auto;gap:8px;align-items:end;padding:9px;border:1px solid #e8eef5;border-radius:10px;background:#f8fafc;min-width:0}
      .master-edit-cut-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,.7fr) minmax(0,.7fr) auto;gap:8px;align-items:end;padding:9px;border:1px solid #e8eef5;border-radius:10px;background:#f8fafc;min-width:0}
      .master-edit-product-rows label{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:11px;font-weight:800;color:#475569}
      .master-edit-product-rows input{min-width:0;width:100%;box-sizing:border-box;border:1px solid #d5dee8;border-radius:8px;padding:9px 8px;font:inherit;font-size:13px;background:#fff;color:#172024;direction:ltr;text-align:right}
      .master-edit-remove-row{border:1px solid #fecaca;border-radius:8px;background:#fff1f2;color:#b42318;padding:8px 10px;min-height:36px;font:inherit;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap}
      .master-edit-add-row{margin-top:9px;width:100%;min-height:38px;border:1px dashed #93c5fd;border-radius:9px;background:#eff6ff;color:#1d4ed8;font:inherit;font-size:12px;font-weight:900;cursor:pointer}
      .master-month-note{font-size:11px;color:#7b878c;margin-top:8px}
      .master-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px 20px;background:#fff;border-bottom:1px solid #e5ebf0;position:sticky;top:86px;z-index:9}
      .master-nav-btn{border:1px solid #dbe5ef;border-radius:13px;min-height:48px;padding:10px 12px;background:#f8fafc;color:#334155;font-weight:900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:transform .15s,box-shadow .15s,border-color .15s}
      .master-nav-btn:hover{transform:translateY(-1px);box-shadow:0 5px 15px rgba(20,45,70,.09)}
      .master-nav-btn[aria-current="page"]{background:linear-gradient(135deg,#176b57,#15966d);color:#fff;border-color:#12835e;box-shadow:0 5px 14px rgba(22,163,106,.2)}
      .master-home-intro{display:none;background:linear-gradient(135deg,#fff,#f0f7ff);border:1px solid #dce8f6;border-radius:18px;padding:18px 20px;margin-bottom:16px;box-shadow:0 6px 20px rgba(30,49,67,.04)}
      .master-home-intro h2{font-size:18px;margin:0 0 6px;color:#102744}.master-home-intro p{font-size:12px;line-height:1.8;color:#64748b;margin:0 0 12px}
      .master-home-cta{border:0;border-radius:10px;background:#176b57;color:#fff;padding:10px 15px;font-weight:900;cursor:pointer}
      .master-page[data-view="home"] .master-home-intro{display:block}
      /* لوحة التحكم الجديدة: الصفحة الرئيسية للماستر فقط */
      .master-home-dashboard{display:none;direction:rtl;gap:14px;margin:0 0 18px}
      .master-page[data-view="home"] .master-home-dashboard{display:grid}
      .master-page[data-view="home"] .master-stats{display:none!important}
      .master-home-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      .master-home-kpi{background:#fff;border:1px solid #e0e8f1;border-radius:15px;padding:15px;box-shadow:0 5px 18px rgba(30,49,67,.045);min-width:0;border-right:4px solid #64748b}
      .master-home-kpi.sales{border-right-color:#0f9f6e}.master-home-kpi.received{border-right-color:#2563eb}.master-home-kpi.pending{border-right-color:#dc2626}.master-home-kpi.delivered{border-right-color:#7c3aed}
      .master-home-kpi-label{font-size:12px;color:#64748b;font-weight:800;margin-bottom:8px}
      .master-home-kpi-value{font-size:clamp(20px,2vw,28px);line-height:1.35;color:#102744;font-weight:900;overflow-wrap:anywhere}
      .master-home-kpi-hint{font-size:11px;color:#94a3b8;margin-top:5px;font-weight:700}
      .master-home-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:stretch}
      .master-home-panel{background:#fff;border:1px solid #e0e8f1;border-radius:16px;padding:16px;box-shadow:0 5px 18px rgba(30,49,67,.045);min-width:0}
      .master-home-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:13px}
      .master-home-panel-head h3{font-size:15px;font-weight:900;color:#102744;margin:0}
      .master-home-panel-head span{font-size:11px;color:#64748b;font-weight:800}
      .master-home-alerts{display:grid;gap:9px}
      .master-home-alert{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:11px;background:#f8fafc;border:1px solid #e2e8f0}
      .master-home-alert-copy{display:flex;align-items:center;gap:9px;min-width:0;font-size:12px;color:#334155;font-weight:800}
      .master-home-alert-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#fff1f2;color:#be123c;flex-shrink:0}
      .master-home-alert-count{font-size:15px;font-weight:900;color:#be123c;white-space:nowrap}
      .master-home-alert.ok .master-home-alert-icon{background:#dcfce7;color:#15803d}.master-home-alert.ok .master-home-alert-count{color:#15803d}
      .master-home-driver-table{width:100%;border-collapse:collapse;font-size:12px}
      .master-home-driver-table th,.master-home-driver-table td{padding:11px 8px;text-align:right;border-bottom:1px solid #edf2f7;white-space:nowrap}
      .master-home-driver-table th{font-size:10px;color:#64748b;font-weight:900;background:#f8fafc}
      .master-home-driver-table td{color:#334155;font-weight:800}.master-home-driver-table tr:last-child td{border-bottom:0}
      .master-home-progress{height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden;min-width:48px;margin-top:5px}.master-home-progress span{display:block;height:100%;background:#15966d;border-radius:99px}
      .master-home-chart{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;align-items:end;min-height:180px;padding:12px 4px 0}
      .master-home-chart-day{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:7px;min-width:0;height:180px}
      .master-home-chart-value{font-size:10px;color:#475569;font-weight:800;text-align:center;overflow-wrap:anywhere;max-width:100%}
      .master-home-chart-track{height:112px;width:min(100%,34px);display:flex;align-items:flex-end;background:#f1f5f9;border-radius:8px 8px 4px 4px;overflow:hidden}
      .master-home-chart-bar{width:100%;min-height:3px;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,#15966d,#176b57)}
      .master-home-chart-label{font-size:10px;color:#64748b;font-weight:800;text-align:center;white-space:nowrap}
      .master-home-chart-note{font-size:11px;color:#94a3b8;margin-top:8px;line-height:1.7}
      .master-home-empty{padding:14px;text-align:center;color:#94a3b8;font-size:12px;font-weight:700}
      @media(max-width:900px){.master-home-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.master-home-grid{grid-template-columns:minmax(0,1fr)}}
      @media(max-width:520px){.master-home-kpis{gap:8px}.master-home-kpi{padding:11px}.master-home-kpi-value{font-size:20px}.master-home-panel{padding:12px}.master-home-chart{gap:5px}.master-home-chart-track{width:22px}.master-home-chart-value,.master-home-chart-label{font-size:9px}.master-home-driver-table{font-size:10px}.master-home-driver-table th,.master-home-driver-table td{padding:9px 4px}}
      .master-page[data-view="home"] .master-stats .master-stat:nth-child(1),.master-page[data-view="home"] .master-stats .master-stat:nth-child(3),.master-page[data-view="home"] .master-stats .master-stat:nth-child(5),.master-page[data-view="home"] .master-stats .master-stat:nth-child(6),.master-page[data-view="home"] .master-stats .master-stat:nth-child(9){display:none}
      .master-page[data-view="home"] .master-stats{grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
      .master-page[data-view="home"] .master-filters,.master-page[data-view="home"] .master-orders-layout{display:none}
      .master-page[data-view="orders"] .master-stats,.master-page[data-view="orders"] .master-home-intro,.master-page[data-view="orders"] #master-old-transfer-panel{display:none}
      .master-page[data-view="orders"] .master-orders-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:12px;align-items:start;direction:rtl}
      .master-page[data-view="orders"] .master-filters{display:grid}
      .master-page[data-view="transfers"] .master-stats,.master-page[data-view="transfers"] .master-home-intro,.master-page[data-view="transfers"] .master-filters,.master-page[data-view="transfers"] .master-table-wrap{display:none}
      .master-page[data-view="transfers"] .master-orders-layout{display:block}
      .master-page[data-view="transfers"] #master-old-transfer-panel{display:block;width:100%;max-width:980px;margin:0 auto}
      .master-page[data-view="reports"] .master-home-intro,.master-page[data-view="reports"] .master-filters,.master-page[data-view="reports"] .master-orders-layout{display:none}
      .master-page[data-view="reports"] .master-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
      .master-page[data-view="reports"] .master-stats .master-stat{display:block}
      .master-page[data-view="balances"] .master-home-intro,.master-page[data-view="balances"] .master-stats,.master-page[data-view="balances"] .master-filters,.master-page[data-view="balances"] .master-orders-layout{display:none}
      .master-page[data-view="balances"] #master-customer-balances{display:block}
      .master-page[data-view="departures"] .master-home-intro,.master-page[data-view="departures"] .master-stats,.master-page[data-view="departures"] .master-filters,.master-page[data-view="departures"] .master-orders-layout,.master-page[data-view="departures"] #master-customer-balances{display:none}
      .master-page[data-view="departures"] #master-driver-departures{display:block}
      .master-monthly-transfers{display:none;background:#fff;border:1px solid #e2eaf2;border-radius:18px;padding:16px;box-shadow:0 8px 26px rgba(30,49,67,.05)}
      .master-page[data-view="monthly-transfers"] .master-home-intro,.master-page[data-view="monthly-transfers"] .master-stats,.master-page[data-view="monthly-transfers"] .master-filters,.master-page[data-view="monthly-transfers"] .master-orders-layout,.master-page[data-view="monthly-transfers"] #master-customer-balances,.master-page[data-view="monthly-transfers"] #master-driver-departures{display:none!important}
      .master-page[data-view="monthly-transfers"] #master-monthly-transfers{display:block!important}
      .master-monthly-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .master-monthly-title{font-size:20px;font-weight:900;color:#102744;margin:0}
      .master-monthly-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .master-monthly-controls input{border:1px solid #dbe5ef;border-radius:10px;padding:10px;font:inherit;min-height:42px;background:#fff}
      .master-monthly-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
      .master-monthly-stat{padding:13px;border-radius:13px;border:1px solid #e2eaf2;background:#f8fafc;min-width:0}
      .master-monthly-stat.pending{background:#fff3f3;border-color:#fecaca}.master-monthly-stat.received{background:#effaf3;border-color:#bbf7d0}
      .master-monthly-stat span{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:7px}.master-monthly-stat strong{display:block;font-size:20px;font-weight:900;color:#172b3a;overflow-wrap:anywhere}.master-monthly-stat.pending strong{color:#b42318}.master-monthly-stat.received strong{color:#16723b}
      .master-monthly-section{margin-top:16px;border:1px solid #e5ebf0;border-radius:14px;overflow:hidden}
      .master-monthly-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;background:#f8fafc;border-bottom:1px solid #e5ebf0;font-weight:900}
      .master-monthly-section-head.pending{background:#fff1f1;color:#a51d1d}.master-monthly-section-head.received{background:#effaf3;color:#166534}
      .master-monthly-table-wrap{overflow:auto}.master-monthly-table{width:100%;min-width:850px;border-collapse:collapse}.master-monthly-table th,.master-monthly-table td{text-align:right;padding:11px 10px;border-bottom:1px solid #edf1f5;white-space:nowrap;font-size:12px}.master-monthly-table th{background:#fbfcfd;color:#64748b;font-size:11px}.master-monthly-table tbody tr:last-child td{border-bottom:0}.master-monthly-empty{text-align:center;padding:24px!important;color:#64748b;white-space:normal!important}.master-monthly-status{display:inline-flex;border-radius:999px;padding:5px 9px;font-weight:900;font-size:11px}.master-monthly-status.pending{background:#fff0f0;color:#b42318}.master-monthly-status.received{background:#e8f7ee;color:#16723b}
      .master-driver-departures{display:none;background:#fff;border:1px solid #dce8f1;border-radius:16px;padding:16px;box-shadow:0 6px 20px rgba(30,49,67,.05)}
      .master-departure-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .master-departure-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}
      .master-departure-stat{border:1px solid #dbeafe;background:#eff6ff;border-radius:12px;padding:12px}
      .master-departure-stat strong{display:block;font-size:22px;color:#175cd3;margin-top:5px}
      .master-departure-list{display:grid;gap:10px}
      .master-departure-card{border:1px solid #dbe5ef;border-right:4px solid #2563eb;border-radius:12px;padding:13px;background:#fff;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .master-departure-card small{display:block;color:#64748b;font-size:11px;margin-bottom:4px}.master-departure-card strong{font-size:13px;overflow-wrap:anywhere}
      .master-departure-empty{padding:24px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px}
      @media(max-width:650px){.master-departure-stats{grid-template-columns:1fr 1fr}.master-departure-card{grid-template-columns:1fr 1fr;padding:10px}.master-driver-departures{padding:10px}}
      .master-customer-balances{display:none;background:#fff;border:1px solid #dce8f1;border-radius:16px;padding:16px;box-shadow:0 6px 20px rgba(30,49,67,.05)}
      .master-balance-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}
      .master-balance-stat{border:1px solid #e2eaf2;border-radius:13px;padding:14px;background:linear-gradient(135deg,#fff,#f7fafc)}
      .master-balance-label{font-size:12px;color:#64748b;font-weight:800;margin-bottom:7px}.master-balance-value{font-size:23px;font-weight:900;color:#102744;overflow-wrap:anywhere}.master-balance-value.red{color:#c62828}.master-balance-value.green{color:#168052}
      .master-balance-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:12px 0}
      .master-balance-search{flex:1;min-width:220px;border:1px solid #dbe5ef;border-radius:10px;padding:11px 12px;font:inherit}
      .master-balance-table-wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:12px}.master-balance-table{width:100%;min-width:850px;border-collapse:collapse}.master-balance-table th{background:#102744;color:#fff;padding:12px 10px;text-align:right;font-size:12px;white-space:nowrap}.master-balance-table td{padding:11px 10px;border-bottom:1px solid #e8eef4;font-size:12px}.master-balance-table tr:nth-child(even){background:#f8fafc}.master-balance-empty{text-align:center;padding:24px;color:#64748b}
      @media(max-width:650px){.master-balance-stats{grid-template-columns:1fr 1fr;gap:8px}.master-balance-stat{padding:11px}.master-balance-value{font-size:17px}.master-customer-balances{padding:10px}.master-balance-toolbar{align-items:stretch}.master-balance-search{min-width:100%}}
      .master-page[data-view="reports"] .master-page-title{display:block}
      .master-edit-row{display:flex;gap:6px;align-items:center}
      .master-edit-btn{border:0;background:#e8f2ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:9px;padding:8px 10px;cursor:pointer;font-weight:900;white-space:nowrap}
      .master-edit-btn:hover{background:#dbeafe}
      @media(max-width:1200px){.master-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.master-filters{grid-template-columns:repeat(3,minmax(0,1fr))}.master-orders-layout{grid-template-columns:270px minmax(0,1fr)}}
      @media(max-width:900px){.master-orders-layout{grid-template-columns:minmax(0,1fr);gap:10px}.master-old-transfer-panel{order:0;padding:10px}.master-table-wrap{order:1}}
      @media(max-width:650px){.master-edit-chicken-row{grid-template-columns:repeat(2,minmax(0,1fr))}.master-edit-chicken-row .master-edit-remove-row{grid-column:1/-1}.master-edit-cut-row{grid-template-columns:repeat(2,minmax(0,1fr))}.master-edit-cut-row label:first-child{grid-column:1/-1}.master-edit-cut-row .master-edit-remove-row{grid-column:1/-1}.master-old-transfer-panel{padding:9px;border-radius:12px}.master-old-transfer-title{font-size:12px}.master-old-transfer-card{padding:8px}.master-old-transfer-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.master-old-transfer-stat{padding:7px}.master-old-transfer-stat-label{font-size:9px}.master-old-transfer-stat-value{font-size:14px}.master-old-transfer-note{font-size:10px;margin-bottom:7px}.master-old-transfer-list{gap:6px}.master-old-transfer-card .master-transfer-btn{min-height:34px;font-size:10px}.master-old-transfer-stat{padding:9px}.master-old-transfer-stat-value{font-size:15px}.master-old-transfer-stat-value.money{font-size:13px}.master-orders-layout{gap:12px}.master-top{align-items:flex-start;padding:12px;gap:10px;flex-wrap:wrap}.master-brand{gap:9px}.master-logo{width:42px;height:42px;border-radius:13px;font-size:23px}.master-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.master-wrap{padding:10px}.master-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.master-stat{padding:12px 10px;min-height:88px;border-radius:13px}.master-stat-label{font-size:11px;margin-bottom:8px}.master-stat-value{font-size:16px;overflow-wrap:anywhere}.master-stat-hint{font-size:10px;line-height:1.5}.master-filters{grid-template-columns:1fr 1fr;padding:10px;gap:8px}.master-filter input,.master-filter select{font-size:16px;min-height:42px}.master-table-wrap{border-radius:12px}.master-table{min-width:1000px}.master-detail-grid{grid-template-columns:1fr}.master-edit-grid{grid-template-columns:1fr}.master-title{font-size:16px;line-height:1.4}.master-sub{font-size:11px}.master-btn{padding:10px 9px;min-height:42px}.master-modal{padding:8px}.master-modal-card{max-height:94vh;border-radius:15px}.master-modal-body{padding:12px}}
      @media(max-width:900px){.master-nav{grid-template-columns:repeat(2,minmax(0,1fr));top:78px;padding:10px;gap:7px}.master-nav-btn{min-height:44px;font-size:12px}.master-page[data-view="home"] .master-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.master-page[data-view="reports"] .master-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:650px){.master-nav{position:sticky;top:0;z-index:20;grid-template-columns:repeat(2,minmax(0,1fr));padding:8px}.master-nav-btn{font-size:11px;padding:9px 5px;min-height:42px}.master-home-intro{padding:14px}.master-page[data-view="home"] .master-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.master-page[data-view="home"] .master-stats .master-stat{display:block}.master-page[data-view="home"] .master-stats .master-stat:nth-child(1),.master-page[data-view="home"] .master-stats .master-stat:nth-child(3),.master-page[data-view="home"] .master-stats .master-stat:nth-child(5),.master-page[data-view="home"] .master-stats .master-stat:nth-child(6),.master-page[data-view="home"] .master-stats .master-stat:nth-child(9){display:none}.master-page[data-view="reports"] .master-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.master-edit-row{align-items:stretch;flex-direction:column}.master-edit-row button{width:100%}}
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
      <div class="master-page" id="master-page" data-view="home" dir="rtl">
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

        <nav class="master-nav" aria-label="أقسام الماستر">
          <button class="master-nav-btn" type="button" data-master-view-tab="home" aria-current="page">🏠 الرئيسية</button>
          <button class="master-nav-btn" type="button" data-master-view-tab="orders">🧾 الطلبات والفواتير</button>
          <button class="master-nav-btn" type="button" data-master-view-tab="transfers">🏦 تحويلات سابقة</button>
          <button class="master-nav-btn" type="button" data-master-view-tab="monthly-transfers">📅 التحويلات الشهرية</button>
          <button class="master-nav-btn" type="button" data-master-view-tab="balances">💰 أرصدة العملاء</button>
          <button class="master-nav-btn" type="button" data-master-view-tab="departures">🚗 تحرك المندوبين</button>
          <button class="master-nav-btn" type="button" data-master-view-tab="reports">📊 التقارير والإحصائيات</button>
        </nav>

        <main class="master-wrap">
          <section class="master-home-intro">
            <h2>ملخص الإدارة اليوم</h2>
            <p>من هنا تقدر تراجع أهم أرقام الشغل بسرعة، وتدخل على الفواتير أو التحويلات السابقة من الأزرار بالأعلى. الأرقام تتحدث من بيانات الماستر الحالية.</p>
            <button class="master-home-cta" type="button" data-master-go="orders">فتح الفواتير وإدارتها ←</button>
          </section>
          <section class="master-home-dashboard" id="master-home-dashboard" aria-label="لوحة متابعة الإدارة">
            <div class="master-home-kpis">
              <article class="master-home-kpi"><div class="master-home-kpi-label">فواتير اليوم</div><div class="master-home-kpi-value" id="home-kpi-count">٠</div><div class="master-home-kpi-hint">عدد الفواتير بدون تكرار</div></article>
              <article class="master-home-kpi sales"><div class="master-home-kpi-label">إجمالي مبيعات اليوم</div><div class="master-home-kpi-value" id="home-kpi-sales">٠ درهم</div><div class="master-home-kpi-hint">قيمة فواتير اليوم</div></article>
              <article class="master-home-kpi received"><div class="master-home-kpi-label">المبالغ المستلمة</div><div class="master-home-kpi-value" id="home-kpi-received">٠ درهم</div><div class="master-home-kpi-hint">كاش + تحويل مؤكد + مدفوع مقدمًا + رصيد</div></article>
              <article class="master-home-kpi pending"><div class="master-home-kpi-label">تحويلات تحتاج متابعة</div><div class="master-home-kpi-value" id="home-kpi-pending">٠ درهم</div><div class="master-home-kpi-hint" id="home-kpi-pending-hint">٠ فاتورة غير مؤكدة</div></article>
            </div>
            <div class="master-home-grid">
              <section class="master-home-panel" aria-label="تنبيهات الإدارة">
                <div class="master-home-panel-head"><h3>🔔 تنبيهات تحتاج متابعة</h3><span id="home-alert-date">اليوم</span></div>
                <div class="master-home-alerts" id="master-home-alerts"></div>
              </section>
              <section class="master-home-panel" aria-label="أداء المندوبين">
                <div class="master-home-panel-head"><h3>🚚 أداء المندوبين اليوم</h3><span>حسب فواتير اليوم</span></div>
                <div style="overflow-x:auto">
                  <table class="master-home-driver-table"><thead><tr><th>المندوب</th><th>الفواتير</th><th>تم التسليم</th><th>المتبقي</th></tr></thead><tbody id="master-home-driver-body"><tr><td colspan="4">جارٍ تجهيز الملخص…</td></tr></tbody></table>
                </div>
              </section>
            </div>
            <section class="master-home-panel" aria-label="مبيعات آخر سبعة أيام">
              <div class="master-home-panel-head"><h3>📈 حركة المبيعات — آخر ٧ أيام</h3><span>حسب تاريخ الفاتورة</span></div>
              <div class="master-home-chart" id="master-home-chart"></div>
              <div class="master-home-chart-note">الرسم يعرض إجمالي قيمة الفواتير لكل يوم. البيانات للعرض فقط ولا تغيّر الفواتير أو عمليات التحصيل.</div>
            </section>
          </section>
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

          <section class="master-customer-balances" id="master-customer-balances">
            <h2 style="margin:0;color:#102744;font-size:19px">أرصدة العملاء</h2>
            <p style="margin:6px 0 14px;color:#64748b;font-size:12px;line-height:1.8">الأرصدة المسجلة من Excel. الرصيد الحالي = المبالغ المضافة − المبالغ المدفوعة.</p>
            <div class="master-balance-stats">
              <div class="master-balance-stat"><div class="master-balance-label">عدد العملاء</div><div class="master-balance-value" id="master-balance-count">—</div></div>
              <div class="master-balance-stat"><div class="master-balance-label">إجمالي المبالغ المضافة</div><div class="master-balance-value green" id="master-balance-added">—</div></div>
              <div class="master-balance-stat"><div class="master-balance-label">إجمالي الرصيد المتبقي</div><div class="master-balance-value red" id="master-balance-current">—</div></div>
            </div>
            <div class="master-balance-toolbar">
              <input id="master-balance-search" class="master-balance-search" type="search" placeholder="ابحث بكود العميل أو الاسم أو الهاتف…" aria-label="بحث أرصدة العملاء">
              <button class="master-btn secondary" type="button" id="master-balance-refresh">↻ تحديث الأرصدة</button>
            </div>
            <div class="master-balance-table-wrap"><table class="master-balance-table"><thead><tr><th>#</th><th>كود العميل</th><th>اسم العميل</th><th>الهاتف</th><th>الإمارة</th><th>المنطقة</th><th>المبلغ المضاف</th><th>المبلغ المدفوع</th><th>الرصيد الحالي</th><th>ملاحظات</th></tr></thead><tbody id="master-balance-body"><tr><td colspan="10" class="master-balance-empty">اضغط تحديث الأرصدة لعرض البيانات</td></tr></tbody></table></div>
          </section>

          <section class="master-driver-departures" id="master-driver-departures">
            <div class="master-departure-toolbar">
              <div><h2 style="margin:0 0 4px;font-size:18px">🚗 تحرك المندوبين لتسليم الطلبات</h2><div style="color:#64748b;font-size:12px">تظهر هنا الفواتير التي أبلغ المندوب عن تحركه لتسليمها.</div></div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <label for="master-departure-date" style="font-size:12px;font-weight:800;color:#475569">📅 تاريخ التحركات</label>
                <input id="master-departure-date" type="date" style="border:1px solid #dbe5ef;border-radius:9px;padding:8px 10px;font:inherit;background:#fff" />
                <button class="master-btn secondary" id="master-departures-refresh" type="button">↻ تحديث التحركات</button>
              </div>
            </div>
            <div class="master-departure-stats">
              <div class="master-departure-stat"><span>إجمالي التحركات</span><strong id="master-departure-count">٠</strong></div>
              <div class="master-departure-stat"><span>تحركات اليوم</span><strong id="master-departure-today">٠</strong></div>
              <div class="master-departure-stat"><span>تحركات التاريخ المحدد</span><strong id="master-departure-selected">٠</strong></div>
            </div>
            <div class="master-departure-list" id="master-departure-list"><div class="master-departure-empty">جارٍ تحميل التحركات…</div></div>
          </section>

          <section class="master-monthly-transfers" id="master-monthly-transfers" aria-label="التحويلات الشهرية">
            <div class="master-monthly-head">
              <div>
                <h2 class="master-monthly-title">التحويلات البنكية الشهرية</h2>
                <div style="font-size:12px;color:#64748b;line-height:1.8;margin-top:5px">التحويلات غير المستلمة تظهر أولًا، ثم جميع تحويلات الشهر مرتبة حسب الإمارة.</div>
              </div>
              <div class="master-monthly-controls">
                <label for="master-transfer-month" style="font-size:12px;font-weight:800;color:#475569">الشهر</label>
                <input id="master-transfer-month" type="month" aria-label="اختيار شهر التحويلات">
                <button class="master-btn secondary" type="button" id="master-monthly-refresh">↻ تحديث البيانات</button>
              </div>
            </div>
            <div class="master-monthly-summary">
              <div class="master-monthly-stat"><span>عدد التحويلات</span><strong id="master-monthly-count">٠</strong></div>
              <div class="master-monthly-stat"><span>إجمالي المبالغ</span><strong id="master-monthly-total">٠ درهم</strong></div>
              <div class="master-monthly-stat pending"><span>غير مستلمة</span><strong id="master-monthly-pending">٠ درهم</strong></div>
              <div class="master-monthly-stat received"><span>تم استلامها</span><strong id="master-monthly-received">٠ درهم</strong></div>
            </div>
            <section class="master-monthly-section">
              <div class="master-monthly-section-head pending"><span>⚠️ التحويلات غير المستلمة</span><span id="master-monthly-pending-count">٠</span></div>
              <div class="master-monthly-table-wrap"><table class="master-monthly-table"><thead><tr><th>الإمارة</th><th>الفاتورة</th><th>العميل</th><th>الهاتف</th><th>المنطقة</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody id="master-monthly-pending-body"><tr><td colspan="9" class="master-monthly-empty">جارٍ تحميل التحويلات…</td></tr></tbody></table></div>
            </section>
            <section class="master-monthly-section">
              <div class="master-monthly-section-head"><span>جميع تحويلات الشهر — مرتبة حسب الإمارة</span><span id="master-monthly-all-count">٠</span></div>
              <div class="master-monthly-table-wrap"><table class="master-monthly-table"><thead><tr><th>الإمارة</th><th>الفاتورة</th><th>العميل</th><th>الهاتف</th><th>المنطقة</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody id="master-monthly-all-body"><tr><td colspan="9" class="master-monthly-empty">جارٍ تحميل التحويلات…</td></tr></tbody></table></div>
            </section>
            <p class="master-month-note">تعتمد القائمة على فواتير التحويل البنكي المحمّلة في الماستر، وتستثني الفواتير المدفوعة مقدمًا.</p>
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
            <aside class="master-orders-sidebar" aria-label="ملخص اليوم والتحويلات السابقة">
              <section class="master-day-summary-panel" id="master-day-summary-panel" aria-label="ملخص اليوم المحدد">
                <div class="master-day-summary-head">
                  <strong>📊 ملخص اليوم المحدد</strong>
                  <span id="master-day-summary-date">تاريخ اليوم</span>
                </div>
                <div class="master-day-summary-grid">
                  <div class="master-day-summary-card"><span class="label">إجمالي الفواتير</span><div class="numbers"><strong id="day-summary-count">٠</strong><small>فاتورة</small></div></div>
                  <div class="master-day-summary-card cash"><span class="label">عملاء دفعوا كاش</span><div class="numbers"><strong id="day-summary-cash-count">٠</strong><small id="day-summary-cash-total">٠ درهم</small></div></div>
                  <div class="master-day-summary-card bank"><span class="label">عملاء دفعوا تحويل</span><div class="numbers"><strong id="day-summary-bank-count">٠</strong><small id="day-summary-bank-total">٠ درهم إجمالي</small></div></div>
                  <div class="master-day-summary-card pending"><span class="label">تحويلات مستلمة</span><div class="numbers"><strong id="day-summary-bank-received">٠ درهم</strong><small>تم تأكيد الاستلام</small></div></div>
                  <div class="master-day-summary-card pending"><span class="label">تحويلات غير مستلمة</span><div class="numbers"><strong id="day-summary-bank-pending">٠ درهم</strong><small>تحتاج تأكيد</small></div></div>
                  <div class="master-day-summary-card prepaid"><span class="label">عملاء دفعوا مقدمًا</span><div class="numbers"><strong id="day-summary-prepaid-count">٠</strong><small id="day-summary-prepaid-total">٠ درهم</small></div></div>
                  <div class="master-day-summary-card balance"><span class="label">عملاء دفعوا من الرصيد</span><div class="numbers"><strong id="day-summary-balance-count">٠</strong><small id="day-summary-balance-total">٠ درهم</small></div></div>
                  <div class="master-day-summary-card"><span class="label">الفواتير المسلّمة</span><div class="numbers"><strong id="day-summary-delivered">٠</strong><small>من فواتير التاريخ</small></div></div>
                  <div class="master-day-summary-card"><span class="label">إجمالي المبالغ المسجلة/المستلمة</span><div class="numbers"><strong id="day-summary-received-total">٠ درهم</strong><small>كاش + تحويل مستلم + مقدم + رصيد</small></div></div>
                </div>
              </section>
              <section class="master-old-transfer-panel" id="master-old-transfer-panel" aria-label="التحويلات القديمة غير المستلمة">
              <div class="master-old-transfer-head">
                <div class="master-old-transfer-title">التحويلات السابقة غير المستلمة</div>
                <span class="master-old-transfer-count" id="master-old-transfer-count">٠</span>
              </div>
              <div class="master-old-transfer-note">تظهر هنا التحويلات القديمة التي تحتاج مراجعة، بما فيها التحويلات التاريخية المسجلة لأمنه وخالد الفلاسي. فواتير اليوم موجودة في قسم الطلبات.</div>
              <div class="master-old-transfer-stats" aria-label="إحصائيات التحويلات القديمة">
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">عدد التحويلات المعلقة</span><strong class="master-old-transfer-stat-value" id="master-old-transfer-stat-count">٠</strong></div>
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">إجمالي المبالغ غير المستلمة</span><strong class="master-old-transfer-stat-value money" id="master-old-transfer-stat-total">٠ درهم</strong></div>
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">فواتير أمس</span><strong class="master-old-transfer-stat-value" id="master-old-transfer-stat-yesterday">٠</strong></div>
                <div class="master-old-transfer-stat"><span class="master-old-transfer-stat-label">فواتير أول أمس والأقدم</span><strong class="master-old-transfer-stat-value" id="master-old-transfer-stat-older">٠</strong></div>
              </div>
              <div class="master-old-transfer-list" id="master-old-transfer-list">
                <div class="master-old-transfer-empty">جاري تحميل التحويلات…</div>
              </div>
              </section>
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
                  <th>الإجراءات</th>
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

    const departureDateInput = $('master-departure-date');
    if (departureDateInput && !departureDateInput.value) {
      try { departureDateInput.value = localStorage.getItem('master_departure_selected_date') || masterDateInput(new Date()); } catch { departureDateInput.value = masterDateInput(new Date()); }
    }
    $('master-refresh')?.addEventListener('click', loadMasterOrders);
    $('master-departures-refresh')?.addEventListener('click', loadMasterDepartures);
    $('master-departure-date')?.addEventListener('change', () => {
      try { localStorage.setItem('master_departure_selected_date', $('master-departure-date').value || ''); } catch {}
      renderMasterDeparturesForSelectedDate();
    });
    $('master-balance-refresh')?.addEventListener('click', loadMasterCustomerBalances);
    $('master-monthly-refresh')?.addEventListener('click', loadMasterOrders);
    $('master-transfer-month')?.addEventListener('change', renderMasterMonthlyTransfers);
    $('master-balance-search')?.addEventListener('input', renderMasterCustomerBalances);
    $('master-logout')?.addEventListener('click', () => masterLogout());
    document.querySelectorAll('[data-master-view-tab]').forEach((button) => {
      button.addEventListener('click', () => setMasterView(button.dataset.masterViewTab));
    });
    document.querySelectorAll('[data-master-go]').forEach((button) => {
      button.addEventListener('click', () => setMasterView(button.dataset.masterGo));
    });
    $('master-modal-close')?.addEventListener('click', closeMasterModal);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $('master-modal')?.classList.contains('open')) closeMasterModal();
    });

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

    const monthPicker = $('master-transfer-month');
    if (monthPicker) monthPicker.value = masterDateInput(new Date()).slice(0, 7);

    loadMasterOrders();
    loadMasterDepartures();
    try {
      const rememberedView = localStorage.getItem('master_last_view');
      if (rememberedView && rememberedView !== 'home') setMasterView(rememberedView);
    } catch {}
    if (state.masterDeparturePoll) clearInterval(state.masterDeparturePoll);
    state.masterDeparturePoll = setInterval(() => {
      if (state.masterSession?.access_token) loadMasterDepartures({ quiet: true });
    }, 30000);
  }

  function setMasterView(view) {
    const allowed = new Set(['home', 'orders', 'transfers', 'monthly-transfers', 'reports', 'balances', 'departures']);
    const nextView = allowed.has(view) ? view : 'home';
    const page = $('master-page');
    if (!page) return;
    page.dataset.view = nextView;
    try { localStorage.setItem('master_last_view', nextView); } catch {}
    document.querySelectorAll('[data-master-view-tab]').forEach((button) => {
      if (button.dataset.masterViewTab === nextView) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    });
    if (nextView === 'transfers') renderMasterOldPendingTransfers();
    if (nextView === 'monthly-transfers') renderMasterMonthlyTransfers();
    if (nextView === 'reports') renderMasterStats();
    if (nextView === 'home') renderMasterHomeDashboard();
    if (nextView === 'balances') loadMasterCustomerBalances();
    if (nextView === 'departures') loadMasterDepartures();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  let masterDriverDepartures = [];
  let masterDepartureInitialLoadDone = false;
  const masterDepartureSeenIds = new Set();

  async function loadMasterDepartures(options = {}) {
    const list = $('master-departure-list');
    if (!list) return;
    if (!options.quiet) list.innerHTML = '<div class="master-departure-empty">جارٍ تحميل التحركات…</div>';
    try {
      const data = await masterFetch('/api/master/driver-departures');
      masterDriverDepartures = Array.isArray(data) ? data : (Array.isArray(data?.departures) ? data.departures : []);
      const newest = masterDriverDepartures.filter(row => row && row.id != null && !masterDepartureSeenIds.has(String(row.id)));
      const newDepartureCount = masterDepartureInitialLoadDone ? newest.length : 0;
      masterDriverDepartures.forEach(row => { if (row && row.id != null) masterDepartureSeenIds.add(String(row.id)); });
      masterDepartureInitialLoadDone = true;
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const todayCount = masterDriverDepartures.filter(row => String(row.departed_at || '').slice(0,10) === todayKey).length;
      if ($('master-departure-count')) $('master-departure-count').textContent = masterDriverDepartures.length.toLocaleString('ar-EG-u-nu-latn');
      if ($('master-departure-today')) $('master-departure-today').textContent = todayCount.toLocaleString('ar-EG-u-nu-latn');
      if ($('master-departure-last')) $('master-departure-last').textContent = masterDriverDepartures[0]?.departed_at ? new Date(masterDriverDepartures[0].departed_at).toLocaleTimeString('ar-EG-u-nu-latn', {hour:'2-digit',minute:'2-digit'}) : '—';
      const dateInput = $('master-departure-date');
      if (dateInput && !dateInput.value) dateInput.value = todayKey;
      renderMasterDeparturesForSelectedDate();
      if (newDepartureCount > 0 && (!$('master-departure-date')?.value || $('master-departure-date').value === todayKey)) {
        const notice = document.createElement('div');
        notice.className = 'master-departure-empty';
        notice.style.cssText = 'background:#ecfdf3;border:1px solid #abefc6;color:#067647;font-weight:900;text-align:right;margin-bottom:10px;';
        notice.textContent = `🔔 تحرك جديد للمندوب: ${newDepartureCount.toLocaleString('ar-EG-u-nu-latn')} فاتورة. راجع التفاصيل بالأسفل.`;
        list.prepend(notice);
      }
    } catch (error) {
      if (!options.quiet && error.message !== 'expired') list.innerHTML = `<div class="master-departure-empty">${masterEscape(error.message || 'تعذر تحميل التحركات')}</div>`;
    }
  }

  function renderMasterDeparturesForSelectedDate() {
    const list = $('master-departure-list');
    if (!list) return;
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const selectedKey = $('master-departure-date')?.value || todayKey;
    const selectedDepartures = masterDriverDepartures.filter((row) => {
      const date = new Date(row?.departed_at || '');
      if (Number.isNaN(date.getTime())) return false;
      const localKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      return localKey === selectedKey;
    });
    const selectedCount = selectedDepartures.length;
    const selectedStat = $('master-departure-selected');
    if (selectedStat) selectedStat.textContent = selectedCount.toLocaleString('ar-EG-u-nu-latn');
    const countStat = $('master-departure-count');
    if (countStat) countStat.textContent = masterDriverDepartures.length.toLocaleString('ar-EG-u-nu-latn');
    const todayStat = $('master-departure-today');
    if (todayStat) todayStat.textContent = masterDriverDepartures.filter((row) => {
      const date = new Date(row?.departed_at || '');
      if (Number.isNaN(date.getTime())) return false;
      const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      return key === todayKey;
    }).length.toLocaleString('ar-EG-u-nu-latn');
    const statLabel = countStat?.previousElementSibling;
    if (statLabel) statLabel.textContent = 'إجمالي التحركات (كل الأيام)';
    const todayLabel = todayStat?.previousElementSibling;
    if (todayLabel) todayLabel.textContent = 'تحركات اليوم';
    if (!selectedDepartures.length) {
      list.innerHTML = `<div class="master-departure-empty">لا توجد تحركات مسجلة بتاريخ ${masterEscape(selectedKey)}. اختر تاريخًا آخر لعرض التحركات السابقة.</div>`;
      return;
    }
    list.innerHTML = selectedDepartures.map(row => `<article class="master-departure-card"><div><small>الفاتورة</small><strong>${masterEscape(row.invoice_number || row.order_id || '—')}</strong></div><div><small>العميل</small><strong>${masterEscape(row.customer_name || '—')}</strong></div><div><small>المندوب</small><strong>${masterEscape(row.driver_name || row.sheet_name || '—')}</strong></div><div><small>وقت التحرك</small><strong>${masterEscape(masterDate(row.departed_at))}</strong></div><div><small>الإمارة / المنطقة</small><strong>${masterEscape([row.emirate,row.area].filter(Boolean).join(' / ') || '—')}</strong></div><div><small>الهاتف</small><strong dir="ltr">${masterEscape(row.phone || '—')}</strong></div><div><small>الإجمالي</small><strong>${masterEscape(formatTotal(row.total))}</strong></div><div><small>الحالة</small><strong style="color:#067647">🚗 متوجه للعميل</strong></div></article>`).join('');
  }

  let masterCustomerBalances = [];

  async function loadMasterCustomerBalances() {
    const body = $('master-balance-body');
    if (body) body.innerHTML = '<tr><td colspan="10" class="master-balance-empty">جارٍ تحميل أرصدة العملاء…</td></tr>';
    try {
      const data = await masterFetch('/api/master/customer-balances');
      masterCustomerBalances = Array.isArray(data) ? data : (Array.isArray(data?.balances) ? data.balances : []);
      const totalAdded = masterCustomerBalances.reduce((sum, row) => sum + (Number(row.amount_added) || 0), 0);
      const totalCurrent = masterCustomerBalances.reduce((sum, row) => sum + (Number(row.current_balance) || 0), 0);
      if ($('master-balance-count')) $('master-balance-count').textContent = masterCustomerBalances.length.toLocaleString('ar-EG-u-nu-latn');
      if ($('master-balance-added')) $('master-balance-added').textContent = masterMoney(totalAdded) + ' درهم';
      if ($('master-balance-current')) $('master-balance-current').textContent = masterMoney(totalCurrent) + ' درهم';
      renderMasterCustomerBalances();
    } catch (error) {
      if (body && error.message !== 'expired') body.innerHTML = `<tr><td colspan="10" class="master-balance-empty">${masterEscape(error.message || 'تعذر تحميل أرصدة العملاء')}</td></tr>`;
    }
  }

  function renderMasterCustomerBalances() {
    const body = $('master-balance-body');
    if (!body) return;
    const query = String($('master-balance-search')?.value || '').trim().toLowerCase();
    const rows = masterCustomerBalances.filter(row => [row.customer_code, row.customer_name, row.phone, row.emirate, row.area, row.notes, row.order_ref].some(value => String(value ?? '').toLowerCase().includes(query)));
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="10" class="master-balance-empty">${masterCustomerBalances.length ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد أرصدة مسجلة حتى الآن. تأكد من مزامنة شيت CustomerBalances من Excel.'}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((row, index) => `<tr><td>${(index + 1).toLocaleString('ar-EG-u-nu-latn')}</td><td><strong>${masterEscape(row.customer_code || '—')}</strong></td><td>${masterEscape(row.customer_name || '—')}</td><td dir="ltr">${masterEscape(row.phone || '—')}</td><td>${masterEscape(row.emirate || '—')}</td><td>${masterEscape(row.area || '—')}</td><td>${masterMoney(row.amount_added || 0)} درهم</td><td>${masterMoney(row.amount_paid || 0)} درهم</td><td style="font-weight:900;color:${Number(row.current_balance) > 0 ? '#c62828' : '#168052'}">${masterMoney(row.current_balance || 0)} درهم</td><td>${masterEscape(row.notes || '—')}</td></tr>`).join('');
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
      `${value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} درهم`;

    if ($('master-total-prepaid')) {
      $('master-total-prepaid').textContent = moneyText(totalPrepaid);
    }

    if ($('master-prepaid-hint')) {
      $('master-prepaid-hint').textContent = `عدد الفواتير: ${prepaidOrders.length.toLocaleString('ar-EG-u-nu-latn')}`;
    }

    if ($('master-total-count')) {
      $('master-total-count').textContent = orders.length.toLocaleString('ar-EG-u-nu-latn');
    }

    if ($('master-cash-count')) {
      $('master-cash-count').textContent = cashOrders.length.toLocaleString('ar-EG-u-nu-latn');
    }

    if ($('master-bank-count')) {
      $('master-bank-count').textContent = bankOrders.length.toLocaleString('ar-EG-u-nu-latn');
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
      $('master-delivered').textContent = delivered.toLocaleString('ar-EG-u-nu-latn');
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

  // تحويلات تاريخية مضافة للعرض في صفحة الماستر فقط؛ لا تنشئ فواتير ولا تعدّل قاعدة البيانات.
  const MASTER_HISTORICAL_TRANSFERS = [
    { id: 'historical-amna-20260810', customer_name: 'أمنه', total: 378, transfer_date: '10/08/2026', received: false },
    { id: 'historical-khaled-20260927', customer_name: 'خالد الفلاسي', total: 160, transfer_date: '27/09/2026', received: false }
  ];

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
    const pendingHistoricalTransfers = MASTER_HISTORICAL_TRANSFERS.filter((transfer) => !transfer.received);
    const totalPendingAmount = orders.reduce((sum, order) => sum + masterMoney(order.total), 0) + pendingHistoricalTransfers.reduce((sum, transfer) => sum + masterMoney(transfer.total), 0);
    const totalPendingCount = orders.length + pendingHistoricalTransfers.length;
    const historicalOlderCount = pendingHistoricalTransfers.length;
    const moneyText = (value) => `${value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} درهم`;

    if (count) count.textContent = totalPendingCount.toLocaleString('ar-EG-u-nu-latn');
    if ($('master-old-transfer-stat-count')) $('master-old-transfer-stat-count').textContent = totalPendingCount.toLocaleString('ar-EG-u-nu-latn');
    if ($('master-old-transfer-stat-total')) $('master-old-transfer-stat-total').textContent = moneyText(totalPendingAmount);
    if ($('master-old-transfer-stat-yesterday')) $('master-old-transfer-stat-yesterday').textContent = yesterdayOrders.length.toLocaleString('ar-EG-u-nu-latn');
    if ($('master-old-transfer-stat-older')) $('master-old-transfer-stat-older').textContent = (olderOrders.length + historicalOlderCount).toLocaleString('ar-EG-u-nu-latn');

    list.innerHTML = '';

    if (!orders.length) {
      list.innerHTML = '<div class="master-old-transfer-empty">لا توجد تحويلات قديمة معلّقة حاليًا.</div>';
    } else {
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

    const historicalTitle = document.createElement('div');
    historicalTitle.className = 'master-old-transfer-title';
    historicalTitle.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #e8edef;font-weight:900;color:#24343a';
    historicalTitle.textContent = 'تحويلات تاريخية مضافة';
    list.appendChild(historicalTitle);

    MASTER_HISTORICAL_TRANSFERS.forEach((transfer) => {
      const card = document.createElement('article');
      card.className = 'master-old-transfer-card';
      card.style.cssText = 'border-color:#c8ebd2;background:#f1fbf4';
      card.innerHTML = `
        <div class="master-old-transfer-card-top">
          <span class="master-old-transfer-customer">${masterEscape(transfer.customer_name)}</span>
          <span class="master-transfer-state ${transfer.received ? 'received' : 'waiting'}">${transfer.received ? '✓ تم الاستلام' : 'تحويل غير مؤكد'}</span>
        </div>
        <div class="master-old-transfer-meta">تاريخ التحويل: ${masterEscape(transfer.transfer_date)}</div>
        <div class="master-old-transfer-amount">${masterEscape(formatTotal(transfer.total))}</div>
        ${transfer.received ? '<span class="master-transfer-state received">تم تأكيد الاستلام</span>' : `<button class="master-transfer-btn pending" data-historical-transfer="${masterEscape(transfer.id)}">تأكيد استلام التحويل</button>`}
      `;
      const historicalButton = card.querySelector('[data-historical-transfer]');
      if (historicalButton) {
        historicalButton.addEventListener('click', () => {
          const confirmed = window.confirm(`تأكيد استلام تحويل ${transfer.customer_name} بقيمة ${transfer.total} درهم بتاريخ ${transfer.transfer_date}؟`);
          if (!confirmed) return;
          transfer.received = true;
          renderMasterOrders();
          toast('تم تحديث حالة التحويل في العرض الحالي. يلزم ربطه بقاعدة البيانات لحفظه نهائيًا.');
        });
      }
      list.appendChild(card);
    });
  }

  function getMasterMonthlyBankTransfers() {
    const month = String($('master-transfer-month')?.value || masterDateInput(new Date()).slice(0, 7));
    const emirateCompare = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
    return getMasterUniqueOrders()
      .filter((order) => {
        if (isPaidInAdvance(order) || normalizePayment(order.payment_method) !== 'bank_transfer') return false;
        const date = masterDateInput(order.created_at);
        return date && date.slice(0, 7) === month;
      })
      .sort((a, b) => {
        const aPending = a.bank_transfer_received !== true;
        const bPending = b.bank_transfer_received !== true;
        if (aPending !== bPending) return aPending ? -1 : 1;
        const emirateOrder = emirateCompare.compare(String(a.emirate || 'غير محدد'), String(b.emirate || 'غير محدد'));
        if (emirateOrder) return emirateOrder;
        const areaOrder = emirateCompare.compare(String(a.area || ''), String(b.area || ''));
        if (areaOrder) return areaOrder;
        return masterDateInput(b.created_at).localeCompare(masterDateInput(a.created_at));
      });
  }

  function renderMasterMonthlyTransfers() {
    const pendingBody = $('master-monthly-pending-body');
    const allBody = $('master-monthly-all-body');
    if (!pendingBody || !allBody) return;

    const transfers = getMasterMonthlyBankTransfers();
    const pending = transfers.filter((order) => order.bank_transfer_received !== true);
    const received = transfers.filter((order) => order.bank_transfer_received === true);
    const sum = (rows) => rows.reduce((total, order) => total + masterMoney(order.total), 0);
    const moneyText = (amount) => `${amount.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} درهم`;

    if ($('master-monthly-count')) $('master-monthly-count').textContent = transfers.length.toLocaleString('ar-EG-u-nu-latn');
    if ($('master-monthly-total')) $('master-monthly-total').textContent = moneyText(sum(transfers));
    if ($('master-monthly-pending')) $('master-monthly-pending').textContent = moneyText(sum(pending));
    if ($('master-monthly-received')) $('master-monthly-received').textContent = moneyText(sum(received));
    if ($('master-monthly-pending-count')) $('master-monthly-pending-count').textContent = `${pending.length.toLocaleString('ar-EG-u-nu-latn')} تحويل`;
    if ($('master-monthly-all-count')) $('master-monthly-all-count').textContent = `${transfers.length.toLocaleString('ar-EG-u-nu-latn')} تحويل`;

    const rowHtml = (order, index) => {
      const isReceived = order.bank_transfer_received === true;
      const invoice = order.order_number ?? order.invoice_number ?? order.invoice_no ?? order.id ?? '—';
      const status = isReceived
        ? '<span class="master-monthly-status received">✓ تم الاستلام</span>'
        : '<span class="master-monthly-status pending">لم يُستلم</span>';
      const buttonLabel = isReceived ? 'إلغاء التأكيد' : 'تأكيد الاستلام';
      const buttonClass = isReceived ? 'master-transfer-btn' : 'master-transfer-btn pending';
      return `<tr data-month-transfer-row="${masterEscape(order.id)}">
        <td><strong>${masterEscape(order.emirate || 'غير محدد')}</strong></td>
        <td>${masterEscape(invoice)}</td>
        <td>${masterEscape(order.customer_name || '—')}</td>
        <td dir="ltr">${masterEscape(order.phone || '—')}</td>
        <td>${masterEscape(order.area || '—')}</td>
        <td>${masterEscape(masterDate(order.created_at))}</td>
        <td><strong>${masterEscape(moneyText(masterMoney(order.total)))}</strong></td>
        <td>${status}</td>
        <td><button type="button" class="${buttonClass}" data-month-transfer-action="${masterEscape(order.id)}">${buttonLabel}</button></td>
      </tr>`;
    };

    pendingBody.innerHTML = pending.length
      ? pending.map(rowHtml).join('')
      : '<tr><td colspan="9" class="master-monthly-empty">ممتاز، لا توجد تحويلات غير مستلمة في هذا الشهر.</td></tr>';
    allBody.innerHTML = transfers.length
      ? transfers.map(rowHtml).join('')
      : '<tr><td colspan="9" class="master-monthly-empty">لا توجد فواتير تحويل بنكي في الشهر المحدد.</td></tr>';

    [pendingBody, allBody].forEach((body) => {
      body.querySelectorAll('[data-month-transfer-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = String(button.dataset.monthTransferAction || '');
          const order = transfers.find((item) => String(item.id) === id);
          if (order) setMasterTransferReceived(order, order.bank_transfer_received !== true, button);
        });
      });
    });
  }

  function isBalancePaymentOrder(order) {
    const method = String(order?.payment_method || '').trim().toLowerCase();
    const marked = [order?.paid_from_balance, order?.balance_used, order?.customer_balance_used, order?.paid_by_balance]
      .some((value) => value === true || value === 1 || String(value ?? '').trim().toLowerCase() === 'true' || String(value ?? '').trim() === '1');
    return marked || method.includes('balance') || method.includes('رصيد') || method.includes('الرصيد');
  }

  function renderMasterDaySummary() {
    const selectedDate = String($('master-search-date')?.value || '').trim() || masterDateInput(new Date());
    const orders = getMasterUniqueOrders().filter((order) => masterDateInput(order.created_at) === selectedDate);
    const prepaid = orders.filter((order) => isPaidInAdvance(order));
    const balance = orders.filter((order) => !isPaidInAdvance(order) && isBalancePaymentOrder(order));
    const cash = orders.filter((order) => !isPaidInAdvance(order) && !isBalancePaymentOrder(order) && normalizePayment(order.payment_method) === 'cash');
    const bank = orders.filter((order) => !isPaidInAdvance(order) && !isBalancePaymentOrder(order) && normalizePayment(order.payment_method) === 'bank_transfer');
    const bankReceived = bank.filter((order) => order.bank_transfer_received === true);
    const bankPending = bank.filter((order) => order.bank_transfer_received !== true);
    const sum = (items) => items.reduce((total, order) => total + masterMoney(order.total), 0);
    const money = (value) => `${value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} درهم`;
    const formatCount = (value) => value.toLocaleString('ar-EG-u-nu-latn');
    const customerCount = (items) => new Set(items.map((order) => String(order.customer_code || order.phone || order.customer_name || order.id || '').trim()).filter(Boolean)).size;
    const dateLabel = $('master-day-summary-date');
    if (dateLabel) dateLabel.textContent = `التاريخ: ${selectedDate.split('-').reverse().join('-')}`;
    const values = {
      'day-summary-count': formatCount(orders.length),
      'day-summary-cash-count': formatCount(customerCount(cash)),
      'day-summary-cash-total': money(sum(cash)),
      'day-summary-bank-count': formatCount(customerCount(bank)),
      'day-summary-bank-total': `${money(sum(bank))} إجمالي`,
      'day-summary-bank-received': money(sum(bankReceived)),
      'day-summary-bank-pending': money(sum(bankPending)),
      'day-summary-prepaid-count': formatCount(customerCount(prepaid)),
      'day-summary-prepaid-total': money(sum(prepaid)),
      'day-summary-balance-count': formatCount(customerCount(balance)),
      'day-summary-balance-total': money(sum(balance)),
      'day-summary-delivered': formatCount(orders.filter((order) => isDelivered(order.delivery_status)).length),
      'day-summary-received-total': money(sum(cash) + sum(bankReceived) + sum(prepaid) + sum(balance))
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = $(id);
      if (element) element.textContent = value;
    });
  }

  function renderMasterHomeDashboard() {
    const root = $('master-home-dashboard');
    if (!root) return;

    const allOrders = getMasterUniqueOrders();
    // Use the date selected in the invoices screen when available, so the home dashboard
    // can summarize a previous day without changing any invoice or driver behavior.
    const selectedDashboardDate = String($('master-search-date')?.value || '').trim();
    const today = selectedDashboardDate || masterDateInput(new Date());
    const todayOrders = allOrders.filter((order) => masterDateInput(order.created_at) === today);
    const isBalanceOrder = (order) => {
      const method = String(order?.payment_method || '').trim().toLowerCase();
      const marked = [order?.paid_from_balance, order?.balance_used, order?.customer_balance_used, order?.paid_by_balance]
        .some((value) => value === true || value === 1 || String(value ?? '').trim().toLowerCase() === 'true' || String(value ?? '').trim() === '1');
      return marked || method.includes('balance') || method.includes('رصيد') || method.includes('الرصيد');
    };
    const sum = (items) => items.reduce((total, order) => total + masterMoney(order.total), 0);
    const money = (value) => `${value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} درهم`;
    const countText = (value) => value.toLocaleString('ar-EG-u-nu-latn');
    const customerCount = (items) => new Set(items.map((order) => String(order.customer_code || order.phone || order.customer_name || order.id || '').trim()).filter(Boolean)).size;
    const cash = todayOrders.filter((order) => !isPaidInAdvance(order) && !isBalanceOrder(order) && normalizePayment(order.payment_method) === 'cash');
    const bank = todayOrders.filter((order) => !isPaidInAdvance(order) && !isBalanceOrder(order) && normalizePayment(order.payment_method) === 'bank_transfer');
    const prepaid = todayOrders.filter((order) => isPaidInAdvance(order));
    const balance = todayOrders.filter((order) => !isPaidInAdvance(order) && isBalanceOrder(order));
    const bankReceived = bank.filter((order) => order.bank_transfer_received === true);
    const bankPending = bank.filter((order) => order.bank_transfer_received !== true);
    const delivered = todayOrders.filter((order) => isDelivered(order.delivery_status));
    const undelivered = todayOrders.filter((order) => !isDelivered(order.delivery_status));
    const receivedTotal = sum(cash) + sum(bankReceived) + sum(prepaid) + sum(balance);

    const setText = (id, value) => { const element = $(id); if (element) element.textContent = value; };
    setText('home-kpi-count', countText(todayOrders.length));
    setText('home-kpi-sales', money(sum(todayOrders)));
    setText('home-kpi-received', money(receivedTotal));
    setText('home-kpi-pending', money(sum(bankPending)));
    setText('home-kpi-pending-hint', `${countText(bankPending.length)} فاتورة تحويل غير مؤكدة`);
    setText('home-alert-date', `التاريخ: ${today.split('-').reverse().join('-')}`);

    const alerts = $('master-home-alerts');
    if (alerts) {
      const alertItems = [
        { icon: '🏦', label: 'تحويلات بنكية لم يتم تأكيدها', count: bankPending.length, detail: money(sum(bankPending)), kind: bankPending.length ? '' : 'ok' },
        { icon: '📦', label: 'فواتير لم يتم تسليمها اليوم', count: undelivered.length, detail: `${money(sum(undelivered))} قيمة الفواتير`, kind: undelivered.length ? '' : 'ok' },
        { icon: '💵', label: 'عملاء دفعوا كاش', count: customerCount(cash), detail: money(sum(cash)), kind: 'ok' },
        { icon: '💳', label: 'عملاء دفعوا مقدمًا', count: customerCount(prepaid), detail: money(sum(prepaid)), kind: 'ok' },
        { icon: '👛', label: 'عملاء دفعوا من الرصيد', count: customerCount(balance), detail: money(sum(balance)), kind: 'ok' }
      ];
      alerts.innerHTML = alertItems.map((item) => `<div class="master-home-alert ${item.kind}"><div class="master-home-alert-copy"><span class="master-home-alert-icon">${item.icon}</span><span>${item.label}<small style="display:block;color:#94a3b8;font-size:10px;margin-top:3px">${item.detail}</small></span></div><strong class="master-home-alert-count">${countText(item.count)}</strong></div>`).join('');
    }

    const driverBody = $('master-home-driver-body');
    if (driverBody) {
      const driverDefs = [
        { key: 'Mandoub', label: 'مندوب 1' },
        { key: 'Mandoub2', label: 'مندوب 2' }
      ];
      driverBody.innerHTML = driverDefs.map((driver) => {
        const orders = todayOrders.filter((order) => String(order.sheet_name || '') === driver.key);
        const deliveredCount = orders.filter((order) => isDelivered(order.delivery_status)).length;
        const pendingCount = orders.length - deliveredCount;
        const percent = orders.length ? Math.round((deliveredCount / orders.length) * 100) : 0;
        return `<tr><td>${driver.label}</td><td>${countText(orders.length)}</td><td>${countText(deliveredCount)}<div class="master-home-progress"><span style="width:${percent}%"></span></div></td><td>${countText(pendingCount)}</td></tr>`;
      }).join('');
    }

    const chart = $('master-home-chart');
    if (chart) {
      const days = [];
      for (let offset = 6; offset >= 0; offset -= 1) {
        const date = new Date(`${today}T12:00:00`);
        date.setDate(date.getDate() - offset);
        const key = masterDateInput(date);
        const orders = allOrders.filter((order) => masterDateInput(order.created_at) === key);
        days.push({ key, label: date.toLocaleDateString('ar-EG-u-nu-latn', { day: '2-digit', month: '2-digit' }), total: sum(orders), count: orders.length });
      }
      const max = Math.max(1, ...days.map((day) => day.total));
      chart.innerHTML = days.map((day) => {
        const height = day.total > 0 ? Math.max(5, Math.round((day.total / max) * 100)) : 2;
        return `<div class="master-home-chart-day" title="${day.key}: ${money(day.total)} — ${countText(day.count)} فاتورة"><div class="master-home-chart-value">${day.total.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 })}</div><div class="master-home-chart-track"><div class="master-home-chart-bar" style="height:${height}%"></div></div><div class="master-home-chart-label">${day.label}</div></div>`;
      }).join('');
    }
  }

  function renderMasterOrders() {
    const body = $('master-orders-body');

    if (!body) {
      return;
    }

    const orders = getMasterFilteredOrders();

    renderMasterOldPendingTransfers();
    renderMasterMonthlyTransfers();
    renderMasterStats();
    renderMasterDaySummary();
    renderMasterHomeDashboard();

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
      tr.classList.add('master-invoice-compact-row');
      tr.title = 'اضغط لفتح تفاصيل الفاتورة';
      tr.style.cursor = 'pointer';

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
          <div class="master-edit-row">
            <button class="master-view" data-master-view="${masterEscape(order.id)}" type="button">عرض</button>
            <button class="master-edit-btn" data-master-edit="${masterEscape(order.id)}" type="button">✎ تعديل الفاتورة</button>
          </div>
        </td>
      `;

      tr.addEventListener('click', (event) => {
        if (event.target.closest('button, a, input, select, textarea, label')) return;
        openMasterOrder(order);
      });

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

      const editButton = tr.querySelector('[data-master-edit]');
      if (editButton) {
        editButton.addEventListener('click', () => openMasterEdit(order));
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

      ${String(chickenWeights).trim() || String(chickenQtys).trim() ? `
      <div class="master-section">
        <div class="master-section-title">🍗 الدجاج الكامل</div>
        <div class="master-section-content">${masterEscape([
          String(chickenWeights).trim() ? `الأوزان: ${chickenWeights}` : '',
          String(chickenQtys).trim() ? `الكميات: ${chickenQtys}` : ''
        ].filter(Boolean).join('\n'))}</div>
      </div>` : ''}

      ${String(plateNames).trim() || String(plateQtys).trim() ? `
      <div class="master-section">
        <div class="master-section-title">🍽️ المقطعات</div>
        <div class="master-section-content">${masterEscape([
          String(plateNames).trim() ? `الأصناف: ${plateNames}` : '',
          String(plateQtys).trim() ? `الكميات: ${plateQtys}` : ''
        ].filter(Boolean).join('\n'))}</div>
      </div>` : ''}

      ${String(order.order_details || '').trim() ? `
      <div class="master-section">
        <div class="master-section-title">📝 تفاصيل الطلب</div>
        <div class="master-section-content">${masterEscape(order.order_details)}</div>
      </div>` : ''}

      ${String(cleanOrderNote(order.note || order.notes || '')).trim() ? `
      <div class="master-section">
        <div class="master-section-title">📌 الملاحظات</div>
        <div class="master-section-content">${masterEscape(cleanOrderNote(order.note || order.notes || ''))}</div>
      </div>` : ''}

      ${safeUrl(order.location_url) ? `
      <div class="master-section">
        <div class="master-section-title">📍 الموقع</div>
        <div class="master-section-content"><a href="${masterEscape(safeUrl(order.location_url))}" target="_blank" rel="noopener noreferrer">فتح موقع العميل</a></div>
      </div>` : ''}

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
    lockMasterBackgroundScroll();
  }

  function masterParseEditCutQuantity(value) {
    const text = normalizeArabicDigits(String(value ?? ''))
      .replace(/هديّه|هديـة|هديه/g, 'هدية')
      .trim();
    const numbers = text.match(/\d+(?:[.,]\d+)?/g) || [];
    const hasGift = /هدية/.test(text);
    if (!numbers.length) return { base: '', gift: '' };
    if (hasGift && numbers.length >= 2) {
      return { base: numbers[0].replace(',', '.'), gift: numbers[1].replace(',', '.') };
    }
    if (hasGift) return { base: '', gift: numbers[0].replace(',', '.') };
    return { base: numbers[0].replace(',', '.'), gift: '' };
  }

  function masterNormalizeCutName(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function masterAppendChickenEditRow(container, weight = '', quantity = '') {
    const row = document.createElement('div');
    row.className = 'master-edit-chicken-row';
    row.innerHTML = `
      <label>الوزن (جرام)
        <input type="text" inputmode="decimal" autocomplete="off" data-master-chicken-weight value="${masterEscape(weight)}" aria-label="وزن الدجاج الكامل بالجرام">
      </label>
      <label>الكمية
        <input type="text" inputmode="decimal" autocomplete="off" data-master-chicken-qty value="${masterEscape(quantity)}" aria-label="كمية هذا الوزن">
      </label>
      <button type="button" class="master-edit-remove-row" data-master-remove-chicken>حذف السطر</button>
    `;
    container.appendChild(row);
    return row;
  }

  function masterAppendCutEditRow(container, name = '', quantity = '') {
    const parsed = masterParseEditCutQuantity(quantity);
    const row = document.createElement('div');
    row.className = 'master-edit-cut-row';
    row.dataset.originalName = String(name ?? '');
    row.dataset.originalQty = String(quantity ?? '');
    row.dataset.nameDirty = 'false';
    row.dataset.qtyDirty = 'false';
    row.innerHTML = `
      <label>الصنف
        <input type="text" list="master-cut-options" autocomplete="off" data-master-cut-name value="${masterEscape(name)}" aria-label="اسم صنف المقطعات">
      </label>
      <label>الكمية الأساسية
        <input type="text" inputmode="numeric" autocomplete="off" data-master-cut-qty value="${masterEscape(parsed.base)}" aria-label="الكمية الأساسية للصنف">
      </label>
      <label>كمية الهدية
        <input type="text" inputmode="numeric" autocomplete="off" data-master-cut-gift value="${masterEscape(parsed.gift)}" aria-label="كمية الهدية للصنف">
      </label>
      <button type="button" class="master-edit-remove-row" data-master-remove-cut>حذف الصنف</button>
    `;
    container.appendChild(row);
    return row;
  }

  function masterRenderEditProductRows(order) {
    const chickenContainer = $('master-edit-chicken-rows');
    const cutContainer = $('master-edit-cut-rows');
    if (!chickenContainer || !cutContainer) return;

    chickenContainer.dataset.dirty = 'false';
    cutContainer.dataset.dirty = 'false';

    const chickenWeights = extractNumbers(order.chicken_weights || '');
    const chickenQtys = extractNumbers(order.chicken_qtys || '');
    const chickenCount = Math.max(chickenWeights.length, chickenQtys.length);
    for (let index = 0; index < chickenCount; index += 1) {
      masterAppendChickenEditRow(chickenContainer, chickenWeights[index] || '', chickenQtys[index] || '');
    }
    if (!chickenCount) masterAppendChickenEditRow(chickenContainer);

    const cutNames = extractPlateNames(order.plate_names || '');
    const cutQtys = extractPlateQuantities(order.plate_qtys || '');
    const cutCount = Math.max(cutNames.length, cutQtys.length);
    for (let index = 0; index < cutCount; index += 1) {
      masterAppendCutEditRow(cutContainer, cutNames[index] || '', cutQtys[index] || '');
    }
    if (!cutCount) masterAppendCutEditRow(cutContainer);

    chickenContainer.addEventListener('input', (event) => {
      const row = event.target.closest('.master-edit-chicken-row');
      if (!row) return;
      if (event.target.matches('[data-master-chicken-weight]')) row.dataset.weightDirty = 'true';
      if (event.target.matches('[data-master-chicken-qty]')) row.dataset.qtyDirty = 'true';
      chickenContainer.dataset.dirty = 'true';
    });
    chickenContainer.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-master-remove-chicken]');
      if (!removeButton) return;
      event.preventDefault();
      removeButton.closest('.master-edit-chicken-row')?.remove();
      chickenContainer.dataset.dirty = 'true';
    });
    $('master-add-chicken-row')?.addEventListener('click', () => {
      masterAppendChickenEditRow(chickenContainer);
      chickenContainer.dataset.dirty = 'true';
    });

    cutContainer.addEventListener('input', (event) => {
      const row = event.target.closest('.master-edit-cut-row');
      if (!row) return;
      if (event.target.matches('[data-master-cut-name]')) row.dataset.nameDirty = 'true';
      if (event.target.matches('[data-master-cut-qty], [data-master-cut-gift]')) row.dataset.qtyDirty = 'true';
      cutContainer.dataset.dirty = 'true';
    });
    cutContainer.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-master-remove-cut]');
      if (!removeButton) return;
      event.preventDefault();
      removeButton.closest('.master-edit-cut-row')?.remove();
      cutContainer.dataset.dirty = 'true';
    });
    $('master-add-cut-row')?.addEventListener('click', () => {
      masterAppendCutEditRow(cutContainer);
      cutContainer.dataset.dirty = 'true';
    });
  }

  function masterCollectChickenEditValues(order) {
    const container = $('master-edit-chicken-rows');
    if (!container || container.dataset.dirty !== 'true') {
      return {
        changed: false,
        chicken_weights: order.chicken_weights ?? '',
        chicken_qtys: order.chicken_qtys ?? ''
      };
    }

    const weights = [];
    const quantities = [];
    const seenWeights = new Set();
    const rows = Array.from(container.querySelectorAll('.master-edit-chicken-row'));

    rows.forEach((row, index) => {
      const weight = normalizeArabicDigits(row.querySelector('[data-master-chicken-weight]')?.value ?? '').trim().replace(',', '.');
      const quantity = normalizeArabicDigits(row.querySelector('[data-master-chicken-qty]')?.value ?? '').trim().replace(',', '.');
      if (!weight && !quantity) return;
      if (!weight || !quantity) {
        throw new Error(`سطر الدجاج الكامل رقم ${index + 1}: أدخل الوزن والكمية معًا، أو احذف السطر.`);
      }
      if (!/^\d+(?:\.\d+)?$/.test(weight) || Number(weight) <= 0) {
        throw new Error(`وزن الدجاج الكامل في السطر ${index + 1} غير صحيح.`);
      }
      if (!/^\d+(?:\.\d+)?$/.test(quantity) || Number(quantity) <= 0) {
        throw new Error(`كمية الدجاج الكامل في السطر ${index + 1} غير صحيحة.`);
      }
      const weightKey = String(Number(weight));
      if (seenWeights.has(weightKey)) {
        throw new Error(`وزن ${weight} جرام مكرر. اجمع كمياته في سطر واحد قبل الحفظ.`);
      }
      seenWeights.add(weightKey);
      weights.push(weight);
      quantities.push(quantity);
    });

    return {
      changed: true,
      chicken_weights: weights.join('\n'),
      chicken_qtys: quantities.join('\n')
    };
  }

  function masterCollectCutEditValues(order) {
    const container = $('master-edit-cut-rows');
    if (!container || container.dataset.dirty !== 'true') {
      return {
        changed: false,
        plate_names: order.plate_names ?? '',
        plate_qtys: order.plate_qtys ?? ''
      };
    }

    const names = [];
    const quantities = [];
    const seenNames = new Set();
    const rows = Array.from(container.querySelectorAll('.master-edit-cut-row'));

    rows.forEach((row, index) => {
      const name = String(row.querySelector('[data-master-cut-name]')?.value ?? '').trim();
      const baseText = normalizeArabicDigits(row.querySelector('[data-master-cut-qty]')?.value ?? '').trim();
      const giftText = normalizeArabicDigits(row.querySelector('[data-master-cut-gift]')?.value ?? '').trim();
      if (!name && !baseText && !giftText) return;
      if (!name) throw new Error(`صنف المقطعات في السطر ${index + 1} بدون اسم. اكتب اسم الصنف أو احذف السطر.`);

      const key = masterNormalizeCutName(name);
      if (seenNames.has(key)) {
        throw new Error(`الصنف «${name}» مكرر. احتفظ بسطر واحد له قبل الحفظ لمنع تكرار الكمية في الفاتورة.`);
      }
      seenNames.add(key);

      let quantityText = '';
      if (row.dataset.qtyDirty !== 'true') {
        quantityText = String(row.dataset.originalQty ?? '').trim();
        if (!quantityText) {
          throw new Error(`أدخل الكمية الأساسية أو كمية الهدية للصنف «${name}».`);
        }
      } else {
        const baseValue = baseText === '' ? 0 : Number(baseText);
        const giftValue = giftText === '' ? 0 : Number(giftText);
        if ((baseText !== '' && !/^\d+$/.test(baseText)) || (giftText !== '' && !/^\d+$/.test(giftText))) {
          throw new Error(`كميات الصنف «${name}» يجب أن تكون أرقامًا صحيحة فقط.`);
        }
        if (!Number.isFinite(baseValue) || !Number.isFinite(giftValue) || baseValue < 0 || giftValue < 0) {
          throw new Error(`كميات الصنف «${name}» غير صحيحة.`);
        }
        if (baseValue === 0 && giftValue === 0) {
          throw new Error(`أدخل كمية للصنف «${name}» أو احذف السطر.`);
        }
        if (baseValue > 0 && giftValue > 0) quantityText = `${baseValue} + ${giftValue} هدية`;
        else if (baseValue > 0) quantityText = String(baseValue);
        else quantityText = `${giftValue} هدية`;
      }

      names.push(name);
      quantities.push(quantityText);
    });

    return {
      changed: true,
      plate_names: names.join('\n'),
      plate_qtys: quantities.join('\n')
    };
  }

  function masterLooksLikeGeneratedProductDetails(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text || !text.includes('|')) return false;
    const hasProductLabel = /(?:الدجاج الكامل|المقطعات)\s*[:：]/.test(text);
    const hasQuantityLabel = /(?:الكمية|كمية المقطعات|كمية الدجاج الكامل)\s*[:：]/.test(text);
    return hasProductLabel && hasQuantityLabel;
  }

  function openMasterEdit(order) {
    const body = $('master-modal-body');
    const title = $('master-modal-title');
    if (!body) return;

    if (title) {
      title.textContent = `تعديل الفاتورة #${order.order_number ?? order.id ?? ''}`;
    }

    body.innerHTML = `
      <div class="master-edit-form">
        <div class="master-edit-grid">
          <label>اسم العميل
            <input id="master-edit-customer" type="text" value="${masterEscape(order.customer_name || '')}">
          </label>
          <label>رقم الهاتف
            <input id="master-edit-phone" type="text" value="${masterEscape(order.phone || '')}">
          </label>
          <label>الإمارة
            <input id="master-edit-emirate" type="text" value="${masterEscape(order.emirate || '')}">
          </label>
          <label>المنطقة
            <input id="master-edit-area" type="text" value="${masterEscape(order.area || '')}">
          </label>
        </div>

        <div class="master-edit-products">
          <details class="master-edit-product-panel" open>
            <summary>الدجاج الكامل — الأوزان والكميات</summary>
            <div class="master-edit-product-hint">كل وزن في سطر مستقل، والكمية المقابلة له في نفس السطر. لن يتم دمج أوزان مختلفة.</div>
            <div class="master-edit-product-rows" id="master-edit-chicken-rows"></div>
            <button class="master-edit-add-row" type="button" id="master-add-chicken-row">＋ إضافة وزن جديد</button>
          </details>

          <details class="master-edit-product-panel">
            <summary>المقطعات — اضغط السهم لعرض الأصناف وتعديل كل صنف منفصلًا</summary>
            <div class="master-edit-product-hint">كل صنف له كمية أساسية وكمية هدية منفصلتان. تُحفظ الهدايا مع نفس الصنف من غير إنشاء صنف مكرر.</div>
            <datalist id="master-cut-options">
              <option value="أفخاذ"></option><option value="أرجل دبوس"></option><option value="صدور"></option>
              <option value="كبدة"></option><option value="قوانص"></option><option value="قلوب"></option>
              <option value="أجنحة"></option><option value="رقاب"></option><option value="ظهر"></option>
            </datalist>
            <div class="master-edit-product-rows" id="master-edit-cut-rows"></div>
            <button class="master-edit-add-row" type="button" id="master-add-cut-row">＋ إضافة صنف مقطعات</button>
          </details>
        </div>

        <div class="master-edit-grid" style="margin-top:12px">
          <label>الإجمالي
            <input id="master-edit-total" type="text" inputmode="decimal" value="${masterEscape(order.total ?? '')}">
          </label>
          <label>طريقة الدفع
            <select id="master-edit-payment">
              <option value="" ${!normalizePayment(order.payment_method) ? 'selected' : ''}>غير محدد</option>
              <option value="cash" ${normalizePayment(order.payment_method) === 'cash' ? 'selected' : ''}>💵 دفع كاش</option>
              <option value="bank_transfer" ${normalizePayment(order.payment_method) === 'bank_transfer' ? 'selected' : ''}>🏦 تحويل بنكي</option>
            </select>
          </label>
          <label>حالة التسليم
            <select id="master-edit-status">
              <option value="pending" ${!isDelivered(order.delivery_status) ? 'selected' : ''}>قيد التوصيل</option>
              <option value="delivered" ${isDelivered(order.delivery_status) ? 'selected' : ''}>تم التسليم</option>
            </select>
          </label>
        </div>

        <div class="master-edit-full">
          <label>رابط موقع العميل
            <input id="master-edit-location" type="text" value="${masterEscape(order.location_url || '')}">
          </label>
        </div>
        <div class="master-edit-full">
          <label>تفاصيل الطلب
            <textarea id="master-edit-details">${masterEscape(order.order_details || '')}</textarea>
          </label>
        </div>
        <div class="master-edit-full">
          <label>الملاحظات
            <textarea id="master-edit-note">${masterEscape(order.note || order.notes || '')}</textarea>
          </label>
        </div>
        <div class="master-actions-row">
          <button class="master-btn primary" id="master-save-edit" type="button">💾 حفظ التعديل</button>
          <button class="master-btn secondary" id="master-cancel-edit" type="button">رجوع</button>
        </div>
      </div>
    `;

    masterRenderEditProductRows(order);

    $('master-save-edit')?.addEventListener('click', () => saveMasterOrder(order));
    $('master-cancel-edit')?.addEventListener('click', () => openMasterOrder(order));
    $('master-modal')?.classList.add('open');
  }

  async function saveMasterOrder(order) {
    const button = $('master-save-edit');
    if (button?.dataset.saving === 'true') return;
    if (button) {
      button.dataset.saving = 'true';
      button.disabled = true;
      button.textContent = 'جارٍ الحفظ…';
    }

    try {
      if (order?.id == null || String(order.id).trim() === '') {
        throw new Error('لا يمكن حفظ التعديل لأن معرّف الفاتورة في قاعدة البيانات غير موجود. لم يتم إرسال أي طلب لمنع إنشاء فاتورة مكررة.');
      }

      const chicken = masterCollectChickenEditValues(order);
      const cuts = masterCollectCutEditValues(order);
      const enteredDetails = $('master-edit-details')?.value ?? order.order_details ?? '';
      const productsChanged = chicken.changed || cuts.changed;
      const detailsUnchanged = String(enteredDetails).trim() === String(order.order_details ?? '').trim();
      // Older Excel syncs may copy the same products into order_details as a plain-text summary.
      // When structured products are edited, remove only that unchanged generated summary so it
      // cannot appear as a second, stale copy below the structured products on the driver invoice.
      const orderDetails = productsChanged && detailsUnchanged && masterLooksLikeGeneratedProductDetails(enteredDetails)
        ? ''
        : enteredDetails;

      const updatedOrder = {
        ...order,
        customer_name: $('master-edit-customer')?.value ?? order.customer_name ?? '',
        phone: $('master-edit-phone')?.value ?? order.phone ?? '',
        emirate: $('master-edit-emirate')?.value ?? order.emirate ?? '',
        area: $('master-edit-area')?.value ?? order.area ?? '',
        chicken_weights: chicken.chicken_weights,
        chicken_qtys: chicken.chicken_qtys,
        plate_names: cuts.plate_names,
        plate_qtys: cuts.plate_qtys,
        total: $('master-edit-total')?.value ?? order.total ?? '',
        location_url: $('master-edit-location')?.value ?? order.location_url ?? '',
        order_details: orderDetails,
        note: $('master-edit-note')?.value ?? order.note ?? order.notes ?? '',
        payment_method: $('master-edit-payment')?.value ?? order.payment_method ?? '',
        delivery_status: $('master-edit-status')?.value ?? order.delivery_status ?? 'pending'
      };

      // Keep the existing endpoint and this exact order ID: editing must update this invoice,
      // not create a new invoice or change any unrelated master/driver functions.
      const data = await masterFetch('/api/master/order/update', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          order: updatedOrder
        })
      });

      const saved = data?.order || data?.data || data;
      const index = state.masterOrders.findIndex((item) => String(item.id) === String(order.id));
      if (index !== -1) {
        state.masterOrders[index] = {
          ...state.masterOrders[index],
          ...updatedOrder,
          ...(saved && typeof saved === 'object' ? saved : {})
        };
      }

      const current = state.masterOrders[index] || order;
      toast('تم تعديل الفاتورة بنجاح ✅');
      openMasterOrder(current);
      renderMasterOrders();

    } catch (error) {
      if (error.message === 'expired') return;
      toast(error.message || 'تعذر حفظ التعديل', true);
      if (button) {
        button.disabled = false;
        button.dataset.saving = 'false';
        button.textContent = '💾 حفظ التعديل';
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

  let masterModalScrollY = 0;
  let masterModalScrollLocked = false;

  function lockMasterBackgroundScroll() {
    if (masterModalScrollLocked) return;
    masterModalScrollY = window.scrollY || window.pageYOffset || 0;
    const body = document.body;
    body.dataset.masterPreviousPosition = body.style.position || '';
    body.dataset.masterPreviousTop = body.style.top || '';
    body.dataset.masterPreviousWidth = body.style.width || '';
    body.dataset.masterPreviousOverflow = body.style.overflow || '';
    body.style.position = 'fixed';
    body.style.top = `-${masterModalScrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    masterModalScrollLocked = true;
  }

  function unlockMasterBackgroundScroll() {
    if (!masterModalScrollLocked) return;
    const body = document.body;
    body.style.position = body.dataset.masterPreviousPosition || '';
    body.style.top = body.dataset.masterPreviousTop || '';
    body.style.width = body.dataset.masterPreviousWidth || '';
    body.style.overflow = body.dataset.masterPreviousOverflow || '';
    delete body.dataset.masterPreviousPosition;
    delete body.dataset.masterPreviousTop;
    delete body.dataset.masterPreviousWidth;
    delete body.dataset.masterPreviousOverflow;
    masterModalScrollLocked = false;
    window.scrollTo(0, masterModalScrollY);
  }

  function closeMasterModal() {
    $('master-modal')?.classList.remove('open');
    unlockMasterBackgroundScroll();
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
