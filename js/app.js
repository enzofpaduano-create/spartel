import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_KEY, HOME_POS } from './config.js';
import { fmtCoord, parseCoords, parseGPX, buildGPX, trackStats, simplify, fetchConditions, fetchCurrent, windDir, moonPhase, haversine } from './geo.js';
import { readPhotoMeta, compressImage, MAX_VIDEO_MB } from './media.js';
import { queueAdd, queueAll, queueDelete } from './offline.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $app = document.getElementById('app');

const S = {
  user: null, profile: null, crew: null, crews: [], members: {}, memberIds: [],
  coordMode: localStorage.getItem('coordMode') || 'ddm',
  lastPos: null, map: null, cleanup: [],
};

/* ---------------- Constantes métier ---------------- */
const SPECIES = ['Loup (bar)', 'Courbine', 'Denti', 'Pagre', 'Dorade royale', 'Sar', 'Marbré', 'Pageot', 'Liche', 'Sériole', 'Bonite', 'Thon rouge', 'Thonine', 'Espadon', 'Mérou', 'Badèche', 'Barracuda', 'Tassergal', 'Chinchard', 'Maquereau', 'Palomine', 'Ombrine', 'Corb', 'Rouget', 'Saint-Pierre', 'Congre', 'Murène', 'Raie', 'Sole', 'Calamar', 'Seiche', 'Poulpe'];
const TECHNIQUES = ['Jig', 'Slow jig', 'Madaï / tenya', 'Traîne', 'Surface (popper, stickbait)', 'Poisson nageur', 'Leurre souple', 'Palangrotte', 'Appât', 'Turlutte', 'Chasse sous-marine'];
const LURE_TYPES = ['Jig', 'Slow jig', 'Madaï', 'Stickbait', 'Popper', 'Poisson nageur', 'Leurre souple', 'Turlutte', 'Cuiller', 'Appât naturel', 'Autre'];
const BOTTOMS = ['Roche', 'Tombant', 'Épave', 'Sable', 'Vase', 'Herbier', 'Plateau', 'Canyon', 'Mixte'];

/* ---------------- Utilitaires ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 1) => (v == null || v === '' ? null : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d }));
const kg = (v) => (v == null ? '' : `${num(v, 2)} kg`);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(d).toLocaleDateString('fr-FR', opts);
const fmtTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const todayISO = () => new Date().toISOString().slice(0, 10);
const localDT = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const initials = (n) => (n || '?').trim().charAt(0).toUpperCase();
const nameOf = (id) => S.members[id]?.display_name || 'Quelqu’un';
const isMine = (row, key = 'owner_id') => row && row[key] === S.user?.id;
const qs = () => { const q = location.hash.split('?')[1]; return Object.fromEntries(new URLSearchParams(q || '')); };
const go = (h) => { location.hash = h; };

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms);
}
function fail(e) { console.error(e); toast(e?.message ? `Erreur : ${e.message}` : 'Une erreur est survenue'); }

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  map: '<path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lure: '<path d="M5 12c3-5 9-6 14-3-2 5-8 7-14 3z"/><circle cx="15" cy="10" r="1"/><path d="M5 12l-2 3M19 9l2-1"/><path d="M8 15v3a2 2 0 0 0 3 1"/>',
  crew: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6M15 14.5c3 0 6 2 6 5.5"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>',
  wave: '<path d="M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 4-2 5-1M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 4-2 5-1"/>',
  temp: '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/>',
  moon: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  nav: '<path d="M12 2l7 19-7-4-7 4z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sd: '<path d="M7 3h8l4 4v14H7z"/><path d="M10 3v4M13 3v4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  depth: '<path d="M12 3v18M7 16l5 5 5-5"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  boat: '<path d="M3 17l2 3h14l2-3z"/><path d="M12 3v14M12 5l6 9h-6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};
const icon = (n, s = 22, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const avatar = (id, cls = '') => `<span class="avatar ${cls}">${esc(initials(nameOf(id)))}</span>`;

/* ---------------- Médias (URLs signées) ---------------- */
const urlCache = new Map();
async function signed(paths) {
  const need = [...new Set(paths.filter((p) => p && !(urlCache.has(p) && urlCache.get(p).exp > Date.now())))];
  if (need.length) {
    const { data } = await sb.storage.from('media').createSignedUrls(need, 3600);
    (data || []).forEach((d) => d.signedUrl && urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3300e3 }));
  }
  return (p) => (p && urlCache.get(p)?.url) || null;
}
async function upload(blob, kind, ext) {
  const path = `${S.crew.id}/${kind}/${uuid()}.${ext}`;
  const { error } = await sb.storage.from('media').upload(path, blob, { contentType: blob.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}
const extOf = (file, def) => (file?.name?.split('.').pop() || def).toLowerCase().slice(0, 5);

/* ---------------- Mise en page ---------------- */
function tabbar(active) {
  const t = (h, ic, label, key) => `<a href="${h}" class="${active === key ? 'on' : ''}" ${active === key ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  return `<nav class="tabbar" aria-label="Navigation principale">${t('#/', 'home', 'Accueil', 'home')}${t('#/map', 'map', 'Carte', 'map')}<a href="#/catch-new" class="fab" aria-label="Nouvelle prise">${icon('plus', 28, 2.6)}</a>${t('#/lures', 'lure', 'Leurres', 'lures')}${t('#/crew', 'crew', 'Équipe', 'crew')}</nav>`;
}
function topbar({ title = '', back = false, right = '' } = {}) {
  const left = back
    ? `<button class="iconbtn" data-back aria-label="Retour">${icon('back', 24)}</button>`
    : `<a class="brand" href="#/"><img src="icons/symbol.svg" alt="" width="34" height="34"><span class="h">Spartel</span></a>`;
  return `<header class="topbar">${left}${title ? `<h1 class="h title">${esc(title)}</h1>` : ''}<div class="row" style="min-width:44px;justify-content:flex-end">${right}</div></header>`;
}
function page(html, { tab = null } = {}) {
  teardown();
  $app.innerHTML = `${html}${tab !== false ? tabbar(tab) : ''}`;
  $app.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => (history.length > 1 ? history.back() : go('#/'))));
  window.scrollTo(0, 0);
}
function teardown() {
  S.cleanup.forEach((f) => { try { f(); } catch (e) {} });
  S.cleanup = [];
}
function modal(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  S.cleanup.push(() => m.remove());
  return m;
}
function confirmBox(text, okLabel = 'Supprimer') {
  return new Promise((res) => {
    const m = modal(`<p style="font-weight:600;margin:0 0 16px">${esc(text)}</p><div class="btn-row"><button class="btn ghost" data-no>Annuler</button><button class="btn" style="background:var(--danger)" data-ok>${esc(okLabel)}</button></div>`);
    m.querySelector('[data-no]').onclick = () => { m.remove(); res(false); };
    m.querySelector('[data-ok]').onclick = () => { m.remove(); res(true); };
  });
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('GPS indisponible'));
    navigator.geolocation.getCurrentPosition(
      (p) => { S.lastPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; res(S.lastPos); },
      (e) => rej(new Error(e.code === 1 ? 'Autorise la localisation pour Spartel dans les réglages' : 'Position introuvable')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}
function download(name, text, type = 'application/gpx+xml') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function shareOrCopy(text, title = 'Spartel') {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Copié'); } catch (e) { toast(text, 6000); }
}

/* ---------------- Données de base ---------------- */
async function loadMembers() {
  const { data: mem } = await sb.from('crew_members').select('user_id, role').eq('crew_id', S.crew.id);
  S.memberIds = (mem || []).map((m) => m.user_id);
  const { data: profs } = await sb.from('profiles').select('id, display_name, bio').in('id', S.memberIds.length ? S.memberIds : ['00000000-0000-0000-0000-000000000000']);
  S.members = {};
  (profs || []).forEach((p) => (S.members[p.id] = { ...p, role: mem.find((m) => m.user_id === p.id)?.role }));
}
async function loadCrew() {
  const { data: crews } = await sb.from('crews').select('*').order('created_at');
  S.crews = crews || [];
  const saved = localStorage.getItem('crewId');
  S.crew = S.crews.find((c) => c.id === saved) || S.crews[0] || null;
  if (S.crew) { localStorage.setItem('crewId', S.crew.id); await loadMembers(); }
}
async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  S.profile = data;
}

/* ---------------- Auth ---------------- */
function viewAuth(mode = 'login') {
  teardown();
  $app.innerHTML = `<main class="auth">
    <img class="logo" src="icons/wordmark.svg" alt="Spartel">
    <div class="card">
      <div class="chips" role="tablist" style="margin-bottom:14px">
        <button class="chip ${mode === 'login' ? 'on' : ''}" data-mode="login" role="tab" aria-selected="${mode === 'login'}">Connexion</button>
        <button class="chip ${mode === 'signup' ? 'on' : ''}" data-mode="signup" role="tab" aria-selected="${mode === 'signup'}">Créer un compte</button>
      </div>
      <form id="authf">
        ${mode === 'signup' ? '<label class="f">Prénom (affiché dans l’équipe)<input name="name" required autocomplete="given-name" maxlength="40"></label>' : ''}
        <label class="f">E-mail<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <label class="f">Mot de passe<input name="password" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
        <button class="btn sun" type="submit">${mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button>
        ${mode === 'login' ? '<button type="button" class="btn ghost sm" id="forgot">Mot de passe oublié</button>' : ''}
      </form>
    </div>
    <p class="hint" style="text-align:center">Spartel · Atlantic · Mediterranean</p>
  </main>`;
  $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => viewAuth(b.dataset.mode)));
  const f = $app.querySelector('#authf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f), btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email: fd.get('email'), password: fd.get('password'), options: { data: { display_name: fd.get('name') }, emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) { toast('Compte créé. Confirme ton e-mail puis connecte-toi.', 6000); viewAuth('login'); }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
        if (error) throw new Error(error.message.includes('Invalid') ? 'E-mail ou mot de passe incorrect' : error.message);
      }
    } catch (err) { fail(err); } finally { btn.disabled = false; }
  };
  const fg = $app.querySelector('#forgot');
  if (fg) fg.onclick = async () => {
    const email = f.email.value;
    if (!email) return toast('Entre ton e-mail d’abord');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '#/reset' });
    error ? fail(error) : toast('E-mail de réinitialisation envoyé', 5000);
  };
}

function viewReset() {
  page(`<main class="screen">${topbar({ title: 'Nouveau mot de passe' })}
    <form id="rf" class="card"><label class="f">Nouveau mot de passe<input name="p" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn sun">Enregistrer</button></form></main>`, { tab: false });
  $app.querySelector('#rf').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: e.target.p.value });
    error ? fail(error) : (toast('Mot de passe modifié'), go('#/'));
  };
}

