// Menu mobile
document.querySelectorAll('.nav .menu').forEach((b) => {
  b.addEventListener('click', () => {
    const nav = b.closest('.nav');
    const open = nav.classList.toggle('open');
    b.setAttribute('aria-expanded', open);
  });
});

// Journal : filtres + ouverture d'une histoire
const grid = document.querySelector('.jgrid');
if (grid) {
  const chips = [...document.querySelectorAll('.chip')];
  const apply = (f) => {
    chips.forEach((c) => c.classList.toggle('on', c.dataset.f === f));
    grid.querySelectorAll('.jt').forEach((t) => t.classList.toggle('hide', f !== 'all' && t.dataset.cat !== f));
  };
  chips.forEach((c) => c.addEventListener('click', () => apply(c.dataset.f)));
  const fromHash = location.hash.slice(1);
  if (chips.some((c) => c.dataset.f === fromHash)) apply(fromHash);

  const m = document.getElementById('m');
  const close = () => m.classList.remove('open');
  m.querySelector('.x').addEventListener('click', close);
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  grid.querySelectorAll('.jt').forEach((t) => t.addEventListener('click', () => {
    const p = window.POSTS[+t.dataset.i];
    m.querySelector('.mmedia').innerHTML = t.querySelector('.vis').outerHTML;
    const cap = m.querySelector('.mcap');
    cap.innerHTML = '';
    const k = document.createElement('p'); k.className = 'cap sun'; k.textContent = p.k;
    const h = document.createElement('p'); h.className = 'h'; h.style.fontSize = '22px'; h.textContent = p.t;
    const c = document.createElement('p'); c.textContent = p.c;
    cap.append(k, h, c);
    m.classList.add('open');
  }));
}
