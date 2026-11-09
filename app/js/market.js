// Spartel — sorties à réserver, réservations, chat capitaine, paiement, profils publics.
// Maroc : réservation sur l'appli, paiement direct au capitaine (espèces, virement, acompte).
// Ailleurs : paiement par carte via Stripe Connect, l'argent va sur le compte Stripe du capitaine.

export function market(ctx) {
  const { sb, S, page, topbar, icon, esc, num, kg, fmtDate, fmtTime, toast, fail, go, modal, confirmBox, signed, shareOrCopy, qs, localDT, uuid, compressImage, notFound, SPECIES, TECHNIQUES, initials } = ctx;
  const $app = document.getElementById('app');

  const COUNTRIES = [['MA', 'Maroc'], ['ES', 'Espagne'], ['PT', 'Portugal'], ['FR', 'France'], ['IT', 'Italie'], ['GR', 'Grèce'], ['HR', 'Croatie'], ['MT', 'Malte'], ['GB', 'Royaume-Uni'], ['IE', 'Irlande']];
  const countryName = (c) => COUNTRIES.find((x) => x[0] === c)?.[1] || c;
  const money = (cents, cur) => {
    const v = (cents || 0) / 100;
    const s = v.toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
    return cur === 'EUR' ? `${s} €` : `${s} ${cur}`;
  };
  const STATUS = {
    requested: ['En attente', '#B9531F'], accepted: ['Acceptée', '#1C3550'], confirmed: ['Confirmée', '#1E7A46'], paid: ['Payée', '#1E7A46'],
    declined: ['Refusée', '#4A5A6A'], cancelled: ['Annulée', '#4A5A6A'], refunded: ['Remboursée', '#4A5A6A'],
  };
  const pill = (b) => {
    let [label, color] = STATUS[b.status] || [b.status, '#4A5A6A'];
    if (b.status === 'accepted') label = b.pay_mode === 'card' ? 'À payer' : 'Acompte attendu';
    return `<span class="pill" style="--pc:${color}">${esc(label)}</span>`;
  };
  const ACTIVE = ['requested', 'accepted', 'confirmed', 'paid'];
  const outPhoto = (p) => (p ? sb.storage.from('outings').getPublicUrl(p).data.publicUrl : null);
  const photosOf = (o) => (o.photos?.length ? o.photos : o.photo_path ? [o.photo_path] : []);
  const cover = (o) => outPhoto(photosOf(o)[0]);

  /* ---------- Personnes ---------- */
  const people = {};
  async function loadPeople(ids) {
    const need = [...new Set(ids.filter((i) => i && !people[i]))];
    if (need.length) {
      const { data } = await sb.from('profiles').select('id, display_name, bio, home_port').in('id', need);
      (data || []).forEach((p) => (people[p.id] = p));
    }
  }
  const pname = (id) => (id === S.user.id ? 'Toi' : people[id]?.display_name || 'Pêcheur');
  const pav = (id, cls = '') => `<span class="avatar ${cls}">${esc(initials(people[id]?.display_name || '?'))}</span>`;

  /* ---------- Stripe ---------- */
  async function callStripe(action, body = {}) {
    const { data, error } = await sb.functions.invoke('stripe', { body: { action, ...body } });
    if (error) {
      let m = error.message;
      try { const j = await error.context.json(); m = j.error || m; } catch (e) {}
      throw new Error(m);
    }
    return data;
  }
  let stripeCfg = null;
  async function stripeConfig() {
    if (!stripeCfg) stripeCfg = await callStripe('config').catch(() => ({ enabled: false, fee_pct: 10 }));
    return stripeCfg;
  }
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/'; s.onload = () => res(window.Stripe); s.onerror = () => rej(new Error('Impossible de charger le module de paiement'));
      document.head.appendChild(s);
    });
  }

  /* ---------- Cartes de sortie ---------- */
  function outingCard(o, taken) {
    const left = o.seats_total - (taken || 0);
    const ph = cover(o), n = photosOf(o).length;
    const price = o.price_cents ? `${money(o.price_cents, o.currency)}<span class="small muted"> / ${o.price_unit === 'boat' ? 'bateau' : 'pers.'}</span>` : '<span style="color:var(--navy)">Entre amis</span>';
    return `<a class="card ocard" href="#/outing/${o.id}">
      <div class="ophoto">${ph ? `<img src="${esc(ph)}" alt="" loading="lazy">` : `<span>${icon('boat', 38, 1.6)}</span>`}
        ${o.visibility === 'crew' ? `<span class="otag">${icon('users', 12)}Équipage</span>` : ''}${n > 1 ? `<span class="otag" style="left:auto;right:10px">${icon('cam', 12)}${n}</span>` : ''}${o.status === 'cancelled' ? '<span class="otag" style="background:var(--danger)">Annulée</span>' : ''}</div>
      <div style="padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px">
        <div class="row between"><span class="kicker">${esc(fmtDate(o.start_at, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${fmtTime(o.start_at)}</span><span class="small muted">${esc(countryName(o.country))}</span></div>
        <b class="h" style="font-size:17px;line-height:1.15">${esc(o.title)}</b>
        <span class="small muted ellipsis">${esc([o.port, `${num(o.duration_h)} h`, o.boat_name].filter(Boolean).join(' · '))}</span>
        <div class="row between" style="margin-top:4px"><span class="row" style="gap:8px;min-width:0">${pav(o.host_id)}<span class="small ellipsis" style="font-weight:600">${esc(pname(o.host_id))}</span></span><b style="font-size:16px;color:var(--sun-dark);white-space:nowrap">${price}</b></div>
        <span class="small" style="font-weight:600;color:${left > 0 ? 'var(--navy)' : 'var(--danger)'}">${left > 0 ? `${left} place${left > 1 ? 's' : ''} libre${left > 1 ? 's' : ''}` : 'Complet'}</span>
      </div></a>`;
  }
  async function seatsMap(ids) {
    if (!ids.length) return {};
    const { data } = await sb.rpc('outings_seats', { ids });
    return Object.fromEntries((data || []).map((r) => [r.id, r.taken]));
  }
  /* ---------- Liste des sorties ---------- */
  async function viewOutings() {
    const f = qs().f || 'all';
    const since = new Date(Date.now() - 3 * 3600e3).toISOString();
    const [{ data: list }, { count: pending }] = await Promise.all([
      sb.from('outings').select('*').eq('status', 'open').gte('start_at', since).order('start_at').limit(80),
      sb.from('bookings').select('id', { count: 'exact', head: true }).eq('host_id', S.user.id).eq('status', 'requested'),
    ]);
    const all = list || [];
    const shown = all.filter((o) => f === 'all' || (f === 'crew' ? o.visibility === 'crew' : f === 'mine' ? o.host_id === S.user.id : f === 'other' ? !['MA', 'ES'].includes(o.country) : o.country === f));
    await loadPeople(shown.map((o) => o.host_id));
    const seats = await seatsMap(shown.map((o) => o.id));
    const chip = (k, l) => `<a class="chip ${f === k ? 'on' : ''}" href="#/outings?f=${k}">${l}</a>`;
    page(`<main class="screen">${topbar({ right: `<a class="btn sun sm" href="#/outing-new">${icon('plus', 16)}Proposer</a>` })}
      <section class="card dark"><p class="kicker" style="color:var(--sun)">Sorties en mer</p><h1 class="h" style="font-size:22px;margin-top:4px">Réserve ta place à bord</h1>
        <p class="small muted" style="margin:6px 0 0">Sorties entre amis ou avec un capitaine. Au Maroc tu paies le capitaine directement, ailleurs par carte sur Spartel.</p></section>
      <div class="btn-row"><a class="btn ghost sm" href="#/bookings">${icon('clock', 16)}Mes réservations</a><a class="btn ghost sm" href="#/captain" style="position:relative">${icon('boat', 16)}Espace capitaine${pending ? `<span class="dotn">${pending}</span>` : ''}</a></div>
      <nav class="chips" aria-label="Filtrer">${chip('all', 'Toutes')}${chip('MA', 'Maroc')}${chip('ES', 'Espagne')}${chip('other', 'Ailleurs')}${chip('crew', 'Mon équipage')}${chip('mine', 'Les miennes')}</nav>
      <section class="ogrid">${shown.length ? shown.map((o) => outingCard(o, seats[o.id])).join('') : `<div class="empty card" style="grid-column:1/-1">${icon('boat', 34)}<p>Aucune sortie ouverte pour l’instant.<br>Propose la première : sortie entre amis ou sortie pro.</p><a class="btn sun sm" href="#/outing-new">Proposer une sortie</a></div>`}</section>
    </main>`, { tab: 'outings' });
  }

  /* ---------- Fiche sortie ---------- */
  async function viewOuting(id) {
    const { data: o } = await sb.from('outings').select('*').eq('id', id).maybeSingle();
    if (!o) return notFound();
    const isHost = o.host_id === S.user.id;
    const [seats, { data: prof }, { data: bks }] = await Promise.all([
      seatsMap([o.id]), sb.rpc('public_profile', { p_user: o.host_id }),
      sb.from('bookings').select('*').eq('outing_id', o.id).order('created_at', { ascending: false }),
    ]);
    const taken = seats[o.id] || 0, left = o.seats_total - taken;
    const mine = (bks || []).find((b) => b.client_id === S.user.id && ACTIVE.includes(b.status));
    await loadPeople([o.host_id, ...(bks || []).map((b) => b.client_id)]);
    const pics = photosOf(o).map(outPhoto);
    const cap = prof?.captain;
    const mode = !o.price_cents ? 'none' : o.country === 'MA' ? 'offline' : 'card';
    const cfg = mode === 'card' ? await stripeConfig() : null;
    const payText = mode === 'none'
      ? 'Sortie entre amis : rien à payer sur Spartel. Les frais (essence, appâts) se partagent entre vous.'
      : mode === 'offline'
        ? `Paiement direct au capitaine : ${[o.pay_cash && 'espèces sur place', o.pay_transfer && 'virement bancaire'].filter(Boolean).join(' ou ') || 'à convenir'}.${o.deposit_pct ? ` Acompte de ${o.deposit_pct} % pour confirmer la place.` : ''} Vous fixez les modalités ensemble dans le chat, une fois ta demande acceptée.`
        : `Paiement par carte sur Spartel, une fois ta demande acceptée par le capitaine. L’argent est versé sur son compte via Stripe.${cfg && !cfg.enabled ? ' (Paiement par carte en cours d’activation.)' : ''} Si le capitaine annule, tu es remboursé intégralement.`;
    const info = [
      ['clock', 'Départ', `${fmtDate(o.start_at, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(o.start_at)}`],
      ['clock', 'Durée', `${num(o.duration_h)} h`],
      ['pin', 'Port', `${o.port} · ${countryName(o.country)}`],
      ['boat', 'Bateau', o.boat_name],
      ['users', 'Places', `${Math.max(left, 0)} libre${left > 1 ? 's' : ''} sur ${o.seats_total}`],
      ['lure', 'Technique', o.technique],
      ['check', 'Inclus', o.includes],
    ].filter((r) => r[2]);
    page(`<main class="screen">${topbar({ title: 'Sortie', back: true, right: `<button class="iconbtn" id="sh" aria-label="Partager">${icon('share')}</button>` })}
      ${pics.length ? `<div class="gallery" id="gal">${pics.map((u, i) => `<img src="${esc(u)}" alt="Photo ${i + 1} du bateau" ${i ? 'loading="lazy"' : ''}>`).join('')}</div>${pics.length > 1 ? `<div class="gdots" aria-hidden="true">${pics.map((_, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>` : ''}` : ''}
      <div><p class="kicker" style="margin:0">${o.visibility === 'crew' ? 'Sortie d’équipage · ' : ''}${esc(countryName(o.country))}${o.status === 'cancelled' ? ' · <span style="color:var(--danger)">Annulée</span>' : ''}</p><h2 class="h" style="font-size:24px;margin-top:4px">${esc(o.title)}</h2></div>
      <a class="card row" href="#/u/${o.host_id}" style="text-decoration:none;color:inherit">${pav(o.host_id, 'lg sun')}<div class="grow"><b>${esc(people[o.host_id]?.display_name || 'Capitaine')}</b><div class="small muted">${cap?.boat_name ? `Capitaine · ${esc(cap.boat_name)}` : 'Organisateur'}${prof?.catches?.length ? ` · ${prof.catches.length} prise${prof.catches.length > 1 ? 's' : ''} publiée${prof.catches.length > 1 ? 's' : ''}` : ''}${prof?.outings_done ? ` · ${prof.outings_done} sortie${prof.outings_done > 1 ? 's' : ''} réalisée${prof.outings_done > 1 ? 's' : ''}` : ''}</div></div>${icon('chev')}</a>
      <div class="card list" style="padding:2px 16px">${info.map(([ic, k, v]) => `<div class="list-item"><span style="color:var(--sun)">${icon(ic, 18)}</span><span class="muted" style="width:76px">${k}</span><b class="grow" style="text-align:right">${esc(v)}</b></div>`).join('')}</div>
      ${o.species?.length ? `<div class="chips wrap">${o.species.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
      ${o.description ? `<p style="margin:0;white-space:pre-wrap">${esc(o.description)}</p>` : ''}
      <section class="card pricebox"><div class="row between"><span class="muted small" style="font-weight:600">Prix</span><b class="h" style="font-size:24px;color:var(--sun-dark)">${o.price_cents ? `${money(o.price_cents, o.currency)}<span class="small muted" style="font-family:var(--b);text-transform:none"> / ${o.price_unit === 'boat' ? 'bateau entier' : 'personne'}</span>` : 'Gratuit'}</b></div>
        <p class="small" style="margin:10px 0 0">${icon(mode === 'card' ? 'lock' : 'check', 14)} ${esc(payText)}</p></section>
      ${isHost ? hostBlock(o, bks || []) : mine
        ? `<a class="btn sun" href="#/booking/${mine.id}">Voir ma réservation · ${STATUS[mine.status]?.[0] || ''}</a>`
        : o.status === 'open' && new Date(o.start_at) > new Date() && left > 0 ? `<button class="btn sun" id="book">${icon('boat', 18)}${o.price_cents ? 'Réserver' : 'Je viens'}</button>`
        : `<button class="btn" disabled>${left <= 0 ? 'Complet' : 'Plus réservable'}</button>`}
    </main>`, { tab: 'outings' });
    const gal = $app.querySelector('#gal');
    if (gal) gal.onscroll = () => { const i = Math.round(gal.scrollLeft / gal.clientWidth); $app.querySelectorAll('.gdots span').forEach((d, k) => d.classList.toggle('on', k === i)); };
    $app.querySelector('#sh').onclick = () => shareOrCopy(`${o.title} — ${fmtDate(o.start_at, { weekday: 'long', day: 'numeric', month: 'long' })} · ${o.port}\n${location.origin}${location.pathname}#/outing/${o.id}`, 'Spartel');
    const bk = $app.querySelector('#book'); if (bk) bk.onclick = () => bookModal(o, left);
    const ed = $app.querySelector('#edit'); if (ed) ed.onclick = () => go(`#/outing-edit/${o.id}`);
    const ca = $app.querySelector('#cancelOut');
    if (ca) ca.onclick = async () => {
      if (!(await confirmBox('Annuler la sortie ? Les participants sont prévenus dans leur conversation.', 'Annuler la sortie'))) return;
      const { error } = await sb.rpc('cancel_outing', { p_id: o.id });
      error ? fail(error) : (toast('Sortie annulée'), viewOuting(o.id));
    };
  }
  function hostBlock(o, bks) {
    const act = bks.filter((b) => b.status !== 'declined');
    return `<section class="card"><div class="row between"><p class="kicker" style="margin:0">Demandes (${act.length})</p><span class="small muted">c’est ta sortie</span></div>
      <div class="list" style="margin-top:6px">${act.length ? act.map((b) => `<a class="list-item" href="#/booking/${b.id}">${pav(b.client_id)}<span class="grow"><b>${esc(pname(b.client_id))}</b><br><span class="small muted">${b.seats} place${b.seats > 1 ? 's' : ''}${b.total_cents ? ' · ' + money(b.total_cents, b.currency) : ''}</span></span>${pill(b)}${icon('chev', 18)}</a>`).join('') : '<p class="muted small" style="margin:8px 0">Pas encore de demande. Partage la sortie à tes amis.</p>'}</div></section>
      ${o.status === 'open' ? `<div class="btn-row"><button class="btn ghost" id="edit">${icon('edit', 16)}Modifier</button><button class="btn danger" id="cancelOut">Annuler la sortie</button></div>` : ''}`;
  }
  function bookModal(o, left) {
    const boat = o.price_unit === 'boat';
    const max = boat ? o.seats_total : Math.min(left, 12);
    const m = modal(`<p class="h" style="font-size:18px;margin:0 0 4px">${o.price_cents ? 'Réserver' : 'Rejoindre la sortie'}</p><p class="small muted" style="margin:0 0 14px">${esc(o.title)} · ${esc(fmtDate(o.start_at))}</p>
      <form id="bf">${boat ? `<p class="small" style="margin:0">Bateau entier : ${o.seats_total} places pour ton groupe.</p>` : `<label class="f">Nombre de places<select name="seats">${Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label>`}
        <label class="f">Message au capitaine<textarea name="note" maxlength="1000" placeholder="Niveau, matériel, questions…"></textarea></label>
        ${o.price_cents ? `<div class="row between" style="background:var(--sand);border-radius:12px;padding:12px 14px"><span class="muted" style="font-weight:600">Total</span><b class="h" id="tot" style="font-size:20px;color:var(--sun-dark)"></b></div>` : ''}
        <p class="hint" style="margin:0">${!o.price_cents ? 'Le capitaine confirme ta place dans le chat.' : o.country === 'MA' ? 'Rien n’est payé maintenant. Une fois acceptée, vous fixez le paiement ensemble (espèces, virement, acompte).' : 'Rien n’est débité maintenant. Tu paies par carte une fois la demande acceptée.'}</p>
        <button class="btn sun">Envoyer la demande</button></form>`);
    const f = m.querySelector('#bf'), tot = m.querySelector('#tot');
    const upd = () => { if (tot) tot.textContent = money(boat ? o.price_cents : o.price_cents * (+f.seats?.value || 1), o.currency); };
    if (f.seats) f.seats.onchange = upd; upd();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = f.querySelector('button'); btn.disabled = true;
      const { data, error } = await sb.rpc('request_booking', { p_outing: o.id, p_seats: boat ? o.seats_total : +f.seats.value, p_note: f.note.value });
      if (error) { btn.disabled = false; return fail(error); }
      m.remove(); toast('Demande envoyée au capitaine'); go(`#/booking/${data.id}`);
    };
  }

  /* ---------- Formulaire de sortie ---------- */
  async function viewOutingForm(id) {
    let o = { country: 'MA', currency: 'MAD', price_unit: 'person', duration_h: 6, seats_total: 4, pay_cash: true, pay_transfer: true, deposit_pct: 30, visibility: 'public', species: [], price_cents: 0 };
    if (id) {
      const { data } = await sb.from('outings').select('*').eq('id', id).maybeSingle();
      if (!data || data.host_id !== S.user.id) return notFound();
      o = data;
    }
    const { data: cap } = await sb.from('captains').select('*').eq('user_id', S.user.id).maybeSingle();
    if (!id && cap) { o.country = cap.country; o.currency = cap.country === 'MA' ? 'MAD' : 'EUR'; o.boat_name = cap.boat_name; o.port = cap.home_port; }
    const start = o.start_at ? localDT(o.start_at) : (() => { const d = new Date(Date.now() + 3 * 86400e3); d.setHours(7, 0, 0, 0); return localDT(d); })();
    const sp = new Set(o.species || []);
    const SP = ['Thon rouge', 'Denti', 'Pagre', 'Loup (bar)', 'Courbine', 'Liche', 'Sériole', 'Dorade royale', 'Bonite', 'Espadon', 'Mérou', 'Pageot', 'Barracuda', 'Calamar'];
    page(`<main class="screen">${topbar({ title: id ? 'Modifier la sortie' : 'Proposer une sortie', back: true })}
      <form id="of">
        <div><p class="small muted" style="font-weight:600;margin:0 0 8px">Photos du bateau <span id="phreq"></span></p><div class="phgrid" id="phg"></div>
          <p class="hint" style="margin:6px 0 0">Jusqu’à 8 photos : le bateau, le pont, le matériel, une belle prise. La première sert de couverture.</p></div>
        <label class="f">Titre<input name="title" required minlength="3" maxlength="80" value="${esc(o.title || '')}" placeholder="Jigging au large du Cap Spartel"></label>
        <div><p class="small muted" style="font-weight:600;margin:0 0 8px">Pour qui ?</p><div class="chips" id="vis">
          <button type="button" class="chip ${o.visibility === 'public' ? 'on' : ''}" data-v="public">${icon('users', 14)}Tout Spartel</button>
          <button type="button" class="chip ${o.visibility === 'crew' ? 'on' : ''}" data-v="crew">${icon('lock', 14)}Mon équipage seulement</button></div></div>
        <div class="row"><label class="f">Pays<select name="country">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${o.country === c ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="f">Port de départ<input name="port" required maxlength="60" value="${esc(o.port || '')}" placeholder="Marina de Tanger"></label></div>
        <div class="row"><label class="f">Départ<input name="start" type="datetime-local" required value="${start}"></label><label class="f" style="flex:.6">Durée (h)<input name="dur" type="number" min="1" max="72" step="0.5" required value="${o.duration_h}"></label></div>
        <div class="row"><label class="f">Places<input name="seats" type="number" min="1" max="30" required value="${o.seats_total}"></label><label class="f">Bateau<input name="boat" maxlength="40" value="${esc(o.boat_name || '')}" placeholder="Nom du bateau"></label></div>
        <section class="card" style="display:flex;flex-direction:column;gap:12px"><p class="kicker" style="margin:0">Prix</p>
          <div class="row"><label class="f">Prix (0 = entre amis)<input name="price" type="number" min="0" step="1" inputmode="decimal" value="${o.price_cents / 100 || ''}" placeholder="0"></label>
            <label class="f" style="flex:.7">Devise<select name="currency"><option ${o.currency === 'MAD' ? 'selected' : ''}>MAD</option><option ${o.currency === 'EUR' ? 'selected' : ''}>EUR</option></select></label></div>
          <div class="chips" id="unit"><button type="button" class="chip ${o.price_unit === 'person' ? 'on' : ''}" data-u="person">Par personne</button><button type="button" class="chip ${o.price_unit === 'boat' ? 'on' : ''}" data-u="boat">Bateau entier</button></div>
          <div id="ma" style="display:flex;flex-direction:column;gap:10px">
            <p class="small" style="margin:0">Au Maroc, le client te paie directement. Choisis ce que tu acceptes :</p>
            <label class="switch">Espèces sur place<input type="checkbox" name="cash" ${o.pay_cash ? 'checked' : ''}></label>
            <label class="switch">Virement bancaire<input type="checkbox" name="transfer" ${o.pay_transfer ? 'checked' : ''}></label>
            <label class="f">Acompte demandé (%)<input name="deposit" type="number" min="0" max="100" step="5" value="${o.deposit_pct}"></label></div>
          <p class="small" id="cardnote" style="margin:0"></p>
        </section>
        <div><p class="small muted" style="font-weight:600;margin:0 0 8px">Espèces visées</p><div class="chips wrap" id="sp">${[...new Set([...SP, ...sp])].map((s) => `<button type="button" class="chip ${sp.has(s) ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
        <label class="f">Technique<select name="technique"><option value="">—</option>${TECHNIQUES.map((t) => `<option ${o.technique === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="f">Inclus<input name="includes" maxlength="120" value="${esc(o.includes || '')}" placeholder="Cannes, leurres, gilets, eau"></label>
        <label class="f">Description<textarea name="desc" maxlength="2000" placeholder="Le bateau, le programme, le niveau, le point de rendez-vous…">${esc(o.description || '')}</textarea></label>
        <p class="hint" id="pubnote" style="margin:0"></p>
        <button class="btn sun" type="submit">${id ? 'Enregistrer' : 'Publier la sortie'}</button>
      </form></main>`, { tab: false });
    const f = $app.querySelector('#of');
    const st = { vis: o.visibility, unit: o.price_unit, photos: [...photosOf(o)], files: [] };
    const renderPh = () => {
      const g = $app.querySelector('#phg');
      const items = [...st.photos.map((p, i) => ({ src: outPhoto(p), k: `p${i}` })), ...st.files.map((f, i) => ({ src: f._url ||= URL.createObjectURL(f), k: `f${i}` }))];
      g.innerHTML = items.map((it, i) => `<div class="phitem"><img src="${esc(it.src)}" alt="">${i === 0 ? '<span class="phcover">Couverture</span>' : ''}<button type="button" class="phx" data-k="${it.k}" aria-label="Retirer la photo">✕</button></div>`).join('')
        + (items.length < 8 ? `<label class="drop phadd">${icon('cam', 22)}<span class="small">Ajouter</span><input type="file" accept="image/*" multiple aria-label="Ajouter des photos du bateau"></label>` : '');
      g.querySelectorAll('.phx').forEach((b) => (b.onclick = () => { const k = b.dataset.k, i = +k.slice(1); (k[0] === 'p' ? st.photos : st.files).splice(i, 1); renderPh(); }));
      const inp = g.querySelector('input[type=file]');
      if (inp) inp.onchange = () => { st.files.push(...[...inp.files].slice(0, 8 - st.photos.length - st.files.length)); renderPh(); };
    };
    renderPh();
    const toggle = (sel, key, attr) => $app.querySelectorAll(`${sel} .chip`).forEach((c) => (c.onclick = () => { st[key] = c.dataset[attr]; $app.querySelectorAll(`${sel} .chip`).forEach((x) => x.classList.toggle('on', x === c)); refresh(); }));
    toggle('#vis', 'vis', 'v'); toggle('#unit', 'unit', 'u');
    $app.querySelectorAll('#sp .chip').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
    const refresh = () => {
      const ma = f.country.value === 'MA', paid = +f.price.value > 0;
      if (!ma) f.currency.value = 'EUR';
      f.currency.disabled = !ma;
      $app.querySelector('#ma').hidden = !(ma && paid);
      $app.querySelector('#unit').hidden = !paid;
      const cn = $app.querySelector('#cardnote');
      cn.innerHTML = !ma && paid ? `${icon('lock', 14)} Paiement par carte sur Spartel. ${cap?.stripe_ready ? 'Tes paiements sont actifs.' : cap?.country === 'MA' ? 'Pour encaisser hors du Maroc, indique ce pays dans ton <a href="#/captain">profil capitaine</a> puis active Stripe.' : 'Active-les dans l’<a href="#/captain">espace capitaine</a> pour encaisser.'}` : '';
      const pn = $app.querySelector('#pubnote');
      pn.innerHTML = st.vis === 'crew' ? 'Seuls les membres de ton équipage la verront.' : 'Visible par tous les membres de Spartel.';
      $app.querySelector('#phreq').textContent = paid ? '(au moins une)' : '(facultatif)';
      f.desc.required = paid;
    };
    f.country.onchange = refresh; f.price.oninput = refresh; refresh();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const ma = f.country.value === 'MA', price = Math.round((+f.price.value || 0) * 100);
        const row = {
          title: f.title.value.trim(), country: f.country.value, port: f.port.value.trim(),
          start_at: new Date(f.start.value).toISOString(), duration_h: +f.dur.value, seats_total: +f.seats.value,
          boat_name: f.boat.value.trim() || null, price_cents: price, currency: ma ? f.currency.value : 'EUR', price_unit: price ? st.unit : 'person',
          pay_cash: ma ? f.cash.checked : false, pay_transfer: ma ? f.transfer.checked : false, deposit_pct: ma && price ? Math.min(100, Math.max(0, +f.deposit.value || 0)) : 0,
          species: [...$app.querySelectorAll('#sp .chip.on')].map((c) => c.dataset.s), technique: f.technique.value || null,
          includes: f.includes.value.trim() || null, description: f.desc.value.trim() || null,
          visibility: st.vis, crew_id: S.crew?.id || null,
        };
        if (row.visibility === 'crew' && !row.crew_id) throw new Error('Rejoins d’abord un équipage');
        if (new Date(row.start_at) < new Date()) throw new Error('La date de départ est passée');
        if (price && st.photos.length + st.files.length === 0) throw new Error('Ajoute au moins une photo de ton bateau');
        if (price && !row.description) throw new Error('Ajoute une description de la sortie');
        btn.textContent = st.files.length ? 'Envoi des photos…' : 'Enregistrement…';
        const uploaded = await Promise.all(st.files.map(async (file) => {
          const blob = await compressImage(file, 1600);
          const path = `${S.user.id}/${uuid()}.jpg`;
          const { error } = await sb.storage.from('outings').upload(path, blob, { contentType: 'image/jpeg' });
          if (error) throw error;
          return path;
        }));
        row.photos = [...st.photos, ...uploaded];
        row.photo_path = row.photos[0] || null;
        const q = id ? sb.from('outings').update(row).eq('id', id) : sb.from('outings').insert(row);
        const { data, error } = await q.select('id').single();
        if (error) throw error;
        toast(id ? 'Sortie mise à jour' : 'Sortie publiée'); go(`#/outing/${data.id}`);
      } catch (err) { fail(err); btn.disabled = false; btn.textContent = id ? 'Enregistrer' : 'Publier la sortie'; }
    };
  }

  /* ---------- Mes réservations ---------- */
  async function viewBookings() {
    const tab = qs().t || 'client';
    const col = tab === 'host' ? 'host_id' : 'client_id';
    const { data } = await sb.from('bookings').select('*, outings(title, start_at, port, photo_path)').eq(col, S.user.id).order('created_at', { ascending: false }).limit(100);
    const list = data || [];
    await loadPeople(list.map((b) => (tab === 'host' ? b.client_id : b.host_id)));
    const chip = (k, l) => `<a class="chip ${tab === k ? 'on' : ''}" href="#/bookings?t=${k}">${l}</a>`;
    page(`<main class="screen">${topbar({ title: 'Réservations', back: true })}
      <nav class="chips">${chip('client', 'Mes réservations')}${chip('host', 'Demandes reçues')}</nav>
      <div class="card list" style="padding:0 16px">${list.length ? list.map((b) => {
        const other = tab === 'host' ? b.client_id : b.host_id;
        return `<a class="list-item" href="#/booking/${b.id}">${pav(other)}<span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(b.outings?.title || 'Sortie')}</b><span class="small muted">${b.outings ? esc(fmtDate(b.outings.start_at)) + ' · ' : ''}${esc(pname(other))} · ${b.seats} pl.${b.total_cents ? ' · ' + money(b.total_cents, b.currency) : ''}</span></span>${pill(b)}</a>`;
      }).join('') : `<p class="muted" style="margin:16px 0">${tab === 'host' ? 'Aucune demande reçue.' : 'Aucune réservation. Trouve une sortie dans l’onglet Sorties.'}</p>`}</div>
    </main>`, { tab: 'outings' });
  }

  /* ---------- Réservation + chat ---------- */
  async function viewBooking(id, opts = {}) {
    const { data: b } = await sb.from('bookings').select('*, outings(*)').eq('id', id).maybeSingle();
    if (!b) return notFound();
    const o = b.outings, isHost = b.host_id === S.user.id, other = isHost ? b.client_id : b.host_id;
    const q = qs();
    if (b.pay_mode === 'card' && b.status === 'accepted' && b.stripe_pi && !opts.synced) {
      try { const r = await callStripe('confirm', { booking_id: b.id }); if (r.status === 'paid') return viewBooking(id, { synced: true }); } catch (e) { /* paiement non finalisé */ }
    }
    const [{ data: msgs }, cfg, capRow] = await Promise.all([
      sb.from('booking_messages').select('*').eq('booking_id', id).order('id').limit(500),
      b.pay_mode === 'card' ? stripeConfig() : Promise.resolve(null),
      isHost ? sb.from('captains').select('bank_info').eq('user_id', S.user.id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    ]);
    await loadPeople([b.host_id, b.client_id]);
    const scrollY = opts.keepScroll ? window.scrollY : null;
    page(`<main class="screen chatscreen">${topbar({ title: isHost ? 'Demande' : 'Ma réservation', back: true })}
      <a class="card row" href="#/outing/${o.id}" style="text-decoration:none;color:inherit;padding:12px">${cover(o) ? `<img class="thumb" src="${esc(cover(o))}" alt="">` : `<span class="thumb">${icon('boat')}</span>`}
        <div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(o.title)}</b><span class="small muted">${esc(fmtDate(o.start_at, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${fmtTime(o.start_at)} · ${esc(o.port)}</span></div>${pill(b)}</a>
      <section class="card" id="pay">${payBlock(b, o, isHost, cfg, capRow)}</section>
      <section class="chat" aria-label="Conversation"><div class="row" style="gap:8px;margin-bottom:6px">${pav(other)}<b>${esc(people[other]?.display_name || '')}</b><a class="small" href="#/u/${other}" style="margin-left:auto">Voir le profil</a></div>
        <div id="msgs">${(msgs || []).map(bubble).join('') || '<p class="small muted">Aucun message.</p>'}</div></section>
      <form id="mf" class="composer"><input name="m" maxlength="2000" placeholder="Écrire au ${isHost ? 'client' : 'capitaine'}…" autocomplete="off" aria-label="Message"><button class="iconbtn sendbtn" aria-label="Envoyer">${icon('nav', 20)}</button></form>
    </main>`, { tab: false });
    if (scrollY != null) window.scrollTo(0, scrollY); else window.scrollTo(0, document.body.scrollHeight);
    wirePay(b, o, isHost, capRow);
    const mf = $app.querySelector('#mf');
    mf.onsubmit = async (e) => {
      e.preventDefault(); const t = mf.m.value.trim(); if (!t) return;
      mf.m.value = '';
      const { error } = await sb.from('booking_messages').insert({ booking_id: id, body: t, kind: 'text' });
      if (error) { mf.m.value = t; fail(error); }
    };
    const box = $app.querySelector('#msgs'); const seen = new Set((msgs || []).map((m) => m.id));
    const ch = sb.channel(`bk-${id}-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'booking_messages', filter: `booking_id=eq.${id}` }, (p) => {
        if (seen.has(p.new.id)) return; seen.add(p.new.id);
        box.querySelector('p.small.muted')?.remove();
        box.insertAdjacentHTML('beforeend', bubble(p.new)); window.scrollTo(0, document.body.scrollHeight);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, () => { if (location.hash.startsWith(`#/booking/${id}`)) viewBooking(id, { synced: true, keepScroll: true }); })
      .subscribe();
    S.cleanup.push(() => sb.removeChannel(ch));
    if (q.paid && b.status === 'accepted') toast('Paiement en cours de confirmation…');
  }
  function bubble(m) {
    if (m.kind === 'system') return `<p class="sysmsg">${esc(m.body)}<span>${fmtTime(m.created_at)}</span></p>`;
    const me = m.sender_id === S.user.id;
    if (m.kind === 'bank') return `<div class="msg ${me ? 'me' : ''} bank"><p class="kicker" style="margin:0 0 4px">${icon('lock', 12)} Coordonnées bancaires</p><div style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px">${esc(m.body)}</div><button type="button" class="btn sm ghost copybank" data-t="${esc(m.body)}" style="margin-top:8px">${icon('copy', 14)}Copier</button><span class="t">${fmtTime(m.created_at)}</span></div>`;
    return `<div class="msg ${me ? 'me' : ''}">${esc(m.body)}<span class="t">${fmtTime(m.created_at)}</span></div>`;
  }
  document.addEventListener('click', async (e) => {
    const c = e.target.closest?.('.copybank'); if (!c) return;
    try { await navigator.clipboard.writeText(c.dataset.t); toast('Copié'); } catch (err) { toast(c.dataset.t, 6000); }
  });

  function payBlock(b, o, isHost, cfg, capRow) {
    const line = (k, v, strong) => `<div class="row between" style="padding:6px 0"><span class="muted">${k}</span>${strong ? `<b class="h" style="font-size:20px;color:var(--sun-dark)">${v}</b>` : `<b>${v}</b>`}</div>`;
    const done = ['declined', 'cancelled', 'refunded'].includes(b.status);
    let h = `<div class="row between"><p class="kicker" style="margin:0">${b.pay_mode === 'card' ? 'Paiement par carte' : b.pay_mode === 'offline' ? 'Paiement au capitaine' : 'Sortie entre amis'}</p><span class="small muted">${b.seats} place${b.seats > 1 ? 's' : ''}</span></div>`;
    if (b.pay_mode !== 'none') h += line('Total', money(b.total_cents, b.currency), true);
    if (b.pay_mode === 'offline') {
      if (b.deposit_cents) h += line(`Acompte (${o.deposit_pct} %)`, `${money(b.deposit_cents, b.currency)} ${b.deposit_received ? '✓' : ''}`) + line('Solde', `${money(b.total_cents - b.deposit_cents, b.currency)} ${b.balance_received ? '✓' : ''}`);
      else if (b.balance_received) h += line('Payé', '✓');
      h += `<div class="plan"><span class="small muted" style="font-weight:600">Modalités convenues</span><p style="margin:4px 0 0">${b.pay_plan ? esc(b.pay_plan) : '<span class="muted">À fixer ensemble dans le chat.</span>'}</p></div>`;
      if (!isHost && b.status === 'requested') h += `<p class="hint" style="margin:10px 0 0">Tu paies directement le capitaine (${[o.pay_cash && 'espèces', o.pay_transfer && 'virement'].filter(Boolean).join(' ou ') || 'à convenir'}). N’envoie pas d’argent avant qu’il ait accepté ta demande.</p>`;
      if (!isHost && b.status === 'accepted') h += '<p class="hint" style="margin:10px 0 0">Règle l’acompte selon les modalités ci-dessus. Le capitaine confirme ta place dès réception.</p>';
      if (!isHost && b.status === 'confirmed') h += `<p class="okline">${icon('check', 16, 3)} Place confirmée${b.balance_received ? ', tout est réglé' : b.deposit_received ? '. Solde à régler comme convenu' : ''}.</p>`;
    }
    if (b.pay_mode === 'card') {
      if (isHost && b.total_cents && cfg) { const fee = b.fee_cents ?? Math.round(b.total_cents * (cfg.fee_pct || 0) / 100); h += line(`Tu reçois (commission Spartel ${cfg.fee_pct} %)`, money(b.total_cents - fee, b.currency)); }
      if (b.status === 'paid') h += `<p class="okline">${icon('check', 16, 3)} Payé par carte. ${isHost ? 'Le virement arrive sur ton compte Stripe.' : 'Place confirmée.'}</p>`;
      if (!isHost && b.status === 'requested') h += '<p class="hint" style="margin:8px 0 0">Rien n’est débité tant que le capitaine n’a pas accepté.</p>';
      if (cfg && !cfg.enabled && !done && b.status !== 'paid') h += '<p class="hint" style="margin:8px 0 0">Le paiement par carte est en cours d’activation sur Spartel.</p>';
    }
    if (b.pay_mode === 'none' && b.status === 'confirmed') h += `<p class="okline">${icon('check', 16, 3)} Place confirmée.</p>`;
    const btns = [];
    if (isHost && b.status === 'requested') btns.push('<button class="btn sun" data-a="accept">Accepter</button>', '<button class="btn ghost" data-a="decline">Refuser</button>');
    if (isHost && b.pay_mode === 'offline' && ['accepted', 'confirmed'].includes(b.status)) {
      btns.push('<button class="btn ghost sm" data-a="plan">Modalités de paiement</button>');
      if (o.pay_transfer) btns.push(`<button class="btn ghost sm" data-a="rib">${icon('lock', 14)}Partager mon RIB</button>`);
      if (b.deposit_cents && !b.deposit_received) btns.push('<button class="btn sm" data-a="deposit_received">Acompte reçu</button>');
      if (!b.balance_received) btns.push('<button class="btn sm" data-a="balance_received">Tout est payé</button>');
    }
    if (!isHost && b.pay_mode === 'card' && b.status === 'accepted') btns.push(`<button class="btn sun" data-a="pay" ${cfg && !cfg.enabled ? 'disabled' : ''}>${icon('lock', 16)}Payer ${money(b.total_cents, b.currency)}</button>`);
    if (isHost && b.status === 'paid') btns.push('<button class="btn danger sm" data-a="refund">Annuler et rembourser</button>');
    if (['requested', 'accepted', 'confirmed'].includes(b.status)) btns.push(`<button class="btn danger sm" data-a="cancel">${isHost ? 'Annuler la réservation' : b.status === 'requested' ? 'Annuler ma demande' : 'Annuler ma réservation'}</button>`);
    if (btns.length) h += `<div class="paybtns">${btns.join('')}</div>`;
    return h;
  }
  function wirePay(b, o, isHost, capRow) {
    const act = async (action, plan) => {
      const { error } = await sb.rpc('booking_action', { p_id: b.id, p_action: action, p_plan: plan ?? null });
      if (error) return fail(error);
      viewBooking(b.id, { synced: true });
    };
    const defaultPlan = () => [o.deposit_pct ? `Acompte de ${money(b.deposit_cents, b.currency)} par ${o.pay_transfer ? 'virement' : 'espèces'}` : null,
      `${o.deposit_pct ? 'Solde' : 'Paiement'} de ${money(b.total_cents - b.deposit_cents, b.currency)} ${o.pay_cash ? 'en espèces au départ' : 'par virement avant la sortie'}`].filter(Boolean).join(', ') + '.';
    const planModal = (action) => {
      const m = modal(`<p class="h" style="font-size:17px;margin:0 0 10px">${action === 'accept' ? 'Accepter la demande' : 'Modalités de paiement'}</p><form id="pf">
        ${b.pay_mode === 'offline' ? `<label class="f">Modalités (visibles par le client)<textarea name="p" maxlength="500">${esc(b.pay_plan || defaultPlan())}</textarea></label>` : '<p style="margin:0">Le client pourra ensuite payer par carte.</p>'}
        <button class="btn sun">${action === 'accept' ? 'Accepter' : 'Enregistrer'}</button></form>`);
      m.querySelector('#pf').onsubmit = (e) => { e.preventDefault(); m.remove(); act(action, b.pay_mode === 'offline' ? e.target.p.value.trim() : null); };
    };
    $app.querySelectorAll('#pay [data-a]').forEach((btn) => (btn.onclick = async () => {
      const a = btn.dataset.a;
      if (a === 'accept') return planModal('accept');
      if (a === 'plan') return planModal('plan');
      if (a === 'decline') { if (await confirmBox('Refuser cette demande ?', 'Refuser')) act('decline'); return; }
      if (a === 'cancel') { if (await confirmBox(isHost ? 'Annuler cette réservation ?' : 'Annuler ta demande ?', 'Annuler')) act('cancel'); return; }
      if (a === 'deposit_received' || a === 'balance_received') { if (await confirmBox(a === 'deposit_received' ? 'Confirmer que tu as reçu l’acompte ?' : 'Confirmer que tout est payé ?', 'Confirmer')) act(a); return; }
      if (a === 'rib') return ribModal(b, capRow);
      if (a === 'pay') return payModal(b);
      if (a === 'refund') {
        if (!(await confirmBox(`Annuler et rembourser ${money(b.total_cents, b.currency)} au client ?`, 'Rembourser'))) return;
        btn.disabled = true;
        try { await callStripe('refund', { booking_id: b.id }); toast('Remboursement lancé'); viewBooking(b.id, { synced: true }); } catch (e) { fail(e); btn.disabled = false; }
      }
    }));
  }
  function ribModal(b, capRow) {
    const m = modal(`<p class="h" style="font-size:17px;margin:0 0 6px">Partager mon RIB</p><p class="small muted" style="margin:0 0 12px">Envoyé uniquement dans cette conversation.</p>
      <form id="rf"><label class="f">Coordonnées bancaires<textarea name="r" required maxlength="600" placeholder="Titulaire&#10;Banque&#10;RIB (24 chiffres)">${esc(capRow?.bank_info || '')}</textarea></label>
      <label class="switch" style="font-size:14px">Mémoriser pour les prochaines fois<input type="checkbox" name="save" ${capRow ? 'checked' : 'disabled'}></label>
      <button class="btn sun">Envoyer au client</button></form>`);
    m.querySelector('#rf').onsubmit = async (e) => {
      e.preventDefault(); const r = e.target.r.value.trim();
      if (e.target.save.checked && capRow) await sb.from('captains').update({ bank_info: r }).eq('user_id', S.user.id);
      const { error } = await sb.from('booking_messages').insert({ booking_id: b.id, body: r, kind: 'bank' });
      if (error) return fail(error);
      m.remove(); toast('RIB envoyé');
    };
  }
  async function payModal(b) {
    const m = modal(`<p class="h" style="font-size:18px;margin:0 0 4px">Paiement sécurisé</p><p class="small muted" style="margin:0 0 14px">${money(b.total_cents, b.currency)} · carte, Apple Pay ou Google Pay</p>
      <form id="cardf"><div id="pe" style="min-height:120px"><p class="muted small">Chargement…</p></div>
      <button class="btn sun" id="payNow" disabled>${icon('lock', 16)}Payer ${money(b.total_cents, b.currency)}</button>
      <p class="hint" style="margin:0;text-align:center">Paiement traité par Stripe. Spartel ne voit jamais ta carte.</p></form>`);
    try {
      const [Stripe, r] = await Promise.all([loadStripeJs(), callStripe('pay', { booking_id: b.id })]);
      if (r.status === 'paid') { m.remove(); return viewBooking(b.id, { synced: true }); }
      const stripe = Stripe(r.pk, { locale: 'fr' });
      const elements = stripe.elements({ clientSecret: r.client_secret, appearance: { theme: 'stripe', variables: { colorPrimary: '#E2703A', colorText: '#0B1F33', borderRadius: '12px', fontFamily: 'Inter, system-ui, sans-serif' } }, fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@500;600&display=swap' }] });
      const pe = elements.create('payment', { layout: 'tabs' });
      m.querySelector('#pe').innerHTML = ''; pe.mount(m.querySelector('#pe'));
      const btn = m.querySelector('#payNow'); pe.on('ready', () => (btn.disabled = false));
      m.querySelector('#cardf').onsubmit = async (e) => {
        e.preventDefault(); btn.disabled = true; btn.textContent = 'Paiement…';
        const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: `${location.origin}${location.pathname}#/booking/${b.id}?paid=1` } });
        if (error) { toast(error.message, 5000); btn.disabled = false; btn.innerHTML = `${icon('lock', 16)}Payer ${money(b.total_cents, b.currency)}`; return; }
        await callStripe('confirm', { booking_id: b.id }).catch(() => {});
        m.remove(); toast('Paiement réussi'); viewBooking(b.id, { synced: true });
      };
    } catch (e) { m.remove(); fail(e); }
  }

  /* ---------- Espace capitaine ---------- */
  async function viewCaptain() {
    const [{ data: cap }, { data: outs }, { count: pending }] = await Promise.all([
      sb.from('captains').select('*').eq('user_id', S.user.id).maybeSingle(),
      sb.from('outings').select('*').eq('host_id', S.user.id).order('start_at', { ascending: false }).limit(50),
      sb.from('bookings').select('id', { count: 'exact', head: true }).eq('host_id', S.user.id).eq('status', 'requested'),
    ]);
    const c = cap || { country: 'MA' };
    const seats = await seatsMap((outs || []).map((o) => o.id));
    page(`<main class="screen">${topbar({ title: 'Espace capitaine', back: true })}
      ${pending ? `<a class="banner" href="#/bookings?t=host" style="text-decoration:none"><span>${pending} nouvelle${pending > 1 ? 's' : ''} demande${pending > 1 ? 's' : ''}</span>${icon('chev', 18)}</a>` : ''}
      <section class="card dark"><p class="kicker" style="color:var(--sun)">Propose tes sorties</p><p style="margin:6px 0 12px">Publie une sortie avec les photos de ton bateau et une description, fixe ton prix et réponds aux demandes dans le chat.</p><a class="btn sun sm" href="#/outing-new">${icon('plus', 14)}Proposer une sortie</a></section>
      <p class="kicker" style="margin:0">Mes sorties</p>
      <div class="card list" style="padding:0 16px">${(outs || []).length ? outs.map((o) => `<a class="list-item" href="#/outing/${o.id}">${cover(o) ? `<img class="thumb" src="${esc(cover(o))}" alt="" style="width:48px;height:48px">` : `<span class="thumb" style="width:48px;height:48px">${icon('boat', 20)}</span>`}<span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(o.title)}</b><span class="small muted">${esc(fmtDate(o.start_at))} · ${seats[o.id] || 0}/${o.seats_total} places${o.price_cents ? ' · ' + money(o.price_cents, o.currency) : ''}${o.status === 'cancelled' ? ' · annulée' : ''}</span></span>${icon('chev', 18)}</a>`).join('') : '<p class="muted small" style="margin:14px 0">Aucune sortie proposée.</p>'}</div>
      <section class="card" id="paybox"></section>
      <form id="cf" class="card"><p class="kicker" style="margin:0">Mon bateau et mes paiements</p>
        <div class="row"><label class="f">Pays où je propose mes sorties<select name="country">${COUNTRIES.map(([k, n]) => `<option value="${k}" ${c.country === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="f">Port d’attache<input name="home_port" maxlength="60" value="${esc(c.home_port || '')}" placeholder="Marina de Tanger"></label></div>
        <div class="row"><label class="f">Bateau<input name="boat_name" maxlength="40" value="${esc(c.boat_name || '')}"></label><label class="f" style="flex:.6">Longueur (m)<input name="boat_length_m" type="number" step="0.1" min="0" value="${c.boat_length_m ?? ''}"></label></div>
        <label class="f" id="bankf">RIB (envoyé seulement quand tu cliques « Partager mon RIB » dans une conversation)<textarea name="bank_info" maxlength="600" placeholder="Titulaire&#10;Banque&#10;RIB (24 chiffres)">${esc(c.bank_info || '')}</textarea></label>
        <button class="btn">Enregistrer</button></form>
    </main>`, { tab: 'outings' });
    const f = $app.querySelector('#cf');
    const syncBank = () => { $app.querySelector('#bankf').hidden = f.country.value !== 'MA'; };
    f.country.onchange = syncBank; syncBank();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const row = Object.fromEntries(['country', 'home_port', 'boat_name', 'bank_info'].map((k) => [k, f[k].value.trim() || null]));
      row.boat_length_m = f.boat_length_m.value ? +f.boat_length_m.value : null;
      const { error } = cap ? await sb.from('captains').update(row).eq('user_id', S.user.id) : await sb.from('captains').insert(row);
      if (error) return fail(error);
      toast('Enregistré'); viewCaptain();
    };
    payBox(cap);
  }
  async function payBox(cap) {
    const el = $app.querySelector('#paybox'); if (!el) return;
    if (!cap) { el.innerHTML = `<p class="kicker" style="margin:0">Encaisser</p><p class="small muted" style="margin:6px 0 0">Au Maroc, tes clients te paient directement (espèces, virement, acompte). En Espagne et ailleurs, ils paient par carte sur Spartel et l’argent arrive sur ton compte Stripe : choisis ton pays ci-dessous et enregistre pour l’activer.</p>`; return; }
    if (cap.country === 'MA') { el.innerHTML = `<p class="kicker" style="margin:0">Encaisser au Maroc</p><p class="small" style="margin:6px 0 0">Tes clients te paient directement : espèces sur place, virement, acompte. Rien ne passe par Spartel. Tu fixes les modalités dans le chat de chaque réservation et tu peux y partager ton RIB.</p>`; return; }
    const cfg = await stripeConfig();
    if (!cfg.enabled) { el.innerHTML = `<p class="kicker" style="margin:0">Paiement par carte</p><p class="small muted" style="margin:6px 0 0">Le paiement par carte est en cours d’activation sur Spartel. Tu pourras connecter ton compte Stripe ici.</p>`; return; }
    el.innerHTML = '<p class="kicker" style="margin:0">Paiement par carte</p><p class="small muted" style="margin:6px 0 0">Vérification…</p>';
    let st = { ready: false, details_submitted: false };
    if (cap.stripe_account_id) st = await callStripe('status').catch(() => st);
    el.innerHTML = `<div class="row between"><p class="kicker" style="margin:0">Paiement par carte · Stripe</p>${st.ready ? `<span class="pill" style="--pc:#1E7A46">Actif</span>` : ''}</div>
      <p class="small" style="margin:6px 0 10px">${st.ready ? `Les clients paient par carte, Stripe te verse le montant moins la commission Spartel (${cfg.fee_pct} %).` : cap.stripe_account_id ? 'Ton compte Stripe n’est pas encore complet. Finalise-le pour recevoir les paiements.' : `Crée ton compte Stripe en 5 minutes (identité + IBAN). Les clients paient par carte, Stripe te verse le montant moins la commission Spartel (${cfg.fee_pct} %).`}</p>
      ${st.ready ? '<button class="btn ghost" id="dash">Mon tableau de bord Stripe</button>' : `<button class="btn sun" id="onb">${icon('lock', 16)}${cap.stripe_account_id ? 'Finaliser mon compte Stripe' : 'Activer les paiements par carte'}</button>`}`;
    const onb = el.querySelector('#onb');
    if (onb) onb.onclick = async () => { onb.disabled = true; try { const r = await callStripe('onboard', { return_url: `${location.origin}${location.pathname}#/captain` }); location.href = r.url; } catch (e) { fail(e); onb.disabled = false; } };
    const dash = el.querySelector('#dash');
    if (dash) dash.onclick = async () => { try { const r = await callStripe('dashboard'); window.open(r.url, '_blank', 'noopener'); } catch (e) { fail(e); } };
  }

  /* ---------- Profil public ---------- */
  async function viewProfile(uid) {
    const [{ data: p }, { data: outs }] = await Promise.all([
      sb.rpc('public_profile', { p_user: uid }),
      sb.from('outings').select('*').eq('host_id', uid).eq('status', 'open').gte('start_at', new Date().toISOString()).order('start_at').limit(6),
    ]);
    if (!p) return notFound();
    people[uid] = { id: uid, display_name: p.display_name, bio: p.bio, home_port: p.home_port };
    const cs = p.catches || [];
    const url = await signed(cs.map((c) => c.photo_path));
    const species = {}; cs.forEach((c) => (species[c.species] = (species[c.species] || 0) + 1));
    const best = cs.filter((c) => c.weight_kg).sort((a, b) => b.weight_kg - a.weight_kg)[0];
    const me = uid === S.user.id;
    const seats = await seatsMap((outs || []).map((o) => o.id));
    page(`<main class="screen">${topbar({ title: me ? 'Mon profil public' : 'Profil', back: true, right: `<button class="iconbtn" id="sh" aria-label="Partager">${icon('share')}</button>` })}
      <section class="card dark row" style="gap:14px"><span class="avatar sun" style="width:72px;height:72px;font-size:28px">${esc(initials(p.display_name))}</span>
        <div class="grow" style="min-width:0"><h2 class="h" style="font-size:22px">${esc(p.display_name)}</h2>${(outs || []).length || p.outings_done ? `<span class="vbadge">${icon('boat', 12)}Capitaine</span>` : ''}
        <p class="small muted" style="margin:6px 0 0">${esc([p.bio, p.home_port || p.captain?.home_port, p.captain?.boat_name && `à bord de ${p.captain.boat_name}`].filter(Boolean).join(' · ')) || 'Pêcheur Spartel'}</p></div></section>
      <div class="stats card"><div class="stat">${icon('trophy', 20)}<b>${cs.length}</b><span>prises</span></div><div class="stat">${icon('lure', 20)}<b>${Object.keys(species).length}</b><span>espèces</span></div><div class="stat">${icon('fire', 20)}<b>${best ? kg(best.weight_kg) : '—'}</b><span>${best ? esc(best.species) : 'record'}</span></div>${p.outings_done ? `<div class="stat">${icon('boat', 20)}<b>${p.outings_done}</b><span>sorties</span></div>` : ''}</div>
      ${(outs || []).length ? `<p class="kicker" style="margin:0">Prochaines sorties</p><section class="ogrid">${outs.map((o) => outingCard(o, seats[o.id])).join('')}</section>` : ''}
      <p class="kicker" style="margin:0">Prises</p>
      ${me ? '<p class="small muted" style="margin:-6px 0 0">Seules les prises marquées « Afficher sur mon profil public » apparaissent ici, sans spot ni coordonnées.</p>' : ''}
      ${cs.length ? `<section class="cgrid">${cs.map((c) => `<article class="card" style="padding:0;overflow:hidden">${c.photo_path && url(c.photo_path) ? `<img src="${url(c.photo_path)}" alt="${esc(c.species)}" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover">` : `<div style="aspect-ratio:1;display:grid;place-items:center;background:var(--ocean);color:var(--navy)">${icon('trophy', 30, 1.6)}</div>`}
        <div style="padding:10px 12px"><div class="row between"><b style="font-size:14px">${esc(c.species)}</b><b style="color:var(--sun-dark);font-size:14px">${c.weight_kg ? kg(c.weight_kg) : ''}</b></div><div class="small muted ellipsis">${esc([fmtDate(c.caught_at, { day: 'numeric', month: 'short', year: 'numeric' }), c.lure_name, c.released ? 'relâché' : null].filter(Boolean).join(' · '))}</div></div></article>`).join('')}</section>`
        : `<div class="empty card">${icon('trophy', 30)}<p>${me ? 'Aucune prise publique. Ouvre une prise et active « Afficher sur mon profil public ».' : 'Pas encore de prise publique.'}</p></div>`}
      ${me ? '<a class="btn ghost" href="#/crew">Modifier mon profil</a>' : ''}
    </main>`, { tab: me ? 'crew' : 'outings' });
    $app.querySelector('#sh').onclick = () => shareOrCopy(`${p.display_name} sur Spartel\n${location.origin}${location.pathname}#/u/${uid}`, 'Spartel');
  }

  /* ---------- Bloc « sorties ouvertes » pour l'accueil ---------- */
  async function homeOutings(el) {
    const { data } = await sb.from('outings').select('*').eq('status', 'open').gte('start_at', new Date().toISOString()).order('start_at').limit(3);
    if (!el.isConnected) return;
    if (!data?.length) { el.innerHTML = `<a class="card row" href="#/outings" style="text-decoration:none;color:inherit">${icon('boat', 26)}<div class="grow"><b>Sorties à réserver</b><div class="small muted">Rejoins une sortie ou propose la tienne.</div></div>${icon('chev')}</a>`; return; }
    await loadPeople(data.map((o) => o.host_id));
    const seats = await seatsMap(data.map((o) => o.id));
    el.innerHTML = `<div class="row between"><p class="kicker" style="margin:0">Sorties à réserver</p><a class="small" href="#/outings" style="font-weight:600">Tout voir</a></div>
      <div class="hscroll">${data.map((o) => outingCard(o, seats[o.id])).join('')}</div>`;
  }

  return {
    routes: [
      [/^#\/outings/, viewOutings], [/^#\/outing-new/, () => viewOutingForm()], [/^#\/outing-edit\/(.+)/, viewOutingForm], [/^#\/outing\/(.+)/, viewOuting],
      [/^#\/bookings/, viewBookings], [/^#\/booking\/([^?]+)/, (id) => viewBooking(id)], [/^#\/captain/, viewCaptain], [/^#\/u\/(.+)/, viewProfile],
    ],
    homeOutings,
  };
}
