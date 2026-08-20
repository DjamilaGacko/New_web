// ─── Vue Carte : carte plein écran style ARCEP ───────────────────────────────

const MapView = (() => {
  let map = null;
  let markersLayer = null;
  let heatLayer = null;
  let allPoints = [];

  const state = {
    usage: 'debit',
    operator: '',      // '' = tous
    tech: '',          // '' = toutes
    mode: 'points',    // points | heatmap
    base: 'plan',      // plan | satellite
    // Période : regroupe les moyennes par heure du jour / jour de semaine / semaine.
    // value = null → aucun filtre (toutes les valeurs), mais les popups de zone
    // affichent tout de même la ventilation selon `grain`.
    period: { grain: 'all', value: null },
  };

  // Rayon de regroupement, exprimé en PIXELS écran et non en mètres : le
  // regroupement suit donc le zoom. Il vaut plus que le diamètre maximal d'un
  // rond (46 px), ce qui garantit que deux ronds ne se chevauchent jamais.
  const CLUSTER_PX = 56;

  // Tous les ronds ont la même couleur : la carte indique où des mesures ont
  // été faites, pas un jugement de qualité (celui-ci reste dans le popup).
  const MARKER_COLOR = '#1c1c3c';

  const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  const baseLayers = {
    plan: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri — Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19,
    }),
  };

  // ── Initialisation ──────────────────────────────────────────────────────────

  function init() {
    map = L.map('main-map', { zoomControl: false })
      .setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    baseLayers.plan.addTo(map);
    markersLayer = L.layerGroup().addTo(map);

    // Le regroupement dépend du zoom : il faut le recalculer à chaque niveau.
    map.on('zoomend', render);

    bindControls();
    loadData();
  }

  // Bandeau d'attente : le premier appel peut être long si le backend
  // (offre gratuite Render) sort de veille. Sans ce retour visuel, la carte
  // reste vide sans explication pendant une minute.
  function setLoadingBanner(html) {
    let el = document.getElementById('map-loading');
    if (!html) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'map-loading';
      el.className = 'map-loading';
      document.getElementById('main-map').appendChild(el);
    }
    el.innerHTML = html;
  }

  async function loadData() {
    setLoadingBanner('Chargement des points de test…<small>Le serveur peut mettre '
      + 'jusqu\'à une minute à sortir de veille.</small>');
    try {
      allPoints = await API.mapPoints() || [];
      setLoadingBanner('');
    } catch (e) {
      allPoints = [];
      setLoadingBanner(`<b>Données indisponibles</b><small>${escapeHtml(e.message)}</small>`
        + '<button type="button" id="map-retry" class="btn-primary">Réessayer</button>');
      document.getElementById('map-retry')?.addEventListener('click', loadData);
    }
    buildOperatorChips();
    buildTechChips();
    render();
  }

  // ── Filtres ─────────────────────────────────────────────────────────────────

  function filteredPoints() {
    return allPoints.filter((p) =>
      (!state.operator || (p.operator || 'Inconnu') === state.operator) &&
      (!state.tech || (p.networkType || '').toUpperCase() === state.tech) &&
      timeMatch(p)
    );
  }

  // ── Période (heure / jour / semaine) ────────────────────────────────────────

  // parseTs / weekStartKey / weekLabel sont partagés avec la vue Opérateurs
  // et définis dans quality.js.

  // Renvoie la « valeur » d'un point pour un grain donné (ou null si date invalide).
  function grainValue(p, grain) {
    const d = parseTs(p.timestamp);
    if (isNaN(d)) return null;
    if (grain === 'hour') return d.getHours();
    if (grain === 'weekday') return d.getDay();
    if (grain === 'week') return weekStartKey(d);
    return null;
  }

  function grainValueLabel(grain, value) {
    if (grain === 'hour') return `${value}h`;
    if (grain === 'weekday') return WEEKDAYS[value];
    if (grain === 'week') return weekLabel(value);
    return String(value);
  }

  // Filtre un point selon la période sélectionnée.
  function timeMatch(p) {
    const { grain, value } = state.period;
    if (grain === 'all' || value == null) return true;
    const v = grainValue(p, grain);
    if (v == null) return false;
    return String(v) === String(value);
  }

  function buildOperatorChips() {
    const counts = {};
    allPoints.forEach((p) => {
      const op = p.operator || 'Inconnu';
      counts[op] = (counts[op] || 0) + 1;
    });
    const operators = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    const box = document.getElementById('operator-chips');
    box.innerHTML = '<button class="chip active" data-operator="">Tous</button>';
    operators.forEach((op) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.operator = op;
      chip.innerHTML = `<span class="chip-dot" style="background:${operatorColor(op)}"></span>${op}`;
      box.appendChild(chip);
    });

    box.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        box.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.operator = chip.dataset.operator;
        populatePeriodValues();
        render();
      });
    });

    // Alimente aussi les filtres de l'historique
    History.setOperators(operators);
  }

  function buildTechChips() {
    const techs = [...new Set(allPoints.map((p) => (p.networkType || '').toUpperCase()).filter(Boolean))]
      .sort();
    const box = document.getElementById('tech-chips');
    box.innerHTML = '<button class="chip active" data-tech="">Toutes</button>';
    techs.forEach((t) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.tech = t;
      chip.innerHTML = `<span class="chip-dot" style="background:${networkColor(t)}"></span>${t}`;
      box.appendChild(chip);
    });

    box.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        box.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.tech = chip.dataset.tech;
        populatePeriodValues();
        render();
      });
    });

    History.setNetworks(techs);
  }

  // ── Rendu ───────────────────────────────────────────────────────────────────

  function render() {
    markersLayer.clearLayers();
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

    const points = filteredPoints();

    if (state.mode === 'heatmap') {
      const usage = USAGES[state.usage];
      const heatData = points
        .filter((p) => p.lat && p.lng)
        .map((p) => {
          const lvl = qualityLevel(p, state.usage);
          // intensité 0..1 selon le niveau de qualité
          return [p.lat, p.lng, usage.available ? lvl / 4 : 0.4];
        });
      heatLayer = L.heatLayer(heatData, {
        radius: 28, blur: 22, maxZoom: 15,
        gradient: { 0.25: getCss('--q1'), 0.5: getCss('--q2'), 0.75: getCss('--q3'), 1.0: getCss('--q4') },
      }).addTo(map);
    } else {
      // Affichage par zones : les tests proches (≈ 10 m) sont regroupés en un
      // seul rond qui montre la moyenne de la zone.
      buildZones(points).forEach((zone) => {
        const marker = L.marker([zone.lat, zone.lng], { icon: zoneIcon(zone.count) });
        marker.bindPopup(zonePopupHtml(zone, zoneLevel(zone, state.usage)), { minWidth: 240 });
        markersLayer.addLayer(marker);
      });
    }
  }

  // ── Regroupement des tests en zones (rayon fixe à l'écran) ──────────────────

  // Regroupe les tests trop proches pour être distingués au zoom courant.
  // Le rond est ancré sur le point « graine » du groupe et non sur le
  // barycentre : par construction, deux graines sont distantes d'au moins
  // CLUSTER_PX pixels, ce qui interdit tout chevauchement. En zoomant, les
  // groupes se scindent d'eux-mêmes et le détail réapparaît.
  function buildZones(points) {
    const zoom = map.getZoom();
    const proj = points
      .filter((p) => p.lat && p.lng)
      .map((p) => ({ p, xy: map.project([p.lat, p.lng], zoom) }));

    // Tri nord → sud : rend le résultat stable d'un rendu à l'autre et permet
    // d'arrêter la recherche dès que l'écart vertical dépasse le rayon.
    proj.sort((a, b) => a.xy.y - b.xy.y || a.xy.x - b.xy.x);

    const taken = new Array(proj.length).fill(false);
    const zones = [];

    for (let i = 0; i < proj.length; i++) {
      if (taken[i]) continue;
      taken[i] = true;
      const seed = proj[i];
      const group = [seed.p];

      for (let j = i + 1; j < proj.length; j++) {
        const dy = proj[j].xy.y - seed.xy.y;
        if (dy > CLUSTER_PX) break; // trié par y : plus rien ne peut correspondre
        if (taken[j]) continue;
        const dx = proj[j].xy.x - seed.xy.x;
        if (dx * dx + dy * dy <= CLUSTER_PX * CLUSTER_PX) {
          taken[j] = true;
          group.push(proj[j].p);
        }
      }

      zones.push(makeZone(seed.p, group));
    }
    return zones;
  }

  function makeZone(seed, pts) {
    const n = pts.length;
    const sum = (fn) => pts.reduce((s, p) => s + (fn(p) || 0), 0);
    // Nom de la zone = lieu le plus fréquent parmi ses tests.
    const locCounts = {};
    pts.forEach((p) => { if (p.location) locCounts[p.location] = (locCounts[p.location] || 0) + 1; });
    const name = Object.keys(locCounts).sort((a, b) => locCounts[b] - locCounts[a])[0] || 'Zone de test';
    return {
      lat: seed.lat,
      lng: seed.lng,
      count: n,
      name,
      points: pts,
      avgDl: sum((p) => p.download) / n,
      avgUl: sum((p) => p.upload) / n,
      avgPing: sum((p) => p.ping) / n,
    };
  }

  // Niveau de qualité d'une zone : moyenne de la métrique de l'usage courant.
  function zoneLevel(zone, usageKey) {
    const usage = USAGES[usageKey];
    if (!usage || !usage.available) return 0;
    const vals = zone.points.map((p) => usage.metric(p)).filter((v) => v != null && !isNaN(v));
    if (!vals.length) return 0;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    for (const l of usage.levels) if (l.test(mean)) return l.level;
    return 1;
  }

  // Rond de zone : taille croissante avec le nombre de tests, chiffre au centre.
  function zoneIcon(count) {
    const size = Math.round(Math.min(46, 20 + Math.log2(count + 1) * 5));
    return L.divIcon({
      className: 'yele-zone-marker',
      html: `<div class="yele-zone" style="width:${size}px;height:${size}px;background:${MARKER_COLOR}">${count > 1 ? count : ''}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  // Ventilation des débits ↓ d'une zone selon un grain (heure / jour / semaine).
  // Retourne des lignes { key, label, avgDl, count } triées.
  function zoneBreakdown(zone, grain) {
    const g = grain === 'all' ? 'weekday' : grain; // par défaut, on ventile par jour
    const groups = {};
    zone.points.forEach((p) => {
      const v = grainValue(p, g);
      if (v == null) return;
      (groups[v] = groups[v] || []).push(p);
    });
    const rows = Object.keys(groups).map((k) => {
      const pts = groups[k];
      return {
        key: k,
        label: grainValueLabel(g, g === 'hour' ? Number(k) : k),
        avgDl: pts.reduce((s, p) => s + (p.download || 0), 0) / pts.length,
        count: pts.length,
      };
    });
    // Tri : chronologique pour heure/semaine, ordre Lun→Dim pour le jour.
    if (g === 'hour') rows.sort((a, b) => Number(a.key) - Number(b.key));
    else if (g === 'weekday') rows.sort((a, b) => ((Number(a.key) + 6) % 7) - ((Number(b.key) + 6) % 7));
    else rows.sort((a, b) => (a.key < b.key ? -1 : 1));
    return { grain: g, rows };
  }

  function zonePopupHtml(zone, lvl) {
    const grainNames = { hour: 'heure', weekday: 'jour', week: 'semaine' };
    const bd = zoneBreakdown(zone, state.period.grain);
    const maxDl = Math.max(...bd.rows.map((r) => r.avgDl), 1);
    const breakdownRows = bd.rows.map((r) => `
      <div class="zbd-row">
        <span class="zbd-label">${escapeHtml(r.label)}</span>
        <span class="zbd-track"><i style="width:${(r.avgDl / maxDl) * 100}%"></i></span>
        <span class="zbd-val">${r.avgDl.toFixed(1)}<small> · ${r.count}×</small></span>
      </div>`).join('');

    return `
      <div class="popup-yele">
        <div class="popup-op">
          <b>${escapeHtml(zone.name)}</b>
          <span class="popup-net" style="background:#334155">${zone.count} test${zone.count > 1 ? 's' : ''}</span>
        </div>
        <div class="popup-quality">
          ${qualityLabel(lvl, state.usage)} <small style="color:var(--text-soft,#5d6478)">(moyenne de la zone)</small>
        </div>
        <div class="popup-metrics">
          <div class="popup-metric"><b>${zone.avgDl.toFixed(1)}</b><span>Mbps ↓ moy.</span></div>
          <div class="popup-metric"><b>${zone.avgUl.toFixed(1)}</b><span>Mbps ↑ moy.</span></div>
          <div class="popup-metric"><b>${Math.round(zone.avgPing)}</b><span>ms moy.</span></div>
        </div>
        <div class="zbd-title">Débit ↓ moyen par ${grainNames[bd.grain]}</div>
        <div class="zbd">${breakdownRows || '<div class="zbd-empty">Données horodatées indisponibles.</div>'}</div>
      </div>`;
  }

  // ── Contrôles ───────────────────────────────────────────────────────────────

  function bindControls() {
    // Usages
    document.querySelectorAll('#usage-tabs .usage-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const key = tab.dataset.usage;
        const usage = USAGES[key];
        if (!usage.available) {
          App.showSoonBanner(usage.label, usage.soonText);
          return;
        }
        document.querySelectorAll('#usage-tabs .usage-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        state.usage = key;
        render();
      });
    });

    // Mode d'affichage points / heatmap
    document.querySelectorAll('#display-mode .toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#display-mode .toggle').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        render();
      });
    });

    // Fond de plan
    document.querySelectorAll('#basemap-mode .toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#basemap-mode .toggle').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        map.removeLayer(baseLayers[state.base]);
        state.base = btn.dataset.base;
        baseLayers[state.base].addTo(map);
      });
    });

    // Période (grain heure / jour / semaine)
    bindPeriod();

    // Repli du panneau de filtres, pour dégager la carte.
    const panel = document.getElementById('control-panel');
    const toggle = document.getElementById('panel-toggle');
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = collapsed ? 'Afficher les filtres' : 'Replier les filtres';
    });

    // Géolocalisation du navigateur
    document.getElementById('locate-btn').addEventListener('click', () => {
      if (!navigator.geolocation) return App.toast('Géolocalisation non disponible');
      navigator.geolocation.getCurrentPosition(
        (pos) => map.flyTo([pos.coords.latitude, pos.coords.longitude], 13),
        () => App.toast('Position introuvable — vérifiez les autorisations')
      );
    });
  }

  function bindPeriod() {
    document.querySelectorAll('#period-grain .toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#period-grain .toggle').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.period.grain = btn.dataset.grain;
        state.period.value = null;
        populatePeriodValues();
        render();
      });
    });
    document.getElementById('period-value').addEventListener('change', (e) => {
      state.period.value = e.target.value === '' ? null : e.target.value;
      render();
    });
  }

  // Remplit le <select> des valeurs disponibles selon le grain choisi.
  function populatePeriodValues() {
    const sel = document.getElementById('period-value');
    const grain = state.period.grain;
    if (grain === 'all') { sel.style.display = 'none'; return; }

    // Valeurs réellement présentes dans les données (après filtres opérateur/tech).
    const base = allPoints.filter((p) =>
      (!state.operator || (p.operator || 'Inconnu') === state.operator) &&
      (!state.tech || (p.networkType || '').toUpperCase() === state.tech));
    const values = [...new Set(base.map((p) => grainValue(p, grain)).filter((v) => v != null))];
    if (grain === 'hour') values.sort((a, b) => a - b);
    else if (grain === 'weekday') values.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    else values.sort((a, b) => (a > b ? -1 : 1)); // semaines : plus récentes d'abord

    const previous = state.period.value;
    const allLabel = { hour: 'Toutes les heures', weekday: 'Tous les jours', week: 'Toutes les semaines' }[grain];
    sel.innerHTML = `<option value="">${allLabel}</option>`
      + values.map((v) => `<option value="${v}">${grainValueLabel(grain, v)}</option>`).join('');
    // Conserve la sélection si elle est toujours disponible, sinon revient à « tout ».
    const keep = previous != null && values.map(String).includes(String(previous));
    sel.value = keep ? previous : '';
    state.period.value = keep ? previous : null;
    sel.style.display = '';
  }

  function flyTo(lat, lng, zoom = 13) {
    if (map) map.flyTo([lat, lng], zoom);
  }

  function invalidate() {
    if (map) setTimeout(() => map.invalidateSize(), 60);
  }

  return { init, flyTo, invalidate, getPoints: () => allPoints };
})();
