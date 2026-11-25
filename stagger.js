/* Nexus Stagger Menu port — "Share" dropdown in the top nav.
   Faithful vanilla-JS port of the Nexus UI stagger-menu registry
   component (no framer-motion, no dependencies, ES5 style to match
   the existing codebase):
   - Click the button -> the menu unfolds with items arriving ONE AFTER
     ANOTHER (per-item transition-delay in style.css, 0.04s + i * 0.04s,
     same as the original's spring delays).
   - A highlight GLIDES between rows as you hover/focus them (one
     absolutely positioned span, moved to the row's offsetTop).
   - ArrowDown/ArrowUp move through items and WRAP; Escape closes;
     clicking outside closes; picking an item runs its action, closes
     the menu, plays tick + chime, and ROLLS the button label to the
     item's done text ("Copied!" / "Shared!") for 1.5s, then back.
   - Interface sounds are synthesised with the Web Audio API (port of
     the Nexus ui-sounds recipes for pop / tick / success: oscillator
     + filtered-noise envelopes, master gain + compressor). They only
     play after a click/keypress; autoplay is OFF (no auto demo).
   - prefers-reduced-motion: the menu opens instantly, no stagger.
   Share targets use location.href at runtime, never a hardcoded
   site URL, so the links work on both the old and new Pages URL. */
