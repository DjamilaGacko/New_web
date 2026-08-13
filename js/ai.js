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
    renderEvalCharts();
    await loadHealth();
    loadAnomalies();
  }

  // ── Graphiques d'évaluation (résultats statiques de evaluate.py) ────────────
  // Chiffres finaux : TabPFN 2.2.1 + seuils de détection corrigés, sur 120 mesures.

  const GREEN = '#0e7a4a', RED = '#dc2626', ORANGE = '#ea580c', GREY = '#9aa3b2';

  function renderEvalCharts() {
    const grid = { color: 'rgba(0,0,0,.05)' };

    // 1) Progression de la détection : 3 métriques × 3 étapes
    new Chart(document.getElementById('chart-eval-progress'), {
      type: 'bar',
      data: {
        labels: ['ROC-AUC', 'F1-score', 'PR-AUC'],
        datasets: [
          { label: 'Départ (Gradient Boosting)', data: [0.592, 0.309, 0.253], backgroundColor: GREY },
          { label: 'TabPFN', data: [0.661, 0.450, 0.301], backgroundColor: '#7cc4a4' },
          { label: 'TabPFN + seuils corrigés', data: [0.830, 0.559, 0.476], backgroundColor: GREEN },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 1, grid, ticks: { stepSize: 0.2 } },
                  x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      },
    });

    // 2) Skill score par pli de validation croisée (prédiction)
    const skills = [0.121, -0.040, 0.022, 0.157];
    new Chart(document.getElementById('chart-eval-skill'), {
      type: 'bar',
      data: {
        labels: ['Pli 1', 'Pli 2', 'Pli 3', 'Pli 4'],
        datasets: [{
          label: 'Skill score',
          data: skills,
          backgroundColor: skills.map((s) => (s >= 0 ? GREEN : RED)),
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `Skill : ${c.raw >= 0 ? '+' : ''}${c.raw.toFixed(3)}` } },
        },
        scales: {
          y: { grid, title: { display: true, text: '← moins bon   |   meilleur →' },
               ticks: { callback: (v) => (v > 0 ? '+' : '') + v } },
          x: { grid: { display: false } },
        },
      },
    });

    // 3) Apport de chaque niveau de détection (doughnut)
    new Chart(document.getElementById('chart-eval-levels'), {
      type: 'doughnut',
      data: {
        labels: ['Contextuel (résidu)', 'Statistique (percentile)', 'Isolation Forest'],
        datasets: [{ data: [74, 21, 5], backgroundColor: [GREEN, ORANGE, '#3b82f6'] }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.label} : ${c.raw}%` } },
        },
      },
    });

    // 4) Précision@k
    new Chart(document.getElementById('chart-eval-precisionk'), {
      type: 'line',
      data: {
        labels: ['Top 5', 'Top 10', 'Top 20', 'Top 50'],
        datasets: [{
          label: 'Part de vraies anomalies',
          data: [0.80, 0.70, 0.80, 0.68],
          borderColor: GREEN, backgroundColor: 'rgba(14,122,74,.12)',
          fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: GREEN,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
                   tooltip: { callbacks: { label: (c) => `${Math.round(c.raw * 100)}% de vraies anomalies` } } },
        scales: { y: { beginAtZero: true, max: 1, grid, ticks: { callback: (v) => Math.round(v * 100) + '%' } },
                  x: { grid: { display: false } } },
      },
    });
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
