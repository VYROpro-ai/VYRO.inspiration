/* VYRO.inspiration — loads data.json, renders hero collage wall,
   bottom category nav + searchable card grid. Relative paths only;
   works from any static host. */
(function () {
  var grid = document.getElementById('grid');
  var catbarInner = document.getElementById('catbar-inner');
  var searchInput = document.getElementById('search');
  var navSearch = document.getElementById('nav-search');
  var resultCount = document.getElementById('result-count');
  var activeLabel = document.getElementById('active-label');
  var activeCount = document.getElementById('active-count');
  var emptyBox = document.getElementById('empty');
  var loading = document.getElementById('loading');
  var updatedEl = document.getElementById('updated');
  var hero = document.getElementById('hero');
  var heroWall = document.getElementById('hero-wall');
  var heroCta = document.getElementById('hero-cta');
  var heroPause = document.getElementById('hero-pause');

  var data = null;
  var activeSlug = 'all';
  var query = '';
  var motionPaused = false;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Baked-style hero wall: tiles from the directory's own preview images. */
  function buildHeroWall(sites) {
    if (!sites || !sites.length) return;
    var picks = sites.filter(function (s) { return s.image; }).slice(0, 24);
    var frag = document.createDocumentFragment();
    picks.forEach(function (s, i) {
      var t = document.createElement('div');
      t.className = 'hero-tile' + (i % 7 === 2 ? ' wide' : '') + (i % 9 === 4 ? ' tall' : '');
      var col = i % 6, row = Math.floor(i / 6);
      var dx = (col - 2.5) / 2.5, dy = (row - 1.5) / 1.5;
      t.style.setProperty('--r', (((i * 37) % 7) - 3) + 'deg');
      t.style.setProperty('--tx', Math.round(dx * 420) + 'px');
      t.style.setProperty('--ty', Math.round(dy * 320) + 'px');
      var img = document.createElement('img');
      img.src = s.image; img.alt = ''; img.loading = i < 12 ? 'eager' : 'lazy'; img.decoding = 'async';
      img.onerror = function () { t.remove(); };
      t.appendChild(img);
      frag.appendChild(t);
    });
    heroWall.appendChild(frag);
  }

  function setHeroOpen(open) {
    hero.classList.toggle('open', open);
  }

  window.addEventListener('scroll', function () {
    setHeroOpen(window.scrollY > 40);
  }, { passive: true });

  heroCta.addEventListener('click', function () { setHeroOpen(true); });
  heroPause.addEventListener('click', function () {
    motionPaused = !motionPaused;
    heroPause.textContent = motionPaused ? '▶ Resume motion' : '⏸ Pause motion';
  });
  hero.addEventListener('pointermove', function (e) {
    if (motionPaused || reduceMotion || hero.classList.contains('open')) return;
    var x = (e.clientX / window.innerWidth - 0.5) * 22;
    var y = (e.clientY / window.innerHeight - 0.5) * 14;
    heroWall.style.transform = 'translate3d(' + (-x) + 'px,' + (-y) + 'px,0)';
  });
  hero.addEventListener('pointerleave', function () {
    heroWall.style.transform = '';
  });

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function currentSites() {
    if (!data) return [];
    var cat = null;
    for (var i = 0; i < data.categories.length; i++) {
      if (data.categories[i].slug === activeSlug) { cat = data.categories[i]; break; }
    }
    var sites = cat ? cat.sites : [];
    if (!query) return sites;
    var q = query.toLowerCase();
    return sites.filter(function (s) {
      return (s.title + ' ' + (s.description || '')).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderCats() {
    catbarInner.innerHTML = '';
    data.categories.forEach(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-btn' + (cat.slug === activeSlug ? ' active' : '');
      b.setAttribute('data-cat', cat.slug);
      b.innerHTML = esc(cat.name) + ' <span class="n">' + cat.sites.length + '</span>';
      b.addEventListener('click', function () {
        activeSlug = cat.slug;
        renderCats();
        renderGrid();
        document.querySelector('main').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      catbarInner.appendChild(b);
    });
  }

  function renderGrid() {
    venom = null;
    var sites = currentSites();
    var cat = null;
    for (var i = 0; i < data.categories.length; i++) {
      if (data.categories[i].slug === activeSlug) { cat = data.categories[i]; break; }
    }
    activeLabel.textContent = cat ? cat.name + ' sites' : 'All sites';
    activeCount.textContent = sites.length + (query ? ' matching' : ' sites');
    resultCount.textContent = query
      ? sites.length + ' result' + (sites.length === 1 ? '' : 's') + ' for “' + query + '”'
      : (cat ? cat.sites.length + ' sites in ' + cat.name : '');
    emptyBox.hidden = sites.length !== 0;
    grid.innerHTML = '';
    var frag = document.createDocumentFragment();
    sites.forEach(function (s) {
      var a = document.createElement('a');
      a.className = 'card';
      a.href = s.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', s.title + ' — View Website (opens live site in a new tab)');
      var imgHtml = s.image
        ? '<img src="' + esc(s.image) + '" alt="" loading="lazy" decoding="async" onerror="this.remove();this.parentNode.querySelector(\'.img-fallback\').hidden=false;">'
        : '';
      a.innerHTML =
        '<span class="thumb">' + imgHtml +
          '<span class="img-fallback" ' + (s.image ? 'hidden' : '') + '>VYRO ✦</span>' +
          '<span class="view-btn">View Website ↗</span>' +
        '</span>' +
        '<span class="card-body"><h3>' + esc(s.title) + '</h3>' +
        '<p>' + esc(s.description || '') + '</p>' +
        '<span class="card-domain">' + esc(domainOf(s.link)) + ' ↗</span></span>';
      if (!reduceMotion) {
        var thumbEl = a.querySelector('.thumb');
        if (thumbEl) thumbEl.appendChild(venomSvg());
      }
      frag.appendChild(a);
    });
    grid.appendChild(frag);
  }

  /* Venom tendrils (dribbble 27839721): gooey black strands from the
     button edge that stretch toward the cursor with lag + wobble,
     then retract elastically when the cursor leaves. */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var VENOM_W = [8, 5, 3, 6, 2.5];
  var venom = null;
  var venomRunning = false;

  function venomSvg() {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'venom');
    svg.setAttribute('viewBox', '0 0 100 62.5');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    var g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('filter', 'url(#venom-goo)');
    var paths = [];
    VENOM_W.forEach(function (w) {
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('stroke-width', w);
      g.appendChild(p);
      paths.push(p);
    });
    var blob = document.createElementNS(SVGNS, 'circle');
    blob.setAttribute('r', '4');
    g.appendChild(blob);
    svg.appendChild(g);
    svg._paths = paths;
    svg._blob = blob;
    return svg;
  }

  function venomStart(card, x, y) {
    var thumb = card.querySelector('.thumb');
    var btn = card.querySelector('.view-btn');
    var svg = thumb && thumb.querySelector('.venom');
    if (!thumb || !btn || !svg) return;
    var tr = thumb.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    if (!tr.width || !tr.height || !br.width) return;
    venom = {
      svg: svg, paths: svg._paths, blob: svg._blob,
      cx: (br.left - tr.left + br.width / 2) / tr.width * 100,
      cy: (br.top - tr.top + br.height / 2) / tr.height * 62.5,
      hw: br.width / 2 / tr.width * 100,
      hh: br.height / 2 / tr.height * 62.5,
      tx: (x - tr.left) / tr.width * 100,
      ty: (y - tr.top) / tr.height * 62.5,
      fx: (br.left - tr.left + br.width / 2) / tr.width * 100,
      fy: (br.top - tr.top + br.height / 2) / tr.height * 62.5,
      leaving: false
    };
    if (!venomRunning) { venomRunning = true; requestAnimationFrame(venomTick); }
  }

  function venomTick(now) {
    if (!venom || !venom.svg.isConnected) { venom = null; venomRunning = false; return; }
    var v = venom;
    v.fx += (v.tx - v.fx) * 0.14;
    v.fy += (v.ty - v.fy) * 0.14;
    var dx = v.fx - v.cx, dy = v.fy - v.cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var ang = Math.atan2(dy, dx);
    var px = -Math.sin(ang), py = Math.cos(ang);
    v.paths.forEach(function (p, i) {
      var a = ang + (i - 2) * 0.26;
      var sx = v.cx + Math.cos(a) * v.hw;
      var sy = v.cy + Math.sin(a) * v.hh;
      var spread = (i - 2) * 2.4;
      var ex = v.fx + px * spread;
      var ey = v.fy + py * spread;
      var mx = (sx + ex) / 2 + px * Math.sin(now * 0.005 + i * 1.9) * 2.4;
      var my = (sy + ey) / 2 + py * Math.cos(now * 0.004 + i * 1.3) * 2.4;
      if (v.leaving) { ex = sx + (ex - sx) * 0.25; ey = sy + (ey - sy) * 0.25; }
      p.setAttribute('d', 'M ' + sx.toFixed(1) + ' ' + sy.toFixed(1) +
        ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1));
    });
    v.blob.setAttribute('cx', v.fx.toFixed(1));
    v.blob.setAttribute('cy', v.fy.toFixed(1));
    v.blob.setAttribute('r', v.leaving ? '2' : '4');
    if (v.leaving && dist < 2) { venom = null; venomRunning = false; return; }
    requestAnimationFrame(venomTick);
  }

  grid.addEventListener('pointerover', function (e) {
    if (reduceMotion) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var card = t.closest('.card');
    if (!card) return;
    if (venom && venom.svg.isConnected && card.contains(venom.svg)) return;
    venomStart(card, e.clientX, e.clientY);
  });
  grid.addEventListener('pointerout', function (e) {
    if (!venom) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var card = t.closest('.card');
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    venom.tx = venom.cx; venom.ty = venom.cy; venom.leaving = true;
  });

  /* Button lean + Venom tendril target follow the cursor. */
  grid.addEventListener('pointermove', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var card = t.closest('.card');
    if (!card) return;
    var btn = card.querySelector('.view-btn');
    if (!btn) return;
    var r = btn.getBoundingClientRect();
    if (!r.width || !r.height) return;
    btn.style.setProperty('--ox', Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)).toFixed(1) + '%');
    btn.style.setProperty('--oy', Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100)).toFixed(1) + '%');
    if (venom && venom.svg.isConnected && card.contains(venom.svg)) {
      var tr = card.querySelector('.thumb').getBoundingClientRect();
      if (tr.width && tr.height) {
        venom.tx = (e.clientX - tr.left) / tr.width * 100;
        venom.ty = (e.clientY - tr.top) / tr.height * 62.5;
        venom.leaving = false;
      }
    }
  });

  searchInput.addEventListener('input', function () {
    query = searchInput.value.trim();
    if (navSearch) navSearch.value = searchInput.value;
    renderGrid();
  });
  if (navSearch) navSearch.addEventListener('input', function () {
    query = navSearch.value.trim();
    searchInput.value = navSearch.value;
    renderGrid();
  });
  document.getElementById('clear-search').addEventListener('click', function () {
    searchInput.value = '';
    if (navSearch) navSearch.value = '';
    query = '';
    renderGrid();
    searchInput.focus();
  });
  function goHome(e) {
    if (e) e.preventDefault();
    activeSlug = 'all';
    renderCats();
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelector('.wordmark').addEventListener('click', goHome);
  document.getElementById('footer-logo').addEventListener('click', goHome);

  fetch('data.json')
    .then(function (r) { if (!r.ok) throw new Error('data.json not found (' + r.status + ')'); return r.json(); })
    .then(function (json) {
      data = json;
      loading.hidden = true;
      updatedEl.textContent = data.updated || '';
      buildHeroWall(data.categories && data.categories[0] ? data.categories[0].sites : []);
      renderCats();
      renderGrid();
    })
    .catch(function (err) {
      loading.textContent = 'Could not load data.json — ' + err.message +
        '. Serve this folder over HTTP (e.g. python3 -m http.server) or open via a static host; file:// blocks fetch in some browsers.';
    });
})();
