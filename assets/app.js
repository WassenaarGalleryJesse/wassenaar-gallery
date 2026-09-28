// Wassenaar Gallery: renders data/listings.json into the page.
// No framework and no build step; every piece links out to its 1stDibs page.

const PAGE_SIZE = 40;
const AUTO_LOAD_LIMIT = 200; // endless scrolling starts after the first "Show more" click, and stops here
const SHOP_URL = "https://www.1stdibs.com/dealers/handelshuis-wassenaar/";
const CURRENCIES = { EUR: "€", USD: "$", GBP: "£" };
const PRICE_BANDS = [
  { id: "0-1000", min: 0, max: 1000 },
  { id: "1000-2500", min: 1000, max: 2500 },
  { id: "2500-5000", min: 2500, max: 5000 },
  { id: "5000-10000", min: 5000, max: 10000 },
  { id: "10000+", min: 10000, max: Infinity },
];
const HANGING_KINDS = new Set(["Chandeliers & pendants", "Ceiling lights", "Lanterns"]);
const STANDING_ROOMS = new Set(["objects", "clocks", "sacred", "furniture", "art"]);
const STANDING_KINDS = new Set(["Table lamps", "Candle holders", "Floor lamps"]);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;

// ---------------------------------------------------------------- helpers

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function imgUrl(url, width) {
  return url ? `${url}?width=${width}` : "";
}

function srcset(url, widths = [320, 480, 640, 960, 1280]) {
  return widths.map((w) => `${imgUrl(url, w)} ${w}w`).join(", ");
}

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode or storage blocked: the feature simply doesn't persist */
    }
  },
};

const numberFormat = new Intl.NumberFormat("en-GB");
const formatters = {};
function money(amount, currency = state.currency) {
  if (typeof amount !== "number") return "Price on 1stDibs";
  formatters[currency] ??= new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
  // Euro prices are the listed prices; dollars and pounds are converted at the daily ECB rate.
  const approx = currency !== "EUR" && FEED?.fx?.approximate ? "≈ " : "";
  return approx + formatters[currency].format(amount);
}
function priceOf(item, currency = state.currency) {
  return item.price?.[currency] ?? null;
}

function shortPeriod(period) {
  if (!period) return "";
  return period.replace(/\s*Century$/i, " c.").replace(/^(\d{4}s)$/, "$1");
}

function dateLabel(item) {
  if (item.date) return item.date;
  if (item.year && !/s$/.test(item.period || "")) return `c. ${item.year}`;
  return shortPeriod(item.period);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------- state

let FEED;
let ITEMS = [];
let BY_ID = new Map();
let ROOM_LABEL = {};
let ERA_LABEL = {};
let CURATION = {};
let DETAILS = null;
let detailsRequest = null;

function loadDetails() {
  detailsRequest ??= fetch("data/details.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((details) => {
      DETAILS = details;
      // Once descriptions are here, search can use them too.
      for (const item of ITEMS) {
        const d = DETAILS[item.id];
        if (d?.description) item._text += " " + fold(d.description);
      }
      return DETAILS;
    });
  return detailsRequest;
}

function imagesOf(item) {
  return DETAILS?.[item.id]?.images?.length ? DETAILS[item.id].images : item.images;
}

const state = {
  room: "all",
  era: null,
  styles: new Set(),
  origins: new Set(),
  price: null,
  q: "",
  sort: "recent",
  view: "plates",
  list: null,
  currency: "EUR",
  shown: PAGE_SIZE,
  results: [],
};

let shortlist = [];

function defaultCurrency() {
  const saved = store.get("wg:currency", null);
  if (saved && CURRENCIES[saved]) return saved;
  const lang = (navigator.languages?.[0] || navigator.language || "").toLowerCase();
  if (lang === "en-us" || lang.endsWith("-us") || lang === "en-ca") return "USD";
  if (lang === "en-gb" || lang.endsWith("-gb")) return "GBP";
  return "EUR";
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const room = p.get("category") || p.get("room");
  state.room = room && ROOM_LABEL[room] ? room : "all";
  state.era = ERA_LABEL[p.get("era")] ? p.get("era") : null;
  state.styles = new Set((p.get("style") || "").split("|").filter(Boolean));
  state.origins = new Set((p.get("origin") || "").split("|").filter(Boolean));
  state.price = PRICE_BANDS.some((b) => b.id === p.get("price")) ? p.get("price") : null;
  state.q = p.get("q") || "";
  state.sort = ["recent", "price-asc", "price-desc", "oldest"].includes(p.get("sort")) ? p.get("sort") : "recent";
  state.view = p.get("view") === "index" ? "index" : "plates";
  const list = (p.get("list") || "").split(",").filter((id) => BY_ID.has(id));
  state.list = list.length ? list : null;
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.room !== "all") p.set("category", state.room);
  if (state.era) p.set("era", state.era);
  if (state.styles.size) p.set("style", [...state.styles].join("|"));
  if (state.origins.size) p.set("origin", [...state.origins].join("|"));
  if (state.price) p.set("price", state.price);
  if (state.q) p.set("q", state.q);
  if (state.sort !== "recent") p.set("sort", state.sort);
  if (state.view !== "plates") p.set("view", state.view);
  if (state.list) p.set("list", state.list.join(","));
  const qs = p.toString();
  history.replaceState(history.state, "", `${location.pathname}${qs ? "?" + qs : ""}${location.hash}`);
}

// ---------------------------------------------------------------- filtering

function inBand(item, bandId) {
  const band = PRICE_BANDS.find((b) => b.id === bandId);
  const price = priceOf(item);
  return band && price != null && price >= band.min && price < band.max;
}

