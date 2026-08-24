# Yélé — Tableau de bord web

Site public de consultation des mesures Yélé : carte de couverture, comparaison
des opérateurs, statistiques et analyse par intelligence artificielle.

Conçu dans l'esprit de [monreseaumobile.arcep.fr](https://monreseaumobile.arcep.fr),
le portail de l'ARCEP française.

**Aucune compilation, aucune dépendance à installer.** C'est du HTML, du CSS et
du JavaScript natif : il suffit d'ouvrir le dossier derrière un serveur web.

---

## Le projet Yélé en un coup d'œil

| Dépôt | Rôle | Techno |
|---|---|---|
| `mobilefront` | Application mobile : réalise les mesures sur le terrain | Flutter / Dart |
| `mobiletest` | Backend : speedtest, collecte, API | Go + MongoDB |
| **`new_web`** *(ce dépôt)* | Tableau de bord public | HTML/CSS/JS |
| `ai` | Micro-service d'analyse : anomalies et prévision | Python / FastAPI |

```
  [ Application mobile ]  --->  [ Backend Go ]  --->  [ MongoDB ]
                                      |                    ^
                                      |                    |
                          GET /api/dashboard/*      [ Service IA ]
                                      |                    |
                                      v                    |
                              [ CE DÉPÔT ] <--- /api/ai/* -+
```

Ce dépôt ne fait que **lire** l'API du backend. Il ne détient aucune donnée et
n'écrit nulle part.

---

## Démarrage rapide

Un serveur web local est nécessaire : ouvrir `index.html` directement par
`file://` ne fonctionne pas, car les navigateurs bloquent les requêtes réseau
depuis ce protocole.

```bash
git clone <url-du-depot>
cd new_web

python -m http.server 5500
# ou : npx serve -l 5500
```

Puis ouvrir **http://localhost:5500**.

Le site interroge par défaut le backend de démonstration hébergé sur Render :
aucune configuration n'est requise pour un premier lancement.

## Configuration

Tout tient dans **`config.js`** :

```js
const CONFIG = {
  API_BASE_URL: 'https://mobiletest-j0c6.onrender.com',
  MAP_CENTER: [12.3656, -1.5197],   // Ouagadougou
  MAP_ZOOM: 7,
};
```

Pour travailler contre un backend local : `API_BASE_URL: 'http://localhost:8989'`.

---

## Les six vues

| Onglet | Fichier | Contenu |
|---|---|---|
| **Carte** | `js/map.js` | Carte plein écran, filtres repliables, regroupement automatique des points |
| **Opérateurs** | `js/operators.js` | Tableau comparatif : période x opérateur x lieu, triable |
| **Comparer les opérateurs** | `js/compare.js` | Quatre cartes synchronisées, une par opérateur |
| **Statistiques** | `js/stats.js` | KPIs, graphiques Chart.js, percentiles |
| **Historique des tests** | `js/history.js` | Tableau paginé et filtrable de toutes les mesures |
| **Analyse IA** | `js/ai.js` | Anomalies détectées et prévision de débit à 48 h |

La navigation entre vues est gérée par `js/app.js`. Les vues sont chargées
paresseusement : leurs données ne sont demandées qu'au premier affichage.

Liens profonds : `?view=stats` ouvre directement une vue,
`?usage=streaming` présélectionne un usage sur la carte.

## Structure du code

```
index.html          Toutes les vues, en sections masquées/affichées
config.js           URL du backend, centre et zoom de la carte
css/style.css       L'intégralité du style
js/
├── quality.js      *** À LIRE EN PREMIER *** niveaux de qualité, dates, couleurs
├── api.js          Client HTTP du backend (cache, tentatives successives)
├── map.js          Vue Carte
├── operators.js    Vue Opérateurs
├── compare.js      Vue Comparer
├── stats.js        Vue Statistiques
├── history.js      Vue Historique
├── ai.js           Vue Analyse IA
└── app.js          Navigation, recherche d'adresse, notifications
```

Chaque fichier `js/` expose un module unique via une IIFE (`MapView`, `Stats`,
`History`...). L'ordre de chargement dans `index.html` compte : `quality.js`
définit des fonctions utilisées par tous les autres.

### Aucune dépendance installée localement

Trois bibliothèques sont chargées depuis un CDN, directement dans `index.html` :

| Bibliothèque | Usage |
|---|---|
| Leaflet 1.9.4 | Fond de carte et marqueurs |
| Leaflet.heat 0.2.0 | Carte de chaleur |
| Chart.js 4.4.3 | Graphiques de la vue Statistiques |

---

## Concepts à comprendre avant de modifier le code

### 1. Les niveaux de qualité (`js/quality.js`)

