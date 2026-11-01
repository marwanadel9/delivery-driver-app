/* FAVoice LIVE v2 — صوت مباشر ثنائي الاتجاه + اختيار المندوب */
(function () {
  var SILENT = null, SILENT_CTX = null;
  function silentTrack() {
    if (SILENT && SILENT.readyState === 'live') return SILENT;
    var AC = window.AudioContext || window.webkitAudioContext;
    SILENT_CTX = new AC();
    var dest = SILENT_CTX.createMediaStreamDestination();
    var osc = SILENT_CTX.createOscillator(), g = SILENT_CTX.createGain();
    g.gain.value = 0; osc.connect(g); g.connect(dest); osc.start();
    SILENT = dest.stream.getAudioTracks()[0];
    return SILENT;
  }
  var V = window.FAVoice = {
    cfg: null, sb: null, ch: null, peers: {}, audioEls: {}, onlinePeers: {},
    micStream: null, talking: false, starting: false, toggleMode: false, downAt: 0,
    timer: null, maxTimer: null, pendingIce: {}, selectedId: '', _seenTargets: '',

    init: function (cfg) {
      this.cfg = cfg || {};
      this._ui();
      var self = this;
      if (!window.RTCPeerConnection) { this._status('⚠️ المتصفح لا يدعم WebRTC'); return; }
      if (!window.supabase || !cfg.key || !cfg.url) { this._status('⚠️ إعدادات الاتصال غير مكتملة'); return; }
      try {
        this.sb = window.supabase.createClient(cfg.url, cfg.key);
        this.ch = this.sb.channel(cfg.room, { config: { broadcast: { ack: false } } });
        this.ch.on('broadcast', { event: 'rtc-signal' }, function (m) { self._signal(m.payload || {}); });
        this.ch.subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            self._status('🟢 متصل — اضغط المايك واتكلم');
            self._hello();
            self.timer = setInterval(function () {
              self._hello();
              if (String(self.cfg.id) === 'master') {
                /* تنضيف قائمة المتصلين (لو مبعتش hello من 25 ثانية يعتبر offline) */
                var now = Date.now(), changed = false;
                Object.keys(self.onlinePeers).forEach(function (id) {
                  if (now - self.onlinePeers[id].seen > 25000) { delete self.onlinePeers[id]; changed = true; }
                });
                if (changed) self._renderTargets();
              }
            }, 8000);
            self._renderTargets();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            self._status('⚠️ تعذر الاتصال — بيحاول تاني...');
          }
        });
        document.addEventListener('pointerdown', function () { self._playAll(); }, { passive: true });
      } catch (e) { this._status('⚠️ ' + (e.message || e)); }
    },

    _send: function (p) { if (this.ch) { try { this.ch.send({ type: 'broadcast', event: 'rtc-signal', payload: p }); } catch (e) {} } },
    _hello: function () { this._send({ type: 'hello', from: this.cfg.id, name: this.cfg.name }); },

    _pingTalk: function () { this._send({ kind: 'talk' }); },
    _signal: async function (p) {
      if (!p || !p.from || p.from === this.cfg.id) return;
      var id = String(p.from), self = this;
      /* ⭐ إشارة بدء الكلام — جرس عند الطرف الآخر مع كل ضغطة */
      if (p.kind === 'talk') { var now = Date.now(); if (!self._lastTalkRing || now - self._lastTalkRing > 1200) { self._lastTalkRing = now; try { self._faRing(); } catch (e) {} } return; }
      if (p.type === 'call') {
        /* ⭐ مكالمة واردة — الرد التلقائي: اختيار المتصل وفتح الاتصال فورًا */
        if (String(this.cfg.id) === 'master') {
          this.onlinePeers[id] = { id: id, name: p.name || id, seen: Date.now() };
          if (String(this.selectedId) !== id) {
            Object.keys(this.peers).forEach(function (o) { if (o !== id) self._drop(o); });
            this.selectedId = id;
          }
          this._renderTargets();
          this._speaker('📞 ' + (p.name || id));
          this._status('📞 مكالمة من ' + (p.name || id) + ' — جاري الرد التلقائي');
          if (!this.peers[id]) this._offer(id, p.name);
          else this._playAll();
        }
        return;
      }
      if (p.type === 'hello') {
        var isNew = !this.onlinePeers[id];
        this.onlinePeers[id] = { id: id, name: p.name || id, seen: Date.now() };
        if (String(this.cfg.id) === 'master') {
          this._renderTargets();
          if (!this.selectedId) this.selectedId = id;
          if (String(this.selectedId) === id && !this.peers[id]) this._offer(id, p.name);
        }
        return;
      }
      if (p.to && String(p.to) !== String(this.cfg.id)) return;
      var pc = this.peers[id];
      try {
        if (p.type === 'disconnect') { this._drop(id); return; }
        if (p.type === 'offer') {
          this._speaker('📞 ' + (p.name || id));
          this._status('📞 مكالمة واردة من ' + (p.name || id) + ' — جاري الرد التلقائي');
          if (!pc || pc.signalingState === 'closed') { delete this.peers[id]; pc = this._makePeer(id, p.name); }
          await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
          var ans = await pc.createAnswer();
          ans.sdp = this._tuneSdp(ans.sdp);
          await pc.setLocalDescription(ans);
          this._send({ type: 'answer', from: this.cfg.id, to: id, name: this.cfg.name, sdp: pc.localDescription });
          this._flushIce(id);
        } else if (p.type === 'answer' && pc && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
          this._flushIce(id);
        } else if (p.type === 'ice') {
          if (!pc || !pc.remoteDescription) { (this.pendingIce[id] = this.pendingIce[id] || []).push(p.candidate); }
          else if (p.candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(p.candidate)); } catch (e) {} }
        }
      } catch (e) { this._status('⚠️ اتصال صوتي: ' + (e.message || e)); }
    },

    /* ⭐ تحسين جودة الصوت: Opus نقي 64kbps + تصحيح أخطاء — صوت واضح بلا تقطيع */
    _tuneSdp: function (sdp) {
      return sdp.replace(/(a=fmtp:\d+ .*?)(\r?\n)/, function (m, p, nl) {
        if (p.indexOf('maxaveragebitrate') > -1) return m;
        return p + ';maxaveragebitrate=64000;stereo=0;sprop-stereo=0;useinbandfec=1;usedtx=0;minptime=10;maxptime=20' + nl;
      });
    },
    _tuneSenders: function (pc) {
      try {
        pc.getSenders().forEach(function (s) {
          if (s.track && s.track.kind === 'audio') {
            s.setParameters({ encodings: [{ maxBitrate: 64000, active: true }] }).catch(function () {});
          }
        });
      } catch (e) {}
    },

    _makePeer: function (id, name) {
      var self = this;
      if (this.peers[id]) return this.peers[id];
      var pc = new RTCPeerConnection({ iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' },
        /* ⭐ TURN — بيشتغل تلقائيًا بس لو الشبكة صعبة (NAT مغلق) */
        { urls: 'turn:a.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:a.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ] });
      pc._faName = name || id;
      var liveMic = this.micStream && this.micStream.getAudioTracks()[0];
      var sendTrack = (liveMic && liveMic.readyState === 'live') ? liveMic : silentTrack();
      pc.addTrack(sendTrack, liveMic ? this.micStream : new MediaStream([sendTrack]));
      pc.onicecandidate = function (ev) { if (ev.candidate) self._send({ type: 'ice', from: self.cfg.id, to: id, candidate: ev.candidate }); };
      pc.ontrack = function (ev) {
        var stream = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
        if (!self._rang) self._rang = {};
        var first = !self._rang[id];
        if (first) self._rang[id] = 1;
        var a = self.audioEls[id];
        if (!a) {
          a = document.createElement('audio');
          a.autoplay = !first; a.playsInline = true; a.volume = 1; a.muted = false;
          a.style.display = 'none'; document.body.appendChild(a);
          self.audioEls[id] = a;
        } else { a.autoplay = true; }
        a.srcObject = stream;
        if (first) { try { self._faRing(); } catch (e) {} setTimeout(function () { self._playOne(a); }, 650); }
        /* ⭐ تثبيت استقبال الصوت: buffer ثابت = نقاء بدون تقطيع */
        try { (pc.getReceivers() || []).forEach(function (r) { if ('jitterBufferTarget' in r) r.jitterBufferTarget = 80; }); } catch (_) {}
        ev.track.onunmute = function () { a.muted = false; a.volume = 1; self._playOne(a); self._speaker(pc._faName); self._status('🔊 بيسمع: ' + pc._faName); };
        self._playOne(a);
      };
      pc.onconnectionstatechange = function () {
        if (pc.connectionState === 'connected') {
          self._tuneSenders(pc);
          try { (pc.getReceivers() || []).forEach(function (r) { if ('jitterBufferTarget' in r) r.jitterBufferTarget = 80; }); } catch (_) {}
          self._status('🟢 اتصال صوتي مباشر HD (الاتجاهين)');
        }
        else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') self._drop(id, true);
      };
      this.peers[id] = pc;
      return pc;
    },
    _drop: function (id, silent) {
      var pc = this.peers[id];
      if (pc) { try { pc.close(); } catch (e) {} delete this.peers[id]; }
      var a = this.audioEls[id];
      if (a) { try { a.pause(); a.srcObject = null; a.remove(); } catch (e) {} delete this.audioEls[id]; }
      if (!silent) this._send({ type: 'disconnect', from: this.cfg.id, to: id });
    },
    _offer: async function (id, name) {
      try {
        var pc = this._makePeer(id, name);
        if (pc.signalingState !== 'stable') return;
        var o = await pc.createOffer();
        o.sdp = this._tuneSdp(o.sdp);
        await pc.setLocalDescription(o);
        this._send({ type: 'offer', from: this.cfg.id, to: id, name: this.cfg.name, sdp: pc.localDescription });
      } catch (e) { this._status('⚠️ تعذر بدء الاتصال'); }
    },
    _flushIce: async function (id) {
      var pc = this.peers[id], list = this.pendingIce[id] || [];
      delete this.pendingIce[id];
      for (var i = 0; i < list.length; i++) { if (list[i] && pc && pc.remoteDescription) { try { await pc.addIceCandidate(new RTCIceCandidate(list[i])); } catch (e) {} } }
    },

    start: async function () {
      if (this.talking || this.starting) return;
      this.starting = true; this._status('🎤 جاري فتح المايك...');
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, echoCancellationType: 'system', noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000, latency: 0.003, googEchoCancellation: true, googEchoCancellationType: 'system', googHighpassFilter: true, googNoiseSuppression: true, googAutoGainControl: true, googTypingNoiseDetection: true, googNoiseReduction: true } });
        var track = this.micStream.getAudioTracks()[0];
        var ids = Object.keys(this.peers);
        for (var i = 0; i < ids.length; i++) {
          var pc = this.peers[ids[i]];
          if (!pc || pc.signalingState === 'closed') continue;
          var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === 'audio'; });
          if (sender) { await sender.replaceTrack(track); }
        }
        this.talking = true; this.starting = false; this._btnState(true);
        this._status('🔴 بث مباشر للجميع');
        var self = this; clearTimeout(this.maxTimer);
        this.maxTimer = setTimeout(function () { self.stop(); }, 60000);
        this._hello();
        /* ⭐ ضغطة المايك = اتصال: المندوب ينادي المكتب والمكتب يتصل بيه فورًا */
        this._send({ type: 'call', from: this.cfg.id, name: this.cfg.name, to: String(this.cfg.id) === 'master' ? '' : 'master' });
      } catch (e) { this.starting = false; this._status('⚠️ المايك: ' + (e.message || 'رفض الإذن')); }
    },
    stop: function () {
      clearTimeout(this.maxTimer);
      this.talking = false; this.starting = false; this._btnState(false);
      if (this.micStream) { this.micStream.getTracks().forEach(function (t) { t.stop(); }); this.micStream = null; }
      var st = silentTrack();
      Object.keys(this.peers).forEach(function (id) {
        var pc = V.peers[id];
        if (!pc || pc.signalingState === 'closed') return;
        var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === 'audio'; });
        if (sender) sender.replaceTrack(st).catch(function () {});
      });
      this._status('🟢 جاهز');
    },

    _faRing: function () {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        var ctx = this._faRingCtx || (this._faRingCtx = new AC());
        if (ctx.state === 'suspended') ctx.resume();
        var t = ctx.currentTime;
        [880, 660, 880].forEach(function (f, i) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          var s = t + i * 0.22;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.exponentialRampToValueAtTime(0.45, s + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, s + 0.21);
          o.connect(g); g.connect(ctx.destination);
          o.start(s); o.stop(s + 0.22);
        });
      } catch (e) {}
    },
    _playOne: function (a) { if (a) { var p = a.play(); if (p && p.catch) p.catch(function () {}); } },
    _playAll: function () { var s = this; Object.keys(this.audioEls).forEach(function (id) { s._playOne(s.audioEls[id]); }); },

    /* ⭐ اختيار المندوب — يظهر للماستر فوق زرار المايك */
    _renderTargets: function () {
      if (String(this.cfg.id) !== 'master') return;
      var self = this;
      var box = document.getElementById('faTargets');
      if (!box) {
        box = document.createElement('div');
        box.id = 'faTargets';
        box.style.cssText = 'position:fixed;left:14px;top:152px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;direction:rtl;max-height:40vh;overflow:auto';
        document.body.appendChild(box);
      }
      /* القايمة = كل المناديب من إعدادات البرنامج + أي واحد متصل مش مسجل */
      var list = [];
      if (typeof drivers !== 'undefined' && Array.isArray(drivers)) {
        drivers.forEach(function (d) { list.push({ id: String(d.sheet), name: d.name || d.sheet }); });
      }
      Object.keys(this.onlinePeers).forEach(function (id) {
        if (!list.some(function (x) { return x.id === id; })) list.push({ id: id, name: self.onlinePeers[id].name });
      });
      var self = this;
      var html = '<div style="font-size:11px;font-weight:900;color:#a8d5bd;background:#081a12;padding:5px 10px;border-radius:8px">🎙️ اختر المندوب اللي هتكلمه:</div>';
      html += list.map(function (d) {
        var on = self.onlinePeers[d.id] && (Date.now() - self.onlinePeers[d.id].seen < 25000);
        var sel = String(self.selectedId) === d.id;
        var live = self.peers[d.id] && self.peers[d.id].connectionState === 'connected';
        return '<button data-id="' + d.id + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;border:2px solid ' + (sel ? '#d4a72c' : '#2f5444') + ';background:' + (sel ? 'linear-gradient(145deg,#d4a72c,#b8860b)' : '#0f2e21') + ';color:' + (sel ? '#2b2105' : '#a8d5bd') + ';font-weight:800;font-size:13px;cursor:pointer;text-align:right">' +
          '<span style="width:9px;height:9px;border-radius:50%;background:' + (on ? '#4ade80' : '#6b7280') + ';box-shadow:0 0 6px ' + (on ? '#4ade80' : 'transparent') + '"></span>' +
          '<span style="flex:1">🚚 ' + d.name + '</span>' +
          (live ? '<span style="font-size:10px;background:rgba(0,0,0,.25);padding:2px 8px;border-radius:8px">متصل صوتيًا 🔊</span>' : (on ? '<span style="font-size:10px;opacity:.75">متصل</span>' : '<span style="font-size:10px;opacity:.55">غير متصل</span>')) +
          '</button>';
      }).join('');
      if (!list.length) html += '<div style="font-size:12px;color:#8fa89c;padding:6px">مفيش مناديب — افتح تطبيق المندوب الأول</div>';
      box.innerHTML = html;
      box.querySelectorAll('button[data-id]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-id');
          if (String(s.selectedId) !== id) {
            /* قفل الاتصال القديم */
            Object.keys(s.peers).forEach(function (old) { if (old !== id) s._drop(old); });
            s.selectedId = id;
          }
          s._renderTargets();
          if (s.onlinePeers[id]) s._offer(id, s.onlinePeers[id].name);
          else s._status('⚠️ ' + (s.onlinePeers[id] ? s.onlinePeers[id].name : id) + ' مش متصل حاليًا');
        };
      });
    },

    _ui: function () {
      if (document.getElementById('faPttBtn')) return;
      var wrap = document.createElement('div');
      wrap.innerHTML = '<style>.driver-invoice-open #faPttBtn,.driver-invoice-open #faTargets{display:none!important}#faPttBtn{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:2147483647;width:62px;height:62px;border-radius:50%;background:linear-gradient(145deg,#1e9e6a,#12805a);color:#fff;font-size:27px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(18,128,90,.45);cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;border:3px solid rgba(255,255,255,.55);transition:transform .1s}#faPttBtn.on{background:linear-gradient(145deg,#e85d5d,#b92e2e);transform:scale(1.12);box-shadow:0 0 0 10px rgba(232,93,93,.28)}#faPttSts{position:fixed;left:14px;top:84px;z-index:2147483647;background:#0f2e21;color:#a8d5bd;padding:6px 13px;border-radius:12px;font-size:12px;font-weight:700;max-width:280px;box-shadow:0 6px 16px rgba(0,0,0,.3);direction:rtl}#faPttSpk{position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:2147483647;display:none;background:#b92e2e;color:#fff;padding:9px 22px;border-radius:24px;font-size:15px;font-weight:900;box-shadow:0 8px 24px rgba(185,46,46,.4);direction:rtl}</style><div id="faPttSts">🎙️ جاري الاتصال...</div><div id="faPttSpk"></div><div id="faPttBtn" title="اضغط للتحدث المباشر">🎙️</div>';
      document.body.appendChild(wrap);
      var self = this, btn = document.getElementById('faPttBtn');
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault(); self._playAll();
        if (self.toggleMode) { self.toggleMode = false; self.stop(); return; }
        self.downAt = Date.now(); self.start(); try { self._pingTalk(); } catch (e) {}
      });
      function rel(e) {
        if (e) e.preventDefault();
        if (!self.talking && !self.starting) return;
        if (Date.now() - self.downAt < 300) { self.toggleMode = true; self._status('🔴 البث مفتوح — اضغط تاني للإيقاف'); }
        else self.stop();
      }
      btn.addEventListener('pointerup', rel);
      btn.addEventListener('pointercancel', rel);
      btn.addEventListener('pointerleave', function (e) { if (!self.toggleMode) rel(e); });
      btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    },
    _btnState: function (on) { var b = document.getElementById('faPttBtn'); if (b) { b.classList.toggle('on', on); b.textContent = on ? '📢' : '🎙️'; } },
    _status: function (t) { var s = document.getElementById('faPttSts'); if (s) s.textContent = t; },
    _speaker: function (n) { var s = document.getElementById('faPttSpk'); if (!s) return; s.textContent = '📢 ' + (n || 'المتحدث'); s.style.display = 'block'; clearTimeout(this._spkT); this._spkT = setTimeout(function () { s.style.display = 'none'; }, 1400); }
  };
})();