/* ---------------- Équipage : création / invitation ---------------- */
function viewOnboarding() {
  const code = localStorage.getItem('pendingJoin') || '';
  page(`<main class="auth">
    <img class="logo" src="icons/badge.svg" alt="Badge Spartel Crew" style="max-width:180px">
    <div class="card"><h2 class="h" style="font-size:18px">Rejoindre un équipage</h2>
      <p class="hint">Entre le code reçu d’un ami (ou ouvre son lien d’invitation).</p>
      <form id="jf"><label class="f">Code d’invitation<input name="code" required maxlength="10" value="${esc(code)}" style="text-transform:uppercase;letter-spacing:.2em" autocomplete="off"></label><button class="btn sun">Rejoindre</button></form></div>
    <div class="card"><h2 class="h" style="font-size:18px">Créer un équipage</h2>
      <form id="cf"><label class="f">Nom<input name="name" required maxlength="40" value="Spartel Crew"></label><button class="btn">Créer</button></form></div>
    <button class="btn ghost sm" id="lo">Se déconnecter</button>
  </main>`, { tab: false });
  $app.querySelector('#jf').onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await sb.rpc('join_crew', { code: e.target.code.value });
    if (error) return fail(error.message.includes('invalide') ? new Error('Code invalide') : error);
    localStorage.removeItem('pendingJoin'); localStorage.setItem('crewId', data.id);
    toast(`Bienvenue dans ${data.name}`); await boot();
  };
  $app.querySelector('#cf').onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await sb.rpc('create_crew', { crew_name: e.target.name.value.trim() });
    if (error) return fail(error);
    localStorage.setItem('crewId', data.id); toast('Équipage créé'); await boot();
  };
  $app.querySelector('#lo').onclick = () => sb.auth.signOut();
}

/* ---------------- Accueil ---------------- */
async function viewHome() {
  const pending = await queueAll().catch(() => []);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const showInstall = isIOS && !standalone && !localStorage.getItem('hideInstall');
  page(`<main class="screen">
    ${topbar({ right: `<a href="#/crew" aria-label="Mon profil"><span class="avatar sun lg">${esc(initials(S.profile?.display_name))}</span></a>` })}
    ${pending.length ? `<div class="banner"><span>${pending.length} prise${pending.length > 1 ? 's' : ''} en attente de réseau</span><button class="btn sm" id="sync" style="background:var(--navy)">Envoyer</button></div>` : ''}
    ${showInstall ? `<div class="card install"><div class="row between"><b>Installer Spartel sur l’iPhone</b><button class="iconbtn" id="hideInstall" aria-label="Masquer">✕</button></div><p class="muted" style="margin:6px 0 0">Dans Safari : bouton <b>Partager</b> ${icon('share', 16)} puis <b>Sur l’écran d’accueil</b>.</p></div>` : ''}
    <section class="card" id="next"><p class="kicker">Prochaine sortie</p><p class="muted">Chargement…</p></section>
    <section class="card"><div class="row between"><p class="kicker">Conditions · ${esc(HOME_POS.name)}</p><span class="small muted">maintenant</span></div><div class="stats" id="cond" style="margin-top:10px"><p class="muted">…</p></div></section>
    <section id="board" class="card"><div class="row">${icon('trophy', 20)}<h2 class="h" style="font-size:14px">Plus gros du mois</h2></div><div class="list" id="boardList" style="margin-top:6px"><p class="muted">…</p></div></section>
    <h2 class="kicker" style="margin:6px 0 0">Dernières prises</h2>
    <section id="feed" style="display:flex;flex-direction:column;gap:14px"><p class="muted">Chargement…</p></section>
  </main>`, { tab: 'home' });
  const hi = $app.querySelector('#hideInstall'); if (hi) hi.onclick = () => { localStorage.setItem('hideInstall', '1'); hi.closest('.card').remove(); };
  const sy = $app.querySelector('#sync'); if (sy) sy.onclick = () => syncQueue(true);

  // Prochaine sortie
  sb.from('trips').select('*').eq('crew_id', S.crew.id).gte('trip_date', todayISO()).order('trip_date').limit(1).then(({ data }) => {
    const t = data?.[0], el = $app.querySelector('#next'); if (!el) return;
    el.innerHTML = t
      ? `<a href="#/trip/${t.id}" style="text-decoration:none;color:inherit;display:block"><div class="row between"><p class="kicker">Prochaine sortie</p><span class="small muted">${t.members?.length || 0} à bord</span></div>
         <p class="h" style="font-size:20px;margin-top:6px">${esc(fmtDate(t.trip_date, { weekday: 'short', day: 'numeric', month: 'short' }))}</p>
         <p class="muted" style="margin:4px 0 0">${esc([t.title, t.boat_name].filter(Boolean).join(' · ') || 'Sortie')}</p></a>`
      : `<p class="kicker">Prochaine sortie</p><p class="muted" style="margin:6px 0 12px">Aucune sortie prévue.</p><a class="btn ghost sm" href="#/trip-new">Planifier une sortie</a>`;
  });
  // Conditions
  fetchCurrent(HOME_POS.lat, HOME_POS.lon).then((c) => {
    const el = $app.querySelector('#cond'); if (!el) return;
    const st = (ic, v, l) => `<div class="stat">${icon(ic, 20)}<b>${v ?? '—'}</b><span>${l}</span></div>`;
    el.innerHTML = st('wind', c.wind_speed_10m != null ? `${Math.round(c.wind_speed_10m)} nds` : null, `Vent ${windDir(c.wind_direction_10m)}`)
      + st('wave', c.wave_height != null ? `${num(c.wave_height)} m` : null, 'Houle')
      + st('temp', c.sea_surface_temperature != null ? `${Math.round(c.sea_surface_temperature)} °C` : null, 'Eau')
      + st('moon', `${c.moon.illumination} %`, c.moon.label);
  });
  // Classement + fil
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: month }, { data: feed }, { data: spots }, { data: lures }] = await Promise.all([
    sb.from('catches').select('angler_id, created_by, species, weight_kg').eq('crew_id', S.crew.id).gte('caught_at', monthStart.toISOString()).not('weight_kg', 'is', null),
    sb.from('catches').select('*').eq('crew_id', S.crew.id).order('caught_at', { ascending: false }).limit(20),
    sb.from('spots').select('id, name').eq('crew_id', S.crew.id),
    sb.from('lures').select('id, name, photo_path').eq('crew_id', S.crew.id),
  ]);
  const best = {};
  (month || []).forEach((c) => { const a = c.angler_id || c.created_by; if (!best[a] || +c.weight_kg > +best[a].weight_kg) best[a] = c; });
  const ranking = Object.entries(best).sort((a, b) => b[1].weight_kg - a[1].weight_kg).slice(0, 5);
  const bl = $app.querySelector('#boardList');
  if (bl) bl.innerHTML = ranking.length ? ranking.map(([id, c], i) => `<div class="list-item"><b style="width:16px;color:var(--sun-dark)">${i + 1}</b>${avatar(id)}<span class="grow ellipsis" style="font-weight:600">${esc(nameOf(id))}</span><span class="small muted">${esc(c.species)}</span><b>${kg(c.weight_kg)}</b></div>`).join('') : '<p class="muted" style="margin:8px 0 0">Pas encore de prise pesée ce mois-ci.</p>';
  const spotName = Object.fromEntries((spots || []).map((s) => [s.id, s.name]));
  const lureById = Object.fromEntries((lures || []).map((l) => [l.id, l]));
  const url = await signed((feed || []).flatMap((c) => [c.photo_path, c.lure_photo_path || lureById[c.lure_id]?.photo_path]));
  const fe = $app.querySelector('#feed'); if (!fe) return;
  fe.innerHTML = (feed || []).length ? feed.map((c) => {
    const a = c.angler_id || c.created_by, lure = lureById[c.lure_id];
    const lp = c.lure_photo_path || lure?.photo_path;
    return `<a class="card" href="#/catch/${c.id}" style="text-decoration:none;color:inherit;padding:14px">
      <div class="row">${avatar(a)}<div class="grow"><div style="font-weight:700">${esc(nameOf(a))}</div><div class="small muted ellipsis">${esc([fmtDate(c.caught_at), spotName[c.spot_id], c.depth_m != null ? `${num(c.depth_m, 0)} m` : null].filter(Boolean).join(' · '))}</div></div></div>
      ${c.photo_path && url(c.photo_path) ? `<img class="photo" style="margin-top:12px" loading="lazy" src="${url(c.photo_path)}" alt="${esc(c.species)}">` : ''}
      <div class="row between" style="margin-top:12px"><span class="h" style="font-size:18px">${esc(c.species)}</span><b style="color:var(--sun-dark);font-size:18px">${kg(c.weight_kg)}</b></div>
      ${lure || c.lure_name ? `<div class="row" style="margin-top:10px;padding:8px;background:var(--sand);border-radius:12px">${lp && url(lp) ? `<img class="thumb" src="${url(lp)}" alt="">` : `<span class="thumb">${icon('lure')}</span>`}<div><div style="font-weight:600;font-size:14px">${esc(lure?.name || c.lure_name)}</div><div class="small muted">${esc([c.technique, c.released ? 'relâché' : null].filter(Boolean).join(' · '))}</div></div></div>` : ''}
    </a>`;
  }).join('') : `<div class="empty card">${icon('trophy', 34)}<p>Aucune prise pour l’instant.<br>Touche le bouton <b>+</b> pour enregistrer la première.</p></div>`;
}

/* ---------------- Carte ---------------- */
function baseStyle() {
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap' },
      seamarks: { type: 'raster', tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 18, attribution: '© OpenSeaMap' },
      bathy: { type: 'raster', tiles: ['https://ows.emodnet-bathymetry.eu/wms?service=WMS&request=GetMap&version=1.1.1&layers=emodnet:mean_atlas_land&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}'], tileSize: 256, attribution: '© EMODnet Bathymetry' },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' },
      { id: 'bathy', type: 'raster', source: 'bathy', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75 } },
      { id: 'seamarks', type: 'raster', source: 'seamarks' },
    ],
  };
}
function pinEl(color, label) {
  const el = document.createElement('button');
  el.className = 'pin'; el.type = 'button'; el.setAttribute('aria-label', label);
  el.style.cssText = 'border:none;background:none;padding:0';
  el.innerHTML = `<svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true"><path d="M13 33C13 33 1 21 1 12.5A12 12 0 0 1 25 12.5C25 21 13 33 13 33Z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="12.5" r="4.5" fill="#fff"/></svg>`;
  return el;
}
function addTrackLayer(map, id, pts, color = '#E2703A') {
  const geo = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p[1], p[0]]) } };
  if (map.getSource(id)) { map.getSource(id).setData(geo); return; }
  map.addSource(id, { type: 'geojson', data: geo });
  map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 3, 'line-dasharray': [2, 1.5] } });
}

