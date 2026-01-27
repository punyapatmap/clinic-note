/* =========================================================
   app.js (fixed + JSON adapters + scoped print sync)
   - Live bind form -> print template (loaded into #printHost)
   - Sticky default physician + license (localStorage)
   - Templates loaded from data/templates.json (dropdown auto-populated)
   - Med DB loaded from data/medications.json (supports your schema)
   - Dx DB loaded from data/icd10dx.json (icd10/en/th/synonyms)
   - Dx list + Med table
   - Print ONLY the active template area

   Key fix for your bug:
   ✅ Dx/Med sync is scoped to the CURRENT print area (no global getElementById collision)
   ✅ After injecting a print template, sync happens on next frame (requestAnimationFrame)
========================================================= */

/* -------------------------
   Helpers
------------------------- */
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* -------------------------
   Field binding (simple text inputs/textarea/select)
   NOTE: "dx" is NOT included; Dx uses its own list UI.
------------------------- */
const BIND_FIELDS = [
  "hn",
  "visitDt",
  "ptName",
  "ageSex",
  "cc",
  "allergy",
  "hpi",
  "pmh",
  "homeMeds",
  "ros",
  "vtemp", "vbp", "vpulse", "vresp", "vspo2",
  "pe",
  "plan",
  "investigation",
  "physician",
  "license",
  "chronicTbody",
  // MC fields (add these)
  "certDt",
  "seenDt",
  "certTime",
  "mcDxText",
  "mcAdvice",
  "mcRestDays",
  "mcFrom",
  "mcTo",
];

/* -------------------------
   Print Mode selection OPD / MC / Admission
------------------------- */
const printMode = $("printMode");
// const btnSaveCase = $("btnSaveCase");
// const btnLoadLatest = $("btnLoadLatest");
const printHost = $("printHost");

const PRINT_TEMPLATES = {
  opd: "./print_templates/opd.html",
  mc: "./print_templates/mc.html",
  admit: "./print_templates/admit.html",
};

// Load Everything from Google SHEET DBs
/* =========================================================
   Google Sheet (Apps Script) DB loaders
   - Works with Code.gs responses: { ok:true, data:[...] }
========================================================= */

// 1) Base URL + key
const GS_API_BASE =
  "https://script.google.com/macros/s/AKfycby1Og7m0h9-tUBjTTVtBHu-J5yUs1EQdAtGS90-7AE848xBmGSPeThoj32mzfI3vlOapg/exec";
const GS_API_KEY = "clinicnote-9f3a7c2e-1c6a-4e9a-bb81-8e5c0d7a91af";

// 2) Your in-memory DBs (keep your existing globals if already declared)
let TEMPLATES = [];     // optional, if you use template dropdown from DB
let SNIPPETS = [];
let ICD10DX = [];
let MEDS_DB = [];

let snipByKey = new Map();
let dxByAny = new Map();   // optional: quick ICD lookup (icd10/en/th/synonyms)
let medByAny = new Map();  // optional: quick med lookup

function gsUrl(action) {
  const u = new URL(GS_API_BASE);
  u.searchParams.set("action", action);
  u.searchParams.set("key", GS_API_KEY);
  return u.toString();
}

async function fetchGsData(action) {
  const res = await fetch(gsUrl(action), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();

  // Code.gs returns { ok:true, data:[...] }
  if (!j || j.ok !== true) throw new Error(j?.error || "API error");
  return Array.isArray(j.data) ? j.data : [];
}

/* -------------------------
   SNIPPETS
------------------------- */
// async function loadSnippetsDB() {
//   try {
//     const data = await fetchGsData("snippets");

//     SNIPPETS = data
//       .filter(s => s && s.key && s.text)
//       .map(s => ({
//         key: String(s.key).trim().toLowerCase(),
//         text: String(s.text ?? ""),
//         tags: Array.isArray(s.tags)
//           ? s.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
//           : [],
//         updated_at: String(s.updated_at ?? "")
//       }));

//     snipByKey = new Map(SNIPPETS.map(s => [s.key, s]));
//     console.log("Loaded snippets:", SNIPPETS.length);
//   } catch (err) {
//     console.warn("Could not load snippets from Google Sheet. Using empty.", err);
//     SNIPPETS = [];
//     snipByKey = new Map();
//   }
// }

async function loadSnippetsDB() {
  const url =
    "https://script.google.com/macros/s/AKfycby1Og7m0h9-tUBjTTVtBHu-J5yUs1EQdAtGS90-7AE848xBmGSPeThoj32mzfI3vlOapg/exec" +
    "?action=snippets" +
    "&key=clinicnote-9f3a7c2e-1c6a-4e9a-bb81-8e5c0d7a91af";

  try {
    console.log("[snippets] fetching:", url);

    const res = await fetch(url, { cache: "no-store", redirect: "follow" });
    console.log("[snippets] status:", res.status, res.statusText);

    const text = await res.text(); // <- read as text first (critical for debugging)
    console.log("[snippets] first 200 chars:", text.slice(0, 200));

    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error("Response is not JSON (likely HTML). Check web app access/deploy.");
    }

    if (!j.ok) throw new Error(j.error || "API returned ok:false");

    const data = Array.isArray(j.data) ? j.data : [];
    SNIPPETS = data
      .filter(s => s && s.key && s.text)
      .map(s => ({
        key: String(s.key).trim().toLowerCase(),
        text: String(s.text ?? ""),
        tags: Array.isArray(s.tags) ? s.tags.map(t => String(t).toLowerCase()) : []
      }));

    snipByKey = new Map(SNIPPETS.map(s => [s.key, s]));
    console.log("[snippets] loaded:", SNIPPETS.length);
  } catch (err) {
    console.error("[snippets] FAILED:", err);
    SNIPPETS = [];
    snipByKey = new Map();
  }
}


/* -------------------------
   TEMPLATES
   (Only if your app uses templates from DB)
------------------------- */
async function loadTemplatesGS() {
  try {
    const data = await fetchGsData("templates");

    // Code.gs returns: [{ id, updated_at, data }]
    TEMPLATES = data
      .filter(t => t && t.id)
      .map(t => ({
        id: String(t.id).trim(),
        updated_at: String(t.updated_at ?? ""),
        data: t.data ?? null
      }));

    console.log("Loaded templates:", TEMPLATES.length);
  } catch (err) {
    console.warn("Could not load templates from Google Sheet. Using empty.", err);
    TEMPLATES = [];
  }
}

/* -------------------------
   ICD10DX (optional)
------------------------- */

function useGoogleDxAsMainDb() {
  // Make the rest of the app (autocomplete + MC lookup) use Google data
  DX_DB = Array.isArray(ICD10DX) ? ICD10DX : [];

  dxByIcd10 = new Map();
  dxById = new Map();

  for (const d of DX_DB) {
    const icd = String(d.icd10 || "").trim().toUpperCase();
    const id = String(d.id || "").trim().toUpperCase();
    if (icd) dxByIcd10.set(icd, d);
    if (id) dxById.set(id, d);
  }

  console.log("[DX] Using Google Sheet DB:", DX_DB.length);
}

async function loadIcd10DB() {
  try {
    const data = await fetchGsData("icd10dx");

    ICD10DX = data.filter(Boolean).map(d => ({
      icd10: String(d.icd10 ?? d.id ?? "").trim(),
      en: String(d.en ?? ""),
      en_short: String(d.en_short ?? ""),
      th: String(d.th ?? ""),
      synonyms: Array.isArray(d.synonyms) ? d.synonyms.map(String) : [],
      mc: d.mc ?? null
    }));

    // Optional: build a fast lookup map by icd10/en/th/synonyms
    dxByAny = new Map();
    ICD10DX.forEach(d => {
      const keys = [
        d.icd10,
        d.en,
        d.en_short,
        d.th,
        ...(d.synonyms || [])
      ]
        .filter(Boolean)
        .map(x => String(x).trim().toLowerCase());

      keys.forEach(k => dxByAny.set(k, d));
    });

    console.log("Loaded icd10dx:", ICD10DX.length);
  } catch (err) {
    console.warn("Could not load icd10dx from Google Sheet. Using empty.", err);
    ICD10DX = [];
    dxByAny = new Map();
  }
}

/* -------------------------
   MEDICATIONS (optional)
------------------------- */
async function loadMedsGS() {
  try {
    const data = await fetchGsData("medications");

    // Adjust fields to match what your app expects
    MEDS_DB = data.filter(Boolean).map(m => ({
      id: String(m.id ?? "").trim(),
      name: String(m.name ?? m.id ?? "").trim(),
      form: String(m.form ?? ""),
      strength: String(m.strength ?? ""),
      route: String(m.route ?? ""),
      freq: String(m.sig_freq ?? ""),
      meta: m.meta ?? null
    }));

    // Optional: lookup by drug/id
    medByAny = new Map();
    MEDS_DB.forEach(m => {
      [m.id, m.name].filter(Boolean).forEach(k => {
        medByAny.set(String(k).trim().toLowerCase(), m);
      });
    });

    console.log("Loaded medications:", MEDS_DB.length);
  } catch (err) {
    console.warn("Could not load medications from Google Sheet. Using empty.", err);
    MEDS_DB = [];
    medByAny = new Map();
  }
}

