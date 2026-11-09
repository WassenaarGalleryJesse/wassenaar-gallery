// Wassenaar Gallery: the link in our Instagram bio. Rebuilds the feed from instagram/posts.json.
// A post with one piece opens it on the homepage (/#piece=…), with its price and the way to
// 1stDibs. A post with several pieces lists them in a sheet first, the way 1stDibs does it.
//
// The grid is drawn from posts.json alone, so it appears at once. data/listings.json follows:
// it tells which pieces have sold since the post (those lead to similar pieces instead) and
// gives the prices in the sheet. It is the homepage's own file, so it is already cached when a
// tap opens the piece there.

const $ = (sel, root = document) => root.querySelector(sel);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function imgUrl(url, width) {
  return url ? `${url}?width=${width}` : "";
}

// Same counting as the homepage: one pageview plus named clicks, no cookies.
function track(name, data) {
  try {
    if (name === undefined) window.umami?.track();
    else window.umami?.track(name, data);
  } catch {
    /* counting must never break the page */
  }
}

// Prices in the visitor's currency, chosen the way the homepage chooses it (and remembers it).
const CURRENCY = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem("wg:currency"));
    if (["EUR", "USD", "GBP"].includes(saved)) return saved;
  } catch {
    /* storage blocked: fall back to the language */
  }
  const lang = (navigator.languages?.[0] || navigator.language || "").toLowerCase();
  if (lang === "en-us" || lang.endsWith("-us") || lang === "en-ca") return "USD";
  if (lang === "en-gb" || lang.endsWith("-gb")) return "GBP";
  return "EUR";
})();
const priceFormat = new Intl.NumberFormat("en-GB", { style: "currency", currency: CURRENCY, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });

let POSTS = [];
let FEED = null; // data/listings.json, once loaded
let BY_ID = new Map();

function money(piece) {
  const amount = piece.price?.[CURRENCY];
  if (typeof amount !== "number") return "";
  // Euro prices are the listed prices; dollars and pounds are converted at the daily ECB rate.
  return (CURRENCY !== "EUR" && FEED?.fx?.approximate ? "≈ " : "") + priceFormat.format(amount);
}

// A post lists its pieces as ids, or as {id, title, room, photo} so the grid can be drawn before
// the collection has loaded and a sold piece can still be named. Until then, every piece counts
// as available.
function piecesOf(post) {
  return (post.pieces || []).map((p) => {
    const ref = typeof p === "string" ? { id: p } : p;
    const live = BY_ID.get(ref.id);
    const available = FEED ? Boolean(live && !live.sold && live.images?.length) : true;
    return {
      ...ref,
      ...(live || {}),
      available,
      title: live?.title || ref.title || "",
      room: live?.room || ref.room,
      photo: live?.images?.[0] || ref.photo,
    };
  });
}

const pieceHref = (piece) => `/#piece=${encodeURIComponent(piece.id)}`;
const similarHref = (room) => (room ? `/?category=${encodeURIComponent(room)}#collection` : "/#collection");

// A post's own link (set with --link) may point into this site or to another https address.
function safeLink(link) {
  const s = String(link || "").trim();
  return /^\/(?!\/)/.test(s) || /^https:\/\//i.test(s) ? s : "";
}

// Where a tap on the photo leads.
function targetOf(post, pieces) {
  const link = safeLink(post.link);
  if (link) return { href: link, id: "link", external: /^https:/i.test(link) };
  if (!pieces.length) return { href: "/#collection", id: "collection" };
  const live = pieces.filter((p) => p.available);
  const room = pieces.find((p) => p.room)?.room;
  if (!live.length) return { href: similarHref(room), id: pieces[0].id, sold: true };
  if (pieces.length === 1) return { href: pieceHref(live[0]), id: live[0].id };
  // Several pieces: the sheet lists them. Without JavaScript the link opens the first one.
  return { href: pieceHref(live[0]), id: "several", sheet: true };
}