async function viewMap() {
  const q = qs();
  page(`<div class="mapwrap"><div id="map" role="application" aria-label="Carte des spots"></div></div>
    <div class="map-top">
      <form class="search" id="sf"><span aria-hidden="true">${icon('search', 20)}</span><input name="q" placeholder="Spot ou coordonnées (35°48,2'N 5°58,9'W)" aria-label="Chercher un spot ou des coordonnées" autocomplete="off"><button class="iconbtn" type="button" id="gpx" aria-label="Importer un GPX du Solix">${icon('sd', 20)}</button></form>
      <div class="chips" id="filters"><button class="chip on" data-f="all">Tous</button><button class="chip" data-f="mine">Mes spots</button><button class="chip" data-f="private">Privés</button><button class="chip" data-f="crew">Équipe</button>${BOTTOMS.slice(0, 4).map((b) => `<button class="chip" data-f="b:${b}">${b}</button>`).join('')}</div>
    </div>
    <div class="map-fabs"><button class="iconbtn" id="layers" aria-label="Afficher les profondeurs">${icon('layers')}</button><button class="iconbtn" id="loc" aria-label="Ma position">${icon('locate')}</button><button class="iconbtn" id="addspot" aria-label="Ajouter un spot" style="background:var(--sun);color:#fff">${icon('plus', 24, 2.4)}</button></div>
    <div id="sheetHost"></div>`, { tab: 'map' });

  const map = new maplibregl.Map({ container: 'map', style: baseStyle(), center: [HOME_POS.lon - 0.05, HOME_POS.lat], zoom: 10.5, attributionControl: { compact: true } });
  S.map = map; S.cleanup.push(() => { map.remove(); S.map = null; });
  const { data: spots } = await sb.from('spots').select('*').eq('crew_id', S.crew.id).order('name');
  let markers = [], filter = 'all';
  const sheetHost = $app.querySelector('#sheetHost');
  const draw = () => {
    markers.forEach((m) => m.remove()); markers = [];
    (spots || []).filter((s) => filter === 'all' || (filter === 'mine' && isMine(s)) || (filter === 'private' && s.visibility === 'private') || (filter === 'crew' && s.visibility === 'crew') || (filter.startsWith('b:') && s.bottom === filter.slice(2)))
      .forEach((s) => {
        const el = pinEl(s.visibility === 'private' ? '#E2703A' : '#0B1F33', s.name);
        el.onclick = (e) => { e.stopPropagation(); showSheet(s); };
        markers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([s.lon, s.lat]).addTo(map));
      });
  };
  const showSheet = (s) => {
    sheetHost.innerHTML = `<div class="sheet"><div class="row between" style="align-items:flex-start"><div class="grow"><p class="h" style="font-size:18px">${esc(s.name)}</p><p class="small muted" style="margin:4px 0 0">${fmtCoord(s.lat, s.lon, S.coordMode)}</p></div>
      <span class="badge-vis">${icon(s.visibility === 'crew' ? 'users' : 'lock', 14)}${s.visibility === 'crew' ? 'Équipe' : 'Privé'}</span></div>
      <div class="row wrap" style="gap:14px;margin-top:10px;font-weight:600;font-size:13px">${s.depth_min || s.depth_max ? `<span>${[s.depth_min, s.depth_max].filter((x) => x != null).map((x) => num(x, 0)).join('–')} m</span>` : ''}${s.bottom ? `<span class="muted">${esc(s.bottom)}</span>` : ''}${!isMine(s) ? `<span class="muted">par ${esc(nameOf(s.owner_id))}</span>` : ''}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn" id="cp">${icon('copy', 18)}Copier</button><a class="btn ghost" href="#/spot/${s.id}">Voir la fiche</a></div></div>`;
    sheetHost.querySelector('#cp').onclick = () => shareOrCopy(`${s.name} — ${fmtCoord(s.lat, s.lon, S.coordMode)}`);
  };
  map.on('click', () => (sheetHost.innerHTML = ''));
  map.on('load', () => {
    draw();
    if (q.lat && q.lon) map.jumpTo({ center: [+q.lon, +q.lat], zoom: 13 });
    else if (spots?.length) {
      const b = new maplibregl.LngLatBounds();
      spots.forEach((s) => b.extend([s.lon, s.lat]));
      map.fitBounds(b, { padding: 80, maxZoom: 12, duration: 0 });
    }
    if (q.spot) { const s = spots.find((x) => x.id === q.spot); if (s) showSheet(s); }
  });
  $app.querySelectorAll('#filters .chip').forEach((c) => (c.onclick = () => {
    $app.querySelectorAll('#filters .chip').forEach((x) => x.classList.toggle('on', x === c)); filter = c.dataset.f; draw();
  }));
  $app.querySelector('#gpx').onclick = () => go('#/gpx');
  let bathyOn = false;
  $app.querySelector('#layers').onclick = () => {
    bathyOn = !bathyOn; map.setLayoutProperty('bathy', 'visibility', bathyOn ? 'visible' : 'none');
    toast(bathyOn ? 'Profondeurs affichées (EMODnet)' : 'Profondeurs masquées');
  };
  let meMarker;
  $app.querySelector('#loc').onclick = async () => {
    try {
      const p = await getPosition();
      if (!meMarker) { const el = document.createElement('div'); el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#2B7FFF;border:3px solid #fff;box-shadow:0 0 0 6px rgba(43,127,255,.25)'; meMarker = new maplibregl.Marker({ element: el }); }
      meMarker.setLngLat([p.lon, p.lat]).addTo(map); map.flyTo({ center: [p.lon, p.lat], zoom: 13 });
    } catch (e) { fail(e); }
  };
  // Ajout de spot : viseur au centre de la carte
  $app.querySelector('#addspot').onclick = () => {
    const ch = document.createElement('div');
    ch.className = 'crosshair'; ch.innerHTML = pinEl('#E2703A', '').innerHTML;
    $app.appendChild(ch);
    sheetHost.innerHTML = `<div class="sheet"><p style="font-weight:700;margin:0 0 4px">Place le viseur sur le spot</p><p class="small muted" id="chpos" style="margin:0 0 12px"></p><div class="btn-row"><button class="btn ghost" id="cx">Annuler</button><button class="btn sun" id="ok">Créer ici</button></div></div>`;
    const upd = () => { const c = map.getCenter(); sheetHost.querySelector('#chpos').textContent = fmtCoord(c.lat, c.lng, S.coordMode); };
    upd(); map.on('move', upd);
    sheetHost.querySelector('#cx').onclick = () => { ch.remove(); map.off('move', upd); sheetHost.innerHTML = ''; };
    sheetHost.querySelector('#ok').onclick = () => { const c = map.getCenter(); ch.remove(); go(`#/spot-new?lat=${c.lat.toFixed(6)}&lon=${c.lng.toFixed(6)}`); };
  };
  $app.querySelector('#sf').onsubmit = (e) => {
    e.preventDefault();
    const v = e.target.q.value.trim(); if (!v) return;
    const c = parseCoords(v);
    if (c) {
      map.flyTo({ center: [c.lon, c.lat], zoom: 13 });
      sheetHost.innerHTML = `<div class="sheet"><p style="font-weight:700;margin:0">${fmtCoord(c.lat, c.lon, S.coordMode)}</p><div class="btn-row" style="margin-top:12px"><a class="btn sun" href="#/spot-new?lat=${c.lat}&lon=${c.lon}">Créer un spot ici</a></div></div>`;
      return;
    }
    const s = (spots || []).find((x) => x.name.toLowerCase().includes(v.toLowerCase()));
    if (s) { map.flyTo({ center: [s.lon, s.lat], zoom: 13 }); showSheet(s); } else toast('Aucun spot ni coordonnées reconnus');
  };
}

/* ---------------- Spots ---------------- */
async function viewSpot(id) {
  const { data: s } = await sb.from('spots').select('*').eq('id', id).maybeSingle();
  if (!s) return notFound();
  const [{ data: catches }, { data: lures }] = await Promise.all([
    sb.from('catches').select('*').eq('spot_id', id).order('caught_at', { ascending: false }),
    sb.from('lures').select('id, name').eq('crew_id', S.crew.id),
  ]);
  const lureName = Object.fromEntries((lures || []).map((l) => [l.id, l.name]));
  const count = (arr) => Object.entries(arr.reduce((m, k) => (k ? ((m[k] = (m[k] || 0) + 1), m) : m), {})).sort((a, b) => b[1] - a[1]);
  const topSpecies = count((catches || []).map((c) => c.species)).slice(0, 3);
  const topLure = count((catches || []).map((c) => lureName[c.lure_id] || c.lure_name))[0];
  const hours = count((catches || []).map((c) => { const h = new Date(c.caught_at).getHours(); return h < 9 ? 'Aube / matin' : h < 13 ? 'Fin de matinée' : h < 18 ? 'Après-midi' : 'Soir'; }))[0];
  const url = await signed([s.photo_path, ...(catches || []).map((c) => c.photo_path)]);
  const mine = isMine(s);
  page(`<main class="screen">${topbar({ title: 'Fiche spot', back: true, right: mine ? `<a class="iconbtn" href="#/spot-edit/${s.id}" aria-label="Modifier">${icon('edit')}</a>` : '' })}
    ${s.photo_path && url(s.photo_path) ? `<img class="photo" src="${url(s.photo_path)}" alt="Capture sonar ou photo du spot">` : ''}
    <div><div class="row between"><h2 class="h" style="font-size:24px">${esc(s.name)}</h2><span class="badge-vis">${icon(s.visibility === 'crew' ? 'users' : 'lock', 14)}${s.visibility === 'crew' ? 'Équipe' : 'Privé'}</span></div>
      <div class="chips" style="margin-top:10px" id="cm">${['ddm', 'dms', 'dec'].map((m) => `<button class="chip ${S.coordMode === m ? 'on' : ''}" data-m="${m}">${{ ddm: 'DDM', dms: 'DMS', dec: 'Décimal' }[m]}</button>`).join('')}</div>
      <p id="coord" style="font-weight:700;font-size:16px;margin:10px 0 0">${fmtCoord(s.lat, s.lon, S.coordMode)}</p></div>
    <div class="card list" style="padding:4px 16px">
      ${[['Profondeur', s.depth_min || s.depth_max ? `${[s.depth_min, s.depth_max].filter((x) => x != null).map((x) => num(x, 0)).join(' – ')} m` : '—'], ['Fond', s.bottom || '—'], ['Créé par', `${nameOf(s.owner_id)} · ${fmtDate(s.created_at, { month: 'short', year: 'numeric' })}`]].map(([a, b]) => `<div class="list-item between"><span class="muted">${a}</span><b>${esc(b)}</b></div>`).join('')}
    </div>
    ${s.notes ? `<p style="margin:0;white-space:pre-wrap">${esc(s.notes)}</p>` : ''}
    <div class="grid2"><div class="card" style="padding:12px"><p class="small muted" style="margin:0">Meilleur leurre</p><b>${esc(topLure?.[0] || '—')}</b></div><div class="card" style="padding:12px"><p class="small muted" style="margin:0">Meilleur moment</p><b>${esc(hours?.[0] || '—')}</b></div></div>
    <p class="kicker" style="margin:4px 0 0">${(catches || []).length} prise${(catches || []).length > 1 ? 's' : ''} sur ce spot${topSpecies.length ? ` · ${topSpecies.map((x) => esc(x[0])).join(', ')}` : ''}</p>
    <div class="list card" style="padding:0 16px">${(catches || []).slice(0, 20).map((c) => `<a class="list-item" href="#/catch/${c.id}">${c.photo_path && url(c.photo_path) ? `<img class="thumb" src="${url(c.photo_path)}" alt="">` : `<span class="thumb">${icon('cam', 18)}</span>`}<div class="grow"><b>${esc(c.species)}</b> ${c.weight_kg ? `<span style="color:var(--sun-dark);font-weight:700">${kg(c.weight_kg)}</span>` : ''}<div class="small muted">${esc(nameOf(c.angler_id || c.created_by))} · ${fmtDate(c.caught_at)}</div></div>${icon('chev', 18)}</a>`).join('') || '<p class="muted">Pas encore de prise ici.</p>'}</div>
    <div class="btn-row"><button class="btn" id="gpx">${icon('sd', 18)}GPX pour le Solix</button><button class="btn sun" id="sh">${icon('share', 18)}Partager</button></div>
    <div class="btn-row"><a class="btn ghost" href="#/map?spot=${s.id}&lat=${s.lat}&lon=${s.lon}">${icon('map', 18)}Sur la carte</a><a class="btn ghost" href="#/catch-new?spot=${s.id}">${icon('plus', 18)}Prise ici</a></div>
  </main>`, { tab: 'map' });
  $app.querySelectorAll('#cm .chip').forEach((c) => (c.onclick = () => {
    S.coordMode = c.dataset.m; localStorage.setItem('coordMode', S.coordMode);
    $app.querySelectorAll('#cm .chip').forEach((x) => x.classList.toggle('on', x === c));
    $app.querySelector('#coord').textContent = fmtCoord(s.lat, s.lon, S.coordMode);
  }));
  $app.querySelector('#gpx').onclick = () => download(`${s.name.replace(/[^\w-]+/g, '_')}.gpx`, buildGPX({ spots: [s], name: s.name }));
  $app.querySelector('#sh').onclick = () => shareOrCopy(`${s.name}\n${fmtCoord(s.lat, s.lon, 'ddm')}\n${fmtCoord(s.lat, s.lon, 'dec')}${s.depth_min ? `\n${num(s.depth_min, 0)}${s.depth_max ? '–' + num(s.depth_max, 0) : ''} m` : ''}`, s.name);
}

