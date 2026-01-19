/* =========================================================
   db.js (Google Sheets via Apps Script)
   - Loads: templates, icd10dx, snippets, medications
   - Provides globals: templates, DX_DB, MED_DB, SNIPPETS, loadTemplatesDB(), loadDiseaseDB(), loadMedicationDB(), loadSnippetsDB()
========================================================= */
/* =========================================================
   Databases: Meds + Dx + Templates (Google Sheets)
========================================================= */

let MED_DB = [];
let DX_DB = [];
let dxByIcd10 = new Map();
let dxById = new Map();
let templates = {};

async function loadTemplatesDB() {
  try {
    const rows = await fetchSheet("templates");

    // Option A (recommended): sheet has columns `key` and `json`
    // where json is a full template object stored as JSON text.
    //
    // Option B: API returns an object already (e.g. {blank:{...}, cold:{...}})
    if (rows && !Array.isArray(rows) && typeof rows === "object") {
      templates = rows;
      console.log("Loaded templates (sheet object):", Object.keys(templates).length);
      return;
    }

    const out = { blank: { fields: {}, dxList: [], meds: [] } };
    const arr = Array.isArray(rows) ? rows : [];

    for (const r of arr) {
      const key = String(r.key ?? r.Key ?? r.template ?? r.Template ?? "").trim();
      if (!key) continue;

      const jsonVal = r.json ?? r.JSON ?? r.body ?? r.Body ?? r.template_json ?? r.TemplateJSON ?? "";
      if (!jsonVal) continue;

      try {
        out[key] = (typeof jsonVal === "string") ? JSON.parse(jsonVal) : jsonVal;
      } catch (e) {
        console.warn(`Template "${key}" has invalid JSON in sheet. Skipped.`, e);
      }
    }

    templates = out;
    console.log("Loaded templates (sheet rows):", Object.keys(templates).length);
  } catch (err) {
    console.warn("Could not load templates from Google Sheet. Using blank only.", err);
    templates = { blank: { fields: {}, dxList: [], meds: [] } };
  }
}

// async function loadDiseaseDB() {
  try {
    const rows = await fetchSheet("icd10dx");
    DX_DB = Array.isArray(rows) ? rows : [];
    console.log("Loaded diseases (sheet):", DX_DB.length);

    // ✅ Build lookup maps (supports either `icd10` or `id`)
    dxByIcd10 = new Map();
    dxById = new Map();

    for (const d of DX_DB) {
      const icd = String(d.icd10 || d.ICD10 || "").trim().toUpperCase();
      const id = String(d.id || d.ID || "").trim().toUpperCase();
      if (icd) dxByIcd10.set(icd, d);
      if (id) dxById.set(id, d);
    }
  } catch (err) {
    console.warn("Could not load icd10dx from Google Sheet. Using empty list.", err);
    DX_DB = [];
    dxByIcd10 = new Map();
    dxById = new Map();
  }
}

async function loadMedicationDB() {
  try {
    const rows = await fetchSheet("medications");
    MED_DB = Array.isArray(rows) ? rows : [];
    console.log("Loaded meds (sheet):", MED_DB.length);
  } catch (err) {
    console.warn("Could not load medications from Google Sheet. Using empty list.", err);
    MED_DB = [];
  }
}

// Templates dropdown (from templates.json)

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
    opt.textContent = key;
    templateSelect.appendChild(opt);
  }

  if (current && keys.includes(current)) templateSelect.value = current;
  else if (keys.includes("blank")) templateSelect.value = "blank";
  else templateSelect.value = keys[0];
}

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

// Optional: convenience loader
async function loadAllDB(){
  await loadDiseaseDB();
  await loadMedicationDB();
  await loadTemplatesDB();
  await loadSnippetsDB();
}