/* -------------------------
   Load everything (call this on init)
------------------------- */
async function loadAllDatabases() {
  // Load in parallel
  await Promise.all([
    loadSnippetsDB(),
    loadTemplatesGS(),
    loadIcd10DB(),
    loadMedsGS()
  ]);
}

// -------Snippet Autocomplete UI --------//
// Snippet autocomplete UI (key + tag + text)
// ---------------------------------------//

const snippetBox = document.getElementById("snippetBox");

let snipState = {
  ta: null,
  matches: [],
  activeIndex: 0,
  currentToken: ""
};

// --- small helpers ---
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function getLastToken(text, pos) {
  const left = text.slice(0, pos);
  const m = left.match(/(^|\s)([^\s]+)$/);
  return m ? m[2] : "";
}

function replaceLastToken(textarea, replacement) {
  const pos = textarea.selectionStart;
  const text = textarea.value;
  const left = text.slice(0, pos);
  const right = text.slice(pos);

  const m = left.match(/(^|\s)([^\s]+)$/);
  if (!m) return;

  const token = m[2];
  const start = pos - token.length;

  textarea.value = text.slice(0, start) + replacement + right;
  const newPos = start + replacement.length;
  textarea.setSelectionRange(newPos, newPos);
}

function hideSnippetBox() {
  snipState = { ta: null, matches: [], activeIndex: 0, currentToken: "" };
  snippetBox.classList.add("hidden");
  snippetBox.innerHTML = "";
}

function positionSnippetBox(textarea) {
  // stable placement: under textarea (not caret) – simple and reliable
  const r = textarea.getBoundingClientRect();
  snippetBox.style.left = (window.scrollX + r.left) + "px";
  snippetBox.style.top = (window.scrollY + r.bottom + 6) + "px";
}

// --- match type detector (for badge + ranking) ---
function detectMatchType(token, s) {
  const t = norm(token);
  const key = norm(s.key);
  const text = norm(s.text);
  const tags = Array.isArray(s.tags) ? s.tags.map(norm) : [];

  if (key === t || key.startsWith(t) || key.includes(t)) return "key";
  if (tags.some(tag => tag.includes(t))) return "tag";
  if (text.includes(t)) return "text";
  return "text";
}

// --- ranking: key > tag > text ---
function rankMatches(token, list) {
  const t = norm(token);

  return list
    .map(s => {
      const key = norm(s.key);
      const text = norm(s.text);
      const tags = Array.isArray(s.tags) ? s.tags.map(norm) : [];

      let score = 0;

      // KEY (highest)
      if (key === t) score += 2000;
      if (key.startsWith(t)) score += 1200;
      if (key.includes(t)) score += 600;

      // TAGS (medium)
      if (tags.some(tag => tag === t)) score += 500;
      if (tags.some(tag => tag.startsWith(t))) score += 250;
      if (tags.some(tag => tag.includes(t))) score += 120;

      // TEXT (lower, but useful)
      if (text.startsWith(t)) score += 140;
      else if (text.includes(" " + t)) score += 110; // word-ish match
      else if (text.includes(t)) score += 80;

      // prefer shorter keys a bit
      score += Math.max(0, 30 - key.length);

      // slight preference for shorter snippet text (less noise)
      score += Math.max(0, 10 - Math.floor(text.length / 40));

      return {
        s,
        score,
        matchType: detectMatchType(t, s)
      };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x);
}

function renderSnippetBox() {
  const { matches, activeIndex } = snipState;
  if (!matches.length) return hideSnippetBox();

  const itemsHtml = matches.slice(0, 8).map((m, i) => {
    const cls = i === activeIndex ? "snip-item active" : "snip-item";
    const badge = m.matchType || "text";

    return `
      <div class="${cls}" data-idx="${i}" role="option" aria-selected="${i === activeIndex}">
        <span class="snip-key">${escapeHtml(m.s.key)}</span>
        <span class="snip-badge">${badge}</span>
        <span class="snip-text">${escapeHtml(m.s.text)}</span>
      </div>
    `;
  }).join("");

  snippetBox.innerHTML = `
    ${itemsHtml}
    <div class="snip-hint">↑/↓ select • Enter/Tab insert • Esc close</div>
  `;

  // click to insert
  snippetBox.querySelectorAll(".snip-item").forEach(el => {
    el.addEventListener("mousedown", (e) => {
      // mousedown (not click) so it works before textarea loses focus
      e.preventDefault();
      const idx = Number(el.dataset.idx);
      chooseSnippet(idx);
    });
  });

  snippetBox.classList.remove("hidden");
}

function chooseSnippet(idx) {
  const { ta, matches } = snipState;
  const hit = matches[idx];
  if (!ta || !hit) return;
  replaceLastToken(ta, hit.s.text);
  hideSnippetBox();
}

function updateSnippetMatches(textarea) {
  const tokenRaw = getLastToken(textarea.value, textarea.selectionStart);
  const token = norm(tokenRaw);

  // Only trigger when token has at least 2 chars
  if (token.length < 2) return hideSnippetBox();

  // ✅ Match by key OR tag OR snippet text
  const filtered = SNIPPETS.filter(s => {
    const key = norm(s.key);
    const text = norm(s.text);
    const tags = Array.isArray(s.tags) ? s.tags.map(norm) : [];

    return (
      key.includes(token) ||
      tags.some(tag => tag.includes(token)) ||
      text.includes(token)
    );
  });

  if (!filtered.length) return hideSnippetBox();

  // rankMatches now returns [{s, score, matchType}, ...]
  const ranked = rankMatches(token, filtered);

  snipState.ta = textarea;
  snipState.currentToken = token;
  snipState.matches = ranked;
  snipState.activeIndex = 0;

  positionSnippetBox(textarea);
  renderSnippetBox();
}

function bindSnippetAutocomplete(textarea) {
  textarea.addEventListener("input", () => updateSnippetMatches(textarea));

  textarea.addEventListener("keydown", (e) => {
    if (snippetBox.classList.contains("hidden")) return;
    if (snipState.ta !== textarea) return;

    const maxVisible = Math.min(snipState.matches.length, 8);
    if (maxVisible <= 0) return;

    if (e.key === "Escape") {
      e.preventDefault();
      hideSnippetBox();
      return;
    }

    // TAB cycles selection (wrap around)
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        snipState.activeIndex = (snipState.activeIndex - 1 + maxVisible) % maxVisible;
      } else {
        snipState.activeIndex = (snipState.activeIndex + 1) % maxVisible;
      }
      renderSnippetBox();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      snipState.activeIndex = Math.min(snipState.activeIndex + 1, maxVisible - 1);
      renderSnippetBox();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      snipState.activeIndex = Math.max(snipState.activeIndex - 1, 0);
      renderSnippetBox();
      return;
    }

    // Insert selected item
    // (Enter inserts; Space inserts too if you want this “fast” behavior)
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      chooseSnippet(snipState.activeIndex);
      return;
    }
  });

  textarea.addEventListener("scroll", () => {
    if (snipState.ta === textarea && !snippetBox.classList.contains("hidden")) {
      positionSnippetBox(textarea);
    }
  });

  textarea.addEventListener("blur", () => {
    setTimeout(hideSnippetBox, 120);
  });

  window.addEventListener("resize", () => {
    if (snipState.ta === textarea && !snippetBox.classList.contains("hidden")) {
      positionSnippetBox(textarea);
    }
  });

  window.addEventListener("scroll", () => {
    if (snipState.ta === textarea && !snippetBox.classList.contains("hidden")) {
      positionSnippetBox(textarea);
    }
  }, true);
}

// --------------------------//

// 1st Load Template //

async function loadPrintTemplate(mode) {
  if (!printHost) return;

  const url = PRINT_TEMPLATES[mode] || PRINT_TEMPLATES.opd;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    printHost.innerHTML = html;

    const area = printHost.querySelector('[id^="printArea-"]');
    currentPrintAreaId = area?.id || currentPrintAreaId;

    bindPreviewFields();

    // IMPORTANT FIX: wait 1 frame after injection
    requestAnimationFrame(() => {
      syncAllPrint(mode);
    });
  } catch (err) {
    console.warn("Could not load print template:", url, err);
    printHost.innerHTML = `<div class="note noteA4" style="padding:16mm">Template load error: ${escapeHtml(
      url
    )}</div>`;
    currentPrintAreaId = "printArea-opd";
  }
}

/** Track current loaded area id inside printHost **/
let currentPrintAreaId = "printArea-opd";