async function viewSpotForm(id) {
  const q = qs();
  let s = { name: '', lat: q.lat ? +q.lat : null, lon: q.lon ? +q.lon : null, visibility: 'private' };
  if (id) { const { data } = await sb.from('spots').select('*').eq('id', id).maybeSingle(); if (!data || !isMine(data)) return notFound(); s = data; }
  const url = await signed([s.photo_path]);
  page(`<main class="screen">${topbar({ title: id ? 'Modifier le spot' : 'Nouveau spot', back: true })}
    <form id="f">
      <label class="f">Nom<input name="name" required maxlength="60" value="${esc(s.name)}" placeholder="Tombant 45"></label>
      <label class="f">Coordonnées (tous formats)<input name="coords" required value="${s.lat != null ? esc(fmtCoord(s.lat, s.lon, 'ddm')) : ''}" placeholder="35°48,214'N 5°58,930'W" autocomplete="off"></label>
      <p class="hint" id="ch" style="margin:-8px 0 0">${s.lat != null ? `Décimal : ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}` : 'Colle les coordonnées du Solix, ou utilise ta position.'}</p>
      <button type="button" class="btn ghost sm" id="gps">${icon('locate', 18)}Ma position actuelle</button>
      <div class="row"><label class="f">Profondeur min (m)<input name="dmin" type="number" inputmode="decimal" step="0.1" value="${s.depth_min ?? ''}"></label><label class="f">Profondeur max (m)<input name="dmax" type="number" inputmode="decimal" step="0.1" value="${s.depth_max ?? ''}"></label></div>
      <label class="f">Fond<select name="bottom"><option value="">—</option>${BOTTOMS.map((b) => `<option ${s.bottom === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <fieldset style="border:none;padding:0;margin:0"><legend class="small muted" style="font-weight:600;margin-bottom:6px">Visibilité</legend><div class="chips" id="vis">
        <button type="button" class="chip ${s.visibility === 'private' ? 'on' : ''}" data-v="private">${icon('lock', 14)}Privé (moi seul)</button>
        <button type="button" class="chip ${s.visibility === 'crew' ? 'on' : ''}" data-v="crew">${icon('users', 14)}Équipe</button></div></fieldset>
      <label class="f">Notes<textarea name="notes" placeholder="Approche, dérive, marée…">${esc(s.notes || '')}</textarea></label>
      <div><p class="small muted" style="font-weight:600;margin:0 0 6px">Capture sonar ou photo</p><label class="drop" id="pd">${s.photo_path && url(s.photo_path) ? `<img src="${url(s.photo_path)}" alt="">` : `${icon('cam', 24)}<span>Ajouter une image</span>`}<input type="file" name="photo" accept="image/*" aria-label="Capture sonar ou photo"></label></div>
      <button class="btn sun" type="submit">${id ? 'Enregistrer' : 'Créer le spot'}</button>
      ${id ? '<button class="btn danger" type="button" id="del">Supprimer ce spot</button>' : ''}
    </form></main>`, { tab: false });
  const f = $app.querySelector('#f');
  let vis = s.visibility, photo = null;
  const ch = $app.querySelector('#ch');
  const check = () => { const c = parseCoords(f.coords.value); ch.textContent = c ? `Décimal : ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}` : 'Format non reconnu'; ch.style.color = c ? '' : 'var(--danger)'; return c; };
  f.coords.oninput = check;
  $app.querySelectorAll('#vis .chip').forEach((c) => (c.onclick = () => { vis = c.dataset.v; $app.querySelectorAll('#vis .chip').forEach((x) => x.classList.toggle('on', x === c)); }));
  $app.querySelector('#gps').onclick = async () => { try { const p = await getPosition(); f.coords.value = fmtCoord(p.lat, p.lon, 'ddm'); check(); toast(`Précision ± ${Math.round(p.acc)} m`); } catch (e) { fail(e); } };
  f.photo.onchange = async () => { photo = f.photo.files[0]; if (photo) { const u = URL.createObjectURL(photo); $app.querySelector('#pd').insertAdjacentHTML('afterbegin', `<img src="${u}" alt="">`); } };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const c = check(); if (!c) return toast('Coordonnées invalides');
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const row = { crew_id: S.crew.id, name: f.name.value.trim(), lat: c.lat, lon: c.lon, depth_min: f.dmin.value || null, depth_max: f.dmax.value || null, bottom: f.bottom.value || null, notes: f.notes.value.trim() || null, visibility: vis };
      if (photo) row.photo_path = await upload(await compressImage(photo), 'spots', 'jpg');
      const r = id ? await sb.from('spots').update(row).eq('id', id).select().single() : await sb.from('spots').insert(row).select().single();
      if (r.error) throw r.error;
      toast(id ? 'Spot mis à jour' : 'Spot créé'); go(`#/spot/${r.data.id}`);
    } catch (err) { fail(err); btn.disabled = false; }
  };
  const del = $app.querySelector('#del');
  if (del) del.onclick = async () => { if (await confirmBox('Supprimer ce spot ? Les prises restent, sans spot associé.')) { const { error } = await sb.from('spots').delete().eq('id', id); error ? fail(error) : (toast('Spot supprimé'), go('#/map')); } };
}

/* ---------------- Import GPX (Solix) ---------------- */
function viewGPX() {
  page(`<main class="screen">${topbar({ title: 'Import Solix (GPX)', back: true })}
    <div class="card"><p style="margin:0 0 8px;font-weight:700">Depuis le Humminbird Solix</p>
      <ol class="muted" style="margin:0;padding-left:18px;font-size:14px"><li>Insère une carte SD (32 Go max) dans le Solix.</li><li>Accueil → <b>Mes données</b> → <b>Exporter tout</b>.</li><li>Mets le fichier .gpx sur ton téléphone (AirDrop, WhatsApp, Fichiers) et choisis-le ci-dessous.</li></ol></div>
    <label class="drop">${icon('upload', 26)}<span>Choisir un fichier .gpx</span><input type="file" id="file" accept=".gpx,application/gpx+xml,application/xml,text/xml"></label>
    <div id="res"></div>
    <div class="card"><p style="margin:0 0 8px;font-weight:700">Exporter vers le Solix</p><p class="muted small" style="margin:0 0 12px">Crée un GPX avec tes spots et ceux de l’équipe, à copier sur la carte SD puis importer dans le Solix.</p><button class="btn" id="exp">${icon('sd', 18)}Exporter tous les spots</button></div>
  </main>`, { tab: false });
  $app.querySelector('#exp').onclick = async () => {
    const { data } = await sb.from('spots').select('*').eq('crew_id', S.crew.id);
    if (!data?.length) return toast('Aucun spot à exporter');
    download(`spartel-spots-${todayISO()}.gpx`, buildGPX({ spots: data, name: 'Spartel' }));
  };
  $app.querySelector('#file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    let gpx;
    try { gpx = parseGPX(await file.text()); } catch (err) { return fail(err); }
    const res = $app.querySelector('#res');
    res.innerHTML = `${gpx.waypoints.length ? `<section class="card"><div class="row between"><b>${gpx.waypoints.length} waypoint${gpx.waypoints.length > 1 ? 's' : ''}</b><button class="btn sm ghost" id="all">Tout cocher</button></div>
      <div class="list" style="max-height:320px;overflow:auto;margin:8px 0">${gpx.waypoints.map((w, i) => `<label class="list-item"><input type="checkbox" data-i="${i}" checked style="width:20px;height:20px"><div class="grow"><b>${esc(w.name)}</b><div class="small muted">${fmtCoord(w.lat, w.lon, S.coordMode)}${w.depth != null ? ` · ${num(w.depth, 0)} m` : ''}</div></div></label>`).join('')}</div>
      <div class="chips" id="vis"><button type="button" class="chip on" data-v="private">${icon('lock', 14)}Privés</button><button type="button" class="chip" data-v="crew">${icon('users', 14)}Partagés à l’équipe</button></div>
      <button class="btn sun" id="imp" style="width:100%;margin-top:12px">Importer les spots</button></section>` : ''}
      ${gpx.tracks.map((t, i) => { const st = trackStats(t.points); return `<section class="card"><b>${esc(t.name)}</b><p class="small muted" style="margin:4px 0 12px">${t.points.length} points · ${st.distance_km} km${st.start ? ` · ${fmtDate(st.start)}` : ''}</p><button class="btn" data-trk="${i}" style="width:100%">${icon('boat', 18)}Créer une sortie avec ce track</button></section>`; }).join('')}
      ${!gpx.waypoints.length && !gpx.tracks.length ? '<p class="muted">Aucun waypoint ni track dans ce fichier.</p>' : ''}`;
    let vis = 'private';
    res.querySelectorAll('#vis .chip').forEach((c) => (c.onclick = () => { vis = c.dataset.v; res.querySelectorAll('#vis .chip').forEach((x) => x.classList.toggle('on', x === c)); }));
    const all = res.querySelector('#all'); if (all) all.onclick = () => { const boxes = res.querySelectorAll('[data-i]'); const on = [...boxes].some((b) => !b.checked); boxes.forEach((b) => (b.checked = on)); };
    const imp = res.querySelector('#imp');
    if (imp) imp.onclick = async () => {
      const rows = [...res.querySelectorAll('[data-i]:checked')].map((b) => gpx.waypoints[+b.dataset.i]).map((w) => ({
        crew_id: S.crew.id, name: w.name.slice(0, 60), lat: w.lat, lon: w.lon, notes: w.notes || null, depth_min: w.depth ?? null, visibility: vis, source: 'gpx',
      }));
      if (!rows.length) return toast('Rien de coché');
      imp.disabled = true;
      for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from('spots').insert(rows.slice(i, i + 200)); if (error) { imp.disabled = false; return fail(error); } }
      toast(`${rows.length} spots importés`); go('#/map');
    };
    res.querySelectorAll('[data-trk]').forEach((b) => (b.onclick = async () => {
      const t = gpx.tracks[+b.dataset.trk], st = trackStats(t.points);
      b.disabled = true;
      const { data, error } = await sb.from('trips').insert({ crew_id: S.crew.id, trip_date: (st.start || new Date().toISOString()).slice(0, 10), title: t.name, members: [S.user.id], track: simplify(t.points), stats: st }).select().single();
      if (error) { b.disabled = false; return fail(error); }
      toast('Sortie créée'); go(`#/trip/${data.id}`);
    }));
  };
}

