# Spartel

**The future fishing media.** Founded in Barcelona, June 2026.

- `/` : le site média (vitrine façon Instagram), avec accès à l'appli.
- `/app/` : l'appli de l'équipage (PWA installable) : spots GPS, prises, boîte à leurres, sorties et tracks du Humminbird Solix.

## Appli
- Front : HTML/CSS/JS sans étape de build, installable sur iPhone via Safari → Partager → Sur l'écran d'accueil.
- Données : Supabase (projet `spartel`, région Paris). Règles RLS : chaque donnée reste dans l'équipage ; les spots et prises « privés » ne sont visibles que par leur auteur.
- Médias : bucket privé `media`, URLs signées. Les photos sont ré-encodées dans le navigateur avant l'envoi (coordonnées GPS EXIF retirées).
- Carte : MapLibre + OpenStreetMap + OpenSeaMap + EMODnet (profondeurs).
- Météo des prises : Open-Meteo + phase de lune calculée.
- Hors ligne : une prise saisie sans réseau est gardée sur le téléphone et envoyée au retour du réseau.

## Solix
- Import : Solix → Mes données → Exporter tout (carte SD) → `.gpx` → Carte → icône carte SD.
- Export : Équipe → Import / export Solix → Exporter tous les spots.
