//This is old but functioning code for snippets box - 14 Jan 2026

// const snippetBox = document.getElementById("snippetBox");
// let snipState = {
//   ta: null,
//   matches: [],
//   activeIndex: 0,
//   currentToken: ""
// };

// function getLastToken(text, pos) {
//   const left = text.slice(0, pos);
//   const m = left.match(/(^|\s)([^\s]+)$/);
//   return m ? m[2] : "";
// }

// function replaceLastToken(textarea, replacement) {
//   const pos = textarea.selectionStart;
//   const text = textarea.value;
//   const left = text.slice(0, pos);
//   const right = text.slice(pos);

//   const m = left.match(/(^|\s)([^\s]+)$/);
//   if (!m) return;

//   const token = m[2];
//   const start = pos - token.length;

//   textarea.value = text.slice(0, start) + replacement + right;
//   const newPos = start + replacement.length;
//   textarea.setSelectionRange(newPos, newPos);
// }

// function hideSnippetBox() {
//   snipState = { ta: null, matches: [], activeIndex: 0, currentToken: "" };
//   snippetBox.classList.add("hidden");
//   snippetBox.innerHTML = "";
// }

// function positionSnippetBox(textarea) {
//   // stable placement: under textarea (not caret) – simple and reliable
//   const r = textarea.getBoundingClientRect();
//   snippetBox.style.left = (window.scrollX + r.left) + "px";
//   snippetBox.style.top = (window.scrollY + r.bottom + 6) + "px";
// }

// function rankMatches(token, list) {
//   // ranking: exact key, startsWith key, includes key, then tags
//   const t = token.toLowerCase();
//   return list
//     .map(s => {
//       const key = s.key;
//       let score = 0;
//       if (key === t) score += 1000;
//       if (key.startsWith(t)) score += 500;
//       if (key.includes(t)) score += 200;
//       // tiny boost if token matches a tag
//       if (s.tags?.some(tag => tag.includes(t))) score += 50;
//       // shorter key slightly preferred
//       score += Math.max(0, 30 - key.length);
//       return { s, score };
//     })
//     .sort((a, b) => b.score - a.score)
//     .map(x => x.s);
// }

// function renderSnippetBox() {
//   const { matches, activeIndex } = snipState;
//   if (!matches.length) return hideSnippetBox();

//   const itemsHtml = matches.slice(0, 8).map((m, i) => {
//     const cls = i === activeIndex ? "snip-item active" : "snip-item";
//     return `
//       <div class="${cls}" data-idx="${i}" role="option" aria-selected="${i === activeIndex}">
//         <span class="snip-key">${m.key}</span>
//         <span class="snip-text">${escapeHtml(m.text)}</span>
//       </div>
//     `;
//   }).join("");

//   snippetBox.innerHTML = `
//     ${itemsHtml}
//     <div class="snip-hint">↑/↓ select • Enter/Tab insert • Esc close</div>
//   `;

//   // click to insert
//   snippetBox.querySelectorAll(".snip-item").forEach(el => {
//     el.addEventListener("mousedown", (e) => {
//       // mousedown (not click) so it works before textarea loses focus
//       e.preventDefault();
//       const idx = Number(el.dataset.idx);
//       chooseSnippet(idx);
//     });
//   });

//   snippetBox.classList.remove("hidden");
// }

// function chooseSnippet(idx) {
//   const { ta, matches } = snipState;
//   if (!ta || !matches[idx]) return;
//   replaceLastToken(ta, matches[idx].text);
//   hideSnippetBox();
// }

// function updateSnippetMatches(textarea) {
//   const tokenRaw = getLastToken(textarea.value, textarea.selectionStart);
//   const token = String(tokenRaw || "").trim().toLowerCase();

//   // Only trigger when token has at least 2 chars (adjust as you like)
//   if (token.length < 2) return hideSnippetBox();

//   // Find matches by key partial OR tag partial
//   const filtered = SNIPPETS.filter(s =>
//     s.key.includes(token) || (s.tags && s.tags.some(tag => tag.includes(token)))
//   );

//   if (!filtered.length) return hideSnippetBox();

//   const ranked = rankMatches(token, filtered);
//   snipState.ta = textarea;
//   snipState.currentToken = token;
//   snipState.matches = ranked;
//   snipState.activeIndex = 0;

//   positionSnippetBox(textarea);
//   renderSnippetBox();
// }

// function bindSnippetAutocomplete(textarea) {
//   textarea.addEventListener("input", () => updateSnippetMatches(textarea));

//   textarea.addEventListener("keydown", (e) => {
//     if (snippetBox.classList.contains("hidden")) return;
//     if (snipState.ta !== textarea) return;

//     const maxVisible = Math.min(snipState.matches.length, 8);
//     if (maxVisible <= 0) return;

//     if (e.key === "Escape") {
//       e.preventDefault();
//       hideSnippetBox();
//       return;
//     }

//     // TAB cycles selection (wrap around)
//     if (e.key === "Tab") {
//       e.preventDefault();
//       if (e.shiftKey) {
//         // Shift+Tab = previous (wrap)
//         snipState.activeIndex = (snipState.activeIndex - 1 + maxVisible) % maxVisible;
//       } else {
//         // Tab = next (wrap)
//         snipState.activeIndex = (snipState.activeIndex + 1) % maxVisible;
//       }
//       renderSnippetBox();
//       return;
//     }