/* ---------------- Prises ---------------- */
async function viewCatchForm() {
  const q = qs();
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const [{ data: lures }, { data: spots }, { data: trips }] = await Promise.all([
    sb.from('lures').select('*').eq('crew_id', S.crew.id).order('created_at', { ascending: false }),
    sb.from('spots').select('id, name, lat, lon, depth_min, visibility, owner_id').eq('crew_id', S.crew.id),
    sb.from('trips').select('id, trip_date, title, members').eq('crew_id', S.crew.id).gte('trip_date', since).order('trip_date', { ascending: false }),
  ]);
  const myLures = (lures || []).sort((a, b) => (isMine(b) - isMine(a)));
  const todayTrip = (trips || []).find((t) => t.trip_date === todayISO());
  const tripId = q.trip || todayTrip?.id || '';
  const crewOrder = [S.user.id, ...S.memberIds.filter((x) => x !== S.user.id)];
  const st = { angler: S.user.id, lure: '', pos: null, posSrc: '', spot: q.spot || '', photo: null, video: null, lurePhoto: null, released: false, vis: 'crew', photoMeta: null };
  if (q.spot) { const s = (spots || []).find((x) => x.id === q.spot); if (s) { st.pos = { lat: s.lat, lon: s.lon }; st.posSrc = `Spot · ${s.name}`; } }
  const url = await signed(myLures.map((l) => l.photo_path));

  page(`<main class="screen">${topbar({ title: 'Nouvelle prise', back: true })}
    <form id="f">
      <div class="row" style="align-items:stretch"><label class="drop" style="flex:2" id="pd">${icon('cam', 26)}<span>Photo du poisson</span><input type="file" name="photo" accept="image/*" aria-label="Photo du poisson"></label>
        <label class="drop" style="flex:1" id="vd">${icon('video', 22)}<span>Vidéo</span><input type="file" name="video" accept="video/*" aria-label="Vidéo"></label></div>
      <p class="hint" style="margin:-6px 0 0">Les coordonnées GPS cachées dans la photo sont retirées avant l’envoi.</p>
      <div><p class="small muted" style="font-weight:600;margin:0 0 8px">Qui l’a sorti ?</p><div class="chips wrap" id="ang">${crewOrder.map((id) => `<button type="button" class="chip ${id === st.angler ? 'on' : ''}" data-a="${id}">${esc(nameOf(id))}</button>`).join('')}</div></div>
      <label class="f">Espèce<input name="species" list="sp" required placeholder="Denti, loup, pagre…" autocomplete="off"><datalist id="sp">${SPECIES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
      <div class="row"><label class="f">Poids (kg)<input name="weight" type="number" inputmode="decimal" step="0.01" min="0"></label><label class="f">Taille (cm)<input name="length" type="number" inputmode="decimal" step="0.5" min="0"></label><label class="f">Profondeur (m)<input name="depth" type="number" inputmode="decimal" step="1" min="0"></label></div>
      <label class="f">Technique<select name="technique"><option value="">—</option>${TECHNIQUES.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <div><p class="small muted" style="font-weight:600;margin:0 0 8px">Leurre</p>
        <div class="chips" id="lures">${myLures.map((l) => `<button type="button" class="chip" data-l="${l.id}" style="padding:4px 12px 4px 4px">${l.photo_path && url(l.photo_path) ? `<img src="${url(l.photo_path)}" alt="" style="width:30px;height:30px;border-radius:8px;object-fit:cover">` : `<span class="thumb" style="width:30px;height:30px;border-radius:8px">${icon('lure', 16)}</span>`}${esc(l.name)}${!isMine(l) ? ` <span class="small muted">· ${esc(nameOf(l.owner_id))}</span>` : ''}</button>`).join('')}<button type="button" class="chip" data-l="new">${icon('plus', 14)}Nouveau leurre</button></div>
        <div id="newLure" hidden style="margin-top:10px" class="card"><div class="row" style="align-items:stretch"><label class="drop" style="width:96px;min-height:96px;flex:none">${icon('cam', 20)}<span class="small">Photo</span><input type="file" name="lurePhoto" accept="image/*" aria-label="Photo du leurre"></label><div class="grow" style="display:flex;flex-direction:column;gap:8px"><label class="f">Nom du leurre<input name="lureName" placeholder="Jig 80 g sardine"></label><label class="switch" style="font-size:13px">Ajouter à ma boîte<input type="checkbox" name="lureSave" checked></label></div></div></div>
      </div>
      <div class="posbox"><div class="row">${icon('pin', 18)}<b class="grow" id="posTxt">${st.pos ? `${esc(st.posSrc)} · ${fmtCoord(st.pos.lat, st.pos.lon, S.coordMode)}` : 'Position : à définir'}</b></div>
        <div class="chips"><button type="button" class="chip" id="pGps">${icon('locate', 14)}Mon GPS</button><button type="button" class="chip" id="pSpot">${icon('pin', 14)}Un spot</button><button type="button" class="chip" id="pPhoto" disabled>${icon('cam', 14)}GPS de la photo</button><button type="button" class="chip" id="pType">Saisir</button></div>
        <p class="small muted" style="margin:0">Vent, houle, température de l’eau et lune sont ajoutés automatiquement.</p></div>
      <div class="row"><label class="f">Date et heure<input name="when" type="datetime-local" value="${localDT()}" required></label></div>
      <label class="f">Sortie<select name="trip"><option value="">Aucune</option>${(trips || []).map((t) => `<option value="${t.id}" ${t.id === tripId ? 'selected' : ''}>${esc(fmtDate(t.trip_date))}${t.title ? ' · ' + esc(t.title) : ''}</option>`).join('')}</select></label>
      <label class="switch">Relâché<input type="checkbox" name="released"></label>
      <label class="switch">Visible seulement par moi<input type="checkbox" name="private"></label>
      <label class="f">Notes<textarea name="notes" placeholder="Dérive, touche, combat…"></textarea></label>
      <button class="btn sun" type="submit">Enregistrer la prise</button>
    </form></main>`, { tab: false });

  const f = $app.querySelector('#f');
  const posTxt = $app.querySelector('#posTxt');
  const setPos = (p, src, spotId = '') => { st.pos = p; st.posSrc = src; st.spot = spotId; posTxt.textContent = `${src} · ${fmtCoord(p.lat, p.lon, S.coordMode)}`; };
  $app.querySelectorAll('#ang .chip').forEach((c) => (c.onclick = () => { st.angler = c.dataset.a; $app.querySelectorAll('#ang .chip').forEach((x) => x.classList.toggle('on', x === c)); }));
  $app.querySelectorAll('#lures .chip').forEach((c) => (c.onclick = () => {
    st.lure = st.lure === c.dataset.l ? '' : c.dataset.l;
    $app.querySelectorAll('#lures .chip').forEach((x) => x.classList.toggle('on', x.dataset.l === st.lure));
    $app.querySelector('#newLure').hidden = st.lure !== 'new';
    const l = myLures.find((x) => x.id === st.lure);
    if (l && l.lure_type && !f.technique.value) { const map = { Jig: 'Jig', 'Slow jig': 'Slow jig', Madaï: 'Madaï / tenya', Stickbait: 'Surface (popper, stickbait)', Popper: 'Surface (popper, stickbait)', 'Poisson nageur': 'Poisson nageur', 'Leurre souple': 'Leurre souple', Turlutte: 'Turlutte' }; if (map[l.lure_type]) f.technique.value = map[l.lure_type]; }
  }));
  f.photo.onchange = async () => {
    st.photo = f.photo.files[0]; if (!st.photo) return;
    $app.querySelector('#pd').insertAdjacentHTML('afterbegin', `<img src="${URL.createObjectURL(st.photo)}" alt="">`);
    st.photoMeta = await readPhotoMeta(st.photo);
    const pp = $app.querySelector('#pPhoto');
    if (st.photoMeta.lat != null) { pp.disabled = false; if (!st.pos) setPos({ lat: st.photoMeta.lat, lon: st.photoMeta.lon }, 'Photo'); }
    if (st.photoMeta.takenAt) f.when.value = localDT(st.photoMeta.takenAt);
  };
  f.video.onchange = () => {
    const v = f.video.files[0]; if (!v) return;
    if (v.size > MAX_VIDEO_MB * 1048576) { toast(`Vidéo trop lourde (max ${MAX_VIDEO_MB} Mo). Coupe-la ou envoie un extrait.`, 5000); f.video.value = ''; return; }
    st.video = v; $app.querySelector('#vd').insertAdjacentHTML('afterbegin', `<video src="${URL.createObjectURL(v)}" muted playsinline></video>`);
  };
  f.lurePhoto.onchange = () => { st.lurePhoto = f.lurePhoto.files[0]; if (st.lurePhoto) f.lurePhoto.closest('.drop').insertAdjacentHTML('afterbegin', `<img src="${URL.createObjectURL(st.lurePhoto)}" alt="">`); };
  $app.querySelector('#pGps').onclick = async () => { try { const p = await getPosition(); const near = nearestSpot(p, spots); setPos(p, near ? `GPS (près de ${near.name})` : 'GPS', near?.id || ''); } catch (e) { fail(e); } };
  $app.querySelector('#pPhoto').onclick = () => st.photoMeta?.lat != null && setPos({ lat: st.photoMeta.lat, lon: st.photoMeta.lon }, 'Photo');
  $app.querySelector('#pType').onclick = () => {
    const m = modal(`<form id="cf"><label class="f">Coordonnées<input name="c" required placeholder="35°48,214'N 5°58,930'W" autocomplete="off"></label><button class="btn sun">Valider</button></form>`);
    m.querySelector('#cf').onsubmit = (e) => { e.preventDefault(); const c = parseCoords(e.target.c.value); if (!c) return toast('Format non reconnu'); setPos(c, 'Saisi'); m.remove(); };
  };
  $app.querySelector('#pSpot').onclick = () => {
    const list = [...(spots || [])].sort((a, b) => (st.pos ? haversine([a.lat, a.lon], [st.pos.lat, st.pos.lon]) - haversine([b.lat, b.lon], [st.pos.lat, st.pos.lon]) : a.name.localeCompare(b.name)));
    const m = modal(`<p class="h" style="font-size:16px;margin-bottom:8px">Choisir un spot</p><div class="list">${list.map((s) => `<button type="button" class="list-item" data-s="${s.id}" style="width:100%;background:none;border:none;text-align:left">${icon(s.visibility === 'crew' ? 'users' : 'lock', 16)}<span class="grow"><b>${esc(s.name)}</b><br><span class="small muted">${fmtCoord(s.lat, s.lon, S.coordMode)}</span></span></button>`).join('') || '<p class="muted">Aucun spot. Crée-en un depuis la carte.</p>'}</div>`);
    m.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { const s = list.find((x) => x.id === b.dataset.s); setPos({ lat: s.lat, lon: s.lon }, `Spot · ${s.name}`, s.id); if (s.depth_min && !f.depth.value) f.depth.value = s.depth_min; m.remove(); }));
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      const payload = {
        crew_id: S.crew.id, angler_id: st.angler, species: f.species.value.trim(),
        weight_kg: f.weight.value || null, length_cm: f.length.value || null, depth_m: f.depth.value || null,
        technique: f.technique.value || null, lure_id: st.lure && st.lure !== 'new' ? st.lure : null,
        lure_name: st.lure === 'new' ? (f.lureName.value.trim() || null) : null,
        lat: st.pos?.lat ?? null, lon: st.pos?.lon ?? null, spot_id: st.spot || null,
        caught_at: new Date(f.when.value).toISOString(), trip_id: f.trip.value || null,
        released: f.released.checked, visibility: f.private.checked ? 'private' : 'crew', notes: f.notes.value.trim() || null,
      };
      const item = {
        id: uuid(), payload,
        photo: st.photo ? await compressImage(st.photo) : null,
        video: st.video || null,
        lurePhoto: st.lure === 'new' && st.lurePhoto ? await compressImage(st.lurePhoto, 1000) : null,
        saveLure: st.lure === 'new' && f.lureSave.checked && !!payload.lure_name,
      };
      if (!navigator.onLine) { await queueAdd(item); toast('Pas de réseau : prise gardée sur le téléphone, envoi automatique au retour du réseau.', 5000); return go('#/'); }
      try {
        const id = await submitCatch(item);
        toast('Prise enregistrée'); go(`#/catch/${id}`);
      } catch (err) {
        if (isNetworkError(err)) { await queueAdd(item); toast('Réseau instable : prise gardée, elle sera envoyée plus tard.', 5000); go('#/'); }
        else throw err;
      }
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Enregistrer la prise'; }
  };
}
function nearestSpot(p, spots, maxM = 400) {
  let best = null, bd = Infinity;
  (spots || []).forEach((s) => { const d = haversine([p.lat, p.lon], [s.lat, s.lon]); if (d < bd) { bd = d; best = s; } });
  return bd <= maxM ? best : null;
}
const isNetworkError = (e) => e instanceof TypeError || /fetch|network|Failed to fetch|Load failed/i.test(e?.message || '');

