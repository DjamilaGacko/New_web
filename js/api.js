// ─── Client API du backend Yélé (speedtest-go + MongoDB) ────────────────────

const API = (() => {
  const BASE = CONFIG.API_BASE_URL;
  const cache = {};

  // 120 s : sur l'offre gratuite Render, le service s'endort après 15 min et met
  // ~60-90 s à se réveiller. Pendant ce réveil, Render renvoie sa propre page
  // d'erreur 502/503, sans les en-têtes CORS du backend Go — le navigateur
  // signale alors une « erreur CORS » trompeuse. D'où le timeout long + les
  // tentatives successives ci-dessous.
  const TIMEOUT_MS = 120_000;
  const RETRIES = 2;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function get(path, { useCache = true } = {}) {
    if (useCache && cache[path]) return cache[path];

    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await sleep(2000 * attempt); // 2 s puis 4 s
      try {
        const res = await fetch(BASE + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        // 502/503 = backend encore en cours de réveil : on retente.
        if (res.status === 502 || res.status === 503) {
          lastError = new Error(`Serveur indisponible (HTTP ${res.status})`);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
        const data = await res.json();
        if (useCache) cache[path] = data;
        return data;
      } catch (e) {
        // Erreur réseau ou timeout (réveil du service) : on retente.
        // Les autres erreurs (HTTP 4xx, JSON invalide) ne sont pas transitoires.
        if (e.name !== 'TypeError' && e.name !== 'TimeoutError' && e.name !== 'AbortError') throw e;
        lastError = e;
      }
    }
    throw new Error(
      'Le serveur ne répond pas. S\'il était en veille, il peut mettre '
      + 'jusqu\'à une minute à redémarrer — réessayez dans un instant. '
      + `(${lastError?.message || 'échec réseau'})`
    );
  }

  return {
    // KPIs globaux : { totalTests, avgDownload, avgUpload, avgPing, testsToday }
    summary: () => get('/api/dashboard/summary'),

    // Points géolocalisés : [{ lat, lng, operator, networkType, download, upload, ping, location, timestamp }]
    mapPoints: () => get('/api/dashboard/map'),

    // Heatmap : [{ lat, lng, intensity, download }]
    heatmap: () => get('/api/dashboard/heatmap'),

    // Stats par opérateur : [{ operator, count, avgDownload, avgUpload, avgPing }]
    operators: () => get('/api/dashboard/operators'),

    // Percentiles : [{ operator, count, avgDownload, p25Download, p50Download, p75Download, p90Download, avgUpload, avgPing, p50Ping }]
    advancedStats: () => get('/api/dashboard/stats/advanced'),

    // Série temporelle : [{ date, count, avgDownload }]
    timeline: (days = 30) => get(`/api/dashboard/timeline?days=${days}`),

    // Résultats paginés : { data: [...], total, page, limit }
    results: ({ page = 1, limit = 20, operator = '', network = '', from = '', to = '' } = {}) => {
      const params = new URLSearchParams({ page, limit });
      if (operator) params.set('operator', operator);
      if (network) params.set('network', network);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return get(`/api/dashboard/results?${params}`, { useCache: false });
    },

    // Géocodage d'adresse (OpenStreetMap Nominatim).
    // `countrycodes=bf` restreint les résultats au Burkina Faso : la carte ne
    // couvrant que le pays, proposer une adresse étrangère mènerait à une
    // impasse.
    async geocode(query) {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=bf&limit=5&q='
        + encodeURIComponent(query);
      const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
      if (!res.ok) return [];
      return res.json();
    },
  };
})();
