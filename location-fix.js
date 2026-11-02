/* ============================================================
   location-fix.js — فتح موقع العميل: يصلح كل أشكال الروابط تلقائيًا
   ============================================================ */
(function () {
  function fix(u) {
    if (!u) return '';
    u = String(u).trim();
    for (var i = 0; i < 4; i++) {
      try { var d = decodeURIComponent(u); if (d === u) break; u = d; } catch (e) { break; }
    }
    u = u.replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
    if (/^(Open Location|موقع العميل|لا يوجد|null|undefined|#|-|0)$/i.test(u)) return '';
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
  function clean(root) {
    var links = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var raw = a.getAttribute('data-location-url') || a.getAttribute('href') || '';
      var isLoc = a.getAttribute('data-f') === 'location_url' || a.classList.contains('location-btn')
        || /maps|goo\.gl|google\.com\/maps|geo:|intent:|^\s*-?\d+\.\d+\s*,/i.test(raw);
      if (!isLoc) continue;
      var ok = fix(raw);
      if (ok) { a.setAttribute('href', ok); a.setAttribute('data-location-url', ok); a.setAttribute('target', '_blank'); }
      else { a.setAttribute('href', '#'); a.setAttribute('data-location-url', ''); }
    }
  }
  clean(document);
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list[i].addedNodes.length; j++) clean(list[i].addedNodes[j]);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
