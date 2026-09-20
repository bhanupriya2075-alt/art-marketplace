/* =====================================================================
   Palette & Swap — frontend
   No build step: plain ES2018, hash routing, one render loop.
   ===================================================================== */
(function () {
  'use strict';

  const view = document.getElementById('view');
  const nav = document.getElementById('nav');
  const right = document.getElementById('masthead-right');
  const toastEl = document.getElementById('toast');

  const CONDITION = { new: 'New', like_new: 'Like new', used: 'Used', fair: 'Fair' };
  const LTYPE = { sale: 'For sale', swap: 'Swap only', both: 'Sale or swap' };
  const LSTATUS = { available: 'Available', pending: 'Pending', sold: 'Sold', swapped: 'Swapped', removed: 'Removed' };

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.className = 'toast'; }, 3800);
  }

  function fmtDate(v, withTime) {
    if (!v) return '—';
    const d = new Date(v);
    const opts = withTime
      ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
    return d.toLocaleString(undefined, opts);
  }

  const price = (v) => v == null ? null : `₹${Number(v).toLocaleString('en-IN')}`;

  function loading() { view.innerHTML = '<div class="spinner">Loading…</div>'; }
  function errorPanel(msg) { return `<div class="error-box">${esc(msg)}</div>`; }

  function listingCard(l) {
    const imgUrl = l.primary_image_id ? `/api/listings/${l.id}/images/${l.primary_image_id}` : null;
    return `<a class="card" href="#/listing/${l.id}" data-link>
      <div class="card-img" ${imgUrl ? `style="background-image:url('${imgUrl}')"` : ''}>${imgUrl ? '' : '🎨'}</div>
      <div class="card-body">
        <div class="card-cat">${esc(l.category)}</div>
        <div class="card-title">${esc(l.title)}</div>
        <div class="card-price">${l.price != null ? price(l.price) : 'Swap only'}</div>
        <div class="card-meta">
          <span class="badge cond-${l.condition}">${CONDITION[l.condition]}</span>
          <span class="badge type-${l.listing_type}">${LTYPE[l.listing_type]}</span>
          ${l.status && l.status !== 'available' ? `<span class="badge status-${l.status}">${LSTATUS[l.status]}</span>` : ''}
        </div>
        <div class="card-loc">${esc(l.location || 'Location not specified')}</div>
      </div>
    </a>`;
  }

  // ---------------------------------------------------------------- chrome
  async function renderChrome() {
    const u = api.session.user;
    if (!u) {
      nav.innerHTML = `<a href="#/marketplace" data-link>Browse</a>`;
      right.innerHTML = '<a class="btn btn-sm" href="#/signin" data-link>Sign in</a>';
      return;
    }

    const links = [['#/', 'Dashboard'], ['#/marketplace', 'Marketplace'], ['#/sell', 'Sell an item'],
      ['#/swaps', 'Swap requests'], ['#/chat', 'Messages']];
    if (u.role === 'admin') links.push(['#/admin', 'Admin panel']);

    const hash = location.hash || '#/';
    nav.innerHTML = links.map(([h, t]) =>
      `<a href="${h}" data-link class="${h === hash ? 'active' : ''}">${t}</a>`).join('');

    let unread = 0;
    try {
      const { conversations } = await api.get('/conversations');
      unread = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
    } catch (e) { /* not fatal */ }

    right.innerHTML = `
      <button class="bell" id="bell" title="Messages" aria-label="Messages">
        &#9993;${unread ? `<span class="count">${unread}</span>` : ''}
      </button>
      <span class="who">${esc(u.full_name)} ${u.role === 'admin' ? '<strong>admin</strong>' : ''}</span>
      <button class="btn-quiet btn-sm" id="signout" style="color:#D8CBBB;border-color:rgba(255,255,255,.25);background:none">Sign out</button>`;

    document.getElementById('bell').onclick = () => { location.hash = '#/chat'; };
    document.getElementById('signout').onclick = () => {
      api.session.clear();
      location.hash = '#/signin';
      toast('Signed out.');
    };
  }

  // ---------------------------------------------------------------- sign in
  function viewSignIn() {
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-intro">
          <h1>Give your unused art supplies a second life.</h1>
          <p>Sell what you no longer use, swap for what you need, and connect with other artists nearby — no listing fees, no middleman.</p>
          <ol>
            <li>List your paints, brushes, canvases or tools in a couple of minutes.</li>
            <li>Buy at a fair price, or offer a swap instead.</li>
            <li>Chat directly with the other person to arrange the exchange.</li>
          </ol>
          <p class="demo-note">Demo accounts (password <code>Passw0rd!</code>): <code>ananya@example.com</code> as a regular member, <code>admin@artexchange.example</code> as an administrator.</p>
        </div>

        <div class="panel">
          <div class="tabs">
            <button class="active" data-tab="in">Sign in</button>
            <button data-tab="up">Create an account</button>
          </div>
          <div id="auth-error"></div>

          <form id="form-in">
            <div class="field"><label for="in-email">Email</label>
              <input id="in-email" type="email" autocomplete="email" required></div>
            <div class="field"><label for="in-pass">Password</label>
              <input id="in-pass" type="password" autocomplete="current-password" required></div>
            <button type="submit">Sign in</button>
          </form>

          <form id="form-up" hidden>
            <div class="field"><label for="up-name">Full name</label>
              <input id="up-name" type="text" required></div>
            <div class="row">
              <div class="field"><label for="up-email">Email</label>
                <input id="up-email" type="email" required></div>
              <div class="field"><label for="up-phone">Mobile number</label>
                <input id="up-phone" type="tel"></div>
            </div>
            <div class="field"><label for="up-loc">Your area</label>
              <input id="up-loc" type="text" placeholder="e.g. Koramangala, Bengaluru">
              <div class="hint">Shown on your listings so nearby buyers can find you.</div></div>
            <div class="field"><label for="up-pass">Password</label>
              <input id="up-pass" type="password" autocomplete="new-password" required>
              <div class="hint">At least 8 characters.</div></div>
            <button type="submit">Create account</button>
          </form>
        </div>
      </div>`;

    const errBox = document.getElementById('auth-error');
    const fin = document.getElementById('form-in');
    const fup = document.getElementById('form-up');

    view.querySelectorAll('.tabs button').forEach(btn => {
      btn.onclick = () => {
        view.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const signIn = btn.dataset.tab === 'in';
        fin.hidden = !signIn; fup.hidden = signIn; errBox.innerHTML = '';
      };
    });

    const done = (data) => {
      api.session.save(data.token, data.user);
      toast(`Welcome, ${data.user.full_name.split(' ')[0]}.`);
      location.hash = '#/';
    };

    fin.onsubmit = async (e) => {
      e.preventDefault(); errBox.innerHTML = '';
      try {
        done(await api.post('/auth/login', {
          email: fin.querySelector('#in-email').value.trim(),
          password: fin.querySelector('#in-pass').value,
        }));
      } catch (err) { errBox.innerHTML = errorPanel(err.message); }
    };

    fup.onsubmit = async (e) => {
      e.preventDefault(); errBox.innerHTML = '';
      try {
        done(await api.post('/auth/register', {
          full_name: fup.querySelector('#up-name').value.trim(),
          email: fup.querySelector('#up-email').value.trim(),
          phone: fup.querySelector('#up-phone').value.trim(),
          location: fup.querySelector('#up-loc').value.trim(),
          password: fup.querySelector('#up-pass').value,
        }));
      } catch (err) { errBox.innerHTML = errorPanel(err.message); }
    };
  }

  // ---------------------------------------------------------------- dashboard
  async function viewDashboard() {
    const u = api.session.user;
    loading();
    try {
      const [{ listings: mine }, { swap_requests: received }, { conversations }] = await Promise.all([
        api.get('/listings?mine=true&limit=50'),
        api.get('/swap-requests?role=received'),
        api.get('/conversations'),
      ]);

      const active = mine.filter(l => l.status === 'available' || l.status === 'pending');
      const completed = mine.filter(l => ['sold', 'swapped'].includes(l.status));
      const pendingSwaps = received.filter(s => s.status === 'pending');
      const unread = conversations.reduce((s, c) => s + (c.unread || 0), 0);

      view.innerHTML = `
        <div class="page-head">
          <div><h1>Welcome back, ${esc(u.full_name.split(' ')[0])}</h1>
            <p class="sub">Here's what's happening with your listings and requests.</p></div>
          <div class="actions">
            <a class="btn" href="#/sell" data-link>Sell an item</a>
            <a class="btn btn-quiet" href="#/marketplace" data-link>Browse marketplace</a>
          </div>
        </div>

        <div class="grid kpi" style="margin-bottom:22px">
          <div class="kpi-tile"><div class="kpi-value">${active.length}</div><div class="kpi-name">Active listings</div></div>
          <div class="kpi-tile"><div class="kpi-value">${completed.length}</div><div class="kpi-name">Sold or swapped</div></div>
          <div class="kpi-tile"><div class="kpi-value">${pendingSwaps.length}</div><div class="kpi-name">Swap offers to review</div></div>
          <div class="kpi-tile"><div class="kpi-value">${unread}</div><div class="kpi-name">Unread messages</div></div>
        </div>

        <div class="grid two">
          <div class="panel">
            <h3>Your listings</h3>
            ${mine.length ? mine.slice(0, 6).map(l => `
              <div class="swap-row">
                <div class="swap-main">
                  <a class="swap-title" href="#/listing/${l.id}" data-link style="color:inherit;text-decoration:none">${esc(l.title)}</a>
                  <div class="swap-sub">${esc(l.category)} · ${l.price != null ? price(l.price) : 'Swap only'}</div>
                </div>
                <span class="badge status-${l.status}">${LSTATUS[l.status]}</span>
              </div>`).join('') : '<p class="sub">You haven\'t listed anything yet.</p>'}
            <div class="actions" style="margin-top:14px"><a class="btn-quiet btn btn-sm" href="#/sell" data-link>List something new</a></div>
          </div>

          <div class="panel">
            <h3>Swap offers awaiting your reply</h3>
            ${pendingSwaps.length ? pendingSwaps.slice(0, 6).map(s => `
              <div class="swap-row">
                <div class="swap-main">
                  <div class="swap-title">${esc(s.offered_title)}</div>
                  <div class="swap-sub">for your "${esc(s.listing_title)}" · from ${esc(s.requester_name)}</div>
                </div>
                <a class="btn-sm btn-quiet" href="#/swaps" data-link>Review</a>
              </div>`).join('') : '<p class="sub">No pending swap offers right now.</p>'}
          </div>
        </div>`;
    } catch (err) { view.innerHTML = errorPanel(err.message); }
  }

  // ---------------------------------------------------------------- marketplace
  async function viewMarketplace() {
    loading();
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    let categories = [];
    try { categories = (await api.get('/listings/categories')).categories; } catch (e) {}

    const qs = new URLSearchParams();
    ['category_id', 'condition', 'listing_type', 'location', 'q', 'sort'].forEach(k => {
      if (params.get(k)) qs.set(k, params.get(k));
    });
    qs.set('limit', '30');

    try {
      const { listings, total } = await api.get(`/listings?${qs}`);

      view.innerHTML = `
        <div class="page-head">
          <div><h1>Marketplace</h1><p class="sub">${total} item${total === 1 ? '' : 's'} available right now.</p></div>
        </div>

        <form class="panel filters" id="f-filter">
          <div class="field"><label for="ff-q">Search</label>
            <input id="ff-q" type="text" placeholder="brushes, canvas, watercolour…" value="${esc(params.get('q') || '')}"></div>
          <div class="field"><label for="ff-cat">Category</label>
            <select id="ff-cat"><option value="">All categories</option>
              ${categories.map(c => `<option value="${c.id}" ${params.get('category_id') == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="ff-cond">Condition</label>
            <select id="ff-cond"><option value="">Any condition</option>
              ${Object.entries(CONDITION).map(([k, v]) => `<option value="${k}" ${params.get('condition') === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select></div>
          <div class="field"><label for="ff-type">Listing type</label>
            <select id="ff-type"><option value="">Sale or swap</option>
              ${Object.entries(LTYPE).map(([k, v]) => `<option value="${k}" ${params.get('listing_type') === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select></div>
          <div class="field"><label for="ff-loc">Area</label>
            <input id="ff-loc" type="text" placeholder="e.g. Koramangala" value="${esc(params.get('location') || '')}"></div>
          <div class="field"><label for="ff-sort">Sort</label>
            <select id="ff-sort">
              <option value="" ${!params.get('sort') ? 'selected' : ''}>Newest first</option>
              <option value="price_asc" ${params.get('sort') === 'price_asc' ? 'selected' : ''}>Price: low to high</option>
              <option value="price_desc" ${params.get('sort') === 'price_desc' ? 'selected' : ''}>Price: high to low</option>
            </select></div>
          <button type="submit" class="btn-sm">Apply filters</button>
        </form>

        ${listings.length ? `<div class="grid cards">${listings.map(listingCard).join('')}</div>`
          : `<div class="empty"><h3>No listings match your filters</h3><p>Try widening your search or clearing a filter.</p></div>`}`;

      document.getElementById('f-filter').onsubmit = (e) => {
        e.preventDefault();
        const p = new URLSearchParams();
        const v = (id) => document.getElementById(id).value.trim();
        if (v('ff-q')) p.set('q', v('ff-q'));
        if (v('ff-cat')) p.set('category_id', v('ff-cat'));
        if (v('ff-cond')) p.set('condition', v('ff-cond'));
        if (v('ff-type')) p.set('listing_type', v('ff-type'));
        if (v('ff-loc')) p.set('location', v('ff-loc'));
        if (v('ff-sort')) p.set('sort', v('ff-sort'));
        location.hash = `#/marketplace?${p}`;
      };
    } catch (err) { view.innerHTML = errorPanel(err.message); }
  }

  // ---------------------------------------------------------------- sell / create listing
  async function viewSell() {
    loading();
    let categories = [];
    try { categories = (await api.get('/listings/categories')).categories; }
    catch (err) { view.innerHTML = errorPanel(err.message); return; }

    view.innerHTML = `
      <div class="page-head"><div><h1>List an item</h1>
        <p class="sub">Be specific about condition — clear, honest listings sell and swap faster.</p></div></div>

      <form class="panel" id="f-sell" style="max-width:680px">
        <div id="sell-error"></div>

        <div class="field"><label for="s-cat">Category</label>
          <select id="s-cat" required><option value="">Choose a category</option>
            ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select></div>

        <div class="field"><label for="s-title">Title</label>
          <input id="s-title" type="text" maxlength="160" required placeholder="Winsor & Newton acrylic set (24 colours)"></div>

        <div class="field"><label for="s-desc">Description</label>
          <textarea id="s-desc" required placeholder="Condition details, how much is used, why you're letting it go, anything a buyer should know."></textarea>
          <div class="hint">At least 15 characters. Honest condition notes build trust.</div></div>

        <div class="row">
          <div class="field"><label for="s-cond">Condition</label>
            <select id="s-cond">${Object.entries(CONDITION).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="field"><label for="s-type">Listing type</label>
            <select id="s-type">
              <option value="sale">For sale</option>
              <option value="swap">Swap only</option>
              <option value="both">Open to sale or swap</option>
            </select></div>
        </div>

        <div class="row">
          <div class="field" id="price-field"><label for="s-price">Price (₹)</label>
            <input id="s-price" type="number" min="0" step="1" placeholder="500"></div>
          <div class="field"><label for="s-loc">Your area</label>
            <input id="s-loc" type="text" placeholder="e.g. Indiranagar, Bengaluru"></div>
        </div>

        <div class="field"><label for="s-images">Photos</label>
          <input id="s-images" type="file" multiple accept="image/*">
          <div class="hint">Up to 5 photos, 5 MB each. Listings with a clear photo get far more interest.</div></div>

        <div class="actions">
          <button type="submit" id="s-submit">Publish listing</button>
          <a class="btn btn-quiet" href="#/" data-link>Cancel</a>
        </div>
      </form>`;

    const typeSel = document.getElementById('s-type');
    const priceField = document.getElementById('price-field');
    typeSel.onchange = () => { priceField.style.display = typeSel.value === 'swap' ? 'none' : ''; };

    document.getElementById('f-sell').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('s-submit');
      const errBox = document.getElementById('sell-error');
      errBox.innerHTML = ''; btn.disabled = true; btn.textContent = 'Publishing…';

      const fd = new FormData();
      fd.append('category_id', document.getElementById('s-cat').value);
      fd.append('title', document.getElementById('s-title').value.trim());
      fd.append('description', document.getElementById('s-desc').value.trim());
      fd.append('condition', document.getElementById('s-cond').value);
      fd.append('listing_type', typeSel.value);
      if (typeSel.value !== 'swap') fd.append('price', document.getElementById('s-price').value);
      fd.append('location', document.getElementById('s-loc').value.trim());
      for (const f of document.getElementById('s-images').files) fd.append('images', f);

      try {
        const { listing } = await api.form('/listings', fd);
        toast('Listing published.');
        location.hash = `#/listing/${listing.id}`;
      } catch (err) {
        errBox.innerHTML = errorPanel(err.message);
        btn.disabled = false; btn.textContent = 'Publish listing';
      }
    };
  }

  // ---------------------------------------------------------------- listing detail
  async function viewListing(id) {
    loading();
    const u = api.session.user;
    let data;
    try { data = await api.get(`/listings/${id}`); }
    catch (err) { view.innerHTML = errorPanel(err.message); return; }

    const { listing: l, images } = data;
    const isOwner = u && u.id === l.seller_id;
    const imgUrl = (imgId) => `/api/listings/${l.id}/images/${imgId}`;

    view.innerHTML = `
      <div class="page-head">
        <a class="btn btn-quiet btn-sm" href="#/marketplace" data-link>&larr; Back to marketplace</a>
      </div>

      <div class="grid two">
        <div>
          <div class="detail-gallery">
            <div class="detail-hero" id="hero" style="${images[0] ? `background-image:url('${imgUrl(images[0].id)}')` : ''}">${images.length ? '' : '🎨'}</div>
            ${images.length > 1 ? `<div class="thumb-row">${images.map((img, i) => `
              <div class="thumb ${i === 0 ? 'active' : ''}" data-src="${imgUrl(img.id)}" style="background-image:url('${imgUrl(img.id)}')"></div>`).join('')}</div>` : ''}
          </div>
        </div>

        <div>
          <div class="panel">
            <div class="card-cat">${esc(l.category)}</div>
            <h1>${esc(l.title)}</h1>
            <div class="card-meta" style="margin-bottom:10px">
              <span class="badge cond-${l.condition}">${CONDITION[l.condition]}</span>
              <span class="badge type-${l.listing_type}">${LTYPE[l.listing_type]}</span>
              <span class="badge status-${l.status}">${LSTATUS[l.status]}</span>
            </div>
            <div class="card-price" style="margin-bottom:14px">${l.price != null ? price(l.price) : 'Swap only'}</div>
            <p style="white-space:pre-wrap">${esc(l.description)}</p>
            <dl class="dl">
              <dt>Location</dt><dd>${esc(l.location || 'Not specified')}</dd>
              <dt>Listed</dt><dd>${fmtDate(l.created_at)}</dd>
              <dt>Seller</dt><dd>${esc(l.seller_name)}</dd>
            </dl>

            <div id="listing-actions" style="margin-top:18px"></div>
          </div>
        </div>
      </div>`;

    view.querySelectorAll('.thumb').forEach(t => {
      t.onclick = () => {
        document.getElementById('hero').style.backgroundImage = `url('${t.dataset.src}')`;
        view.querySelectorAll('.thumb').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
      };
    });

    const actions = document.getElementById('listing-actions');

    if (!u) {
      actions.innerHTML = `<p class="sub">Sign in to contact the seller or make an offer.</p>
        <a class="btn" href="#/signin" data-link>Sign in</a>`;
    } else if (isOwner) {
      const buyers = l.status === 'available'
        ? await api.get(`/listings/${l.id}/interested-buyers`).then(r => r.buyers).catch(() => [])
        : [];
      actions.innerHTML = `
        <h3>Manage this listing</h3>
        <div id="own-error"></div>
        ${l.status === 'available' && l.listing_type !== 'swap' ? `
          <div class="field"><label for="buyer-select">Mark as sold to</label>
            <div class="actions">
              <select id="buyer-select" style="flex:1">
                <option value="">Choose the buyer</option>
                ${buyers.map(b => `<option value="${b.id}">${esc(b.full_name)}</option>`).join('')}
              </select>
              <button class="btn-sm" id="complete-sale">Mark sold</button>
            </div>
            ${!buyers.length ? '<div class="hint">No one has messaged about this listing yet.</div>' : ''}
          </div>` : ''}
        <div class="actions">
          <a class="btn-quiet btn-sm" href="#/chat" data-link>View messages about this</a>
          ${l.status !== 'removed' ? '<button class="btn-danger btn-sm" id="remove-listing">Remove listing</button>' : ''}
        </div>`;

      const err2 = document.getElementById('own-error');
      const cs = document.getElementById('complete-sale');
      if (cs) cs.onclick = async () => {
        const buyerId = document.getElementById('buyer-select').value;
        if (!buyerId) return toast('Choose a buyer first.', true);
        try {
          await api.post(`/listings/${l.id}/complete-sale`, { buyer_id: Number(buyerId) });
          toast('Marked as sold.'); viewListing(id);
        } catch (e) { err2.innerHTML = errorPanel(e.message); }
      };
      document.getElementById('remove-listing').onclick = async () => {
        try { await api.del(`/listings/${l.id}`); toast('Listing removed.'); location.hash = '#/'; }
        catch (e) { err2.innerHTML = errorPanel(e.message); }
      };
    } else if (l.status !== 'available') {
      actions.innerHTML = `<p class="sub">This listing is no longer available.</p>`;
    } else {
      actions.innerHTML = `
        <h3>Interested?</h3>
        <div id="buy-error"></div>
        ${l.listing_type !== 'swap' ? `
          <div class="field"><label for="msg-text">Message the seller</label>
            <textarea id="msg-text" placeholder="Hi, is this still available?"></textarea></div>
          <button id="send-interest">Message seller</button>` : ''}
        ${l.listing_type !== 'sale' ? `
          <h4 style="margin-top:20px">Propose a swap</h4>
          <div class="field"><label for="swap-title">What are you offering?</label>
            <input id="swap-title" type="text" placeholder="e.g. Set of 6 dry pastels"></div>
          <div class="field"><label for="swap-desc">Details (optional)</label>
            <textarea id="swap-desc" placeholder="Condition, how much is used…"></textarea></div>
          <button class="btn-plum" id="send-swap">Send swap offer</button>` : ''}
        <div class="actions" style="margin-top:16px">
          <button class="btn-quiet btn-sm" id="report-listing">Report this listing</button>
        </div>`;

      document.getElementById('report-listing').onclick = async () => {
        const reason = prompt('What\'s wrong with this listing? (e.g. "Misleading condition", "Suspected scam")');
        if (!reason || !reason.trim()) return;
        try {
          await api.post('/admin/reports', { listing_id: l.id, reason: reason.trim() });
          toast('Thanks — our team will review this listing.');
        } catch (e) { toast(e.message, true); }
      };

      const errBuy = document.getElementById('buy-error');
      const si = document.getElementById('send-interest');
      if (si) si.onclick = async () => {
        try {
          await api.post(`/listings/${l.id}/interest`, { message: document.getElementById('msg-text').value.trim() });
          toast('Message sent — check your inbox.'); location.hash = '#/chat';
        } catch (e) { errBuy.innerHTML = errorPanel(e.message); }
      };
      const sw = document.getElementById('send-swap');
      if (sw) sw.onclick = async () => {
        const title = document.getElementById('swap-title').value.trim();
        if (!title) return toast('Describe what you\'re offering first.', true);
        try {
          await api.post(`/listings/${l.id}/swap-requests`, {
            offered_title: title,
            offered_description: document.getElementById('swap-desc').value.trim(),
          });
          toast('Swap offer sent.'); location.hash = '#/swaps';
        } catch (e) { errBuy.innerHTML = errorPanel(e.message); }
      };
    }
  }

  // ---------------------------------------------------------------- chat
  async function viewChat(openId) {
    loading();
    let conversations;
    try { conversations = (await api.get('/conversations')).conversations; }
    catch (err) { view.innerHTML = errorPanel(err.message); return; }

    const activeId = openId ? Number(openId) : (conversations[0] ? conversations[0].id : null);

    view.innerHTML = `
      <div class="page-head"><div><h1>Messages</h1><p class="sub">Conversations with buyers and sellers.</p></div></div>
      <div class="chat-layout">
        <div class="convo-list">${conversations.length ? conversations.map(c => `
          <a class="convo-item ${c.id === activeId ? 'active' : ''}" href="#/chat/${c.id}" data-link>
            <div class="cname">${esc(c.other_user_name)} ${c.unread ? `<span class="cunread">${c.unread}</span>` : ''}</div>
            <div class="clisting">${esc(c.listing_title)}</div>
            <div class="cpreview">${esc(c.last_message || 'No messages yet')}</div>
          </a>`).join('') : '<div class="chat-empty">No conversations yet</div>'}
        </div>
        <div class="chat-pane" id="chat-pane">
          ${activeId ? '<div class="chat-empty">Loading…</div>' : '<div class="chat-empty">Select a conversation, or message a seller from a listing page.</div>'}
        </div>
      </div>`;

    if (activeId) await loadThread(activeId);
  }

  async function loadThread(convoId) {
    const pane = document.getElementById('chat-pane');
    try {
      const { messages, listing } = await api.get(`/conversations/${convoId}/messages`);
      const u = api.session.user;
      pane.innerHTML = `
        <div class="chat-header">
          <strong>${esc(listing.title)}</strong>
          <span class="badge status-${listing.status}" style="margin-left:8px">${LSTATUS[listing.status]}</span>
          <div class="sub" style="margin:2px 0 0"><a href="#/listing/${listing.id}" data-link>View listing</a></div>
        </div>
        <div class="chat-messages" id="chat-msgs">
          ${messages.map(m => `<div class="msg ${m.sender_id === u.id ? 'mine' : 'theirs'}">
            ${esc(m.body)}<div class="msg-time">${fmtDate(m.created_at, true)}</div>
          </div>`).join('') || '<div class="chat-empty">Say hello!</div>'}
        </div>
        <form class="chat-input" id="f-chat">
          <textarea id="chat-text" placeholder="Type a message…" required></textarea>
          <button type="submit">Send</button>
        </form>`;

      const msgs = document.getElementById('chat-msgs');
      msgs.scrollTop = msgs.scrollHeight;

      document.getElementById('f-chat').onsubmit = async (e) => {
        e.preventDefault();
        const text = document.getElementById('chat-text');
        if (!text.value.trim()) return;
        try {
          await api.post(`/conversations/${convoId}/messages`, { body: text.value.trim() });
          text.value = '';
          loadThread(convoId);
        } catch (err) { toast(err.message, true); }
      };
    } catch (err) { pane.innerHTML = errorPanel(err.message); }
  }

  // ---------------------------------------------------------------- swap requests
  async function viewSwaps() {
    loading();
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const role = params.get('role') === 'sent' ? 'sent' : 'received';

    try {
      const { swap_requests } = await api.get(`/swap-requests?role=${role}`);
      view.innerHTML = `
        <div class="page-head"><div><h1>Swap requests</h1><p class="sub">Offers to trade items with other members.</p></div></div>
        <div class="tabs">
          <button class="${role === 'received' ? 'active' : ''}" id="tab-received">Received</button>
          <button class="${role === 'sent' ? 'active' : ''}" id="tab-sent">Sent</button>
        </div>
        <div class="panel">
          ${swap_requests.length ? swap_requests.map(s => `
            <div class="swap-row">
              <div class="swap-main">
                <div class="swap-title">${esc(s.offered_title)}</div>
                <div class="swap-sub">
                  ${role === 'received' ? `from ${esc(s.requester_name)}` : `to ${esc(s.seller_name)}`}
                  for "<a href="#/listing/${s.listing_id}" data-link>${esc(s.listing_title)}</a>" · ${fmtDate(s.created_at)}
                </div>
              </div>
              <div class="actions">
                <span class="badge status-${s.status === 'pending' ? 'pending' : s.status === 'accepted' ? 'available' : 'removed'}">${s.status}</span>
                ${role === 'received' && s.status === 'pending' ? `
                  <button class="btn-sm" data-accept="${s.id}">Accept</button>
                  <button class="btn-sm btn-quiet" data-reject="${s.id}">Decline</button>` : ''}
                ${role === 'sent' && s.status === 'pending' ? `<button class="btn-sm btn-quiet" data-cancel="${s.id}">Cancel</button>` : ''}
              </div>
            </div>`).join('') : `<div class="empty"><h3>Nothing here</h3><p>${role === 'received' ? 'No one has proposed a swap with you yet.' : 'You haven\'t sent any swap offers yet.'}</p></div>`}
        </div>`;

      document.getElementById('tab-received').onclick = () => { location.hash = '#/swaps?role=received'; };
      document.getElementById('tab-sent').onclick = () => { location.hash = '#/swaps?role=sent'; };

      view.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
        try { await api.post(`/swap-requests/${b.dataset.accept}/respond`, { decision: 'accepted' }); toast('Swap accepted.'); viewSwaps(); }
        catch (e) { toast(e.message, true); }
      });
      view.querySelectorAll('[data-reject]').forEach(b => b.onclick = async () => {
        try { await api.post(`/swap-requests/${b.dataset.reject}/respond`, { decision: 'rejected' }); toast('Offer declined.'); viewSwaps(); }
        catch (e) { toast(e.message, true); }
      });
      view.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
        try { await api.post(`/swap-requests/${b.dataset.cancel}/cancel`); toast('Offer cancelled.'); viewSwaps(); }
        catch (e) { toast(e.message, true); }
      });
    } catch (err) { view.innerHTML = errorPanel(err.message); }
  }

  // ---------------------------------------------------------------- admin
  async function viewAdmin() {
    loading();
    try {
      const [k, cat, { users }, { listings }, { reports }] = await Promise.all([
        api.get('/admin/kpis').then(r => r.kpis),
        api.get('/admin/categories/breakdown').then(r => r.data),
        api.get('/admin/users'),
        api.get('/admin/listings'),
        api.get('/admin/reports?status=open'),
      ]);

      view.innerHTML = `
        <div class="page-head"><div><h1>Admin panel</h1><p class="sub">Users, listings and disputes across the marketplace.</p></div></div>

        <div class="grid kpi" style="margin-bottom:22px">
          <div class="kpi-tile"><div class="kpi-value">${k.total_listings}</div><div class="kpi-name">Total listings</div></div>
          <div class="kpi-tile"><div class="kpi-value">${k.total_users}</div><div class="kpi-name">Registered members</div></div>
          <div class="kpi-tile"><div class="kpi-value">${k.active_users_30d}</div><div class="kpi-name">Active in 30 days</div></div>
          <div class="kpi-tile"><div class="kpi-value">${k.purchases}</div><div class="kpi-name">Purchases completed</div></div>
          <div class="kpi-tile"><div class="kpi-value">${k.swaps}</div><div class="kpi-name">Swaps completed</div></div>
          <div class="kpi-tile"><div class="kpi-value">${k.listing_conversion_pct}%</div><div class="kpi-name">Listing conversion</div></div>
        </div>

        <div class="panel"><h3>Listings by category</h3>
          <div class="bars">${cat.map(c => `<div class="bar-row"><span>${esc(c.label)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${c.total ? (c.completed / Math.max(c.total,1)) * 100 : 0}%"></div></div>
            <span class="bar-num">${c.total}</span></div>`).join('')}</div>
          <p class="sub" style="font-size:.8rem;margin-top:8px">Bar fill shows the share already sold or swapped.</p>
        </div>

        <div class="panel"><h3>Open reports ${reports.length ? `(${reports.length})` : ''}</h3>
          ${reports.length ? reports.map(r => `
            <div class="swap-row">
              <div class="swap-main">
                <div class="swap-title">${esc(r.reason)}</div>
                <div class="swap-sub">${r.listing_title ? `Listing: ${esc(r.listing_title)} · ` : ''}${r.reported_user_name ? `User: ${esc(r.reported_user_name)} · ` : ''}reported by ${esc(r.reporter_name)}</div>
                ${r.details ? `<p class="sub" style="margin-top:6px">${esc(r.details)}</p>` : ''}
              </div>
              <div class="actions">
                <button class="btn-sm" data-resolve="${r.id}">Resolve</button>
                <button class="btn-sm btn-quiet" data-dismiss="${r.id}">Dismiss</button>
              </div>
            </div>`).join('') : '<p class="sub">No open reports.</p>'}
        </div>

        <div class="grid two">
          <div class="panel"><h3>Members</h3>
            <div class="table-wrap"><table>
              <thead><tr><th>Name</th><th>Role</th><th class="num">Listings</th><th>Status</th><th></th></tr></thead>
              <tbody>${users.map(u => `<tr>
                <td>${esc(u.full_name)}<div class="sub" style="font-size:.78rem">${esc(u.email)}</div></td>
                <td>${u.role}</td><td class="num">${u.listing_count}</td>
                <td><span class="badge ${u.is_active ? 'status-available' : 'status-removed'}">${u.is_active ? 'Active' : 'Suspended'}</span></td>
                <td>${u.role !== 'admin' ? `<button class="btn-sm btn-quiet" data-toggle-user="${u.id}" data-active="${u.is_active}">${u.is_active ? 'Suspend' : 'Reactivate'}</button>` : ''}</td>
              </tr>`).join('')}</tbody>
            </table></div>
          </div>

          <div class="panel"><h3>Recent listings</h3>
            <div class="table-wrap"><table>
              <thead><tr><th>Title</th><th>Seller</th><th>Status</th><th></th></tr></thead>
              <tbody>${listings.slice(0, 15).map(l => `<tr>
                <td><a href="#/listing/${l.id}" data-link>${esc(l.title)}</a></td>
                <td>${esc(l.seller_name)}</td>
                <td><span class="badge status-${l.status}">${LSTATUS[l.status]}</span></td>
                <td>${l.status !== 'removed' ? `<button class="btn-sm btn-quiet" data-remove-listing="${l.id}">Remove</button>` : ''}</td>
              </tr>`).join('')}</tbody>
            </table></div>
          </div>
        </div>`;

      view.querySelectorAll('[data-toggle-user]').forEach(b => b.onclick = async () => {
        try {
          await api.patch(`/admin/users/${b.dataset.toggleUser}/status`, { is_active: b.dataset.active !== 'true' });
          toast('Updated.'); viewAdmin();
        } catch (e) { toast(e.message, true); }
      });
      view.querySelectorAll('[data-remove-listing]').forEach(b => b.onclick = async () => {
        try { await api.patch(`/admin/listings/${b.dataset.removeListing}/status`, { status: 'removed' }); toast('Listing removed.'); viewAdmin(); }
        catch (e) { toast(e.message, true); }
      });
      view.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
        try { await api.patch(`/admin/reports/${b.dataset.resolve}`, { status: 'resolved' }); toast('Report resolved.'); viewAdmin(); }
        catch (e) { toast(e.message, true); }
      });
      view.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = async () => {
        try { await api.patch(`/admin/reports/${b.dataset.dismiss}`, { status: 'dismissed' }); toast('Report dismissed.'); viewAdmin(); }
        catch (e) { toast(e.message, true); }
      });
    } catch (err) { view.innerHTML = errorPanel(err.message); }
  }

  // ---------------------------------------------------------------- router
  async function route() {
    const raw = (location.hash || '#/').slice(1);
    const [pathPart] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    const page = parts[0] || '';

    const authed = !!api.session.token;
    const publicPages = ['signin', 'marketplace', 'listing'];

    if (!authed && !publicPages.includes(page)) {
      location.hash = '#/signin';
      return;
    }
    if (authed && page === 'signin') { location.hash = '#/'; return; }

    await renderChrome();
    window.scrollTo(0, 0);

    switch (page) {
      case 'signin': return viewSignIn();
      case 'marketplace': return viewMarketplace();
      case 'sell': return viewSell();
      case 'listing': return viewListing(parts[1]);
      case 'chat': return viewChat(parts[1]);
      case 'swaps': return viewSwaps();
      case 'admin': return viewAdmin();
      default: return viewDashboard();
    }
  }

  (async function boot() {
    if (api.session.token) {
      try {
        const { user } = await api.get('/auth/me');
        api.session.save(api.session.token, user);
      } catch (e) { api.session.clear(); }
    }
    window.addEventListener('hashchange', route);
    route();
  })();
})();
