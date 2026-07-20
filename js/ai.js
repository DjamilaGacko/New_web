// ─── Vue Analyse IA : anomalies détectées + prévision de qualité ─────────────
// Consomme le micro-service IA via le proxy du backend : /api/ai/*

const AIView = (() => {
  let built = false;
  let forecastChart = null;

  const BASE = CONFIG.API_BASE_URL + '/api/ai';

  async function getJson(path) {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
    return res.json();
  }

  async function show() {
    if (built) return;
    built = true;
    await loadHealth();
    loadAnomalies();
  }

  // ── État du service + liste des opérateurs pour la prévision ───────────────

  async function loadHealth() {
    const statusEl = document.getElementById('ai-status');
    const mlEl = document.getElementById('ai-ml-ready');
    try {
      const h = await getJson('/health');
      statusEl.textContent = h.status === 'ok' ? 'En ligne'
        : h.status === 'training' ? 'Entraînement…' : 'Erreur';
      mlEl.textContent = h.mlReady ? 'Oui'
        : `Non (${h.samples}/${h.minSamplesForMl} mesures)`;

      const sel = document.getElementById('ai-forecast-operator');
      sel.innerHTML = '';
      (h.operators || []).forEach((op) => sel.add(new Option(op, op)));
      sel.addEventListener('change', () => loadForecast(sel.value));
      if (h.mlReady && sel.value) loadForecast(sel.value);
    } catch (e) {
      statusEl.textContent = 'Indisponible';
      mlEl.textContent = '–';
      App.toast('Service IA injoignable : ' + e.message);
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

    if (forecastChart) forecastChart.destroy();
    forecastChart = new Chart(document.getElementById('chart-forecast'), {
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