//     // Arrow keys still work (no wrap, or you can wrap if you want)
//     if (e.key === "ArrowDown") {
//       e.preventDefault();
//       snipState.activeIndex = Math.min(snipState.activeIndex + 1, maxVisible - 1);
//       renderSnippetBox();
//       return;
//     }

//     if (e.key === "ArrowUp") {
//       e.preventDefault();
//       snipState.activeIndex = Math.max(snipState.activeIndex - 1, 0);
//       renderSnippetBox();
//       return;
//     }

//     // Insert selected item
//     if (e.key === "Enter" || e.key === " ") {
//       e.preventDefault();
//       chooseSnippet(snipState.activeIndex);
//       return;
//     }
//   });

//   textarea.addEventListener("scroll", () => {
//     if (snipState.ta === textarea && !snippetBox.classList.contains("hidden")) {
//       positionSnippetBox(textarea);
//     }
//   });

//   textarea.addEventListener("blur", () => {
//     setTimeout(hideSnippetBox, 120);
//   });

//   window.addEventListener("resize", () => {
//     if (snipState.ta === textarea && !snippetBox.classList.contains("hidden")) {
//       positionSnippetBox(textarea);
//     }
//   });

//   window.addEventListener("scroll", () => {
//     if (snipState.ta === textarea && !snippetBox.classList.contains("hidden")) {
//       positionSnippetBox(textarea);
//     }
//   }, true);
// }

/* =========================================================
   Init
========================================================= */
// async function init() {
//   // await loadDiseaseDB();
//   await loadTemplatesGS();
//   await loadSnippetsDB();
//   await loadMedsGS();
//   await loadAllDatabases();
//   useGoogleDxAsMainDb();

//   // populateTemplateDropdown();
//   bindPreviewFields();
//   bindChronicUI();
//   syncChronicToPrint();

//   initStickyDefault("physician");
//   initStickyDefault("license");

//   const hasDraft = loadDraft();

//   if (printMode) {
//     printMode.addEventListener("change", async (e) => {
//       await loadPrintTemplate(e.target.value);
//     });

//     await loadPrintTemplate(printMode.value || "opd");
//   }

//   if (btnAddDx) btnAddDx.addEventListener("click", () => addDxRow({}));
//   if (btnAddMed) btnAddMed.addEventListener("click", () => addMedRow({}));

//   if (templateSelect) {
//     templateSelect.addEventListener("change", (e) => {
//       applyTemplate(e.target.value);
//     });
//   }

//   if (!hasDraft) {
//     const startTemplate = templateSelect?.value ?? "blank";
//     applyTemplate(startTemplate);
//   } else {
//     renumberDx();
//     syncAllPrint(printMode?.value || "opd");
//   }

//   initVisitDtDefault(false);
//   // Bind your fields after DOM is ready / init
//   bindSnippetAutocomplete(document.getElementById("hpi"));
//   bindSnippetAutocomplete(document.getElementById("pe"));

//   const visitDt = document.getElementById("visitDt");
//   if (visitDt) {
//     visitDt.addEventListener("input", () => {
//       syncMcAutoFields();
//       saveDraft();
//     });
//     visitDt.addEventListener("change", () => {
//       syncMcAutoFields();
//       saveDraft();
//     });
//   }

//   if (btnPrint) {
//     btnPrint.addEventListener("click", () => {
//       const mode = printMode?.value || "opd";
//       syncAllPrint(mode);
//       saveDraft();
//       document.body.dataset.printMode = mode;
//       window.print();   // ✅ reliable
//     });
//   }

//   // --- Print mask: apply only at print time ---
//   const printMaskToggle = document.getElementById("printMaskToggle");
//   let _printHostBackup = null;

//   window.addEventListener("beforeprint", () => {
//     if (!printMaskToggle?.checked) return;

//     // Backup current print HTML so we can restore after printing
//     _printHostBackup = printHost?.innerHTML ?? null;

//     document.body.classList.add("print-mask");

//     // Apply mask to the CURRENT print area only
//     const area = getCurrentPrintArea();
//     applyPrintMask(area);
//   });

//   window.addEventListener("afterprint", () => {
//     document.body.classList.remove("print-mask");

//     // Restore clean HTML (so mask doesn't "stick" in preview)
//     if (_printHostBackup != null && printHost) {
//       printHost.innerHTML = _printHostBackup;
//       _printHostBackup = null;

//       // re-bind and re-sync because we replaced DOM
//       bindPreviewFields();
//       syncAllPrint(printMode?.value || "opd");
//     }
//   });


//   for (const id of BIND_FIELDS) {
//     const el = $(id);
//     if (!el) continue;
//     el.addEventListener("input", saveDraft);
//     el.addEventListener("change", saveDraft);
//   }

//   if (getDxRows().length === 0) loadDx([]);
//   if (getMedRows().length === 0) loadMeds([]);

//   syncAllPrint(printMode?.value || "opd");
// }
