// ─── Vue Opérateurs : tableau comparatif période × opérateur × lieu ──────────
// Agrège côté client les points de /api/dashboard/map. Chaque ligne regroupe
// les tests d'un opérateur, sur une période (jour / semaine / tout) et en un
// lieu donné, et affiche les débits moyens mesurés.

const Operators = (() => {
  const PAGE_STEP = 100;

  let built = false;
  let points = [];
  let rows = [];            // lignes agrégées, avant tri
  let shown = PAGE_STEP;    // nombre de lignes affichées

  const state = {
    grain: 'day',           // day | week | all
    operator: '',           // '' = tous
    tech: '',               // '' = toutes
    sort: 'periodKey',
    dir: 'desc',
  };

  // Colonnes triables : clé de tri + type (texte ou nombre).
  const SORTABLE = {
    periodKey: 'text', operator: 'text', count: 'num',
    avgDl: 'num', avgUl: 'num', avgPing: 'num', location: 'text',
  };

  // ── Chargement ──────────────────────────────────────────────────────────────

  async function show() {
    if (built) return;
    built = true;

    const tbody = document.querySelector('#operators-table tbody');
    tbody.innerHTML = '<tr><td colspan="8" style="color:#5d6478">Chargement…</td></tr>';

    points = MapView.getPoints();
    if (!points.length) {
      try { points = await API.mapPoints() || []; } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:#e0492f">Erreur : ${escapeHtml(e.message)}</td></tr>`;
        return;
      }
    }

    buildFilters();
    bind();
    refresh();
  }

  // ── Filtres ─────────────────────────────────────────────────────────────────

  function buildFilters() {
    const operators = [...new Set(points.map((p) => p.operator || 'Inconnu'))].sort();
    const opSel = document.getElementById('op-filter-operator');
    opSel.length = 1;
    operators.forEach((o) => opSel.add(new Option(o, o)));

    const techs = [...new Set(points.map((p) => (p.networkType || '').toUpperCase()).filter(Boolean))].sort();
    const techSel = document.getElementById('op-filter-tech');
    techSel.length = 1;
    techs.forEach((t) => techSel.add(new Option(t, t)));
  }

  function filtered() {
    return points.filter((p) =>
      (!state.operator || (p.operator || 'Inconnu') === state.operator) &&
      (!state.tech || (p.networkType || '').toUpperCase() === state.tech));
  }

  // ── Agrégation ──────────────────────────────────────────────────────────────

  // Clé + libellé de la période d'un point selon la granularité choisie.
  function periodOf(p) {
    if (state.grain === 'all') return { key: '', label: 'Toutes dates' };
    const d = parseTs(p.timestamp);
    if (isNaN(d)) return { key: '', label: 'Date inconnue' };
    if (state.grain === 'week') {
      const key = weekStartKey(d);
      return { key, label: weekLabel(key) };
    }
    return {
      key: dayKey(d),
      label: d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
    };
  }

  // Une ligne = (période, opérateur, lieu). Les tests sans `location` sont
  // regroupés sous « Lieu non renseigné » plutôt que d'être écartés.
  function aggregate() {
    const groups = {};
    filtered().forEach((p) => {
      const period = periodOf(p);
      const operator = p.operator || 'Inconnu';
      const location = p.location || 'Lieu non renseigné';
      const key = `${period.key}|${operator}|${location}`;
      (groups[key] = groups[key] || { period, operator, location, pts: [] }).pts.push(p);
    });

    return Object.values(groups).map((g) => {
      const n = g.pts.length;
      const mean = (fn) => g.pts.reduce((s, p) => s + (Number(fn(p)) || 0), 0) / n;
      const geo = g.pts.filter((p) => p.lat && p.lng);

      // Technologie la plus représentée dans le groupe.
      const techCounts = {};
      g.pts.forEach((p) => {
        const t = (p.networkType || '').toUpperCase();
        if (t) techCounts[t] = (techCounts[t] || 0) + 1;
      });
      const tech = Object.keys(techCounts).sort((a, b) => techCounts[b] - techCounts[a])[0] || '';

      return {
        periodKey: g.period.key,
        periodLabel: g.period.label,
        operator: g.operator,
        location: g.location,
        count: n,
        avgDl: mean((p) => p.download),
        avgUl: mean((p) => p.upload),
        avgPing: mean((p) => p.ping),
        tech,
        // Centre géographique des tests du groupe, pour le renvoi vers la carte.
        lat: geo.length ? geo.reduce((s, p) => s + p.lat, 0) / geo.length : null,
        lng: geo.length ? geo.reduce((s, p) => s + p.lng, 0) / geo.length : null,
      };
    });
  }

  function sortRows(list) {
    const type = SORTABLE[state.sort] || 'num';
    const sign = state.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[state.sort];
      const vb = b[state.sort];
      const cmp = type === 'text'
        ? String(va).localeCompare(String(vb), 'fr')
        : (Number(va) || 0) - (Number(vb) || 0);
      // Départage par débit décroissant pour que les ex æquo restent lisibles.
      return cmp !== 0 ? cmp * sign : b.avgDl - a.avgDl;
    });
  }

  // ── Rendu ───────────────────────────────────────────────────────────────────

  function refresh() {
    rows = aggregate();
    shown = PAGE_STEP;
    renderSummary();
    renderTable();
  }

  function renderSummary() {
    const tests = rows.reduce((s, r) => s + r.count, 0);
    document.getElementById('op-kpi-rows').textContent = rows.length.toLocaleString('fr-FR');
    document.getElementById('op-kpi-tests').textContent = tests.toLocaleString('fr-FR');

    // Meilleur opérateur = plus haut débit ↓ moyen, pondéré par le nombre de tests.
    const byOp = {};
    rows.forEach((r) => {
      const acc = byOp[r.operator] = byOp[r.operator] || { sum: 0, count: 0 };
      acc.sum += r.avgDl * r.count;
      acc.count += r.count;
    });
    const best = Object.entries(byOp)
      .map(([operator, a]) => ({ operator, avg: a.sum / a.count }))
      .sort((a, b) => b.avg - a.avg)[0];

    const el = document.getElementById('op-kpi-best');
    if (!best) { el.textContent = '–'; return; }
    el.innerHTML = `<span style="color:${operatorColor(best.operator)}">${escapeHtml(best.operator)}</span>`
      + `<small> ${best.avg.toFixed(1)} Mbps</small>`;
  }

  function renderTable() {
    const tbody = document.querySelector('#operators-table tbody');
    const sorted = sortRows(rows);
    const visible = sorted.slice(0, shown);

    if (!visible.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:#5d6478">Aucune mesure pour ces filtres.</td></tr>';
      document.getElementById('op-more-wrap').style.display = 'none';
      return;
    }

    // Échelle des barres de débit : le maximum de la page affichée.
    const maxDl = Math.max(...visible.map((r) => r.avgDl), 1);

    tbody.innerHTML = visible.map((r) => {
      const lvl = qualityLevel({ download: r.avgDl }, 'debit');
      const net = r.tech
        ? `<span class="net-badge" style="background:${networkColor(r.tech)}">${escapeHtml(r.tech)}</span>` : '–';
      const geo = r.lat != null
        ? `<button class="geo-link" data-lat="${r.lat}" data-lng="${r.lng}" title="Voir sur la carte">
             ${escapeHtml(r.location)}<small>${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</small>
           </button>`
        : `<span class="geo-none">${escapeHtml(r.location)}</span>`;

      return `
        <tr>
          <td class="op-period">${escapeHtml(r.periodLabel)}</td>
          <td><b style="color:${operatorColor(r.operator)}">${escapeHtml(r.operator)}</b></td>
          <td>${r.count}</td>
          <td class="op-dl">
            <div class="op-bar">
              <span class="op-bar-fill" style="width:${(r.avgDl / maxDl) * 100}%;background:${qualityColor(lvl)}"></span>
            </div>
            <b>${r.avgDl.toFixed(1)}</b>
          </td>
          <td>${r.avgUl.toFixed(1)}</td>
          <td>${Math.round(r.avgPing)} ms</td>
          <td>${net}</td>
          <td class="op-geo">${geo}</td>
        </tr>`;
    }).join('');

    // En-têtes : indicateur de tri sur la colonne active.
    document.querySelectorAll('#operators-table th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === state.sort;
      th.classList.toggle('sorted', active);
      th.dataset.dir = active ? state.dir : '';
    });

    const moreWrap = document.getElementById('op-more-wrap');
    moreWrap.style.display = sorted.length > shown ? '' : 'none';
    document.getElementById('op-more-info').textContent =
      `${visible.length} ligne${visible.length > 1 ? 's' : ''} sur ${sorted.length}`;
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  function bind() {
    document.querySelectorAll('#op-grain .toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#op-grain .toggle').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.grain = btn.dataset.grain;
        refresh();
      });
    });

    document.getElementById('op-filter-operator').addEventListener('change', (e) => {
      state.operator = e.target.value;
      refresh();
    });
    document.getElementById('op-filter-tech').addEventListener('change', (e) => {
      state.tech = e.target.value;
      refresh();
    });

    // Tri par clic sur l'en-tête ; deuxième clic inverse le sens.
    document.querySelectorAll('#operators-table th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort === key) {
          state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = key;
          // Texte : A→Z d'abord. Nombres : plus grand d'abord.
          state.dir = SORTABLE[key] === 'text' ? 'asc' : 'desc';
        }
        shown = PAGE_STEP;
        renderTable();
      });
    });

    document.getElementById('op-more').addEventListener('click', () => {
      shown += PAGE_STEP;
      renderTable();
    });

    // Délégation : le bouton de localisation renvoie à la carte, centrée
    // sur le barycentre des tests de la ligne.
    document.querySelector('#operators-table tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('.geo-link');
      if (!btn) return;
      App.switchView('map');
      MapView.flyTo(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lng), 15);
    });
  }

  return { show };
})();
