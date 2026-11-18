(() => {
  'use strict';

  const app = document.getElementById('app');
  const searchInput = document.getElementById('search');
  const PAGE = 120;

  // ---------- utilities ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normTitle = s => norm(s).replace(/[([{].*?[)\]}]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const parseJSON = s => { if (!s) return []; try { return JSON.parse(s); } catch { return []; } };
  const fmtDur = sec => { sec = Math.round(+sec || 0); if (!sec) return ''; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const parseDur = s => { if (!s) return 0; const p = String(s).split(':').map(Number); return p.reduce((a, b) => a * 60 + (b || 0), 0); };
  const split = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const year = a => a.oy || a.y || '';

  const albums = (window.ALBUMS || []).map(a => ({ ...a, _key: norm(a.a + ' ' + a.t), _gen: split(a.g) }));
  const byId = new Map(albums.map(a => [String(a.id), a]));
  const genres = [...new Set(albums.flatMap(a => a._gen))].sort();

  const coverHTML = (a, cls = 'cover') => a.img
    ? `<img class="${cls}" src="${esc(a.img)}" alt="${esc(a.t)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;${cls} placeholder&quot;>💿</div>'">`
    : `<div class="${cls} placeholder">💿</div>`;

  // small localStorage cache for remote lookups
  const cache = {
    get(k) { try { const v = JSON.parse(localStorage.getItem('mb:' + k)); return v && Date.now() - v.t < 30 * 864e5 ? v.d : undefined; } catch { return undefined; } },
    set(k, d) { try { localStorage.setItem('mb:' + k, JSON.stringify({ t: Date.now(), d })); } catch { /* quota */ } }
  };
  async function cachedFetch(key, url) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    cache.set(key, d);
    return d;
  }

  // ---------- home / list ----------
  const state = { q: '', sort: 'artist', genre: '', shown: PAGE, scroll: 0 };
  let observer;

  function filtered() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    let list = albums.filter(a => (!state.genre || a._gen.includes(state.genre)) && terms.every(t => a._key.includes(t)));
    const cmp = {
      artist: (x, y) => x.a.localeCompare(y.a, 'it', { sensitivity: 'base' }) || (year(x) - year(y)),
      title: (x, y) => x.t.localeCompare(y.t, 'it', { sensitivity: 'base' }),
      year: (x, y) => (year(x) || 9999) - (year(y) || 9999),
      yearDesc: (x, y) => (year(y) || 0) - (year(x) || 0),
      added: (x, y) => String(y.da).localeCompare(String(x.da))
    }[state.sort];
    return list.sort(cmp);
  }

  function renderHome() {
    document.title = 'MDG Vinyl Collection';
    const list = filtered();
    app.innerHTML = `
      <div class="toolbar">
        <span class="count">${list.length.toLocaleString('it')} dischi${state.q || state.genre ? ' trovati' : ''}</span>
        <label>Genere
          <select id="genre"><option value="">Tutti</option>${genres.map(g => `<option ${g === state.genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
        </label>
        <label>Ordina per
          <select id="sort">
            ${[['artist', 'Artista'], ['title', 'Titolo'], ['year', 'Anno ↑'], ['yearDesc', 'Anno ↓'], ['added', 'Aggiunti di recente']]
              .map(([v, l]) => `<option value="${v}" ${v === state.sort ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
      ${list.length ? '<div class="grid" id="grid"></div><div class="sentinel" id="sentinel"></div>' : '<div class="empty">Nessun disco trovato 🙁</div>'}`;

    document.getElementById('sort').onchange = e => { state.sort = e.target.value; state.shown = PAGE; renderHome(); };
    document.getElementById('genre').onchange = e => { state.genre = e.target.value; state.shown = PAGE; renderHome(); };
    if (!list.length) return;

    const grid = document.getElementById('grid');
    let drawn = 0;
    const draw = upTo => {
      const html = list.slice(drawn, upTo).map(a => `
        <a class="card" href="#/disco/${a.id}">
          ${coverHTML(a)}
          <div class="meta">
            <div class="title">${esc(a.t)}</div>
            <div class="artist">${esc(a.a)}</div>
            <div class="year">${esc(year(a))}</div>
          </div>
        </a>`).join('');
      grid.insertAdjacentHTML('beforeend', html);
      drawn = Math.min(upTo, list.length);
      state.shown = Math.max(state.shown, drawn);
    };
    draw(state.shown);

    observer?.disconnect();
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && drawn < list.length) draw(drawn + PAGE);
    }, { rootMargin: '800px' });
    observer.observe(document.getElementById('sentinel'));
  }

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = searchInput.value;
      state.shown = PAGE;
      if (location.hash.startsWith('#/disco/')) { state.scroll = 0; location.hash = '#/'; }
      else { renderHome(); window.scrollTo(0, 0); }
    }, 180);
  });

  // ---------- detail ----------
  function trackListHTML(tracks) {
    if (!tracks.length) return '';
    let total = 0;
    const rows = tracks.map(tr => {
      const raw = tr.title || '';
      if (tr.type_ === 'heading') return `<li class="heading">${esc(raw)}</li>`;
      let pos = tr.position || '', title = raw;
      const m = !pos && raw.match(/^([A-Z]?\d+[a-z]?|[A-Z]\d*)\.\s+(.*)$/);
      if (m) { pos = m[1]; title = m[2]; }
      const d = typeof tr.duration === 'number' ? tr.duration : parseDur(tr.duration);
      total += d;
      return `<li><span class="pos">${esc(pos)}</span><span class="tt">${esc(title)}</span><span class="dur">${fmtDur(d)}</span></li>`;
    }).join('');
    return `<ol class="tracklist">${rows}</ol>${total ? `<div class="total">${tracks.length} brani · durata totale ${fmtDur(total)}</div>` : `<div class="total">${tracks.length} brani</div>`}`;
  }

  function renderDetail(id) {
    const a = byId.get(id);
    if (!a) { app.innerHTML = '<a class="back" href="#/">← Torna alla lista</a><div class="empty">Disco non trovato.</div>'; return; }
    document.title = `${a.t} – ${a.a}`;
    window.scrollTo(0, 0);

    const tracks = parseJSON(a.tr);
    const videos = parseJSON(a.v).filter(v => v.youtubeID);
    const performers = split(a.p);
    const facts = [
      ['Anno', a.y],
      ['Prima uscita', a.oy && a.oy !== a.y ? a.oy : ''],
      ['Paese', a.c],
      ['Tipo', a.ct],
      ['Produttori', a.pr],
      ['Codice a barre', a.upc],
      ['Aggiunto il', a.da ? a.da.slice(0, 10).replace(/\//g, '-') : '']
    ].filter(f => f[1]);

    app.innerHTML = `
      <a class="back" href="#/">← Torna alla lista</a>
      <section class="detail-head">
        ${coverHTML(a)}
        <div>
          <h1>${esc(a.t)}</h1>
          <h2>${esc(a.a)}</h2>
          <dl class="facts">
            ${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}
            ${a._gen.length ? `<dt>Genere</dt><dd class="chips">${a._gen.map(g => `<span class="chip">${esc(g)}</span>`).join('')}</dd>` : ''}
            ${a.s ? `<dt>Stile</dt><dd class="chips">${split(a.s).map(g => `<span class="chip">${esc(g)}</span>`).join('')}</dd>` : ''}
          </dl>
          <dl class="facts" id="discogsFacts" style="margin-top:6px"></dl>
          <div class="ext-links">
            ${a.d ? `<a href="https://www.discogs.com/release/${encodeURIComponent(a.d)}" target="_blank" rel="noopener">Discogs ↗</a>` : ''}
            <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(a.a + ' ' + a.t)}" target="_blank" rel="noopener">YouTube ↗</a>
            <a href="https://open.spotify.com/search/${encodeURIComponent(a.a + ' ' + a.t)}" target="_blank" rel="noopener">Spotify ↗</a>
          </div>
        </div>
      </section>

      <div class="sections">
        <div class="box">
          <h3>Track list</h3>
          <div id="tracks">${trackListHTML(tracks) || '<div class="loading">Cerco la track list online</div>'}</div>
        </div>
        <div class="box trivia">
          <h3>Info e curiosità</h3>
          <div id="trivia"><div class="loading">Cerco informazioni su internet</div></div>
        </div>
        ${performers.length ? `<div class="box"><h3>Musicisti</h3><ul class="tracklist">${performers.map(p => {
          const [role, ...who] = p.split(' - ');
          return who.length ? `<li><span class="tt">${esc(who.join(' - '))}</span><span class="dur">${esc(role)}</span></li>` : `<li><span class="tt">${esc(p)}</span></li>`;
        }).join('')}</ul></div>` : ''}
        <div class="box" id="artistBox"><h3>L'artista</h3><div id="artist"><div class="loading">Cerco informazioni sull'artista</div></div></div>
        ${videos.length ? `<div class="box full"><h3>Video</h3><div id="player"></div><div class="videos">${videos.map(v => `
          <a class="video" href="https://www.youtube.com/watch?v=${esc(v.youtubeID)}" data-yt="${esc(v.youtubeID)}">
            <img src="https://i.ytimg.com/vi/${esc(v.youtubeID)}/mqdefault.jpg" alt="" loading="lazy">${esc(v.title)}
          </a>`).join('')}</div></div>` : ''}
      </div>`;

    app.querySelectorAll('[data-yt]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      const p = document.getElementById('player');
      p.className = 'player';
      p.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(el.dataset.yt)}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      p.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));

    loadOnlineInfo(a, tracks.length > 0);
  }

  // ---------- online info: Wikipedia + Discogs ----------
  const ALBUM_WORDS = /\b(album|disco|lp|ep|raccolta|compilation|colonna sonora|soundtrack|live|singolo|single|record)\b/i;

  async function wikiAlbum(a) {
    const titleN = normTitle(a.t);
    const artistN = norm(a.a).replace(/^the\s+/, '');
    for (const lang of ['it', 'en']) {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search` +
        `&gsrsearch=${encodeURIComponent(`${a.t} ${a.a} album`)}&gsrlimit=6&prop=extracts|info&exintro=1&explaintext=1&inprop=url`;
      const d = await cachedFetch(`wa:${lang}:${a.id}`, url).catch(() => null);
      const pages = Object.values(d?.query?.pages || {}).sort((x, y) => x.index - y.index);
      let best = null, bestScore = 0;
      const y = String(year(a));
      for (const p of pages) {
        const pt = normTitle(p.title), ex = norm(p.extract || ''), intro = (p.extract || '').slice(0, 300);
        let score = 0;
        if (pt === titleN) score += 3;
        else if (titleN && pt.includes(titleN)) score += 2;
        if (artistN && ex.includes(artistN.split(' ')[0])) score += 2;
        if (ALBUM_WORDS.test(intro)) score += 1; else score -= 3; // must actually describe a record
        if (y && (p.title.includes(y) || intro.includes(y))) score += 1;
        if (/disambigu/i.test(p.title + ' ' + intro)) score = 0;
        if (score > bestScore) { best = p; bestScore = score; }
      }
      if (best && bestScore >= 5 && best.extract) return { lang, title: best.title, url: best.fullurl, text: best.extract };
    }
    return null;
  }

  async function wikiArtist(a) {
    const artistN = norm(a.a);
    for (const lang of ['it', 'en']) {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search` +
        `&gsrsearch=${encodeURIComponent(a.a + (lang === 'it' ? ' musica' : ' music'))}&gsrlimit=10&prop=extracts|info|pageimages&exintro=1&explaintext=1&exsentences=5&exlimit=10&inprop=url&piprop=thumbnail&pithumbsize=200&pilimit=10`;
      const d = await cachedFetch(`wr2:${lang}:${artistN}`, url).catch(() => null);
      const pages = Object.values(d?.query?.pages || {}).sort((x, y) => x.index - y.index);
      const p = pages.find(p => {
        if (!p.extract || /disambigu/i.test(p.extract)) return false;
        const base = norm(p.title).replace(/\s*\((.*)\)$/, ''), paren = (p.title.match(/\((.*)\)$/) || [])[1] || '';
        if (base !== artistN) return false;
        if (paren && !/gruppo|band|musicist|cantant|rapper|singer|group|musician|compositor|composer|duo/i.test(paren)) return false;
        return !/\b(album|singolo|single|brano|canzone|song|film)\b/i.test(p.extract.slice(0, 200));
      });
      if (p) return { lang, title: p.title, url: p.fullurl, text: p.extract, thumb: p.thumbnail?.source };
    }
    return null;
  }

  const discogsRelease = id => id ? cachedFetch(`dg:${id}`, `https://api.discogs.com/releases/${encodeURIComponent(id)}`).catch(() => null) : Promise.resolve(null);

  const paragraphs = text => text.split(/\n+/).filter(t => t.trim()).map(t => `<p>${esc(t)}</p>`).join('');

  async function loadOnlineInfo(a, hasTracks) {
    const myId = a.id;
    const stillHere = () => location.hash === `#/disco/${myId}`;

    const [wa, dg] = await Promise.all([wikiAlbum(a).catch(() => null), discogsRelease(a.d)]);
    if (!stillHere()) return;

    // Discogs facts (label, format, community)
    if (dg) {
      const dl = document.getElementById('discogsFacts');
      const labels = [...new Set((dg.labels || []).map(l => `${l.name}${l.catno && l.catno !== 'none' ? ' – ' + l.catno : ''}`))];
      const formats = (dg.formats || []).map(f => [f.qty > 1 ? f.qty + '×' : '', f.name, ...(f.descriptions || [])].filter(Boolean).join(' ')).join(', ');
      const rows = [['Etichetta', labels.join('; ')], ['Formato', formats], ['Paese', !a.c ? dg.country : ''], ['Uscita', dg.released_formatted && !a.y ? dg.released_formatted : '']].filter(r => r[1]);
      dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
      if (!hasTracks && dg.tracklist?.length) document.getElementById('tracks').innerHTML = trackListHTML(dg.tracklist);
    }
    if (!hasTracks && !dg?.tracklist?.length) document.getElementById('tracks').innerHTML = '<div class="empty" style="padding:20px 0">Track list non disponibile.</div>';

    // Trivia
    const facts = [];
    if (a.oy && a.y && a.oy !== a.y) facts.push(`Questa è una ristampa del ${esc(a.y)}: l'album è uscito originariamente nel ${esc(a.oy)}, ${+a.y - +a.oy} anni prima.`);
    else if (year(a)) { const age = new Date().getFullYear() - +year(a); if (age > 0) facts.push(`Il disco ha ${age} anni (uscito nel ${esc(year(a))}).`); }
    if (dg?.community) {
      const c = dg.community;
      if (c.have || c.want) facts.push(`Su Discogs <b>${(c.have || 0).toLocaleString('it')}</b> collezionisti possiedono questa edizione e <b>${(c.want || 0).toLocaleString('it')}</b> la desiderano.`);
      if (c.rating?.count) facts.push(`Voto medio della community Discogs: <b>${c.rating.average.toFixed(2)}/5</b> su ${c.rating.count} voti.`);
    }
    if (dg?.lowest_price && dg.num_for_sale) facts.push(`Attualmente ${dg.num_for_sale} copie in vendita su Discogs, a partire da circa ${Math.round(dg.lowest_price)} ${esc(dg.currency || '')}.`.trim());
    const studios = (dg?.companies || []).filter(c => /recorded|mixed|mastered|pressed/i.test(c.entity_type_name)).map(c => `${c.entity_type_name}: ${c.name}`);
    if (studios.length) facts.push(`Produzione: ${esc([...new Set(studios)].slice(0, 5).join(' · '))}.`);
    const credits = (dg?.extraartists || []).filter(x => /producer|engineer|artwork|design|photography|written/i.test(x.role)).slice(0, 6);
    if (credits.length) facts.push(`Crediti: ${credits.map(x => `${esc(x.role)} – ${esc(x.name.replace(/\s*\(\d+\)$/, ''))}`).join('; ')}.`);

    let html = '';
    if (wa) html += `${paragraphs(wa.text)}<p class="src">Fonte: <a href="${esc(wa.url)}" target="_blank" rel="noopener">Wikipedia (${wa.lang}) – ${esc(wa.title)}</a></p>`;
    if (dg?.notes) html += `<p><b>Note dell'edizione (Discogs):</b></p>${paragraphs(dg.notes.replace(/\[\w=?([^\]]*)\]/g, '$1').slice(0, 1200))}`;
    if (facts.length) html += `<ul>${facts.map(f => `<li>${f}</li>`).join('')}</ul>`;
    document.getElementById('trivia').innerHTML = html || '<div class="empty" style="padding:20px 0">Nessuna informazione trovata online.</div>';

    // Artist
    const wr = await wikiArtist(a).catch(() => null);
    if (!stillHere()) return;
    document.getElementById('artist').innerHTML = wr
      ? `${wr.thumb ? `<img src="${esc(wr.thumb)}" alt="" style="float:right;max-width:110px;border-radius:8px;margin:0 0 10px 14px">` : ''}${paragraphs(wr.text)}<p class="src">Fonte: <a href="${esc(wr.url)}" target="_blank" rel="noopener">Wikipedia (${wr.lang}) – ${esc(wr.title)}</a></p>`
      : '<div class="empty" style="padding:20px 0">Nessuna informazione trovata.</div>';
  }

  // ---------- router ----------
  function route() {
    const m = location.hash.match(/^#\/disco\/(\d+)/);
    if (m) {
      if (!app.querySelector('.detail-head')) state.scroll = window.scrollY;
      renderDetail(m[1]);
    } else {
      renderHome();
      requestAnimationFrame(() => window.scrollTo(0, state.scroll));
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
