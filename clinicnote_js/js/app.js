/* =========================================================
   app.js (Main)
   NOTE: Database loaders moved to js/db.js
   Ensure index.html loads db.js BEFORE this file.
========================================================= */
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

// ----------------------------
// Snippet DB (from JSON)
// ----------------------------
let SNIPPETS = []; // [{key,text,tags}]
let snipByKey = new Map(); // key -> snippet

/* =========================================================
   Google Sheets DB (Apps Script Web App)
   - Set your Apps Script Web App URL below
   - Each request pulls from one sheet by name: templates / icd10dx / snippets / medications
========================================================= */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyYphzuGjAehFjFYr4Y9F3wv9-4Qn2Te4ib_m8jZA9asipAd5O2Va4StYNIQP1Ds2e6Wg/exec";
const GAS_KEY = "clinicnote-9f3a7c2e-1c6a-4e9a-bb81-8e5c0d7a91af"; // optional shared key (your script may ignore it)

async function fetchSheet(sheetName) {
  const u = new URL(GAS_URL);

  // Common patterns your Apps Script can read:
  u.searchParams.set("sheet", sheetName);
  u.searchParams.set("key", GAS_KEY);

  // cache-bust so Sheet edits show immediately
  u.searchParams.set("_t", String(Date.now()));

  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const payload = await res.json();

  // Accept multiple response shapes:
  // 1) [ {...}, {...} ]
  // 2) { data: [ ... ] } or { rows: [ ... ] }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;

  // Sometimes your API might return {templates:{...}} etc.
  // In that case, return the object and let each loader handle it.
  if (payload && typeof payload === "object") return payload;

  return [];
}


async function loadSnippetsDB() {
  try {
    const rows = await fetchSheet("snippets");

    // Expect columns (recommended): key | text | tags
    SNIPPETS = (Array.isArray(rows) ? rows : [])
      .filter(s => s && (s.key || s.Key) && (s.text || s.Text))
      .map(s => {
        const key = String(s.key ?? s.Key ?? "").trim().toLowerCase();
        const text = String(s.text ?? s.Text ?? "");
        const rawTags = s.tags ?? s.Tags ?? "";

        let tags = [];
        if (Array.isArray(rawTags)) {
          tags = rawTags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
        } else if (typeof rawTags === "string") {
          const t = rawTags.trim();
          // allow JSON array text or "a,b,c"
          if (t.startsWith("[") && t.endsWith("]")) {
            try {
              tags = JSON.parse(t).map(x => String(x).trim().toLowerCase()).filter(Boolean);
            } catch {
              tags = [];
            }
          } else {
            tags = t.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
          }
        }

        return { key, text, tags };
      });

    snipByKey = new Map(SNIPPETS.map(s => [s.key, s]));
    console.log("Loaded snippets (sheet):", SNIPPETS.length);
  } catch (err) {
    console.warn("Could not load snippets from Google Sheet. Using empty snippet list.", err);
    SNIPPETS = [];
    snipByKey = new Map();
  }
}

// Call this in init() along with loadTemplatesDB/loadDiseaseDB
// await loadSnippetsDB();


// ----------------------------
// Snippet autocomplete UI
// ----------------------------
const snippetBox = document.getElementById("snippetBox");
let snipState = {
  ta: null,
  matches: [],
  activeIndex: 0,
  currentToken: ""
};

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

