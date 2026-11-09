// Clé publique (publishable) : faite pour être dans le navigateur.
// La sécurité des données repose sur les règles RLS de la base.
export const SUPABASE_URL = 'https://rlptifjgbzmmlyiqyetk.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_itW2Gc5Rl8pr9QHJHxXDfg_7DH3_Wbb';
export const HOME_POS = { lat: 35.7917, lon: -5.9239, name: 'Cap Spartel' };
// Adresse affichée au bas des images partagées. À remplacer par spartel-fishing.com quand le domaine sera branché.
export const SHARE_URL_LABEL = 'spartel-fishing.com';

/* Lieux de pêche du Maroc pour les prévisions (points en mer, du Nord-Est vers le Sud) */
export const PLACES = [
  { id: 'saidia', region: 'Méditerranée', name: 'Saïdia', lat: 35.105, lon: -2.23 },
  { id: 'ras-el-ma-cap-de-leau', region: 'Méditerranée', name: 'Ras El Ma (Cap de l’Eau)', lat: 35.165, lon: -2.425 },
  { id: 'nador-marchica', region: 'Méditerranée', name: 'Nador / Marchica', lat: 35.2, lon: -2.9 },
  { id: 'al-hoceima', region: 'Méditerranée', name: 'Al Hoceïma', lat: 35.275, lon: -3.935 },
  { id: 'cala-iris', region: 'Méditerranée', name: 'Cala Iris', lat: 35.2, lon: -4.32 },
  { id: 'oued-laou', region: 'Méditerranée', name: 'Oued Laou', lat: 35.47, lon: -5.096 },
  { id: 'martil', region: 'Méditerranée', name: 'Martil', lat: 35.64, lon: -5.265 },
  { id: 'mdiq', region: 'Méditerranée', name: 'M’diq', lat: 35.71, lon: -5.32 },
  { id: 'fnideq', region: 'Méditerranée', name: 'Fnideq', lat: 35.88, lon: -5.35 },
  { id: 'ksar-sghir', region: 'Détroit & Nord Atlantique', name: 'Ksar Sghir', lat: 35.88, lon: -5.56 },
  { id: 'tanger-med', region: 'Détroit & Nord Atlantique', name: 'Tanger Med', lat: 35.93, lon: -5.5 },
  { id: 'tanger', region: 'Détroit & Nord Atlantique', name: 'Tanger', lat: 35.8, lon: -5.8 },
  { id: 'cap-spartel', region: 'Détroit & Nord Atlantique', name: 'Cap Spartel', lat: 35.7917, lon: -5.9239 },
  { id: 'asilah', region: 'Détroit & Nord Atlantique', name: 'Asilah', lat: 35.465, lon: -6.07 },
  { id: 'larache', region: 'Détroit & Nord Atlantique', name: 'Larache', lat: 35.205, lon: -6.19 },
  { id: 'moulay-bousselham', region: 'Détroit & Nord Atlantique', name: 'Moulay Bousselham', lat: 34.885, lon: -6.34 },
  { id: 'mehdia-kenitra', region: 'Détroit & Nord Atlantique', name: 'Mehdia (Kénitra)', lat: 34.26, lon: -6.72 },
  { id: 'sale', region: 'Rabat – Casablanca', name: 'Salé', lat: 34.07, lon: -6.85 },
  { id: 'rabat', region: 'Rabat – Casablanca', name: 'Rabat', lat: 34.04, lon: -6.88 },
  { id: 'temara', region: 'Rabat – Casablanca', name: 'Témara', lat: 33.93, lon: -7.0 },
  { id: 'skhirat', region: 'Rabat – Casablanca', name: 'Skhirat', lat: 33.85, lon: -7.07 },
  { id: 'bouznika', region: 'Rabat – Casablanca', name: 'Bouznika', lat: 33.8, lon: -7.19 },
  { id: 'mohammedia', region: 'Rabat – Casablanca', name: 'Mohammedia', lat: 33.72, lon: -7.385 },
  { id: 'zenata', region: 'Rabat – Casablanca', name: 'Zenata', lat: 33.685, lon: -7.48 },
  { id: 'casablanca', region: 'Rabat – Casablanca', name: 'Casablanca', lat: 33.64, lon: -7.65 },
  { id: 'dar-bouazza', region: 'Rabat – Casablanca', name: 'Dar Bouazza', lat: 33.54, lon: -7.85 },
  { id: 'sidi-rahal', region: 'Rabat – Casablanca', name: 'Sidi Rahal', lat: 33.49, lon: -7.97 },
  { id: 'azemmour', region: 'Centre Atlantique', name: 'Azemmour', lat: 33.3, lon: -8.38 },
  { id: 'el-jadida', region: 'Centre Atlantique', name: 'El Jadida', lat: 33.26, lon: -8.54 },
  { id: 'oualidia', region: 'Centre Atlantique', name: 'Oualidia', lat: 32.745, lon: -9.06 },
  { id: 'safi', region: 'Centre Atlantique', name: 'Safi', lat: 32.3, lon: -9.28 },
  { id: 'essaouira', region: 'Centre Atlantique', name: 'Essaouira', lat: 31.5, lon: -9.8 },
  { id: 'imsouane', region: 'Sud Atlantique', name: 'Imsouane', lat: 30.83, lon: -9.88 },
  { id: 'taghazout', region: 'Sud Atlantique', name: 'Taghazout', lat: 30.545, lon: -9.73 },
  { id: 'agadir', region: 'Sud Atlantique', name: 'Agadir', lat: 30.42, lon: -9.65 },
  { id: 'mirleft', region: 'Sud Atlantique', name: 'Mirleft', lat: 29.58, lon: -10.05 },
  { id: 'sidi-ifni', region: 'Sud Atlantique', name: 'Sidi Ifni', lat: 29.37, lon: -10.2 },
  { id: 'tan-tan-plage', region: 'Sud Atlantique', name: 'Tan-Tan Plage', lat: 28.48, lon: -11.2 },
  { id: 'tarfaya', region: 'Sud Atlantique', name: 'Tarfaya', lat: 27.93, lon: -12.96 },
  { id: 'laayoune-foum-el-oued', region: 'Sud Atlantique', name: 'Laâyoune (Foum el Oued)', lat: 27.12, lon: -13.45 },
  { id: 'boujdour', region: 'Sud Atlantique', name: 'Boujdour', lat: 26.12, lon: -14.56 },
  { id: 'dakhla', region: 'Sud Atlantique', name: 'Dakhla', lat: 23.68, lon: -15.98 },
];
