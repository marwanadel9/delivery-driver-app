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

    if (!nameList.length) {
      return '—';
    }

    /*
     * الصحون لا نعرض لها أي علامة كرتونة/طبق.
     *
     * إذا كان عدد الكميات أكبر من عدد الأصناف بكمية واحدة
     * فهذا يعني أن الكمية الزائدة هدية للصنف الأخير.
     */
    const result = [];

    for (
      let i = 0;
      i < nameList.length;
      i += 1
    ) {
      const name =
        nameList[i] || '';

      let qty =
        qtyList[i] || '';

      if (
        i === nameList.length - 1 &&
        qtyList.length > nameList.length
      ) {
        const extraQty =
          qtyList
            .slice(nameList.length)
            .filter(Boolean)
            .join(' + ');

        if (extraQty) {
          if (
            /هدية|هديه/i.test(extraQty)
          ) {
            qty = qty
              ? `${qty} + ${extraQty}`
              : extraQty;
          } else {
            qty = qty
              ? `${qty} + ${extraQty} هدية`
              : `${extraQty} هدية`;
          }
        }
      }

      if (!name) {
        continue;
      }

      result.push(
        qty
          ? `${name} — ${qty}`
          : name
      );
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
            '.product-box, .info-item, .order-section, .detail-row, .field-row'
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
            '.product-box, .info-item, .order-section, .detail-row, .field-row'
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

  const MASTER_SESSION_KEY =
    'master_session';

  const MASTER_USERNAME =
    'zezo';

  state.masterOrders = [];
  state.role = '';

  function normalizeMasterSession(
    value
  ) {
    if (
      !value ||
      typeof value !== 'object'
    ) {
      return null;
    }

    return {
      access_token:
        String(
          value.access_token || ''
        ),

      refresh_token:
        String(
          value.refresh_token || ''
        ),

      expires_at:
        Number(
          value.expires_at || 0
        ),

      username:
        String(
          value.username ||
          MASTER_USERNAME
        ),

      email:
        String(
          value.email || ''
        ),

      role:
        String(
          value.role ||
          'master_admin'
        )
    };
  }

  function saveMasterSession(
    session
  ) {
    if (!session) {
      localStorage.removeItem(
        MASTER_SESSION_KEY
      );

      state.masterSession =
        null;

      return;
    }

    const normalized =
      normalizeMasterSession(
        session
      );

    if (
      !normalized?.access_token
    ) {
      localStorage.removeItem(
        MASTER_SESSION_KEY
      );

      state.masterSession =
        null;

      return;
    }

    state.masterSession =
      normalized;

    localStorage.setItem(
      MASTER_SESSION_KEY,
      JSON.stringify(
        normalized
      )
    );
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

      const session =
        normalizeMasterSession(
          parsed
        );

      if (
        !session?.access_token
      ) {
        return null;
      }

      if (
        session.expires_at &&
        session.expires_at <
          Date.now() / 1000 + 30
      ) {
        localStorage.removeItem(
          MASTER_SESSION_KEY
        );

        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  async function masterFetch(
    path,
    options = {}
  ) {
    if (
      !state.masterSession?.access_token
    ) {
      throw new Error(
        'expired'
      );
    }

    const headers = {
      'Content-Type':
        'application/json',

      Authorization:
        `Bearer ${state.masterSession.access_token}`,

      ...(options.headers || {})
    };

    const response =
      await fetch(
        path,
        {
          ...options,
          headers
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (
      response.status === 401
    ) {
      masterLogout(
        'انتهت جلسة الماستر، يرجى تسجيل الدخول مجددًا'
      );

      throw new Error(
        'expired'
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        'حدث خطأ غير متوقع'
      );
    }

    return data;
  }

  function masterMoney(
    value
  ) {
    const number =
      Number(
        String(
          value ?? ''
        ).replace(
          /[^\d.-]/g,
          ''
        )
      );

    if (
      !Number.isFinite(number)
    ) {
      return 0;
    }

    return number;
  }

  function masterDriver(
    order
  ) {
    const sheet =
      String(
        order.sheet_name || ''
      ).trim();

    if (
      sheet === 'Mandoub2'
    ) {
      return 'مندوب 2';
    }

    if (
      sheet === 'Mandoub'
    ) {
      return 'مندوب 1';
    }

    return sheet || '—';
  }

  function masterPaymentText(
    value
  ) {
    const payment =
      normalizePayment(
        value
      );

    if (
      payment === 'cash'
    ) {
      return 'دفع كاش';
    }

    if (
      payment ===
      'bank_transfer'
    ) {
      return 'تحويل بنكي';
    }

    return 'غير محدد';
  }

  function masterDate(
    value
  ) {
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

    return date.toLocaleDateString(
      'ar-EG'
    );
  }

  function masterDateInput(
    value
  ) {
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
      ).padStart(2, '0');

    const day =
      String(
        date.getDate()
      ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  function masterEscape(
    value
  ) {
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

  function masterLogout(
    message = ''
  ) {
    saveMasterSession(
      null
    );

    state.masterOrders =
      [];

    state.role =
      '';

    if (
      $('master-view')
    ) {
      $('master-view').remove();
    }

    showLogin(
      message
    );
  }

  function showMasterView() {
    const existing =
      $('master-view');

    if (existing) {
      existing.remove();
    }

    const wrapper =
      document.createElement(
        'div'
      );

    wrapper.id =
      'master-view';

    wrapper.className =
      'master-view';

    wrapper.innerHTML = `
      <div class="master-page">

        <header class="master-header">

          <div class="master-brand">
            <div class="master-logo">
              🐔
            </div>

            <div>
              <strong>
                فروج الزين
              </strong>

              <span>
                لوحة التحكم
              </span>
            </div>
          </div>

          <div class="master-actions">

            <button
              id="master-refresh"
              class="master-btn"
              type="button"
            >
              ↻ تحديث
            </button>

            <button
              id="master-logout"
              class="master-btn danger"
              type="button"
            >
              تسجيل الخروج
            </button>

          </div>

        </header>

        <main class="master-main">

          <section class="master-title-row">

            <div>
              <span class="master-eyebrow">
                الإدارة
              </span>

              <h1>
                إدارة الفواتير
              </h1>

              <p>
                عرض ومتابعة جميع الطلبات
              </p>
            </div>

          </section>

          <section class="master-stats">

            <div class="master-stat">
              <div class="master-stat-label">
                عدد الفواتير
              </div>

              <div
                class="master-stat-value"
                id="master-month-count"
              >
                0
              </div>
            </div>

            <div class="master-stat">
              <div class="master-stat-label">
                إجمالي الشهر
              </div>

              <div
                class="master-stat-value"
                id="master-month-total"
              >
                0 درهم
              </div>
            </div>

            <div class="master-stat">
              <div class="master-stat-label">
                كاش
              </div>

              <div
                class="master-stat-value"
                id="master-month-cash"
              >
                0 درهم
              </div>
            </div>

            <div class="master-stat">
              <div class="master-stat-label">
                تحويل بنكي
              </div>

              <div
                class="master-stat-value"
                id="master-month-bank"
              >
                0 درهم
              </div>
            </div>

            <div class="master-stat">
              <div class="master-stat-label">
                تم التسليم
              </div>

              <div
                class="master-stat-value"
                id="master-delivered"
              >
                0
              </div>
            </div>

          </section>

          <section class="master-filters">

            <div class="master-filter">
              <label>
                رقم الفاتورة
              </label>

              <input
                id="master-search-number"
                type="text"
                placeholder="ابحث برقم الفاتورة"
              >
            </div>

            <div class="master-filter">
              <label>
                اسم العميل
              </label>

              <input
                id="master-search-name"
                type="text"
                placeholder="اسم العميل"
              >
            </div>

            <div class="master-filter">
              <label>
                رقم الهاتف
              </label>

              <input
                id="master-search-phone"
                type="text"
                placeholder="رقم الهاتف"
              >
            </div>

            <div class="master-filter">
              <label>
                التاريخ
              </label>

              <input
                id="master-search-date"
                type="date"
              >
            </div>

            <div class="master-filter">
              <label>
                المندوب
              </label>

              <select
                id="master-filter-driver"
              >
                <option value="">
                  الكل
                </option>

                <option value="Mandoub">
                  مندوب 1
                </option>

                <option value="Mandoub2">
                  مندوب 2
                </option>
              </select>
            </div>

            <div class="master-filter">
              <label>
                حالة التسليم
              </label>

              <select
                id="master-filter-status"
              >
                <option value="">
                  الكل
                </option>

                <option value="pending">
                  قيد التوصيل
                </option>

                <option value="delivered">
                  تم التسليم
                </option>
              </select>
            </div>

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

              <tbody
                id="master-orders-body"
              ></tbody>

            </table>

          </section>

        </main>

        <div
          class="master-modal"
          id="master-modal"
        >

          <div
            class="master-modal-card"
          >

            <div
              class="master-modal-head"
            >

              <strong
                id="master-modal-title"
              >
                تفاصيل الفاتورة
              </strong>

              <button
                class="master-modal-close"
                id="master-modal-close"
              >
                ×
              </button>

            </div>

            <div
              class="master-modal-body"
              id="master-modal-body"
            ></div>

          </div>

        </div>

      </div>
    `;

    document.body.appendChild(
      wrapper
    );

    $('master-refresh')
      ?.addEventListener(
        'click',
        loadMasterOrders
      );

    $('master-logout')
      ?.addEventListener(
        'click',
        () => masterLogout()
      );

    $('master-modal-close')
      ?.addEventListener(
        'click',
        closeMasterModal
      );

    $('master-modal')
      ?.addEventListener(
        'click',
        (event) => {
          if (
            event.target.id ===
            'master-modal'
          ) {
            closeMasterModal();
          }
        }
      );

    [
      'master-search-number',
      'master-search-name',
      'master-search-phone',
      'master-search-date',
      'master-filter-driver',
      'master-filter-status'
    ].forEach(
      (id) => {
        $(id)
          ?.addEventListener(
            'input',
            renderMasterOrders
          );

        $(id)
          ?.addEventListener(
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
        $('master-search-number')
          ?.value || ''
      )
        .trim()
        .toLowerCase();

    const name =
      String(
        $('master-search-name')
          ?.value || ''
      )
        .trim()
        .toLowerCase();

    const phone =
      String(
        $('master-search-phone')
          ?.value || ''
      )
        .trim()
        .toLowerCase();

    const date =
      String(
        $('master-search-date')
          ?.value || ''
      ).trim();

    const driver =
      String(
        $('master-filter-driver')
          ?.value || ''
      ).trim();

    const status =
      String(
        $('master-filter-status')
          ?.value || ''
      ).trim();

    return state.masterOrders.filter(
      (order) => {

        const orderNumber =
          String(
            order.order_number ??
            order.id ??
            ''
          ).toLowerCase();

        const customerName =
          String(
            order.customer_name ??
            ''
          ).toLowerCase();

        const customerPhone =
          String(
            order.phone ??
            ''
          ).toLowerCase();

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
            order.sheet_name || ''
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
        (
          sum,
          order
        ) =>
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
            ) ===
            'cash'
        )
        .reduce(
          (
            sum,
            order
          ) =>
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
          (
            sum,
            order
          ) =>
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
      $('master-month-count')
        .textContent =
        monthly.length.toLocaleString(
          'ar-EG'
        );
    }

    if (
      $('master-month-total')
    ) {
      $('master-month-total')
        .textContent =
        `${total.toLocaleString('ar-EG', {
          maximumFractionDigits: 2
        })} درهم`;
    }

    if (
      $('master-month-cash')
    ) {
      $('master-month-cash')
        .textContent =
        `${cash.toLocaleString('ar-EG', {
          maximumFractionDigits: 2
        })} درهم`;
    }

    if (
      $('master-month-bank')
    ) {
      $('master-month-bank')
        .textContent =
        `${bank.toLocaleString('ar-EG', {
          maximumFractionDigits: 2
        })} درهم`;
    }

    if (
      $('master-delivered')
    ) {
      $('master-delivered')
        .textContent =
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
                .join(
                  ' / '
                ) ||
              '—'
            )}
          </td>

          <td>
            ${masterEscape(
              masterDriver(
                order
              )
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
            <span
              class="master-badge ${
                payment ===
                'cash'
                  ? 'cash'
                  : payment ===
                    'bank_transfer'
                    ? 'bank'
                    : ''
              }"
            >
              ${masterEscape(
                masterPaymentText(
                  order.payment_method
                )
              )}
            </span>
          </td>

          <td>
            <span
              class="master-badge ${
                delivered
                  ? 'ok'
                  : 'pending'
              }"
            >
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
              )}"
            >
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

    if (!modal || !body) {
      return;
    }

    const chickenWeights =
      firstValue(
        order,
        [
          'chicken_weights',
          'chickenWeights',
          'chicken_weight'
        ]
      );

    const chickenQtys =
      firstValue(
        order,
        [
          'chicken_qtys',
          'chickenQtys',
          'chicken_quantities'
        ]
      );

    const plateNames =
      firstValue(
        order,
        [
          'plate_names',
          'plateNames',
          'plates'
        ]
      );

    const plateQtys =
      firstValue(
        order,
        [
          'plate_qtys',
          'plateQtys',
          'plate_quantities'
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

    body.innerHTML = `
      <div class="master-detail-grid">

        <div class="master-detail-item">
          <span>رقم الفاتورة</span>
          <strong>
            #${masterEscape(
              order.order_number ??
              order.id ??
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>اسم العميل</span>
          <strong>
            ${masterEscape(
              order.customer_name ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>رقم الهاتف</span>
          <strong>
            ${masterEscape(
              order.phone ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>الإمارة</span>
          <strong>
            ${masterEscape(
              order.emirate ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>المنطقة</span>
          <strong>
            ${masterEscape(
              order.area ||
              '—'
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>المندوب</span>
          <strong>
            ${masterEscape(
              masterDriver(order)
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>طريقة الدفع</span>
          <strong>
            ${masterEscape(
              masterPaymentText(
                order.payment_method
              )
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>الحالة</span>
          <strong>
            ${
              isDelivered(
                order.delivery_status
              )
                ? '✓ تم التسليم'
                : '⏳ قيد التوصيل'
            }
          </strong>
        </div>

        <div class="master-detail-item">
          <span>الإجمالي</span>
          <strong>
            ${formatTotal(
              order.total
            )}
          </strong>
        </div>

        <div class="master-detail-item">
          <span>التاريخ</span>
          <strong>
            ${masterEscape(
              masterDate(
                order.created_at
              )
            )}
          </strong>
        </div>

      </div>

      <div class="master-detail-products">

        <div class="master-detail-product">

          <h3>
            🍗 الدجاج الكامل
          </h3>

          <div class="master-product-lines">
            ${masterEscape(
              chickenDisplay
            ).replace(
              /\n/g,
              '<br>'
            )}
          </div>

        </div>

        <div class="master-detail-product">

          <h3>
            🍽️ المقطعات
          </h3>

          <div class="master-product-lines">
            ${masterEscape(
              plateDisplay
            ).replace(
              /\n/g,
              '<br>'
            )}
          </div>

        </div>

      </div>

      <div class="master-detail-note">

        <span>
          ملاحظات
        </span>

        <strong>
          ${masterEscape(
            firstValue(
              order,
              [
                'note',
                'notes',
                'remarks'
              ]
            ) ||
            '—'
          )}
        </strong>

      </div>
    `;

    const title =
      $('master-modal-title');

    if (title) {
      title.textContent =
        `تفاصيل الفاتورة #${
          order.order_number ??
          order.id ??
          ''
        }`;
    }

    modal.classList.add(
      'open'
    );
  }

  function closeMasterModal() {
    const modal =
      $('master-modal');

    if (modal) {
      modal.classList.remove(
        'open'
      );
    }
  }

  async function masterLogin(
    username,
    password
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
        'بيانات الدخول غير صحيحة'
      );
    }

    saveMasterSession(
      normalizeMasterSession(
        data
      )
    );

    state.role =
      'master';

    const loginView =
      $('login-view');

    if (loginView) {
      loginView.hidden =
        true;
    }

    showMasterView();
  }

  async function driverLogin(
    username,
    password
  ) {
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
        'اسم المستخدم أو كلمة المرور غير صحيحة'
      );
    }

    saveSession(
      normalizeSession(
        data
      )
    );

    state.role =
      'driver';

    showOrders();
  }

  function setupLogin() {
    const form =
      $('login-form');

    if (!form) {
      return;
    }

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        const username =
          String(
            $('username')?.value ||
            ''
          ).trim();

        const password =
          String(
            $('password')?.value ||
            ''
          );

        const button =
          $('login-btn');

        const error =
          $('login-error');

        if (error) {
          error.hidden =
            true;

          error.textContent =
            '';
        }

        if (
          !username ||
          !password
        ) {
          if (error) {
            error.hidden =
              false;

            error.textContent =
              'اكتب اسم المستخدم وكلمة المرور.';
          }

          return;
        }

        if (button) {
          button.disabled =
            true;

          button.classList.add(
            'loading'
          );
        }

        try {

          if (
            username.toLowerCase() ===
            MASTER_USERNAME
          ) {
            await masterLogin(
              username,
              password
            );
          } else {
            await driverLogin(
              username,
              password
            );
          }

        } catch (err) {

          if (error) {
            error.hidden =
              false;

            error.textContent =
              err.message ||
              'حدث خطأ أثناء تسجيل الدخول.';
          }

        } finally {

          if (button) {
            button.disabled =
              false;

            button.classList.remove(
              'loading'
            );
          }

        }
      }
    );
  }

  function setupOrders() {

    $('refresh-btn')
      ?.addEventListener(
        'click',
        loadOrders
      );

    $('logout-btn')
      ?.addEventListener(
        'click',
        () => {
          logout();
        }
      );

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
                  (item) =>
                    item.classList.remove(
                      'active'
                    )
                );

              tab.classList.add(
                'active'
              );

              state.filter =
                tab.dataset.filter ||
                'pending';

              render();
            }
          );
        }
      );
  }

  function restoreSession() {

    const storedDriver =
      localStorage.getItem(
        SESSION_KEY
      );

    if (storedDriver) {
      try {

        const session =
          normalizeSession(
            JSON.parse(
              storedDriver
            )
          );

        if (
          session.access_token
        ) {
          if (
            session.expires_at >
            Date.now() / 1000 + 30
          ) {
            state.session =
              session;

            state.role =
              'driver';

            showOrders();

            return true;
          }
        }

      } catch {
        localStorage.removeItem(
          SESSION_KEY
        );
      }
    }

    const master =
      loadStoredMasterSession();

    if (master) {
      state.masterSession =
        master;

      state.role =
        'master';

      showMasterView();

      return true;
    }

    return false;
  }

  function boot() {

    setupLogin();

    setupOrders();

    if (
      !restoreSession()
    ) {
      showLogin();
    }

  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      boot
    );
  } else {
    boot();
  }

})();