Le fichier central du projet. Il définit **quatre niveaux de qualité** dans
l'esprit de l'ARCEP (très bon / bon / limité / très limité) et trois **usages**,
chacun avec sa métrique et ses seuils :

| Usage | Métrique | Très bon | Bon | Limité |
|---|---|---|---|---|
| Speedtest | Débit descendant | >= 30 Mbps | 10-30 | 3-10 |
| Streaming vidéo | Score de streaming | >= 80 | 60-80 | 40-60 |
| Navigation web | Temps de chargement | < 2 s | 2-5 s | 5-10 s |

L'échelle de la navigation web est **inversée** : plus le temps est court,
meilleure est la qualité.

Pour ajouter un usage, il suffit d'ajouter une entrée dans `USAGES` et un bouton
dans le panneau de la carte. Aucun autre fichier n'a besoin d'être modifié.

### 2. Le format des dates

Le backend renvoie les horodatages au format **`JJ/MM/AAAA HH:MM`**.
`new Date()` les lirait à l'américaine, en inversant le jour et le mois. La
fonction `parseTs()` de `quality.js` les analyse correctement — **toujours
l'utiliser**, jamais `new Date()` directement sur un horodatage du backend.

### 3. Le regroupement des points sur la carte

Les tests trop proches pour être distingués sont regroupés en un seul rond
portant le nombre de mesures.

Le rayon de regroupement est exprimé en **pixels écran** (`CLUSTER_PX = 56`) et
non en mètres, et le regroupement est recalculé à chaque changement de zoom.
Le rond est ancré sur le point « graine » du groupe plutôt que sur le
barycentre : par construction, deux graines sont distantes d'au moins 56 pixels,
ce qui garantit qu'aucun rond ne peut en chevaucher un autre. En zoomant, les
groupes se scindent d'eux-mêmes et le détail réapparaît.

### 4. La convention « zéro = non mesuré »

Un `streamingScore` ou un `browsingAvgLoadMs` à zéro signifie **test non
effectué**, pas « résultat nul ». Ces points sont affichés en gris (niveau 0) et
non comme de mauvaises mesures.

### 5. Échappement systématique

Les champs issus de la télémétrie (`operator`, `deviceModel`, `location`) sont
saisis par des appareils tiers. Ils passent **obligatoirement** par
`escapeHtml()` avant toute insertion dans le DOM. C'est la protection contre les
injections de code stocké : ne pas la contourner en ajoutant une colonne.

### 6. Le réveil du backend

Le backend de démonstration tourne sur l'offre gratuite de Render : il s'endort
après quinze minutes d'inactivité et met jusqu'à une minute à redémarrer.
Pendant ce temps, Render renvoie une erreur **sans en-têtes CORS**, que le
navigateur signale comme une « erreur CORS » alors qu'il s'agit d'un simple
délai d'attente.

`js/api.js` en tient compte : délai d'attente de 120 secondes, deux tentatives
supplémentaires avec attente croissante, et un message d'attente affiché sur la
carte. **Ne pas raccourcir ces délais** sans changer d'hébergement.

---

## Déploiement

Le site étant entièrement statique, tout hébergeur de fichiers convient.

### GitHub Pages

1. Pousser le dépôt sur GitHub.
2. *Settings* → *Pages* → source : la branche `main`, dossier `/ (root)`.
3. Le site est publié sous `https://<utilisateur>.github.io/<depot>/`.

Aucune étape de compilation n'est nécessaire.

> Le backend doit autoriser l'origine du site. Il est configuré en
> `AllowedOrigins: ["*"]`, ce qui couvre tous les cas.

---

## Contribuer

Pistes concrètes :

- **Rendre le choix de l'opérateur explicite.** Le champ `operator` renvoyé par
  l'API est le **fournisseur d'accès détecté par adresse IP**, pas l'opérateur
  mobile. Sur un test réalisé en WiFi, il vaut par exemple « ANPTIC ». Le vrai
  opérateur mobile se trouve dans `simOperator`. Un sélecteur « FAI / Opérateur
  SIM » dans les vues Opérateurs et Historique lèverait l'ambiguïté.
- Accessibilité : navigation au clavier, contrastes, attributs ARIA.
- Internationalisation : l'interface est aujourd'hui en français uniquement.
- Export CSV des tableaux, utile pour les travaux de recherche.

Le projet n'utilise volontairement ni framework ni étape de compilation, afin de
rester lisible et modifiable par un contributeur sans outillage JavaScript.
Merci de conserver cette contrainte.

## Licence

À définir avant l'ouverture publique du dépôt.


####################################################
la page est deja hebergee et accessible sur https://djamilagacko.github.io/New_web/
#######################################################