async function submitCatch(item) {
  const p = { ...item.payload };
  if (item.photo) p.photo_path = await upload(item.photo, 'catches', 'jpg');
  if (item.video) p.video_path = await upload(item.video, 'videos', extOf(item.video, 'mp4'));
  if (item.lurePhoto) p.lure_photo_path = await upload(item.lurePhoto, 'lures', 'jpg');
  if (item.saveLure && p.lure_name) {
    const { data: l, error } = await sb.from('lures').insert({ crew_id: p.crew_id, name: p.lure_name, photo_path: p.lure_photo_path || null }).select().single();
    if (!error) { p.lure_id = l.id; }
  }
  if (p.lat != null) p.conditions = await fetchConditions(p.lat, p.lon, p.caught_at);
  else p.conditions = { moon: moonPhase(new Date(p.caught_at)) };
  const { data, error } = await sb.from('catches').insert(p).select('id').single();
  if (error) throw error;
  return data.id;
}
let syncing = false;
async function syncQueue(manual = false) {
  if (syncing || !S.crew || !navigator.onLine) return;
  syncing = true;
  try {
    const items = await queueAll();
    let ok = 0;
    for (const it of items) {
      try { await submitCatch(it); await queueDelete(it.id); ok++; } catch (e) { if (!isNetworkError(e)) { console.error(e); } break; }
    }
    if (ok) { toast(`${ok} prise${ok > 1 ? 's' : ''} envoyée${ok > 1 ? 's' : ''}`); if (location.hash === '' || location.hash === '#/') viewHome(); }
    else if (manual && items.length) toast('Toujours pas de réseau');
  } finally { syncing = false; }
}

async function viewCatch(id) {
  const { data: c } = await sb.from('catches').select('*').eq('id', id).maybeSingle();
  if (!c) return notFound();
  const [{ data: spot }, { data: lure }, { data: trip }] = await Promise.all([
    c.spot_id ? sb.from('spots').select('id, name').eq('id', c.spot_id).maybeSingle() : { data: null },
    c.lure_id ? sb.from('lures').select('*').eq('id', c.lure_id).maybeSingle() : { data: null },
    c.trip_id ? sb.from('trips').select('id, trip_date, title').eq('id', c.trip_id).maybeSingle() : { data: null },
  ]);
  const url = await signed([c.photo_path, c.video_path, c.lure_photo_path, lure?.photo_path]);
  const k = c.conditions || {};
  const a = c.angler_id || c.created_by;
  const lp = c.lure_photo_path || lure?.photo_path;
  const cond = [
    ['wind', k.wind_speed_10m != null ? `${Math.round(k.wind_speed_10m)} nds ${windDir(k.wind_direction_10m)}` : null, 'Vent'],
    ['wave', k.wave_height != null ? `${num(k.wave_height)} m` : null, 'Houle'],
    ['temp', k.sea_surface_temperature != null ? `${num(k.sea_surface_temperature)} °C` : null, 'Eau'],
    ['moon', k.moon ? `${k.moon.illumination} %` : null, k.moon?.label || 'Lune'],
  ];
  page(`<main class="screen">${topbar({ title: 'Prise', back: true, right: `<button class="iconbtn" id="sh" aria-label="Partager">${icon('share')}</button>` })}
    ${c.photo_path && url(c.photo_path) ? `<img class="photo" src="${url(c.photo_path)}" alt="${esc(c.species)}">` : ''}
    ${c.video_path && url(c.video_path) ? `<video class="photo" src="${url(c.video_path)}" controls playsinline preload="metadata"></video>` : ''}
    <div class="row between"><h2 class="h" style="font-size:24px">${esc(c.species)}</h2><b style="color:var(--sun-dark);font-size:22px">${kg(c.weight_kg)}</b></div>
    <div class="row">${avatar(a)}<div><b>${esc(nameOf(a))}</b><div class="small muted">${fmtDate(c.caught_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtTime(c.caught_at)}${c.created_by !== a ? ` · saisi par ${esc(nameOf(c.created_by))}` : ''}</div></div></div>
    <div class="card list" style="padding:4px 16px">${[
      ['Taille', c.length_cm ? `${num(c.length_cm)} cm` : null], ['Profondeur', c.depth_m ? `${num(c.depth_m, 0)} m` : null], ['Technique', c.technique],
      ['Spot', spot ? `<a href="#/spot/${spot.id}">${esc(spot.name)}</a>` : null, true], ['Position', c.lat != null ? fmtCoord(c.lat, c.lon, S.coordMode) : null],
      ['Sortie', trip ? `<a href="#/trip/${trip.id}">${esc(fmtDate(trip.trip_date))}${trip.title ? ' · ' + esc(trip.title) : ''}</a>` : null, true],
      ['Relâché', c.released ? 'Oui' : 'Non'], ['Visibilité', c.visibility === 'crew' ? 'Équipe' : 'Moi seul'],
    ].filter((r) => r[1]).map(([x, y, raw]) => `<div class="list-item between"><span class="muted">${x}</span><b style="text-align:right">${raw ? y : esc(y)}</b></div>`).join('')}</div>
    ${lure || c.lure_name ? `<div class="card row">${lp && url(lp) ? `<img class="thumb" src="${url(lp)}" alt="Leurre">` : `<span class="thumb">${icon('lure')}</span>`}<div class="grow"><p class="small muted" style="margin:0">Leurre</p><b>${esc(lure?.name || c.lure_name)}</b>${lure ? `<div class="small muted">${esc([lure.lure_type, lure.weight_g ? lure.weight_g + ' g' : null, lure.color].filter(Boolean).join(' · '))}</div>` : ''}</div>${lure ? `<a class="iconbtn" href="#/lure/${lure.id}" aria-label="Voir le leurre">${icon('chev')}</a>` : ''}</div>` : ''}
    <section class="card"><p class="kicker" style="margin:0 0 10px">Conditions au moment de la prise</p><div class="stats">${cond.map(([ic, v, l]) => `<div class="stat">${icon(ic, 20)}<b>${v ?? '—'}</b><span>${esc(l)}</span></div>`).join('')}</div>${k.pressure_msl ? `<p class="small muted" style="margin:10px 0 0;text-align:center">Pression ${Math.round(k.pressure_msl)} hPa${k.wind_gusts_10m ? ` · rafales ${Math.round(k.wind_gusts_10m)} nds` : ''}${k.wave_period ? ` · période ${num(k.wave_period)} s` : ''}</p>` : ''}</section>
    ${c.notes ? `<p style="margin:0;white-space:pre-wrap">${esc(c.notes)}</p>` : ''}
    ${c.created_by === S.user.id ? '<button class="btn danger" id="del">Supprimer cette prise</button>' : ''}
  </main>`, { tab: 'home' });
  $app.querySelector('#sh').onclick = () => shareOrCopy(`${nameOf(a)} — ${c.species}${c.weight_kg ? ' ' + kg(c.weight_kg) : ''}${spot && c.visibility === 'crew' ? ' · ' + spot.name : ''} · ${fmtDate(c.caught_at)}`);
  const del = $app.querySelector('#del');
  if (del) del.onclick = async () => { if (await confirmBox('Supprimer cette prise ?')) { const { error } = await sb.from('catches').delete().eq('id', id); error ? fail(error) : (toast('Prise supprimée'), go('#/')); } };
}

