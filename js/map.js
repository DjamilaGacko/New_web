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

  // Rayon de regroupement des tests en « zones » (≈ 10 m autour d'un lieu).
  const ZONE_CELL_M = 12;

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

    map.on('moveend', renderZoneStats);

    bindControls();
    loadData();
  }

  async function loadData() {
    try {
      allPoints = await API.mapPoints() || [];
    } catch (e) {
      App.toast('Impossible de charger les points de test : ' + e.message);
      allPoints = [];
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

  // Clé de semaine = date (YYYY-MM-DD) du lundi de la semaine du point.
  function weekStartKey(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const isoDay = (x.getDay() + 6) % 7; // 0 = lundi
    x.setDate(x.getDate() - isoDay);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  function weekLabel(key) {
    const [y, m, d] = key.split('-');
    return `Sem. du ${d}/${m}`;
  }

  // Renvoie la « valeur » d'un point pour un grain donné (ou null si date invalide).
  function grainValue(p, grain) {
    const d = new Date(p.timestamp);
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
        const lvl = zoneLevel(zone, state.usage);
        const marker = L.marker([zone.lat, zone.lng], { icon: zoneIcon(qualityColor(lvl), zone.count) });
        marker.bindPopup(zonePopupHtml(zone, lvl), { minWidth: 240 });
        markersLayer.addLayer(marker);
      });
    }

    renderZoneStats();
  }

  // ── Regroupement des tests en zones (grille ≈ 10 m) ─────────────────────────

  function buildZones(points) {
    const cells = {};
    points.forEach((p) => {
      if (!p.lat || !p.lng) return;
      const mPerDegLat = 111320;
      const mPerDegLng = 111320 * Math.cos((p.lat * Math.PI) / 180);
      const row = Math.round(p.lat / (ZONE_CELL_M / mPerDegLat));
      const col = Math.round(p.lng / (ZONE_CELL_M / mPerDegLng));
      const key = `${row}:${col}`;
      (cells[key] = cells[key] || []).push(p);
    });

    return Object.values(cells).map((pts) => {
      const n = pts.length;
      const sum = (fn) => pts.reduce((s, p) => s + (fn(p) || 0), 0);
      // Nom de la zone = lieu le plus fréquent parmi ses tests.
      const locCounts = {};
      pts.forEach((p) => { if (p.location) locCounts[p.location] = (locCounts[p.location] || 0) + 1; });
      const name = Object.keys(locCounts).sort((a, b) => locCounts[b] - locCounts[a])[0] || 'Zone de test';
      return {
        lat: sum((p) => p.lat) / n,
        lng: sum((p) => p.lng) / n,
        count: n,
        name,
        points: pts,
        avgDl: sum((p) => p.download) / n,
        avgUl: sum((p) => p.upload) / n,
        avgPing: sum((p) => p.ping) / n,
      };
    });
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
  function zoneIcon(color, count) {
    const size = Math.round(Math.min(46, 20 + Math.log2(count + 1) * 5));
    return L.divIcon({
      className: 'yele-zone-marker',
      html: `<div class="yele-zone" style="width:${size}px;height:${size}px;background:${color}">${count > 1 ? count : ''}</div>`,
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
        <span class="zbd-track"><i style="width:${(r.avgDl / maxDl) * 100}%;background:#0e7a4a"></i></span>
        <span class="zbd-val">${r.avgDl.toFixed(1)}<small> · ${r.count}×</small></span>
      </div>`).join('');

    return `
      <div class="popup-yele">
        <div class="popup-op">
          <b>${escapeHtml(zone.name)}</b>
          <span class="popup-net" style="background:#334155">${zone.count} test${zone.count > 1 ? 's' : ''}</span>
        </div>
        <div class="popup-quality">
          <i style="background:${qualityColor(lvl)}"></i>${qualityLabel(lvl, state.usage)} <small style="color:var(--text-soft,#5d6478)">(moyenne de la zone)</small>
        </div>
        <div class="popup-metrics">
          <div class="popup-metric"><b style="color:#1d4ed8">${zone.avgDl.toFixed(1)}</b><span>Mbps ↓ moy.</span></div>
          <div class="popup-metric"><b style="color:#ea580c">${zone.avgUl.toFixed(1)}</b><span>Mbps ↑ moy.</span></div>
          <div class="popup-metric"><b style="color:#d97706">${Math.round(zone.avgPing)}</b><span>ms moy.</span></div>
        </div>
        <div class="zbd-title">Débit ↓ moyen par ${grainNames[bd.grain]}</div>
        <div class="zbd">${breakdownRows || '<div class="zbd-empty">Données horodatées indisponibles.</div>'}</div>
      </div>`;
  }

  // ── Statistiques de zone (panneau droit, style ARCEP) ──────────────────────

  function renderZoneStats() {
    if (!map) return;

    // Rappel de la période sélectionnée dans le sous-titre du panneau.
    const sub = document.getElementById('zone-sub');
    if (sub) {
      const { grain, value } = state.period;
      sub.textContent = grain === 'all' || value == null
        ? 'Zone visible sur la carte'
        : `Zone visible · ${grainValueLabel(grain, grain === 'hour' ? Number(value) : value)}`;
    }

    const bounds = map.getBounds();
    const visible = filteredPoints().filter((p) => p.lat && p.lng && bounds.contains([p.lat, p.lng]));

    const fmt = (v) => (visible.length ? v.toFixed(1) : '–');
    const avg = (key) => visible.reduce((s, p) => s + (p[key] || 0), 0) / (visible.length || 1);

    document.getElementById('zk-count').textContent = visible.length || '–';
    document.getElementById('zk-dl').textContent = fmt(avg('download'));
    document.getElementById('zk-ul').textContent = fmt(avg('upload'));
    document.getElementById('zk-ping').textContent = visible.length ? Math.round(avg('ping')) : '–';

    // Répartition par niveau de qualité
    const usage = USAGES[state.usage];
    const barBox = document.getElementById('zone-quality-bar');
    const legBox = document.getElementById('zone-quality-legend');
    if (!usage.available || !visible.length) {
      barBox.innerHTML = `<div style="width:100%;background:${qualityColor(0)};opacity:.35"></div>`;
      legBox.innerHTML = '';
    } else {
      const counts = { 4: 0, 3: 0, 2: 0, 1: 0 };
      visible.forEach((p) => { counts[qualityLevel(p, state.usage)]++; });
      barBox.innerHTML = [4, 3, 2, 1]
        .filter((l) => counts[l] > 0)
        .map((l) => `<div style="width:${(counts[l] / visible.length) * 100}%;background:${qualityColor(l)}"></div>`)
        .join('');
      legBox.innerHTML = [4, 3, 2, 1]
        .filter((l) => counts[l] > 0)
        .map((l) => `<span><i style="background:${qualityColor(l)}"></i>${qualityLabel(l, state.usage)} : ${Math.round((counts[l] / visible.length) * 100)}%</span>`)
        .join('');
    }

    // Comparaison opérateurs dans la zone
    const opBox = document.getElementById('zone-operators');
    const byOp = {};
    visible.forEach((p) => {
      const op = p.operator || 'Inconnu';
      (byOp[op] = byOp[op] || []).push(p);
    });
    const ops = Object.entries(byOp)
      .map(([op, pts]) => ({
        op,
        count: pts.length,
        avgDl: pts.reduce((s, p) => s + (p.download || 0), 0) / pts.length,
      }))
      .sort((a, b) => b.avgDl - a.avgDl);

    if (!ops.length) {
      opBox.innerHTML = '<div class="zone-empty">Aucun test dans la zone visible.</div>';
      return;
    }
    const maxDl = Math.max(...ops.map((o) => o.avgDl), 1);
    opBox.innerHTML = ops.map((o) => `
      <div class="zone-op">
        <div class="zone-op-head">
          <b style="color:${operatorColor(o.op)}">${o.op}</b>
          <span>${o.avgDl.toFixed(1)} Mbps · ${o.count} test${o.count > 1 ? 's' : ''}</span>
        </div>
        <div class="zone-op-track">
          <div class="zone-op-fill" style="width:${(o.avgDl / maxDl) * 100}%;background:${operatorColor(o.op)}"></div>
        </div>
      </div>`).join('');
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

    // Repli du panneau de zone
    document.getElementById('zone-collapse').addEventListener('click', () => {
      document.getElementById('zone-panel').classList.toggle('collapsed');
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
