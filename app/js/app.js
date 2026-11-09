import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_KEY, HOME_POS, PLACES } from './config.js';
import { fmtCoord, parseCoords, parseGPX, buildGPX, buildKML, buildCSV, parseAny, bearing, trackStats, simplify, fetchConditions, fetchCurrent, windDir, moonPhase, haversine } from './geo.js';
import { readPhotoMeta, compressImage, MAX_VIDEO_MB } from './media.js';
import { queueAdd, queueAll, queueDelete } from './offline.js';
import { market } from './market.js';
import { openShareCard } from './share.js';

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
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
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
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rec: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  fire: '<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-7.5z"/>',
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
  return `<nav class="tabbar" aria-label="Navigation principale">${t('#/', 'home', 'Accueil', 'home')}${t('#/map', 'map', 'Carte', 'map')}<a href="#/catch-new" class="fab" aria-label="Nouvelle prise">${icon('plus', 28, 2.6)}</a>${t('#/outings', 'boat', 'Sorties', 'outings')}${t('#/crew', 'crew', 'Équipe', 'crew')}</nav>`;
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
const SITE_URL = new URL('../', location.href).href;
const ACCESS_URL = `${SITE_URL}#access`;
async function viewAuth(mode = 'login') {
  teardown();
  const inviteTok = localStorage.getItem('pendingInvite') || '';
  const crewCode = localStorage.getItem('pendingJoin') || '';
  let inv = null;
  if (mode === 'signup' && inviteTok) { const { data } = await sb.rpc('invite_info', { p_token: inviteTok }); inv = data; }
  const gateNote = mode !== 'signup' ? ''
    : inv ? `<p class="okbox">${icon('check', 16, 3)} Ton accès est accepté. Crée ton compte.</p>`
    : crewCode ? `<p class="okbox">${icon('users', 16)} Invitation à rejoindre un équipage : crée ton compte.</p>`
    : `<p class="hint" style="margin:0 0 4px">Spartel est sur invitation. Si ta demande a été acceptée, utilise le même e-mail. Sinon, <a href="${ACCESS_URL}">demande ton accès</a>.</p>`;
  $app.innerHTML = `<main class="auth">
    <img class="logo" src="icons/wordmark.svg" alt="Spartel">
    <div class="card">
      <div class="chips" role="tablist" style="margin-bottom:14px">
        <button class="chip ${mode === 'login' ? 'on' : ''}" data-mode="login" role="tab" aria-selected="${mode === 'login'}">Connexion</button>
        <button class="chip ${mode === 'signup' ? 'on' : ''}" data-mode="signup" role="tab" aria-selected="${mode === 'signup'}">Créer un compte</button>
      </div>
      <form id="authf">${gateNote}
        ${mode === 'signup' ? `<label class="f">Prénom (affiché dans l’équipe)<input name="name" required autocomplete="given-name" maxlength="40" value="${esc(inv?.name?.split(' ')[0] || '')}"></label>` : ''}
        <label class="f">E-mail<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(inv?.email || '')}"></label>
        <label class="f">Mot de passe<input name="password" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
        <button class="btn sun" type="submit">${mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button>
        ${mode === 'login' ? '<button type="button" class="btn ghost sm" id="forgot">Mot de passe oublié</button>' : ''}
      </form>
    </div>
    <p class="hint" style="text-align:center">${mode === 'login' ? `Pas encore de compte ? <a href="${ACCESS_URL}">Demander l’accès</a>` : 'Spartel · Atlantic · Mediterranean'}</p>
  </main>`;
  $app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { history.replaceState(null, "", b.dataset.mode === "signup" ? "#/signup" : "#/"); viewAuth(b.dataset.mode); }));
  const f = $app.querySelector('#authf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f), btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (mode === 'signup') {
        const { data: ok } = await sb.rpc('signup_allowed', { p_email: fd.get('email'), p_invite: inviteTok || null, p_crew_code: crewCode || null });
        if (!ok) { gateModal(); return; }
        const { data, error } = await sb.auth.signUp({ email: fd.get('email'), password: fd.get('password'), options: { data: { display_name: fd.get('name'), invite: inviteTok || undefined, crew_code: crewCode || undefined }, emailRedirectTo: location.origin + location.pathname } });
        if (error) { if (/database error|INVITE_ONLY/i.test(error.message)) { gateModal(); return; } throw error; }
        localStorage.removeItem('pendingInvite');
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

function gateModal() {
  const m = modal(`<p class="h" style="font-size:18px;margin:0 0 8px">Spartel est sur invitation</p><p style="margin:0 0 16px">Cet e-mail n’a pas encore d’accès. Fais ta demande sur le site : tu recevras un lien par e-mail dès qu’elle est acceptée.</p><a class="btn sun" href="${ACCESS_URL}" style="width:100%">Demander l’accès</a>`);
  return m;
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
    <a class="btn ghost" href="#/outings">${icon('boat', 18)}Juste réserver une sortie en mer</a>
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
    <nav class="shortcuts" aria-label="Raccourcis">${[['#/forecast', 'sun', 'Prévisions'], ['#/lures', 'lure', 'Leurres'], ['#/trips', 'clock', 'Carnet de sorties'], ['#/stats', 'chart', 'Stats'], ['#/gpx', 'sd', 'Import / Export'], [`#/u/${S.user.id}`, 'users', 'Mon profil public']].map(([h, i, l]) => `<a href="${h}">${icon(i, 22)}<span>${l}</span></a>`).join('')}</nav>
    <section id="homeOut" style="display:flex;flex-direction:column;gap:10px"></section>
    <section class="card" id="next"><p class="kicker">Prochaine sortie</p><p class="muted">Chargement…</p></section>
    <section class="card"><div class="row between"><p class="kicker">Conditions · ${esc(HOME_POS.name)}</p><span class="small muted">maintenant</span></div><div class="stats" id="cond" style="margin-top:10px"><p class="muted">…</p></div></section>
    <section id="board" class="card"><div class="row">${icon('trophy', 20)}<h2 class="h" style="font-size:14px">Plus gros du mois</h2></div><div class="list" id="boardList" style="margin-top:6px"><p class="muted">…</p></div></section>
    <h2 class="kicker" style="margin:6px 0 0">Dernières prises</h2>
    <section id="feed" style="display:flex;flex-direction:column;gap:14px"><p class="muted">Chargement…</p></section>
  </main>`, { tab: 'home' });
  const hi = $app.querySelector('#hideInstall'); if (hi) hi.onclick = () => { localStorage.setItem('hideInstall', '1'); hi.closest('.card').remove(); };
  const sy = $app.querySelector('#sync'); if (sy) sy.onclick = () => syncQueue(true);
  M.homeOutings($app.querySelector('#homeOut')).catch(() => {});
  if (S.profile?.is_admin) sb.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(({ count }) => {
    if (count) $app.querySelector('#homeOut')?.insertAdjacentHTML('beforebegin', `<a class="banner" href="#/access" style="text-decoration:none"><span>${count} demande${count > 1 ? 's' : ''} d’accès à Spartel</span>${icon('chev', 18)}</a>`);
  });

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
  const [url, social] = await Promise.all([
    signed((feed || []).flatMap((c) => [c.photo_path, c.lure_photo_path || lureById[c.lure_id]?.photo_path])),
    loadSocial((feed || []).map((c) => c.id)).catch(() => ({ likes: {}, comments: {} })),
  ]);
  const fe = $app.querySelector('#feed'); if (!fe) return;
  fe.innerHTML = (feed || []).length ? feed.map((c) => {
    const a = c.angler_id || c.created_by, lure = lureById[c.lure_id];
    const lp = c.lure_photo_path || lure?.photo_path;
    return `<article class="card" style="padding:14px">
      <a href="#/catch/${c.id}" style="text-decoration:none;color:inherit;display:block">
      <div class="row">${avatar(a)}<div class="grow"><div style="font-weight:700">${esc(nameOf(a))}</div><div class="small muted ellipsis">${esc([fmtDate(c.caught_at), spotName[c.spot_id], c.depth_m != null ? `${num(c.depth_m, 0)} m` : null].filter(Boolean).join(' · '))}</div></div></div>
      ${c.photo_path && url(c.photo_path) ? `<img class="photo" style="margin-top:12px" loading="lazy" src="${url(c.photo_path)}" alt="${esc(c.species)}">` : ''}
      <div class="row between" style="margin-top:12px"><span class="h" style="font-size:18px">${esc(c.species)}</span><b style="color:var(--sun-dark);font-size:18px">${kg(c.weight_kg)}</b></div>
      ${lure || c.lure_name ? `<div class="row" style="margin-top:10px;padding:8px;background:var(--sand);border-radius:12px">${lp && url(lp) ? `<img class="thumb" src="${url(lp)}" alt="">` : `<span class="thumb">${icon('lure')}</span>`}<div><div style="font-weight:600;font-size:14px">${esc(lure?.name || c.lure_name)}</div><div class="small muted">${esc([c.technique, c.released ? 'relâché' : null].filter(Boolean).join(' · '))}</div></div></div>` : ''}
      </a>
      <div class="actions">${likeBtn(c.id, social.likes[c.id])}<a class="likebtn" href="#/catch/${c.id}?c=1" aria-label="Commentaires">${icon('chat', 22)}<span>${social.comments[c.id] || ''}</span></a></div>
    </article>`;
  }).join('') : `<div class="empty card">${icon('trophy', 34)}<p>Aucune prise pour l’instant.<br>Touche le bouton <b>+</b> pour enregistrer la première.</p></div>`;
  wireLikes(fe, social.likes);
}

/* ---------------- Likes et commentaires ---------------- */
async function loadSocial(ids) {
  const likes = {}, comments = {};
  if (!ids.length) return { likes, comments };
  const [{ data: l }, { data: cm }] = await Promise.all([
    sb.from('catch_likes').select('catch_id, user_id').in('catch_id', ids),
    sb.from('catch_comments').select('catch_id').in('catch_id', ids),
  ]);
  (l || []).forEach((r) => (likes[r.catch_id] ||= new Set()).add(r.user_id));
  (cm || []).forEach((r) => { comments[r.catch_id] = (comments[r.catch_id] || 0) + 1; });
  return { likes, comments };
}
function likeBtn(id, set) {
  const on = !!set?.has(S.user.id), n = set?.size || 0;
  return `<button class="likebtn${on ? ' on' : ''}" data-like="${id}" aria-pressed="${on}" aria-label="J’aime">${icon('heart', 22)}<span>${n || ''}</span></button>`;
}
const paintLike = (btn, set) => {
  const on = set.has(S.user.id);
  btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on); btn.querySelector('span').textContent = set.size || '';
};
// Branche tous les boutons « j’aime » d’un conteneur. `likes` : { catchId: Set(userId) }.
function wireLikes(root, likes, onChange) {
  root.querySelectorAll('[data-like]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = btn.dataset.like, set = (likes[id] ||= new Set()), on = !set.has(S.user.id);
      const paint = () => { paintLike(btn, set); onChange?.(set); };
      on ? set.add(S.user.id) : set.delete(S.user.id); paint(); // affichage immédiat
      const { error } = on
        ? await sb.from('catch_likes').insert({ catch_id: id })
        : await sb.from('catch_likes').delete().eq('catch_id', id).eq('user_id', S.user.id);
      if (error && !(on && error.code === '23505')) { on ? set.delete(S.user.id) : set.add(S.user.id); paint(); fail(error); }
    };
  });
}
const ago = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'à l’instant'; if (s < 3600) return `${Math.floor(s / 60)} min`; if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return fmtDate(d, { day: 'numeric', month: 'short' });
};
function commentRow(cm, canModerate) {
  const mine = cm.user_id === S.user.id;
  return `<div class="cmt" data-cid="${cm.id}">${avatar(cm.user_id)}<div class="grow"><div><b>${esc(nameOf(cm.user_id))}</b> <span class="small muted">${esc(ago(cm.created_at))}</span></div><div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(cm.body)}</div></div>${mine || canModerate ? `<button class="iconbtn cmt-del" data-del="${cm.id}" aria-label="Supprimer le commentaire" style="width:36px;height:36px">✕</button>` : ''}</div>`;
}
// Section commentaires d'une prise (fiche prise).
async function commentsSection(root, catchId, canModerate, focus) {
  const { data } = await sb.from('catch_comments').select('*').eq('catch_id', catchId).order('created_at');
  const list = root.querySelector('#cmtList'), input = root.querySelector('#cmtIn'), send = root.querySelector('#cmtSend');
  const draw = (rows) => {
    list.innerHTML = rows.length ? rows.map((cm) => commentRow(cm, canModerate)).join('') : '<p class="muted" style="margin:0">Aucun commentaire pour l’instant.</p>';
    list.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('Supprimer ce commentaire ?'))) return;
      const { error } = await sb.from('catch_comments').delete().eq('id', b.dataset.del);
      if (error) return fail(error);
      rows = rows.filter((r) => String(r.id) !== b.dataset.del); draw(rows);
    }));
  };
  let rows = data || []; draw(rows);
  const post = async () => {
    const body = input.value.trim(); if (!body) return;
    send.disabled = true;
    const { data: row, error } = await sb.from('catch_comments').insert({ catch_id: catchId, body }).select().single();
    send.disabled = false;
    if (error) return fail(error);
    input.value = ''; rows = [...rows, row]; draw(rows);
  };
  send.onclick = post;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } };
  if (focus) { el_scroll(root.querySelector('#comments')); }
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
    <div class="map-fabs"><button class="iconbtn" id="heat" aria-label="Carte de chaleur des prises">${icon('fire')}</button><button class="iconbtn" id="layers" aria-label="Afficher les profondeurs">${icon('layers')}</button><button class="iconbtn" id="loc" aria-label="Ma position">${icon('locate')}</button><button class="iconbtn" id="addspot" aria-label="Ajouter un spot" style="background:var(--sun);color:#fff">${icon('plus', 24, 2.4)}</button></div>
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
  let heatOn = false;
  $app.querySelector('#heat').onclick = async () => {
    heatOn = !heatOn;
    if (heatOn && !map.getSource('heat')) {
      const { data: cs } = await sb.from('catches').select('lat, lon, weight_kg').eq('crew_id', S.crew.id).not('lat', 'is', null);
      map.addSource('heat', { type: 'geojson', data: { type: 'FeatureCollection', features: (cs || []).map((c) => ({ type: 'Feature', properties: { w: +c.weight_kg || 1 }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })) } });
      map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', paint: { 'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0, 0.4, 10, 1], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 18, 14, 40], 'heatmap-opacity': 0.75, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(226,112,58,0)', 0.3, 'rgba(242,176,122,0.6)', 0.7, '#E2703A', 1, '#B3261E'] } });
      toast(`${(cs || []).length} prise${(cs || []).length > 1 ? 's' : ''} sur la carte de chaleur`);
    } else if (map.getLayer('heat')) map.setLayoutProperty('heat', 'visibility', heatOn ? 'visible' : 'none');
  };
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
    <button class="btn sun" id="nav">${icon('compass', 18)}Guidage vers le spot</button>
    <div class="btn-row"><button class="btn" id="gpx">${icon('sd', 18)}Exporter (GPX, KML, CSV)</button><button class="btn ghost" id="sh">${icon('share', 18)}Partager</button></div>
    <div class="btn-row"><a class="btn ghost" href="#/map?spot=${s.id}&lat=${s.lat}&lon=${s.lon}">${icon('map', 18)}Sur la carte</a><a class="btn ghost" href="#/catch-new?spot=${s.id}">${icon('plus', 18)}Prise ici</a></div>
  </main>`, { tab: 'map' });
  $app.querySelectorAll('#cm .chip').forEach((c) => (c.onclick = () => {
    S.coordMode = c.dataset.m; localStorage.setItem('coordMode', S.coordMode);
    $app.querySelectorAll('#cm .chip').forEach((x) => x.classList.toggle('on', x === c));
    $app.querySelector('#coord').textContent = fmtCoord(s.lat, s.lon, S.coordMode);
  }));
  $app.querySelector('#gpx').onclick = () => exportSpots([s], s.name);
  $app.querySelector('#nav').onclick = () => guide(s);
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
const BRANDS = {
  Humminbird: 'Solix / Apex / Xplore : Accueil → Mes données → Exporter tout, sur la carte SD (format GPX). Helix : passer par HumminbirdPC pour convertir en GPX.',
  Garmin: 'ECHOMAP / GPSMAP : Nav Info → Gestion des données (User Data) → Transfert de données → Type de fichier → GPX, puis Enregistrer sur la carte. Sinon le fichier sort en .adm.',
  Lowrance: 'HDS / Elite : Pages → Fichiers (Files) → Waypoints, routes, traces → Exporter → format GPX → carte SD.',
  Raymarine: 'Axiom : Accueil → Mes données → Import/Export → Enregistrer sur la carte. Le fichier est en GPX (dossier Raymarine/My Data).',
  Autres: 'Tout traceur, GPS ou logiciel qui lit le GPX (OpenCPN, Navionics via fichier, Google Earth en KML, tableur en CSV).',
};
function exportSpots(spots, name = 'spartel-spots') {
  const base = name.replace(/[^\w-]+/g, '_');
  const m = modal(`<p class="h" style="font-size:16px;margin-bottom:6px">Exporter ${spots.length} spot${spots.length > 1 ? 's' : ''}</p><p class="small muted" style="margin:0 0 14px">Choisis le format selon l’appareil.</p>
    <div style="display:grid;gap:10px"><button class="btn" data-f="gpx">${icon('sd', 18)}GPX · Humminbird, Garmin, Lowrance, Raymarine…</button><button class="btn ghost" data-f="kml">KML · Google Earth, OpenCPN</button><button class="btn ghost" data-f="csv">CSV · Excel, Numbers, autres applis</button></div>`);
  m.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
    const f = b.dataset.f;
    if (f === 'gpx') download(`${base}.gpx`, buildGPX({ spots, name }));
    if (f === 'kml') download(`${base}.kml`, buildKML({ spots, name }), 'application/vnd.google-earth.kml+xml');
    if (f === 'csv') download(`${base}.csv`, buildCSV(spots), 'text/csv');
    m.remove();
  }));
}
function viewGPX() {
  page(`<main class="screen">${topbar({ title: 'Import / Export', back: true })}
    <div class="card"><p style="margin:0 0 10px;font-weight:700">Depuis ton sondeur ou ton GPS</p>
      <div class="chips" id="brands">${Object.keys(BRANDS).map((b, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-b="${b}">${b}</button>`).join('')}</div>
      <p class="muted" id="howto" style="margin:12px 0 0;font-size:14px">${BRANDS.Humminbird}</p>
      <p class="small muted" style="margin:10px 0 0">Mets ensuite le fichier sur ton téléphone (AirDrop, WhatsApp, Fichiers) et choisis-le ci-dessous.</p></div>
    <label class="drop">${icon('upload', 26)}<span>Choisir un fichier .gpx, .kml ou .csv</span><input type="file" id="file" accept=".gpx,.kml,.csv,.txt,application/gpx+xml,application/xml,text/xml,text/csv"></label>
    <div id="res"></div>
    <div class="card"><p style="margin:0 0 8px;font-weight:700">Exporter vers un appareil</p><p class="muted small" style="margin:0 0 12px">Tes spots et ceux de l’équipe, dans le format de ton choix. Pour le traceur : copie le fichier sur la carte SD puis importe-le depuis le menu de l’appareil.</p><button class="btn" id="exp">${icon('sd', 18)}Exporter tous les spots</button></div>
  </main>`, { tab: false });
  $app.querySelectorAll('#brands .chip').forEach((c) => (c.onclick = () => { $app.querySelectorAll('#brands .chip').forEach((x) => x.classList.toggle('on', x === c)); $app.querySelector('#howto').textContent = BRANDS[c.dataset.b]; }));
  $app.querySelector('#exp').onclick = async () => {
    const { data } = await sb.from('spots').select('*').eq('crew_id', S.crew.id);
    if (!data?.length) return toast('Aucun spot à exporter');
    exportSpots(data, `spartel-spots-${todayISO()}`);
  };
  $app.querySelector('#file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    let gpx;
    try { gpx = parseAny(file.name, await file.text()); } catch (err) { return fail(err); }
    const res = $app.querySelector('#res');
    res.innerHTML = `${gpx.waypoints.length ? `<section class="card"><div class="row between"><b>${gpx.waypoints.length} point${gpx.waypoints.length > 1 ? 's' : ''}</b><button class="btn sm ghost" id="all">Tout cocher</button></div>
      <div class="list" style="max-height:320px;overflow:auto;margin:8px 0">${gpx.waypoints.map((w, i) => `<label class="list-item"><input type="checkbox" data-i="${i}" checked style="width:20px;height:20px"><div class="grow"><b>${esc(w.name)}</b><div class="small muted">${fmtCoord(w.lat, w.lon, S.coordMode)}${w.depth != null ? ` · ${num(w.depth, 0)} m` : ''}</div></div></label>`).join('')}</div>
      <div class="chips" id="vis"><button type="button" class="chip on" data-v="private">${icon('lock', 14)}Privés</button><button type="button" class="chip" data-v="crew">${icon('users', 14)}Partagés à l’équipe</button></div>
      <button class="btn sun" id="imp" style="width:100%;margin-top:12px">Importer les spots</button></section>` : ''}
      ${gpx.tracks.map((t, i) => { const st = trackStats(t.points); return `<section class="card"><b>${esc(t.name)}</b><p class="small muted" style="margin:4px 0 12px">${t.points.length} points · ${st.distance_km} km${st.start ? ` · ${fmtDate(st.start)}` : ''}</p><button class="btn" data-trk="${i}" style="width:100%">${icon('boat', 18)}Créer une sortie avec ce track</button></section>`; }).join('')}
      ${!gpx.waypoints.length && !gpx.tracks.length ? '<p class="muted">Aucun point ni track dans ce fichier.</p>' : ''}`;
    let vis = 'private';
    res.querySelectorAll('#vis .chip').forEach((c) => (c.onclick = () => { vis = c.dataset.v; res.querySelectorAll('#vis .chip').forEach((x) => x.classList.toggle('on', x === c)); }));
    const all = res.querySelector('#all'); if (all) all.onclick = () => { const boxes = res.querySelectorAll('[data-i]'); const on = [...boxes].some((b) => !b.checked); boxes.forEach((b) => (b.checked = on)); };
    const imp = res.querySelector('#imp');
    if (imp) imp.onclick = async () => {
      const rows = [...res.querySelectorAll('[data-i]:checked')].map((b) => gpx.waypoints[+b.dataset.i]).map((w) => ({
        crew_id: S.crew.id, name: String(w.name).slice(0, 60), lat: w.lat, lon: w.lon, notes: w.notes || null, depth_min: w.depth ?? null, visibility: vis, source: 'import',
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

/* ---------------- Guidage vers un spot ---------------- */
function guide(s) {
  const m = modal(`<p class="h" style="font-size:16px;margin:0">${esc(s.name)}</p><p class="small muted" style="margin:4px 0 14px">${fmtCoord(s.lat, s.lon, S.coordMode)}</p>
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px"><div id="arrow" style="width:150px;height:150px;border-radius:50%;background:var(--navy);color:var(--sun);display:flex;align-items:center;justify-content:center;transition:transform .3s">${icon('nav', 70, 2)}</div>
    <div class="stats" style="width:100%"><div class="stat"><b id="dist">—</b><span>Distance</span></div><div class="stat"><b id="brg">—</b><span>Cap</span></div><div class="stat"><b id="spd">—</b><span>Vitesse</span></div></div>
    <p class="small muted" id="gst" style="margin:0;text-align:center">Recherche du GPS…</p>
    <button class="btn ghost sm" id="cmp">Activer la boussole</button></div>`);
  let heading = null, last = null;
  const upd = () => {
    if (!last) return;
    const d = haversine([last.lat, last.lon], [s.lat, s.lon]);
    const b = bearing([last.lat, last.lon], [s.lat, s.lon]);
    m.querySelector('#dist').textContent = d > 1852 ? `${(d / 1852).toFixed(2)} nq` : `${Math.round(d)} m`;
    m.querySelector('#brg').textContent = `${Math.round(b)}°`;
    m.querySelector('#spd').textContent = last.speed != null ? `${(last.speed * 1.94384).toFixed(1)} nds` : '—';
    m.querySelector('#arrow').style.transform = `rotate(${b - (heading ?? 0)}deg)`;
    m.querySelector('#gst').textContent = `Précision ± ${Math.round(last.acc)} m${heading == null ? ' · flèche orientée nord en haut' : ''}`;
    if (d < 30) m.querySelector('#gst').textContent = 'Tu es sur le spot.';
  };
  const id = navigator.geolocation?.watchPosition((p) => { last = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed }; upd(); }, (e) => (m.querySelector('#gst').textContent = e.code === 1 ? 'Autorise la localisation dans les réglages.' : 'Position introuvable'), { enableHighAccuracy: true, maximumAge: 2000 });
  const onOri = (e) => { const h = e.webkitCompassHeading ?? (e.alpha != null ? 360 - e.alpha : null); if (h != null) { heading = h; upd(); } };
  m.querySelector('#cmp').onclick = async () => {
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return toast('Boussole refusée'); } window.addEventListener('deviceorientation', onOri); toast('Boussole activée'); } catch (e) { toast('Boussole indisponible'); }
  };
  const obs = new MutationObserver(() => { if (!document.body.contains(m)) { navigator.geolocation?.clearWatch(id); window.removeEventListener('deviceorientation', onOri); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
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
      <label class="switch">Afficher sur mon profil public<input type="checkbox" name="public"></label>
      <p class="hint" style="margin:-8px 0 0">Profil public : photo, espèce, poids et leurre. Jamais le spot ni les coordonnées.</p>
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
        released: f.released.checked, visibility: f.private.checked ? 'private' : 'crew', is_public: f.public.checked, notes: f.notes.value.trim() || null,
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
    <a class="row" href="#/u/${a}" style="text-decoration:none;color:inherit">${avatar(a)}<div><b>${esc(nameOf(a))}</b><div class="small muted">${fmtDate(c.caught_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtTime(c.caught_at)}${c.created_by !== a ? ` · saisi par ${esc(nameOf(c.created_by))}` : ''}</div></div></a>
    <div class="row between"><div class="actions" style="margin:0" id="catchLike">${likeBtn(id, null)}<span class="small muted" id="likedBy"></span></div><button class="btn sun sm" id="shi">${icon('share', 16)} Partager en image</button></div>
    <div class="card list" style="padding:4px 16px">${[
      ['Taille', c.length_cm ? `${num(c.length_cm)} cm` : null], ['Profondeur', c.depth_m ? `${num(c.depth_m, 0)} m` : null], ['Technique', c.technique],
      ['Spot', spot ? `<a href="#/spot/${spot.id}">${esc(spot.name)}</a>` : null, true], ['Position', c.lat != null ? fmtCoord(c.lat, c.lon, S.coordMode) : null],
      ['Sortie', trip ? `<a href="#/trip/${trip.id}">${esc(fmtDate(trip.trip_date))}${trip.title ? ' · ' + esc(trip.title) : ''}</a>` : null, true],
      ['Relâché', c.released ? 'Oui' : 'Non'], ['Visibilité', c.visibility === 'crew' ? 'Équipe' : 'Moi seul'],
    ].filter((r) => r[1]).map(([x, y, raw]) => `<div class="list-item between"><span class="muted">${x}</span><b style="text-align:right">${raw ? y : esc(y)}</b></div>`).join('')}</div>
    ${lure || c.lure_name ? `<div class="card row">${lp && url(lp) ? `<img class="thumb" src="${url(lp)}" alt="Leurre">` : `<span class="thumb">${icon('lure')}</span>`}<div class="grow"><p class="small muted" style="margin:0">Leurre</p><b>${esc(lure?.name || c.lure_name)}</b>${lure ? `<div class="small muted">${esc([lure.lure_type, lure.weight_g ? lure.weight_g + ' g' : null, lure.color].filter(Boolean).join(' · '))}</div>` : ''}</div>${lure ? `<a class="iconbtn" href="#/lure/${lure.id}" aria-label="Voir le leurre">${icon('chev')}</a>` : ''}</div>` : ''}
    <section class="card"><p class="kicker" style="margin:0 0 10px">Conditions au moment de la prise</p><div class="stats">${cond.map(([ic, v, l]) => `<div class="stat">${icon(ic, 20)}<b>${v ?? '—'}</b><span>${esc(l)}</span></div>`).join('')}</div>${k.pressure_msl ? `<p class="small muted" style="margin:10px 0 0;text-align:center">Pression ${Math.round(k.pressure_msl)} hPa${k.wind_gusts_10m ? ` · rafales ${Math.round(k.wind_gusts_10m)} nds` : ''}${k.wave_period ? ` · période ${num(k.wave_period)} s` : ''}</p>` : ''}</section>
    ${c.notes ? `<p style="margin:0;white-space:pre-wrap">${esc(c.notes)}</p>` : ''}
    <section class="card" id="comments"><p class="kicker" style="margin:0 0 10px">Commentaires</p><div id="cmtList" class="cmts"><p class="muted" style="margin:0">…</p></div>
      <div class="cmt-form"><input id="cmtIn" maxlength="500" placeholder="Écrire un commentaire…" autocomplete="off" aria-label="Commentaire"><button class="btn sun sm" id="cmtSend">Envoyer</button></div></section>
    ${c.created_by === S.user.id || c.angler_id === S.user.id ? `<label class="switch card" style="padding:10px 16px">Afficher sur ${a === S.user.id ? 'mon' : 'son'} profil public<input type="checkbox" id="pub" ${c.is_public ? 'checked' : ''}></label>` : ''}
    ${c.created_by === S.user.id ? '<button class="btn danger" id="del">Supprimer cette prise</button>' : ''}
  </main>`, { tab: 'home' });
  $app.querySelector('#sh').onclick = () => shareOrCopy(`${nameOf(a)} — ${c.species}${c.weight_kg ? ' ' + kg(c.weight_kg) : ''}${spot && c.visibility === 'crew' ? ' · ' + spot.name : ''} · ${fmtDate(c.caught_at)}`);
  // Partage en image (Instagram…) : jamais de spot ni de position sur l'image.
  $app.querySelector('#shi').onclick = () => openShareCard({
    species: c.species, weight: c.weight_kg ? kg(c.weight_kg) : '', length: c.length_cm ? `${num(c.length_cm)} cm` : '',
    angler: nameOf(a), dateLabel: fmtDate(c.caught_at, { day: 'numeric', month: 'long', year: 'numeric' }),
    lure: lure?.name || c.lure_name || '', released: !!c.released, photoUrl: url(c.photo_path),
  }, { modal, toast }).catch(fail);
  // J'aime + commentaires
  const likes = { [id]: new Set() };
  const likedBy = (set) => { const names = [...(set || [])].map(nameOf); $app.querySelector('#likedBy').textContent = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(', ')} et ${names.length - 2} autre${names.length > 3 ? 's' : ''}` : names.join(' et ')) : ''; };
  const likeBox = $app.querySelector('#catchLike');
  wireLikes(likeBox, likes, likedBy); // actif tout de suite, les anciens « j'aime » arrivent ensuite
  sb.from('catch_likes').select('user_id').eq('catch_id', id).then(({ data }) => {
    (data || []).forEach((r) => likes[id].add(r.user_id));
    if (!likeBox.isConnected) return;
    paintLike(likeBox.querySelector('[data-like]'), likes[id]); likedBy(likes[id]);
  });
  commentsSection($app, id, c.created_by === S.user.id || c.angler_id === S.user.id, !!qs().c).catch(fail);
  const pub = $app.querySelector('#pub');
  if (pub) pub.onchange = async () => { const { error } = await sb.from('catches').update({ is_public: pub.checked }).eq('id', id); error ? (fail(error), (pub.checked = !pub.checked)) : toast(pub.checked ? 'Visible sur le profil public (sans le spot)' : 'Retirée du profil public'); };
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
    <div class="btn-row">${canEdit ? `<button class="btn" id="rec">${icon('rec', 18)}${recState()?.trip === t.id ? 'Reprendre l’enregistrement' : 'Enregistrer le track'}</button>` : ''}${t.track?.length > 1 ? `<button class="btn ghost" id="replay">${icon('play', 18)}Replay</button>` : ''}</div>
  </main>`, { tab: 'home' });
  const exp = $app.querySelector('#exp');
  if (exp) exp.onclick = () => download(`sortie-${t.trip_date}.gpx`, buildGPX({ track: t.track, name: t.title || `Sortie ${t.trip_date}` }));
  const rb = $app.querySelector('#rec'); if (rb) rb.onclick = () => recorder(t);
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
      const rp = $app.querySelector('#replay');
      if (rp) rp.onclick = () => replay(map, t, cs || []);
    });
  }
}