function matches(item, skip) {
  if (state.list && !state.list.includes(item.id)) return false;
  if (skip !== "room" && state.room !== "all" && item.room !== state.room) return false;
  if (skip !== "era" && state.era && item.era !== state.era) return false;
  if (skip !== "style" && state.styles.size && !state.styles.has(item.style)) return false;
  if (skip !== "origin" && state.origins.size && !state.origins.has(item.origin)) return false;
  if (skip !== "price" && state.price && !inBand(item, state.price)) return false;
  if (state.q) {
    const terms = fold(state.q).split(/\s+/).filter(Boolean);
    if (!terms.every((t) => item._text.includes(t))) return false;
  }
  return true;
}

function countBy(key, skip) {
  const counts = new Map();
  for (const item of ITEMS) {
    if (!matches(item, skip)) continue;
    const value = typeof key === "function" ? key(item) : item[key];
    if (value == null) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

// Counts over the whole collection, ignoring whatever filters are active.
function tally(fn) {
  const counts = new Map();
  for (const item of ITEMS) {
    const value = fn(item);
    if (value != null) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

const ERA_ORDER = ["pre1850", "1850", "1900", "1940", "1970"];
function sortItems(list) {
  const byPrice = (a, b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity);
  const age = (i) => i.year ?? { pre1850: 1800, 1850: 1875, 1900: 1920, 1940: 1955, 1970: 1980 }[i.era] ?? 2100;
  const sorters = {
    recent: (a, b) => b._num - a._num,
    "price-asc": byPrice,
    "price-desc": (a, b) => byPrice(b, a),
    oldest: (a, b) => age(a) - age(b) || b._num - a._num,
  };
  return list.sort(sorters[state.sort]);
}

// ---------------------------------------------------------------- cards

function kicker(item) {
  return [item.origin || item.kind, dateLabel(item)].filter(Boolean).join(" · ");
}

function cardHtml(item, index, feature) {
  const kept = shortlist.includes(item.id);
  const sizes = feature
    ? "(max-width: 900px) 50vw, 40vw"
    : "(max-width: 680px) 50vw, (max-width: 1100px) 33vw, (max-width: 1400px) 25vw, 20vw";
  const price = priceOf(item);
  return `
    <article class="card${feature ? " card--feature" : ""}" data-id="${item.id}" style="--i:${index % PAGE_SIZE}">
      <a class="card__link" href="#piece=${item.id}" data-open-piece="${item.id}">
        <div class="card__plate">
          <img class="card__img" src="${imgUrl(item.images[0], 480)}" srcset="${srcset(item.images[0])}" sizes="${sizes}"
               alt="${esc(item.title)}" loading="lazy" decoding="async">
          ${item.images[1] ? `<img class="card__alt" data-src="${imgUrl(item.images[1], feature ? 1100 : 640)}" alt="" decoding="async">` : ""}
        </div>
        <div class="card__meta">
          <p class="card__kicker">${esc(kicker(item))}</p>
          <h3 class="card__title">${esc(item.title)}</h3>
          <span class="card__facts">
            <span>${esc(item.period || "")}</span>
            <span>${esc([item.origin, item.style].filter(Boolean).join(", "))}</span>
            <span>${esc(item.dimensions?.cm || "")}</span>
          </span>
          <p class="card__price">${esc(money(price))}</p>
        </div>
      </a>
      ${item.onHold ? '<span class="card__badge">On hold</span>' : ""}
      <button type="button" class="card__keep" data-keep="${item.id}" aria-pressed="${kept}"
              aria-label="${kept ? "Remove from" : "Keep on"} shortlist: ${esc(item.title)}">${kept ? "Kept" : "Keep"}</button>
      <a class="card__out" href="${esc(item.url)}" target="_blank" rel="noopener" aria-label="${esc(item.title)} on 1stDibs">1stDibs ↗</a>
    </article>`;
}

function isFeature(item, index) {
  return state.view === "plates" && !state.q && index % 13 === 6 && item._cut;
}

// ---------------------------------------------------------------- collection render

const els = {};

function renderCollection({ keepScroll = false, animate = true } = {}) {
  state.results = sortItems(ITEMS.filter((i) => matches(i)));
  state.shown = keepScroll ? Math.max(state.shown, PAGE_SIZE) : PAGE_SIZE;

  els.grid.dataset.view = state.view;
  els.grid.innerHTML = state.results
    .slice(0, state.shown)
    .map((item, i) => cardHtml(item, i, isFeature(item, i)))
    .join("");
  if (animate && !reducedMotion) $$(".card", els.grid).slice(0, 12).forEach((c) => c.classList.add("is-entering"));

  const total = state.results.length;
  const scope = state.list ? "on this shortlist" : state.room === "all" ? "in the collection" : `in ${ROOM_LABEL[state.room].toLowerCase()}`;
  els.count.textContent = `${numberFormat.format(total)} ${total === 1 ? "piece" : "pieces"} ${scope}`;
  els.empty.hidden = total > 0;
  updateMore();

  renderRoomTabs();
  renderRefine();
  renderActive();
  renderSharedNote();
  writeUrl();
}

function appendMore() {
  const from = state.shown;
  state.shown = Math.min(state.shown + PAGE_SIZE, state.results.length);
  const html = state.results
    .slice(from, state.shown)
    .map((item, i) => cardHtml(item, from + i, isFeature(item, from + i)))
    .join("");
  els.grid.insertAdjacentHTML("beforeend", html);
  if (!reducedMotion) $$(".card", els.grid).slice(from, from + 12).forEach((c) => c.classList.add("is-entering"));
  updateMore();
}

function updateMore() {
  const remaining = state.results.length - state.shown;
  els.moreWrap.hidden = remaining <= 0;
  els.more.textContent = `Show more · ${numberFormat.format(remaining)} to go`;
}

function renderRoomTabs() {
  const counts = countBy("room", "room");
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const tabs = [{ id: "all", label: "Everything", n: total }].concat(
    FEED.rooms.map((r) => ({ id: r.id, label: r.label, n: counts.get(r.id) || 0 })).filter((r) => r.n || r.id === state.room),
  );
  els.roomTabs.innerHTML = tabs
    .map(
      (t) => `<button type="button" class="room-tab" data-room="${t.id}" aria-pressed="${state.room === t.id}">${esc(t.label)}<sup>${numberFormat.format(t.n)}</sup></button>`,
    )
    .join("");
}

let showAllStyles = false;
let showAllOrigins = false;

function renderRefine() {
  const eraCounts = countBy("era", "era");
  const maxEra = Math.max(1, ...eraCounts.values());
  els.eraStrip.innerHTML = ERA_ORDER.map((id) => {
    const n = eraCounts.get(id) || 0;
    const grow = 0.6 + (n / maxEra) * 2.4;
    return `<button type="button" class="era-seg" data-era="${id}" aria-pressed="${state.era === id}" style="flex-grow:${grow.toFixed(2)}"${n || state.era === id ? "" : " disabled"}>
      <span class="era-seg__label">${esc(ERA_LABEL[id])}</span><span class="era-seg__count">${numberFormat.format(n)}</span></button>`;
  }).join("");

  const chipList = (counts, selected, attr, showAll, moreAttr, limit = 9) => {
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const value of selected) if (!counts.has(value)) entries.unshift([value, 0]);
    const visible = showAll ? entries : entries.slice(0, limit);
    const hidden = entries.length - visible.length;
    return (
      visible
        .map(
          ([value, n]) =>
            `<button type="button" class="opt" ${attr}="${esc(value)}" aria-pressed="${selected.has(value)}">${esc(value)}<sup>${n}</sup></button>`,
        )
        .join("") + (hidden > 0 ? `<button type="button" class="opt opt--more" ${moreAttr}>+ ${hidden} more</button>` : "")
    );
  };
  els.styleChips.innerHTML = chipList(countBy("style", "style"), state.styles, "data-style", showAllStyles, "data-more-styles");
  els.originChips.innerHTML = chipList(countBy("origin", "origin"), state.origins, "data-origin", showAllOrigins, "data-more-origins", 8);

  const priceCounts = countBy((i) => PRICE_BANDS.find((b) => inBand(i, b.id))?.id, "price");
  const sym = CURRENCIES[state.currency];
  const bandLabel = (b) =>
    b.max === Infinity ? `${sym}${numberFormat.format(b.min)}+` : b.min === 0 ? `Under ${sym}${numberFormat.format(b.max)}` : `${sym}${numberFormat.format(b.min)}–${numberFormat.format(b.max)}`;
  els.priceChips.innerHTML = PRICE_BANDS.map(
    (b) =>
      `<button type="button" class="opt" data-price="${b.id}" aria-pressed="${state.price === b.id}">${bandLabel(b)}<sup>${priceCounts.get(b.id) || 0}</sup></button>`,
  ).join("");

  const active = (state.era ? 1 : 0) + state.styles.size + state.origins.size + (state.price ? 1 : 0);
  els.refineCount.hidden = active === 0;
  els.refineCount.textContent = active;
  els.sort.value = state.sort;
  $$("[data-view]", els.toolbar).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  if (document.activeElement !== els.search) els.search.value = state.q;
}

function renderActive() {
  const chips = [];
  if (state.room !== "all") chips.push(["room", state.room, ROOM_LABEL[state.room]]);
  if (state.era) chips.push(["era", state.era, ERA_LABEL[state.era]]);
  for (const s of state.styles) chips.push(["style", s, s]);
  for (const o of state.origins) chips.push(["origin", o, o]);
  if (state.price) chips.push(["price", state.price, $(`[data-price="${state.price}"]`, els.priceChips)?.firstChild?.textContent || "Price"]);
  if (state.q) chips.push(["q", state.q, `“${state.q}”`]);
  els.active.innerHTML = chips.length
    ? chips.map(([k, v, label]) => `<button type="button" data-remove="${k}" data-value="${esc(v)}" aria-label="Remove filter ${esc(label)}">${esc(label)}</button>`).join("") +
      (chips.length > 1 ? `<button type="button" class="active__clear" data-clear-all>Clear all</button>` : "")
    : "";
}

function renderSharedNote() {
  if (!state.list) {
    els.sharedNote.hidden = true;
    return;
  }
  els.sharedNote.hidden = false;
  els.sharedNote.innerHTML = `<span>Someone shared a shortlist with you: ${state.list.length} ${state.list.length === 1 ? "piece" : "pieces"}.</span>
    <button type="button" class="text-button" data-adopt-list>Add them to my shortlist</button>
    <button type="button" class="text-button" data-leave-list>See the whole collection</button>`;
}

// ---------------------------------------------------------------- sections

function pickCutouts(filter, n, curated = []) {
  const chosen = curated.map((id) => BY_ID.get(id)).filter(Boolean);
  const pool = ITEMS.filter((i) => i._cut && filter(i) && !chosen.includes(i)).sort((a, b) => (b.price.EUR || 0) - (a.price.EUR || 0));
  return chosen.concat(pool).slice(0, n);
}

function renderSalon() {
  const revealed = els.salon.childElementCount > 0;
  const picks = [];
  const add = (list) => list.forEach((i) => !picks.includes(i) && picks.push(i));
  add((CURATION.salon || []).map((id) => BY_ID.get(id)).filter(Boolean));
  const fallbacks = [
    (i) => i._hang,
    (i) => i.room === "clocks",
    (i) => i._hang && i.era === "1900",
    (i) => i.room === "objects",
    (i) => i.room === "sacred",
  ];
  for (const f of fallbacks) if (picks.length < 5) add(pickCutouts((i) => f(i) && !picks.includes(i), 1));
  els.salon.innerHTML = picks
    .slice(0, 5)
    .map(
      (item, i) => `<a class="salon__piece${revealed ? " is-in" : ""}" href="#piece=${item.id}" data-open-piece="${item.id}"${item._hang ? " data-hang" : ""} data-reveal style="transition-delay:${120 + i * 90}ms">
        <img src="${imgUrl(item.images[0], i === 0 ? 900 : 560)}" srcset="${srcset(item.images[0], [400, 640, 900, 1200])}"
             sizes="${i === 0 ? "(max-width: 900px) 66vw, 34vw" : "(max-width: 900px) 33vw, 17vw"}" alt="${esc(item.title)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
        <span class="salon__caption">${esc(item.title)}<br>${esc(money(priceOf(item)))}</span>
      </a>`,
    )
    .join("");
}

function renderRooms() {
  const counts = tally((i) => i.room);
  els.rooms.innerHTML = FEED.rooms
    .filter((r) => counts.get(r.id))
    .map((room, i) => {
      const inRoom = ITEMS.filter((it) => it.room === room.id);
      const kinds = [...tally((it) => (it.room === room.id ? it.kind : null)).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k]) => k.toLowerCase());
      const rep = pickCutouts((it) => it.room === room.id, 1, CURATION.rooms?.[room.id] ? [CURATION.rooms[room.id]] : [])[0] || inRoom[0];
      return `<li><a class="room-row" href="?category=${room.id}#collection" data-set-filter="category=${room.id}" data-peek="${esc(imgUrl(rep?.images[0], 560))}">
          <span class="room-row__thumb"><img src="${esc(imgUrl(rep?.images[0], 160))}" alt="" loading="lazy" decoding="async"></span>
          <span class="room-row__no">${String(i + 1).padStart(2, "0")}</span>
          <span class="room-row__name">${esc(room.label)}</span>
          <span class="room-row__kinds">${esc(kinds.join(", "))}${kinds.length === 4 ? "…" : ""}</span>
          <span class="room-row__arrow" aria-hidden="true">→</span>
        </a></li>`;
    })
    .join("");
}

function renderReel() {
  const curated = (CURATION.reel || []).map((id) => BY_ID.get(id)).filter(Boolean);
  const pool = ITEMS.filter((i) => i.room === "lighting" && i._cut && !curated.includes(i)).sort((a, b) => (b.price.EUR || 0) - (a.price.EUR || 0));
  // Mix the dearest pieces with a spread of the rest so the reel isn't only chandeliers.
  const spread = pool.filter((_, i) => i % 9 === 0);
  const picks = [...new Set(curated.concat(pool.slice(0, 6), spread))].slice(0, 16);
  els.reelTrack.innerHTML = picks
    .map(
      (item) => `<a class="reel__item" href="#piece=${item.id}" data-open-piece="${item.id}">
        <div class="reel__img"><img src="${imgUrl(item.images[0], 700)}" srcset="${srcset(item.images[0], [400, 700, 1000])}" sizes="(max-width: 900px) 60vw, 24vw" alt="${esc(item.title)}" loading="lazy" decoding="async"></div>
        <p class="reel__caption"><span>${esc(item.title)}</span><span>${esc(money(priceOf(item)))}</span></p>
      </a>`,
    )
    .join("");
}

function renderShelf() {
  const counts = tally((i) => i.era);
  const standing = (i) => STANDING_ROOMS.has(i.room) || STANDING_KINDS.has(i.kind);
  const used = new Set($$("[data-open-piece]", els.salon).map((a) => a.dataset.openPiece));
  els.shelf.innerHTML = ERA_ORDER.filter((id) => counts.get(id))
    .map((id) => {
      const curated = CURATION.eras?.[id] ? [CURATION.eras[id]] : [];
      const rep = pickCutouts((i) => i.era === id && standing(i) && !used.has(i.id), 1, curated)[0];
      if (rep) used.add(rep.id);
      const styles = [...tally((i) => (i.era === id ? i.style : null)).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([s]) => s);
      return `<li><a class="shelf__item" href="?era=${id}#collection" data-set-filter="era=${id}">
          <span class="shelf__object">${rep ? `<img src="${imgUrl(rep.images[0], 480)}" alt="" loading="lazy" decoding="async">` : ""}</span>
          <span class="shelf__label">
            <span class="shelf__era">${esc(ERA_LABEL[id])}</span>
            <span class="shelf__note">${esc(styles.join(", "))}</span>
          </span>
        </a></li>`;
    })
    .join("");
}

function renderStatic() {
  const updated = new Date(FEED.generated);
  $("[data-updated]").textContent = updated.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  $("[data-year]").textContent = String(new Date().getFullYear());
}

function renderPrices() {
  // Currency changed: redraw everything that shows a price.
  renderSalon();
  renderReel();
  renderCollection({ keepScroll: true, animate: false });
  if (els.piece.open && currentPiece) fillPiece(currentPiece);
  renderShortlist();
  observeReveals();
}

// ---------------------------------------------------------------- piece dialog

let currentPiece = null;
let openedFromPage = false;
let activeImage = 0;

function pieceIdFromHash() {
  const m = location.hash.match(/^#piece=(f_\d+)/);
  return m && BY_ID.has(m[1]) ? m[1] : null;
}

function onHashChange() {
  const id = pieceIdFromHash();
  if (id) showPiece(id);
  else if (els.piece.open) hidePiece();
}

function showPiece(id) {
  currentPiece = BY_ID.get(id);
  activeImage = 0;
  fillPiece(currentPiece);
  if (!DETAILS) {
    const waitingFor = currentPiece;
    loadDetails().then(() => {
      if (currentPiece === waitingFor) fillPiece(waitingFor);
    });
  }
  if (!els.piece.open) {
    els.piece.showModal();
    document.documentElement.style.overflow = "hidden";
  }
  els.piece.scrollTop = 0;
  $("[data-piece-close]").focus({ preventScroll: true });
}

function hidePiece() {
  if (els.piece.open) els.piece.close();
  document.documentElement.style.overflow = "";
  currentPiece = null;
}

function closePiece() {
  if (openedFromPage && pieceIdFromHash()) {
    openedFromPage = false;
    history.back();
  } else {
    history.replaceState(history.state, "", location.pathname + location.search);
    hidePiece();
  }
}

function goToPiece(id) {
  history.replaceState(history.state, "", `${location.pathname}${location.search}#piece=${id}`);
  showPiece(id);
}

function siblings() {
  const list = state.results.length ? state.results : ITEMS;
  const i = list.findIndex((it) => it.id === currentPiece?.id);
  return { list, i };
}

function fillPiece(item) {
  const { list, i } = siblings();
  const scope = state.room === "all" ? "" : ` · ${ROOM_LABEL[state.room]}`;
  $("[data-piece-position]").textContent = i >= 0 ? `${numberFormat.format(i + 1)} of ${numberFormat.format(list.length)}${scope}` : ROOM_LABEL[item.room];
  $("[data-piece-prev]").disabled = i <= 0;
  $("[data-piece-next]").disabled = i < 0 || i >= list.length - 1;

  $("[data-piece-kicker]").textContent = [ROOM_LABEL[item.room], item.kind].filter(Boolean).join(" · ");
  $("[data-piece-title]").textContent = item.title;
  $("[data-piece-subtitle]").textContent = item.subtitle || "";
  const price = priceOf(item);
  const euro = state.currency !== "EUR" && item.price.EUR ? `<small>${esc(money(item.price.EUR, "EUR"))}; the exact amount is on 1stDibs</small>` : "";
  $("[data-piece-price]").innerHTML = `${esc(money(price))}${euro}<span class="piece__delivery">Worldwide delivery included</span>`;
  $("[data-piece-link]").href = item.url;
  const keep = $("[data-piece-keep]");
  const kept = shortlist.includes(item.id);
  keep.setAttribute("aria-pressed", String(kept));
  keep.textContent = kept ? "Kept on shortlist" : "Keep on shortlist";
  keep.dataset.keep = item.id;

  const facts = [
    ["Date", [item.date, item.period].filter(Boolean).join(" · ")],
    ["Maker", item.maker],
    ["Style", item.style],
    ["Origin", item.origin],
    ["Materials", item.materials?.join(", ")],
    ["Condition", item.condition],
    ["Dimensions", [item.dimensions?.cm, item.dimensions?.in].filter(Boolean).join("<br>")],
    ["1stDibs ref.", item.id.replace("f_", "")],
  ].filter(([, v]) => v);
  $("[data-piece-facts]").innerHTML = facts
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${k === "Dimensions" ? v : esc(v)}</dd></div>`)
    .join("");
  const detail = DETAILS?.[item.id];
  const description = detail?.description || item.excerpt || "";
  const condition = detail?.conditionNotes ? `<p class="piece__condition"><strong>Condition.</strong> ${esc(detail.conditionNotes)}</p>` : "";
  $("[data-piece-excerpt]").innerHTML = description
    ? `<p>${esc(description)}</p>${condition}<a href="${esc(item.url)}" target="_blank" rel="noopener">More on 1stDibs ↗</a>`
    : `<a href="${esc(item.url)}" target="_blank" rel="noopener">Description and more photos on 1stDibs ↗</a>`;

  const photos = imagesOf(item);
  setPieceImage(activeImage);
  $("[data-piece-thumbs]").innerHTML =
    photos.length > 1
      ? photos
          .map(
            (src, n) =>
              `<button type="button" data-thumb="${n}" aria-pressed="${n === activeImage}" aria-label="Photo ${n + 1}"><img src="${imgUrl(src, 160)}" alt=""></button>`,
          )
          .join("")
      : "";

  const related = ITEMS.filter((o) => o.room === item.room && o.id !== item.id)
    .map((o) => ({ o, score: (o.style === item.style ? 2 : 0) + (o.era === item.era ? 1 : 0) + (o.kind === item.kind ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || b.o._num - a.o._num)
    .slice(0, 6)
    .map(({ o }) => o);
  $("[data-related-title]").textContent = item.style ? `More ${item.style.toLowerCase()} in ${ROOM_LABEL[item.room].toLowerCase()}` : `Also in ${ROOM_LABEL[item.room].toLowerCase()}`;
  $("[data-related]").innerHTML = related
    .map(
      (o) => `<a href="#piece=${o.id}" data-goto-piece="${o.id}">
        <span class="related__plate"><img src="${imgUrl(o.images[0], 320)}" alt="" loading="lazy" decoding="async"></span>
        <span>${esc(o.title)}</span>
      </a>`,
    )
    .join("");
}

function setPieceImage(n) {
  const item = currentPiece;
  const photos = imagesOf(item);
  activeImage = Math.min(n, photos.length - 1);
  const plate = $("[data-piece-plate]");
  plate.classList.remove("is-zoomed");
  plate.classList.toggle("is-photo", activeImage > 0);
  const img = $("[data-piece-img]");
  const src = photos[activeImage];
  img.alt = activeImage === 0 ? item.title : `${item.title}, photo ${activeImage + 1}`;
  img.src = imgUrl(src, 1200);
  img.srcset = srcset(src, [640, 960, 1400, 1800]);
  img.sizes = "(max-width: 900px) 100vw, 58vw";
  $$("[data-thumb]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.thumb) === activeImage)));
}

function stepPiece(delta) {
  const { list, i } = siblings();
  const next = list[i + delta];
  if (next) goToPiece(next.id);
}

// ---------------------------------------------------------------- shortlist

function toggleKeep(id) {
  const had = shortlist.includes(id);
  shortlist = had ? shortlist.filter((x) => x !== id) : shortlist.concat(id);
  store.set("wg:shortlist", shortlist);
  $$(`[data-keep="${id}"]`).forEach((btn) => {
    const inDialog = btn.hasAttribute("data-piece-keep");
    btn.setAttribute("aria-pressed", String(!had));
    btn.textContent = inDialog ? (had ? "Keep on shortlist" : "Kept on shortlist") : had ? "Keep" : "Kept";
  });
  updateShortlistCount(true);
  renderShortlist();
}

function updateShortlistCount(bump = false) {
  const btn = $("[data-open-shortlist]");
  $("[data-shortlist-count]").textContent = shortlist.length;
  btn.classList.toggle("has-items", shortlist.length > 0);
  if (bump && !reducedMotion) {
    btn.classList.remove("bump");
    void btn.offsetWidth;
    btn.classList.add("bump");
  }
}

function shortlistLink() {
  return `${location.origin}${location.pathname}?list=${shortlist.join(",")}`;
}

function renderShortlist() {
  const items = shortlist.map((id) => BY_ID.get(id)).filter(Boolean);
  $("[data-shortlist-empty]").hidden = items.length > 0;
  $("[data-shortlist-foot]").hidden = items.length === 0;
  $("[data-shortlist-items]").innerHTML = items
    .map(
      (item) => `<li>
        <span class="drawer__plate"><img src="${imgUrl(item.images[0], 160)}" alt="" loading="lazy"></span>
        <span><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)} ↗</a>
          <span class="drawer__meta">${esc(money(priceOf(item)))} · ${esc(dateLabel(item))}</span></span>
        <button type="button" class="drawer__remove" data-keep="${item.id}" data-drawer-remove aria-label="Remove ${esc(item.title)}">Remove</button>
      </li>`,
    )
    .join("");
  const body = items.map((i) => `${i.title} (${money(priceOf(i))})\n${i.url}`).join("\n\n");
  $("[data-shortlist-mail]").href =
    `mailto:?subject=${encodeURIComponent("A shortlist from Wassenaar Gallery")}&body=${encodeURIComponent(`${body}\n\nThe whole list: ${shortlistLink()}`)}`;
}

async function copyShortlist() {
  const status = $("[data-shortlist-status]");
  try {
    await navigator.clipboard.writeText(shortlistLink());
    status.textContent = "Link copied. Anyone who opens it sees these pieces.";
  } catch {
    status.textContent = shortlistLink();
  }
}

// ---------------------------------------------------------------- page behaviour

function observeReveals() {
  if (!("IntersectionObserver" in window)) {
    $$("[data-reveal]").forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
  $$("[data-reveal]:not(.is-in)").forEach((el) => io.observe(el));
}

function setFiltersOpen(open) {
  els.refine.hidden = !open;
  const toggle = $("[data-refine-toggle]");
  toggle.setAttribute("aria-expanded", String(open));
  $("[data-refine-label]").textContent = open ? "Hide filters" : "Show filters";
}

function setupMasthead() {
  const head = $("[data-masthead]");
  let lastY = scrollY;
  let ticking = false;
  const update = () => {
    const y = scrollY;
    head.classList.toggle("is-scrolled", y > 8);
    const menuOpen = !$("#mobile-menu").hidden;
    if (!menuOpen && y > 480 && y > lastY + 6) {
      head.classList.add("is-hidden");
      document.body.classList.add("masthead-hidden");
    } else if (y < lastY - 6 || y < 480) {
      head.classList.remove("is-hidden");
      document.body.classList.remove("masthead-hidden");
    }
    lastY = y;
    ticking = false;
  };
  addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  const toggle = $("[data-menu-toggle]");
  const menu = $("#mobile-menu");
  toggle.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Close" : "Menu";
  });
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Menu";
    }
  });
}

function setupRoomPeek() {
  if (!canHover || reducedMotion) return;
  const peek = els.peek;
  const img = $("img", peek);
  let x = 0, y = 0, tx = 0, ty = 0, raf = 0, on = false;
  const loop = () => {
    x += (tx - x) * 0.16;
    y += (ty - y) * 0.16;
    peek.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${(tx - x) * 0.02}deg)`;
    raf = on || Math.abs(tx - x) > 0.5 ? requestAnimationFrame(loop) : 0;
  };
  els.rooms.addEventListener("pointermove", (e) => {
    const row = e.target.closest(".room-row");
    if (!row) return;
    const w = peek.offsetWidth, h = peek.offsetHeight;
    tx = Math.min(innerWidth - w - 16, e.clientX + 28);
    ty = Math.max(16, Math.min(innerHeight - h - 16, e.clientY - h / 2));
    if (!on) {
      x = tx;
      y = ty;
    }
    if (img.dataset.src !== row.dataset.peek) {
      img.dataset.src = row.dataset.peek;
      img.src = row.dataset.peek;
    }
    on = true;
    peek.classList.add("is-on");
    if (!raf) raf = requestAnimationFrame(loop);
  });
  els.rooms.addEventListener("pointerleave", () => {
    on = false;
    peek.classList.remove("is-on");
  });
}

