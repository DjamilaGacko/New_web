// ─── Vue Comparer : cartes synchronisées par opérateur (style ARCEP) ─────────

const Compare = (() => {
  let built = false;
  const maps = [];
  let syncing = false;

  async function show() {
    if (built) {
      maps.forEach((m) => setTimeout(() => m.invalidateSize(), 60));
      return;
    }
    built = true;

    const grid = document.getElementById('compare-grid');
    let points = MapView.getPoints();
    if (!points.length) {
      try { points = await API.mapPoints() || []; } catch { points = []; }
    }

    // Statistiques agrégées par opérateur, on garde les 4 premiers
    let stats = [];
    try { stats = await API.operators() || []; } catch { /* calcul local en secours */ }
    if (!stats.length) {
      const byOp = {};
      points.forEach((p) => {
        const op = p.operator || 'Inconnu';
        (byOp[op] = byOp[op] || []).push(p);
      });
      stats = Object.entries(byOp).map(([operator, pts]) => ({
        operator,
        count: pts.length,
        avgDownload: pts.reduce((s, p) => s + (p.download || 0), 0) / pts.length,
        avgPing: pts.reduce((s, p) => s + (p.ping || 0), 0) / pts.length,
      }));
    }
    const top = stats.sort((a, b) => b.count - a.count).slice(0, 4);

    if (!top.length) {
      grid.innerHTML = '<div class="compare-empty">Aucune donnée opérateur disponible pour le moment.</div>';
      return;
    }

    grid.innerHTML = '';
    top.forEach((op, i) => {
      const cell = document.createElement('div');
      cell.className = 'compare-cell';
      cell.innerHTML = `
        <div class="compare-cell-head">
          <div class="op-name">
            <span class="op-dot" style="background:${operatorColor(op.operator)}"></span>${escapeHtml(op.operator)}
          </div>
          <div class="op-stats">
            <b>${(op.avgDownload || 0).toFixed(1)}</b> Mbps ↓ moy. · <b>${Math.round(op.avgPing || 0)}</b> ms · ${op.count} tests
          </div>
        </div>
        <div class="compare-map" id="compare-map-${i}"></div>`;
      grid.appendChild(cell);
    });

    top.forEach((op, i) => {
      const m = L.map(`compare-map-${i}`, { zoomControl: false, attributionControl: i === 0 })
        .setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM - 1);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);

      points
        .filter((p) => (p.operator || 'Inconnu') === op.operator && p.lat && p.lng)
        .forEach((p) => {
          const lvl = qualityLevel(p, 'debit');
          L.circleMarker([p.lat, p.lng], {
            radius: 6, weight: 2, color: '#fff',
            fillColor: qualityColor(lvl), fillOpacity: 0.95,
          })
            .bindPopup(`<b>${escapeHtml(p.download ?? '–')} Mbps ↓</b> · ${escapeHtml(p.ping ?? '–')} ms<br><small>${escapeHtml(p.location || '')}</small>`)
            .addTo(m);
        });

      // Synchronisation des cartes entre elles
      m.on('move', () => {
        if (syncing) return;
        syncing = true;
        maps.forEach((other) => {
          if (other !== m) other.setView(m.getCenter(), m.getZoom(), { animate: false });
        });
        syncing = false;
      });

      maps.push(m);
    });

    maps.forEach((m) => setTimeout(() => m.invalidateSize(), 60));
  }

  return { show };
})();
