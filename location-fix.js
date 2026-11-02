/* ============================================================
   location-fix.js v4 — فتح موقع العميل + زرار يظهر على أي هاتف
   ============================================================ */
console.log('FALocFix v4.1 deployed');
/* FALocGuard v4 — زرار «فتح الموقع» يظهر على أي هاتف وأي إصدار:
   نستبدل <a> المخفي بـ <span> لا تمسه أي قاعدة CSS للإخفاء، ونتحكم في ظهاره بالرابط نفسه */
(function(){
  if (window.__faLocGuardV4) return; window.__faLocGuardV4 = true;
  console.log('FALocGuard v4 active');
  function fix(u){
    if(!u) return '';
    u=String(u).trim();
    for(var i=0;i<4;i++){try{var d=decodeURIComponent(u);if(d===u)break;u=d;}catch(e){break;}}
    u=u.replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
    if(/^(Open Location|موقع العميل|لا يوجد|null|undefined|#|-|0|ززين)$/i.test(u)) return '';
    var m=u.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if(m) return 'https://www.google.com/maps/search/?api=1&query='+m[1]+','+m[2];
    if(/^intent:\/\//i.test(u)){
      var c=u.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)||u.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if(c) return 'https://www.google.com/maps/search/?api=1&query='+c[1]+','+c[2];
      var f=u.match(/browser_fallback_url=([^;]+)/i);
      if(f){try{return fix(decodeURIComponent(f[1]));}catch(e){}}
      return fix(u.replace(/^intent:\/\//i,'https://'));
    }
    if(/^geo:/i.test(u)) return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(u.slice(4).split('?')[0]);
    if(!/^[a-z]+:/i.test(u)) u='https://'+u;
    if(/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(u)) return u;
    if(/google\.com\/maps/i.test(u)||/maps\.google\./i.test(u)) return u;
    return /^https?:\/\//i.test(u)?u:'';
  }
  window.FAFixLocation=fix;
  function manageSpan(s){
    var ok=fix(s.getAttribute('data-fa-url')||'');
    if(ok){
      s.removeAttribute('hidden');
      s.style.display='flex';s.style.visibility='visible';s.style.opacity='1';
    } else {
      s.setAttribute('hidden','');
    }
  }
  function makeSpan(a,url){
    var s=document.createElement('span');
    s.className='location-btn';
    s.innerHTML=a.innerHTML||'<span>📍</span><strong>فتح الموقع</strong>';
    s.style.cursor='pointer';
    s.style.userSelect='none';
    s.style.webkitUserSelect='none';
    s.setAttribute('data-fa-url',url);
    s.setAttribute('data-fa-loc','1');
    s.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      var u=fix(s.getAttribute('data-fa-url')||'');
      if(u) window.open(u,'_blank');
      else alert('رابط موقع العميل غير متوفر لهذه الفاتورة.');
    });
    manageSpan(s);
    return s;
  }
  function applyOne(el){
    if(!el||el.nodeType!==1||!el.getAttribute) return;
    if(el.getAttribute('data-fa-loc')==='1'){ manageSpan(el); return; }
    if(el.nodeName==='A'&&(el.getAttribute('data-f')==='location_url'||el.classList.contains('location-btn'))){
      var raw=el.getAttribute('data-location-url')||el.getAttribute('href')||'';
      var ok=fix(raw);
      if(ok&&el.parentNode){
        el.parentNode.replaceChild(makeSpan(el,ok),el);
      } else {
        el.setAttribute('href','#');
        el.setAttribute('data-location-url','');
        el.setAttribute('hidden','');
      }
    }
  }
  function clean(root){
    if(!root) return;
    if(root.nodeType===1&&root.matches&&root.matches('a[href],span[data-fa-loc]')) applyOne(root);
    if(!root.querySelectorAll) return;
    var L=root.querySelectorAll('a[href],span[data-fa-loc]');
    for(var i=0;i<L.length;i++) applyOne(L[i]);
  }
  function injectCss(){
    if(document.getElementById('fa-locfix-css-v4')) return;
    var st=document.createElement('style');
    st.id='fa-locfix-css-v4';
    st.textContent='.order-card.is-compact .order-actions{display:grid!important}.order-card.is-compact .location-btn{display:flex!important;pointer-events:auto!important;visibility:visible!important;opacity:1!important}';
    (document.head||document.documentElement).appendChild(st);
  }
  injectCss(); clean(document);
  var mo=new MutationObserver(function(list){
    for(var i=0;i<list.length;i++){
      var m=list[i];
      if(m.type==='attributes'){ if(m.target&&m.target.getAttribute) applyOne(m.target); continue; }
      for(var j=0;j<m.addedNodes.length;j++) clean(m.addedNodes[j]);
    }
  });
  mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href','data-location-url','hidden','data-fa-url']});
  setInterval(function(){
    injectCss();
    var L=document.querySelectorAll('a[data-f="location_url"],a.location-btn,span[data-fa-loc]');
    for(var i=0;i<L.length;i++) applyOne(L[i]);
  },3000);
})();