/** Returns the current print area element (scoped root for syncing) */
function getCurrentPrintArea() {
  const byId = document.getElementById(currentPrintAreaId);
  if (byId) return byId;

  if (printHost) {
    const areaInHost = printHost.querySelector('[id^="printArea-"]');
    if (areaInHost) return areaInHost;
  }

  return document.querySelector('[id^="printArea-"]') || $("printArea") || null;
}

/* Med Certificate - Use VisitDt to indicate how many rest day */
function syncMcRestFromMedAndVisitDt() {
  const area = getCurrentPrintArea();
  if (!area) return;
  if (currentPrintAreaId !== "printArea-mc") return; // only MC mode

  // ---- base date = visitDt (input) ----
  const visitDtEl = document.getElementById("visitDt");
  let base = visitDtEl?.value ? new Date(visitDtEl.value) : null;
  if (!base || isNaN(base)) return;

  // normalize to date-only for mcFrom/mcTo
  const fromDate = new Date(base);
  fromDate.setHours(0, 0, 0, 0);

  // ---- find Med certificate in Med -> duration ----
  const medRows = getMedRows();
  const certMed = medRows.find((r) => {
    const drug = (r.drug || "").toLowerCase();
    return drug.includes("ใบรับรองแพทย์") || drug.includes("medical certificate");
  });

  const days = parseInt(certMed?.duration, 10);
  if (!Number.isFinite(days) || days <= 0) return;

  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + (days - 1));

  // ---- helpers (Thai date) ----
  const thaiMonths = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.",
    "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.",
    "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
  ];
  const fmtThaiDate = (d) => `${d.getDate()} ${thaiMonths[d.getMonth()]} ${d.getFullYear() + 543}`;

  // ---- write to template (data-bind) ----
  area.querySelectorAll('[data-bind="mcRestDays"]').forEach((t) => (t.textContent = String(days)));
  area.querySelectorAll('[data-bind="mcFrom"]').forEach((t) => (t.textContent = fmtThaiDate(fromDate)));
  area.querySelectorAll('[data-bind="mcTo"]').forEach((t) => (t.textContent = fmtThaiDate(toDate)));
}

function syncAllPrint(mode = printMode?.value || "opd") {
  renumberDx();
  syncDxRelatedPrint(); //Try Change syncDxToPrint() into syncDxRelatedPrint()
  syncMedToPrint();
  syncMcAutoFields();
  syncMcRestFromMedAndVisitDt();

  const area = getCurrentPrintArea();
  if (!area) return;

  // MC Blocks (optional)
  // ✅ run MC-only stuff only when MC is active
  if (currentPrintAreaId === "printArea-mc") {
    if (typeof syncMcAutoFields === "function") syncMcAutoFields();
    syncMcRestFromMedAndVisitDt();
  }

  // syncMcAutoFields();
  // syncMcRestFromMedAndVisitDt();

  /* MC diagnosis */
  const mcDxShort = area.querySelector("#mcDxShort");  // your HTML has this
  // const mcDxFull  = area.querySelector("#mcDxFull");
  const mcFitNote = area.querySelector("#mcFitNote");

  const rows = getDxRows({ sortByType: true }); // Primary first

  const setText = (el, txt) => { if (el) el.textContent = txt ?? ""; };

  // helper: join ["A","B","C"] -> "A B และ C" (Thai + multiple Dx joined with spaces, last uses " และ ")
  function joinThai(items) {
    const a = items.filter(Boolean);
    if (a.length === 0) return "-";
    if (a.length === 1) return a[0];
    if (a.length === 2) return `${a[0]} และ ${a[1]}`;
    return `${a.slice(0, -1).join(" ")} และ ${a[a.length - 1]}`;
  }

  // helper: normalize ICD key (handles "S09.90", "S09.90-LR", extra spaces)
  function normKey(s) {
    return String(s || "").trim().toUpperCase();
  }

  // helper: get Thai dx text for a row
  function getThaiDxForRow(r) {
    const icd = normKey(r.icd10);               // e.g. "S09.90"
    const id = normKey(r.id);                  // optional if you store it
    const typed = (r.text || "").trim();

    // ✅ IMPORTANT: dxByIcd10 must be a Map
    const obj =
      (typeof dxByIcd10 !== "undefined" && dxByIcd10?.get && icd && dxByIcd10.get(icd)) ||
      (typeof dxById !== "undefined" && dxById?.get && id && dxById.get(id)) ||
      null;

    // Prefer MC short -> Thai name -> typed text fallback
    return obj?.mc?.th_short || obj?.th || typed || "";
  }

  if (!rows.length) {
    setText(mcDxShort, "-");
    // setText(mcDxFull, "");
    setText(mcFitNote, "");
  } else {
    const thList = rows.map(getThaiDxForRow).filter(Boolean);
    setText(mcDxShort, joinThai(thList));

    // Optional: full note / fit note based on PRIMARY dx only
    const primary = rows[0];
    const pIcd = normKey(primary.icd10);
    const pObj = (typeof dxByIcd10 !== "undefined" && dxByIcd10?.get) ? dxByIcd10.get(pIcd) : null;

    // setText(mcDxFull, pObj?.mc?.th_full || "");
    setText(mcFitNote, pObj?.mc?.fit_note || "");
  }

  // ============== Admission blocks (optional) ============== //

  const dxAdmit = area.querySelector("#dxPrintList_admit");
  console.log('event1');
  if (dxAdmit) {
    dxAdmit.innerHTML = "";
    const rows = getDxRows({ sortByType: false });
    if (!rows.length) {
      const li = document.createElement("li");
      li.textContent = "-";
      dxAdmit.appendChild(li);
    } else {
      rows.forEach((r) => {
        const li = document.createElement("li");
        li.textContent = r.text;
        dxAdmit.appendChild(li);
      });
    }
  }

  const medAdmit = area.querySelector("#medPrintTbody_admit");
  if (medAdmit) {
    medAdmit.innerHTML = "";
    const rows = getMedRows();
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = "-";
      tr.appendChild(td);
      medAdmit.appendChild(tr);
    } else {
      rows.forEach((r, idx) => {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.innerHTML = `<b>${idx + 1}.</b> ${escapeHtml(r.drug)} ${escapeHtml(
          r.dose
        )} ${escapeHtml(r.freq)} ${escapeHtml(r.route)} ${r.duration ? "/" + escapeHtml(r.duration) : ""
          } ${escapeHtml(r.instruction)}`;
        tr.appendChild(td);
        medAdmit.appendChild(tr);
      });
    }
  }
}

/* =========================================================
   Time and Date Functions
========================================================= */

function formatThaiDate(dateInput) {
  if (!dateInput) return "";

  const d = new Date(dateInput);
  if (isNaN(d)) return "";

  const thaiMonths = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.",
    "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.",
    "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
  ];

  const day = d.getDate();
  const month = thaiMonths[d.getMonth()];
  const year = d.getFullYear() + 543;

  return `${day} ${month} ${year}`;
}

function formatThaiDateFromDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return "";
  const thaiMonths = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.",
    "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.",
    "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
  ];
  return `${d.getDate()} ${thaiMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function formatThaiTimeFromDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}


function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

function initVisitDtDefault(force = false) {
  const el = $("visitDt");
  if (!el) return;
  if (!force && el.value) return;

  const d = new Date();
  d.setMinutes(d.getMinutes() + 20);

  el.value = toDatetimeLocalValue(d);
  el.dispatchEvent(new Event("input"));
  el.dispatchEvent(new Event("change"));
}

/* =========================================================
   Preview Function
========================================================= */

function bindPreviewFields() {
  for (const id of BIND_FIELDS) {
    const input = $(id);
    if (!input) continue;

    const targets = document.querySelectorAll(`[data-bind="${id}"]`);

    const update = () => {
      let val = (input.value ?? "").trim();

      // ✅ Thai date formatting
      if (id === "visitDt") {
        val = formatThaiDate(val);
      }

      if (!val) {
        if (id === "allergy") val = "ไม่มีประวัติแพ้ยาแพ้อาหาร";
        if (id === "pmh") val = "ปฏิเสธโรคประจำตัว";
        if (id === "chronicTbody") val = "ไม่มียาที่ใช้อยู่เป็นประจำ";
      }

      targets.forEach((t) => (t.textContent = val));
    };

    input.addEventListener("input", update);
    input.addEventListener("change", update);
    update();
  }
}

/* -------------------------
   Sticky defaults (physician/license)
------------------------- */
const STICKY_DEFAULTS = {
  physician: "นพ.ปุญญภัทร มาประโพธิ์",
  license: "ว.61047",
};

function initStickyDefault(id) {
  const el = $(id);
  if (!el) return;

  const key = `sticky_${id}`;
  const saved = localStorage.getItem(key);

  el.value = saved ?? STICKY_DEFAULTS[id] ?? el.value ?? "";
  el.dispatchEvent(new Event("input"));

  el.addEventListener("input", () => {
    localStorage.setItem(key, el.value);
  });
}

/* =========================================================
   Databases: Meds + Dx + Templates (JSON)
========================================================= */

// let MED_DB = [];
// let DX_DB = [];
// let dxByIcd10 = new Map();
// let dxById = new Map();
// let templates = {};

// async function loadTemplatesDBJSON() {
//   try {
//     const res = await fetch("./data/templates.json", { cache: "no-store" });
//     if (!res.ok) throw new Error(`HTTP ${res.status}`);
//     templates = await res.json();
//     console.log("Loaded templates:", Object.keys(templates).length);
//   } catch (err) {
//     console.warn("Could not load templates.json. Using blank only.", err);
//     templates = { blank: { fields: {}, dxList: [], meds: [] } };
//   }
// }

// // async function loadDiseaseDB() {
// //   try {
// //     const res = await fetch("./data/icd10dx.json", { cache: "no-store" });
// //     if (!res.ok) throw new Error(`HTTP ${res.status}`);
// //     const data = await res.json();
// //     DX_DB = Array.isArray(data) ? data : [];
// //     console.log("Loaded diseases:", DX_DB.length);

// //     // ✅ Build lookup maps
// //     dxByIcd10 = new Map();
// //     dxById = new Map();

// //     for (const d of DX_DB) {
// //       const icd = String(d.icd10 || "").trim().toUpperCase(); // e.g. "A09"
// //       const id = String(d.id || "").trim().toUpperCase();    // e.g. "S09.90-LR"
// //       if (icd) dxByIcd10.set(icd, d);
// //       if (id) dxById.set(id, d);
// //     }
// //   } catch (err) {
// //     console.warn("Could not load icd10dx.json. Using empty list.", err);
// //     DX_DB = [];
// //     dxByIcd10 = new Map();
// //     dxById = new Map();
// //   }
// // }

// async function loadDiseaseDBJSON() {
//   try {
//     const DX_FILES = [
//       "./data/icd/dx_infectious.json",
//       "./data/icd/dx_respiratory.json",
//       "./data/icd/dx_skin.json",
//       "./data/icd/dx_msk.json",
//       "./data/icd/dx_trauma.json",
//       "./data/icd/dx_symptoms.json",
//       "./data/icd/dx_admin_zcode.json"
//     ];

//     const results = await Promise.all(
//       DX_FILES.map(async (p) => {
//         const res = await fetch(p, { cache: "no-store" });
//         if (!res.ok) throw new Error(`${p} HTTP ${res.status}`);
//         return await res.json();
//       })
//     );

//     // 🔗 merge + de-duplicate by id (later files override earlier)
//     const map = new Map();
//     results.flat().forEach(d => {
//       if (!d?.id) return;
//       map.set(String(d.id).toUpperCase(), d);
//     });

//     DX_DB = Array.from(map.values());
//     console.log("Loaded diseases:", DX_DB.length);

//     // ✅ Build lookup maps (UNCHANGED logic)
//     dxByIcd10 = new Map();
//     dxById = new Map();

//     for (const d of DX_DB) {
//       const icd = String(d.icd10 || "").trim().toUpperCase(); // e.g. "A09"
//       const id = String(d.id || "").trim().toUpperCase();   // e.g. "S09.90-LR"
//       if (icd) dxByIcd10.set(icd, d);
//       if (id) dxById.set(id, d);
//     }

//   } catch (err) {
//     console.warn("Could not load Dx JSON files. Using empty list.", err);
//     DX_DB = [];
//     dxByIcd10 = new Map();
//     dxById = new Map();
//   }
// }

// async function loadMedicationDBJSON() {
//   try {
//     const res = await fetch("./data/medications.json", { cache: "no-store" });
//     if (!res.ok) throw new Error(`HTTP ${res.status}`);
//     const data = await res.json();
//     MED_DB = Array.isArray(data) ? data : [];
//     console.log("Loaded meds:", MED_DB.length);
//   } catch (err) {
//     console.warn("Could not load medications.json. Using empty list.", err);
//     MED_DB = [];
//   }
// }

// Templates dropdown (from templates.json)

// const templateSelect = $("templateSelect");

// function populateTemplateDropdown() {
//   if (!templateSelect) return;

//   const keys = Object.keys(templates || {});
//   if (keys.length === 0) return;

//   const current = templateSelect.value;
//   templateSelect.innerHTML = "";

//   keys.sort((a, b) => {
//     if (a === "blank") return -1;
//     if (b === "blank") return 1;
//     return a.localeCompare(b);
//   });

//   for (const key of keys) {
//     const opt = document.createElement("option");
//     opt.value = key;
//     opt.textContent = key;
//     templateSelect.appendChild(opt);
//   }

//   if (current && keys.includes(current)) templateSelect.value = current;
//   else if (keys.includes("blank")) templateSelect.value = "blank";
//   else templateSelect.value = keys[0];
// }

/* =========================================================
   PMH List
========================================================= */

const chronicTbody = document.getElementById("chronicTbody");
let chronicState = []; // [{cond, year, meds}]

function chronicLine(r) {
  const cond = (r.cond || "").trim() || "-";
  const year = (r.year || "").trim();
  const meds = (r.meds || "").trim();

  // Format you asked:
  // - T2DM (Dx y2567/2024); on MFM 500 mgOD
  // If year empty, omit the Dx part.
  const dxPart = year ? ` (Dx y${year})` : "";
  const medPart = meds ? `; on ${meds}` : "";
  return `${cond}${dxPart}${medPart}`;
}

function renumberChronic() {
  if (!chronicTbody) return;
  [...chronicTbody.querySelectorAll("tr")].forEach((tr, i) => {
    const n = tr.querySelector("[data-n]");
    if (n) n.textContent = String(i + 1);
  });
}

function syncChronicToPrint() {
  const ul = document.getElementById("chronicPrintList");
  if (!ul) return;
  ul.innerHTML = "";

  const rows = getChronicRows();
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "";
    ul.appendChild(li);
    return;
  }

  rows.forEach(r => {
    const li = document.createElement("li");
    li.textContent = chronicLine(r);
    ul.appendChild(li);
  });
}

function getChronicRows() {
  if (!chronicTbody) return [];
  return [...chronicTbody.querySelectorAll("tr")].map(tr => ({
    cond: tr.querySelector('[data-field="cond"]')?.value ?? "",
    year: tr.querySelector('[data-field="year"]')?.value ?? "",
    meds: tr.querySelector('[data-field="meds"]')?.value ?? "",
  })).filter(r => (r.cond.trim() || r.year.trim() || r.meds.trim()));
}

function createChronicRow(data = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td data-n></td>
    <td><input data-field="cond" placeholder="e.g., T2DM / Asthma" value="${escapeHtml?.(data.cond) ?? ""}"></td>
    <td><input data-field="year" placeholder="2567/2024" value="${escapeHtml?.(data.year) ?? ""}"></td>
    <td><input data-field="meds" placeholder="e.g., Metformin 500 mg OD" value="${escapeHtml?.(data.meds) ?? ""}"></td>
    <td><button type="button" data-remove>Remove</button></td>
  `;

  // live sync
  tr.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      syncChronicToPrint();
      saveDraft?.();
    });
  });

  tr.querySelector("[data-remove]").addEventListener("click", () => {
    tr.remove();
    renumberChronic();
    syncChronicToPrint();
    saveDraft?.();
  });

  return tr;
}

function addChronicRow(data) {
  if (!chronicTbody) return;
  chronicTbody.appendChild(createChronicRow(data));
  renumberChronic();
  syncChronicToPrint();
  saveDraft?.();
}

function bindChronicUI() {
  const btn = document.getElementById("btnAddChronic");
  if (!btn) return;
  btn.addEventListener("click", () => addChronicRow({ cond: "", year: "", meds: "" }));
}

/* =========================================================
   Dx List
========================================================= */
const dxTbody = $("dxTbody");
const btnAddDx = $("btnAddDx");

function createDxRow({ text = "", type = "Primary", icd10 = "", id = "" } = {}) {
  const tr = document.createElement("tr");

  // ✅ Preserve keys for later Thai lookup
  tr.dataset.icd10 = String(icd10 || "").trim();
  tr.dataset.dxid = String(id || "").trim();

  const tdNum = document.createElement("td");
  tdNum.className = "dxNumCell";
  tdNum.textContent = "";
  tr.appendChild(tdNum);

  const tdText = document.createElement("td");
  const inp = document.createElement("input");
  inp.value = text;
  inp.placeholder = "e.g., Dyspepsia w/ abdominal bloating";
  inp.addEventListener("input", () => {
    renumberDx();
    syncDxRelatedPrint();
    saveDraft();
  });
  tdText.appendChild(inp);
  tr.appendChild(tdText);

  attachDxAutocomplete(inp);

  const tdType = document.createElement("td");
  const sel = document.createElement("select");
  ["Primary", "Secondary", "Problem"].forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  sel.value = type;
  sel.addEventListener("change", () => {
    syncDxRelatedPrint();
    saveDraft();
  });
  tdType.appendChild(sel);
  tr.appendChild(tdType);

  const tdDel = document.createElement("td");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Remove";
  btn.addEventListener("click", () => {
    tr.remove();
    renumberDx();
    syncDxRelatedPrint();
    saveDraft();
  });
  tdDel.appendChild(btn);
  tr.appendChild(tdDel);

  return tr;
}

