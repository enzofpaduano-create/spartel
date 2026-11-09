// Installation de l'appli sur l'écran d'accueil (iPhone, Android) — depuis le site ou un lien partagé.
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferred = e;
  document.dispatchEvent(new Event('spartel:installable'));
});
window.addEventListener('appinstalled', () => { deferred = null; document.dispatchEvent(new Event('spartel:installed')); });

const ua = navigator.userAgent || '';
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /android/i.test(ua);
// Navigateurs intégrés (Instagram, Facebook, WhatsApp, Google…) : l'installation n'y est pas possible
const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|GSA\/|; wv\)/i.test(ua)
  || (isIOS && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua));

const SHARE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/></svg>';
const DOTS_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-3px"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

const here = () => location.origin + location.pathname;
const chromeIntent = () => `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;

function stepList(items) {
  return `<ol class="inst-steps">${items.map((t) => `<li>${t}</li>`).join('')}</ol>`;
}

/* Carte d'installation adaptée à l'appareil. Vide si l'appli est déjà installée. */
export function installCard({ welcome = false, dismissible = false } = {}) {
  if (isStandalone()) return '';
  let title, body;
  const openHint = inApp
    ? `<div class="inst-warn"><b>Tu es dans un navigateur intégré</b> (WhatsApp, Instagram…). ${isIOS ? 'Ouvre ce lien dans <b>Safari</b> pour pouvoir installer l’appli.' : 'Ouvre ce lien dans <b>Chrome</b> pour pouvoir installer l’appli.'}
        <div class="btn-row" style="margin-top:8px">${isAndroid ? `<a class="btn sm sun" href="${chromeIntent()}">Ouvrir dans Chrome</a>` : ''}<button class="btn sm ghost" type="button" data-inst-copy>Copier le lien</button></div></div>`
    : '';
  if (isIOS) {
    title = 'Installer Spartel sur iPhone';
    body = `${openHint}${stepList([
      `Dans <b>Safari</b>, touche le bouton <b>Partager</b> ${SHARE_SVG} en bas de l’écran.`,
      'Fais défiler et choisis <b>« Sur l’écran d’accueil »</b>.',
      'Touche <b>Ajouter</b> : Spartel apparaît comme une vraie appli.',
    ])}`;
  } else if (isAndroid) {
    title = 'Installer Spartel sur Android';
    body = `${openHint}${deferred
      ? '<button class="btn sun" type="button" data-inst-go>Installer l’application</button>'
      : stepList([`Dans <b>Chrome</b>, touche le menu ${DOTS_SVG} en haut à droite.`, 'Choisis <b>« Installer l’application »</b> (ou « Ajouter à l’écran d’accueil »).', 'Confirme : Spartel apparaît parmi tes applis.'])}`;
  } else {
    title = 'Installer Spartel';
    body = deferred
      ? '<button class="btn sun" type="button" data-inst-go>Installer l’application</button>'
      : `<p class="muted" style="margin:0 0 10px">Spartel se pense pour le téléphone : ouvre ce lien sur ton iPhone ou ton Android pour l’installer.</p><button class="btn sm ghost" type="button" data-inst-copy>Copier le lien</button>`;
  }
  return `<section class="card install" id="inst">
    <div class="row between"><b>${title}</b>${dismissible ? '<button class="iconbtn" data-inst-hide aria-label="Masquer">✕</button>' : ''}</div>
    <p class="muted small" style="margin:4px 0 10px">${welcome ? 'Pas de store : tu l’installes en 10 secondes, il s’ouvre en plein écran et marche même sans réseau en mer.' : 'En plein écran, avec les notifications, et disponible même sans réseau.'}</p>
    ${body}
  </section>`;
}

/* À appeler après l'insertion de la carte dans le DOM. */
export function installInit(root = document) {
  const card = root.querySelector('#inst');
  if (!card) return;
  const refresh = () => {
    const c = root.querySelector('#inst'); if (!c) return;
    const dismissible = !!c.querySelector('[data-inst-hide]');
    const welcome = /Pas de store/.test(c.textContent);
    c.outerHTML = installCard({ welcome, dismissible });
    installInit(root);
  };
  card.querySelector('[data-inst-go]')?.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) {}
    deferred = null; refresh();
  });
  card.querySelector('[data-inst-copy]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(here()); const b = card.querySelector('[data-inst-copy]'); b.textContent = 'Lien copié ✓'; } catch (e) { prompt('Copie ce lien', here()); }
  });
  card.querySelector('[data-inst-hide]')?.addEventListener('click', () => { localStorage.setItem('hideInstall2', String(Date.now())); card.remove(); });
  if (!card._wired) {
    card._wired = true;
    const on = () => document.contains(card) && refresh();
    document.addEventListener('spartel:installable', on, { once: true });
    document.addEventListener('spartel:installed', () => card.remove(), { once: true });
  }
}

export const installHidden = () => { const t = +localStorage.getItem('hideInstall2') || 0; return Date.now() - t < 7 * 864e5; };