/* ---------------- Replay d'une sortie ---------------- */
function replay(map, t, cs) {
  const pts = t.track; if (!pts?.length) return;
  el_scroll(map.getContainer());
  const timed = pts[0][2] && pts[pts.length - 1][2];
  const t0 = timed ? pts[0][2] : 0, t1 = timed ? pts[pts.length - 1][2] : pts.length;
  const boat = document.createElement('div'); boat.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#E2703A;border:3px solid #fff;box-shadow:0 0 0 6px rgba(226,112,58,.3)';
  const mk = new maplibregl.Marker({ element: boat }).setLngLat([pts[0][1], pts[0][0]]).addTo(map);
  const label = document.createElement('div'); label.style.cssText = 'position:absolute;left:10px;top:10px;background:#0B1F33;color:#fff;font:700 13px Inter,sans-serif;padding:6px 10px;border-radius:8px;z-index:2';
  map.getContainer().appendChild(label);
  const shown = new Set(); const DUR = 15000; const start = performance.now();
  if (map.getSource('trk')) map.getSource('trk').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  const step = (now) => {
    if (!document.body.contains(boat) || !map.getStyle?.()) { label.remove(); return; }
    const k = Math.min(1, (now - start) / DUR);
    const tt = t0 + (t1 - t0) * k;
    let i = timed ? pts.findIndex((p) => p[2] > tt) : Math.floor(k * (pts.length - 1));
    if (i < 0) i = pts.length - 1;
    const done = pts.slice(0, Math.max(1, i + 1));
    if (map.getSource('trk')) map.getSource('trk').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: done.map((p) => [p[1], p[0]]) } });
    const cur = pts[Math.max(0, i)]; mk.setLngLat([cur[1], cur[0]]);
    if (timed) label.textContent = fmtTime(tt);
    cs.forEach((c) => { if (!shown.has(c.id) && c.lat != null && (!timed || Date.parse(c.caught_at) <= tt)) { shown.add(c.id); toast(`${fmtTime(c.caught_at)} · ${nameOf(c.angler_id || c.created_by)} · ${c.species}${c.weight_kg ? ' ' + kg(c.weight_kg) : ''}`, 2200); } });
    if (k < 1 && document.body.contains(boat)) requestAnimationFrame(step); else setTimeout(() => { label.remove(); }, 2500);
  };
  requestAnimationFrame(step);
}
function el_scroll(el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }

