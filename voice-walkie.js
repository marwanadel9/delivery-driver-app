/* ============================================================
   FAVoice — ووكي توكي عبر Supabase Realtime Broadcast
   يعمل على: متصفح الكمبيوتر + WebView الـ APK + Electron
   الاستخدام:
     FAVoice.init({url:'https://xxxx.supabase.co', key:'anon_key',
                   room:'fa-dispatch-voice', name:'زين', id:'Mandoub'});
   ============================================================ */
(function () {
  var V = window.FAVoice = {
    cfg: null, sb: null, ch: null, rec: null, stream: null,
    seq: 0, q: [], playing: false, peers: {}, timer: null, talking: false,

    init: function (cfg) {
      this.cfg = cfg || {};
      this._ui();
      var self = this;
      if (!window.supabase || !cfg.key || cfg.key.indexOf('YOUR') === 0) {
        this._status('⚠️ أكمل إعداد الصوت (المفتاح)');
        return;
      }
      try {
        this.sb = window.supabase.createClient(cfg.url, cfg.key);
        this.ch = this.sb.channel(cfg.room, { config: { broadcast: { ack: false } } });
        this.ch.on('broadcast', { event: 'ptt' }, function (m) { self._chunk(m.payload || {}); });
        this.ch.on('broadcast', { event: 'ptt-hi' }, function (m) { self._hi(m.payload || {}); });
        this.ch.subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            self._status('🎙️ القناة جاهزة');
            self._hi({ from: cfg.id, name: cfg.name }, true);
            self.timer = setInterval(function () {
              self._hi({ from: cfg.id, name: cfg.name }, true);
            }, 12000);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            self._status('⚠️ تعذر الاتصال — بيحاول تاني...');
            setTimeout(function () { self.init(self.cfg); }, 4000);
          }
        });
      } catch (e) { this._status('⚠️ ' + e.message); }
    },

    /* ---------- الإرسال: ضاغط تتكلم ---------- */
    start: function () {
      if (this.talking || this.rec) return;
      var self = this;
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      }).then(function (st) {
        self.stream = st;
        var mime = 'audio/webm;codecs=opus';
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';
        if (window.MediaRecorder && !MediaRecorder.isTypeSupported(mime)) mime = '';
        try { self.rec = new MediaRecorder(st, mime ? { mimeType: mime } : undefined); }
        catch (e) { self.rec = new MediaRecorder(st); }
        self.rec.ondataavailable = function (ev) {
          if (ev.data && ev.data.size > 0 && self.ch) {
            var r = new FileReader();
            r.onload = function () {
              var b64 = String(r.result).split(',')[1] || '';
              self.ch && self.ch.send({
                type: 'broadcast', event: 'ptt',
                payload: { d: b64, mime: self.rec.mimeType || 'audio/webm', from: self.cfg.id, name: self.cfg.name, seq: self.seq++ }
              });
            };
            r.readAsDataURL(ev.data);
          }
        };
        self.rec.start(200); /* قطعة كل 200ms = وصول فوري */
        self.talking = true;
        self._btnState(true);
      }).catch(function (e) { self._status('⚠️ المايك: ' + (e.message || 'مرفوض')); });
    },

    stop: function () {
      this.talking = false;
      this._btnState(false);
      try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch (e) {}
      this.rec = null;
      if (this.stream) { this.stream.getTracks().forEach(function (t) { t.stop(); }); this.stream = null; }
    },

    /* ---------- الاستقبال ---------- */
    _chunk: function (p) {
      if (!p || !p.d || p.from === this.cfg.id) return;
      this._speaker(p.name);
      try {
        var bin = atob(p.d), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        this.q.push(new Blob([arr], { type: p.mime || 'audio/webm' }));
        this._play();
      } catch (e) {}
    },

    _play: function () {
      if (this.playing || !this.q.length) return;
      this.playing = true;
      var self = this;
      var url = URL.createObjectURL(this.q.shift());
      var a = new Audio(url);
      a.onended = function () { URL.revokeObjectURL(url); self.playing = false; self._play(); };
      a.onerror = function () { URL.revokeObjectURL(url); self.playing = false; self._play(); };
      a.play().catch(function () { self.playing = false; self._play(); });
    },

    _hi: function (p, quiet) {
      if (!p || !p.from || p.from === this.cfg.id) return;
      this.peers[p.from] = p.name || p.from;
      if (!quiet) this._status('🟢 ' + (p.name || p.from) + ' على القناة');
      this._peers();
    },

    /* ---------- الواجهة ---------- */
    _ui: function () {
      if (document.getElementById('faPttBtn')) return;
      var self = this;
      var wrap = document.createElement('div');
      wrap.innerHTML =
        '<style>' +
        '#faPttBtn{position:fixed;left:14px;bottom:14px;z-index:99999;width:62px;height:62px;border-radius:50%;' +
        'background:linear-gradient(145deg,#1e9e6a,#12805a);color:#fff;font-size:27px;display:flex;align-items:center;' +
        'justify-content:center;box-shadow:0 8px 22px rgba(18,128,90,.45);cursor:pointer;user-select:none;' +
        '-webkit-user-select:none;touch-action:none;border:3px solid rgba(255,255,255,.55);transition:transform .1s;}' +
        '#faPttBtn.on{background:linear-gradient(145deg,#e85d5d,#b92e2e);transform:scale(1.12);box-shadow:0 0 0 10px rgba(232,93,93,.28);}' +
        '#faPttSts{position:fixed;left:14px;bottom:84px;z-index:99999;background:#0f2e21;color:#a8d5bd;padding:6px 13px;' +
        'border-radius:12px;font-size:12px;font-weight:700;max-width:230px;box-shadow:0 6px 16px rgba(0,0,0,.3);direction:rtl;}' +
        '#faPttSpk{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;display:none;' +
        'background:#b92e2e;color:#fff;padding:9px 22px;border-radius:24px;font-size:15px;font-weight:900;' +
        'box-shadow:0 8px 24px rgba(185,46,46,.4);direction:rtl;}</style>' +
        '<div id="faPttSts">🎙️ جاري الاتصال...</div>' +
        '<div id="faPttSpk"></div>' +
        '<div id="faPttBtn" title="اضغط مطولاً واتكلم">🎙️</div>';
      document.body.appendChild(wrap);
      var btn = document.getElementById('faPttBtn');
      var start = function (e) { e.preventDefault(); self.start(); };
      var stop = function (e) { e.preventDefault(); self.stop(); };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    },

    _btnState: function (on) {
      var b = document.getElementById('faPttBtn');
      if (b) { b.classList.toggle('on', on); b.textContent = on ? '📢' : '🎙️'; }
      this._status(on ? '🔴 بتتكلم...' : '🎙️ القناة جاهزة');
    },
    _status: function (t) {
      var s = document.getElementById('faPttSts');
      if (s) s.textContent = t;
      this._peers();
    },
    _speaker: function (name) {
      var s = document.getElementById('faPttSpk');
      if (!s) return;
      var self = this;
      s.textContent = '📢 ' + (name || 'حد') + ' بيتكلم...';
      s.style.display = 'block';
      clearTimeout(this._spkT);
      this._spkT = setTimeout(function () { s.style.display = 'none'; }, 1200);
    },
    _peers: function () {
      var names = Object.keys(this.peers).map(function (k) { return V.peers[k]; });
      var s = document.getElementById('faPttSts');
      if (s && names.length) s.setAttribute('title', 'على القناة: ' + names.join('، '));
    }
  };
})();
