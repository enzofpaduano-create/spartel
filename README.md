# Spartel

Appli web installable (PWA) de l'équipage Spartel : spots GPS, prises, boîte à leurres, sorties et tracks du Humminbird Solix, partage entre amis.

- Front : HTML/CSS/JS sans étape de build (`index.html`, `js/`, `css/`), installable sur iPhone via Safari → Partager → Sur l'écran d'accueil.
- Données : Supabase (projet `spartel`, région Paris). Les règles RLS limitent chaque donnée aux membres de l'équipage ; les spots et prises « privés » ne sont visibles que par leur auteur.
- Médias : bucket privé `media`, URLs signées. Les photos sont ré-encodées dans le navigateur avant l'envoi, ce qui retire les coordonnées GPS EXIF.
- Carte : MapLibre + OpenStreetMap + OpenSeaMap (balisage) + EMODnet (profondeurs, bouton calques).
- Météo des prises : Open-Meteo (vent, houle, température de l'eau) + phase de lune calculée.
- Hors ligne : l'appli s'ouvre sans réseau ; une prise saisie en mer est gardée sur le téléphone et envoyée au retour du réseau.

## Solix
- Import : Solix → Mes données → Exporter tout (carte SD) → fichier `.gpx` → Carte → icône carte SD.
- Export : Équipe → Import / export Solix → Exporter tous les spots → copier le `.gpx` sur la carte SD.

## Mettre en ligne
N'importe quel hébergement statique HTTPS (GitHub Pages, Netlify, Cloudflare Pages). Aucune variable d'environnement : `js/config.js` contient l'URL Supabase et la clé publique.
