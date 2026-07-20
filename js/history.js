// ─── Vue Historique : tableau paginé avec filtres ────────────────────────────

const History = (() => {
  const state = { page: 1, limit: 20, total: 0 };
  let loadedOnce = false;

  function show() {
    if (!loadedOnce) {
      loadedOnce = true;
      bind();
      load();
    }
  }

  // Remplit les <select> avec les valeurs trouvées dans les données carte
  function setOperators(operators) {
    const sel = document.getElementById('hf-operator');
    sel.length = 1;
    operators.forEach((op) => sel.add(new Option(op, op)));
  }

  function setNetworks(networks) {
    const sel = document.getElementById('hf-network');
    sel.length = 1;
    networks.forEach((n) => sel.add(new Option(n, n)));
  }

  async function load() {
    const tbody = document.querySelector('#history-table tbody');
    tbody.innerHTML = '<tr><td colspan="13" style="color:#5d6478">Chargement…</td></tr>';

    let page;
    try {
      page = await API.results({
        page: state.page,
        limit: state.limit,
        operator: document.getElementById('hf-operator').value,
        network: document.getElementById('hf-network').value,
        from: document.getElementById('hf-from').value,
        to: document.getElementById('hf-to').value,
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="13" style="color:#e0492f">Erreur : ${e.message}</td></tr>`;
      return;
    }

    state.total = page.total || 0;
    const rows = page.data || [];

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="13" style="color:#5d6478">Aucun résultat pour ces filtres.</td></tr>';
    } else {
      tbody.innerHTML = rows.map((r) => {
        const dl = parseFloat(r.download);
        const lvl = qualityLevel({ download: dl }, 'debit');
        const date = r.timestamp ? new Date(r.timestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '–';
        const net = r.networkType
          ? `<span class="net-badge" style="background:${networkColor(r.networkType)}">${escapeHtml(r.networkType)}</span>` : '–';
        const streaming = r.streamingScore > 0
          ? escapeHtml(`${r.streamingMaxResolution || ''} ${Math.round(r.streamingScore)}/100`.trim()) : '–';
        const browsing = r.browsingAvgLoadMs > 0
          ? `${(r.browsingAvgLoadMs / 1000).toFixed(1)} s` : '–';
        const mobile = [r.cellularTech, r.simOperator].filter(Boolean).map(escapeHtml).join(' · ') || '–';
        return `
          <tr>
            <td>${date}</td>
            <td><b style="color:${operatorColor(r.operator)}">${escapeHtml(r.operator || 'Inconnu')}</b></td>
            <td>${mobile}</td>
            <td>${net}</td>
            <td><b>${escapeHtml(r.download || '–')}</b></td>
            <td>${escapeHtml(r.upload || '–')}</td>
            <td>${escapeHtml(r.ping || '–')} ms</td>
            <td>${escapeHtml(r.jitter || '–')} ms</td>
            <td>${streaming}</td>
            <td>${browsing}</td>
            <td>${escapeHtml(r.location || r.city || '–')}</td>
            <td>${escapeHtml(r.deviceModel || '–')}</td>
            <td><span class="q-pill" style="background:${qualityColor(lvl)}22;color:${qualityColor(lvl)}"><i style="background:${qualityColor(lvl)}"></i>${qualityLabel(lvl)}</span></td>
          </tr>`;
      }).join('');
    }

    const pages = Math.max(1, Math.ceil(state.total / state.limit));
    document.getElementById('hp-info').textContent = `Page ${state.page} / ${pages} — ${state.total.toLocaleString('fr-FR')} tests`;
    document.getElementById('hp-prev').disabled = state.page <= 1;
    document.getElementById('hp-next').disabled = state.page >= pages;
  }

  function bind() {
    document.getElementById('hf-apply').addEventListener('click', () => { state.page = 1; load(); });
    document.getElementById('hf-reset').addEventListener('click', () => {
      ['hf-operator', 'hf-network', 'hf-from', 'hf-to'].forEach((id) => { document.getElementById(id).value = ''; });
      state.page = 1;
      load();
    });
    document.getElementById('hp-prev').addEventListener('click', () => { state.page--; load(); });
    document.getElementById('hp-next').addEventListener('click', () => { state.page++; load(); });
  }

  return { show, setOperators, setNetworks };
})();
