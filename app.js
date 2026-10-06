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

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeSession(session) {
    if (!session || typeof session !== 'object') {
      return null;
    }

    return {
      access_token: session.access_token || '',
      refresh_token: session.refresh_token || '',
      user: session.user || null,
      sheet: session.sheet || ''
    };
  }

  function saveSession(session) {
    const normalized = normalizeSession(session);

    if (!normalized) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }

    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify(normalized)
    );
  }

  function loadSession() {
    try {
      const raw =
        localStorage.getItem(
          SESSION_KEY
        );

      if (!raw) {
        return null;
      }

      return normalizeSession(
        JSON.parse(raw)
      );
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(
      SESSION_KEY
    );

    state.session = null;
    state.orders = [];
    state.sheet = '';
  }

  function showLogin() {
    const login =
      $('login-screen');

    const app =
      $('app-screen');

    if (login) {
      login.hidden = false;
    }

    if (app) {
      app.hidden = true;
    }
  }

  function showApp() {
    const login =
      $('login-screen');

    const app =
      $('app-screen');

    if (login) {
      login.hidden = true;
    }

    if (app) {
      app.hidden = false;
    }
  }

  function setLoginMessage(
    message,
    type = ''
  ) {
    const element =
      $('login-message');

    if (!element) {
      return;
    }

    element.textContent =
      message || '';

    element.className =
      `login-message ${type}`.trim();
  }

  function setAppMessage(
    message,
    type = ''
  ) {
    const element =
      $('app-message');

    if (!element) {
      return;
    }

    element.textContent =
      message || '';

    element.className =
      `app-message ${type}`.trim();
  }

  function normalizePayment(value) {
    const text =
      String(value ?? '')
        .trim()
        .toLowerCase();

    if (
      text === 'cash' ||
      text === 'كاش' ||
      text === 'دفع كاش'
    ) {
      return 'cash';
    }

    if (
      text === 'bank_transfer' ||
      text === 'bank' ||
      text === 'transfer' ||
      text === 'تحويل' ||
      text === 'تحويل بنكي'
    ) {
      return 'bank_transfer';
    }

    return '';
  }

  function paymentLabel(value) {
    const payment =
      normalizePayment(value);

    if (payment === 'cash') {
      return '💵 دفع كاش';
    }

    if (
      payment ===
      'bank_transfer'
    ) {
      return '🏦 تحويل بنكي';
    }

    return 'لم يتم تحديد طريقة الدفع';
  }

  function normalizeStatus(value) {
    const text =
      String(value ?? '')
        .trim()
        .toLowerCase();

    if (
      text === 'delivered' ||
      text === 'done' ||
      text === 'completed' ||
      text === 'تم التسليم'
    ) {
      return 'delivered';
    }

    return 'pending';
  }

  function isDelivered(value) {
    return (
      normalizeStatus(value) ===
      'delivered'
    );
  }

  function statusLabel(value) {
    return isDelivered(value)
      ? 'تم التسليم'
      : 'قيد التوصيل';
  }

  function formatTotal(value) {
    const text =
      String(value ?? '').trim();

    if (!text) {
      return '—';
    }

    if (
      /درهم|AED/i.test(text)
    ) {
      return text;
    }

    const number =
      Number(
        text.replace(
          /[^\d.-]/g,
          ''
        )
      );

    if (
      Number.isFinite(number)
    ) {
      return `${number} درهم`;
    }

    return text;
  }

  function formatDate(value) {
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
      'ar-AE',
      {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }
    );
  }

  function firstValue(
    order,
    keys
  ) {
    for (const key of keys) {
      const value =
        order?.[key];

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

  function extractNumbers(
    value
  ) {
    const text =
      String(value ?? '')
        .replace(
          /[٠-٩]/g,
          (digit) =>
            String(
              '٠١٢٣٤٥٦٧٨٩'
                .indexOf(
                  digit
                )
            )
        );

    return (
      text.match(
        /\d+(?:[.,]\d+)?/g
      ) || []
    );
  }

  function extractChickenWeights(
    value
  ) {
    const text =
      String(value ?? '')
        .replace(
          /[٠-٩]/g,
          (digit) =>
            String(
              '٠١٢٣٤٥٦٧٨٩'
                .indexOf(
                  digit
                )
            )
        );

    if (!text.trim()) {
      return [];
    }

    const lines =
      text
        .split(
          /[\r\n,]+/
        )
        .map(
          (line) =>
            line.trim()
        )
        .filter(Boolean);

    const result = [];

    for (const line of lines) {
      const match =
        line.match(
          /\d+(?:[.,]\d+)?/
        );

      if (!match) {
        continue;
      }

      const number =
        Number(
          match[0]
            .replace(
              ',',
              '.'
            )
        );

      if (
        !Number.isFinite(
          number
        )
      ) {
        continue;
      }

      /*
       * بيانات الإكسل قد تحتوي على:
       * Chicken Carton 10 pcs
       * قبل أوزان الدجاج.
       *
       * لذلك لا نستخدم أي رقم أقل من
       * 300 كوزن.
       */
      if (number < 300) {
        continue;
      }

      result.push(
        match[0]
      );
    }

    /*
     * لو البيانات كانت في نص واحد
     * بدون أسطر واضحة.
     */
    if (!result.length) {
      const all =
        extractNumbers(
          text
        );

      for (const item of all) {
        const number =
          Number(
            item.replace(
              ',',
              '.'
            )
          );

        if (
          Number.isFinite(
            number
          ) &&
          number >= 300
        ) {
          result.push(item);
        }
      }
    }

    return result;
  }

  function extractQuantities(
    value
  ) {
    const text =
      String(value ?? '')
        .replace(
          /[٠-٩]/g,
          (digit) =>
            String(
              '٠١٢٣٤٥٦٧٨٩'
                .indexOf(
                  digit
                )
            )
        )
        .replace(
          /هديّه|هديـة|هديه/g,
          'هدية'
        )
        .trim();

    if (!text) {
      return [];
    }

    const matches =
      text.match(
        /\d+\s*\+\s*\d+\s*هدية|\d+\s*\+\s*\d+|\d+/g
      ) || [];

    return matches.map(
      (item) =>
        item
          .replace(
            /\s+/g,
            ' '
          )
          .trim()
    );
  }

  function formatChickenLines(
    weights,
    quantities
  ) {
    const weightList =
      extractChickenWeights(
        weights
      );

    const qtyList =
      extractQuantities(
        quantities
      );

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

      if (
        !weight &&
        !qty
      ) {
        continue;
      }

      if (
        weight &&
        qty
      ) {
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

  function extractPlateNames(
    value
  ) {
    const text =
      String(value ?? '')
        .trim();

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
            b.length -
            a.length
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

  function extractPlateQuantities(
    value
  ) {
    const text =
      String(value ?? '')
        .replace(
          /[٠-٩]/g,
          (digit) =>
            String(
              '٠١٢٣٤٥٦٧٨٩'
                .indexOf(
                  digit
                )
            )
        )
        .replace(
          /هديّه|هديـة|هديه/g,
          'هدية'
        )
        .trim();

    if (!text) {
      return [];
    }

    const matches =
      text.match(
        /\d+\s*\+\s*\d+\s*هدية|\d+\s*\+\s*\d+|\d+/g
      ) || [];

    return matches.map(
      (item) =>
        item
          .replace(
            /\s+/g,
            ' '
          )
          .trim()
    );
  }

  function formatPlateLines(
    names,
    quantities
  ) {
    const nameList =
      extractPlateNames(
        names
      );

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

      if (
        !name &&
        !qty
      ) {
        continue;
      }

      if (
        name &&
        qty
      ) {
        result.push(
          `🍽️ ${name} — ${qty}`
        );
      } else if (name) {
        result.push(
          `🍽️ ${name}`
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

  function normalizeOrder(
    order
  ) {
    if (
      !order ||
      typeof order !==
        'object'
    ) {
      return null;
    }

    return {
      ...order,
      delivery_status:
        normalizeStatus(
          order.delivery_status
        )
    };
  }

  function getFilteredOrders() {
    return state.orders.filter(
      (order) => {
        if (
          state.filter ===
          'all'
        ) {
          return true;
        }

        if (
          state.filter ===
          'done'
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

  function updateStats() {
    const pending =
      state.orders.filter(
        (order) =>
          !isDelivered(
            order.delivery_status
          )
      ).length;

    const done =
      state.orders.filter(
        (order) =>
          isDelivered(
            order.delivery_status
          )
      ).length;

    const all =
      state.orders.length;

    const pendingElement =
      $('pending-count');

    const doneElement =
      $('done-count');

    const allElement =
      $('all-count');

    if (
      pendingElement
    ) {
      pendingElement.textContent =
        pending;
    }

    if (doneElement) {
      doneElement.textContent =
        done;
    }

    if (allElement) {
      allElement.textContent =
        all;
    }
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
        state.filter ===
        'done'
          ? 'لا توجد طلبات مسلّمة بعد'
          : state.filter ===
            'all'
            ? 'لا توجد طلبات حالياً'
            : 'لا توجد طلبات قيد التوصيل';

      list.innerHTML =
        `<p class="empty">
          <span class="big">📦</span>
          ${escapeHtml(message)}
        </p>`;

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

      if (
        chickenQtyElement
      ) {
        const chickenQtyBox =
          chickenQtyElement.closest(
            '.info-item, .order-section, .detail-row, .field-row, .product-box'
          );

        if (chickenQtyBox) {
          chickenQtyBox.style.display =
            'none';
        } else {
          chickenQtyElement.style.display =
            'none';
        }
      }

      const plateQtyElement =
        node.querySelector(
          '[data-f="plate_qtys"]'
        );

      if (
        plateQtyElement
      ) {
        const plateQtyBox =
          plateQtyElement.closest(
            '.info-item, .order-section, .detail-row, .field-row, .product-box'
          );

        if (plateQtyBox) {
          plateQtyBox.style.display =
            'none';
        } else {
          plateQtyElement.style.display =
            'none';
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
        const cleanPhone =
          String(
            phoneValue || ''
          ).replace(
            /\D/g,
            ''
          );

        phone.textContent =
          phoneValue || '—';

        if (
          cleanPhone
        ) {
          phone.href =
            `tel:${cleanPhone}`;
          phone.hidden =
            false;
        } else {
          phone.removeAttribute(
            'href'
          );
        }
      }

      const location =
        node.querySelector(
          '[data-f="location_url"]'
        );

      const locationUrl =
        firstValue(
          order,
          [
            'location_url',
            'locationUrl',
            'location'
          ]
        );

      if (
        location &&
        locationUrl
      ) {
        location.href =
          String(
            locationUrl
          );

        location.hidden =
          false;
      } else if (location) {
        location.hidden =
          true;
      }

      const paymentCurrent =
        node.querySelector(
          '.payment-current'
        );

      if (
        paymentCurrent
      ) {
        paymentCurrent.textContent =
          paymentLabel(
            order.payment_method
          );
      }

      const paymentButtons =
        node.querySelectorAll(
          '[data-payment]'
        );

      paymentButtons.forEach(
        (button) => {
          const method =
            button.dataset.payment;

          button.classList.toggle(
            'active',
            normalizePayment(
              order.payment_method
            ) === method
          );

          button.disabled =
            delivered;

          button.addEventListener(
            'click',
            () =>
              changePayment(
                order,
                method,
                button
              )
          );
        }
      );

      const deliverButton =
        node.querySelector(
          '.btn-deliver'
        );

      if (
        deliverButton
      ) {
        deliverButton.disabled =
          delivered;

        deliverButton.classList.toggle(
          'done',
          delivered
        );

        deliverButton.addEventListener(
          'click',
          () =>
            deliverOrder(
              order,
              deliverButton
            )
        );
      }

      list.appendChild(node);
    }
  }

  async function apiFetch(
    url,
    options = {}
  ) {
    const config = {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Content-Type':
          'application/json'
      }
    };

    if (
      state.session?.access_token
    ) {
      config.headers.Authorization =
        `Bearer ${state.session.access_token}`;
    }

    let response =
      await fetch(
        url,
        config
      );

    if (
      response.status ===
      401
    ) {
      const refreshed =
        await refreshSession();

      if (refreshed) {
        if (
          state.session
            ?.access_token
        ) {
          config.headers.Authorization =
            `Bearer ${state.session.access_token}`;
        }

        response =
          await fetch(
            url,
            config
          );
      }
    }

    return response;
  }

  async function readJson(
    response
  ) {
    const text =
      await response.text();

    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return {
        message: text
      };
    }
  }

  async function refreshSession() {
    if (
      !state.session
        ?.refresh_token
    ) {
      return false;
    }

    try {
      const response =
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
                  state.session
                    .refresh_token
              })
          }
        );

      const data =
        await readJson(
          response
        );

      if (
        !response.ok ||
        !data?.session
      ) {
        clearSession();
        showLogin();
        return false;
      }

      state.session =
        normalizeSession(
          data.session
        );

      saveSession(
        state.session
      );

      return true;
    } catch {
      return false;
    }
  }

  async function login(
    email,
    password
  ) {
    setLoginMessage(
      'جارٍ تسجيل الدخول...'
    );

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
                email,
                password
              })
          }
        );

      const data =
        await readJson(
          response
        );

      if (!response.ok) {
        throw new Error(
          data?.message ||
          'بيانات الدخول غير صحيحة'
        );
      }

      if (
        !data?.session
      ) {
        throw new Error(
          'لم يتم إنشاء جلسة دخول'
        );
      }

      state.session =
        normalizeSession(
          data.session
        );

      state.sheet =
        data.sheet ||
        state.session.sheet ||
        '';

      state.session.sheet =
        state.sheet;

      saveSession(
        state.session
      );

      setLoginMessage(
        ''
      );

      showApp();

      await loadOrders();
    } catch (error) {
      setLoginMessage(
        error?.message ||
        'حدث خطأ أثناء تسجيل الدخول',
        'error'
      );
    }
  }

  async function loadOrders() {
    setAppMessage(
      'جارٍ تحميل الطلبات...'
    );

    try {
      const response =
        await apiFetch(
          '/api/orders'
        );

      const data =
        await readJson(
          response
        );

      if (!response.ok) {
        throw new Error(
          data?.message ||
          'تعذر تحميل الطلبات'
        );
      }

      const orders =
        Array.isArray(
          data?.orders
        )
          ? data.orders
          : Array.isArray(data)
            ? data
            : [];

      state.orders =
        orders
          .map(
            normalizeOrder
          )
          .filter(Boolean);

      state.sheet =
        data.sheet ||
        state.sheet ||
        '';

      render();

      setAppMessage(
        ''
      );
    } catch (error) {
      setAppMessage(
        error?.message ||
        'تعذر تحميل الطلبات',
        'error'
      );
    }
  }

  async function changePayment(
    order,
    method,
    button
  ) {
    if (
      !order ||
      isDelivered(
        order.delivery_status
      )
    ) {
      return;
    }

    if (button) {
      button.disabled =
        true;
    }

    try {
      const response =
        await apiFetch(
          '/api/payment',
          {
            method: 'POST',
            body:
              JSON.stringify({
                order_id:
                  order.id,
                payment_method:
                  method
              })
          }
        );

      const data =
        await readJson(
          response
        );

      if (!response.ok) {
        throw new Error(
          data?.message ||
          'تعذر تحديث طريقة الدفع'
        );
      }

      order.payment_method =
        method;

      render();
    } catch (error) {
      setAppMessage(
        error?.message ||
        'تعذر تحديث طريقة الدفع',
        'error'
      );

      if (button) {
        button.disabled =
          false;
      }
    }
  }

  async function deliverOrder(
    order,
    button
  ) {
    if (
      !order ||
      isDelivered(
        order.delivery_status
      )
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        'هل أنت متأكد أن الطلب تم تسليمه؟'
      );

    if (!confirmed) {
      return;
    }

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'جارٍ...';
    }

    try {
      const response =
        await apiFetch(
          '/api/deliver',
          {
            method: 'POST',
            body:
              JSON.stringify({
                order_id:
                  order.id
              })
          }
        );

      const data =
        await readJson(
          response
        );

      if (!response.ok) {
        throw new Error(
          data?.message ||
          'تعذر تسجيل التسليم'
        );
      }

      order.delivery_status =
        'delivered';

      render();

      setAppMessage(
        'تم تسجيل التسليم بنجاح',
        'success'
      );
    } catch (error) {
      setAppMessage(
        error?.message ||
        'تعذر تسجيل التسليم',
        'error'
      );

      if (button) {
        button.disabled =
          false;

        button.textContent =
          '✓ تم التسليم';
      }
    }
  }

  function setupFilters() {
    document
      .querySelectorAll(
        '[data-filter]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              state.filter =
                button.dataset.filter ||
                'pending';

              document
                .querySelectorAll(
                  '[data-filter]'
                )
                .forEach(
                  (item) => {
                    item.classList.toggle(
                      'active',
                      item === button
                    );
                  }
                );

              render();
            }
          );
        }
      );
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

        const email =
          $('login-email')
            ?.value
            ?.trim() ||
          '';

        const password =
          $('login-password')
            ?.value ||
          '';

        if (
          !email ||
          !password
        ) {
          setLoginMessage(
            'اكتب اسم المستخدم وكلمة المرور',
            'error'
          );

          return;
        }

        await login(
          email,
          password
        );
      }
    );
  }

  function setupLogout() {
    const button =
      $('logout-btn');

    if (!button) {
      return;
    }

    button.addEventListener(
      'click',
      () => {
        clearSession();
        showLogin();
      }
    );
  }

  function setupRefresh() {
    const button =
      $('refresh-btn');

    if (!button) {
      return;
    }

    button.addEventListener(
      'click',
      () =>
        loadOrders()
    );
  }

  async function bootDriver() {
    setupLogin();
    setupLogout();
    setupRefresh();
    setupFilters();

    state.session =
      loadSession();

    if (
      state.session
        ?.access_token
    ) {
      showApp();

      const refreshed =
        await refreshSession();

      if (!refreshed) {
        showLogin();
        return;
      }

      await loadOrders();

      return;
    }

    showLogin();
  }

  function masterEscape(
    value
  ) {
    return escapeHtml(
      value
    );
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
      !Number.isFinite(
        number
      )
    ) {
      return '—';
    }

    return `${number} درهم`;
  }

  function masterDate(
    value
  ) {
    return formatDate(
      value
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

  function masterDriver(
    order
  ) {
    return firstValue(
      order,
      [
        'driver',
        'mandoub',
        'driver_name',
        'sheet'
      ]
    ) || '—';
  }

  function masterPaymentText(
    value
  ) {
    return paymentLabel(
      value
    );
  }

  function masterStatusText(
    value
  ) {
    return statusLabel(
      value
    );
  }

  function saveMasterSession(
    session
  ) {
    if (!session) {
      localStorage.removeItem(
        'master_session'
      );

      return;
    }

    localStorage.setItem(
      'master_session',
      JSON.stringify(
        session
      )
    );
  }

  function loadStoredMasterSession() {
    try {
      const raw =
        localStorage.getItem(
          'master_session'
        );

      if (!raw) {
        return null;
      }

      return JSON.parse(
        raw
      );
    } catch {
      return null;
    }
  }

  function normalizeMasterSession(
    session
  ) {
    if (!session) {
      return null;
    }

    return {
      access_token:
        session.access_token ||
        '',
      refresh_token:
        session.refresh_token ||
        '',
      user:
        session.user ||
        null
    };
  }

  async function masterFetch(
    url,
    options = {}
  ) {
    const config = {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Content-Type':
          'application/json'
      }
    };

    const session =
      loadStoredMasterSession();

    if (
      session?.access_token
    ) {
      config.headers.Authorization =
        `Bearer ${session.access_token}`;
    }

    let response =
      await fetch(
        url,
        config
      );

    if (
      response.status ===
      401
    ) {
      const refreshToken =
        session?.refresh_token;

      if (
        refreshToken
      ) {
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
                    refreshToken
                })
            }
          );

        const refreshData =
          await readJson(
            refreshResponse
          );

        if (
          refreshResponse.ok &&
          refreshData?.session
        ) {
          const newSession =
            normalizeMasterSession(
              refreshData.session
            );

          saveMasterSession(
            newSession
          );

          config.headers.Authorization =
            `Bearer ${newSession.access_token}`;

          response =
            await fetch(
              url,
              config
            );
        }
      }
    }

    return response;
  }

  function showMasterDashboard() {
    const login =
      $('master-login-screen');

    const dashboard =
      $('master-dashboard');

    if (login) {
      login.hidden =
        true;
    }

    if (dashboard) {
      dashboard.hidden =
        false;
    }
  }

  function showMasterLogin() {
    const login =
      $('master-login-screen');

    const dashboard =
      $('master-dashboard');

    if (login) {
      login.hidden =
        false;
    }

    if (dashboard) {
      dashboard.hidden =
        true;
    }
  }

  function setupMasterEvents() {
    const form =
      $('master-login-form');

    if (form) {
      form.addEventListener(
        'submit',
        async (event) => {
          event.preventDefault();

          const username =
            $('master-username')
              ?.value
              ?.trim() ||
            '';

          const password =
            $('master-password')
              ?.value ||
            '';

          const message =
            $('master-login-message');

          if (
            message
          ) {
            message.textContent =
              'جارٍ تسجيل الدخول...';
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
                      username,
                      password
                    })
                }
              );

            const data =
              await readJson(
                response
              );

            if (
              !response.ok
            ) {
              throw new Error(
                data?.message ||
                'بيانات الدخول غير صحيحة'
              );
            }

            const session =
              normalizeMasterSession(
                data.session
              );

            saveMasterSession(
              session
            );

            showMasterDashboard();

            await loadMasterOrders();
          } catch (error) {
            if (message) {
              message.textContent =
                error?.message ||
                'حدث خطأ';
            }
          }
        }
      );
    }

    $('master-logout')
      ?.addEventListener(
        'click',
        () => {
          localStorage.removeItem(
            'master_session'
          );

          showMasterLogin();
        }
      );

    $('master-refresh')
      ?.addEventListener(
        'click',
        () =>
          loadMasterOrders()
      );

    document
      .querySelectorAll(
        '[data-master-filter]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              document
                .querySelectorAll(
                  '[data-master-filter]'
                )
                .forEach(
                  (item) =>
                    item.classList.toggle(
                      'active',
                      item === button
                    )
                );

              loadMasterOrders();
            }
          );
        }
      );
  }

  async function loadMasterOrders() {
    const container =
      $('master-orders');

    if (!container) {
      return;
    }

    container.innerHTML =
      '<div class="master-loading">جارٍ تحميل الطلبات...</div>';

    try {
      const response =
        await masterFetch(
          '/api/master/orders'
        );

      const data =
        await readJson(
          response
        );

      if (!response.ok) {
        throw new Error(
          data?.message ||
          'تعذر تحميل الطلبات'
        );
      }

      const orders =
        Array.isArray(
          data?.orders
        )
          ? data.orders
          : Array.isArray(data)
            ? data
            : [];

      renderMasterStats(
        orders
      );

      renderMasterOrders(
        orders
      );
    } catch (error) {
      container.innerHTML =
        `<div class="master-error">${masterEscape(
          error?.message ||
          'تعذر تحميل الطلبات'
        )}</div>`;
    }
  }

  function getMasterFilteredOrders(
    orders
  ) {
    const button =
      document.querySelector(
        '[data-master-filter].active'
      );

    const filter =
      button?.dataset
        ?.masterFilter ||
      'all';

    if (
      filter === 'pending'
    ) {
      return orders.filter(
        (order) =>
          !isDelivered(
            order.delivery_status
          )
      );
    }

    if (
      filter === 'done'
    ) {
      return orders.filter(
        (order) =>
          isDelivered(
            order.delivery_status
          )
      );
    }

    return orders;
  }

  function renderMasterStats(
    orders
  ) {
    const all =
      orders.length;

    const pending =
      orders.filter(
        (order) =>
          !isDelivered(
            order.delivery_status
          )
      ).length;

    const done =
      orders.filter(
        (order) =>
          isDelivered(
            order.delivery_status
          )
      ).length;

    const total =
      orders.reduce(
        (sum, order) => {
          const value =
            Number(
              String(
                firstValue(
                  order,
                  [
                    'total',
                    'grand_total',
                    'grandTotal',
                    'amount'
                  ]
                ) || 0
              ).replace(
                /[^\d.-]/g,
                ''
              )
            );

          return (
            sum +
            (
              Number.isFinite(
                value
              )
                ? value
                : 0
            )
          );
        },
        0
      );

    const allElement =
      $('master-stat-all');

    const pendingElement =
      $('master-stat-pending');

    const doneElement =
      $('master-stat-done');

    const totalElement =
      $('master-stat-total');

    if (
      allElement
    ) {
      allElement.textContent =
        all;
    }

    if (
      pendingElement
    ) {
      pendingElement.textContent =
        pending;
    }

    if (
      doneElement
    ) {
      doneElement.textContent =
        done;
    }

    if (
      totalElement
    ) {
      totalElement.textContent =
        masterMoney(
          total
        );
    }
  }

  function renderMasterOrders(
    orders
  ) {
    const container =
      $('master-orders');

    if (!container) {
      return;
    }

    const shown =
      getMasterFilteredOrders(
        orders
      );

    if (!shown.length) {
      container.innerHTML =
        '<div class="master-empty">لا توجد طلبات</div>';

      return;
    }

    container.innerHTML =
      shown
        .map(
          (order) => {
            const delivered =
              isDelivered(
                order.delivery_status
              );

            const number =
              firstValue(
                order,
                [
                  'order_number',
                  'invoice_no',
                  'invoice_number',
                  'id'
                ]
              ) || '—';

            const customer =
              firstValue(
                order,
                [
                  'customer_name',
                  'customerName',
                  'name'
                ]
              ) || '—';

            const phone =
              firstValue(
                order,
                [
                  'phone',
                  'customer_phone',
                  'customerPhone'
                ]
              ) || '—';

            const area =
              [
                firstValue(
                  order,
                  [
                    'emirate',
                    'emirate_name'
                  ]
                ),
                firstValue(
                  order,
                  [
                    'area',
                    'area_name'
                  ]
                )
              ]
                .filter(Boolean)
                .join(
                  ' - '
                ) || '—';

            const total =
              masterMoney(
                firstValue(
                  order,
                  [
                    'total',
                    'grand_total',
                    'grandTotal',
                    'amount'
                  ]
                )
              );

            return `
              <div
                class="master-order-card"
                data-order-id="${masterEscape(
                  order.id
                )}"
              >
                <div class="master-order-head">
                  <strong>
                    ${masterEscape(
                      number
                    )}
                  </strong>

                  <span class="${
                    delivered
                      ? 'status-done'
                      : 'status-pending'
                  }">
                    ${masterEscape(
                      masterStatusText(
                        order.delivery_status
                      )
                    )}
                  </span>
                </div>

                <div class="master-order-info">
                  <div>
                    <span>العميل</span>
                    <strong>
                      ${masterEscape(
                        customer
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>الهاتف</span>
                    <strong>
                      ${masterEscape(
                        phone
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>المنطقة</span>
                    <strong>
                      ${masterEscape(
                        area
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>المندوب</span>
                    <strong>
                      ${masterEscape(
                        masterDriver(
                          order
                        )
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>الإجمالي</span>
                    <strong>
                      ${masterEscape(
                        total
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>الدفع</span>
                    <strong>
                      ${masterEscape(
                        masterPaymentText(
                          order.payment_method
                        )
                      )}
                    </strong>
                  </div>
                </div>

                <div class="master-order-actions">
                  <button
                    type="button"
                    class="master-btn primary"
                    data-master-open
                  >
                    👁️ التفاصيل
                  </button>

                  <button
                    type="button"
                    class="master-btn secondary"
                    data-master-edit
                  >
                    ✏️ تعديل
                  </button>

                  <button
                    type="button"
                    class="master-btn danger"
                    data-master-delete
                  >
                    🗑️ حذف
                  </button>
                </div>
              </div>
            `;
          }
        )
        .join('');

    container
      .querySelectorAll(
        '[data-master-open]'
      )
      .forEach(
        (button, index) => {
          button.addEventListener(
            'click',
            () =>
              openMasterOrder(
                shown[index]
              )
          );
        }
      );

    container
      .querySelectorAll(
        '[data-master-edit]'
      )
      .forEach(
        (button, index) => {
          button.addEventListener(
            'click',
            () =>
              openMasterEdit(
                shown[index]
              )
          );
        }
      );

    container
      .querySelectorAll(
        '[data-master-delete]'
      )
      .forEach(
        (button, index) => {
          button.addEventListener(
            'click',
            () =>
              deleteMasterOrder(
                shown[index]
              )
          );
        }
      );
  }
    function openMasterOrder(
    order
  ) {
    const modal =
      $('master-modal');

    const body =
      $('master-modal-body');

    if (
      !modal ||
      !body
    ) {
      return;
    }

    const number =
      firstValue(
        order,
        [
          'order_number',
          'invoice_no',
          'invoice_number',
          'id'
        ]
      ) || '—';

    const customer =
      firstValue(
        order,
        [
          'customer_name',
          'customerName',
          'name'
        ]
      ) || '—';

    const phone =
      firstValue(
        order,
        [
          'phone',
          'customer_phone',
          'customerPhone'
        ]
      ) || '—';

    const emirate =
      firstValue(
        order,
        [
          'emirate',
          'emirate_name',
          'emirateName'
        ]
      ) || '—';

    const area =
      firstValue(
        order,
        [
          'area',
          'area_name',
          'areaName'
        ]
      ) || '—';

    const chickenWeights =
      firstValue(
        order,
        [
          'chicken_weights',
          'chickenWeights'
        ]
      ) || '';

    const chickenQtys =
      firstValue(
        order,
        [
          'chicken_qtys',
          'chickenQtys'
        ]
      ) || '';

    const plateNames =
      firstValue(
        order,
        [
          'plate_names',
          'plateNames'
        ]
      ) || '';

    const plateQtys =
      firstValue(
        order,
        [
          'plate_qtys',
          'plateQtys'
        ]
      ) || '';

    const coordinator =
      firstValue(
        order,
        [
          'appointment_coordinator',
          'appointmentCoordinator',
          'coordinator'
        ]
      ) || '—';

    const note =
      firstValue(
        order,
        [
          'note',
          'notes',
          'remarks'
        ]
      ) || '—';

    const details =
      firstValue(
        order,
        [
          'order_details',
          'orderDetails',
          'details'
        ]
      ) || '—';

    const total =
      masterMoney(
        firstValue(
          order,
          [
            'total',
            'grand_total',
            'grandTotal',
            'amount'
          ]
        )
      );

    const location =
      firstValue(
        order,
        [
          'location_url',
          'locationUrl',
          'location'
        ]
      );

    body.innerHTML = `
      <div class="master-detail-grid">

        <div>
          <span>رقم الفاتورة</span>
          <strong>${masterEscape(
            number
          )}</strong>
        </div>

        <div>
          <span>العميل</span>
          <strong>${masterEscape(
            customer
          )}</strong>
        </div>

        <div>
          <span>الهاتف</span>
          <strong>${masterEscape(
            phone
          )}</strong>
        </div>

        <div>
          <span>الإمارة</span>
          <strong>${masterEscape(
            emirate
          )}</strong>
        </div>

        <div>
          <span>المنطقة</span>
          <strong>${masterEscape(
            area
          )}</strong>
        </div>

        <div>
          <span>المندوب</span>
          <strong>${masterEscape(
            masterDriver(
              order
            )
          )}</strong>
        </div>

        <div>
          <span>الإجمالي</span>
          <strong>${masterEscape(
            total
          )}</strong>
        </div>

        <div>
          <span>طريقة الدفع</span>
          <strong>${masterEscape(
            masterPaymentText(
              order.payment_method
            )
          )}</strong>
        </div>

        <div>
          <span>حالة التسليم</span>
          <strong>${masterEscape(
            masterStatusText(
              order.delivery_status
            )
          )}</strong>
        </div>

        <div>
          <span>التاريخ</span>
          <strong>${masterEscape(
            masterDate(
              order.created_at ||
              order.createdAt ||
              order.inserted_at
            )
          )}</strong>
        </div>

      </div>

      <div class="master-detail-section">
        <h3>🍗 الدجاج الكامل</h3>

        <div class="master-detail-value">
          ${masterEscape(
            formatChickenLines(
              chickenWeights,
              chickenQtys
            )
          ).replace(
            /\n/g,
            '<br>'
          )}
        </div>
      </div>

      <div class="master-detail-section">
        <h3>🍽️ المقطعات</h3>

        <div class="master-detail-value">
          ${masterEscape(
            formatPlateLines(
              plateNames,
              plateQtys
            )
          ).replace(
            /\n/g,
            '<br>'
          )}
        </div>
      </div>

      <div class="master-detail-section">
        <h3>📅 منسق الموعد</h3>

        <div class="master-detail-value">
          ${masterEscape(
            coordinator
          )}
        </div>
      </div>

      <div class="master-detail-section">
        <h3>📦 تفاصيل الطلب</h3>

        <div class="master-detail-value">
          ${masterEscape(
            details
          )}
        </div>
      </div>

      <div class="master-detail-section">
        <h3>💬 الملاحظات</h3>

        <div class="master-detail-value">
          ${masterEscape(
            note
          )}
        </div>
      </div>

      ${
        location
          ? `
            <div class="master-detail-section">
              <a
                class="master-location-link"
                href="${masterEscape(
                  location
                )}"
                target="_blank"
                rel="noopener noreferrer"
              >
                📍 فتح موقع العميل
              </a>
            </div>
          `
          : ''
      }

      <div class="master-actions-row">
        <button
          type="button"
          class="master-btn secondary"
          id="master-detail-close"
        >
          رجوع
        </button>
      </div>
    `;

    modal.hidden =
      false;

    $('master-detail-close')
      ?.addEventListener(
        'click',
        closeMasterModal
      );
  }

  function openMasterEdit(
    order
  ) {
    const modal =
      $('master-modal');

    const body =
      $('master-modal-body');

    if (
      !modal ||
      !body
    ) {
      return;
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
            أوزان الدجاج
            <textarea
              id="master-edit-chicken-weights"
            >${masterEscape(
              order.chicken_weights ||
              ''
            )}</textarea>
          </label>

          <label>
            كميات الدجاج
            <textarea
              id="master-edit-chicken-qtys"
            >${masterEscape(
              order.chicken_qtys ||
              ''
            )}</textarea>
          </label>

          <label>
            أصناف المقطعات
            <textarea
              id="master-edit-plate-names"
            >${masterEscape(
              order.plate_names ||
              ''
            )}</textarea>
          </label>

          <label>
            كميات المقطعات
            <textarea
              id="master-edit-plate-qtys"
            >${masterEscape(
              order.plate_qtys ||
              ''
            )}</textarea>
          </label>

          <label>
            الإجمالي
            <input
              id="master-edit-total"
              type="text"
              value="${masterEscape(
                order.total ||
                order.grand_total ||
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
                لم يتم التحديد
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
                order.location_url ||
                ''
              )}"
            >
          </label>
        </div>

        <div class="master-edit-full">
          <label>
            تفاصيل الطلب
            <textarea
              id="master-edit-details"
            >${masterEscape(
              order.order_details ||
              ''
            )}</textarea>
          </label>
        </div>

        <div class="master-edit-full">
          <label>
            الملاحظات
            <textarea
              id="master-edit-note"
            >${masterEscape(
              order.note ||
              ''
            )}</textarea>
          </label>
        </div>

        <div class="master-actions-row">

          <button
            class="master-btn primary"
            id="master-save-edit"
            type="button"
          >
            💾 حفظ التعديل
          </button>

          <button
            class="master-btn secondary"
            id="master-cancel-edit"
            type="button"
          >
            رجوع
          </button>

        </div>

      </div>
    `;

    modal.hidden =
      false;

    $('master-save-edit')
      ?.addEventListener(
        'click',
        () =>
          saveMasterOrder(
            order
          )
      );

    $('master-cancel-edit')
      ?.addEventListener(
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
      button.disabled =
        true;

      button.textContent =
        'جارٍ الحفظ…';
    }

    const updatedOrder = {
      customer_name:
        $('master-edit-customer')
          ?.value ||
        '',

      phone:
        $('master-edit-phone')
          ?.value ||
        '',

      emirate:
        $('master-edit-emirate')
          ?.value ||
        '',

      area:
        $('master-edit-area')
          ?.value ||
        '',

      chicken_weights:
        $('master-edit-chicken-weights')
          ?.value ||
        '',

      chicken_qtys:
        $('master-edit-chicken-qtys')
          ?.value ||
        '',

      plate_names:
        $('master-edit-plate-names')
          ?.value ||
        '',

      plate_qtys:
        $('master-edit-plate-qtys')
          ?.value ||
        '',

      total:
        $('master-edit-total')
          ?.value ||
        '',

      appointment_coordinator:
        $('master-edit-coordinator')
          ?.value ||
        '',

      location_url:
        $('master-edit-location')
          ?.value ||
        '',

      order_details:
        $('master-edit-details')
          ?.value ||
        '',

      note:
        $('master-edit-note')
          ?.value ||
        '',

      payment_method:
        $('master-edit-payment')
          ?.value ||
        '',

      delivery_status:
        $('master-edit-status')
          ?.value ||
        'pending'
    };

    try {
      const response =
        await masterFetch(
          '/api/master/order/update',
          {
            method: 'POST',
            body:
              JSON.stringify({
                order_id:
                  order.id,
                ...updatedOrder
              })
          }
        );

      const data =
        await readJson(
          response
        );

      if (!response.ok) {
        throw new Error(
          data?.message ||
          'تعذر حفظ التعديل'
        );
      }

      closeMasterModal();

      await loadMasterOrders();
    } catch (error) {
      alert(
        error?.message ||
        'تعذر حفظ التعديل'
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
      firstValue(
        order,
        [
          'order_number',
          'invoice_no',
          'invoice_number',
          'id'
        ]
      ) || '';

    const confirmed =
      window.confirm(
        `هل أنت متأكد من حذف الطلب ${number}؟`
      );

    if (!confirmed) {
      return;
    }

    try {
      const response =
        await masterFetch(
          '/api/master/order/delete',
          {
            method: 'POST',
            body:
              JSON.stringify({
                order_id:
                  order.id
              })
          }
        );

      const data =
        await readJson(
          response
        );

      if (!response.ok) {
        throw new Error(
          data?.message ||
          'تعذر حذف الطلب'
        );
      }

      await loadMasterOrders();
    } catch (error) {
      alert(
        error?.message ||
        'تعذر حذف الطلب'
      );
    }
  }

  function closeMasterModal() {
    const modal =
      $('master-modal');

    if (modal) {
      modal.hidden =
        true;
    }
  }

  function masterLogout() {
    localStorage.removeItem(
      'master_session'
    );

    showMasterLogin();
  }

  function setupMasterClose() {
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
            event.target ===
            event.currentTarget
          ) {
            closeMasterModal();
          }
        }
      );
  }

  async function bootMaster() {
    const session =
      loadStoredMasterSession();

    if (
      session?.access_token
    ) {
      showMasterDashboard();

      try {
        await loadMasterOrders();
      } catch {
        showMasterLogin();
      }

      return;
    }

    showMasterLogin();
  }

  function detectPage() {
    const hasMaster =
      Boolean(
        $('master-dashboard') ||
        $('master-login-screen')
      );

    if (hasMaster) {
      return 'master';
    }

    return 'driver';
  }

  async function boot() {
    setupMasterEvents();
    setupMasterClose();

    if (
      detectPage() ===
      'master'
    ) {
      await bootMaster();
      return;
    }

    await bootDriver();
  }

  window.addEventListener(
    'beforeunload',
    () => {
      /*
       * لا نغيّر الجلسة هنا.
       */
    }
  );

  boot();
})();
/* 
 * هذا الجزء متصل مباشرة بالجزء السابق.
 * لا تحذف أي سطر ولا تضيف علامات حوله.
 */

(function () {
  /*
   * Compatibility helpers
   */
  if (
    typeof window ===
    'undefined'
  ) {
    return;
  }

  const legacy =
    window.__FROOG_ALZEIN_LEGACY__;

  if (
    legacy &&
    typeof legacy ===
      'object'
  ) {
    Object.keys(
      legacy
    ).forEach(
      (key) => {
        try {
          if (
            !(key in window)
          ) {
            window[key] =
              legacy[key];
          }
        } catch {
          /* ignore */
        }
      }
    );
  }
})();

/*
 * ملاحظة:
 * التطبيق الأساسي يتم تشغيله من IIFE
 * الموجودة في أول الملف.
 *
 * أي أكواد إضافية قديمة يتم إبقاؤها
 * هنا بدون التأثير على واجهة الطلبات.
 */

(function () {
  'use strict';

  const root =
    document.documentElement;

  if (root) {
    root.setAttribute(
      'data-app-ready',
      'true'
    );
  }

  /*
   * معالجة النصوص متعددة الأسطر
   * بدون تغيير التصميم.
   */
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      document
        .querySelectorAll(
          '[data-f="chicken_weights"], [data-f="plate_names"]'
        )
        .forEach(
          (element) => {
            element.style.whiteSpace =
              'pre-line';
          }
        );
    }
  );
})();

/*
 * لا يتم هنا إنشاء أي كروت جديدة.
 * لا يتم تعديل الأحجام.
 * لا يتم تعديل الألوان.
 * لا يتم تعديل الخطوط.
 *
 * الغرض من استمرار هذا الجزء هو الحفاظ
 * على توافق الملف الكامل مع النسخة
 * المستخدمة في المشروع.
 */

(function () {
  'use strict';

  const observer =
    new MutationObserver(
      (mutations) => {
        for (
          const mutation of mutations
        ) {
          if (
            mutation.type !==
            'childList'
          ) {
            continue;
          }

          mutation.addedNodes.forEach(
            (node) => {
              if (
                !node ||
                node.nodeType !== 1
              ) {
                return;
              }

              const fields =
                node.matches?.(
                  '[data-f="chicken_weights"], [data-f="plate_names"]'
                )
                  ? [node]
                  : Array.from(
                      node.querySelectorAll?.(
                        '[data-f="chicken_weights"], [data-f="plate_names"]'
                      ) || []
                    );

              fields.forEach(
                (field) => {
                  field.style.whiteSpace =
                    'pre-line';
                }
              );
            }
          );
        }
      }
    );

  if (
    document.body
  ) {
    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }
})();

/*
 * حماية بسيطة من عرض نصوص HTML
 * داخل بيانات الطلب.
 */
(function () {
  'use strict';

  const safeText =
    (value) =>
      String(
        value ?? ''
      );

  window.__froogSafeText =
    safeText;
})();

/*
 * توافق مع بعض أسماء الحقول القديمة.
 */
(function () {
  'use strict';

  window.__froogFieldAliases = {
    chicken_weights: [
      'chicken_weights',
      'chickenWeights',
      'chicken_weight',
      'data_weights'
    ],

    chicken_qtys: [
      'chicken_qtys',
      'chickenQtys',
      'chicken_quantities',
      'chicken_quantities_text'
    ],

    plate_names: [
      'plate_names',
      'plateNames',
      'plates',
      'cut_names'
    ],

    plate_qtys: [
      'plate_qtys',
      'plateQtys',
      'plate_quantities',
      'cut_quantities'
    ]
  };
})();

/*
 * نهاية الجزء الثالث.
 *
 * لا يتم تغيير البيانات الموجودة في Supabase.
 * كل التعديل المطلوب يتم أثناء العرض فقط.
 */
/*
 * Final compatibility layer
 *
 * هذا الجزء لا يغيّر تصميم الصفحة.
 * ولا يغيّر بيانات قاعدة البيانات.
 */

(function () {
  'use strict';

  function normalizeArabicDigits(
    value
  ) {
    return String(
      value ?? ''
    ).replace(
      /[٠-٩]/g,
      (digit) =>
        String(
          '٠١٢٣٤٥٦٧٨٩'
            .indexOf(
              digit
            )
        )
    );
  }

  function normalizeGiftText(
    value
  ) {
    return normalizeArabicDigits(
      value
    )
      .replace(
        /هديّه|هديـة|هديه/g,
        'هدية'
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  }

  window.__froogNormalizeArabicDigits =
    normalizeArabicDigits;

  window.__froogNormalizeGiftText =
    normalizeGiftText;
})();

/*
 * عند وجود بيانات قديمة في الكارت،
 * نحافظ على النص كما هو ولا نضيف
 * صفوف كميات مستقلة.
 */
(function () {
  'use strict';

  function fixProductFields() {
    document
      .querySelectorAll(
        '[data-f="chicken_weights"], [data-f="plate_names"]'
      )
      .forEach(
        (element) => {
          element.style.whiteSpace =
            'pre-line';

          /*
           * لا نضع display جديد
           * ولا width جديد
           * ولا grid جديد.
           */
        }
      );
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      fixProductFields
    );
  } else {
    fixProductFields();
  }
})();

/*
 * منع أي كود توافق قديم من إظهار
 * حقول كمية منفصلة لو كانت موجودة
 * في نسخة HTML قديمة.
 */
(function () {
  'use strict';

  function hideLegacyQuantityFields(
    root
  ) {
    if (!root) {
      return;
    }

    root
      .querySelectorAll(
        '[data-f="chicken_qtys"], [data-f="plate_qtys"]'
      )
      .forEach(
        (element) => {
          const box =
            element.closest(
              '.product-box'
            );

          if (box) {
            box.style.display =
              'none';
          } else {
            element.style.display =
              'none';
          }
        }
      );
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      () =>
        hideLegacyQuantityFields(
          document
        )
    );
  } else {
    hideLegacyQuantityFields(
      document
    );
  }
})();

/*
 * مهم:
 * الملف ينتهي هنا.
 * لا تضيف أي كود بعد هذا الجزء.
 */