/* ---------------- Enregistrement du track depuis le téléphone ---------------- */
const REC_KEY = 'spartel-rec';
function recState() { try { return JSON.parse(localStorage.getItem(REC_KEY) || 'null'); } catch (e) { return null; } }
function recSave(st) { try { localStorage.setItem(REC_KEY, JSON.stringify(st)); } catch (e) {} }
function recorder(t) {
  let st = recState();
  if (st && st.trip !== t.id) return toast('Un enregistrement est déjà en cours sur une autre sortie');
  if (!st) { st = { trip: t.id, pts: [] }; recSave(st); }
  let lock = null, wid = null;
  const m = modal(`<p class="h" style="font-size:16px;margin:0 0 4px">Enregistrement du track</p><p class="small muted" style="margin:0 0 14px">Garde Spartel ouvert à l’écran : l’iPhone coupe le GPS des applis web quand l’écran est verrouillé. Les points sont gardés sur le téléphone, même sans réseau.</p>
    <div class="stats"><div class="stat"><b id="rp">0</b><span>Points</span></div><div class="stat"><b id="rd">0 km</b><span>Distance</span></div><div class="stat"><b id="rs">—</b><span>Vitesse</span></div></div>
    <div class="btn-row" style="margin-top:16px"><button class="btn ghost" id="pause">Pause</button><button class="btn sun" id="stop">Terminer et enregistrer</button></div>`);
  const upd = (spd) => { const s2 = trackStats(st.pts); m.querySelector('#rp').textContent = st.pts.length; m.querySelector('#rd').textContent = `${s2.distance_km} km`; if (spd != null) m.querySelector('#rs').textContent = `${(spd * 1.94384).toFixed(1)} nds`; };
  const startWatch = async () => {
    try { lock = await navigator.wakeLock?.request('screen'); } catch (e) {}
    wid = navigator.geolocation.watchPosition((p) => {
      const pt = [p.coords.latitude, p.coords.longitude, Date.now()];
      const lastp = st.pts[st.pts.length - 1];
      if (p.coords.accuracy > 60) return;
      if (lastp && haversine(lastp, pt) < 8 && pt[2] - lastp[2] < 30000) return;
      st.pts.push(pt); recSave(st); upd(p.coords.speed);
    }, (e) => toast(e.code === 1 ? 'Autorise la localisation' : 'GPS indisponible'), { enableHighAccuracy: true, maximumAge: 0 });
  };
  const stopWatch = () => { if (wid != null) navigator.geolocation.clearWatch(wid); wid = null; try { lock?.release(); } catch (e) {} };
  upd(); startWatch();
  let paused = false;
  m.querySelector('#pause').onclick = (e) => { paused = !paused; paused ? stopWatch() : startWatch(); e.target.textContent = paused ? 'Reprendre' : 'Pause'; };
  m.querySelector('#stop').onclick = async () => {
    stopWatch();
    if (st.pts.length < 2) { localStorage.removeItem(REC_KEY); m.remove(); return toast('Track trop court, rien enregistré'); }
    const merged = [...(t.track || []), ...st.pts];
    const { error } = await sb.from('trips').update({ track: simplify(merged), stats: trackStats(merged) }).eq('id', t.id);
    if (error) { toast('Pas de réseau : le track reste sur le téléphone, réessaie au port', 5000); return; }
    localStorage.removeItem(REC_KEY); m.remove(); toast('Track enregistré'); viewTrip(t.id);
  };
  const obs = new MutationObserver(() => { if (!document.body.contains(m)) { stopWatch(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

/* ---------------- Prévisions & meilleures heures ---------------- */
async function viewForecast() {
  const q = qs();
  const { data: spots } = await sb.from('spots').select('id, name, lat, lon').eq('crew_id', S.crew.id).order('name');
  let loc = HOME_POS;
  if (q.spot) { const s = (spots || []).find((x) => x.id === q.spot); if (s) loc = { lat: s.lat, lon: s.lon, name: s.name }; }
  else if (q.place) { const p = PLACES.find((x) => x.id === q.place); if (p) loc = { lat: p.lat, lon: p.lon, name: p.name }; }
  const cur = q.spot ? 's:' + q.spot : 'p:' + (q.place || 'cap-spartel');
  const regions = [...new Set(PLACES.map((p) => p.region))];
  const opts = ((spots || []).length ? `<optgroup label="Mes spots">${spots.map((s) => `<option value="s:${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>` : '')
    + regions.map((r) => `<optgroup label="${esc(r)}">${PLACES.filter((p) => p.region === r).map((p) => `<option value="p:${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  page(`<main class="screen">${topbar({ title: 'Prévisions', back: true })}
    <div class="row"><label class="f" style="flex:1">Lieu<select id="loc">${opts}</select></label><button class="iconbtn" id="me" aria-label="Ma position" style="align-self:flex-end;background:#fff;border:1px solid var(--line)">${icon('locate')}</button></div>
    <div id="fc"><p class="muted">Calcul des prévisions…</p></div>
    <p class="small muted" style="margin:0">Indice Spartel : lune, périodes solunaires à l’aube et au crépuscule, vent, houle et marnage. C’est un indicateur, pas une garantie. Marées calculées par modèle (Open-Meteo), à ne pas utiliser pour la navigation.</p>
  </main>`, { tab: 'home' });
  const sel = $app.querySelector('#loc'); sel.value = cur;
  sel.onchange = (e) => { const [k, v] = e.target.value.split(':'); go(k === 's' ? `#/forecast?spot=${v}` : `#/forecast?place=${v}`); };
  $app.querySelector('#me').onclick = async () => {
    try {
      const p = await getPosition();
      if (!sel.querySelector('option[value="me"]')) sel.insertAdjacentHTML('afterbegin', '<option value="me">Ma position</option>');
      sel.value = 'me'; render({ lat: p.lat, lon: p.lon, name: 'Ma position' });
    } catch (e) { fail(e); }
  };
  const render = async (L) => {
    const box = $app.querySelector('#fc'); box.innerHTML = '<p class="muted">Calcul des prévisions…</p>';
    let days;
    try { const { forecast } = await import('./forecast.js'); days = await forecast(L.lat, L.lon); } catch (e) { box.innerHTML = `<p class="muted">Prévisions indisponibles (${esc(e.message)}).</p>`; return; }
    const col = (sc) => (sc >= 70 ? '#2E7D4F' : sc >= 50 ? '#E2703A' : '#8A97A6');
    const t = (d) => (d ? fmtTime(d) : '—');
    box.innerHTML = `<p class="kicker" style="margin:0 0 10px">${esc(L.name)} · 7 jours</p>` + days.map((d, i) => `
      <details class="card fday" ${i === 0 ? 'open' : ''}><summary class="row between" style="cursor:pointer;list-style:none">
        <div><b style="text-transform:capitalize">${esc(fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'short' }))}</b><div class="small muted">${d.windMax != null ? `Vent ${Math.round(d.windAvg)}–${Math.round(d.windMax)} nds ${windDir(d.dirAvg)}` : ''}${d.waveMax != null ? ` · houle ${num(d.waveMax)} m` : ''}${d.sst != null ? ` · eau ${Math.round(d.sst)} °C` : ''}</div></div>
        <div class="score" style="--c:${col(d.score)}"><b>${d.score}</b><span>/100</span></div></summary>
        <div class="fbody">
          ${hourChart(d)}
          <div class="grid2" style="margin-top:12px">
            <div><p class="small muted" style="margin:0">Périodes majeures</p><b>${d.sol.major.map((p) => `${t(p.start)}–${t(p.end)}`).join(' · ') || '—'}</b></div>
            <div><p class="small muted" style="margin:0">Périodes mineures</p><b>${d.sol.minor.map((p) => `${t(p.start)}–${t(p.end)}`).join(' · ') || '—'}</b></div>
            <div><p class="small muted" style="margin:0">Soleil</p><b>${t(d.sol.sunrise)} · ${t(d.sol.sunset)}</b></div>
            <div><p class="small muted" style="margin:0">Lune</p><b>${esc(d.sol.moon.label)} · ${d.sol.moon.illumination} %</b></div>
            <div><p class="small muted" style="margin:0">Marée (modèle)</p><b>${d.tideEvents.length ? d.tideEvents.map((e) => `${e.type === 'high' ? 'PM' : 'BM'} ${t(e.t)}`).join(' · ') : '—'}</b></div>
            <div><p class="small muted" style="margin:0">Rafales max</p><b>${d.gustMax != null ? Math.round(d.gustMax) + ' nds' : '—'}</b></div>
          </div>
        </div></details>`).join('');
  };
  render(loc);
}
function hourChart(d) {
  const W = 340, H = 120, hs = d.hours; if (!hs.length) return '';
  const x = (i) => 10 + (i / 23) * (W - 20);
  const wmax = Math.max(25, ...hs.map((h) => h.wind || 0));
  const tides = hs.map((h) => h.tide).filter((v) => v != null); const tmin = Math.min(...tides), tmax = Math.max(...tides);
  const band = (p, cls) => { const a = p.start.getHours() + p.start.getMinutes() / 60, b = p.end.getHours() + p.end.getMinutes() / 60; if (b < a) return ''; return `<rect x="${x(Math.max(0, a))}" y="0" width="${Math.max(2, x(Math.min(23, b)) - x(Math.max(0, a)))}" height="${H - 18}" fill="${cls}"/>`; };
  const wind = hs.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${(H - 20 - ((h.wind || 0) / wmax) * (H - 30)).toFixed(1)}`).join(' ');
  const tide = tides.length > 2 ? hs.map((h, i) => (h.tide == null ? '' : `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${(H - 20 - ((h.tide - tmin) / Math.max(0.01, tmax - tmin)) * (H - 40)).toFixed(1)}`)).join(' ') : '';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:12px" role="img" aria-label="Vent et marée heure par heure">
    ${d.sol.major.map((p) => band(p, 'rgba(226,112,58,.22)')).join('')}${d.sol.minor.map((p) => band(p, 'rgba(226,112,58,.1)')).join('')}
    ${tide ? `<path d="${tide}" fill="none" stroke="#5B8DB8" stroke-width="2" stroke-dasharray="4 3"/>` : ''}
    <path d="${wind}" fill="none" stroke="#0B1F33" stroke-width="2.2"/>
    ${[0, 6, 12, 18, 23].map((h) => `<text x="${x(h)}" y="${H - 4}" font-size="9" fill="#4A5A6A" text-anchor="middle">${h}h</text>`).join('')}
  </svg><p class="small muted" style="margin:4px 0 0">Trait plein : vent · pointillés : marée · bandes orange : périodes solunaires</p>`;
}

/* ---------------- Stats & profil des prises ---------------- */
async function viewStats() {
  const q = qs();
  const [{ data: cs }, { data: lures }, { data: spots }] = await Promise.all([
    sb.from('catches').select('*').eq('crew_id', S.crew.id).order('caught_at', { ascending: false }).limit(2000),
    sb.from('lures').select('id, name').eq('crew_id', S.crew.id),
    sb.from('spots').select('id, name').eq('crew_id', S.crew.id),
  ]);
  const all = cs || [];
  const species = Object.entries(all.reduce((m, c) => ((m[c.species] = (m[c.species] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const sel = q.sp || '';
  const list = sel ? all.filter((c) => c.species === sel) : all;
  const lureName = Object.fromEntries((lures || []).map((l) => [l.id, l.name]));
  const spotName = Object.fromEntries((spots || []).map((s) => [s.id, s.name]));
  const top = (arr) => Object.entries(arr.filter(Boolean).reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const med = (arr) => { const a = arr.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; return a[Math.floor(a.length / 2)]; };
  const rng = (arr) => { const a = arr.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); if (a.length < 3) return null; return [a[Math.floor(a.length * 0.2)], a[Math.floor(a.length * 0.8)]]; };
  const hourBand = (c) => { const h = new Date(c.caught_at).getHours(); return h < 6 ? 'Nuit' : h < 9 ? 'Aube' : h < 12 ? 'Matin' : h < 16 ? 'Après-midi' : h < 20 ? 'Soir' : 'Nuit'; };
  const moonCat = (c) => { const il = c.conditions?.moon?.illumination; if (il == null) return null; return il < 25 ? 'Lune noire' : il > 75 ? 'Pleine lune' : 'Quartiers'; };
  const best = list.filter((c) => c.weight_kg).sort((a, b) => b.weight_kg - a.weight_kg)[0];
  const wind = rng(list.map((c) => c.conditions?.wind_speed_10m)), sst = rng(list.map((c) => c.conditions?.sea_surface_temperature)), depth = rng(list.map((c) => +c.depth_m || null));
  const months = Array.from({ length: 12 }, (_, i) => list.filter((c) => new Date(c.caught_at).getMonth() === i).length); const mmax = Math.max(1, ...months);
  const card = (l, v) => `<div class="card" style="padding:12px"><p class="small muted" style="margin:0">${l}</p><b>${v || '—'}</b></div>`;
  page(`<main class="screen">${topbar({ title: 'Stats', back: true })}
    <div class="chips"><a class="chip ${!sel ? 'on' : ''}" href="#/stats">Toutes</a>${species.map(([s, n]) => `<a class="chip ${sel === s ? 'on' : ''}" href="#/stats?sp=${encodeURIComponent(s)}">${esc(s)} · ${n}</a>`).join('')}</div>
    ${list.length ? `
    <p class="kicker" style="margin:0">${sel ? `Profil · ${esc(sel)}` : 'Toute l’équipe'} · ${list.length} prise${list.length > 1 ? 's' : ''}</p>
    <div class="grid2">
      ${card('Plus grosse', best ? `${kg(best.weight_kg)} · ${esc(nameOf(best.angler_id || best.created_by))}` : null)}
      ${card('Meilleur leurre', esc(top(list.map((c) => lureName[c.lure_id] || c.lure_name))[0]?.[0]))}
      ${card('Meilleure technique', esc(top(list.map((c) => c.technique))[0]?.[0]))}
      ${card('Meilleur moment', esc(top(list.map(hourBand))[0]?.[0]))}
      ${card('Lune', esc(top(list.map(moonCat))[0]?.[0]))}
      ${card('Meilleur spot', esc(top(list.map((c) => spotName[c.spot_id]))[0]?.[0]))}
      ${card('Vent qui marche', wind ? `${Math.round(wind[0])}–${Math.round(wind[1])} nds` : null)}
      ${card('Eau qui marche', sst ? `${Math.round(sst[0])}–${Math.round(sst[1])} °C` : null)}
      ${card('Profondeur', depth ? `${Math.round(depth[0])}–${Math.round(depth[1])} m` : null)}
      ${card('Relâchés', `${Math.round((list.filter((c) => c.released).length / list.length) * 100)} %`)}
    </div>
    <section class="card"><p class="kicker" style="margin:0 0 10px">Par mois</p><div class="months">${months.map((n, i) => `<div><span style="height:${Math.round((n / mmax) * 70)}px" title="${n}"></span><small>${'JFMAMJJASOND'[i]}</small></div>`).join('')}</div></section>
    ${!sel ? `<section class="card"><p class="kicker" style="margin:0 0 6px">Espèces</p><div class="list">${species.slice(0, 10).map(([s, n]) => `<a class="list-item" href="#/stats?sp=${encodeURIComponent(s)}"><span class="grow"><b>${esc(s)}</b></span><span class="muted">${n}</span>${icon('chev', 18)}</a>`).join('')}</div></section>` : ''}
    <p class="small muted" style="margin:0">Les plages « qui marchent » couvrent 60 % des prises enregistrées avec leurs conditions. Plus l’équipe note de prises, plus ces profils deviennent précis.</p>`
    : `<div class="empty card">${icon('chart', 34)}<p>Pas encore de prise. Les stats se remplissent toutes seules à chaque poisson noté.</p></div>`}
  </main>`, { tab: 'home' });
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
    <div class="card list" style="padding:0 16px">${ranking.map(([id, o], i) => `<a class="list-item" href="#/u/${id}">${avatar(id, `lg ${i === 0 ? 'sun' : ''}`)}<div class="grow"><b>${esc(nameOf(id))}</b>${id === S.user.id ? ' <span class="small muted">(toi)</span>' : ''}<div class="small muted ellipsis">${esc(S.members[id]?.bio || (S.members[id]?.role === 'owner' ? 'Capitaine' : ''))}</div></div><div style="text-align:right"><b>${o.n} prise${o.n > 1 ? 's' : ''}</b>${o.best ? `<div class="small" style="color:var(--sun-dark);font-weight:600">${esc(o.best.species)} ${kg(o.best.weight_kg)}</div>` : ''}</div></a>`).join('')}</div>
    <section class="card"><p class="kicker" style="margin:0 0 8px">Inviter un ami</p><p class="muted small" style="margin:0 0 10px">Envoie le lien : il crée son compte et rejoint directement l’équipage.</p>
      <div class="row between" style="background:var(--sand);border-radius:12px;padding:10px 14px"><span class="h" style="font-size:22px;letter-spacing:.2em">${esc(S.crew.invite_code)}</span><button class="btn sm" id="inv">${icon('share', 16)}Envoyer le lien</button></div></section>
    <a class="btn ghost" href="#/trips">${icon('boat', 18)}Toutes les sorties</a>
    <a class="btn ghost" href="#/gpx">${icon('sd', 18)}Import / export (Humminbird, Garmin, Lowrance, Raymarine)</a>
    <a class="btn ghost" href="#/stats">${icon('chart', 18)}Stats de l’équipe</a>
    <section class="card"><p class="kicker" style="margin:0 0 8px">Mon profil</p><form id="pf"><label class="f">Prénom<input name="name" required maxlength="40" value="${esc(S.profile?.display_name || '')}"></label><label class="f">Ma pêche (ex. Slow jig &amp; traîne)<input name="bio" maxlength="60" value="${esc(S.profile?.bio || '')}"></label><label class="f">Port d’attache<input name="port" maxlength="60" value="${esc(S.profile?.home_port || '')}" placeholder="Tanger"></label><button class="btn">Enregistrer</button></form><a class="btn ghost sm" style="margin-top:10px;width:100%" href="#/u/${S.user.id}">Voir mon profil public</a></section>
    <a class="btn ghost" href="#/captain">${icon('boat', 18)}Espace capitaine</a>
    ${S.profile?.is_admin ? `<a class="btn ghost" href="#/access">${icon('users', 18)}Demandes d’accès à Spartel</a>` : ''}
    <button class="btn dashed" id="newcrew">Rejoindre ou créer un autre équipage</button>
  </main>`, { tab: 'crew' });
  $app.querySelector('#inv').onclick = () => shareOrCopy(`Rejoins ${S.crew.name} sur Spartel\n${link}\nCode : ${S.crew.invite_code}`, 'Spartel');
  $app.querySelector('#lo').onclick = async () => { if (await confirmBox('Se déconnecter ?', 'Déconnexion')) sb.auth.signOut(); };
  $app.querySelector('#newcrew').onclick = () => viewOnboarding();
  $app.querySelectorAll('[data-crew]').forEach((b) => (b.onclick = async () => { localStorage.setItem('crewId', b.dataset.crew); await loadCrew(); viewCrew(); }));
  $app.querySelector('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('profiles').update({ display_name: e.target.name.value.trim(), bio: e.target.bio.value.trim(), home_port: e.target.port.value.trim() || null }).eq('id', S.user.id);
    if (error) return fail(error);
    await loadProfile(); await loadMembers(); toast('Profil enregistré'); viewCrew();
  };
}

/* ---------------- Demandes d'accès (admin) ---------------- */
async function viewAccess() {
  if (!S.profile?.is_admin) return notFound();
  const tab = qs().t || 'pending';
  const { data } = await sb.from('access_requests').select('*').order('created_at', { ascending: false }).limit(300);
  const all = data || [];
  const count = (st) => all.filter((r) => r.status === st).length;
  const list = all.filter((r) => (tab === 'approved' ? ['approved', 'joined'].includes(r.status) : r.status === tab));
  const chip = (k, l) => `<a class="chip ${tab === k ? 'on' : ''}" href="#/access?t=${k}">${l}</a>`;
  page(`<main class="screen">${topbar({ title: 'Demandes d’accès', back: true })}
    <nav class="chips">${chip('pending', `En attente (${count('pending')})`)}${chip('approved', `Acceptées (${count('approved') + count('joined')})`)}${chip('rejected', `Refusées (${count('rejected')})`)}</nav>
    ${list.length ? list.map((r) => `<section class="card" style="display:flex;flex-direction:column;gap:6px">
      <div class="row between"><b>${esc(r.name)}</b><span class="small muted">${esc(fmtDate(r.created_at, { day: 'numeric', month: 'short' }))}</span></div>
      <a class="small" href="mailto:${esc(r.email)}">${esc(r.email)}</a>
      ${r.message ? `<p class="small" style="margin:0;white-space:pre-wrap;background:var(--sand);border-radius:10px;padding:8px 10px">${esc(r.message)}</p>` : ''}
      ${r.status === 'joined' ? `<p class="okline" style="margin:4px 0 0">${icon('check', 16, 3)} Compte créé</p>` : ''}
      <div class="btn-row" style="margin-top:6px">${r.status === 'pending' ? `<button class="btn sun sm" data-ok="${r.id}">Accepter et envoyer le lien</button><button class="btn ghost sm" data-no="${r.id}">Refuser</button>`
        : r.status === 'approved' ? `<button class="btn sun sm" data-send="${r.id}">${icon('share', 14)}Renvoyer le lien</button>`
        : r.status === 'rejected' ? `<button class="btn ghost sm" data-ok="${r.id}">Accepter finalement</button>` : ''}</div>
    </section>`).join('') : `<div class="empty card">${icon('users', 30)}<p>${tab === 'pending' ? 'Aucune demande en attente.' : 'Rien ici.'}</p></div>`}
    <p class="small muted" style="margin:0">Les gens demandent l’accès depuis le site. Quand tu acceptes, ton app e-mail s’ouvre avec le lien d’inscription prêt à envoyer.</p>
  </main>`, { tab: 'crew' });
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const set = async (id, status) => { const { error } = await sb.from('access_requests').update({ status, approved_at: status === 'approved' ? new Date().toISOString() : null }).eq('id', id); if (error) throw error; };
  $app.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = async () => { try { await set(b.dataset.ok, 'approved'); sendInvite(byId[b.dataset.ok]); } catch (e) { fail(e); } }));
  $app.querySelectorAll('[data-no]').forEach((b) => (b.onclick = async () => { if (await confirmBox(`Refuser la demande de ${byId[b.dataset.no].name} ?`, 'Refuser')) { try { await set(b.dataset.no, 'rejected'); viewAccess(); } catch (e) { fail(e); } } }));
  $app.querySelectorAll('[data-send]').forEach((b) => (b.onclick = () => sendInvite(byId[b.dataset.send])));
}
function sendInvite(r) {
  const link = `${location.origin}${location.pathname}?invite=${r.token}#/signup`;
  const first = (r.name || '').split(' ')[0];
  const subject = 'Ton accès à Spartel';
  const body = `Salut ${first},\n\nTa demande d’accès à Spartel est acceptée. Crée ton compte avec ce lien :\n${link}\n\nSur iPhone : ouvre le lien dans Safari, puis Partager → « Sur l’écran d’accueil » pour avoir l’appli comme une vraie app.\n\nÀ bientôt sur l’eau,\n${S.profile?.display_name || 'Spartel'}`;
  const m = modal(`<p class="h" style="font-size:18px;margin:0 0 6px">Envoyer l’accès à ${esc(first)}</p><p class="small muted" style="margin:0 0 14px">${esc(r.email)}</p>
    <div class="btn-row" style="flex-direction:column"><a class="btn sun" href="mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">${icon('share', 16)}Envoyer par e-mail</a>
    <button class="btn ghost" id="cp">${icon('copy', 16)}Copier le lien (WhatsApp…)</button></div>
    <p class="small muted" style="margin:12px 0 0;word-break:break-all">${esc(link)}</p>`);
  m.querySelector('#cp').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Lien copié'); } catch (e) { toast(link, 8000); } };
  m.querySelector('a.btn').addEventListener('click', () => setTimeout(() => { m.remove(); if (location.hash.startsWith('#/access')) viewAccess(); }, 600));
}

function notFound() {
  page(`<main class="screen">${topbar({ back: true })}<div class="empty card"><p>Introuvable, ou tu n’y as pas accès.</p><a class="btn" href="#/">Accueil</a></div></main>`, { tab: null });
}

/* ---------------- Routeur ---------------- */
const M = market({ sb, S, page, topbar, icon, esc, num, kg, fmtDate, fmtTime, toast, fail, go, modal, confirmBox, signed, shareOrCopy, qs, localDT, uuid, compressImage, notFound, SPECIES, TECHNIQUES, initials });
const routes = [
  [/^#?\/?$/, viewHome], [/^#\/map/, viewMap], [/^#\/spot-new/, () => viewSpotForm()], [/^#\/spot-edit\/(.+)/, viewSpotForm], [/^#\/spot\/(.+)/, viewSpot],
  [/^#\/gpx/, viewGPX], [/^#\/catch-new/, viewCatchForm], [/^#\/catch\/(.+)/, viewCatch],
  [/^#\/lures/, viewLures], [/^#\/lure-new/, () => viewLureForm()], [/^#\/lure\/(.+)/, viewLureForm],
  [/^#\/trips/, viewTrips], [/^#\/trip-new/, () => viewTripForm()], [/^#\/trip-edit\/(.+)/, viewTripForm], [/^#\/trip\/(.+)/, viewTrip],
  [/^#\/crew/, viewCrew], [/^#\/reset/, viewReset], [/^#\/forecast/, viewForecast], [/^#\/stats/, viewStats],
  ...M.routes, [/^#\/access/, viewAccess],
];
async function route() {
  if (!S.user) return viewAuth(location.hash.startsWith('#/signup') || localStorage.getItem('pendingInvite') ? 'signup' : 'login');
  if (location.hash.startsWith('#/signup')) history.replaceState(null, '', '#/');
  if (location.hash.startsWith('#/reset')) return viewReset();
  const h = location.hash.split('?')[0] || '#/';
  if (!S.crew) {
    const mr = [...M.routes, [/^#\/access/, viewAccess]].find(([re]) => re.test(h));
    if (!mr) return viewOnboarding();
    try { await mr[1](h.match(mr[0])[1]); } catch (e) { fail(e); }
    return;
  }
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { try { await fn(m[1]); } catch (e) { fail(e); } return; }
  }
  notFound();
}

async function boot() {
  const sp = new URLSearchParams(location.search);
  const join = sp.get('join'), invite = sp.get('invite');
  if (join) localStorage.setItem('pendingJoin', join.toUpperCase());
  if (invite && /^[0-9a-f-]{36}$/i.test(invite)) localStorage.setItem('pendingInvite', invite.toLowerCase());
  if (join || invite) history.replaceState(null, '', location.pathname + (location.hash || '') || location.pathname);
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null;
  if (S.user) {
    localStorage.removeItem('pendingInvite');
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
