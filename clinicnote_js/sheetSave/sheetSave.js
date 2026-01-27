/* =========================================================
   saveSHEET.js — HN multi-visit (Google Sheet backend)
   ---------------------------------------------------------
   - Save NEW visit (append-only)
   - Load latest by HN
   - List visits by HN (fills dropdown)
   - Load by visitId (selected)
========================================================= */

const GAS_URL = 
"https://script.google.com/macros/s/AKfycbzc3sYd1VMm2KVloEXtdlARrkyo-YHo2PlGKEV0qNzH4a52uf2dDNtaWkfB_cYOcdkpjw/exec";
const $ = (id) => document.getElementById(id);

const el = {
  visitId: $("visitId"),
  hn: $("hn"),
  visitDt: $("visitDt"),
  visitPick: $("visitPick"),
  hpi: $("hpi"),
  pmh: $("pmh"),
  dx: $("dx"),
  status: $("status"),

  pv_hn: $("pv_hn"),
  pv_visitDt: $("pv_visitDt"),
  pv_visitId: $("pv_visitId"),
  pv_hpi: $("pv_hpi"),
  pv_pmh: $("pv_pmh"),
  pv_dx: $("pv_dx"),

  btnList: $("btnList"),
  btnLoadLatest: $("btnLoadLatest"),
  btnLoadSelected: $("btnLoadSelected"),
  btnSaveNew: $("btnSaveNew"),
  btnClear: $("btnClear"),
};

function setStatus(msg, isError = false) {
  el.status.textContent = msg;
  el.status.style.color = isError ? "#b00020" : "";
}

function pad2(n) { return String(n).padStart(2, "0"); }

function nowLocalDatetimeValue() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function syncPreview() {
  el.pv_hn.textContent = el.hn.value || "";
  el.pv_visitDt.textContent = el.visitDt.value || "";
  el.pv_visitId.textContent = el.visitId.value || "(new)";

  el.pv_hpi.innerHTML = escapeHtml(el.hpi.value || "");
  el.pv_pmh.innerHTML = escapeHtml(el.pmh.value || "");
  el.pv_dx.innerHTML = escapeHtml(el.dx.value || "");
}

function collectPayload() {
  return {
    visitId: el.visitId.value || "",   // for load display; saveNew ignores this
    hn: (el.hn.value || "").trim(),
    visitDt: el.visitDt.value || "",
    hpi: el.hpi.value || "",
    pmh: el.pmh.value || "",
    dx: el.dx.value || "",
  };
}

function applyToForm(row) {
  el.visitId.value = row?.visitId || "";
  el.hn.value = row?.hn || "";
  el.visitDt.value = row?.visitDt || "";
  el.hpi.value = row?.hpi || "";
  el.pmh.value = row?.pmh || "";
  el.dx.value = row?.dx || "";
  syncPreview();
}

async function callGAS(action, params = {}) {
  if (!GAS_URL) throw new Error("GAS_URL is empty.");

  // Use JSON POST (recommended)
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (data?.ok === false) throw new Error(data?.error || "Request failed");
  return data;
}

function hnRequired_() {
  const hn = (el.hn.value || "").trim();
  if (!hn) {
    setStatus("Please enter HN first.", true);
    el.hn.focus();
    return null;
  }
  return hn;
}

async function saveNewVisit() {
  const payload = collectPayload();
  if (!payload.hn) return setStatus("Please enter HN first.", true);

  setStatus("Saving NEW visit...");
  try {
    const r = await callGAS("saveNew", { payload });
    // after saving new visit, set visitId returned
    if (r?.visitId) el.visitId.value = r.visitId;
    setStatus(`Saved ✅ visitId=${r?.visitId || ""}`);
    syncPreview();
    // refresh visit list automatically
    await listVisits();
  } catch (e) {
    setStatus(`Save failed: ${e.message}`, true);
  }
}

async function loadLatest() {
  const hn = hnRequired_();
  if (!hn) return;

  setStatus("Loading latest...");
  try {
    const r = await callGAS("loadLatest", { hn });
    if (!r?.data) {
      setStatus("No data for this HN.", true);
      return;
    }
    applyToForm(r.data);
    setStatus("Loaded latest ✅");
  } catch (e) {
    setStatus(`Load failed: ${e.message}`, true);
  }
}

async function listVisits() {
  const hn = hnRequired_();
  if (!hn) return;

  setStatus("Listing visits...");
  try {
    const r = await callGAS("listVisits", { hn, limit: 30 });
    const arr = Array.isArray(r?.data) ? r.data : [];

    // fill dropdown
    el.visitPick.innerHTML = "";
    if (!arr.length) {
      el.visitPick.innerHTML = `<option value="">— no visits found —</option>`;
      setStatus("No visits found.", true);
      return;
    }

    el.visitPick.appendChild(new Option("— select a visit —", ""));
    for (const v of arr) {
      // label: yyyy-mm-ddThh:mm | visitId
      const label = `${v.visitDt || "(no visitDt)"}  |  ${v.visitId}`;
      const opt = new Option(label, v.visitId);
      el.visitPick.appendChild(opt);
    }

    setStatus(`Found ${arr.length} visits ✅ (newest first)`);
  } catch (e) {
    setStatus(`List failed: ${e.message}`, true);
  }
}

async function loadSelected() {
  const visitId = el.visitPick.value;
  if (!visitId) {
    setStatus("Pick a visit from the dropdown first.", true);
    return;
  }

  setStatus("Loading selected visit...");
  try {
    const r = await callGAS("loadByVisitId", { visitId });
    if (!r?.data) {
      setStatus("Visit not found.", true);
      return;
    }
    applyToForm(r.data);
    setStatus("Loaded selected ✅");
  } catch (e) {
    setStatus(`Load failed: ${e.message}`, true);
  }
}

function clearForm(keepHN = true) {
  const hn = keepHN ? el.hn.value : "";
  el.visitId.value = "";
  el.hn.value = hn || "";
  el.visitDt.value = nowLocalDatetimeValue();
  el.hpi.value = "";
  el.pmh.value = "";
  el.dx.value = "";
  syncPreview();
  setStatus("Cleared.");
}

function wire() {
  if (!el.visitDt.value) el.visitDt.value = nowLocalDatetimeValue();

  // live preview
  for (const id of ["hn", "visitDt", "hpi", "pmh", "dx"]) {
    $(id).addEventListener("input", syncPreview);
    $(id).addEventListener("change", syncPreview);
  }

  el.btnSaveNew.addEventListener("click", saveNewVisit);
  el.btnLoadLatest.addEventListener("click", loadLatest);
  el.btnList.addEventListener("click", listVisits);
  el.btnLoadSelected.addEventListener("click", loadSelected);
  el.btnClear.addEventListener("click", () => clearForm(true));

  syncPreview();
}

wire();
