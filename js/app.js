// ─── Application : navigation, recherche, statut serveur ────────────────────

const App = (() => {
  // ── Navigation entre vues ───────────────────────────────────────────────────

  function switchView(name) {
    document.querySelectorAll('.topnav-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) =>
      v.classList.toggle('active', v.id === 'view-' + name));

    if (name === 'map') MapView.invalidate();
    if (name === 'compare') Compare.show();
    if (name === 'stats') Stats.show();
    if (name === 'history') History.show();
    if (name === 'ai') AIView.show();
  }

  // ── Recherche d'adresse (géocodage) ─────────────────────────────────────────

  function bindSearch() {
    const input = document.getElementById('search-input');
    const resultsBox = document.getElementById('search-results');
    let debounce = null;

    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 3) { resultsBox.classList.remove('open'); return; }
      debounce = setTimeout(async () => {
        const results = await API.geocode(q);
        if (!results.length) {
          resultsBox.innerHTML = '<div class="search-result">Aucun résultat</div>';
        } else {
          resultsBox.innerHTML = results.map((r) => `
            <div class="search-result" data-lat="${escapeHtml(r.lat)}" data-lon="${escapeHtml(r.lon)}">
              ${escapeHtml(r.display_name.split(',')[0])}
              <small>${escapeHtml(r.display_name)}</small>
            </div>`).join('');
          resultsBox.querySelectorAll('.search-result[data-lat]').forEach((el) => {
            el.addEventListener('click', () => {
              switchView('map');
              MapView.flyTo(parseFloat(el.dataset.lat), parseFloat(el.dataset.lon), 13);
              resultsBox.classList.remove('open');
              input.value = el.textContent.trim().split('\n')[0];
            });
          });
        }
        resultsBox.classList.add('open');
      }, 400);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.searchbox')) resultsBox.classList.remove('open');
    });
  }

  // ── Statut du serveur ───────────────────────────────────────────────────────

  async function checkHealth() {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const ok = await API.health();
    dot.className = 'status-dot ' + (ok ? 'ok' : 'ko');
    label.textContent = ok ? 'Serveur en ligne' : 'Serveur hors ligne';
  }

  // ── Bannière "bientôt disponible" & toast ───────────────────────────────────

  let bannerTimer = null;
  function showSoonBanner(title, text) {
    const banner = document.getElementById('soon-banner');
    document.getElementById('soon-banner-title').textContent = title + ' — bientôt disponible';
    document.getElementById('soon-banner-text').textContent = text;
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 6000);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  function init() {
    document.querySelectorAll('.topnav-item').forEach((btn) =>
      btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.getElementById('soon-banner-close').addEventListener('click', () =>
      document.getElementById('soon-banner').classList.remove('show'));

    bindSearch();
    MapView.init();

    // Liens profonds : ?view=stats ouvre une vue, ?usage=streaming sélectionne un usage
    const params = new URLSearchParams(location.search);
    const requested = params.get('view');
    if (requested && document.getElementById('view-' + requested)) switchView(requested);
    const usage = params.get('usage');
    if (usage) document.querySelector(`.usage-tab[data-usage="${usage}"]`)?.click();

    checkHealth();
    setInterval(checkHealth, 60_000);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { toast, showSoonBanner, switchView };
})();
