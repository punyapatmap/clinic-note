const src = document.getElementById("src");
const preview = document.getElementById("preview");
const toggle = document.getElementById("quotedOnlyToggle");
const btnPrint = document.getElementById("btnPrint");
const btnLoadExample = document.getElementById("btnLoadExample");

// supports: " " , ' ' , and smart quotes “ ” ‘ ’
// Used only for splitting into [plain, quoted, plain...]
const QUOTED_SPLIT_RE = /(["“”][^"“”]*["“”]|['‘’][^'‘’]*['‘’])/g;

function isQuotedChunk(s) {
  return (
    /^["“”][\s\S]*["“”]$/.test(s) ||
    /^['‘’][\s\S]*['‘’]$/.test(s)
  );
}

function stripOuterQuotes(s) {
  // remove first+last quote, trim inside spaces
  return s.slice(1, -1).trim();
}

// Always remove quote signs from any text (even when toggle OFF)
function removeAllQuotesKeepInside(text) {
  if (!text) return "";
  // Replace each quoted chunk with its inside (no quotes, trimmed)
  return text.replace(QUOTED_SPLIT_RE, (m) => stripOuterQuotes(m));
}

function renderPreview() {
  const raw = src.value || "";
  const cleaned = removeAllQuotesKeepInside(raw);

  // Toggle OFF: show everything, but with quotes removed
  if (!toggle?.checked) {
    document.body.classList.remove("print-mask");
    preview.textContent = cleaned;
    return;
  }

  // Toggle ON: quoted-only view (no quote signs)
  document.body.classList.add("print-mask");
  preview.innerHTML = "";

  // IMPORTANT: split the ORIGINAL raw text so we can know what was quoted
  const parts = raw.split(QUOTED_SPLIT_RE);

  for (const p of parts) {
    if (p === "") continue;

    const span = document.createElement("span");
    const quoted = isQuotedChunk(p);

    span.className = quoted ? "print-keep" : "print-hide";
    span.textContent = quoted ? stripOuterQuotes(p) : p; // quotes removed here too

    preview.appendChild(span);
  }
}

btnLoadExample?.addEventListener("click", () => {
  src.value =
`- orientate to TPP, "negative for meningeal" irritation signs
- "Full EOM", no nystagmus, "VA intact without" visual field deficit.
- plain text without quotes should remain when toggle OFF (but without quote signs)
- '  Single-quoted chunk  ' should also print (trimmed, no quotes)`;
  renderPreview();
});

src?.addEventListener("input", renderPreview);
toggle?.addEventListener("change", renderPreview);

btnPrint?.addEventListener("click", () => {
  renderPreview(); // ensure preview is in correct mode and quotes removed

  requestAnimationFrame(() => {
    window.print();
    setTimeout(renderPreview, 0);
  });
});

// initial
renderPreview();
