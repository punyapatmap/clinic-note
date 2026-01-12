/* =========================================================
   app.js
   - Live bind form -> preview templates (OPD / Admission / Medical Certificate)
   - Sticky default physician + license (localStorage)
   - Dx list (numbered)
   - Med table + autocomplete (supports JSON med schema)
   - Print ONLY current preview (#printHost)
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

function normalizeSpaces(s) {
  return (s ?? "").toString().replace(/\s+/g, " ").trim();
}

function firstFromArray(v) {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/* -------------------------
   DOM handles (static)
------------------------- */
const templateSelect = $("templateSelect");
const btnPrint = $("btnPrint");
const printHost = $("printHost");
const printMode = $("printMode");
const btnFormat = $("btnFormat");

/* -------------------------
   Field binding
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

const FALLBACK_TEXT = {
  pmh: "- ปฏิเสธโรคประจำตัว",
  homeMeds: "- ไม่มียาที่ใช้อยู่เป็นประจำ",
};

function bindPreviewFields() {
  for (const id of BIND_FIELDS) {
    const input = $(id);
    if (!input) continue;

    const update = () => {
      let val = (input.value ?? "").trim();
      if (!val && (id === "pmh" || id === "homeMeds")) {
        val = FALLBACK_TEXT[id];
      }

      // NOTE: query targets every time so it works even if preview template changes
      const targets = document.querySelectorAll(`[data-bind="${id}"]`);
      targets.forEach((t) => (t.textContent = val));

      // Dx/Med previews may rely on these too
      syncAllPrint();
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
   Preview Template Loader
   - Loads HTML into #printHost
========================================================= */
const PRINT_TEMPLATES = {
  opd: "./data/print_templates/opd.html",
  admit: "./data/print_templates/admit.html",
  mc: "./data/print_templates/mc.html",
};

let currentPrintMode = "opd";

async function loadPrintTemplate(mode) {
  if (!printHost) return;

  const m = PRINT_TEMPLATES[mode] ? mode : "opd";
  currentPrintMode = m;

  try {
    const res = await fetch(PRINT_TEMPLATES[m], { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    printHost.innerHTML = html;
  } catch (err) {
    console.warn("Could not load print template. Using empty.", err);
    printHost.innerHTML = `<div class="note noteA4"><div style="padding:20mm">Template load failed</div></div>`;
  }

  // Re-bind and re-sync after DOM changed
  bindPreviewFields();
  syncAllPrint();
}

/* =========================================================
   Dx List
========================================================= */
const dxTbody = $("dxTbody");
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
    syncAllPrint();
    saveDraft();
  });
  tdText.appendChild(inp);
  tr.appendChild(tdText);

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
    syncAllPrint();
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
    syncAllPrint();
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

function getDxRows() {
  if (!dxTbody) return [];

  const rows = [];
  for (const tr of dxTbody.querySelectorAll("tr")) {
    const text = (tr.querySelector("input")?.value ?? "").trim();
    const type = (tr.querySelector("select")?.value ?? "Primary").trim();
    if (text) rows.push({ text, type });
  }

  return rows;
}

function loadDx(rows) {
  if (!dxTbody) return;
  dxTbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    dxTbody.appendChild(createDxRow({ text: "", type: "Primary" }));
  } else {
    rows.forEach((r) => dxTbody.appendChild(createDxRow(r)));
  }

  renumberDx();
  syncAllPrint();
}

function addDxRow(data) {
  if (!dxTbody) return;
  dxTbody.appendChild(createDxRow(data));
  renumberDx();
  syncAllPrint();
  saveDraft();
}

/* =========================================================
   Medication DB + Autocomplete
   Supports two schemas:
   A) old: { label, drug, dose, route, freq, duration, instruction }
   B) new: { name, dose:[...], route:[...], forms:[...], class, defaultSig:{dose,freq,duration,instruction} }
========================================================= */
let MED_DB = [];

