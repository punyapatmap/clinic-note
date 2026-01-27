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
    return (text || "").replace(QUOTED_SPLIT_RE, (m) => stripOuterQuotes(m));
}

// Strip quotes everywhere in a DOM subtree (for print area)
function stripQuotesEverywhere(root) {
    if (!root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
        const t = node.nodeValue;
        if (!t || !t.trim()) return;
        node.nodeValue = removeAllQuotesKeepInside(t);
    });
}

// Optional: quoted-only mask inside a DOM subtree (keeps spacing)
function applyQuotedOnlyMask(root) {
    if (!root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
        const text = node.nodeValue;
        if (!text || !text.trim()) return;

        const parts = text.split(QUOTED_SPLIT_RE);
        if (parts.length === 1) return;

        const frag = document.createDocumentFragment();

        for (const p of parts) {
            if (p === "") continue;

            const span = document.createElement("span");
            const quoted = isQuotedChunk(p);

            span.className = quoted ? "print-keep" : "print-hide";
            span.textContent = quoted ? stripOuterQuotes(p) : removeAllQuotesKeepInside(p);

            frag.appendChild(span);
        }

        node.parentNode.replaceChild(frag, node);
    });
}

function renderPreview() {
    const raw = src?.value || "";
    const cleaned = removeAllQuotesKeepInside(raw);

    // Toggle OFF: show everything, but quotes removed
    if (!toggle?.checked) {
        document.body.classList.remove("print-mask");
        if (preview) preview.textContent = cleaned;
        return;
    }

    // Toggle ON: show quoted-only (quotes removed)
    document.body.classList.add("print-mask");
    if (!preview) return;
    preview.innerHTML = "";

    // split ORIGINAL raw to detect what was quoted
    const parts = raw.split(QUOTED_SPLIT_RE);

    for (const p of parts) {
        if (p === "") continue;

        const span = document.createElement("span");
        const quoted = isQuotedChunk(p);

        span.className = quoted ? "print-keep" : "print-hide";
        span.textContent = quoted ? stripOuterQuotes(p) : removeAllQuotesKeepInside(p);

        preview.appendChild(span);
    }
}

// ---- events ----
btnLoadExample?.addEventListener("click", () => {
    if (!src) return;
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
    const mode =
        (typeof printMode !== "undefined" && printMode?.value) ? printMode.value : "opd";

    if (typeof syncAllPrint === "function") syncAllPrint(mode);
    if (typeof saveDraft === "function") saveDraft();

    const host = document.getElementById("printHost");
    if (!host) {
        window.print();
        return;
    }

    const backup = host.innerHTML;

    // ALWAYS: strip quotes for every text node inside print area
    stripQuotesEverywhere(host);

    // same toggle controls both:
    // - quote-only text behavior
    // - hiding print-optional headers
    const quotedOnly = !!toggle?.checked;
    document.body.classList.toggle("print-mask", quotedOnly);

    // If toggle ON: apply quoted-only mask to the PRINT AREA too
    if (quotedOnly) {
        applyQuotedOnlyMask(host);
    }


    requestAnimationFrame(() => {
        window.print();

        setTimeout(() => {
            // restore original DOM
            host.innerHTML = backup;

            // keep screen state consistent with toggle
            document.body.classList.toggle("print-mask", !!toggle?.checked);

            if (typeof bindPreviewFields === "function") bindPreviewFields();
            if (typeof syncAllPrint === "function") syncAllPrint(mode);

            renderPreview();
        }, 0);
    });
});


// initial
renderPreview();
