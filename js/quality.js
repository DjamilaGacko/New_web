// ─── Niveaux de qualité & usages (style ARCEP : 4 niveaux) ───────────────────
// Chaque "usage" définit comment évaluer un point de test. Les usages
// streaming et navigation web sont déclarés mais inactifs : il suffira de
// renseigner `metric` + `levels` quand le backend exposera ces mesures.

const QUALITY_COLORS = {
  4: getCss('--q4'), // très bonne
  3: getCss('--q3'), // bonne
  2: getCss('--q2'), // limitée
  1: getCss('--q1'), // très limitée
  0: getCss('--q0'), // indisponible
};

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Échappe toute valeur avant insertion en innerHTML (protection XSS stocké :
// operator/deviceModel/location/simOperator viennent de la télémétrie).
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Dates ───────────────────────────────────────────────────────────────────
// Partagées entre la carte et la vue Opérateurs.

// Les dates du backend arrivent en "JJ/MM/AAAA HH:MM". new Date() les lirait
// à l'américaine (mois/jour inversés) → semaines fausses. On les parse ici.
function parseTs(s) {
  if (s instanceof Date) return s;
  if (typeof s === 'string') {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  return new Date(s); // repli : format ISO
}

// Clé de jour triable : YYYY-MM-DD.
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Clé de semaine = date (YYYY-MM-DD) du lundi de la semaine du point.
function weekStartKey(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const isoDay = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - isoDay);
  return dayKey(x);
}

function weekLabel(key) {
  const [, m, d] = key.split('-');
  return `Sem. du ${d}/${m}`;
}

const USAGES = {
  debit: {
    label: 'Speedtest',
    legendTitle: 'Qualité du débit descendant',
    available: true,
    unit: 'Mbps',
    metric: (p) => p.download,
    // Seuils inspirés des niveaux ARCEP (très bonne / bonne / limitée / très limitée)
    levels: [
      { level: 4, label: 'Très bon débit',   hint: '≥ 30 Mbps',  test: (v) => v >= 30 },
      { level: 3, label: 'Bon débit',        hint: '10 – 30 Mbps', test: (v) => v >= 10 },
      { level: 2, label: 'Débit limité',     hint: '3 – 10 Mbps',  test: (v) => v >= 3 },
      { level: 1, label: 'Débit très limité', hint: '< 3 Mbps',    test: () => true },
    ],
  },
  streaming: {
    label: 'Streaming vidéo',
    legendTitle: 'Qualité du streaming vidéo',
    available: true,
    unit: 'pts',
    // streamingScore = 0 signifie « test non effectué » → niveau 0 (gris)
    metric: (p) => (p.streamingScore > 0 ? p.streamingScore : null),
    levels: [
      { level: 4, label: 'Streaming fluide HD', hint: 'score ≥ 80', test: (v) => v >= 80 },
      { level: 3, label: 'Bon streaming',       hint: 'score 60 – 80', test: (v) => v >= 60 },
      { level: 2, label: 'Streaming limité',    hint: 'score 40 – 60', test: (v) => v >= 40 },
      { level: 1, label: 'Streaming difficile', hint: 'score < 40', test: () => true },
    ],
  },
  browsing: {
    label: 'Navigation web',
    legendTitle: 'Qualité de la navigation web',
    available: true,
    unit: 'ms',
    // browsingAvgLoadMs = 0 signifie « test non effectué » → niveau 0 (gris)
    metric: (p) => (p.browsingAvgLoadMs > 0 ? p.browsingAvgLoadMs : null),
    // Inversé : plus le temps de chargement est court, meilleur c'est
    levels: [
      { level: 4, label: 'Navigation très fluide', hint: '< 2 s',    test: (v) => v < 2000 },
      { level: 3, label: 'Navigation fluide',      hint: '2 – 5 s',  test: (v) => v < 5000 },
      { level: 2, label: 'Navigation lente',       hint: '5 – 10 s', test: (v) => v < 10000 },
      { level: 1, label: 'Navigation très lente',  hint: '> 10 s',   test: () => true },
    ],
  },
};

// Retourne le niveau (1-4) d'un point pour l'usage donné, 0 si indisponible.
function qualityLevel(point, usageKey) {
  const usage = USAGES[usageKey];
  if (!usage || !usage.available) return 0;
  const value = usage.metric(point);
  if (value == null || isNaN(value)) return 0;
  for (const l of usage.levels) {
    if (l.test(value)) return l.level;
  }
  return 1;
}

function qualityColor(level) {
  return QUALITY_COLORS[level] || QUALITY_COLORS[0];
}

function qualityLabel(level, usageKey) {
  const usage = USAGES[usageKey || 'debit'];
  if (!usage || !usage.levels) return 'Indisponible';
  const found = usage.levels.find((l) => l.level === level);
  return found ? found.label : 'Indisponible';
}

// ─── Couleurs technologies réseau ────────────────────────────────────────────

const NETWORK_COLORS = {
  '5G': '#7c3aed',
  '4G': '#1d4ed8',
  '3G': '#0891b2',
  '2G': '#64748b',
  'WIFI': '#0e7a4a',
  'WI-FI': '#0e7a4a',
};

function networkColor(n) {
  if (!n) return '#94a3b8';
  return NETWORK_COLORS[String(n).toUpperCase()] || '#94a3b8';
}

// ─── Couleurs opérateurs (attribuées dynamiquement, stables par nom) ────────

const OPERATOR_PALETTE = ['#0e7a4a', '#1d4ed8', '#ea580c', '#7c3aed', '#be185d', '#0891b2', '#ca8a04', '#475569'];
const operatorColorCache = {};

function operatorColor(name) {
  const key = (name || 'Inconnu').trim();
  if (!operatorColorCache[key]) {
    const idx = Object.keys(operatorColorCache).length % OPERATOR_PALETTE.length;
    operatorColorCache[key] = OPERATOR_PALETTE[idx];
  }
  return operatorColorCache[key];
}
