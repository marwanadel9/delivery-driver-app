/* ============================================================
   location-fix.js v3 — فتح موقع العميل + إظهار زر الموقع تلقائيًا
   يصلح كل أشكال الروابط، ويظهر الزرار على أي موبايل/أي WebView
   ============================================================ */
(function () {
  console.log('FALocFix v3 deployed');
  function fix(u) {
    if (!u) return '';
    u = String(u).trim();
    for (var i = 0; i < 4; i++) {
      try { var d = decodeURIComponent(u); if (d === u) break; u = d; } catch (e) { break; }
    }
    u = u.replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
    if (/^(Open Location|موقع العميل|لا يوجد|null|undefined|#|-|0|ززين)$/i.test(u)) return '';
    var m = u.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if (m) return 'https://www.google.com/maps/search/?api=1&query=' + m[1] + ',' + m[2];
    if (/^intent:\/\//i.test(u)) {
      var c = u.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || u.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (c) return 'https://www.google.com/maps/search/?api=1&query=' + c[1] + ',' + c[2];
      var f = u.match(/browser_fallback_url=([^;]+)/i);
      if (f) { try { return fix(decodeURIComponent(f[1])); } catch (e) {} }
      return fix(u.replace(/^intent:\/\//i, 'https://'));
    }
    if (/^geo:/i.test(u)) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(u.slice(4).split('?')[0]);
    if (!/^[a-z]+:/i.test(u)) u = 'https://' + u;
    if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(u)) return u;
    if (/google\.com\/maps/i.test(u) || /maps\.google\./i.test(u)) return u;
    return /^https?:\/\//i.test(u) ? u : '';
  }
  window.FAFixLocation = fix;

  function isLocLink(a) {
    var raw = a.getAttribute('data-location-url') || a.getAttribute('href') || '';
    return a.getAttribute('data-f') === 'location_url' || a.classList.contains('location-btn')
      || /maps|goo\.gl|google\.com\/maps|geo:|intent:|^\s*-?\d+\.\d+\s*,/i.test(raw);
  }

  /* ⭐ قلب المنطق: الزرار يظهر لما يكون فيه رابط صحيح — ويختفي لما مفيش */
  function applyOne(a) {
    if (!a || a.nodeType !== 1 || !isLocLink(a)) return;
    var raw = a.getAttribute('data-location-url') || a.getAttribute('href') || '';
    var ok = fix(raw);
    if (ok) {
      a.setAttribute('href', ok);
      a.setAttribute('data-location-url', ok);
      a.setAttribute('target', '_blank');
      a.removeAttribute('hidden');           /* يظهر على أي موبايل حتى لو app.js نسيه */
      a.style.display = '';
      a.style.visibility = 'visible';
      a.style.opacity = '1';
    } else {
      a.setAttribute('href', '#');
      a.setAttribute('data-location-url', '');
      a.setAttribute('hidden', '');
    }
  }

  function clean(root) {
    if (!root) return;
    if (root.nodeType === 1 && typeof root.matches === 'function' && root.matches('a[href]')) applyOne(root);
    if (!root.querySelectorAll) return;
    var links = root.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) applyOne(links[i]);
  }

  /* ⭐ كسر حظر الـ CSS بتاع البطاقة المختصرة على زرار الموقع بس */
  function injectCss() {
    if (document.getElementById('fa-locfix-css')) return;
    var st = document.createElement('style');
    st.id = 'fa-locfix-css';
    st.textContent = '.order-card.is-compact .location-btn{display:flex!important;pointer-events:auto!important;visibility:visible!important;opacity:1!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  injectCss();
  clean(document);

  /* ⭐ المراقب بيشوف childList + تغييرات href/data-location-url/hidden — عشان أي ترتيب تحميل يتصلح */
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'attributes') { applyOne(m.target); continue; }
      for (var j = 0; j < m.addedNodes.length; j++) clean(m.addedNodes[j]);
    }
  });
  mo.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['href', 'data-location-url', 'hidden']
  });

  /* ⭐ فحص دوري كل 3 ثوانٍ — يصلّح أي زرار اتخبى بسبب ترتيب التحميل أو كاش قديم */
  setInterval(function () {
    injectCss();
    var links = document.querySelectorAll('a[data-f="location_url"],a.location-btn');
    for (var i = 0; i < links.length; i++) applyOne(links[i]);
  }, 3000);
})();
