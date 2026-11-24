/* Seesaw directory — loads data.json, renders category bar + searchable card grid.
   Relative paths only; works from any static host. */
(function () {
  var grid = document.getElementById('grid');
  var catbarInner = document.getElementById('catbar-inner');
  var searchInput = document.getElementById('search');
  var resultCount = document.getElementById('result-count');
  var activeLabel = document.getElementById('active-label');
  var activeCount = document.getElementById('active-count');
  var emptyBox = document.getElementById('empty');
  var loading = document.getElementById('loading');
  var updatedEl = document.getElementById('updated');

  var data = null;
  var activeSlug = 'all';
  var query = '';

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
          '<span class="img-fallback" ' + (s.image ? 'hidden' : '') + '>SEESAW ✦</span>' +
          '<span class="view-btn">View Website ↗</span>' +
        '</span>' +
        '<span class="card-body"><h3>' + esc(s.title) + '</h3>' +
        '<p>' + esc(s.description || '') + '</p>' +
        '<span class="card-domain">' + esc(domainOf(s.link)) + ' ↗</span></span>';
      frag.appendChild(a);
    });
    grid.appendChild(frag);
  }

  searchInput.addEventListener('input', function () {
    query = searchInput.value.trim();
    renderGrid();
  });
  document.getElementById('clear-search').addEventListener('click', function () {
    searchInput.value = '';
    query = '';
    renderGrid();
    searchInput.focus();
  });
  document.querySelector('.wordmark').addEventListener('click', function (e) {
    e.preventDefault();
    activeSlug = 'all';
    renderCats();
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  fetch('data.json')
    .then(function (r) { if (!r.ok) throw new Error('data.json not found (' + r.status + ')'); return r.json(); })
    .then(function (json) {
      data = json;
      loading.hidden = true;
      updatedEl.textContent = data.updated || '';
      renderCats();
      renderGrid();
    })
    .catch(function (err) {
      loading.textContent = 'Could not load data.json — ' + err.message +
        '. Serve this folder over HTTP (e.g. python3 -m http.server) or open via a static host; file:// blocks fetch in some browsers.';
    });
})();