/* ---------------- Leurres ---------------- */
async function viewLures() {
  const q = qs(); const scope = q.scope || 'mine';
  const [{ data: lures }, { data: catches }] = await Promise.all([
    sb.from('lures').select('*').eq('crew_id', S.crew.id).order('created_at', { ascending: false }),
    sb.from('catches').select('lure_id, species').eq('crew_id', S.crew.id).not('lure_id', 'is', null),
  ]);
  const stats = {};
  (catches || []).forEach((c) => { const s = (stats[c.lure_id] ||= { n: 0, sp: {} }); s.n++; s.sp[c.species] = (s.sp[c.species] || 0) + 1; });
  const list = (lures || []).filter((l) => scope === 'crew' || isMine(l)).sort((a, b) => (stats[b.id]?.n || 0) - (stats[a.id]?.n || 0));
  const url = await signed(list.map((l) => l.photo_path));
  page(`<main class="screen">${topbar({ right: `<a class="btn sun sm" href="#/lure-new">${icon('cam', 16)}Ajouter</a>` })}
    <h2 class="h" style="font-size:24px">${scope === 'crew' ? 'Leurres de l’équipe' : 'Ma boîte à leurres'}</h2>
    <div class="chips"><a class="chip ${scope === 'mine' ? 'on' : ''}" href="#/lures?scope=mine">Ma boîte</a><a class="chip ${scope === 'crew' ? 'on' : ''}" href="#/lures?scope=crew">Équipe · classement</a></div>
    ${list.length ? `<div class="grid2">${list.map((l) => { const s = stats[l.id]; const sp = s ? Object.entries(s.sp).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]).join(', ') : ''; return `<a class="card" href="#/lure/${l.id}" style="padding:10px;text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:6px">${l.photo_path && url(l.photo_path) ? `<img class="photo" style="aspect-ratio:1" loading="lazy" src="${url(l.photo_path)}" alt="${esc(l.name)}">` : `<span class="photo" style="aspect-ratio:1">${icon('lure', 30)}</span>`}<b class="ellipsis">${esc(l.name)}</b><span class="small muted ellipsis">${esc([l.lure_type, l.weight_g ? l.weight_g + ' g' : null, l.color].filter(Boolean).join(' · ') || ' ')}</span><span class="row between small" style="font-weight:600"><span style="color:var(--sun-dark)">${s?.n || 0} prise${(s?.n || 0) > 1 ? 's' : ''}</span>${scope === 'crew' && !isMine(l) ? `<span class="muted">${esc(nameOf(l.owner_id))}</span>` : `<span class="muted ellipsis">${esc(sp)}</span>`}</span></a>`; }).join('')}</div>`
    : `<div class="empty card">${icon('lure', 34)}<p>Ta boîte est vide.<br>Ajoute tes leurres avec une photo pour savoir lesquels prennent.</p><a class="btn sun" href="#/lure-new">Ajouter un leurre</a></div>`}
  </main>`, { tab: 'lures' });
}