function postPhoto(post, pieces, { width = 480, attrs = "" } = {}) {
  if (post.image) return { plate: false, html: `<img src="/instagram/${esc(post.image)}" alt="" ${attrs} decoding="async">` };
  // No photo saved for this post: show the first piece the way the homepage does.
  const piece = pieces.find((p) => p.photo);
  if (!piece) return { plate: true, html: "" };
  return { plate: true, html: `<img src="${esc(imgUrl(piece.photo, width))}" alt="" ${attrs} decoding="async">` };
}

// ---------------------------------------------------------------- grid

// A reel shows its cover with a small play mark, as in the Instagram grid.
const REEL_ICON = `<span class="ig-tile__reel" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 8.2v7.6l6-3.8z" fill="currentColor"/></svg></span>`;

function tileHtml(post, i) {
  const pieces = piecesOf(post);
  const to = targetOf(post, pieces);
  const titles = pieces.map((p) => p.title).filter(Boolean);
  const name = titles[0] || "the collection";
  const label = (post.reel ? "Reel: " : "") + (to.sold
    ? `Sold: ${name}. See similar pieces`
    : to.sheet
      ? `${pieces.length} pieces in this post${titles.length ? `: ${titles.join("; ")}` : ""}`
      : name);
  const countBadge = pieces.length > 1 && !to.sold;
  const caption = !titles.length ? "" : pieces.length > 1 ? `${titles[0]} and ${pieces.length - 1} more` : titles[0];
  const loading = i < 9 ? `loading="eager"${i < 3 ? ' fetchpriority="high"' : ""}` : 'loading="lazy"';
  const photo = postPhoto(post, pieces, { attrs: loading });
  const classes = ["ig-tile", photo.plate && "ig-tile--plate", to.sold && "is-sold"].filter(Boolean).join(" ");
  const external = to.external ? ' target="_blank" rel="noopener"' : "";
  return `<li><a class="${classes}" href="${esc(to.href)}"${external} data-post="${esc(post.id)}" data-piece="${esc(to.id)}"${to.sheet ? " data-open-sheet" : ""} aria-label="${esc(label)}">
    ${photo.html || `<span class="ig-tile__name">${esc(name)}</span>`}
    ${to.sold ? `<span class="ig-tile__badge ig-tile__badge--sold">Sold</span>` : ""}
    ${countBadge ? `<span class="ig-tile__badge ig-tile__badge--count">${pieces.length} pieces</span>` : ""}
    ${post.reel && !countBadge ? REEL_ICON : ""}
    ${caption && photo.html ? `<span class="ig-tile__caption" aria-hidden="true">${esc(caption)}</span>` : ""}
  </a></li>`;
}

let drawn = [];

// Redraws only the tiles that changed, so photos already on screen stay put.
function render() {
  const grid = $("[data-grid]");
  const next = POSTS.map(tileHtml);
  if (next.length !== drawn.length) {
    grid.innerHTML = next.join("");
  } else {
    next.forEach((html, i) => {
      if (html !== drawn[i]) grid.children[i].outerHTML = html;
    });
  }
  drawn = next;
  grid.removeAttribute("aria-busy");
  $("[data-empty]").hidden = POSTS.length > 0;
}

// ---------------------------------------------------------------- sheet (posts with several pieces)

const sheet = () => $("[data-sheet]");
let sheetPost = null;