function renumberDx() {
  if (!dxTbody) return;
  [...dxTbody.querySelectorAll("tr")].forEach((tr, idx) => {
    const cell = tr.querySelector(".dxNumCell");
    if (cell) cell.textContent = String(idx + 1);
  });
}

function getDxRows({ sortByType = false } = {}) {
  if (!dxTbody) return [];

  const rows = [];
  for (const tr of dxTbody.querySelectorAll("tr")) {
    const text = (tr.querySelector("input")?.value ?? "").trim();
    const type = (tr.querySelector("select")?.value ?? "Primary").trim();
    if (text) rows.push({ text, type, icd10: tr.dataset.icd10 || "" });
  }

  if (sortByType) {
    const order = { Primary: 0, Secondary: 1, Problem: 2 };
    rows.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  }

  return rows;
}

// function attachDxAutocomplete(input) {

//   let box = null;

//   const getSearchText = (d) => {
//     const syn = Array.isArray(d.synonyms) ? d.synonyms.join(" ") : "";
//     return `${d.icd10 || ""} ${d.en || ""} ${d.th || ""} ${syn}`.toLowerCase();
//   };

//   const close = () => {
//     if (box) {
//       box.remove();
//       box = null;
//     }
//   };

//   input.addEventListener("input", () => {
//     const q = input.value.trim().toLowerCase();
//     close();
//     if (q.length < 2) return;
//     if (!DX_DB.length) return;

//     const matches = DX_DB.filter((d) => getSearchText(d).includes(q)).slice(0, 8);
//     if (!matches.length) return;

//     box = document.createElement("div");
//     box.className = "dxSuggestBox";

//     matches.forEach((d) => {
//       const item = document.createElement("div");
//       item.className = "dxSuggestItem";
//       item.textContent = `${d.icd10 || ""} ${d.en || ""} / ${d.th || ""}`.trim();

//       item.addEventListener("mousedown", (e) => {
//         e.preventDefault();
//         input.value = d.en || "";
//         const tr = input.closest("tr");
//         if (tr) {
//           tr.dataset.icd10 = d.icd10 || ""; // "S09.90"
//           tr.dataset.dxid = d.id || "";    // "S09.90-LR"
//         }
//         close();
//         input.dispatchEvent(new Event("input"));
//       });

//       box.appendChild(item);
//     });

//     input.parentElement.style.position = "relative";
//     input.parentElement.appendChild(box);
//   });

//   document.addEventListener("click", close);
// }


// ----------------------------
// Dx autocomplete (Snippet Style)
// ----------------------------

// // shared box for all dx inputs
// const dxSuggestBox = document.createElement("div");
// dxSuggestBox.className = "dxSuggestBox hidden";
// document.body.appendChild(dxSuggestBox);

// let dxState = {
//   input: null,
//   matches: [],
//   activeIndex: 0
// };

// function norm(s) {
//   return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
// }

// function dxSearchText(d) {
//   const syn = Array.isArray(d.synonyms) ? d.synonyms.join(" ") : "";
//   return norm(`${d.icd10 || ""} ${d.en || ""} ${d.th || ""} ${syn}`);
// }

// function hideDxBox() {
//   dxState = { input: null, matches: [], activeIndex: 0 };
//   dxSuggestBox.classList.add("hidden");
//   dxSuggestBox.innerHTML = "";
// }

// function positionDxBox(input) {
//   const r = input.getBoundingClientRect();
//   dxSuggestBox.style.left = (window.scrollX + r.left) + "px";
//   dxSuggestBox.style.top = (window.scrollY + r.bottom + 6) + "px";
//   dxSuggestBox.style.width = r.width + "px";
// }

// function rankDxMatches(token, list) {
//   const t = norm(token);

//   return list
//     .map(d => {
//       const icd = norm(d.icd10 || d.id || "");
//       const en = norm(d.en);
//       const th = norm(d.th);
//       const syn = Array.isArray(d.synonyms) ? d.synonyms.map(norm) : [];

//       let score = 0;

//       // icd10 strongest
//       if (icd === t) score += 2000;
//       if (icd.startsWith(t)) score += 1200;
//       if (icd.includes(t)) score += 700;

//       // english/thai medium
//       if (en.startsWith(t)) score += 400;
//       if (en.includes(t)) score += 220;

//       if (th.startsWith(t)) score += 450;
//       if (th.includes(t)) score += 240;

//       // synonyms small boost
//       if (syn.some(s => s.startsWith(t))) score += 180;
//       if (syn.some(s => s.includes(t))) score += 120;

//       // prefer shorter icd a bit
//       score += Math.max(0, 30 - icd.length);

//       return { d, score };
//     })
//     .filter(x => x.score > 0)
//     .sort((a, b) => b.score - a.score)
//     .map(x => x.d);
// }

// function renderDxBox() {
//   const { matches, activeIndex } = dxState;
//   if (!matches.length) return hideDxBox();

//   dxSuggestBox.innerHTML = `
//     ${matches.slice(0, 8).map((d, i) => {
//       const cls = i === activeIndex ? "dxSuggestItem active" : "dxSuggestItem";
//       const title = `${d.icd10 || ""} ${d.en || ""}`.trim();
//       const sub = `${d.th || ""}`.trim();
//       return `
//         <div class="${cls}" data-idx="${i}" role="option" aria-selected="${i === activeIndex}">
//           <div class="dxLine1"><b>${escapeHtml(d.icd10 || "")}</b> ${escapeHtml(d.en || "")}</div>
//           ${sub ? `<div class="dxLine2">${escapeHtml(sub)}</div>` : ``}
//         </div>
//       `;
//     }).join("")}
//     <div class="dxHint">↑/↓ select • Enter/Tab insert • Esc close</div>
//   `;

//   dxSuggestBox.querySelectorAll(".dxSuggestItem").forEach(el => {
//     el.addEventListener("mousedown", (e) => {
//       e.preventDefault();
//       const idx = Number(el.dataset.idx);
//       chooseDx(idx);
//     });
//   });

//   dxSuggestBox.classList.remove("hidden");
// }

// function chooseDx(idx) {
//   const { input, matches } = dxState;
//   const d = matches[idx];
//   if (!input || !d) return;

//   // your original behavior: insert EN into the cell
//   input.value = d.en || "";

//   // preserve metadata on row for later Thai lookup/MC
//   const tr = input.closest("tr");
//   if (tr) {
//     tr.dataset.icd10 = d.icd10 || "";
//     tr.dataset.dxid = d.id || "";
//   }

//   hideDxBox();
//   input.dispatchEvent(new Event("input")); // triggers renumber/sync/save as before
// }

// function updateDxMatches(input) {
//   const q = norm(input.value);
//   if (q.length < 2) return hideDxBox();
//   if (!Array.isArray(DX_DB) || DX_DB.length === 0) return hideDxBox();

//   // fast filter then rank
//   const pre = DX_DB.filter(d => dxSearchText(d).includes(q)).slice(0, 50);
//   const ranked = rankDxMatches(q, pre).slice(0, 8);

//   if (!ranked.length) return hideDxBox();

//   dxState.input = input;
//   dxState.matches = ranked;
//   dxState.activeIndex = 0;

//   positionDxBox(input);
//   renderDxBox();
// }

// function attachDxAutocomplete(input) {
//   if (!input) return;

//   // prevent double-binding
//   if (input.dataset.dxBound === "1") return;
//   input.dataset.dxBound = "1";

//   input.addEventListener("input", () => updateDxMatches(input));

//   input.addEventListener("keydown", (e) => {
//     if (dxSuggestBox.classList.contains("hidden")) return;
//     if (dxState.input !== input) return;

//     const maxVisible = Math.min(dxState.matches.length, 8);
//     if (maxVisible <= 0) return;

//     if (e.key === "Escape") {
//       e.preventDefault();
//       hideDxBox();
//       return;
//     }

//     if (e.key === "Tab") {
//       // Tab cycles like your snippets UI (wrap)
//       e.preventDefault();
//       if (e.shiftKey) dxState.activeIndex = (dxState.activeIndex - 1 + maxVisible) % maxVisible;
//       else dxState.activeIndex = (dxState.activeIndex + 1) % maxVisible;
//       renderDxBox();
//       return;
//     }

//     if (e.key === "ArrowDown") {
//       e.preventDefault();
//       dxState.activeIndex = Math.min(dxState.activeIndex + 1, maxVisible - 1);
//       renderDxBox();
//       return;
//     }

