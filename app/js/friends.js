// Spartel — amis (recherche, demandes, lien personnel) et notifications.
export function friendsModule(ctx) {
  const { sb, S, page, topbar, icon, esc, fmtDate, toast, fail, go, confirmBox, shareOrCopy, nameOf, avatar, kg, loadFriends } = ctx;
  const $app = document.getElementById('app');
  const baseUrl = () => location.origin + location.pathname;
  const friendLink = (code) => `${baseUrl()}?f=${code}`;

  /* ---------- Cloche de notifications ---------- */
  function bell() {
    return `<a href="#/notifs" class="iconbtn bell" id="bell" aria-label="Notifications${S.unread ? ` (${S.unread} non lues)` : ''}">${icon('bell', 24)}${S.unread ? `<span class="nb">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</a>`;
  }
  async function refreshUnread() {
    if (!S.user) return;
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    S.unread = count || 0;
    try { S.unread ? navigator.setAppBadge?.(S.unread) : navigator.clearAppBadge?.(); } catch (e) {}
    document.querySelectorAll('#bell').forEach((b) => { b.outerHTML = bell(); });
  }

  const NICON = { friend_request: 'users', friend_accepted: 'check', friend_joined: 'users', outing: 'boat' };
  function ago(d) {
    const m = Math.round((Date.now() - new Date(d)) / 60000);
    if (m < 1) return 'à l’instant';
    if (m < 60) return `il y a ${m} min`;
    if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
    return fmtDate(d, { day: 'numeric', month: 'short' });
  }

  async function viewNotifs() {
    const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    const list = data || [];
    page(`<main class="screen">${topbar({ title: 'Notifications', back: true })}
      ${list.length ? `<div class="card list" style="padding:0 16px">${list.map((n) => `<a class="list-item notif ${n.read_at ? '' : 'unread'}" href="${esc(n.url || '#/')}" data-n="${n.id}">
        <span class="nicon">${icon(NICON[n.type] || 'bell', 20)}</span>
        <div class="grow"><b>${esc(n.title)}</b>${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}<div class="small muted">${esc(ago(n.created_at))}</div></div>
        ${n.read_at ? '' : '<span class="dot"></span>'}</a>`).join('')}</div>
        <button class="btn ghost sm" id="readall">Tout marquer comme lu</button>`
        : `<div class="empty card">${icon('bell', 34)}<p>Rien pour l’instant.<br>Tu seras prévenu ici quand un ami te demande, ou publie une sortie avec des places.</p></div>`}
    </main>`, { tab: 'friends' });
    const mark = async (ids) => { if (!ids.length) return; await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids); refreshUnread(); };
    $app.querySelectorAll('[data-n]').forEach((a) => a.addEventListener('click', () => { const n = list.find((x) => x.id === a.dataset.n); if (n && !n.read_at) mark([n.id]); }));
    const ra = $app.querySelector('#readall');
    if (ra) ra.onclick = async () => { await mark(list.filter((n) => !n.read_at).map((n) => n.id)); viewNotifs(); };
  }

  /* ---------- Amis ---------- */
  const relOf = (id) => {
    const r = S.friendRows.find((x) => x.requester_id === id || x.addressee_id === id);
    return r ? { row: r, rel: r.status === 'accepted' ? 'friend' : r.requester_id === S.user.id ? 'sent' : 'received' } : { row: null, rel: 'none' };
  };

  async function viewFriends() {
    const [{ data: code }, { data: cs }] = await Promise.all([
      sb.rpc('my_friend_code'),
      sb.from('catches').select('angler_id, created_by, species, weight_kg'),
    ]);
    const me = S.user.id;
    const friendIds = S.memberIds.filter((x) => x !== me);
    const received = S.friendRows.filter((r) => r.status === 'pending' && r.addressee_id === me);
    const sent = S.friendRows.filter((r) => r.status === 'pending' && r.requester_id === me);
    const by = {};
    S.memberIds.forEach((m) => (by[m] = { n: 0, best: null }));
    (cs || []).forEach((c) => { const a = c.angler_id || c.created_by; const o = by[a]; if (!o) return; o.n++; if (c.weight_kg && (!o.best || +c.weight_kg > +o.best.weight_kg)) o.best = c; });
    const ranking = S.memberIds.map((id) => [id, by[id]]).sort((a, b) => b[1].n - a[1].n);
    const link = friendLink(code);
    const msg = `Rejoins-moi sur Spartel, l’appli des pêcheurs en mer.\nCrée ton compte avec mon lien, on sera amis tout de suite :\n${link}`;

    page(`<main class="screen">${topbar({ right: bell() })}
      <h2 class="h" style="font-size:24px;margin:0">Mes amis</h2>
      <section class="card"><p class="kicker" style="margin:0 0 6px">Inviter un ami</p>
        <p class="muted small" style="margin:0 0 10px">Envoie ton lien (WhatsApp, SMS…) : il peut installer l’appli, créer son compte, et vous êtes amis directement.</p>
        <div class="btn-row"><button class="btn sun" id="inv">${icon('share', 16)}Envoyer mon lien</button><button class="btn ghost" id="cp">${icon('copy', 16)}Copier</button></div>
        <p class="small muted" style="margin:10px 0 0;word-break:break-all">${esc(link)}</p></section>
      ${received.length ? `<section class="card"><p class="kicker" style="margin:0 0 6px">Demandes reçues</p><div class="list">${received.map((r) => `<div class="list-item" style="cursor:default">${avatar(r.requester_id, 'lg')}<div class="grow"><b>${esc(nameOf(r.requester_id))}</b><div class="small muted">veut être ton ami</div></div><button class="btn sm sun" data-acc="${r.id}">Accepter</button><button class="btn sm ghost" data-dec="${r.id}">Refuser</button></div>`).join('')}</div></section>` : ''}
      <section class="card"><p class="kicker" style="margin:0 0 6px">Chercher un pêcheur</p>
        <label class="f srch" style="margin:0"><input id="q" type="search" placeholder="Prénom ou nom" autocomplete="off" autocapitalize="words" enterkeyhint="search"></label>
        <div id="res" class="list" style="margin-top:6px"></div></section>
      ${sent.length ? `<p class="small muted" style="margin:0">Demandes envoyées : ${sent.map((r) => `${esc(nameOf(r.addressee_id))} <button class="linkbtn" data-cancel="${r.addressee_id}">annuler</button>`).join(' · ')}</p>` : ''}
      <p class="kicker" style="margin:6px 0 0">${friendIds.length ? `${friendIds.length} ami${friendIds.length > 1 ? 's' : ''} · classement` : 'Classement'}</p>
      <div class="card list" style="padding:0 16px">${ranking.map(([id, o], i) => `<div class="list-item" style="cursor:default"><a class="row grow" href="#/u/${id}" style="gap:12px;text-decoration:none;color:inherit;min-width:0">${avatar(id, `lg ${i === 0 && o.n ? 'sun' : ''}`)}<div class="grow" style="min-width:0"><b>${esc(nameOf(id))}</b>${id === me ? ' <span class="small muted">(toi)</span>' : ''}<div class="small muted ellipsis">${esc(S.members[id]?.bio || S.members[id]?.home_port || '')}</div></div><div style="text-align:right"><b>${o.n} prise${o.n > 1 ? 's' : ''}</b>${o.best ? `<div class="small" style="color:var(--sun-dark);font-weight:600">${esc(o.best.species)} ${kg(o.best.weight_kg)}</div>` : ''}</div></a>${id !== me ? `<button class="iconbtn" data-rm="${id}" aria-label="Retirer ${esc(nameOf(id))}">✕</button>` : ''}</div>`).join('')}</div>
      ${friendIds.length ? '' : `<div class="empty card" style="margin-top:-6px">${icon('users', 30)}<p>Pas encore d’amis ici. Envoie ton lien ou cherche-les ci-dessus : vous partagerez vos spots et vos prises.</p></div>`}
      <a class="btn ghost" href="#/stats">${icon('chart', 18)}Stats</a>
    </main>`, { tab: 'friends' });

    $app.querySelector('#inv').onclick = () => shareOrCopy(msg, 'Spartel');
    $app.querySelector('#cp').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Lien copié'); } catch (e) { toast(link, 7000); } };
    const refresh = async () => { await loadFriends(); await viewFriends(); };
    const act = (fn) => async (e) => { try { await fn(e.currentTarget); } catch (err) { fail(err); } };
    $app.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = act(async (el) => { const { error } = await sb.rpc('respond_friend_request', { p_id: el.dataset.acc, p_accept: true }); if (error) throw error; toast('Ami ajouté'); await refresh(); })));
    $app.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = act(async (el) => { const { error } = await sb.rpc('respond_friend_request', { p_id: el.dataset.dec, p_accept: false }); if (error) throw error; await refresh(); })));
    $app.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = act(async (el) => { await sb.rpc('remove_friend', { p_user: el.dataset.cancel }); await refresh(); })));
    $app.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = act(async (el) => {
      if (!(await confirmBox(`Retirer ${nameOf(el.dataset.rm)} de tes amis ? Vous ne verrez plus vos spots et prises.`, 'Retirer'))) return;
      await sb.rpc('remove_friend', { p_user: el.dataset.rm }); await refresh();
    })));

    // Recherche
    const q = $app.querySelector('#q'), res = $app.querySelector('#res');
    let t, seq = 0;
    const btnFor = (p) => p.rel === 'friend' ? '<span class="small muted">Ami ✓</span>'
      : p.rel === 'sent' ? '<span class="small muted">Demande envoyée</span>'
      : p.rel === 'received' ? `<button class="btn sm sun" data-racc="${p.id}">Accepter</button>`
      : `<button class="btn sm sun" data-add="${p.id}">Ajouter</button>`;
    const run = async () => {
      const v = q.value.trim(), my = ++seq;
      if (v.length < 2) { res.innerHTML = v ? '<p class="small muted" style="margin:6px 0">Tape au moins 2 lettres.</p>' : ''; return; }
      const { data, error } = await sb.rpc('search_people', { q: v });
      if (my !== seq) return;
      if (error) return fail(error);
      res.innerHTML = (data || []).length
        ? data.map((p) => `<div class="list-item" style="cursor:default"><span class="avatar lg">${esc((p.display_name || '?').charAt(0).toUpperCase())}</span><div class="grow"><b>${esc(p.display_name)}</b>${p.home_port ? `<div class="small muted">${esc(p.home_port)}</div>` : ''}</div>${btnFor(p)}</div>`).join('')
        : '<p class="small muted" style="margin:6px 0">Personne trouvé. Invite-le avec ton lien ci-dessus.</p>';
      res.querySelectorAll('[data-add]').forEach((b) => (b.onclick = act(async (el) => {
        b.disabled = true;
        const { data: r, error: er } = await sb.rpc('send_friend_request', { p_user: el.dataset.add });
        if (er) throw er;
        toast(r === 'friend' ? 'Vous êtes amis' : 'Demande envoyée'); await loadFriends(); run();
      })));
      res.querySelectorAll('[data-racc]').forEach((b) => (b.onclick = act(async (el) => {
        const { error: er } = await sb.rpc('send_friend_request', { p_user: el.dataset.racc });
        if (er) throw er; toast('Ami ajouté'); await refresh();
      })));
    };
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 280); });
  }

  /* ---------- Lien d'ami reçu (utilisateur déjà connecté) ---------- */
  async function acceptFriendLink(code) {
    const { data, error } = await sb.rpc('add_friend_by_code', { p_code: code });
    if (error) { toast(error.message, 5000); return null; }
    toast(`Tu es maintenant ami avec ${data.name}`, 4000);
    return data;
  }

  return {
    bell, refreshUnread, acceptFriendLink,
    routes: [[/^#\/friends/, viewFriends], [/^#\/notifs/, viewNotifs]],
  };
}
