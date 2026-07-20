// ─── Client API du backend Yélé (speedtest-go + MongoDB) ────────────────────

const API = (() => {
  const BASE = CONFIG.API_BASE_URL;
  const cache = {};

  async function get(path, { useCache = true } = {}) {
    if (useCache && cache[path]) return cache[path];
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
    const data = await res.json();
    if (useCache) cache[path] = data;
    return data;
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

    // Vérification de disponibilité du serveur
    async health() {
      try {
        const res = await fetch(BASE + '/getIP', { signal: AbortSignal.timeout(8000) });
        return res.ok;
      } catch {
        return false;
      }
    },

    // Géocodage d'adresse (OpenStreetMap Nominatim)
    async geocode(query) {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(query);
      const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
      if (!res.ok) return [];
      return res.json();
    },
  };
})();