//     if (e.key === "ArrowUp") {
//       e.preventDefault();
//       dxState.activeIndex = Math.max(dxState.activeIndex - 1, 0);
//       renderDxBox();
//       return;
//     }

//     if (e.key === "Enter") {
//       e.preventDefault();
//       chooseDx(dxState.activeIndex);
//       return;
//     }
//   });

//   input.addEventListener("blur", () => setTimeout(() => {
//     // only hide if focus didn't move into the box (mousedown prevents blur issues)
//     hideDxBox();
//   }, 120));
// }

// // one-time global listeners (NOT per input)
// document.addEventListener("mousedown", (e) => {
//   if (dxSuggestBox.classList.contains("hidden")) return;
//   if (dxState.input && (e.target === dxState.input || dxSuggestBox.contains(e.target))) return;
//   hideDxBox();
// });

// window.addEventListener("resize", () => {
//   if (!dxSuggestBox.classList.contains("hidden") && dxState.input) positionDxBox(dxState.input);
// });
// window.addEventListener("scroll", () => {
//   if (!dxSuggestBox.classList.contains("hidden") && dxState.input) positionDxBox(dxState.input);
// }, true);

function attachDxAutocomplete(input) {
  let box = null;
  let matches = [];
  let activeIndex = 0;

  const getSearchText = (d) => {
    const syn = Array.isArray(d.synonyms) ? d.synonyms.join(" ") : "";
    return `${d.icd10 || ""} ${d.en || ""} ${d.th || ""} ${syn}`.toLowerCase();
  };

  const close = () => {
    if (box) {
      box.remove();
      box = null;
    }
    matches = [];
    activeIndex = 0;
  };

  const highlight = () => {
    if (!box) return;
    const items = [...box.querySelectorAll(".dxSuggestItem")];
    items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
  };

  const choose = (idx) => {
    const d = matches[idx];
    if (!d) return;

    input.value = d.en || "";
    const tr = input.closest("tr");
    if (tr) {
      tr.dataset.icd10 = d.icd10 || "";
      tr.dataset.dxid = d.id || "";
    }
    close();
    input.dispatchEvent(new Event("input"));
  };

  const render = (q) => {
    close();
    if (q.length < 2) return;
    if (!DX_DB || !DX_DB.length) return;

    matches = DX_DB.filter((d) => getSearchText(d).includes(q)).slice(0, 8);
    if (!matches.length) return;

    box = document.createElement("div");
    box.className = "dxSuggestBox";

    matches.forEach((d, i) => {
      const item = document.createElement("div");
      item.className = "dxSuggestItem";
      item.textContent = `${d.icd10 || ""} ${d.en || ""} / ${d.th || ""}`.trim();

      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus
        choose(i);
      });

      box.appendChild(item);
    });

    activeIndex = 0;
    highlight();

    input.parentElement.style.position = "relative";
    input.parentElement.appendChild(box);
  };

  // --- input typing ---
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    render(q);
  });

  // --- keyboard control ---
  input.addEventListener("keydown", (e) => {
    if (!box || !matches.length) return;

    const max = matches.length;

    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, max - 1);
      highlight();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlight();
      return;
    }

    // Tab cycles (wrap) like your snippet UI
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) activeIndex = (activeIndex - 1 + max) % max;
      else activeIndex = (activeIndex + 1) % max;
      highlight();
      return;
    }

    // Enter inserts
    if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIndex);
      return;
    }
  });

  // --- close on outside click (ONE listener per input, but ok & simple) ---
  document.addEventListener("mousedown", (e) => {
    if (!box) return;
    if (e.target === input) return;
    if (box.contains(e.target)) return;
    close();
  });

  // --- close on blur (small delay so mousedown can choose) ---
  input.addEventListener("blur", () => setTimeout(close, 120));
}

function syncDxToPrint() {
  const area = getCurrentPrintArea();
  if (!area) return;

  const dxPrintList = area.querySelector("#dxPrintList");
  if (!dxPrintList) return;

  const rows = getDxRows({ sortByType: false });
  dxPrintList.innerHTML = "";

  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "-";
    dxPrintList.appendChild(li);
    return;
  }

  rows.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r.text;
    dxPrintList.appendChild(li);
  });
}

function addDxRow(data) {
  if (!dxTbody) return;
  dxTbody.appendChild(createDxRow(data));
  renumberDx();
  syncDxToPrint();
  saveDraft();
}

function loadDx(rows) {
  if (!dxTbody) return;
  dxTbody.innerHTML = "";
  if (!rows || rows.length === 0) {
    addDxRow({ text: "", type: "Primary" });
    return;
  }
  rows.forEach((r) => dxTbody.appendChild(createDxRow(r)));
  renumberDx();
  syncDxToPrint(); // Try adding this line into loadDx - Hope this work across template
  syncDxToPrint();
}

function syncDxRelatedPrint() {
  // always update OPD dx list (if present)
  syncDxToPrint();

  // also update MC/admit dx blocks (if present)
  const area = getCurrentPrintArea();
  if (!area) return;

  // ============== MC blocks (optional) ============== //

  const mcDxShort = area.querySelector("#mcDxShort");
  const mcFitNote = area.querySelector("#mcFitNote");

  const rows = getDxRows({ sortByType: true });
  const setText = (el, txt) => { if (el) el.textContent = txt ?? ""; };

  function joinThai(items) {
    const a = items.filter(Boolean);
    if (a.length === 0) return "-";
    if (a.length === 1) return a[0];
    if (a.length === 2) return `${a[0]} และ ${a[1]}`;
    return `${a.slice(0, -1).join(" ")} และ ${a[a.length - 1]}`;
  }

  function normKey(s) {
    return String(s || "").trim().toUpperCase();
  }

  function getThaiDxForRow(r) {
    const icd = normKey(r.icd10);
    const id = normKey(r.id);
    const typed = (r.text || "").trim();

    const obj =
      (dxByIcd10?.get && icd && dxByIcd10.get(icd)) ||
      (dxById?.get && id && dxById.get(id)) ||
      null;

    return obj?.mc?.th_short || obj?.th || typed || "";
  }

  if (rows.length) {
    const thList = rows.map(getThaiDxForRow).filter(Boolean);
    setText(mcDxShort, joinThai(thList));

    const primary = rows[0];
    const pIcd = normKey(primary.icd10);
    const pObj = dxByIcd10?.get ? dxByIcd10.get(pIcd) : null;

    // setText(mcDxFull, pObj?.mc?.th_full || "");
    setText(mcFitNote, pObj?.mc?.fit_note || "");
  } else {
    setText(mcDxShort, "-");
    // setText(mcDxFull, "");
    setText(mcFitNote, "");
  }

  // ============== Admission blocks (optional) ============== //

  // --- Admit list (optional) ---
  const dxAdmit = area.querySelector("#dxPrintList_admit");

  if (dxAdmit) {
    dxAdmit.innerHTML = "";
    const rr = getDxRows({ sortByType: false });
    console.log('event1');
    if (!rr.length) {
      const li = document.createElement("li");
      li.textContent = "-";
      dxAdmit.appendChild(li);
      console.log('event2');
    } else {
      rr.forEach((r) => {
        const li = document.createElement("li");
        li.textContent = r.text;
        dxAdmit.appendChild(li);
        console.log('event3');
      });
    }
  }
}

/* =========================================================
   Medication Table + Autosuggest
========================================================= */

const medTbody = $("medTbody");
const btnAddMed = $("btnAddMed");

const MED_COLS = ["drug", "dose", "route", "freq", "duration", "instruction"];

function getMedDisplayText(m) {
  const name = (m?.name || m?.drug || m?.label || "").toString();
  const strengths = Array.isArray(m?.dose) ? m.dose.join(", ") : m?.dose || "";
  const routes = Array.isArray(m?.route) ? m.route.join(", ") : m?.route || "";
  return [name, strengths, routes].filter(Boolean).join(" — ");
}

function createMedRow(data = {}) {
  const tr = document.createElement("tr");

  for (const col of MED_COLS) {
    const td = document.createElement("td");
    const inp = document.createElement("input");
    inp.value = data[col] ?? "";

    if (col === "drug") {
      inp.placeholder = "Type drug name...";
      attachMedAutocomplete(inp, tr);
    }

    inp.addEventListener("input", () => {
      syncMedToPrint();
      saveDraft();
    });

    td.appendChild(inp);
    tr.appendChild(td);
  }

  const tdDel = document.createElement("td");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Remove";
  btn.addEventListener("click", () => {
    tr.remove();
    syncMedToPrint();
    saveDraft();
  });
  tdDel.appendChild(btn);
  tr.appendChild(tdDel);

  return tr;
}