(function () {
  var wrap = document.getElementById('share-wrap');
  var btn = document.getElementById('nav-share');
  var menu = document.getElementById('share-menu');
  var flashText = document.getElementById('share-flash-text');
  var hl = document.getElementById('share-hl');
  if (!wrap || !btn || !menu) return;
  var items = menu.querySelectorAll('.share-item');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SHARE_TEXT = 'VYRO.inspiration — the best web design inspiration';
  var isOpen = false, closeTimer = null, flashTimer = null;

  /* ---------- ui-sounds (Nexus recipes: pop / tick / success) ---------- */
  var ctx = null, master = null, noiseBuf = null;
  function audio() {
    if (typeof window === 'undefined') return null;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        var comp = ctx.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ctx.destination);
      }
      if (ctx.state !== 'running' && ctx.resume) ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  /* tone: oscillator + gain envelope, optional pitch glide (o.to). */
  function tone(c, out, o) {
    var t0 = c.currentTime + (o.at || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + (o.glide || o.decay || 0.1));
    var a = o.attack == null ? 0.004 : o.attack, d = o.decay == null ? 0.12 : o.decay, peak = o.gain == null ? 0.3 : o.gain;
    g.gain.value = 0.0001; /* a gain node starts at 1: without this the first sample can click */
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + a + d + 0.05);
  }
  /* hiss: filtered white noise + gain envelope. */
  function hiss(c, out, o) {
    var t0 = c.currentTime + (o.at || 0);
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    var n = c.createBufferSource();
    n.buffer = noiseBuf;
    var f = c.createBiquadFilter();
    var g = c.createGain();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 2000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + (o.attack || 0.01) + (o.decay || 0.1));
    f.Q.value = o.q == null ? 1 : o.q;
    var a = o.attack == null ? 0.003 : o.attack, d = o.decay == null ? 0.08 : o.decay, peak = o.gain == null ? 0.3 : o.gain;
    g.gain.value = 0.0001;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    n.connect(f);
    f.connect(g);
    g.connect(out);
    n.start(t0, Math.random() * 0.5);
    n.stop(t0 + a + d + 0.05);
  }
  var SOUND_FNS = {
    pop: function (c, o) { tone(c, o, { freq: 320, to: 980, glide: 0.07, decay: 0.09, gain: 0.35 }); },
    tick: function (c, o) { hiss(c, o, { freq: 5000, decay: 0.012, gain: 0.3, filter: 'highpass' }); },
    success: function (c, o) {
      tone(c, o, { freq: 1046.5, decay: 0.18, gain: 0.22, type: 'triangle' });
      tone(c, o, { at: 0.09, freq: 1318.5, decay: 0.32, gain: 0.22, type: 'triangle' });
    }
  };
  /* play(name, vol): only ever called from a click/key handler, so the
     AudioContext is created (and resumed) inside a user gesture. */
  function play(name, vol) {
    try {
      var c = audio();
      if (!c || !master || !SOUND_FNS[name]) return;
      var g = c.createGain();
      g.gain.value = vol == null ? 1 : vol;
      g.connect(master);
      SOUND_FNS[name](c, g);
    } catch (e) { /* no audio in this browser: stay silent */ }
  }

  /* ---------- menu open / close ---------- */
  function moveHighlight(el) {
    if (!el) { hl.style.opacity = '0'; return; }
    hl.style.top = el.offsetTop + 'px';
    hl.style.height = el.offsetHeight + 'px';
    hl.style.opacity = '1';
  }
  function openMenu() {
    if (isOpen) return;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    isOpen = true;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    wrap.classList.add('open');
    void menu.offsetHeight; /* paint the closed state first, so the .open transition runs */
    menu.classList.add('open');
    play('pop', 0.7);
  }
  function closeMenu(refocus) {
    if (!isOpen) return;
    isOpen = false;
    btn.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('open');
    menu.classList.remove('open');
    menu.classList.add('closing');
    moveHighlight(null);
    var done = function () { menu.hidden = true; menu.classList.remove('closing'); closeTimer = null; };
    if (reduceMotion) done(); else closeTimer = setTimeout(done, 170);
    if (refocus) btn.focus();
  }

  /* ---------- button label roll (confirmation) ---------- */
  function flash(text) {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    flashText.textContent = text;
    btn.setAttribute('aria-label', 'Share — ' + text);
    btn.classList.add('flash');
    flashTimer = setTimeout(function () {
      btn.classList.remove('flash');
      btn.removeAttribute('aria-label');
      flashTimer = null;
    }, 1500);
  }

  /* ---------- share actions ---------- */
  function shareUrl() { return window.location.href; }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* clipboard unavailable: the flash still confirms the intent */ }
  }
  function copyLink() {
    var url = shareUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { flash('Copied!'); }, function () { fallbackCopy(url); flash('Copied!'); });
    } else {
      fallbackCopy(url);
      flash('Copied!');
    }
  }
  function openShare(url) {
    window.open(url, '_blank', 'noopener');
  }
  function pick(item) {
    var id = item.getAttribute('data-share');
    play('tick', 0.5);
    play('success', 0.7);
    closeMenu(true);
    if (id === 'copy') { copyLink(); return; }
    if (id === 'x') {
      openShare('https://twitter.com/intent/tweet?text=' + encodeURIComponent(SHARE_TEXT) + '&url=' + encodeURIComponent(shareUrl()));
      flash('Shared!');
      return;
    }
    if (id === 'facebook') {
      openShare('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl()));
      flash('Shared!');
      return;
    }
  }

  /* ---------- events ---------- */
  btn.addEventListener('click', function () {
    if (isOpen) closeMenu(false); else openMenu();
  });
  for (var i = 0; i < items.length; i++) {
    (function (it) {
      it.addEventListener('pointerenter', function () { moveHighlight(it); });
      it.addEventListener('focus', function () { moveHighlight(it); });
      it.addEventListener('click', function () { pick(it); });
    })(items[i]);
  }
  menu.addEventListener('pointerleave', function () { moveHighlight(null); });
  function focusedIndex() {
    for (var j = 0; j < items.length; j++) {
      if (items[j] === document.activeElement) return j;
    }
    return -1;
  }
  function focusItem(i) {
    var n = items.length;
    items[((i % n) + n) % n].focus();
  }
  menu.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(focusedIndex() + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(focusedIndex() - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
  });
  btn.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(items.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
  });
  /* outside click closes (pointerdown, like the original) */
  window.addEventListener('pointerdown', function (e) {
    if (!isOpen) return;
    var t = e.target;
    if (t && wrap.contains(t)) return;
    closeMenu(false);
  });

  window.StaggerMenu = {
    open: openMenu,
    close: function () { closeMenu(false); },
    isOpen: function () { return isOpen; }
  };
})();