function rankMatches(token, list) {
  // ranking: exact key, startsWith key, includes key, then tags
  const t = token.toLowerCase();
  return list
    .map(s => {
      const key = s.key;
      let score = 0;
      if (key === t) score += 1000;
      if (key.startsWith(t)) score += 500;
      if (key.includes(t)) score += 200;
      // tiny boost if token matches a tag
      if (s.tags?.some(tag => tag.includes(t))) score += 50;
      // shorter key slightly preferred
      score += Math.max(0, 30 - key.length);
      return { s, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
}

function renderSnippetBox() {
  const { matches, activeIndex } = snipState;
  if (!matches.length) return hideSnippetBox();

  const itemsHtml = matches.slice(0, 8).map((m, i) => {
    const cls = i === activeIndex ? "snip-item active" : "snip-item";
    return `
      <div class="${cls}" data-idx="${i}" role="option" aria-selected="${i === activeIndex}">
        <span class="snip-key">${m.key}</span>
        <span class="snip-text">${escapeHtml(m.text)}</span>
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
  if (!ta || !matches[idx]) return;
  replaceLastToken(ta, matches[idx].text);
  hideSnippetBox();
}

function updateSnippetMatches(textarea) {
  const tokenRaw = getLastToken(textarea.value, textarea.selectionStart);
  const token = String(tokenRaw || "").trim().toLowerCase();

  // Only trigger when token has at least 2 chars (adjust as you like)
  if (token.length < 2) return hideSnippetBox();

  // Find matches by key partial OR tag partial
  const filtered = SNIPPETS.filter(s =>
    s.key.includes(token) || (s.tags && s.tags.some(tag => tag.includes(token)))
  );

  if (!filtered.length) return hideSnippetBox();

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
        // Shift+Tab = previous (wrap)
        snipState.activeIndex = (snipState.activeIndex - 1 + maxVisible) % maxVisible;
      } else {
        // Tab = next (wrap)
        snipState.activeIndex = (snipState.activeIndex + 1) % maxVisible;
      }
      renderSnippetBox();
      return;
    }

    // Arrow keys still work (no wrap, or you can wrap if you want)
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
        if (id === "homeMeds") val = "ไม่มียาที่ใช้อยู่เป็นประจำ";
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

function attachDxAutocomplete(input) {
  let box = null;

  const getSearchText = (d) => {
    const syn = Array.isArray(d.synonyms) ? d.synonyms.join(" ") : "";
    return `${d.icd10 || ""} ${d.en || ""} ${d.th || ""} ${syn}`.toLowerCase();
  };

  const close = () => {
    if (box) {
      box.remove();
      box = null;
    }
  };

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    close();
    if (q.length < 2) return;
    if (!DX_DB.length) return;

    const matches = DX_DB.filter((d) => getSearchText(d).includes(q)).slice(0, 8);
    if (!matches.length) return;

    box = document.createElement("div");
    box.className = "dxSuggestBox";

    matches.forEach((d) => {
      const item = document.createElement("div");
      item.className = "dxSuggestItem";
      item.textContent = `${d.icd10 || ""} ${d.en || ""} / ${d.th || ""}`.trim();

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = d.en || "";
        const tr = input.closest("tr");
        if (tr) {
          tr.dataset.icd10 = d.icd10 || ""; // "S09.90"
          tr.dataset.dxid = d.id || "";    // "S09.90-LR"
        }
        close();
        input.dispatchEvent(new Event("input"));
      });

      box.appendChild(item);
    });

    input.parentElement.style.position = "relative";
    input.parentElement.appendChild(box);
  });

  document.addEventListener("click", close);
}

// ✅ FIX: scoped to current print area
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
    if (!Array.isArray(MED_DB) || MED_DB.length === 0) return;

    const matches = MED_DB
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
      const med = MED_DB.find(m => norm(m.name) === norm(item.name));
      if (!med) return { drug: item.name, dose: "", route: "", freq: "", duration: "", instruction: "" };

      const row = buildMedRowFromDb(med);
      const ov = item.overrides || {};
      return { ...row, ...ov };
    }

    // "Diclofenac"
    const name = String(item || "").trim();
    const med = MED_DB.find(m => norm(m.name) === norm(name));
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
const btnPrint = $("btnPrint");

// function printOnly(elementId) {
//   const el = document.getElementById(elementId);
//   if (!el) return;

//   // Use a hidden iframe (more reliable than window.open, less likely to be blocked)
//   let frame = document.getElementById("__printFrame");
//   if (!frame) {
//     frame = document.createElement("iframe");
//     frame.id = "__printFrame";
//     frame.style.position = "fixed";
//     frame.style.right = "0";
//     frame.style.bottom = "0";
//     frame.style.width = "0";
//     frame.style.height = "0";
//     frame.style.border = "0";
//     frame.style.visibility = "hidden";
//     document.body.appendChild(frame);
//   }

//   const cssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
//     .map((l) => `<link rel="stylesheet" href="${l.href}">`)
//     .join("\n");

//   const doc = frame.contentDocument || frame.contentWindow?.document;
//   if (!doc) return;

//   doc.open();
//   doc.write(`<!doctype html>
// <html lang="th">
// <head>
//   <meta charset="utf-8" />
//   <meta name="viewport" content="width=device-width,initial-scale=1" />
//   ${cssLinks}
//   <style>
//     body { margin:0; background:#fff; }
//     .no-print { display:none !important; }
//   </style>
// </head>
// <body>
//   ${el.outerHTML}
// </body>
// </html>`);
//   doc.close();

//   const win = frame.contentWindow;
//   if (!win) return;

//   const doPrint = () => {
//     win.focus();
//     win.print();
//   };

//   // If fonts API exists, wait for it (helps Sarabun load before print)
//   const fonts = doc.fonts;
//   if (fonts && typeof fonts.ready?.then === "function") {
//     fonts.ready.then(() => setTimeout(doPrint, 50)).catch(() => setTimeout(doPrint, 50));
//   } else {
//     setTimeout(doPrint, 80);
//   }
// }

function printOnly(elementId) {
  const el = $(elementId);
  if (!el) return false;

  const cssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => `<link rel="stylesheet" href="${l.href}">`)
    .join("\n");

  const w = window.open("", "_blank", "width=900,height=650");
  if (!w) return false; // <-- popup blocked

  w.document.open();
  w.document.write(`
    <!doctype html>
    <html lang="th">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        ${cssLinks}
        <style>
          body { margin:0; background:#fff; }
          .no-print { display:none !important; }
        </style>
      </head>
      <body>
        ${el.outerHTML}
      </body>
    </html>
  `);
  w.document.close();

  w.onload = () => {
    w.focus();
    w.print();
    w.onafterprint = () => w.close();
  };

  return true;
}

/* =========================================================
   Init
========================================================= */
async function init() {
  await loadDiseaseDB();
  await loadMedicationDB();
  await loadTemplatesDB();
  await loadSnippetsDB();

  populateTemplateDropdown();
  bindPreviewFields();
  bindChronicUI();
  syncChronicToPrint();

  initStickyDefault("physician");
  initStickyDefault("license");

  const hasDraft = loadDraft();

  if (printMode) {
    printMode.addEventListener("change", async (e) => {
      await loadPrintTemplate(e.target.value);
    });

    await loadPrintTemplate(printMode.value || "opd");
  }

  if (btnAddDx) btnAddDx.addEventListener("click", () => addDxRow({}));
  if (btnAddMed) btnAddMed.addEventListener("click", () => addMedRow({}));

  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => {
      applyTemplate(e.target.value);
    });
  }

  if (!hasDraft) {
    const startTemplate = templateSelect?.value ?? "blank";
    applyTemplate(startTemplate);
  } else {
    renumberDx();
    syncAllPrint(printMode?.value || "opd");
  }

  initVisitDtDefault(false);
  // Bind your fields after DOM is ready / init
  bindSnippetAutocomplete(document.getElementById("hpi"));
  bindSnippetAutocomplete(document.getElementById("pe"));

  const visitDt = document.getElementById("visitDt");
  if (visitDt) {
    visitDt.addEventListener("input", () => {
      syncMcAutoFields();
      saveDraft();
    });
    visitDt.addEventListener("change", () => {
      syncMcAutoFields();
      saveDraft();
    });
  }

  if (btnPrint) {
    btnPrint.addEventListener("click", () => {
      const mode = printMode?.value || "opd";
      syncAllPrint(mode);
      saveDraft();
      document.body.dataset.printMode = mode;
      window.print();   // ✅ reliable
    });
  }

  for (const id of BIND_FIELDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  }

  if (getDxRows().length === 0) loadDx([]);
  if (getMedRows().length === 0) loadMeds([]);

  syncAllPrint(printMode?.value || "opd");
}

document.addEventListener("DOMContentLoaded", () => init());
