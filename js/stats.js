// ─── Vue Statistiques : KPIs, graphiques, percentiles ────────────────────────

const Stats = (() => {
  let built = false;
  let timelineChart = null;
  let operatorsChart = null;
  let networkChart = null;

  const fontStack = "'Inter', system-ui, sans-serif";

  async function show() {
    if (built) return;
    built = true;
    Chart.defaults.font.family = fontStack;
    Chart.defaults.color = '#5d6478';

    loadSummary();
    loadTimeline(30);
    loadOperators();
    loadNetworkDistribution();
    loadAdvanced();
    bindTimelineToggle();
  }

  async function loadSummary() {
    try {
      const s = await API.summary();
      document.getElementById('kpi-total').textContent = (s.totalTests ?? 0).toLocaleString('fr-FR');
      document.getElementById('kpi-today').textContent = (s.testsToday ?? 0).toLocaleString('fr-FR');
      document.getElementById('kpi-dl').textContent = (s.avgDownload ?? 0).toFixed(1);
      document.getElementById('kpi-ul').textContent = (s.avgUpload ?? 0).toFixed(1);
      document.getElementById('kpi-ping').textContent = Math.round(s.avgPing ?? 0);
    } catch (e) {
      App.toast('Erreur de chargement des KPIs : ' + e.message);
    }
  }

  async function loadTimeline(days) {
    let data = [];
    try { data = await API.timeline(days) || []; } catch { /* graphe vide */ }

    const labels = data.map((p) => p.date);
    if (timelineChart) timelineChart.destroy();
    timelineChart = new Chart(document.getElementById('chart-timeline'), {
      data: {
        labels,
        datasets: [
          {
            type: 'bar', label: 'Nombre de tests',
            data: data.map((p) => p.count),
            backgroundColor: 'rgba(14, 122, 74, .25)',
            borderRadius: 4, yAxisID: 'y',
          },
          {
            type: 'line', label: 'Débit ↓ moyen (Mbps)',
            data: data.map((p) => p.avgDownload),
            borderColor: '#0e7a4a', backgroundColor: '#0e7a4a',
            tension: .35, pointRadius: 2, yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y:  { position: 'left',  title: { display: true, text: 'Tests' }, beginAtZero: true },
          y1: { position: 'right', title: { display: true, text: 'Mbps' }, grid: { drawOnChartArea: false }, beginAtZero: true },
        },
      },
    });
  }

  async function loadOperators() {
    let data = [];
    try { data = await API.operators() || []; } catch { /* graphe vide */ }
    data.sort((a, b) => b.avgDownload - a.avgDownload);

    if (operatorsChart) operatorsChart.destroy();
    operatorsChart = new Chart(document.getElementById('chart-operators'), {
      type: 'bar',
      data: {
        labels: data.map((o) => o.operator),
        datasets: [
          { label: 'Débit ↓ (Mbps)', data: data.map((o) => o.avgDownload), backgroundColor: data.map((o) => operatorColor(o.operator)), borderRadius: 5 },
          { label: 'Débit ↑ (Mbps)', data: data.map((o) => o.avgUpload), backgroundColor: 'rgba(28,28,60,.30)', borderRadius: 5 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Mbps' } } },
      },
    });
  }

  async function loadNetworkDistribution() {
    // Calculée côté client à partir des points de la carte
    let points = MapView.getPoints();
    if (!points.length) {
      try { points = await API.mapPoints() || []; } catch { points = []; }
    }
    const counts = {};
    points.forEach((p) => {
      const n = (p.networkType || 'Inconnu').toUpperCase();
      counts[n] = (counts[n] || 0) + 1;
    });
    const labels = Object.keys(counts);

    if (networkChart) networkChart.destroy();
    networkChart = new Chart(document.getElementById('chart-network'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: labels.map((l) => counts[l]),
          backgroundColor: labels.map((l) => networkColor(l)),
          borderWidth: 2, borderColor: '#fff',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right' } },
      },
    });
  }

  async function loadAdvanced() {
    let data = [];
    try { data = await API.advancedStats() || []; } catch { /* tableau vide */ }
    const tbody = document.querySelector('#advanced-table tbody');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="color:#5d6478">Aucune donnée disponible.</td></tr>';
      return;
    }
    tbody.innerHTML = data
      .sort((a, b) => b.p50Download - a.p50Download)
      .map((o) => `
        <tr>
          <td><b style="color:${operatorColor(o.operator)}">${o.operator}</b></td>
          <td>${o.count}</td>
          <td><b>${o.avgDownload.toFixed(1)}</b> Mbps</td>
          <td>${o.p25Download.toFixed(1)}</td>
          <td><b>${o.p50Download.toFixed(1)}</b></td>
          <td>${o.p75Download.toFixed(1)}</td>
          <td>${o.p90Download.toFixed(1)}</td>
          <td>${o.avgUpload.toFixed(1)} Mbps</td>
          <td>${Math.round(o.p50Ping)} ms</td>
        </tr>`).join('');
  }

  function bindTimelineToggle() {
    document.querySelectorAll('#timeline-days .toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#timeline-days .toggle').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        loadTimeline(parseInt(btn.dataset.days, 10));
      });
    });
  }

  return { show };
})();
