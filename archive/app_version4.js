/* =========================================================
   app.js (fixed + JSON adapters)
   - Live bind form -> print template
   - Sticky default physician + license (localStorage)
   - Templates loaded from data/templates.json (dropdown auto-populated)
   - Med DB loaded from data/medications.json (supports your schema:
       { name, dose:[...], route:[...], forms:[...], defaultSig:{...} })
   - Dx list + Med table
   - Print ONLY the template (#printArea)
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
  "vitals",
  "pe",
  "plan",
  "investigation",
  "physician",
  "license",
];

// ✅ Print Mode selection OPD-MedCertificate-Admission Note
const printMode = $("printMode");
const btnSaveCase = $("btnSaveCase");
const btnLoadLatest = $("btnLoadLatest");

const PRINT_AREAS = {
  opd: "printArea-opd",
  admit: "printArea-admit",
  mc: "printArea-mc",
};

function setPrintMode(mode) {
  const keys = Object.keys(PRINT_AREAS);

  keys.forEach((k) => {
    const el = $(PRINT_AREAS[k]);
    if (el) el.style.display = k === mode ? "block" : "none";
  });

  // Sync extra print parts per mode
  syncAllPrint(mode);
}

function syncAllPrint(mode = (printMode?.value || "opd")) {
  // OPD main
  renumberDx();
  syncDxToPrint();
  syncMedToPrint();

  // Admission (if present)
  const dxAdmit = $("dxPrintList_admit");
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
        li.textContent = r.text; // English only
        dxAdmit.appendChild(li);
      });
    }
  }

  const medAdmit = $("medPrintTbody_admit");
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
        td.innerHTML = `<b>${idx + 1}.</b> ${escapeHtml(r.drug)} ${escapeHtml(r.dose)} ${escapeHtml(r.freq)} ${escapeHtml(r.route)} ${r.duration ? "/" + escapeHtml(r.duration) : ""} ${escapeHtml(r.instruction)}`;
        tr.appendChild(td);
        medAdmit.appendChild(tr);
      });
    }
  }

  // Medical certificate diagnosis (take Primary or first Dx, English only)
  const mcDxText = $("mcDxText");
  if (mcDxText) {
    const rows = getDxRows({ sortByType: true });
    const best = rows[0]?.text?.trim();
    mcDxText.textContent = best || "-";
  }
}

function bindPreviewFields() {
  for (const id of BIND_FIELDS) {
    const input = $(id);
    if (!input) continue;

    const targets = document.querySelectorAll(`[data-bind="${id}"]`);
    const update = () => {
  let val = (input.value ?? "").trim();

  function setPrintMode(mode) {
  const keys = Object.keys(PRINT_AREAS);

  keys.forEach((k) => {
    const el = $(PRINT_AREAS[k]);
    if (el) el.style.display = k === mode ? "block" : "none";
  });

  // Sync extra print parts per mode
  syncAllPrint(mode);
}


  // ✅ Default text ONLY when blank (print/preview)
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
   Databases: Meds + Templates (JSON)
========================================================= */
let MED_DB = [];
let DX_DB = [];
let templates = {};