function getMedRows() {
  if (!medTbody) return [];
  const rows = [];

  for (const tr of medTbody.querySelectorAll("tr")) {
    const inputs = [...tr.querySelectorAll("input")];
    const row = {};
    MED_COLS.forEach((col, i) => (row[col] = (inputs[i]?.value ?? "").trim()));
    const hasAny = MED_COLS.some((c) => row[c]);
    if (hasAny) rows.push(row);
  }

  return rows;
}

function syncMedToPrint() {
  const area = getCurrentPrintArea();
  if (!area) return;

  const medPrintTbody = area.querySelector("#medPrintTbody");
  if (!medPrintTbody) return;

  const rows = getMedRows();
  medPrintTbody.innerHTML = "";

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "-";
    tr.appendChild(td);
    medPrintTbody.appendChild(tr);
    return;
  }

  rows.forEach((r, idx) => {
    const tr1 = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.colSpan = 6;

    const isOral = /^(po|oral)$/i.test((r.route || "").trim());

    const drugText =
      isOral && r.dose
        ? `${escapeHtml(r.drug)} (${escapeHtml(r.dose)})`
        : `${escapeHtml(r.drug)} ${escapeHtml(r.dose)}`;

    td1.innerHTML = `
      <div>
        <b>${idx + 1}.</b>
        ${drugText}
        ${r.duration ? `<span style="float:right">/${escapeHtml(r.duration)}</span>` : ""}
      </div>
      <div style="padding-left:18px">
        ${escapeHtml([r.freq, r.route].filter(Boolean).join(" "))}
        ${r.instruction ? escapeHtml(r.instruction) : ""}
      </div>
    `;

    tr1.appendChild(td1);
    medPrintTbody.appendChild(tr1);
  });
}

function addMedRow(data) {
  if (!medTbody) return;
  medTbody.appendChild(createMedRow(data));
  syncMedToPrint();
  saveDraft();
}

function loadMeds(rows) {
  if (!medTbody) return;
  medTbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    addMedRow({});
    return;
  }

  rows.forEach((r) => medTbody.appendChild(createMedRow(r)));
  syncMedToPrint();
}

function attachMedAutocomplete(input, rowEl) {
  let box = null;

  function removeBox() {
    if (box) {
      box.remove();
      box = null;
    }
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    removeBox();

    if (q.length < 1) return;
    if (!Array.isArray(MEDS_DB) || MEDS_DB.length === 0) return;

    const matches = MEDS_DB
      .filter((m) => (m?.name || "").toLowerCase().includes(q))
      .slice(0, 8);

    if (matches.length === 0) return;

    box = document.createElement("div");
    box.className = "medSuggestBox";

    matches.forEach((med) => {
      const item = document.createElement("div");
      item.className = "medSuggestItem";
      item.textContent = getMedDisplayText(med);

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applyMed(rowEl, med);
        removeBox();
      });

      box.appendChild(item);
    });

    input.parentElement.style.position = "relative";
    input.parentElement.appendChild(box);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && box) {
      e.preventDefault();
      const first = box.querySelector(".medSuggestItem");
      if (first) first.dispatchEvent(new MouseEvent("mousedown"));
    }
    if (e.key === "Escape") removeBox();
  });

  document.addEventListener(
    "click",
    (e) => {
      if (!box) return;
      if (e.target === input || box.contains(e.target)) return;
      removeBox();
    },
    true
  );
}

function applyMed(rowEl, med) {
  const inputs = rowEl.querySelectorAll("input");

  const strength = Array.isArray(med?.dose) ? med.dose[0] || "" : med?.dose || "";
  const route = Array.isArray(med?.route) ? med.route[0] || "" : med?.route || "";
  const form = Array.isArray(med?.forms) ? med.forms[0] || "" : med?.forms || "";

  const sig = med?.defaultSig || {};
  const sigDose = (sig.dose || "").trim();
  const sigFreq = (sig.freq || "").trim();
  const sigDur = (sig.duration || "").trim();
  const sigIns = (sig.instruction || "").trim();

  const map = {
    drug: med?.name || "",
    dose: strength,
    route: (route || "").toUpperCase(),
    freq: [sigDose, form, sigFreq]
      .filter(Boolean)
      .join(" ")
      .replace(/\b(Tab|Cap|Syr)\s+\1\b/gi, "$1"),
    duration: sigDur,
    instruction: sigIns,
  };

  rowEl.dataset.medName = med.name || "";
  rowEl.dataset.medClass = med.class || "";

  const warnings = checkMedicationRedundancy(med, rowEl);
  if (warnings.length > 0) {
    rowEl.classList.add("warn");
    rowEl.title = warnings.join("\n");
  } else {
    rowEl.classList.remove("warn");
    rowEl.title = "";
  }

  MED_COLS.forEach((col, i) => {
    if (map[col] !== undefined) inputs[i].value = map[col];
  });

  syncMedToPrint();
  saveDraft();
}

function checkMedicationRedundancy(newMed, currentRow) {
  const warnings = [];

  const newName = (newMed?.name || newMed?.drug || "").toLowerCase();
  const newClass = (newMed.class || "").toLowerCase().trim();

  if (!medTbody) return warnings;

  for (const tr of medTbody.querySelectorAll("tr")) {
    if (tr === currentRow) continue;

    const typedOldDrug = (tr.querySelector("input")?.value || "").trim();
    const oldName = (tr.dataset.medName || typedOldDrug || "").toLowerCase();
    const oldClass = (tr.dataset.medClass || "").toLowerCase().trim();

    if (newClass && oldClass && newClass === oldClass) {
      warnings.push(`Same drug class (${newMed.class})`);
    }
    if (newName && oldName && newName === oldName) {
      warnings.push(`Duplicate drug: ${newMed.name || typedOldDrug}`);
    }
  }

  return warnings;
}

/* =========================================================
   Templates apply
========================================================= */
function setFieldValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value ?? "";
  el.dispatchEvent(new Event("input"));
}

function normKey(s) {
  return String(s || "").trim().toLowerCase();
}

function norm(s) { return String(s || "").trim().toLowerCase(); }
function normU(s) { return String(s || "").trim().toUpperCase(); }

/* ---- Dx: template -> UI rows {text,type,icd10,id} ---- */
function normalizeTemplateDxList(dxList) {
  if (!Array.isArray(dxList)) return [];

  return dxList.map((item, idx) => {
    const fallbackType = idx === 0 ? "Primary" : "Secondary";

    // already object
    if (item && typeof item === "object") {
      const icd = normU(item.icd10);
      const id = normU(item.id);

      // try lookup by icd10 or id
      const obj =
        (icd && dxByIcd10?.get && dxByIcd10.get(icd)) ||
        (id && dxById?.get && dxById.get(id)) ||
        null;

      return {
        text: item.text || obj?.en || obj?.th || "",
        type: item.type || fallbackType,
        icd10: item.icd10 || obj?.icd10 || "",
        id: item.id || obj?.id || ""
      };
    }

    // string ref support (optional)
    const q = norm(String(item || ""));
    const byIcd = DX_DB.find(d => norm(d.icd10) === q);
    if (byIcd) return { text: byIcd.en || byIcd.th || "", type: fallbackType, icd10: byIcd.icd10, id: byIcd.id || "" };

    const byId = DX_DB.find(d => norm(d.id) === q);
    if (byId) return { text: byId.en || byId.th || "", type: fallbackType, icd10: byId.icd10 || "", id: byId.id || "" };

    // last resort: treat as typed text
    return { text: String(item || ""), type: fallbackType, icd10: "", id: "" };
  });
}

/* ---- Meds: template -> UI rows by using meds.json defaultSig etc ---- */
function buildMedRowFromDb(med) {
  const strength = Array.isArray(med?.dose) ? (med.dose[0] || "") : (med?.dose || "");
  const route = Array.isArray(med?.route) ? (med.route[0] || "") : (med?.route || "");
  const form = Array.isArray(med?.forms) ? (med.forms[0] || "") : (med?.forms || "");
  const sig = med?.defaultSig || {};

  const sigDose = (sig.dose || "").trim();
  const sigFreq = (sig.freq || "").trim();

  return {
    drug: med?.name || "",
    dose: strength,
    route: String(route || "").toUpperCase(),
    freq: [sigDose, form, sigFreq].filter(Boolean).join(" "),
    duration: (sig.duration || "").trim(),
    instruction: (sig.instruction || "").trim(),
  };
}

function normalizeTemplateMeds(meds) {
  if (!Array.isArray(meds)) return [];

  return meds.map((item) => {
    // already full row
    if (item && typeof item === "object" && ("drug" in item || "dose" in item || "route" in item)) {
      return item;
    }

    // {name, overrides}
    if (item && typeof item === "object" && item.name) {
      const med = MEDS_DB.find(m => norm(m.name) === norm(item.name));
      if (!med) return { drug: item.name, dose: "", route: "", freq: "", duration: "", instruction: "" };

      const row = buildMedRowFromDb(med);
      const ov = item.overrides || {};
      return { ...row, ...ov };
    }

    // "Diclofenac"
    const name = String(item || "").trim();
    const med = MEDS_DB.find(m => norm(m.name) === norm(name));
    if (!med) return { drug: name, dose: "", route: "", freq: "", duration: "", instruction: "" };

    return buildMedRowFromDb(med);
  });
}