function setupReel() {
  const track = els.reelTrack;
  const step = () => (track.querySelector(".reel__item")?.offsetWidth || 300) * 2;
  $("[data-reel-prev]").addEventListener("click", () => track.scrollBy({ left: -step(), behavior: reducedMotion ? "auto" : "smooth" }));
  $("[data-reel-next]").addEventListener("click", () => track.scrollBy({ left: step(), behavior: reducedMotion ? "auto" : "smooth" }));
}

function setFilterFromString(str) {
  const p = new URLSearchParams(str);
  state.room = "all";
  state.era = null;
  state.styles.clear();
  state.origins.clear();
  state.price = null;
  state.q = "";
  state.list = null;
  const category = p.get("category") || p.get("room");
  if (category) state.room = category;
  if (p.get("era")) state.era = p.get("era");
  renderCollection();
  $("#collection").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
}

function bindEvents() {
  document.addEventListener("click", (e) => {
    const t = e.target;

    const keep = t.closest("[data-keep]");
    if (keep) {
      e.preventDefault();
      toggleKeep(keep.dataset.keep);
      return;
    }
    const setFilter = t.closest("[data-set-filter]");
    if (setFilter) {
      e.preventDefault();
      setFilterFromString(setFilter.dataset.setFilter);
      return;
    }
    const opener = t.closest("[data-open-piece]");
    if (opener) {
      openedFromPage = true; // the anchor itself changes the hash; hashchange opens the piece
      return;
    }
    const goto = t.closest("[data-goto-piece]");
    if (goto) {
      e.preventDefault();
      goToPiece(goto.dataset.gotoPiece);
      return;
    }
    const room = t.closest("[data-room]");
    if (room) {
      state.room = room.dataset.room;
      renderCollection();
      return;
    }
    const era = t.closest("[data-era]");
    if (era && !era.disabled) {
      state.era = state.era === era.dataset.era ? null : era.dataset.era;
      renderCollection();
      return;
    }
    const chip = t.closest("[data-style], [data-origin]");
    if (chip) {
      const set = chip.dataset.style != null ? state.styles : state.origins;
      const value = chip.dataset.style ?? chip.dataset.origin;
      set.has(value) ? set.delete(value) : set.add(value);
      renderCollection();
      return;
    }
    if (t.closest("[data-more-styles]")) {
      showAllStyles = true;
      renderRefine();
      return;
    }
    if (t.closest("[data-more-origins]")) {
      showAllOrigins = true;
      renderRefine();
      return;
    }
    const price = t.closest("[data-price]");
    if (price) {
      state.price = state.price === price.dataset.price ? null : price.dataset.price;
      renderCollection();
      return;
    }
    const remove = t.closest("[data-remove]");
    if (remove) {
      const { remove: key, value } = remove.dataset;
      if (key === "room") state.room = "all";
      if (key === "era") state.era = null;
      if (key === "style") state.styles.delete(value);
      if (key === "origin") state.origins.delete(value);
      if (key === "price") state.price = null;
      if (key === "q") state.q = "";
      renderCollection();
      return;
    }
    if (t.closest("[data-clear-all]")) {
      setFilterFromString("");
      return;
    }
    const view = t.closest("[data-view]");
    if (view && view.tagName === "BUTTON") {
      state.view = view.dataset.view;
      renderCollection({ keepScroll: true, animate: false });
      return;
    }
    const currency = t.closest("[data-currency]");
    if (currency) {
      state.currency = currency.dataset.currency;
      store.set("wg:currency", state.currency);
      $$("[data-currency]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.currency === state.currency)));
      renderPrices();
      return;
    }
    if (t.closest("[data-adopt-list]")) {
      for (const id of state.list) if (!shortlist.includes(id)) shortlist.push(id);
      store.set("wg:shortlist", shortlist);
      updateShortlistCount(true);
      renderShortlist();
      renderCollection({ keepScroll: true, animate: false });
      return;
    }
    if (t.closest("[data-leave-list]")) {
      state.list = null;
      renderCollection();
      return;
    }
  });

  // The first page ends with a button, so Buying and About stay reachable by scrolling.
  // Once someone asks for more, further pages load as they scroll, up to a limit.
  let wantsMore = false;
  els.more.addEventListener("click", () => {
    wantsMore = true;
    appendMore();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        if (wantsMore && entries[0].isIntersecting && state.shown < AUTO_LOAD_LIMIT && state.shown < state.results.length) appendMore();
      },
      { rootMargin: "600px 0px" },
    ).observe(els.moreWrap);
  }

  // Second photo loads only when someone actually hovers a card.
  els.grid.addEventListener("pointerover", (e) => {
    const card = e.target.closest(".card");
    const alt = card && $(".card__alt[data-src]", card);
    if (!alt) return;
    alt.src = alt.dataset.src;
    alt.removeAttribute("data-src");
    alt.addEventListener("load", () => alt.classList.add("is-loaded"), { once: true });
  });

  const onSearch = debounce(() => {
    state.q = els.search.value.trim();
    renderCollection({ animate: false });
  }, 180);
  els.search.addEventListener("input", onSearch);
  // Searching also looks through the full descriptions, which load on first use.
  els.search.addEventListener("focus", () => loadDetails().then(() => state.q && renderCollection({ keepScroll: true, animate: false })), { once: true });
  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    renderCollection();
  });

  $("[data-refine-toggle]").addEventListener("click", () => setFiltersOpen(els.refine.hidden));
  setFiltersOpen(matchMedia("(min-width: 900px)").matches);

  // piece dialog
  addEventListener("hashchange", onHashChange);
  $("[data-piece-close]").addEventListener("click", closePiece);
  els.piece.addEventListener("cancel", (e) => {
    e.preventDefault();
    closePiece();
  });
  // Browsers may close a modal on their own (e.g. repeated Escape); tidy up after it.
  els.piece.addEventListener("close", () => {
    document.documentElement.style.overflow = "";
    if (pieceIdFromHash()) history.replaceState(history.state, "", location.pathname + location.search);
    currentPiece = null;
  });
  $("[data-piece-prev]").addEventListener("click", () => stepPiece(-1));
  $("[data-piece-next]").addEventListener("click", () => stepPiece(1));
  els.piece.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowLeft") stepPiece(-1);
    if (e.key === "ArrowRight") stepPiece(1);
  });
  $("[data-piece-thumbs]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-thumb]");
    if (b) setPieceImage(Number(b.dataset.thumb));
  });
  $("[data-piece-plate]").addEventListener("click", (e) => {
    const plate = e.currentTarget;
    const img = $("img", plate);
    const r = plate.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    plate.classList.toggle("is-zoomed");
  });

  // shortlist drawer
  const drawer = els.drawer;
  $("[data-open-shortlist]").addEventListener("click", () => {
    renderShortlist();
    $("[data-shortlist-status]").textContent = "";
    drawer.showModal();
  });
  $("[data-shortlist-close]").addEventListener("click", () => drawer.close());
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) drawer.close();
  });
  $("[data-shortlist-share]").addEventListener("click", copyShortlist);
}