async function viewLureForm(id) {
  let l = { name: '' };
  if (id) { const { data } = await sb.from('lures').select('*').eq('id', id).maybeSingle(); if (!data) return notFound(); l = data; }
  const mine = !id || isMine(l);
  const url = await signed([l.photo_path]);
  let catchesHtml = '';
  if (id) {
    const { data: cs } = await sb.from('catches').select('id, species, weight_kg, caught_at, angler_id, created_by').eq('lure_id', id).order('caught_at', { ascending: false }).limit(30);
    catchesHtml = `<p class="kicker" style="margin:6px 0 0">${(cs || []).length} prise${(cs || []).length > 1 ? 's' : ''} avec ce leurre</p><div class="card list" style="padding:0 16px">${(cs || []).map((c) => `<a class="list-item" href="#/catch/${c.id}"><div class="grow"><b>${esc(c.species)}</b> <span style="color:var(--sun-dark);font-weight:700">${kg(c.weight_kg)}</span><div class="small muted">${esc(nameOf(c.angler_id || c.created_by))} · ${fmtDate(c.caught_at)}</div></div>${icon('chev', 18)}</a>`).join('') || '<p class="muted">Aucune pour l’instant.</p>'}</div>`;
  }
  if (!mine) {
    page(`<main class="screen">${topbar({ title: 'Leurre', back: true })}${l.photo_path && url(l.photo_path) ? `<img class="photo" src="${url(l.photo_path)}" alt="">` : ''}<h2 class="h" style="font-size:22px">${esc(l.name)}</h2><p class="muted" style="margin:0">${esc([l.brand, l.lure_type, l.weight_g ? l.weight_g + ' g' : null, l.color].filter(Boolean).join(' · '))} · boîte de ${esc(nameOf(l.owner_id))}</p>${catchesHtml}</main>`, { tab: 'lures' });
    return;
  }
  page(`<main class="screen">${topbar({ title: id ? 'Mon leurre' : 'Nouveau leurre', back: true })}
    <form id="f">
      <label class="drop" style="min-height:180px" id="pd">${l.photo_path && url(l.photo_path) ? `<img src="${url(l.photo_path)}" alt="">` : `${icon('cam', 28)}<span>Photo du leurre</span>`}<input type="file" name="photo" accept="image/*" aria-label="Photo du leurre"></label>
      <label class="f">Nom<input name="name" required maxlength="60" value="${esc(l.name)}" placeholder="Jig 80 g sardine"></label>
      <div class="row"><label class="f">Marque<input name="brand" maxlength="40" value="${esc(l.brand || '')}"></label><label class="f">Type<select name="type"><option value="">—</option>${LURE_TYPES.map((t) => `<option ${l.lure_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <div class="row"><label class="f">Poids (g)<input name="weight" type="number" inputmode="decimal" step="1" value="${l.weight_g ?? ''}"></label><label class="f">Couleur<input name="color" maxlength="40" value="${esc(l.color || '')}"></label></div>
      <button class="btn sun" type="submit">${id ? 'Enregistrer' : 'Ajouter à ma boîte'}</button>
      ${id ? '<button type="button" class="btn danger" id="del">Retirer de ma boîte</button>' : ''}
    </form>${catchesHtml}</main>`, { tab: 'lures' });
  const f = $app.querySelector('#f'); let photo = null;
  f.photo.onchange = () => { photo = f.photo.files[0]; if (photo) $app.querySelector('#pd').insertAdjacentHTML('afterbegin', `<img src="${URL.createObjectURL(photo)}" alt="">`); };
  f.onsubmit = async (e) => {
    e.preventDefault(); const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const row = { crew_id: S.crew.id, name: f.name.value.trim(), brand: f.brand.value.trim() || null, lure_type: f.type.value || null, weight_g: f.weight.value || null, color: f.color.value.trim() || null };
      if (photo) row.photo_path = await upload(await compressImage(photo, 1000), 'lures', 'jpg');
      const r = id ? await sb.from('lures').update(row).eq('id', id) : await sb.from('lures').insert(row);
      if (r.error) throw r.error;
      toast(id ? 'Leurre mis à jour' : 'Leurre ajouté'); go('#/lures');
    } catch (err) { fail(err); btn.disabled = false; }
  };
  const del = $app.querySelector('#del');
  if (del) del.onclick = async () => { if (await confirmBox('Retirer ce leurre ? Les prises gardent son nom.')) { const { error } = await sb.from('lures').delete().eq('id', id); error ? fail(error) : (toast('Leurre retiré'), go('#/lures')); } };
}

/* ---------------- Sorties ---------------- */
async function viewTrips() {
  const [{ data: trips }, { data: cs }] = await Promise.all([
    sb.from('trips').select('*').eq('crew_id', S.crew.id).order('trip_date', { ascending: false }).limit(100),
    sb.from('catches').select('trip_id').eq('crew_id', S.crew.id).not('trip_id', 'is', null),
  ]);
  const n = {}; (cs || []).forEach((c) => (n[c.trip_id] = (n[c.trip_id] || 0) + 1));
  page(`<main class="screen">${topbar({ title: 'Sorties', back: true, right: `<a class="btn sun sm" href="#/trip-new">${icon('plus', 16)}Sortie</a>` })}
    <div class="card list" style="padding:0 16px">${(trips || []).map((t) => `<a class="list-item" href="#/trip/${t.id}"><span class="thumb" style="background:var(--navy);color:#fff">${icon('boat')}</span><div class="grow"><b>${esc(fmtDate(t.trip_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</b><div class="small muted ellipsis">${esc([t.title, t.boat_name, `${t.members?.length || 0} à bord`].filter(Boolean).join(' · '))}</div></div><b style="color:var(--sun-dark)">${n[t.id] || 0}</b>${icon('chev', 18)}</a>`).join('') || '<p class="muted">Aucune sortie. Crée-en une ou importe un track du Solix.</p>'}</div>
    <a class="btn dashed" href="#/gpx">${icon('sd', 18)}Importer un track du Solix</a>
  </main>`, { tab: 'home' });
}

async function viewTripForm(id) {
  let t = { trip_date: todayISO(), members: [S.user.id] };
  if (id) { const { data } = await sb.from('trips').select('*').eq('id', id).maybeSingle(); if (!data) return notFound(); t = data; }
  const members = new Set(t.members || []);
  page(`<main class="screen">${topbar({ title: id ? 'Modifier la sortie' : 'Nouvelle sortie', back: true })}
    <form id="f">
      <label class="f">Date<input name="date" type="date" required value="${t.trip_date}"></label>
      <label class="f">Titre<input name="title" maxlength="60" value="${esc(t.title || '')}" placeholder="Sortie jig au cap"></label>
      <label class="f">Bateau<input name="boat" maxlength="40" value="${esc(t.boat_name || '')}" placeholder="Nom du bateau"></label>
      <div><p class="small muted" style="font-weight:600;margin:0 0 8px">Équipage à bord</p><div class="chips wrap" id="mem">${S.memberIds.map((m) => `<button type="button" class="chip ${members.has(m) ? 'on' : ''}" data-m="${m}" aria-pressed="${members.has(m)}">${esc(nameOf(m))}</button>`).join('')}</div></div>
      <label class="drop" style="min-height:80px">${icon('sd', 22)}<span id="gl">${t.track ? 'Remplacer le track (GPX)' : 'Track du Solix (GPX) — facultatif'}</span><input type="file" name="gpx" accept=".gpx,application/gpx+xml,application/xml,text/xml"></label>
      <label class="f">Notes<textarea name="notes">${esc(t.notes || '')}</textarea></label>
      <button class="btn sun" type="submit">${id ? 'Enregistrer' : 'Créer la sortie'}</button>
      ${id && t.created_by === S.user.id ? '<button type="button" class="btn danger" id="del">Supprimer la sortie</button>' : ''}
    </form></main>`, { tab: false });
  const f = $app.querySelector('#f'); let track = null;
  $app.querySelectorAll('#mem .chip').forEach((c) => (c.onclick = () => { const m = c.dataset.m; members.has(m) ? members.delete(m) : members.add(m); c.classList.toggle('on'); c.setAttribute('aria-pressed', members.has(m)); }));
  f.gpx.onchange = async () => {
    try { const g = parseGPX(await f.gpx.files[0].text()); const all = g.tracks.flatMap((x) => x.points); if (!all.length) return toast('Pas de track dans ce fichier'); track = all; $app.querySelector('#gl').textContent = `${all.length} points · ${trackStats(all).distance_km} km`; } catch (e) { fail(e); }
  };
  f.onsubmit = async (e) => {
    e.preventDefault(); const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const row = { crew_id: S.crew.id, trip_date: f.date.value, title: f.title.value.trim() || null, boat_name: f.boat.value.trim() || null, members: [...members], notes: f.notes.value.trim() || null };
    if (track) { row.track = simplify(track); row.stats = trackStats(track); }
    const r = id ? await sb.from('trips').update(row).eq('id', id).select().single() : await sb.from('trips').insert(row).select().single();
    if (r.error) { btn.disabled = false; return fail(r.error); }
    toast(id ? 'Sortie mise à jour' : 'Sortie créée'); go(`#/trip/${r.data.id}`);
  };
  const del = $app.querySelector('#del');
  if (del) del.onclick = async () => { if (await confirmBox('Supprimer cette sortie ? Les prises restent.')) { const { error } = await sb.from('trips').delete().eq('id', id); error ? fail(error) : (toast('Sortie supprimée'), go('#/trips')); } };
}

async function viewTrip(id) {
  const { data: t } = await sb.from('trips').select('*').eq('id', id).maybeSingle();
  if (!t) return notFound();
  const { data: cs } = await sb.from('catches').select('*').eq('trip_id', id).order('caught_at');
  const url = await signed((cs || []).map((c) => c.photo_path));
  const st = t.stats || {};
  const dur = st.duration_min ? `${Math.floor(st.duration_min / 60)} h ${String(st.duration_min % 60).padStart(2, '0')}` : '—';
  const canEdit = t.created_by === S.user.id || (t.members || []).includes(S.user.id);
  page(`<main class="screen">${topbar({ title: 'Sortie', back: true, right: canEdit ? `<a class="iconbtn" href="#/trip-edit/${t.id}" aria-label="Modifier">${icon('edit')}</a>` : '' })}
    <div><h2 class="h" style="font-size:22px">${esc(fmtDate(t.trip_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</h2><p class="muted" style="margin:4px 0 0">${esc([t.title, t.boat_name].filter(Boolean).join(' · '))}${t.members?.length ? `${t.title || t.boat_name ? ' · ' : ''}${t.members.map((m) => esc(nameOf(m))).join(', ')}` : ''}</p></div>
    ${t.track?.length || (cs || []).some((c) => c.lat != null) ? '<div class="minimap" id="tmap" role="img" aria-label="Carte de la sortie"></div>' : `<a class="btn dashed" href="#/trip-edit/${t.id}">${icon('sd', 18)}Ajouter le track du Solix</a>`}
    <div class="card stats" style="padding:14px 0">${[['clock', dur, 'Durée'], ['nav', st.distance_km != null ? `${num(st.distance_km)} km` : '—', 'Distance'], ['wind', st.max_speed_kn ? `${num(st.max_speed_kn)} nds` : '—', 'Vitesse max'], ['trophy', (cs || []).length, 'Prises']].map(([i, v, l]) => `<div class="stat">${icon(i, 20)}<b>${v}</b><span>${l}</span></div>`).join('')}</div>
    <p class="kicker" style="margin:0">Fil de la sortie</p>
    <div class="card list timeline" style="padding:0 16px">${(cs || []).map((c) => `<a class="list-item" href="#/catch/${c.id}"><span class="time">${fmtTime(c.caught_at)}</span><span class="dot"></span>${c.photo_path && url(c.photo_path) ? `<img class="thumb" src="${url(c.photo_path)}" alt="" style="width:44px;height:44px">` : ''}<div class="grow"><b>${esc(c.species)} ${c.weight_kg ? kg(c.weight_kg) : ''}</b><div class="small muted">${esc(nameOf(c.angler_id || c.created_by))}${c.depth_m ? ` · ${num(c.depth_m, 0)} m` : ''}</div></div></a>`).join('') || '<p class="muted">Pas encore de prise sur cette sortie.</p>'}</div>
    <div class="btn-row"><a class="btn sun" href="#/catch-new?trip=${t.id}">${icon('plus', 18)}Ajouter une prise</a>${t.track?.length ? `<button class="btn ghost" id="exp">${icon('sd', 18)}GPX</button>` : ''}</div>
  </main>`, { tab: 'home' });
  const exp = $app.querySelector('#exp');
  if (exp) exp.onclick = () => download(`sortie-${t.trip_date}.gpx`, buildGPX({ track: t.track, name: t.title || `Sortie ${t.trip_date}` }));
  const el = $app.querySelector('#tmap');
  if (el) {
    const map = new maplibregl.Map({ container: el, style: baseStyle(), center: [HOME_POS.lon, HOME_POS.lat], zoom: 10, attributionControl: { compact: true } });
    S.cleanup.push(() => map.remove());
    map.on('load', () => {
      const b = new maplibregl.LngLatBounds();
      if (t.track?.length) { addTrackLayer(map, 'trk', t.track); t.track.forEach((p) => b.extend([p[1], p[0]])); }
      (cs || []).filter((c) => c.lat != null).forEach((c) => {
        const elm = pinEl('#0B1F33', c.species); elm.onclick = () => go(`#/catch/${c.id}`);
        new maplibregl.Marker({ element: elm, anchor: 'bottom' }).setLngLat([c.lon, c.lat]).addTo(map); b.extend([c.lon, c.lat]);
      });
      if (!b.isEmpty()) map.fitBounds(b, { padding: 30, maxZoom: 14, duration: 0 });
    });
  }
}

/* ---------------- Équipe ---------------- */
async function viewCrew() {
  const [{ data: cs }, { count: spotCount }] = await Promise.all([
    sb.from('catches').select('angler_id, created_by, species, weight_kg').eq('crew_id', S.crew.id),
    sb.from('spots').select('id', { count: 'exact', head: true }).eq('crew_id', S.crew.id).eq('visibility', 'crew'),
  ]);
  const by = {};
  S.memberIds.forEach((m) => (by[m] = { n: 0, best: null }));
  (cs || []).forEach((c) => { const a = c.angler_id || c.created_by; const o = (by[a] ||= { n: 0, best: null }); o.n++; if (c.weight_kg && (!o.best || +c.weight_kg > +o.best.weight_kg)) o.best = c; });
  const ranking = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
  const link = `${location.origin}${location.pathname}?join=${S.crew.invite_code}`;
  page(`<main class="screen">${topbar({ right: `<button class="iconbtn" id="lo" aria-label="Se déconnecter">${icon('logout')}</button>` })}
    <section class="card dark row" style="gap:14px"><img src="icons/badge.svg" alt="" width="96" height="96"><div><h2 class="h" style="font-size:20px">${esc(S.crew.name)}</h2><p class="small muted" style="margin:4px 0 0">${S.memberIds.length} pêcheur${S.memberIds.length > 1 ? 's' : ''} · ${spotCount || 0} spots en commun · ${(cs || []).length} prises</p></div></section>
    ${S.crews.length > 1 ? `<div class="chips">${S.crews.map((c) => `<button class="chip ${c.id === S.crew.id ? 'on' : ''}" data-crew="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : ''}
    <p class="kicker" style="margin:0">Classement</p>
    <div class="card list" style="padding:0 16px">${ranking.map(([id, o], i) => `<div class="list-item">${avatar(id, `lg ${i === 0 ? 'sun' : ''}`)}<div class="grow"><b>${esc(nameOf(id))}</b>${id === S.user.id ? ' <span class="small muted">(toi)</span>' : ''}<div class="small muted ellipsis">${esc(S.members[id]?.bio || (S.members[id]?.role === 'owner' ? 'Capitaine' : ''))}</div></div><div style="text-align:right"><b>${o.n} prise${o.n > 1 ? 's' : ''}</b>${o.best ? `<div class="small" style="color:var(--sun-dark);font-weight:600">${esc(o.best.species)} ${kg(o.best.weight_kg)}</div>` : ''}</div></div>`).join('')}</div>
    <section class="card"><p class="kicker" style="margin:0 0 8px">Inviter un ami</p><p class="muted small" style="margin:0 0 10px">Envoie le lien : il crée son compte et rejoint directement l’équipage.</p>
      <div class="row between" style="background:var(--sand);border-radius:12px;padding:10px 14px"><span class="h" style="font-size:22px;letter-spacing:.2em">${esc(S.crew.invite_code)}</span><button class="btn sm" id="inv">${icon('share', 16)}Envoyer le lien</button></div></section>
    <a class="btn ghost" href="#/trips">${icon('boat', 18)}Toutes les sorties</a>
    <a class="btn ghost" href="#/gpx">${icon('sd', 18)}Import / export Solix (GPX)</a>
    <section class="card"><p class="kicker" style="margin:0 0 8px">Mon profil</p><form id="pf"><label class="f">Prénom<input name="name" required maxlength="40" value="${esc(S.profile?.display_name || '')}"></label><label class="f">Ma pêche (ex. Slow jig &amp; traîne)<input name="bio" maxlength="60" value="${esc(S.profile?.bio || '')}"></label><button class="btn">Enregistrer</button></form></section>
    <button class="btn dashed" id="newcrew">Rejoindre ou créer un autre équipage</button>
  </main>`, { tab: 'crew' });
  $app.querySelector('#inv').onclick = () => shareOrCopy(`Rejoins ${S.crew.name} sur Spartel\n${link}\nCode : ${S.crew.invite_code}`, 'Spartel');
  $app.querySelector('#lo').onclick = async () => { if (await confirmBox('Se déconnecter ?', 'Déconnexion')) sb.auth.signOut(); };
  $app.querySelector('#newcrew').onclick = () => viewOnboarding();
  $app.querySelectorAll('[data-crew]').forEach((b) => (b.onclick = async () => { localStorage.setItem('crewId', b.dataset.crew); await loadCrew(); viewCrew(); }));
  $app.querySelector('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('profiles').update({ display_name: e.target.name.value.trim(), bio: e.target.bio.value.trim() }).eq('id', S.user.id);
    if (error) return fail(error);
    await loadProfile(); await loadMembers(); toast('Profil enregistré'); viewCrew();
  };
}

function notFound() {
  page(`<main class="screen">${topbar({ back: true })}<div class="empty card"><p>Introuvable, ou tu n’y as pas accès.</p><a class="btn" href="#/">Accueil</a></div></main>`, { tab: null });
}

/* ---------------- Routeur ---------------- */
const routes = [
  [/^#?\/?$/, viewHome], [/^#\/map/, viewMap], [/^#\/spot-new/, () => viewSpotForm()], [/^#\/spot-edit\/(.+)/, viewSpotForm], [/^#\/spot\/(.+)/, viewSpot],
  [/^#\/gpx/, viewGPX], [/^#\/catch-new/, viewCatchForm], [/^#\/catch\/(.+)/, viewCatch],
  [/^#\/lures/, viewLures], [/^#\/lure-new/, () => viewLureForm()], [/^#\/lure\/(.+)/, viewLureForm],
  [/^#\/trips/, viewTrips], [/^#\/trip-new/, () => viewTripForm()], [/^#\/trip-edit\/(.+)/, viewTripForm], [/^#\/trip\/(.+)/, viewTrip],
  [/^#\/crew/, viewCrew], [/^#\/reset/, viewReset],
];
async function route() {
  if (!S.user) return viewAuth();
  if (location.hash.startsWith('#/reset')) return viewReset();
  if (!S.crew) return viewOnboarding();
  const h = location.hash.split('?')[0] || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { try { await fn(m[1]); } catch (e) { fail(e); } return; }
  }
  notFound();
}

async function boot() {
  const join = new URLSearchParams(location.search).get('join');
  if (join) { localStorage.setItem('pendingJoin', join.toUpperCase()); history.replaceState(null, '', location.pathname + location.hash); }
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null;
  if (S.user) {
    await loadProfile();
    const pj = localStorage.getItem('pendingJoin');
    if (pj) {
      const { data, error } = await sb.rpc('join_crew', { code: pj });
      if (!error) { localStorage.setItem('crewId', data.id); toast(`Bienvenue dans ${data.name}`); }
      localStorage.removeItem('pendingJoin');
    }
    await loadCrew();
    syncQueue();
  }
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('online', () => syncQueue());
let lastUser = undefined;
sb.auth.onAuthStateChange((evt, session) => {
  const id = session?.user?.id || null;
  if (evt === 'PASSWORD_RECOVERY') { S.user = session.user; return viewReset(); }
  if (id !== lastUser && lastUser !== undefined) { lastUser = id; boot(); return; }
  lastUser = id;
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
boot();