async function loadMedicationDB() {
  try {
    const res = await fetch("./data/medications.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    MED_DB = Array.isArray(data) ? data : [];
    console.log("Loaded meds:", MED_DB.length);
  } catch (err) {
    console.warn("Could not load medications.json. Using empty list.", err);
    MED_DB = [];
  }
}

async function loadTemplatesDB() {
  try {
    const res = await fetch("./data/templates.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    templates = await res.json();
    console.log("Loaded templates:", Object.keys(templates).length);
  } catch (err) {
    console.warn("Could not load templates.json. Using blank only.", err);
    templates = { blank: { fields: {}, dxList: [], meds: [] } };
  }
}

async function loadDiseaseDB() {
  try {
    const res = await fetch("./data/icd10dx.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    DX_DB = Array.isArray(data) ? data : [];
    console.log("Loaded diseases:", DX_DB.length);
  } catch (err) {
    console.warn("Could not load diseases.json. Using empty list.", err);
    DX_DB = [];
  }
}

/* =========================================================
   Templates dropdown (from templates.json)
========================================================= */
const templateSelect = $("templateSelect");

function populateTemplateDropdown() {
  if (!templateSelect) return;

  const keys = Object.keys(templates || {});
  if (keys.length === 0) return;

  const current = templateSelect.value;
  templateSelect.innerHTML = "";

  keys.sort((a, b) => {
    if (a === "blank") return -1;
    if (b === "blank") return 1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key; // you can prettify later
    templateSelect.appendChild(opt);
  }

  if (current && keys.includes(current)) templateSelect.value = current;
  else if (keys.includes("blank")) templateSelect.value = "blank";
  else templateSelect.value = keys[0];
}

/* =========================================================
   Dx List
========================================================= */
const dxTbody = $("dxTbody");
const dxPrintList = $("dxPrintList");
const btnAddDx = $("btnAddDx");

function createDxRow({ text = "", type = "Primary" } = {}) {
  const tr = document.createElement("tr");

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
    syncDxToPrint();
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
    syncDxToPrint();
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
    syncDxToPrint();
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
    if (text) rows.push({ text, type });
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

  const close = () => { if (box) { box.remove(); box = null; } };

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    close();
    if (q.length < 2) return;
    if (!DX_DB.length) return;

    const matches = DX_DB
      .filter(d => getSearchText(d).includes(q))
      .slice(0, 8);

    if (!matches.length) return;

    box = document.createElement("div");
    box.className = "dxSuggestBox";

    matches.forEach(d => {
      const item = document.createElement("div");
      item.className = "dxSuggestItem";
      item.textContent = `${d.icd10 || ""} ${d.en || ""} / ${d.th || ""}`.trim();

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        // what gets inserted into Dx list:
        input.value = `${d.en}${d.icd10 ? ` (${d.icd10})` : ""}`;
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

function syncDxToPrint() {
  if (!dxPrintList) return;

  const rows = getDxRows({ sortByType: false });
  dxPrintList.innerHTML = "";

  if (rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "-";
    dxPrintList.appendChild(li);
    return;
  }

  for (const r of rows) {
    const li = document.createElement("li");
    li.textContent = r.text;
    dxPrintList.appendChild(li);
  }
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
  syncDxToPrint();
}

/* =========================================================
   Medication Table + Autosuggest
========================================================= */
const medTbody = $("medTbody");
const medPrintTbody = $("medPrintTbody");
const btnAddMed = $("btnAddMed");

const MED_COLS = ["drug", "dose", "route", "freq", "duration", "instruction"];

// Your JSON schema helper: { name, dose:[...], route:[...], forms:[...], defaultSig:{...} }
function getMedDisplayText(m) {
  const name = (m?.name || m?.drug || m?.label || "").toString();
  const strengths = Array.isArray(m?.dose) ? m.dose.join(", ") : (m?.dose || "");
  const routes = Array.isArray(m?.route) ? m.route.join(", ") : (m?.route || "");
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

    // suggestions only when typing (1+ char)
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

// Adapter: convert your JSON med -> row fields
function applyMed(rowEl, med) {
  const inputs = rowEl.querySelectorAll("input");

  const strength = Array.isArray(med?.dose) ? (med.dose[0] || "") : (med?.dose || "");
  const route = Array.isArray(med?.route) ? (med.route[0] || "") : (med?.route || "");
  const form = Array.isArray(med?.forms) ? (med.forms[0] || "") : (med?.forms || "");

  const sig = med?.defaultSig || {};
  const sigDose = (sig.dose || "").trim();       // e.g. "1 Tab"
  const sigFreq = (sig.freq || "").trim();       // e.g. "q 8 hrs prn"
  const sigDur = (sig.duration || "").trim();    // e.g. "5 days"
  const sigIns = (sig.instruction || "").trim();

  // Build row fields
  const map = {
    drug: med?.name || "",
    dose: strength,
    route: (route || "").toUpperCase(),
    // If defaultSig.dose already includes Tab/Cap, avoid duplicating with form
    freq: [sigDose, form, sigFreq].filter(Boolean).join(" ").replace(/\b(Tab|Cap|Syr)\s+\1\b/gi, "$1"),
    duration: sigDur,
    instruction: sigIns,
  };

  rowEl.dataset.medName = med.name || "";
  rowEl.dataset.medClass = med.class || "";

  const warnings = checkMedicationRedundancy(med, rowEl);
  
  if (warnings.length > 0) {
  rowEl.classList.add("warn");
  rowEl.title = warnings.join("\n");
}


  MED_COLS.forEach((col, i) => {
    if (map[col] !== undefined) inputs[i].value = map[col];
  });

  syncMedToPrint();
  saveDraft();
}

function checkMedicationRedundancy(newMed, currentRow) {
  const warnings = [];

  const newName = ((newMed?.name || newMed?.drug || "")).toLowerCase();
  const newClass = (newMed.class || "").toLowerCase().trim();

  if (!medTbody) return warnings;

  for (const tr of medTbody.querySelectorAll("tr")) {
    if (tr === currentRow) continue;

    // Fallback: if dataset is missing, read from the first input (drug column)
    const typedOldDrug = (tr.querySelector("input")?.value || "").trim();

    const oldName = ((tr.dataset.medName || typedOldDrug || "")).toLowerCase();
    const oldClass = (tr.dataset.medClass || "").toLowerCase().trim();


    // B) Same class
    if (newClass && oldClass && newClass === oldClass) {
      warnings.push(`Same drug class (${newMed.class})`);
    }
    // A) Same drug name
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

function applyTemplate(key) {
  const t =
    templates?.[key] ??
    templates?.blank ??
    { fields: {}, dxList: [], meds: [] };

  if (t.fields) {
    Object.entries(t.fields).forEach(([id, val]) => setFieldValue(id, val));
  }

  loadDx(t.dxList ?? []);
  loadMeds(t.meds ?? []);

  saveDraft();
}

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
    const data = collectDraft();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);

    if (data?.fields) {
      Object.entries(data.fields).forEach(([id, val]) =>
        setFieldValue(id, val)
      );
    }

    loadDx(data?.dxList ?? []);
    loadMeds(data?.meds ?? []);

    if (templateSelect && data?.template) {
      templateSelect.value = data.template;
    }

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   Print ONLY template (#printArea)
========================================================= */
const btnPrint = $("btnPrint");

function printOnly(elementId) {
  const el = $(elementId);
  if (!el) return;

  const cssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => `<link rel="stylesheet" href="${l.href}">`)
    .join("\n");

  const w = window.open("", "_blank", "width=900,height=650");
  if (!w) return;

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
}

/* =========================================================
   Init
========================================================= */
async function init() {
  // Load JSON first (prevents empty dropdown / empty autosuggest)
  await loadMedicationDB();
  await loadDiseaseDB();
  await loadTemplatesDB();

  // Build dropdown from templates.json
  populateTemplateDropdown();

  // Bind preview
  bindPreviewFields();

  // Sticky defaults
  initStickyDefault("physician");
  initStickyDefault("license");

  if (printMode) {
  printMode.addEventListener("change", (e) => {
    setPrintMode(e.target.value);
  });

  // set initial visible template
  setPrintMode(printMode.value || "opd");
}

  // Dx + Med buttons
  if (btnAddDx) btnAddDx.addEventListener("click", () => addDxRow({}));
  if (btnAddMed) btnAddMed.addEventListener("click", () => addMedRow({}));

  // Template select
  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => {
      applyTemplate(e.target.value);
    });
  }

  // Print
  if (btnPrint) {
  btnPrint.addEventListener("click", () => {
    const mode = printMode?.value || "opd";
    syncAllPrint(mode);
    saveDraft();

    const areaId = PRINT_AREAS[mode] || PRINT_AREAS.opd;
    printOnly(areaId);
  });
}

syncAllPrint(printMode?.value || "opd");


  // Save draft on normal field changes
  for (const id of BIND_FIELDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  }

  // Load draft first; else apply selected template
  const hasDraft = loadDraft();
  if (!hasDraft) {
    const startTemplate = templateSelect?.value ?? "blank";
    applyTemplate(startTemplate);
  } else {
    renumberDx();
    syncDxToPrint();
    syncMedToPrint();
  }

  if (getDxRows().length === 0) loadDx([]);
  if (getMedRows().length === 0) loadMeds([]);
}

document.addEventListener("DOMContentLoaded", () => init());
