// Carte image d'une prise, à partager (Instagram, WhatsApp…) via le menu de partage du téléphone.
// Règle absolue : la carte ne montre JAMAIS le spot, la position ni le GPS.
// Le JPEG est dessiné dans un canvas : il ne contient aucune métadonnée.

import { SHARE_URL_LABEL } from './config.js';

const FORMATS = {
  story: { w: 1080, h: 1920, label: 'Story', safeBottom: 330, safeTop: 170 },
  post: { w: 1080, h: 1350, label: 'Post', safeBottom: 90, safeTop: 70 },
};
const NAVY = '#0B1F33', SUN = '#E2703A', SAND = '#F1ECE2';

async function loadBlobImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('photo');
  return createImageBitmap(await r.blob(), { imageOrientation: 'from-image' });
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function cover(ctx, img, w, h) {
  const k = Math.max(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
function fit(ctx, text, maxW, size, weight, family) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; s -= 4; } while (ctx.measureText(text).width > maxW && s > 36);
  return s + 4;
}

function draw(c, W, H, fmt, photo, logo) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const M = 72; // marge latérale
  const H_ = '"Archivo", system-ui, sans-serif', B_ = '"Inter", system-ui, sans-serif';

  // fond
  if (photo) cover(ctx, photo, W, H);
  else {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1C3550'); g.addColorStop(1, NAVY);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (logo) { ctx.globalAlpha = .16; ctx.drawImage(logo, W / 2 - 380, H * .3 - 380, 760, 760); ctx.globalAlpha = 1; }
  }
  // dégradés de lisibilité
  let g = ctx.createLinearGradient(0, 0, 0, H * .26); g.addColorStop(0, 'rgba(11,31,51,.62)'); g.addColorStop(1, 'rgba(11,31,51,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * .26);
  g = ctx.createLinearGradient(0, H * .42, 0, H); g.addColorStop(0, 'rgba(11,31,51,0)'); g.addColorStop(.55, 'rgba(11,31,51,.82)'); g.addColorStop(1, 'rgba(11,31,51,.96)');
  ctx.fillStyle = g; ctx.fillRect(0, H * .42, W, H * .58);

  // marque en haut
  const ty = fmt.safeTop;
  if (logo) ctx.drawImage(logo, M, ty, 76, 76);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.font = `800 44px ${H_}`; ctx.fillText('SPARTEL', M + 96, ty + 40);

  // bloc d'infos, ancré au-dessus de la zone basse
  let y = H - fmt.safeBottom;
  ctx.textBaseline = 'alphabetic';
  // pied : URL + promesse
  ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.font = `600 32px ${B_}`;
  ctx.fillText(SHARE_URL_LABEL, M, y);
  y -= 46;
  ctx.fillStyle = SAND; ctx.font = `500 30px ${B_}`;
  ctx.fillText('Tes spots restent entre amis.', M, y);
  y -= 70;
  // leurre
  if (c.lure) {
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `600 36px ${B_}`;
    const t = `Leurre : ${c.lure}`; ctx.fillText(t.length > 38 ? t.slice(0, 37) + '…' : t, M, y);
    y -= 62;
  }
  // pêcheur · date
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `600 38px ${B_}`;
  ctx.fillText([c.angler ? `par ${c.angler}` : null, c.dateLabel].filter(Boolean).join(' · '), M, y);
  y -= 84;
  // poids · taille
  const stat = [c.weight, c.length, c.released ? 'Relâché' : null].filter(Boolean).join('  ·  ');
  if (stat) {
    ctx.fillStyle = SUN; const s = fit(ctx, stat.toUpperCase(), W - 2 * M, 66, 800, H_);
    ctx.font = `800 ${s}px ${H_}`; ctx.fillText(stat.toUpperCase(), M, y);
    y -= s + 22;
  }
  // espèce
  ctx.fillStyle = '#fff'; const sp = (c.species || 'Prise').toUpperCase();
  const fs = fit(ctx, sp, W - 2 * M, 120, 800, H_);
  ctx.font = `800 ${fs}px ${H_}`; ctx.fillText(sp, M, y);
  return cv;
}

const toBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
const slug = (s) => String(s || 'prise').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * c = { species, weight, length, angler, dateLabel, lure, released, photoUrl }
 * deps = { modal(html) -> element, toast(msg) }
 */
export async function openShareCard(c, { modal, toast }) {
  const m = modal(`<p class="kicker" style="margin:0 0 10px">Partager la prise</p>
    <div class="chips" id="sc-fmt" style="margin-bottom:12px">${Object.entries(FORMATS).map(([k, f], i) => `<button class="chip" data-k="${k}" aria-pressed="${i === 0}">${f.label}${k === 'story' ? ' · 9:16' : ' · 4:5'}</button>`).join('')}</div>
    <div id="sc-box" style="display:flex;justify-content:center;min-height:120px;align-items:center"><p class="muted">Préparation de l’image…</p></div>
    <p class="small muted" style="margin:10px 0 12px">L’image ne montre ni le spot ni la position.</p>
    <div class="btn-row"><button class="btn ghost" id="sc-save" disabled>Enregistrer</button><button class="btn sun" id="sc-share" disabled>Partager</button></div>`);
  const box = m.querySelector('#sc-box');
  let photo = null, logo = null, cur = 'story', blob = null, busy = false;
  try { await document.fonts.load('800 80px Archivo'); await document.fonts.load('600 32px Inter'); } catch (e) {}
  try { logo = await loadImg('icons/symbol.svg'); } catch (e) {}
  if (c.photoUrl) { try { photo = await loadBlobImage(c.photoUrl); } catch (e) { toast('Photo indisponible : carte sans photo'); } }

  async function render() {
    if (busy) return; busy = true;
    const f = FORMATS[cur];
    const cv = draw(c, f.w, f.h, f, photo, logo);
    cv.style.cssText = 'width:auto;height:auto;max-width:100%;max-height:52vh;border-radius:14px;display:block;box-shadow:0 6px 18px rgba(11,31,51,.25)';
    box.replaceChildren(cv);
    blob = await toBlob(cv);
    m.querySelector('#sc-save').disabled = !blob; m.querySelector('#sc-share').disabled = !blob;
    busy = false;
  }
  m.querySelectorAll('#sc-fmt .chip').forEach((b) => (b.onclick = () => {
    cur = b.dataset.k; m.querySelectorAll('#sc-fmt .chip').forEach((x) => x.setAttribute('aria-pressed', x === b)); render();
  }));
  const fileOf = () => new File([blob], `spartel-${slug(c.species)}.jpg`, { type: 'image/jpeg' });
  m.querySelector('#sc-save').onclick = () => {
    if (!blob) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileOf().name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Image enregistrée');
  };
  m.querySelector('#sc-share').onclick = async () => {
    if (!blob) return;
    const file = fileOf();
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Spartel' }); m.remove(); return; }
      m.querySelector('#sc-save').click(); // ordinateur : pas de menu de partage de fichiers
    } catch (e) { if (e.name !== 'AbortError') toast('Partage impossible, utilise « Enregistrer »'); }
  };
  await render();
}
