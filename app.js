/* =========================================================
   app.js (clean version)
   - Live bind form -> print template
   - Sticky default physician + license (localStorage)
   - Template presets (prefill fields + Dx + Meds)
   - Dx list (numbered like meds)
   - Med table
   - Print ONLY the template (#printArea), not the form
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

function bindPreviewFields() {
  for (const id of BIND_FIELDS) {
    const input = $(id);
    if (!input) continue;

    const targets = document.querySelectorAll(`[data-bind="${id}"]`);
    const update = () => {
      const val = (input.value ?? "").trim();
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

  // saved value wins; else default; else existing value
  el.value = saved ?? STICKY_DEFAULTS[id] ?? el.value ?? "";
  el.dispatchEvent(new Event("input"));

  el.addEventListener("input", () => {
    localStorage.setItem(key, el.value);
  });
}

/* =========================================================
   Dx List (numbered like medication list)
   HTML expected:
   - tbody#dxTbody
   - button#btnAddDx
   - ol#dxPrintList (in print template)
========================================================= */
const dxTbody = $("dxTbody");
const dxPrintList = $("dxPrintList");
const btnAddDx = $("btnAddDx");

function createDxRow({ text = "", type = "Primary" } = {}) {
  const tr = document.createElement("tr");

  // Number cell
  const tdNum = document.createElement("td");
  tdNum.className = "dxNumCell";
  tdNum.textContent = ""; // filled by renumberDx()
  tr.appendChild(tdNum);

  // Dx text
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

  // Type
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

  // Remove
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

function syncDxToPrint() {
  if (!dxPrintList) return;

  const rows = getDxRows({ sortByType: false }); // keep manual order
  dxPrintList.innerHTML = "";

  if (rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "-";
    dxPrintList.appendChild(li);
    return;
  }

  for (const r of rows) {
    const li = document.createElement("li");
    li.textContent = r.text; // or `${r.text} (${r.type})` if you want type shown
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
   Medication Table
   HTML expected:
   - tbody#medTbody (inputs)
   - button#btnAddMed
   - tbody#medPrintTbody (print)
========================================================= */
const medTbody = $("medTbody");
const medPrintTbody = $("medPrintTbody");
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

  // Print as a simple list-like table (each med on 2 lines if needed)
  // Keep your screenshot-like formatting: "1. Drug (dose) /qty" and sig line under it
  // If you want the exact style, adjust HTML/CSS; for now use a consistent 2-row style per item.
  rows.forEach((r, idx) => {
    const tr1 = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.colSpan = 6;
    const isOral = /^(po|oral)$/i.test(r.route);

const drugText = isOral && r.dose
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
  let box;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    removeBox();
    if (q.length < 2) return;

    const matches = MED_DB.filter(m =>
      m.label.toLowerCase().includes(q)
    );

    if (matches.length === 0) return;

    box = document.createElement("div");
    box.className = "medSuggestBox";

    matches.forEach(med => {
      const item = document.createElement("div");
      item.className = "medSuggestItem";
      item.textContent = med.label;

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

function applyMed(rowEl, med) {
  const inputs = rowEl.querySelectorAll("input");

  const map = {
    drug: med.drug,
    dose: med.dose,
    route: med.route,
    freq: med.freq,
    duration: med.duration,
    instruction: med.instruction
  };

  MED_COLS.forEach((col, i) => {
    if (map[col] !== undefined) {
      inputs[i].value = map[col];
    }
  });

  syncMedToPrint();
  saveDraft();
}

/* =========================================================
   Templates (prefill)
   HTML expected:
   - select#templateSelect
========================================================= */
const templateSelect = $("templateSelect");

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

  // Fill normal fields
  if (t.fields) {
    Object.entries(t.fields).forEach(([id, val]) => setFieldValue(id, val));
  }

  // Dx and meds
  loadDx(t.dxList ?? []);
  loadMeds(t.meds ?? []);

  saveDraft();
}

/* =========================================================
   Draft persistence (optional but useful)
   - Saves all fields + Dx + meds in localStorage
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
      Object.entries(data.fields).forEach(([id, val]) => setFieldValue(id, val));
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

  // include your stylesheet(s) so A4 rules apply
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
   Wire up events + init
========================================================= */
function init() {
  // Bind text fields to preview
  bindPreviewFields();

  // Sticky identity defaults (editable, remembered)
  initStickyDefault("physician");
  initStickyDefault("license");

  // Dx + Med buttons
  if (btnAddDx) btnAddDx.addEventListener("click", () => addDxRow({}));
  if (btnAddMed) btnAddMed.addEventListener("click", () => addMedRow({}));

  // Template select
  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => {
      applyTemplate(e.target.value);
    });
  }

  // Print button: sync lists then print only template
  if (btnPrint) {
    btnPrint.addEventListener("click", () => {
      renumberDx();
      syncDxToPrint();
      syncMedToPrint();
      saveDraft();
      printOnly("printArea");
    });
  }

  // Save draft when any normal field changes
  for (const id of BIND_FIELDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  }

  // Load draft if exists; else apply current template (or blank)
  const hasDraft = loadDraft();
  if (!hasDraft) {
    const startTemplate = templateSelect?.value ?? "blank";
    applyTemplate(startTemplate);
  } else {
    // ensure print areas are synced after draft load
    renumberDx();
    syncDxToPrint();
    syncMedToPrint();
  }

  // Ensure at least 1 row exists for Dx and Med if everything empty
  if (getDxRows().length === 0) loadDx([]);
  if (getMedRows().length === 0) loadMeds([]);
}

document.addEventListener("DOMContentLoaded", init);


const MED_DB = [
  {
    key: "ibuprofen",
    label: "Ibuprofen 400 mg PO",
    drug: "Ibuprofen",
    dose: "400 mg",
    route: "PO",
    freq: "1 tab prn q8h",
    duration: "10",
    instruction: "after meals"
  },
  {
    key: "ibuprofen600",
    label: "Ibuprofen 600 mg PO",
    drug: "Ibuprofen",
    dose: "600 mg",
    route: "PO",
    freq: "1 tab q8h",
    duration: "5",
    instruction: "after meals"
  },
  {
    key: "paracetamol",
    label: "Paracetamol 500 mg PO",
    drug: "Paracetamol",
    dose: "500 mg",
    route: "PO",
    freq: "1 tab prn q6h",
    duration: "10",
    instruction: "for fever/pain"
  },
  {
    key: "omeprazole",
    label: "Omeprazole 20 mg PO",
    drug: "Omeprazole",
    dose: "20 mg",
    route: "PO",
    freq: "1 cap od ac",
    duration: "14",
    instruction: ""
  }
];
