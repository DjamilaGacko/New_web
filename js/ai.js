// ─── Vue Analyse IA : anomalies détectées + prévision de qualité ─────────────
// Consomme le micro-service IA via le proxy du backend : /api/ai/*

const AIView = (() => {
  let built = false;
  let forecastChart = null;

  const BASE = CONFIG.API_BASE_URL + '/api/ai';

  async function getJson(path) {
    // 120 s : le service gratuit (Render) s'endort et peut mettre ~60-90 s à
    // se réveiller au premier appel. En dessous, le chargement échouait.
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
    return res.json();
  }

  async function show() {
    if (built) return;
    built = true;
    // Message d'attente pendant le réveil éventuel du service.
    const wrap = document.querySelector('#chart-forecast')?.closest('.chart-wrap');
    if (wrap) {
      wrap.innerHTML = '<div style="display:flex;height:100%;align-items:center;'
        + 'justify-content:center;text-align:center;color:#5d6478;font-size:13px;'
        + 'padding:0 20px;line-height:1.5">Chargement du service IA…<br>'
        + '<span style="color:#9aa3b2">(le premier appel peut prendre jusqu\'à 1 min)</span></div>';
    }
    await loadHealth();
    loadAnomalies();
  }

  // ── État du service + liste des opérateurs pour la prévision ───────────────

  async function loadHealth() {
    try {
      const h = await getJson('/health');
      const sel = document.getElementById('ai-forecast-operator');
      sel.innerHTML = '';
      (h.operators || []).forEach((op) => sel.add(new Option(op, op)));
      sel.addEventListener('change', () => loadForecast(sel.value));
      if (h.mlReady && sel.value) loadForecast(sel.value);
    } catch (e) {
      // État vide clair plutôt qu'un grand cadre blanc.
      const wrap = document.querySelector('#chart-forecast')?.closest('.chart-wrap');
      if (wrap) {
        wrap.innerHTML = '<div style="display:flex;height:100%;align-items:center;'
          + 'justify-content:center;text-align:center;color:#9aa3b2;font-size:13px;'
          + 'padding:0 20px;line-height:1.5">Le micro-service IA temps réel n\'est pas '
          + 'déployé.<br>Les performances des modèles (ci-dessus) restent visibles.</div>';
      }
    }
  }

  // ── Tableau des anomalies ───────────────────────────────────────────────────

  function severityColor(s) {
    if (s >= 70) return '#dc2626';
    if (s >= 40) return '#ea580c';
    return '#ca8a04';
  }

  async function loadAnomalies() {
    const tbody = document.querySelector('#ai-anomalies-table tbody');
    tbody.innerHTML = '<tr><td colspan="7" style="color:#5d6478">Analyse en cours…</td></tr>';
    let data;
    try {
      data = await getJson('/anomalies?days=30&limit=100');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:#e0492f">Erreur : ${escapeHtml(e.message)}</td></tr>`;
      return;
    }

    document.getElementById('ai-analyzed').textContent =
      (data.analyzed ?? 0).toLocaleString('fr-FR');
    document.getElementById('ai-anomaly-count').textContent =
      (data.anomalies?.length ?? 0).toLocaleString('fr-FR');

    if (!data.anomalies?.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:#5d6478">Aucune anomalie détectée sur la période. ✓</td></tr>';
      return;
    }

    tbody.innerHTML = data.anomalies.map((a) => {
      const date = a.timestamp
        ? new Date(a.timestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '–';
      const net = a.networkType
        ? `<span class="net-badge" style="background:${networkColor(a.networkType)}">${escapeHtml(a.networkType)}</span>` : '–';
      const color = severityColor(a.severity);
      return `
        <tr>
          <td>${date}</td>
          <td><b style="color:${operatorColor(a.operator)}">${escapeHtml(a.operator || 'Inconnu')}</b></td>
          <td>${net}</td>
          <td><b>${escapeHtml(a.download ?? '–')}</b></td>
          <td>${escapeHtml(a.ping ?? '–')} ms</td>
          <td><span class="q-pill" style="background:${color}22;color:${color}"><i style="background:${color}"></i>${a.severity}/100</span></td>
          <td style="max-width:420px">${(a.reasons || []).map(escapeHtml).join('<br>')}</td>
        </tr>`;
    }).join('');
  }

  // ── Courbe de prévision ─────────────────────────────────────────────────────

  async function loadForecast(operator) {
    if (!operator) return;
    let data;
    try {
      data = await getJson(`/forecast?operator=${encodeURIComponent(operator)}&hours=48`);
    } catch {
      return;
    }
    const points = data.forecast || [];
    if (!points.length) return;

    const labels = points.map((p) =>
      new Date(p.time).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit' }));

    // Le canvas a pu être remplacé par un message de chargement : on le rétablit.
    const wrap = document.querySelector('#view-ai .chart-wrap');
    let canvas = document.getElementById('chart-forecast');
    if (!canvas && wrap) {
      wrap.innerHTML = '<canvas id="chart-forecast"></canvas>';
      canvas = document.getElementById('chart-forecast');
    }
    if (forecastChart) forecastChart.destroy();
    forecastChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `Débit ↓ prédit (Mbps) — ${operator}`,
          data: points.map((p) => p.predictedDownload),
          borderColor: '#0e7a4a',
          backgroundColor: 'rgba(14, 122, 74, .12)',
          fill: true, tension: .35, pointRadius: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Mbps' } } },
      },
    });
  }

  return { show };
})();
