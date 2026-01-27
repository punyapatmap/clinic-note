/* textAlign.js — realtime topic/bullet aligner (single textarea) */

const note = document.getElementById("note");
const autoFmt = document.getElementById("autoFmt");
const debounceInp = document.getElementById("debounce");
const topicWidthInp = document.getElementById("topicWidth");
const btnFormat = document.getElementById("btnFormat");
const btnExample = document.getElementById("btnExample");

// Defaults
let DEBOUNCE_MS = Number(debounceInp.value || 220);
let TOPIC_COL_WIDTH = Number(topicWidthInp.value || 10);
let BULLET_INDENT = TOPIC_COL_WIDTH + 2;

let timer = null;
let lastFormatted = "";

// ---------- Utilities ----------
function padRight(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function normalizeTopic(s) {
  // Keep it simple: trim + collapse spaces
  return String(s || "").trim().replace(/\s+/g, " ");
}

function sanitizeBullet(s) {
  // Optional tiny cleanup (safe):
  // - remove double spaces
  // - trim
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * Split "after colon" text into bullets.
 * Accept separators:
 *   - semicolon ;
 *   - additional "- " patterns anywhere
 *
 * Example:
 *   "- a; b; - c" => ["a","b","c"]
 *   "- a - b - c" => ["a","b","c"] (only if it has spaces around dash)
 */
function splitBullets(afterColon) {
  const s = String(afterColon || "").trim();
  if (!s) return [];

  // Remove a leading "-" if present
  let tmp = s.replace(/^\s*-\s*/, "");

  // Convert separators into a single delimiter
  // - semicolons
  // - " - " sequences inside the string (avoid hyphenated words)
  tmp = tmp
    .replace(/\s*;\s*/g, "|||")
    .replace(/\s+-\s+/g, "|||");

  return tmp
    .split("|||")
    .map(x => sanitizeBullet(x))
    .filter(Boolean);
}

/**
 * Parse the textarea text into sections:
 * [{ topic: "Neuro", bullets: ["...","..."] }, ...]
 */
function parse(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");

  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // "Topic: rest"
    const m = line.match(/^(.{1,40}?):\s*(.*)$/);
    if (m) {
      if (current) sections.push(current);

      const topic = normalizeTopic(m[1]);
      const rest = m[2] || "";

      const bullets = splitBullets(rest);
      current = { topic, bullets: bullets.length ? bullets : [] };
      continue;
    }

    // No topic yet => create default
    if (!current) current = { topic: "Notes", bullets: [] };

    // Multi-line bullet lines
    if (/^-+\s+/.test(line)) {
      current.bullets.push(sanitizeBullet(line.replace(/^-+\s+/, "")));
    } else {
      // Plain line: treat as another bullet (matches your style)
      current.bullets.push(sanitizeBullet(line));
    }
  }

  if (current) sections.push(current);
  return sections;
}

function formatSections(sections) {
  const out = [];

  for (const sec of sections) {
    const topicLabel = `${sec.topic}:`;
    const topicCol = padRight(topicLabel, TOPIC_COL_WIDTH);

    if (!sec.bullets.length) {
      out.push(topicCol);
      continue;
    }

    // First bullet on same line as topic
    out.push(`${topicCol}  - ${sec.bullets[0]}`);

    // Subsequent bullets aligned under bullet column
    const indent = " ".repeat(BULLET_INDENT);
    for (let i = 1; i < sec.bullets.length; i++) {
      out.push(`${indent}- ${sec.bullets[i]}`);
    }
  }

  return out.join("\n");
}

/**
 * Avoid cursor-jump pain:
 * only rewrite when caret is at end, OR user has selected all text.
 */
function isSafeToRewrite(el) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const len = el.value.length;

  const caretAtEnd = start === len && end === len;
  const allSelected = start === 0 && end === len;

  return caretAtEnd || allSelected;
}

function computeFormatted(raw) {
  const sections = parse(raw);
  return formatSections(sections);
}

function applyAutoFormat(force = false) {
  if (!force && !autoFmt.checked) return;

  const raw = note.value;
  const formatted = computeFormatted(raw);

  if (!formatted) return;
  if (formatted === raw) return;
  if (formatted === lastFormatted) return;

  if (!force && !isSafeToRewrite(note)) return;

  lastFormatted = formatted;
  note.value = formatted;

  // keep caret at end on auto (force might happen mid-edit)
  if (!force) {
    note.selectionStart = note.selectionEnd = note.value.length;
  }
}

// ---------- Event wiring ----------
function scheduleFormat() {
  clearTimeout(timer);
  timer = setTimeout(() => applyAutoFormat(false), DEBOUNCE_MS);
}

note.addEventListener("input", scheduleFormat);

btnFormat.addEventListener("click", () => applyAutoFormat(true));

btnExample.addEventListener("click", () => {
  note.value =
`Neuro: - oriented to TPP, no significant dysarthria; pseudo-meningitis; - max ROM
CVS: - normal S1S2 no murmur

Resp: - clear to auscultation bilaterally; no wheeze
Abd: - soft, non-tender; no guarding`;
  lastFormatted = "";
  applyAutoFormat(true);
});

debounceInp.addEventListener("change", () => {
  const v = Number(debounceInp.value);
  if (!Number.isFinite(v) || v < 0) return;
  DEBOUNCE_MS = v;
});

topicWidthInp.addEventListener("change", () => {
  const v = Number(topicWidthInp.value);
  if (!Number.isFinite(v) || v < 6) return;
  TOPIC_COL_WIDTH = v;
  BULLET_INDENT = TOPIC_COL_WIDTH + 2;
  lastFormatted = "";
  applyAutoFormat(true);
});

// Initial content
note.value =
`Neuro: - oriented to TPP, no significant dysarthria; pseudo-meningitis; - max ROM
CVS: - normal S1S2 no murmur`;
applyAutoFormat(true);