function fillSheet(post) {
  const pieces = piecesOf(post);
  const photo = postPhoto(post, pieces, { width: 960 });
  const box = $("[data-sheet-photo]");
  box.classList.toggle("ig-sheet__photo--plate", photo.plate);
  box.innerHTML = photo.html;
  $("[data-sheet-title]").textContent = `In this post · ${pieces.length} pieces`;
  $("[data-sheet-pieces]").innerHTML = pieces
    .map((p) => {
      const href = p.available ? pieceHref(p) : similarHref(p.room);
      const meta = [p.kind, p.date || p.subtitle].filter(Boolean).join(" · ");
      const price = p.available ? money(p) : "Sold · see similar pieces";
      return `<li><a class="ig-piece${p.available ? "" : " is-sold"}" href="${esc(href)}" data-sheet-piece="${esc(p.id)}">
        <span class="ig-piece__plate">${p.photo ? `<img src="${esc(imgUrl(p.photo, 240))}" alt="" loading="lazy" decoding="async">` : ""}</span>
        <span class="ig-piece__text">
          ${meta ? `<span class="ig-piece__meta">${esc(meta)}</span>` : ""}
          <span class="ig-piece__title">${esc(p.title || "View this piece")}</span>
          ${price ? `<span class="ig-piece__price">${esc(price)}</span>` : ""}
        </span>
        <span class="ig-piece__arrow" aria-hidden="true">→</span>
      </a></li>`;
    })
    .join("");
}

// The sheet gets its own history entry, so the phone's back button closes it, and coming back
// from a piece reopens it.
function openSheet(post, { push = true } = {}) {
  sheetPost = post;
  fillSheet(post);
  const dialog = sheet();
  if (!dialog.open) {
    dialog.showModal();
    document.documentElement.style.overflow = "hidden";
  }
  dialog.scrollTop = 0;
  if (push) history.pushState({ igSheet: post.id }, "");
}

// Tidies up straight away rather than waiting for the dialog's close event (as the homepage does).
function hideSheet() {
  if (sheet().open) sheet().close();
  document.documentElement.style.overflow = "";
  sheetPost = null;
}

function closeSheet() {
  if (history.state?.igSheet) history.back(); // popstate hides it
  else hideSheet();
}

function syncSheetWithHistory() {
  const post = POSTS.find((p) => p.id === history.state?.igSheet);
  if (post) openSheet(post, { push: false });
  else hideSheet();
}

// ---------------------------------------------------------------- start

function bindEvents() {
  document.addEventListener("click", (e) => {
    const tile = e.target.closest("a[data-post]");
    if (tile) {
      track("instagram-post", { post: tile.dataset.post, id: tile.dataset.piece });
      const plainClick = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
      if (tile.hasAttribute("data-open-sheet") && plainClick) {
        const post = POSTS.find((p) => p.id === tile.dataset.post);
        if (post) {
          e.preventDefault();
          openSheet(post);
        }
      }
    }
    const piece = e.target.closest("a[data-sheet-piece]");
    if (piece) track("instagram-piece", { post: sheetPost?.id, id: piece.dataset.sheetPiece });
    const out = e.target.closest("a[data-out]");
    if (out) track("to-1stdibs", { id: out.dataset.out, from: "instagram" });
  });

  const dialog = sheet();
  $("[data-sheet-close]").addEventListener("click", closeSheet);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeSheet();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeSheet(); // the backdrop
  });
  // Browsers may close a modal on their own (e.g. repeated Escape); tidy up after it.
  dialog.addEventListener("close", () => {
    if (dialog.open || !sheetPost) return; // already tidied up, or opened again since
    if (history.state?.igSheet) history.back();
    else hideSheet();
  });
  addEventListener("popstate", syncSheetWithHistory);
}

async function start() {
  bindEvents();
  $("[data-year]").textContent = new Date().getFullYear();

  const data = await fetch("/instagram/posts.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  POSTS = (data.posts || []).filter((p) => p?.id).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  render();
  if (history.state?.igSheet) syncSheetWithHistory(); // back from a piece that was opened from a sheet
  track();

  FEED = await fetch("/data/listings.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!FEED) return; // the grid keeps working; sold pieces simply aren't marked
  BY_ID = new Map(FEED.items.map((i) => [i.id, i]));
  render();
  if (sheetPost) fillSheet(sheetPost);
}

start();
