/* ==========================================================================
   Brew Log — lightweight coffee & recipe tracker
   Vanilla JS, localStorage persistence, no build step.
   ========================================================================== */

(function () {
  "use strict";

  /* ----------------------------- Storage ---------------------------------- */
  const KEY = "brewlog.v1";

  const DEFAULT_GEAR = {
    // grinders carry a grind scale/format, since values differ per grinder
    grinders: [
      { name: "1Zpresso J-Ultra", unit: "x.x.x" },
      { name: "Femobook A4Z", unit: "x.x.x" },
    ],
    espressoMachines: ["Gaggia E24"],
    baskets: ["BEP 2.0", "Pesado", "Panda concave"],
    brewers: ["Glass V60 Switch", "V60 Neo", "Orea O1 (plastic)", "Origami (ceramic)", "Cafe Deep 27"],
    filters: ["Hario V60", "Cafec T90 (med-dark)"],
  };

  const DEFAULT_DATA = {
    beans: [],
    espresso: [],
    pourover: [],
    gear: DEFAULT_GEAR,
  };

  // Web Crypto is only available in a secure context (https or localhost).
  const SUBTLE = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;

  let DB = null;          // in-memory journal (null while locked)
  let cryptoKey = null;   // derived AES key, held only in memory while unlocked
  let encSalt = null;     // Uint8Array salt (persisted inside the envelope)
  let encEnabled = false; // true when a passcode is set

  function normGrinder(g) {
    return typeof g === "string" ? { name: g, unit: "" } : { name: g.name || "", unit: g.unit || "" };
  }

  function normalize(parsed) {
    const gear = Object.assign(structuredClone(DEFAULT_GEAR), parsed.gear || {});
    gear.grinders = (gear.grinders || []).map(normGrinder).filter((g) => g.name);
    return {
      beans: parsed.beans || [],
      espresso: parsed.espresso || [],
      pourover: parsed.pourover || [],
      gear,
    };
  }

  // grinder helpers — names for dropdowns, unit/scale for grind hints
  const grinderNames = () => DB.gear.grinders.map((g) => g.name);
  const grinderUnit = (name) => {
    const g = DB.gear.grinders.find((x) => x.name === name);
    return g ? g.unit : "";
  };
  function grindPlaceholder(name) {
    const u = name && grinderUnit(name);
    return u ? `e.g. ${u}` : "grind setting";
  }
  function grindHintText(name) {
    if (!name) return "Tip: pick a grinder to see its grind scale.";
    const u = grinderUnit(name);
    return u ? `${name} scale: ${u}` : `No scale set for ${name} — add one in Gear → Grinders.`;
  }
  function grindField(d) {
    return `<div class="field"><label for="f_grindSetting">Grind setting</label>
      <input type="text" id="f_grindSetting" data-f="grindSetting" value="${esc(d.grindSetting || "")}" placeholder="${esc(grindPlaceholder(d.grinder))}" />
      <div class="hint" id="grindUnitHint">${esc(grindHintText(d.grinder))}</div></div>`;
  }

  function readRaw() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("Failed to read storage", e);
      return null;
    }
  }

  // Plaintext writes are synchronous; encrypted writes are serialized so
  // rapid saves can't race / interleave.
  let saveChain = Promise.resolve();
  function save() {
    if (encEnabled && cryptoKey) {
      saveChain = saveChain.then(async () => {
        const env = await encryptData(cryptoKey, DB, encSalt);
        localStorage.setItem(KEY, JSON.stringify(env));
      }).catch((e) => console.error("Persist failed", e));
      return saveChain;
    }
    localStorage.setItem(KEY, JSON.stringify(DB));
    return Promise.resolve();
  }

  /* -------- passcode crypto (PBKDF2 + AES-GCM, fully client-side) -------- */
  function b64(bytes) {
    let s = "";
    bytes.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  }
  function ub64(str) {
    const bin = atob(str);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  async function deriveKey(pass, salt) {
    const base = await SUBTLE.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return SUBTLE.deriveKey(
      { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function encryptData(key, obj, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await SUBTLE.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { __enc: 1, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function decryptData(key, env) {
    const pt = await SUBTLE.decrypt({ name: "AES-GCM", iv: ub64(env.iv) }, key, ub64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* ----------------------------- Helpers ---------------------------------- */
  const $ = (sel, el = document) => el.querySelector(sel);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayStr = () => new Date().toISOString().slice(0, 10);

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function daysSince(iso) {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return null;
    return Math.round((Date.now() - d.getTime()) / 86400000);
  }

  function ratio(inG, outG) {
    const a = parseFloat(inG), b = parseFloat(outG);
    if (!a || !b) return "—";
    return "1:" + (b / a).toFixed(1);
  }

  function starsHtml(n) {
    n = Number(n) || 0;
    let h = "";
    for (let i = 1; i <= 5; i++) h += i <= n ? "★" : '<span class="empty">★</span>';
    return '<span class="stars">' + h + "</span>";
  }

  function toast(msg) {
    let t = $("#toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  const ROAST_LEVELS = ["Light", "Light-Med", "Medium", "Med-Dark", "Dark"];

  /* ----------------------------- App State -------------------------------- */
  const TABS = {
    beans: { label: "Beans", coll: "beans", singular: "Bean" },
    espresso: { label: "Espresso", coll: "espresso", singular: "Espresso Recipe" },
    pourover: { label: "Pour Over", coll: "pourover", singular: "Pour Over Recipe" },
    gear: { label: "Gear & Settings", coll: null, singular: null },
  };

  const state = {
    tab: "beans",
    view: "list", // list | detail | form
    id: null,
    search: "",
    sort: "recent",
    filterFav: false,
    formDraft: null, // working object during edit
  };

  /* ----------------------------- Routing ---------------------------------- */
  function go(tab, view = "list", id = null) {
    state.tab = tab;
    state.view = view;
    state.id = id;
    state.search = "";
    $("#searchBar").hidden = true;
    $("#searchInput").value = "";
    render();
  }

  function render() {
    const view = $("#view");
    const t = TABS[state.tab];

    // header / nav chrome
    $("#backBtn").hidden = state.view === "list";
    $("#searchToggle").hidden = !(state.view === "list" && state.tab !== "gear");
    $("#fab").hidden = !(state.view === "list" && state.tab !== "gear");

    document.querySelectorAll(".tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === state.tab)
    );

    if (state.view === "list") {
      $("#appTitle").textContent = state.tab === "gear" ? "Gear & Settings" : t.label;
      view.innerHTML = state.tab === "gear" ? renderGear() : renderList();
    } else if (state.view === "detail") {
      view.innerHTML = renderDetail();
    } else if (state.view === "form") {
      $("#appTitle").textContent = (state.id ? "Edit " : "New ") + t.singular;
      view.innerHTML = renderForm();
      afterFormRender();
    }
    view.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* =========================================================================
     LIST VIEWS
     ========================================================================= */
  function getItems() {
    const coll = TABS[state.tab].coll;
    let items = (DB[coll] || []).slice();

    if (state.filterFav) items = items.filter((x) => x.favorite);

    const q = state.search.trim().toLowerCase();
    if (q) {
      items = items.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
    }

    items.sort((a, b) => {
      if (state.sort === "rating") return (b.rating || 0) - (a.rating || 0);
      if (state.sort === "name") return (nameOf(a) || "").localeCompare(nameOf(b) || "");
      // recent (by created/updated)
      return (b.updated || b.created || 0) - (a.updated || a.created || 0);
    });
    return items;
  }

  function nameOf(item) {
    return item.name || item.title || "";
  }

  function renderList() {
    const items = getItems();
    const t = TABS[state.tab];

    const toolbar = `
      <div class="toolbar">
        <select id="sortSel">
          <option value="recent"${state.sort === "recent" ? " selected" : ""}>Most recent</option>
          <option value="rating"${state.sort === "rating" ? " selected" : ""}>Top rated</option>
          <option value="name"${state.sort === "name" ? " selected" : ""}>Name A–Z</option>
        </select>
        <button class="chip${state.filterFav ? " active" : ""}" id="favChip">★ Favorites</button>
      </div>`;

    const cards = items.length ? listBodyHtml(items) : emptyState(t);

    return `
      <div class="section-head">
        <h2>${esc(t.label)}</h2>
        <span class="count-pill">${items.length} ${items.length === 1 ? "entry" : "entries"}</span>
      </div>
      ${toolbar}
      <div id="listBody">${cards}</div>`;
  }

  // Beans render as a flat list; recipes are grouped by their linked bean so
  // every log for the same bean sits together for easy review.
  function listBodyHtml(items) {
    if (state.tab === "beans") return items.map(beanCard).join("");
    return groupedRecipeHtml(items, state.tab);
  }

  function groupedRecipeHtml(items, kind) {
    const groups = new Map();
    items.forEach((r) => {
      const key = r.beanId || "__none__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const rank = (recs, key) => {
      if (state.sort === "name") return key === "__none__" ? "￿" : (beanName(key) || "￿").toLowerCase();
      if (state.sort === "rating") return -Math.max(...recs.map((x) => x.rating || 0));
      return -Math.max(...recs.map((x) => x.updated || x.created || 0)); // recent
    };
    const ordered = [...groups.entries()].sort((a, b) => {
      // recipes with no bean always sink to the bottom
      if (a[0] === "__none__") return 1;
      if (b[0] === "__none__") return -1;
      const ra = rank(a[1], a[0]), rb = rank(b[1], b[0]);
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
    return ordered.map(([key, recs]) => {
      const name = key === "__none__" ? "No bean linked" : (beanName(key) || "Unknown bean");
      return `<div class="recipe-group">
        <div class="group-head"><span class="group-name">🫘 ${esc(name)}</span><span class="group-count">${recs.length}</span></div>
        ${recs.map((r) => recipeCard(r, kind, true)).join("")}
      </div>`;
    }).join("");
  }

  function emptyState(t) {
    const icon = { beans: "🫘", espresso: "☕", pourover: "🫗" }[state.tab];
    return `<div class="empty-state">
      <span class="big">${icon}</span>
      <p>No ${esc(t.label.toLowerCase())} yet.</p>
      <p>Tap <b>+</b> to log your first ${esc(t.singular.toLowerCase())}.</p>
    </div>`;
  }

  function beanCard(b) {
    const days = daysSince(b.roastDate);
    const freshness = days != null ? `${days}d off roast` : "";
    const meta = [];
    if (b.roastLevel) meta.push(`<span class="tag roast">${esc(b.roastLevel)}</span>`);
    if (b.process) meta.push(`<span class="tag">${esc(b.process)}</span>`);
    if (b.origin) meta.push(`<span class="tag">${esc(b.origin)}</span>`);
    if (freshness) meta.push(`<span class="tag config">${esc(freshness)}</span>`);
    return `<div class="card" data-id="${b.id}">
      <div class="card-top">
        <div>
          <p class="card-title">${esc(b.name || "Untitled bean")} ${b.favorite ? '<span class="fav-mark">★</span>' : ""}</p>
          <p class="card-sub">${esc(b.roaster || "")}${b.roaster && b.origin ? " · " : ""}${esc(b.variety || "")}</p>
        </div>
        ${b.rating ? starsHtml(b.rating) : ""}
      </div>
      ${b.tastingNotes ? `<p class="card-sub" style="margin-top:8px">${esc(b.tastingNotes)}</p>` : ""}
      ${meta.length ? `<div class="card-meta">${meta.join("")}</div>` : ""}
    </div>`;
  }

  function recipeCard(r, kind, grouped) {
    const meta = [];
    const cfg = [r.grinder, kind === "espresso" ? r.machine : r.brewer, r.filter].filter(Boolean);
    cfg.forEach((c) => meta.push(`<span class="tag config">${esc(c)}</span>`));
    let key;
    if (kind === "espresso") {
      key = `${r.dose || "?"}→${r.yield || "?"}g · ${ratio(r.dose, r.yield)} · ${r.time || "?"}s`;
    } else {
      key = `${r.dose || "?"}g : ${r.water || "?"}g · ${ratio(r.dose, r.water)}`;
    }
    return `<div class="card" data-id="${r.id}">
      <div class="card-top">
        <div>
          <p class="card-title">${esc(r.title || beanName(r.beanId) || "Untitled recipe")} ${r.favorite ? '<span class="fav-mark">★</span>' : ""}</p>
          <p class="card-sub">${esc(key)}</p>
        </div>
        ${r.rating ? starsHtml(r.rating) : ""}
      </div>
      ${!grouped && r.beanId && r.title ? `<p class="card-sub" style="margin-top:6px">🫘 ${esc(beanName(r.beanId))}</p>` : ""}
      ${meta.length ? `<div class="card-meta">${meta.join("")}</div>` : ""}
    </div>`;
  }

  function beanName(id) {
    const b = DB.beans.find((x) => x.id === id);
    return b ? b.name : "";
  }

  /* =========================================================================
     DETAIL VIEWS
     ========================================================================= */
  function findCurrent() {
    return (DB[TABS[state.tab].coll] || []).find((x) => x.id === state.id);
  }

  function renderDetail() {
    const item = findCurrent();
    if (!item) return `<div class="empty-state">Not found.</div>`;
    if (state.tab === "beans") return beanDetail(item);
    return recipeDetail(item, state.tab);
  }

  function spec(k, v, full) {
    if (v === undefined || v === null || v === "" ) return "";
    return `<div class="spec${full ? " full" : ""}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
  }

  function noteBlock(title, text, cls) {
    if (!text) return "";
    return `<div class="note-block ${cls || ""}"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }

  function detailActions() {
    return `<div class="detail-actions">
      <button class="btn btn-ghost" id="dupBtn">Duplicate</button>
      <button class="btn btn-primary" id="editBtn">Edit</button>
    </div>
    <button class="btn btn-danger" id="delBtn" style="margin-top:12px">Delete</button>`;
  }

  function beanDetail(b) {
    $("#appTitle").textContent = "Bean";
    const days = daysSince(b.roastDate);
    const cup = b.cupping || {};
    const cupKeys = [
      ["Aroma", cup.aroma], ["Acidity", cup.acidity], ["Sweetness", cup.sweetness],
      ["Body", cup.body], ["Balance", cup.balance], ["Aftertaste", cup.aftertaste],
    ].filter(([, v]) => v != null && v !== "");

    const cupBars = cupKeys.length ? `<div class="note-block"><h3>My Cupping Scores</h3><div class="cup-bars">${
      cupKeys.map(([k, v]) => `<div class="cup-bar"><span class="lbl">${k}</span><span class="track"><span class="fill" style="width:${(v / 10) * 100}%"></span></span><span class="num">${v}</span></div>`).join("")
    }</div></div>` : "";

    const linkedEsp = DB.espresso.filter((r) => r.beanId === b.id);
    const linkedPo = DB.pourover.filter((r) => r.beanId === b.id);
    const linkedSection = (title, recs, kind) => {
      if (!recs.length) return "";
      const rows = recs
        .sort((a, c) => (c.updated || c.created || 0) - (a.updated || a.created || 0))
        .map((r) => {
          const key = kind === "espresso"
            ? `${r.dose || "?"}→${r.yield || "?"}g · ${ratio(r.dose, r.yield)} · ${r.time || "?"}s`
            : `${r.dose || "?"}:${r.water || "?"} · ${ratio(r.dose, r.water)}`;
          return `<div class="linked-rec" data-rkind="${kind}" data-rid="${r.id}">
            <div class="lr-main"><span class="lr-title">${esc(r.title || "Untitled recipe")}</span>
            <span class="lr-key">${esc(key)}</span></div>
            ${r.rating ? starsHtml(r.rating) : ""}</div>`;
        }).join("");
      return `<div class="note-block"><h3>${esc(title)} (${recs.length})</h3>${rows}</div>`;
    };

    return `
      <div class="detail-hero">
        <h2>${esc(b.name || "Untitled bean")} ${b.favorite ? '<span class="fav-mark">★</span>' : ""}</h2>
        <p class="sub">${esc(b.roaster || "")}</p>
        ${b.rating ? starsHtml(b.rating) : ""}
      </div>
      <div class="spec-grid">
        ${spec("Roast Level", b.roastLevel)}
        ${spec("Type", b.type)}
        ${spec("Origin", b.origin)}
        ${spec("Variety", b.variety)}
        ${spec("Process", b.process)}
        ${spec("Altitude", b.altitude)}
        ${spec("Roast Date", b.roastDate ? fmtDate(b.roastDate) + (days != null ? ` (${days}d)` : "") : "")}
        ${spec("Price", b.price)}
        ${spec("Weight", b.weight)}
      </div>
      ${noteBlock("Roaster's Tasting Notes", b.tastingNotes)}
      ${noteBlock("My Tasting Notes", b.myNotes)}
      ${cupBars}
      ${noteBlock("Experience & Observations", b.experience)}
      ${linkedSection("Espresso recipes", linkedEsp, "espresso")}
      ${linkedSection("Pour over recipes", linkedPo, "pourover")}
      ${detailActions()}`;
  }

  function recipeDetail(r, kind) {
    $("#appTitle").textContent = kind === "espresso" ? "Espresso Recipe" : "Pour Over Recipe";
    const isEsp = kind === "espresso";
    const ratioStr = isEsp ? ratio(r.dose, r.yield) : ratio(r.dose, r.water);

    let specs = "";
    specs += spec("Grinder", r.grinder);
    specs += spec("Grind Setting", r.grindSetting);
    specs += spec(isEsp ? "Machine" : "Brewer", isEsp ? r.machine : r.brewer);
    if (!isEsp) specs += spec("Filter", r.filter);
    specs += spec("Dose", r.dose ? r.dose + " g" : "");
    specs += spec(isEsp ? "Yield" : "Water", isEsp ? (r.yield ? r.yield + " g" : "") : (r.water ? r.water + " g" : ""));
    specs += spec("Ratio", ratioStr !== "—" ? ratioStr : "");
    specs += spec("Water Temp", r.temp ? r.temp + " °C" : "");

    if (isEsp) {
      specs += spec("Shot Time", r.time ? r.time + " s" : "");
      specs += spec("Basket", r.basket);
      specs += spec("Pre-infusion", r.preinfusion);
      specs += spec("Pressure", r.pressure);
    } else {
      specs += spec("Bloom", r.bloomWater ? `${r.bloomWater} g / ${r.bloomTime || "?"} s` : "");
      specs += spec("Total Time", r.totalTime);
      specs += spec("Drawdown", r.drawdown);
    }
    if (r.tds) specs += spec("TDS / EY", r.tds);

    const pours = (r.pours && r.pours.length)
      ? `<div class="note-block"><h3>Pour Schedule</h3><ul class="pour-steps">${
          r.pours.map((p, i) => {
            const o = normPour(p);
            const bits = [];
            if (o.water) bits.push(`${esc(o.water)} g`);
            if (o.time) bits.push(`@ ${esc(o.time)}`);
            if (o.temp) bits.push(`${esc(o.temp)}°C`);
            const main = bits.join(" · ") || "—";
            return `<li><span class="n">${i + 1}</span><span class="ps-body"><span class="ps-main">${main}</span>${o.note ? `<span class="ps-note">${esc(o.note)}</span>` : ""}</span></li>`;
          }).join("")
        }</ul></div>`
      : "";

    return `
      <div class="detail-hero">
        <h2>${esc(r.title || beanName(r.beanId) || "Untitled recipe")} ${r.favorite ? '<span class="fav-mark">★</span>' : ""}</h2>
        ${r.beanId ? `<p class="sub">🫘 ${esc(beanName(r.beanId))}</p>` : ""}
        ${r.rating ? starsHtml(r.rating) : ""}
      </div>
      <div class="spec-grid">${specs}</div>
      ${pours}
      ${!isEsp ? noteBlock("Agitation / Technique", r.agitation) : noteBlock("Puck Prep", r.puckPrep)}
      ${noteBlock("Tasting Notes", r.tasting)}
      ${noteBlock("What to improve next time", r.improve, "improve")}
      ${noteBlock("Notes", r.notes)}
      ${r.date ? `<p class="card-sub" style="text-align:center;margin-top:6px">Brewed ${fmtDate(r.date)}</p>` : ""}
      ${detailActions()}`;
  }

  /* =========================================================================
     FORMS
     ========================================================================= */
  function blankFor(tab) {
    if (tab === "beans") return { id: null, favorite: false, rating: 0, roastLevel: "Medium", cupping: {} };
    if (tab === "espresso") return { id: null, favorite: false, rating: 0, date: todayStr(), pours: [] };
    return { id: null, favorite: false, rating: 0, date: todayStr(), pours: [] };
  }

  function startForm(id) {
    const coll = TABS[state.tab].coll;
    if (id) {
      const orig = DB[coll].find((x) => x.id === id);
      state.formDraft = structuredClone(orig);
    } else {
      state.formDraft = blankFor(state.tab);
    }
    go(state.tab, "form", id);
  }

  function renderForm() {
    if (state.tab === "beans") return beanForm(state.formDraft);
    if (state.tab === "espresso") return espressoForm(state.formDraft);
    return pouroverForm(state.formDraft);
  }

  // field builders -------------------------------------------------------
  function fText(name, label, val, opts = {}) {
    return `<div class="field"><label for="f_${name}">${esc(label)}</label>
      <input type="${opts.type || "text"}" id="f_${name}" data-f="${name}" value="${esc(val == null ? "" : val)}"
        ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ""}
        ${opts.step ? `step="${opts.step}"` : ""} ${opts.inputmode ? `inputmode="${opts.inputmode}"` : ""} />
      ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ""}</div>`;
  }
  function fArea(name, label, val, ph) {
    return `<div class="field"><label for="f_${name}">${esc(label)}</label>
      <textarea id="f_${name}" data-f="${name}" placeholder="${esc(ph || "")}">${esc(val || "")}</textarea></div>`;
  }
  function fSelect(name, label, val, options, opts = {}) {
    const blank = opts.allowBlank ? `<option value="">${esc(opts.blankLabel || "—")}</option>` : "";
    return `<div class="field"><label for="f_${name}">${esc(label)}</label>
      <select id="f_${name}" data-f="${name}">${blank}${
        options.map((o) => `<option value="${esc(o)}"${o === val ? " selected" : ""}>${esc(o)}</option>`).join("")
      }</select></div>`;
  }
  function fStars(val) {
    let s = "";
    for (let i = 1; i <= 5; i++) s += `<span data-star="${i}" class="${i <= (val || 0) ? "on" : ""}">★</span>`;
    return `<div class="field"><label>Rating</label><div class="star-input" id="starInput">${s}</div></div>`;
  }
  function fFav(val) {
    return `<div class="field"><label class="chk-line" style="text-transform:none;display:flex;align-items:center;gap:10px;cursor:pointer">
      <input type="checkbox" data-f="favorite" ${val ? "checked" : ""} style="width:20px;height:20px"/> Mark as favorite ★</label></div>`;
  }
  function fRoast(val) {
    return `<div class="field"><label>Roast Level</label><div class="segmented" id="roastSeg">${
      ROAST_LEVELS.map((r) => `<button type="button" data-roast="${esc(r)}" class="${r === val ? "on" : ""}">${esc(r)}</button>`).join("")
    }</div></div>`;
  }
  function fSlider(name, label, val) {
    val = val == null || val === "" ? 5 : val;
    return `<div class="slider-field"><div class="slabel"><span>${esc(label)}</span><b id="sv_${name}">${val}</b></div>
      <input type="range" min="0" max="10" step="1" data-cup="${name}" value="${val}" /></div>`;
  }

  function beanForm(d) {
    return `<form class="form" id="entryForm">
      ${fText("name", "Coffee name", d.name, { placeholder: "e.g. Ethiopia Guji Natural" })}
      ${fText("roaster", "Roaster", d.roaster, { placeholder: "e.g. Onyx, Sey, local roaster" })}
      ${fRoast(d.roastLevel)}
      <div class="row">
        ${fText("origin", "Origin", d.origin, { placeholder: "Country / region" })}
        ${fText("variety", "Variety", d.variety, { placeholder: "e.g. Gesha, Caturra" })}
      </div>
      <div class="row">
        ${fSelect("type", "Type", d.type, ["Single Origin", "Blend"], { allowBlank: true })}
        ${fSelect("process", "Process", d.process, ["Washed", "Natural", "Honey", "Anaerobic", "Carbonic Maceration", "Other"], { allowBlank: true })}
      </div>
      ${fArea("tastingNotes", "Roaster's tasting notes", d.tastingNotes, "Notes printed on the bag")}
      ${fStars(d.rating)}
      <details class="fieldset"><summary>My evaluation</summary><div class="fieldset-body">
        ${fArea("myNotes", "My tasting notes", d.myNotes, "What you actually taste")}
        ${fSlider("aroma", "Aroma", (d.cupping || {}).aroma)}
        ${fSlider("acidity", "Acidity", (d.cupping || {}).acidity)}
        ${fSlider("sweetness", "Sweetness", (d.cupping || {}).sweetness)}
        ${fSlider("body", "Body", (d.cupping || {}).body)}
        ${fSlider("balance", "Balance", (d.cupping || {}).balance)}
        ${fSlider("aftertaste", "Aftertaste", (d.cupping || {}).aftertaste)}
        ${fArea("experience", "Experience & observations", d.experience, "How it evolved off roast, brew tips, etc.")}
      </div></details>
      <details class="fieldset"><summary>Purchase details</summary><div class="fieldset-body">
        <div class="row">
          ${fText("roastDate", "Roast date", d.roastDate, { type: "date" })}
          ${fText("altitude", "Altitude", d.altitude, { placeholder: "e.g. 1900 masl" })}
        </div>
        <div class="row">
          ${fText("price", "Price", d.price, { placeholder: "e.g. $22" })}
          ${fText("weight", "Weight", d.weight, { placeholder: "e.g. 250g" })}
        </div>
      </div></details>
      ${fFav(d.favorite)}
      <button type="button" class="btn btn-primary" id="saveBtn">Save Bean</button>
    </form>`;
  }

  function beanOptions(sel) {
    return `<div class="field"><label for="f_beanId">Bean</label>
      <select id="f_beanId" data-f="beanId">
        <option value="">— select bean —</option>
        ${DB.beans.map((b) => `<option value="${b.id}"${b.id === sel ? " selected" : ""}>${esc(b.name)}${b.roaster ? " · " + esc(b.roaster) : ""}</option>`).join("")}
      </select></div>`;
  }

  function espressoForm(d) {
    const g = DB.gear;
    return `<form class="form" id="entryForm">
      ${fText("title", "Recipe name", d.title, { placeholder: "Optional, e.g. 'Onyx Geometry shot'" })}
      ${beanOptions(d.beanId)}
      <details class="fieldset" open><summary>Equipment</summary><div class="fieldset-body">
        ${fSelect("grinder", "Grinder", d.grinder, grinderNames(), { allowBlank: true })}
        ${grindField(d)}
        ${fSelect("machine", "Machine", d.machine, g.espressoMachines, { allowBlank: true })}
        ${fSelect("basket", "Basket", d.basket, g.baskets, { allowBlank: true })}
      </div></details>
      <details class="fieldset" open><summary>Recipe</summary><div class="fieldset-body">
        <div class="row">
          ${fText("dose", "Dose (g)", d.dose, { type: "number", step: "0.1", inputmode: "decimal", placeholder: "18" })}
          ${fText("yield", "Yield (g)", d.yield, { type: "number", step: "0.1", inputmode: "decimal", placeholder: "36" })}
        </div>
        <div class="computed">Ratio <span class="val" id="ratioOut">${ratio(d.dose, d.yield)}</span></div>
        <div class="row">
          ${fText("time", "Shot time (s)", d.time, { type: "number", inputmode: "numeric", placeholder: "28" })}
          ${fText("temp", "Temp (°C)", d.temp, { type: "number", step: "0.5", inputmode: "decimal", placeholder: "93" })}
        </div>
      </div></details>
      <details class="fieldset"><summary>Technique & advanced</summary><div class="fieldset-body">
        ${fArea("puckPrep", "Puck prep", d.puckPrep, "WDT, distribution, tamp, screen…")}
        ${fText("preinfusion", "Pre-infusion", d.preinfusion, { placeholder: "e.g. 8s @ 3 bar" })}
        ${fText("pressure", "Pressure", d.pressure, { placeholder: "e.g. 9 bar" })}
        ${fText("tds", "TDS / EY", d.tds, { placeholder: "e.g. 9.1% TDS / 21% EY" })}
      </div></details>
      ${fText("date", "Date brewed", d.date, { type: "date" })}
      ${fStars(d.rating)}
      ${fArea("tasting", "Tasting notes", d.tasting, "Sour? Bitter? Balanced? Flavors?")}
      ${fArea("improve", "What to improve next time", d.improve, "e.g. grind finer, +1°C, longer PI")}
      ${fArea("notes", "Other notes", d.notes, "")}
      ${fFav(d.favorite)}
      <button type="button" class="btn btn-primary" id="saveBtn">Save Recipe</button>
    </form>`;
  }

  function pouroverForm(d) {
    const g = DB.gear;
    return `<form class="form" id="entryForm">
      ${fText("title", "Recipe name", d.title, { placeholder: "Optional, e.g. 'Hoffmann V60 4:6'" })}
      ${beanOptions(d.beanId)}
      <details class="fieldset" open><summary>Equipment</summary><div class="fieldset-body">
        ${fSelect("grinder", "Grinder", d.grinder, grinderNames(), { allowBlank: true })}
        ${grindField(d)}
        ${fSelect("brewer", "Brewer", d.brewer, g.brewers, { allowBlank: true })}
        ${fSelect("filter", "Filter paper", d.filter, g.filters, { allowBlank: true })}
      </div></details>
      <details class="fieldset" open><summary>Recipe</summary><div class="fieldset-body">
        <div class="row">
          ${fText("dose", "Dose (g)", d.dose, { type: "number", step: "0.1", inputmode: "decimal", placeholder: "15" })}
          ${fText("water", "Water (g)", d.water, { type: "number", inputmode: "numeric", placeholder: "250" })}
        </div>
        <div class="computed">Ratio <span class="val" id="ratioOut">${ratio(d.dose, d.water)}</span></div>
        <div class="row">
          ${fText("temp", "Temp (°C)", d.temp, { type: "number", step: "0.5", inputmode: "decimal", placeholder: "94" })}
          ${fText("bloomWater", "Bloom (g)", d.bloomWater, { type: "number", inputmode: "numeric", placeholder: "45" })}
        </div>
        ${fText("bloomTime", "Bloom time (s)", d.bloomTime, { type: "number", inputmode: "numeric", placeholder: "45" })}
        <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--text-soft);margin:4px 0 2px;text-transform:uppercase;letter-spacing:0.4px">Pour schedule</label>
        <div class="hint" style="margin-bottom:8px">Per pour: target water · time · temperature, plus an optional note.</div>
        <div class="pours-list" id="poursList">${(d.pours || []).map(pourRowHtml).join("")}</div>
        <button type="button" class="btn-add-sm" id="addPour">+ Add pour</button>
      </div></details>
      <details class="fieldset"><summary>Technique & advanced</summary><div class="fieldset-body">
        ${fArea("agitation", "Agitation / technique", d.agitation, "Swirl, stir, Rao spin, pour height…")}
        <div class="row">
          ${fText("totalTime", "Total brew time", d.totalTime, { placeholder: "e.g. 2:45" })}
          ${fText("drawdown", "Drawdown", d.drawdown, { placeholder: "e.g. ends 2:30" })}
        </div>
        ${fText("tds", "TDS / EY", d.tds, { placeholder: "e.g. 1.38% TDS / 20.5% EY" })}
      </div></details>
      ${fText("date", "Date brewed", d.date, { type: "date" })}
      ${fStars(d.rating)}
      ${fArea("tasting", "Tasting notes", d.tasting, "Clarity, acidity, sweetness, body…")}
      ${fArea("improve", "What to improve next time", d.improve, "e.g. coarser grind, slower pours")}
      ${fArea("notes", "Other notes", d.notes, "")}
      ${fFav(d.favorite)}
      <button type="button" class="btn btn-primary" id="saveBtn">Save Recipe</button>
    </form>`;
  }

  // Pours may be legacy strings or structured {water,time,temp,note} objects.
  function normPour(p) {
    if (typeof p === "string") return { water: "", time: "", temp: "", note: p };
    return Object.assign({ water: "", time: "", temp: "", note: "" }, p || {});
  }

  function pourRowHtml(p, i) {
    const o = normPour(p);
    return `<div class="pour-card">
      <div class="pour-card-top">
        <span class="idx">${(i || 0) + 1}</span>
        <input type="text" class="pf" data-pf="water" inputmode="decimal" value="${esc(o.water)}" placeholder="to … g" aria-label="Water (g)" />
        <input type="text" class="pf" data-pf="time" value="${esc(o.time)}" placeholder="@ 0:45" aria-label="Time" />
        <input type="text" class="pf" data-pf="temp" inputmode="decimal" value="${esc(o.temp)}" placeholder="94°" aria-label="Temp (°C)" />
        <button type="button" class="del" data-delpour aria-label="Remove pour">×</button>
      </div>
      <input type="text" class="pf pf-note" data-pf="note" value="${esc(o.note)}" placeholder="note — e.g. slow spiral, center pour" aria-label="Note" />
    </div>`;
  }

  function reindexPours() {
    document.querySelectorAll("#poursList .pour-card .idx").forEach((el, i) => (el.textContent = i + 1));
  }

  // wire up interactive form bits ---------------------------------------
  function afterFormRender() {
    const form = $("#entryForm");
    if (!form) return;

    // ratio live update
    const recompute = () => {
      const out = $("#ratioOut");
      if (!out) return;
      const dose = $('[data-f="dose"]').value;
      const second = state.tab === "espresso" ? $('[data-f="yield"]').value : $('[data-f="water"]').value;
      out.textContent = ratio(dose, second);
    };
    form.querySelectorAll('[data-f="dose"],[data-f="yield"],[data-f="water"]').forEach((el) =>
      el.addEventListener("input", recompute)
    );

    // grind hint follows the selected grinder's scale
    const grinderSel = form.querySelector('[data-f="grinder"]');
    if (grinderSel) {
      grinderSel.addEventListener("change", () => {
        const name = grinderSel.value;
        const inp = $("#f_grindSetting");
        if (inp) inp.placeholder = grindPlaceholder(name);
        const hint = $("#grindUnitHint");
        if (hint) hint.textContent = grindHintText(name);
      });
    }

    // stars
    const starWrap = $("#starInput");
    if (starWrap) {
      starWrap.addEventListener("click", (e) => {
        const s = e.target.closest("[data-star]");
        if (!s) return;
        const v = Number(s.dataset.star);
        state.formDraft.rating = state.formDraft.rating === v ? 0 : v;
        starWrap.querySelectorAll("span").forEach((sp) =>
          sp.classList.toggle("on", Number(sp.dataset.star) <= state.formDraft.rating)
        );
      });
    }

    // roast segmented
    const seg = $("#roastSeg");
    if (seg) {
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("[data-roast]");
        if (!b) return;
        state.formDraft.roastLevel = b.dataset.roast;
        seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      });
    }

    // cupping sliders
    form.querySelectorAll("[data-cup]").forEach((el) => {
      el.addEventListener("input", () => {
        const out = $("#sv_" + el.dataset.cup);
        if (out) out.textContent = el.value;
      });
    });

    // pours add/remove
    const addPour = $("#addPour");
    if (addPour) {
      addPour.addEventListener("click", () => {
        const list = $("#poursList");
        const count = list.querySelectorAll(".pour-card").length;
        list.insertAdjacentHTML("beforeend", pourRowHtml({}, count));
        reindexPours();
      });
    }
    const poursList = $("#poursList");
    if (poursList) {
      poursList.addEventListener("click", (e) => {
        if (e.target.matches("[data-delpour]")) {
          e.target.closest(".pour-card").remove();
          reindexPours();
        }
      });
    }
  }

  function collectForm() {
    const d = state.formDraft;
    document.querySelectorAll("#entryForm [data-f]").forEach((el) => {
      if (el.type === "checkbox") d[el.dataset.f] = el.checked;
      else d[el.dataset.f] = el.value.trim();
    });
    // cupping
    const cup = {};
    document.querySelectorAll("#entryForm [data-cup]").forEach((el) => {
      cup[el.dataset.cup] = Number(el.value);
    });
    if (Object.keys(cup).length) d.cupping = cup;
    // pours (structured: water / time / temp / note)
    const poursList = $("#poursList");
    if (poursList) {
      d.pours = Array.from(poursList.querySelectorAll(".pour-card"))
        .map((card) => {
          const o = {};
          card.querySelectorAll("[data-pf]").forEach((inp) => (o[inp.dataset.pf] = inp.value.trim()));
          return o;
        })
        .filter((o) => o.water || o.time || o.temp || o.note);
    }
    return d;
  }

  function saveEntry() {
    const coll = TABS[state.tab].coll;
    const d = collectForm();

    const nameField = state.tab === "beans" ? d.name : (d.title || beanName(d.beanId));
    if (state.tab === "beans" && !d.name) { toast("Add a coffee name"); return; }

    if (d.id) {
      d.updated = Date.now();
      const idx = DB[coll].findIndex((x) => x.id === d.id);
      DB[coll][idx] = d;
    } else {
      d.id = uid();
      d.created = Date.now();
      d.updated = Date.now();
      DB[coll].unshift(d);
    }
    save();
    toast("Saved");
    go(state.tab, "detail", d.id);
  }

  /* =========================================================================
     ACTIONS (duplicate / delete)
     ========================================================================= */
  function duplicateCurrent() {
    const coll = TABS[state.tab].coll;
    const orig = findCurrent();
    const copy = structuredClone(orig);
    copy.id = uid();
    copy.created = Date.now();
    copy.updated = Date.now();
    if (state.tab === "beans") copy.name = (copy.name || "Bean") + " (copy)";
    else copy.title = (copy.title || beanName(copy.beanId) || "Recipe") + " (copy)";
    if (copy.date !== undefined) copy.date = todayStr();
    DB[coll].unshift(copy);
    save();
    toast("Duplicated — edit your new version");
    startForm(copy.id);
  }

  function deleteCurrent() {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    const coll = TABS[state.tab].coll;
    DB[coll] = DB[coll].filter((x) => x.id !== state.id);
    save();
    toast("Deleted");
    go(state.tab, "list");
  }

  /* =========================================================================
     GEAR & SETTINGS
     ========================================================================= */
  const GEAR_GROUPS = [
    { key: "grinders", label: "Grinders", icon: "⚙︎" },
    { key: "espressoMachines", label: "Espresso Machines", icon: "☕" },
    { key: "baskets", label: "Espresso Baskets", icon: "⚪" },
    { key: "brewers", label: "Pour Over Brewers", icon: "🫗" },
    { key: "filters", label: "Filter Papers", icon: "📄" },
  ];

  function renderGear() {
    const groups = GEAR_GROUPS.map((grp) => {
      if (grp.key === "grinders") {
        const rows = DB.gear.grinders.map((g, i) =>
          `<div class="gear-item">
            <span class="name">${esc(g.name)}</span>
            <input class="grinder-unit" data-gunit-idx="${i}" value="${esc(g.unit)}" placeholder="scale e.g. x.x.x" aria-label="Grind scale" />
            <button class="del" data-gear-del="grinders" data-idx="${i}" aria-label="Remove">🗑</button>
          </div>`
        ).join("");
        return `<div class="gear-group">
          <h3>${grp.icon} ${esc(grp.label)}</h3>
          <p class="card-sub" style="margin:-4px 0 8px">Each grinder has its own grind scale (the format shown when logging recipes).</p>
          ${rows || '<p class="card-sub">None yet.</p>'}
          <div class="gear-add">
            <input type="text" id="gearin_grinders" placeholder="Add grinder…" />
            <input type="text" id="gearunit_grinders" placeholder="scale e.g. x.x.x" style="max-width:42%" />
            <button data-gear-add="grinders">Add</button>
          </div>
        </div>`;
      }
      const items = DB.gear[grp.key] || [];
      const rows = items.map((name, i) =>
        `<div class="gear-item"><span class="name">${esc(name)}</span>
          <button class="del" data-gear-del="${grp.key}" data-idx="${i}" aria-label="Remove">🗑</button></div>`
      ).join("");
      return `<div class="gear-group">
        <h3>${grp.icon} ${esc(grp.label)}</h3>
        ${rows || '<p class="card-sub">None yet.</p>'}
        <div class="gear-add">
          <input type="text" id="gearin_${grp.key}" placeholder="Add ${esc(grp.label.toLowerCase().replace(/s$/, ""))}…" />
          <button data-gear-add="${grp.key}">Add</button>
        </div>
      </div>`;
    }).join("");

    const counts = `${DB.beans.length} beans · ${DB.espresso.length} espresso · ${DB.pourover.length} pour over`;

    return `
      <div class="section-head"><h2>Gear</h2></div>
      <p class="card-sub" style="margin-bottom:18px">Items here populate the dropdowns when logging recipes.</p>
      ${groups}
      <div class="settings-block">
        <h3>🔒 Privacy lock</h3>
        ${!SUBTLE
          ? `<p class="muted">A passcode lock needs a secure connection. Open the hosted (https) site to enable it.</p>`
          : encEnabled
            ? `<p class="muted">Passcode is <b>on</b> — your journal is encrypted on this device and the app asks for it on open.</p>
               <button class="btn btn-ghost" id="lockNowBtn">Lock now</button>
               <button class="btn btn-ghost" id="changePassBtn" style="margin-top:10px">Change passcode</button>
               <button class="btn btn-danger" id="removePassBtn" style="margin-top:10px">Remove passcode</button>`
            : `<p class="muted">Set a passcode to lock the app and encrypt your journal on this device. Useful if someone else picks up your phone.</p>
               <button class="btn btn-primary" id="setPassBtn">Set a passcode</button>`}
      </div>
      <div class="settings-block">
        <h3>Your data</h3>
        <p class="muted">${counts}. Everything is stored privately on this device.</p>
        <button class="btn btn-ghost" id="exportBtn">Export backup (JSON)</button>
        <button class="btn btn-ghost" id="importBtn" style="margin-top:10px">Import backup</button>
        <input type="file" id="importFile" accept="application/json" hidden />
        <button class="btn btn-danger" id="clearBtn" style="margin-top:18px">Erase all data</button>
      </div>
      <p class="card-sub" style="text-align:center;margin-top:24px">Brew Log · works offline · add to home screen ☕</p>`;
  }

  function wireGear() {
    const view = $("#view");
    view.addEventListener("click", (e) => {
      const addBtn = e.target.closest("[data-gear-add]");
      if (addBtn) {
        const key = addBtn.dataset.gearAdd;
        const val = $("#gearin_" + key).value.trim();
        if (!val) return;
        DB.gear[key] = DB.gear[key] || [];
        if (key === "grinders") {
          const unit = ($("#gearunit_grinders").value || "").trim();
          DB.gear.grinders.push({ name: val, unit });
        } else {
          DB.gear[key].push(val);
        }
        save();
        render();
        return;
      }
      const delBtn = e.target.closest("[data-gear-del]");
      if (delBtn) {
        const key = delBtn.dataset.gearDel;
        DB.gear[key].splice(Number(delBtn.dataset.idx), 1);
        save();
        render();
        return;
      }
      if (e.target.id === "exportBtn") exportData();
      if (e.target.id === "importBtn") $("#importFile").click();
      if (e.target.id === "clearBtn") clearData();
      if (e.target.id === "setPassBtn" || e.target.id === "changePassBtn") showPasscodeSetup();
      if (e.target.id === "removePassBtn") removePasscode();
      if (e.target.id === "lockNowBtn") lockNow();
    });
    view.addEventListener("change", (e) => {
      if (e.target.id === "importFile" && e.target.files[0]) importData(e.target.files[0]);
      // inline edit of a grinder's grind scale
      if (e.target.matches("[data-gunit-idx]")) {
        const idx = Number(e.target.dataset.gunitIdx);
        if (DB.gear.grinders[idx]) {
          DB.gear.grinders[idx].unit = e.target.value.trim();
          save();
        }
      }
    });
    // submit gear add on Enter
    view.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches('[id^="gearin_"]')) {
        e.preventDefault();
        const key = e.target.id.replace("gearin_", "");
        const btn = view.querySelector(`[data-gear-add="${key}"]`);
        if (btn) btn.click();
      }
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `brewlog-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object") throw new Error("bad");
        DB = normalize(data);
        save();
        render();
        toast("Backup imported");
      } catch (err) {
        toast("Couldn't read that file");
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!confirm("Erase ALL beans, recipes and gear? This cannot be undone.")) return;
    DB = structuredClone(DEFAULT_DATA);
    cryptoKey = null;
    encSalt = null;
    encEnabled = false;
    localStorage.removeItem(KEY);
    save();
    toast("All data erased");
    go("beans", "list");
  }

  /* =========================================================================
     PASSCODE LOCK
     ========================================================================= */
  function lockOverlay(inner) {
    let ov = $("#lockOverlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "lockOverlay";
      ov.className = "lock-overlay";
      document.body.appendChild(ov);
    }
    ov.innerHTML = `<div class="lock-card">${inner}</div>`;
    return ov;
  }
  function closeLockOverlay() {
    const ov = $("#lockOverlay");
    if (ov) ov.remove();
  }

  // Shown at boot when storage is encrypted; gates the whole app.
  function showLock(env) {
    const ov = lockOverlay(`
      <div class="lock-icon">☕🔒</div>
      <h2>Brew Log</h2>
      <p class="lock-sub">Enter your passcode</p>
      <input type="password" id="lockInput" inputmode="text" autocomplete="current-password" autofocus />
      <button class="btn btn-primary" id="lockBtn">Unlock</button>
      <p class="lock-err" id="lockErr"></p>`);
    const input = $("#lockInput", ov);
    const err = $("#lockErr", ov);
    const attempt = async () => {
      err.textContent = "";
      const pass = input.value;
      if (!pass) return;
      try {
        const key = await deriveKey(pass, ub64(env.salt));
        const data = await decryptData(key, env);
        cryptoKey = key;
        encSalt = ub64(env.salt);
        encEnabled = true;
        DB = normalize(data);
        closeLockOverlay();
        render();
      } catch (e) {
        err.textContent = "Wrong passcode — try again.";
        input.value = "";
        input.focus();
      }
    };
    $("#lockBtn", ov).addEventListener("click", attempt);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });
    setTimeout(() => input.focus(), 50);
  }

  // Set or change a passcode (called from settings while unlocked).
  function showPasscodeSetup() {
    const ov = lockOverlay(`
      <div class="lock-icon">🔒</div>
      <h2>${encEnabled ? "Change passcode" : "Set a passcode"}</h2>
      <p class="lock-sub">This encrypts your journal on this device.</p>
      <input type="password" id="p1" placeholder="New passcode" autocomplete="new-password" />
      <input type="password" id="p2" placeholder="Confirm passcode" autocomplete="new-password" />
      <p class="lock-warn">⚠︎ There's no recovery — if you forget it, the data can't be read. Keep a JSON backup (Export) just in case.</p>
      <button class="btn btn-primary" id="passSaveBtn">Save</button>
      <button class="btn btn-ghost" id="passCancelBtn">Cancel</button>
      <p class="lock-err" id="passErr"></p>`);
    const err = $("#passErr", ov);
    $("#passCancelBtn", ov).addEventListener("click", closeLockOverlay);
    $("#passSaveBtn", ov).addEventListener("click", async () => {
      const p1 = $("#p1", ov).value, p2 = $("#p2", ov).value;
      if (p1.length < 4) { err.textContent = "Use at least 4 characters."; return; }
      if (p1 !== p2) { err.textContent = "Passcodes don't match."; return; }
      encSalt = crypto.getRandomValues(new Uint8Array(16));
      cryptoKey = await deriveKey(p1, encSalt);
      encEnabled = true;
      await save();
      closeLockOverlay();
      toast("Passcode set — journal encrypted");
      render();
    });
  }

  function removePasscode() {
    if (!confirm("Remove the passcode? Your journal will be stored unencrypted on this device.")) return;
    encEnabled = false;
    cryptoKey = null;
    encSalt = null;
    save();
    toast("Passcode removed");
    render();
  }

  function lockNow() {
    cryptoKey = null;
    DB = null;
    showLock(readRaw());
  }

  // Decide whether to show the app or the lock screen on startup.
  function boot() {
    const raw = readRaw();
    if (raw && raw.__enc) {
      encEnabled = true;
      if (!SUBTLE) {
        DB = structuredClone(DEFAULT_DATA); // can't decrypt without crypto; show empty rather than crash
        lockOverlay(`<div class="lock-icon">🔒</div><h2>Locked</h2>
          <p class="lock-sub">This journal is encrypted. Open the site over https to unlock it.</p>`);
        return;
      }
      showLock(raw);
      return;
    }
    DB = raw ? normalize(raw) : structuredClone(DEFAULT_DATA);
    render();
  }

  /* =========================================================================
     GLOBAL EVENT WIRING
     ========================================================================= */
  function init() {
    // tab bar
    document.querySelectorAll(".tab").forEach((b) =>
      b.addEventListener("click", () => go(b.dataset.tab, "list"))
    );

    // back
    $("#backBtn").addEventListener("click", () => {
      if (state.view === "form" && state.id) go(state.tab, "detail", state.id);
      else go(state.tab, "list");
    });

    // FAB
    $("#fab").addEventListener("click", () => startForm(null));

    // search
    $("#searchToggle").addEventListener("click", () => {
      const bar = $("#searchBar");
      bar.hidden = !bar.hidden;
      if (!bar.hidden) $("#searchInput").focus();
      else { state.search = ""; render(); }
    });
    $("#searchInput").addEventListener("input", (e) => {
      state.search = e.target.value;
      const body = $("#listBody");
      if (body) {
        const items = getItems();
        body.innerHTML = items.length
          ? listBodyHtml(items)
          : `<div class="empty-state"><p>No matches.</p></div>`;
      }
    });

    // delegated clicks within view
    $("#view").addEventListener("click", (e) => {
      // tap a recipe listed on a bean's detail page -> jump to that recipe
      const lr = e.target.closest("[data-rkind]");
      if (lr) {
        go(lr.dataset.rkind, "detail", lr.dataset.rid);
        return;
      }
      // list card -> detail
      const card = e.target.closest(".card");
      if (card && state.view === "list") {
        go(state.tab, "detail", card.dataset.id);
        return;
      }
      // list toolbar
      if (e.target.id === "favChip") { state.filterFav = !state.filterFav; render(); return; }
      // detail actions
      if (e.target.id === "editBtn") { startForm(state.id); return; }
      if (e.target.id === "dupBtn") { duplicateCurrent(); return; }
      if (e.target.id === "delBtn") { deleteCurrent(); return; }
      // form save
      if (e.target.id === "saveBtn") { saveEntry(); return; }
    });

    $("#view").addEventListener("change", (e) => {
      if (e.target.id === "sortSel") { state.sort = e.target.value; render(); }
    });

    wireGear();
    boot();

    // service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