/* =========================================================
   Auto-Update Medical Certificate
========================================================= */
function syncMcAutoFields() {
  const area = getCurrentPrintArea();
  if (!area) return;

  // run only when MC template is active
  if (currentPrintAreaId !== "printArea-mc") return;

  // Base time = visitDt (fallback to now if empty/invalid)
  const visitDtEl = document.getElementById("visitDt");
  let base = visitDtEl?.value ? new Date(visitDtEl.value) : new Date();
  if (isNaN(base)) base = new Date();

  // เวลา "มารับการตรวจ" = visitDt - 20 นาที
  const visitTime = new Date(base.getTime() - 20 * 60 * 1000);

  // วันที่ในใบรับรอง (ให้เป็นวันของ visitDt)
  const certDateStr = formatThaiDateFromDate(base);

  // 1) เติมวันที่/เวลาใน MC template
  area.querySelectorAll('[data-bind="certDt"]').forEach(t => t.textContent = certDateStr);
  area.querySelectorAll('[data-bind="seenDt"]').forEach(t => t.textContent = certDateStr);
  area.querySelectorAll('[data-bind="certTime"]').forEach(t => t.textContent = formatThaiTimeFromDate(visitTime));

  // 2) ใช้ duration ของยา "ใบรับรองแพทย์ (Medical certificate)" เป็นวันพัก
  const medRows = getMedRows();
  const certMed = medRows.find(r => {
    const drug = (r.drug || "").toLowerCase();
    return drug.includes("ใบรับรองแพทย์") || drug.includes("Medical Certificate");
  });

  const days = parseInt(certMed?.duration, 10);
  if (!Number.isFinite(days) || days <= 0) return;

  // mcFrom = วันที่ของ visitDt, mcTo = visitDt + (days-1)
  const fromDate = new Date(base);
  fromDate.setHours(0, 0, 0, 0);

  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + (days - 1));

  area.querySelectorAll('[data-bind="mcRestDays"]').forEach(t => t.textContent = String(days));
  area.querySelectorAll('[data-bind="mcFrom"]').forEach(t => t.textContent = formatThaiDateFromDate(fromDate));
  area.querySelectorAll('[data-bind="mcTo"]').forEach(t => t.textContent = formatThaiDateFromDate(toDate));
}


function applyTemplate(key) {
  const t = templates?.[key] ?? templates?.blank ?? { fields: {}, dxList: [], meds: [] };

  if (t.fields) {
    Object.entries(t.fields).forEach(([id, val]) => setFieldValue(id, val));
  }

  loadDx(normalizeTemplateDxList(t.dxList ?? []));
  loadMeds(normalizeTemplateMeds(t.meds ?? []));


  saveDraft();
}

// if (currentPrintAreaId === "printArea-mc") {
//   if (typeof syncMcAutoFields === "function") syncMcAutoFields();
//   syncMcRestFromMedAndVisitDt();
// }

// syncMcAutoFields();
// syncMcRestFromMedAndVisitDt();

/* =========================================================
   Draft persistence
========================================================= */
const DRAFT_KEY = "opd_note_draft_v1";

function collectDraft() {
  const data = {
    fields: {},
    dxList: getDxRows({ sortByType: false }),
    meds: getMedRows(),
    template: templateSelect?.value ?? "blank",
    printMode: printMode?.value ?? "opd",
  };

  for (const id of BIND_FIELDS) {
    const el = $(id);
    if (!el) continue;
    data.fields[id] = el.value ?? "";
  }

  return data;
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft()));
  } catch {
    // ignore
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);

    // restore fields
    if (data?.fields) {
      Object.entries(data.fields).forEach(([id, val]) => setFieldValue(id, val));
    }

    // restore dx + meds (✅ use data, not t)
    loadDx(normalizeTemplateDxList(data?.dxList ?? []));
    loadMeds(normalizeTemplateMeds(data?.meds ?? []));

    if (templateSelect && data?.template) templateSelect.value = data.template;
    if (printMode && data?.printMode) printMode.value = data.printMode;

    return true;
  } catch (e) {
    console.warn("loadDraft failed:", e);
    return false;
  }
}

/* =========================================================
   Print ONLY current template area
========================================================= */

// Print Only Quote Functions

// const btnPrint = $("btnPrint");

function applyPrintMask(root) {
  if (!root) return;

  const QUOTED_RE = /(["“”][^"“”]*["“”]|['‘’][^'‘’]*['‘’])/g;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach(node => {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;

    const parts = text.split(QUOTED_RE);
    if (parts.length === 1) return;

    const frag = document.createDocumentFragment();

    for (const p of parts) {
      if (p === "") continue;

      const span = document.createElement("span");

      // IMPORTANT: because QUOTED_RE is /g, test() changes state
      QUOTED_RE.lastIndex = 0;
      const isQuoted = QUOTED_RE.test(p) && p.length >= 2;

      span.className = isQuoted ? "print-keep" : "print-hide";
      span.textContent = p; // ✅ keep quotes included
      frag.appendChild(span);
    }

    node.parentNode.replaceChild(frag, node);
  });
}

/* =========================================================
   Init
========================================================= */

async function init() {
  // ---------- Load databases ----------
  await loadTemplatesGS();
  await loadSnippetsDB();
  await loadMedsGS();
  await loadAllDatabases();
  useGoogleDxAsMainDb();

  // ---------- Bind core UI ----------
  bindPreviewFields();
  bindChronicUI();
  syncChronicToPrint();

  initStickyDefault("physician");
  initStickyDefault("license");

  const hasDraft = loadDraft();

  // ---------- Print mode / template ----------
  if (printMode) {
    printMode.addEventListener("change", async (e) => {
      await loadPrintTemplate(e.target.value);
      // keep preview in sync after template swap
      syncAllPrint(e.target.value || "opd");
    });

    await loadPrintTemplate(printMode.value || "opd");
  }

  // ---------- Add row buttons ----------
  if (btnAddDx) btnAddDx.addEventListener("click", () => addDxRow({}));
  if (btnAddMed) btnAddMed.addEventListener("click", () => addMedRow({}));

  // ---------- Template dropdown ----------
  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => {
      applyTemplate(e.target.value);
      syncAllPrint(printMode?.value || "opd");
      saveDraft();
    });
  }

  // // ---------- Draft vs fresh start ----------
  // if (!hasDraft) {
  //   const startTemplate = templateSelect?.value ?? "blank";
  //   applyTemplate(startTemplate);
  // } else {
  //   renumberDx();
  // }

  // ---------- Visit datetime ----------
  initVisitDtDefault(false);

  const visitDt = document.getElementById("visitDt");
  if (visitDt) {
    const onVisitDt = () => {
      syncMcAutoFields();
      saveDraft();
      syncAllPrint(printMode?.value || "opd");
    };
    visitDt.addEventListener("input", onVisitDt);
    visitDt.addEventListener("change", onVisitDt);
  }

  // ---------- Snippet autocomplete ----------
  bindSnippetAutocomplete(document.getElementById("hpi"));
  bindSnippetAutocomplete(document.getElementById("pe"));

  // ---------- Print button ----------
  if (btnPrint) {
    btnPrint.addEventListener("click", () => {
      const mode = printMode?.value || "opd";
      syncAllPrint(mode);
      saveDraft();
      document.body.dataset.printMode = mode;
      window.print();
    });
  }

  // ---------- Print mask (quoted-only) ----------
  // --- Print mask (quoted-only): wire after DOM exists ---
  const printMaskToggle = document.getElementById("printMaskToggle");
  let _printHostBackup = null;

  window.addEventListener("beforeprint", () => {
    if (!printMaskToggle?.checked) return;

    const host = document.getElementById("printHost");
    if (!host) return;

    _printHostBackup = host.innerHTML;

    document.body.classList.add("print-mask");

    const area =
      (typeof getCurrentPrintArea === "function" && getCurrentPrintArea()) || host;

    applyPrintMask(area);
  });

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-mask");

    const host = document.getElementById("printHost");
    if (!host) return;

    if (_printHostBackup != null) {
      host.innerHTML = _printHostBackup;
      _printHostBackup = null;

      // restore bindings after DOM replace
      bindPreviewFields();
      syncAllPrint(printMode?.value || "opd");
    }
  });

  // ---------- Draft saving for inputs ----------
  for (const id of BIND_FIELDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  }

  // ---------- Ensure at least 1 row exists ----------
  if (getDxRows().length === 0) loadDx([]);
  if (getMedRows().length === 0) loadMeds([]);

  // ---------- Final sync ----------
  syncAllPrint(printMode?.value || "opd");
}

document.addEventListener("DOMContentLoaded", () => init());