// ---------------------------------------------------------------- start

async function start() {
  els.grid = $("[data-grid]");
  els.count = $("[data-result-count]");
  els.empty = $("[data-empty]");
  els.more = $("[data-more]");
  els.moreWrap = $("[data-more-wrap]");
  els.roomTabs = $("[data-room-tabs]");
  els.toolbar = $("[data-toolbar]");
  els.refine = $("[data-refine]");
  els.refineCount = $("[data-refine-count]");
  els.eraStrip = $("[data-era-strip]");
  els.styleChips = $("[data-style-chips]");
  els.originChips = $("[data-origin-chips]");
  els.priceChips = $("[data-price-chips]");
  els.active = $("[data-active-filters]");
  els.sharedNote = $("[data-shared-note]");
  els.search = $("[data-search]");
  els.sort = $("[data-sort]");
  els.salon = $("[data-salon]");
  els.rooms = $("[data-rooms]");
  els.peek = $("[data-rooms-peek]");
  els.reelTrack = $("[data-reel-track]");
  els.shelf = $("[data-shelf]");
  els.piece = $("[data-piece]");
  els.drawer = $("[data-shortlist]");

  setupMasthead();
  observeReveals();

  try {
    const [feed, curation] = await Promise.all([
      fetch("data/listings.json").then((r) => {
        if (!r.ok) throw new Error(`listings.json: HTTP ${r.status}`);
        return r.json();
      }),
      fetch("data/curation.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    FEED = feed;
    CURATION = curation;
  } catch (err) {
    console.error(err);
    els.count.innerHTML = `The collection could not be loaded just now. Every piece is also in <a href="${SHOP_URL}shop/">our 1stDibs shop</a>.`;
    return;
  }

  ROOM_LABEL = Object.fromEntries(FEED.rooms.map((r) => [r.id, r.label]));
  ERA_LABEL = Object.fromEntries(FEED.eras.map((e) => [e.id, e.label]));
  ITEMS = FEED.items.filter((i) => !i.sold && i.images?.length);
  for (const item of ITEMS) {
    item._num = Number(item.id.replace(/\D/g, "")) || 0;
    item._cut = /bg_processed/.test(item.images[0]);
    item._hang = item.room === "lighting" && HANGING_KINDS.has(item.kind);
    item._text = fold([item.title, item.subtitle, item.kind, ROOM_LABEL[item.room], item.style, item.origin, item.period, item.year, item.maker, item.materials?.join(" "), item.excerpt].join(" "));
  }
  BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
  const roomSize = tally((i) => i.room);
  FEED.rooms.sort((a, b) => (roomSize.get(b.id) || 0) - (roomSize.get(a.id) || 0));

  state.currency = defaultCurrency();
  $$("[data-currency]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.currency === state.currency)));
  shortlist = store.get("wg:shortlist", []).filter((id) => BY_ID.has(id));
  updateShortlistCount();

  readUrl();
  renderStatic();
  renderSalon();
  renderRooms();
  renderReel();
  renderShelf();
  renderCollection({ animate: false });
  renderShortlist();
  bindEvents();
  setupRoomPeek();
  setupReel();
  observeReveals();

  if (pieceIdFromHash()) showPiece(pieceIdFromHash());
  if (state.list || new URLSearchParams(location.search).toString()) {
    requestAnimationFrame(() => $("#collection").scrollIntoView());
  }
}

start();
