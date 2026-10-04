(() => {
  'use strict';

  const SESSION_KEY = 'driver_session';
  const $ = (id) => document.getElementById(id);
  const state = {
    session: null,
    orders: [],
    filter: 'pending',
    sheet: ''
  };

  const isDelivered = (s) => {
    const v = String(s ?? '').trim().toLowerCase();

    return (
      v === 'delivered' ||
      v.includes('تم التسليم') ||
      v === 'تم' ||
      v.includes('مسلم') ||
      v === 'done'
    );
  };

  const statusLabel = (s) =>
    s ? String(s) : 'قيد التوصيل';

  const fmtTotal = (t) => {
    const n = Number(t);

    return Number.isFinite(n) && String(t).trim() !== ''
      ? n.toLocaleString('ar-EG', {
          maximumFractionDigits: 2
        })
      : (t ?? '—');
  };

  const telHref = (p) =>
    'tel:' + String(p ?? '').replace(/[^\d+]/g, '');

  let toastTimer;

  const toast = (msg, isErr = false) => {
    const el = $('toast');

    if (!el) return;

    el.textContent = msg;
    el.classList.toggle('err', isErr);
    el.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3000);
  };

  const saveSession = (s) => {
    state.session = s;

    if (s) {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(s)
      );
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  };

  async function refreshSession() {
    if (!state.session?.refresh_token) {
      throw new Error('expired');
    }

    const res = await fetch('/api/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refresh_token: state.session.refresh_token
      })
    });

    if (!res.ok) {
      throw new Error('expired');
    }

    const data = await res.json();

    const username =
      state.session.username ||
      state.session.user?.username ||
      '';

    const email =
      state.session.email ||
      state.session.user?.email ||
      '';

    saveSession({
      ...data,
      username,
      email,
      user: {
        username,
        email
      }
    });
  }

  async function api(path, options = {}, retry = true) {
    if (
      state.session &&
      state.session.expires_at &&
      state.session.expires_at - 60 <
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
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (state.session?.access_token) {
      headers.Authorization =
        `Bearer ${state.session.access_token}`;
    }

    const res = await fetch(path, {
      ...options,
      headers
    });

    if (res.status === 401 && retry) {
      try {
        await refreshSession();
      } catch {
        logout(
          'انتهت الجلسة، يرجى تسجيل الدخول مجددًا'
        );
        throw new Error('expired');
      }

      return api(path, options, false);
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        data.error || 'حدث خطأ غير متوقع'
      );
    }

    return data;
  }

  function showLogin(message) {
    $('orders-view').hidden = true;
    $('login-view').hidden = false;

    const err = $('login-error');

    if (err) {
      err.hidden = !message;
      err.textContent = message || '';
    }
  }

  function showOrders() {
    $('login-view').hidden = true;
    $('orders-view').hidden = false;

    $('driver-name').textContent =
      state.session?.username ||
      state.session?.user?.username ||
      '';

    loadOrders();
  }

  async function loadOrders() {
    const list = $('orders-list');
    const btn = $('refresh-btn');

    if (!state.orders.length) {
      list.innerHTML =
        '<p class="loading">جارٍ تحميل الطلبات…</p>';
    }

    if (btn) {
      btn.classList.add('spin');
    }

    try {
      const data = await api('/api/orders');

      state.orders = Array.isArray(data.orders)
        ? data.orders
        : [];

      state.sheet = data.sheet || '';

      $('sheet-name').textContent =
        'القائمة: ' + state.sheet;

      render();
    } catch (e) {
      if (e.message !== 'expired') {
        list.innerHTML =
          `<p class="empty"><span class="big">⚠️</span>${e.message}</p>`;
      }
    } finally {
      if (btn) {
        btn.classList.remove('spin');
      }
    }
  }

  function render() {
    const list = $('orders-list');

    const done = state.orders.filter((o) =>
      isDelivered(o.delivery_status)
    );

    $('stat-done').textContent =
      done.length.toLocaleString('ar-EG');

    $('stat-pending').textContent =
      (state.orders.length - done.length)
        .toLocaleString('ar-EG');

    const shown = state.orders.filter((o) =>
      state.filter === 'all'
        ? true
        : state.filter === 'done'
          ? isDelivered(o.delivery_status)
          : !isDelivered(o.delivery_status)
    );

    list.replaceChildren();

    if (!shown.length) {
      list.innerHTML =
        `<p class="empty"><span class="big">📦</span>${
          state.filter === 'done'
            ? 'لا توجد طلبات مسلّمة بعد'
            : 'لا توجد طلبات حالياً'
        }</p>`;

      return;
    }

    const tpl = $('order-tpl');

    for (const o of shown) {
      const node =
        tpl.content.firstElementChild.cloneNode(true);

      const set = (f, v) => {
        const el =
          node.querySelector(`[data-f="${f}"]`);

        if (el) {
          el.textContent =
            v !== null &&
            v !== undefined &&
            String(v).trim() !== ''
              ? v
              : '—';
        }
      };

      set(
        'order_number',
        o.order_number ?? o.id
      );

      set(
        'customer_name',
        o.customer_name
      );

      set(
        'area',
        o.area
      );

      set(
        'order_details',
        o.order_details
      );

      set(
        'total',
        fmtTotal(o.total)
      );

      const phone =
        node.querySelector('[data-f="phone"]');

      if (phone) {
        if (o.phone) {
          phone.textContent = o.phone;
          phone.href = telHref(o.phone);
        } else {
          phone.replaceWith(
            document.createTextNode('—')
          );
        }
      }

      const location =
        node.querySelector(
          '[data-f="location_url"]'
        );

      if (location) {
        const locationUrl =
          String(o.location_url || '').trim();

        if (locationUrl) {
          location.href = locationUrl;
          location.target = '_blank';
          location.rel =
            'noopener noreferrer';
          location.textContent =
            '📍 فتح الموقع';
          location.hidden = false;
        } else {
          location.hidden = true;
        }
      }

      const appointment =
        node.querySelector(
          '[data-f="appointment_coordinator"]'
        );

      if (appointment) {
        appointment.textContent =
          o.appointment_coordinator ||
          '—';
      }

      const note =
        node.querySelector(
          '[data-f="note"]'
        );

      if (note) {
        note.textContent =
          o.note || '—';
      }

      const delivered =
        isDelivered(o.delivery_status);

      const status =
        node.querySelector(
          '[data-f="delivery_status"]'
        );

      if (status) {
        status.textContent =
          statusLabel(o.delivery_status);

        status.classList.toggle(
          'ok',
          delivered
        );
      }

      node.classList.toggle(
        'is-done',
        delivered
      );

      const btn =
        node.querySelector('.btn-deliver');

      if (btn) {
        if (delivered) {
          btn.remove();
        } else {
          btn.addEventListener(
            'click',
            () => markDelivered(o, btn)
          );
        }
      }

      list.appendChild(node);
    }
  }

  async function markDelivered(order, btn) {
    const name =
      order.customer_name || '';

    if (
      !confirm(
        `تأكيد تسليم الطلب #${
          order.order_number ?? order.id
        }${
          name
            ? ' للعميل ' + name
            : ''
        }؟`
      )
    ) {
      return;
    }

    btn.disabled = true;
    btn.textContent = 'جارٍ التحديث…';

    try {
      await api('/api/deliver', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id
        })
      });

      toast(
        'تم تسجيل التسليم بنجاح ✅'
      );

      await loadOrders();
    } catch (e) {
      if (e.message === 'expired') {
        return;
      }

      toast(e.message, true);

      btn.disabled = false;
      btn.textContent = 'تم التسليم';
    }
  }

  function logout(message) {
    saveSession(null);

    state.orders = [];
    state.sheet = '';

    $('orders-list').replaceChildren();

    showLogin(message);
  }

  $('login-form').addEventListener(
    'submit',
    async (e) => {
      e.preventDefault();

      const username =
        $('username').value
          .trim()
          .toLowerCase();

      const password =
        $('password').value;

      const err =
        $('login-error');

      if (!username || !password) {
        err.textContent =
          'يرجى إدخال اسم المستخدم وكلمة المرور';

        err.hidden = false;

        return;
      }

      const btn =
        $('login-btn');

      btn.disabled = true;
      btn.textContent =
        'جارٍ تسجيل الدخول…';

      err.hidden = true;

      try {
        const res =
          await fetch('/api/login', {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              username,
              password
            })
          });

        const data =
          await res.json()
            .catch(() => ({}));

        if (!res.ok) {
          throw new Error(
            data.error ||
            'تعذر تسجيل الدخول'
          );
        }

        const session = {
          ...data,
          username:
            data.username ||
            data.user?.username ||
            username,
          email:
            data.email ||
            data.user?.email ||
            '',
          user: {
            username:
              data.username ||
              data.user?.username ||
              username,
            email:
              data.email ||
              data.user?.email ||
              ''
          }
        };

        if (data.expires_in) {
          session.expires_at =
            Math.floor(
              Date.now() / 1000
            ) +
            Number(data.expires_in);
        }

        saveSession(session);

        $('password').value = '';

        showOrders();
      } catch (e2) {
        err.textContent =
          e2.message;

        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent =
          'تسجيل الدخول';
      }
    }
  );

  $('logout-btn').addEventListener(
    'click',
    () => logout()
  );

  $('refresh-btn').addEventListener(
    'click',
    loadOrders
  );

  document
    .querySelectorAll('.tab')
    .forEach((t) =>
      t.addEventListener(
        'click',
        () => {
          document
            .querySelectorAll('.tab')
            .forEach((x) =>
              x.classList.toggle(
                'active',
                x === t
              )
            );

          state.filter =
            t.dataset.filter;

          render();
        }
      )
    );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        !document.hidden &&
        state.session &&
        !$('orders-view').hidden
      ) {
        loadOrders();
      }
    }
  );

  try {
    state.session =
      JSON.parse(
        localStorage.getItem(
          SESSION_KEY
        )
      );
  } catch {
    state.session = null;
  }

  if (
    state.session?.access_token &&
    (
      state.session?.username ||
      state.session?.user?.username
    )
  ) {
    if (!state.session.username) {
      state.session.username =
        state.session.user.username;
    }

    if (!state.session.email) {
      state.session.email =
        state.session.user?.email || '';
    }

    showOrders();
  } else {
    showLogin();
  }
})();