async function loadMedicationDB() {
  try {
    const res = await fetch("./data/medications.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    MED_DB = Array.isArray(data) ? data : [];
    console.log("Loaded meds:", MED_DB.length);
  } catch (err) {
    console.warn("Could not load medications.json. Using built-in list.", err);
    MED_DB = BUILTIN_MED_DB;
  }
}

function medLabel(m) {
  if (!m) return "";
  if (m.label) return m.label;
  const strength = firstFromArray(m.dose);
  const route = firstFromArray(m.route);
  return normalizeSpaces(`${m.name ?? ""} ${strength} ${route}`);
}

function applyMed(rowEl, med) {
  const inputs = rowEl.querySelectorAll("input");

  // schema B
  if (med?.name) {
    const strength = firstFromArray(med.dose);
    const route = (firstFromArray(med.route) || "").toUpperCase();
    const form = firstFromArray(med.forms);

    const sig = med.defaultSig || {};
    const sigDose = normalizeSpaces(sig.dose || "");
    const sigFreq = normalizeSpaces(sig.freq || "");
    const sigDur = normalizeSpaces(sig.duration || "");
    const sigIns = normalizeSpaces(sig.instruction || "");

    const freqLine = normalizeSpaces([sigDose, form, sigFreq].filter(Boolean).join(" "));

    const map = {
      drug: med.name,
      dose: strength,
      route,
      freq: freqLine,
      duration: sigDur,
      instruction: sigIns,
    };

    // for redundancy checks
    rowEl.dataset.medName = (med.name || "").toLowerCase();
    rowEl.dataset.medClass = (med.class || "").toLowerCase();

    MED_COLS.forEach((col, i) => {
      if (map[col] !== undefined && inputs[i]) inputs[i].value = map[col];
    });

    applyRedundancyWarnings(med, rowEl);
    syncAllPrint();
    saveDraft();
    return;
  }

  // schema A
  const map = {
    drug: med.drug,
    dose: med.dose,
    route: med.route,
    freq: med.freq,
    duration: med.duration,
    instruction: med.instruction,
  };

  rowEl.dataset.medName = (med.drug || "").toLowerCase();
  rowEl.dataset.medClass = (med.class || "").toLowerCase();

  MED_COLS.forEach((col, i) => {
    if (map[col] !== undefined && inputs[i]) inputs[i].value = map[col];
  });

  applyRedundancyWarnings(med, rowEl);
  syncAllPrint();
  saveDraft();
}

function applyRedundancyWarnings(newMed, currentRow) {
  if (!medTbody) return;

  const warnings = checkMedicationRedundancy(newMed, currentRow);
  if (warnings.length > 0) {
    currentRow.style.outline = "2px solid #f5a623";
    currentRow.title = warnings.join("\n");
  } else {
    currentRow.style.outline = "";
    currentRow.title = "";
  }
}

function checkMedicationRedundancy(newMed, currentRow) {
  const warnings = [];

  const newName = (newMed?.name || newMed?.drug || "").toLowerCase();
  const newClass = (newMed?.class || "").toLowerCase();

  for (const tr of medTbody.querySelectorAll("tr")) {
    if (tr === currentRow) continue;

    const oldName = (tr.dataset.medName || "").toLowerCase();
    const oldClass = (tr.dataset.medClass || "").toLowerCase();

    if (newName && oldName && newName === oldName) {
      warnings.push(`Duplicate drug: ${newMed?.name || newMed?.drug}`);
    }

    if (newClass && oldClass && newClass === oldClass) {
      warnings.push(`Same drug class (${newMed?.class}) as ${oldName || "another med"}`);
    }
  }

  return warnings;
}

function attachMedAutocomplete(input, rowEl) {
  let box;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    removeBox();
    if (q.length < 2) return;

    const matches = MED_DB
      .map((m) => ({ m, label: medLabel(m).toLowerCase() }))
      .filter((x) => x.label.includes(q))
      .slice(0, 10)
      .map((x) => x.m);

    if (matches.length === 0) return;

    box = document.createElement("div");
    box.className = "medSuggestBox";

    matches.forEach((med) => {
      const item = document.createElement("div");
      item.className = "medSuggestItem";
      item.textContent = medLabel(med);

      item.addEventListener("mousedown", () => {
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
  });

  document.addEventListener("click", removeBox);

  function removeBox() {
    if (box) {
      box.remove();
      box = null;
    }
  }
}

/* =========================================================
   Medication Table
========================================================= */
const medTbody = $("medTbody");
const btnAddMed = $("btnAddMed");
const MED_COLS = ["drug", "dose", "route", "freq", "duration", "instruction"];

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
      syncAllPrint();
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
    syncAllPrint();
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

function loadMeds(rows) {
  if (!medTbody) return;
  medTbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    medTbody.appendChild(createMedRow({}));
  } else {
    rows.forEach((r) => medTbody.appendChild(createMedRow(r)));
  }

  syncAllPrint();
}

function addMedRow(data) {
  if (!medTbody) return;
  medTbody.appendChild(createMedRow(data));
  syncAllPrint();
  saveDraft();
}

/* =========================================================
   Print rendering (OPD / Admission / MC)
========================================================= */
function syncDxToPrint() {
  const rows = getDxRows();
  const dxText = rows.length ? rows.map((r) => r.text).join("; ") : "-";

  // OPD list
  const list1 = $("dxPrintList");
  if (list1) {
    list1.innerHTML = "";
    if (rows.length === 0) {
      const li = document.createElement("li");
      li.textContent = "-";
      list1.appendChild(li);
    } else {
      rows.forEach((r) => {
        const li = document.createElement("li");
        li.textContent = r.text;
        list1.appendChild(li);
      });
    }
  }

  // Admission list
  const list2 = $("dxPrintList_admit");
  if (list2) {
    list2.innerHTML = "";
    if (rows.length === 0) {
      const li = document.createElement("li");
      li.textContent = "-";
      list2.appendChild(li);
    } else {
      rows.forEach((r) => {
        const li = document.createElement("li");
        li.textContent = r.text;
        list2.appendChild(li);
      });
    }
  }

  // Medical Certificate (English Dx only)
  const mcDx = $("mcDxText");
  if (mcDx) mcDx.textContent = dxText;
}

function syncMedToPrint() {
  const rows = getMedRows();

  // target 1: OPD right column
  const t1 = $("medPrintTbody");
  if (t1) renderMedRowsIntoTbody(t1, rows);

  // target 2: Admission
  const t2 = $("medPrintTbody_admit");
  if (t2) renderMedRowsIntoTbody(t2, rows);
}

function renderMedRowsIntoTbody(tbodyEl, rows) {
  tbodyEl.innerHTML = "";

  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.textContent = "-";
    tr.appendChild(td);
    tbodyEl.appendChild(tr);
    return;
  }

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    const isOral = /^(po|oral)$/i.test(r.route);
    const drugText = isOral && r.dose
      ? `${escapeHtml(r.drug)} (${escapeHtml(r.dose)})`
      : `${escapeHtml(r.drug)} ${escapeHtml(r.dose)}`;

    td.innerHTML = `
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

    tr.appendChild(td);
    tbodyEl.appendChild(tr);
  });
}

function syncAllPrint() {
  // Dx numbers are needed before printing
  renumberDx();
  syncDxToPrint();
  syncMedToPrint();
}

/* =========================================================
   Templates (prefill) - still local for now
========================================================= */
const templates = {
  blank: {
    fields: {
      investigation: "None",
      hpi: "",
      pmh: "",
      homeMeds: "",
      ros: "",
      vitals: "",
      pe: "",
      plan: "",
      cc: "",
    },
    dxList: [],
    meds: [],
  },
  cold: {
    fields: {
      cc: "ไข้ ไอ น้ำมูก 2 วัน / Fever, cough, rhinorrhea 2 days",
      hpi:
        "- มีไข้ ไอ น้ำมูก\n- ไม่มีหอบเหนื่อย\n- รับประทานได้\n- ไม่มีอาการอันตราย",
      ros: "- ไม่มีเจ็บหน้าอก\n- ไม่มีหอบเหนื่อย\n- ไม่มีอาเจียนรุนแรง",
      vitals: "T, BP, PR, RR, SpO2",
      pe: "- GA good\n- Throat mildly injected\n- Chest clear",
      investigation: "None",
      plan:
        "- Symptomatic treatment\n- Advise fluids/rest\n- Return if SOB, persistent fever, poor intake",
    },
    dxList: [{ text: "URI / Common cold", type: "Primary" }],
    meds: [
      {
        drug: "Paracetamol",
        dose: "500 mg",
        route: "PO",
        freq: "1 tab prn q6h",
        duration: "10",
        instruction: "for fever/pain",
      },
    ],
  },
  trauma: {
    fields: {
      cc: "บาดเจ็บจากอุบัติเหตุ / Trauma",
      hpi:
        "- Mechanism: ...\n- Time: ...\n- Pain score: .../10\n- Bleeding/LOC: ...",
      pe:
        "- ABC stable\n- Wound: ...\n- Neurovascular intact\n- Tenderness: ...",
      investigation: "X-ray if indicated",
      plan:
        "- Wound care\n- Tetanus update\n- Analgesia\n- Follow-up / red flags",
    },
    dxList: [
      { text: "Soft tissue injury", type: "Primary" },
      { text: "Laceration (if present)", type: "Secondary" },
    ],
    meds: [
      {
        drug: "Ibuprofen",
        dose: "400 mg",
        route: "PO",
        freq: "1 tab q8h",
        duration: "10",
        instruction: "after meals",
      },
    ],
  },
  dyspepsia: {
    fields: {
      cc: "ปวดจุกลิ้นปี่ / Epigastric pain",
      hpi:
        "- ปวดจุกลิ้นปี่เป็นๆหายๆ\n- คลื่นไส้/แน่นท้อง\n- ไม่มีถ่ายดำ/อาเจียนเป็นเลือด",
      pe: "- Abd soft, not tender",
      investigation: "None",
      plan: "- PPI\n- Diet advice\n- Return if alarm symptoms",
    },
    dxList: [{ text: "Dyspepsia w/ Abdominal Bloating", type: "Primary" }],
    meds: [
      {
        drug: "Omeprazole",
        dose: "20 mg",
        route: "PO",
        freq: "1 x 1 ac",
        duration: "20",
        instruction: "ก่อนอาหารเช้า",
      },
      {
        drug: "Simethicone",
        dose: "120 mg",
        route: "PO",
        freq: "1 tab prn q8h",
        duration: "10",
        instruction: "",
      },
    ],
  },
};

function setFieldValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value ?? "";
  el.dispatchEvent(new Event("input"));
}

function applyTemplate(key) {
  const t = templates[key] ?? templates.blank;

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
const DRAFT_KEY = "opd_note_draft_v2";

function collectDraft() {
  const data = {
    fields: {},
    dxList: getDxRows(),
    meds: getMedRows(),
    template: templateSelect?.value ?? "blank",
    printMode: currentPrintMode,
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

    if (data?.fields) {
      Object.entries(data.fields).forEach(([id, val]) => setFieldValue(id, val));
    }

    loadDx(data?.dxList ?? []);
    loadMeds(data?.meds ?? []);

    if (templateSelect && data?.template) templateSelect.value = data.template;

    if (data?.printMode && printMode) {
      printMode.value = data.printMode;
    }

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   Print ONLY preview area
========================================================= */
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
  await loadMedicationDB();

  // Sticky identity
  initStickyDefault("physician");
  initStickyDefault("license");

  // Bind basic fields
  bindPreviewFields();

  // Dx + Med buttons
  if (btnAddDx) btnAddDx.addEventListener("click", () => addDxRow({}));
  if (btnAddMed) btnAddMed.addEventListener("click", () => addMedRow({}));

  // Template select
  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => applyTemplate(e.target.value));
  }

  // Format switch
  if (btnFormat && printMode) {
    btnFormat.addEventListener("click", () => loadPrintTemplate(printMode.value));
  }
  if (printMode) {
    printMode.addEventListener("change", () => {
      // preview updates right away (button is still available)
      loadPrintTemplate(printMode.value);
      saveDraft();
    });
  }

  // Print
  if (btnPrint) {
    btnPrint.addEventListener("click", () => {
      syncAllPrint();
      saveDraft();
      printOnly("printHost");
    });
  }

  // Save draft when normal fields change
  for (const id of BIND_FIELDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  }

  // Load draft, then load current print template
  const hasDraft = loadDraft();
  const startMode = (printMode?.value || "opd");
  await loadPrintTemplate(startMode);

  if (!hasDraft) {
    const startTemplate = templateSelect?.value ?? "blank";
    applyTemplate(startTemplate);
  } else {
    syncAllPrint();
  }

  // Ensure at least 1 row exists
  if (getDxRows().length === 0) loadDx([]);
  if (getMedRows().length === 0) loadMeds([]);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => console.error(e));
});

/* =========================================================
   Built-in medication list fallback (works even without JSON)
========================================================= */
const BUILTIN_MED_DB = [
  {
    name: "Ibuprofen",
    dose: ["400 mg"],
    route: ["po"],
    forms: ["Tab"],
    class: "NSAID",
    defaultSig: { dose: "1 Tab", freq: "q 8 hrs prn", duration: "", instruction: "after meals" },
  },
  {
    name: "Paracetamol",
    dose: ["500 mg"],
    route: ["po"],
    forms: ["Tab"],
    class: "Analgesic",
    defaultSig: { dose: "1 Tab", freq: "q 6 hrs prn", duration: "", instruction: "for fever/pain" },
  },
];
