// ====== CONFIG ======
// Paste your deployed Apps Script Web App URL here:
const GAS_WEBAPP_URL = "PASTE_YOUR_WEBAPP_URL_HERE";

const $ = (id) => document.getElementById(id);

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Parse text into sections like:
// "Neuro:" as topic, then bullets after it.
// Rule: "- " starts a new bullet; non "- " lines continue the last bullet.
function parseTopicBullets(raw) {
  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(l => l.trimEnd());

  const sections = [];
  let current = null;

  for (let line of lines) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Detect a "Topic:" at start of line
    const topicMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 /()_-]{0,40}):\s*(.*)$/);
    if (topicMatch) {
      // Start a new section
      if (current) sections.push(current);

      const topic = topicMatch[1].trim();
      const rest = topicMatch[2].trim();

      current = { topic, bullets: [] };

      if (rest) {
        if (rest.startsWith("-")) {
          // If user wrote "Topic: - bullet"
          const b = rest.replace(/^-+\s*/, "").trim();
          if (b) current.bullets.push(b);
        } else {
          // Treat rest as first bullet even if no dash
          current.bullets.push(rest);
        }
      }
      continue;
    }

    // If no section yet, create a default one
    if (!current) current = { topic: "Notes", bullets: [] };

    // Bullet line
    if (/^-+\s+/.test(trimmed)) {
      const b = trimmed.replace(/^-+\s+/, "").trim();
      if (b) current.bullets.push(b);
      continue;
    }

    // Continuation line: append to last bullet (same indent)
    if (current.bullets.length === 0) {
      current.bullets.push(trimmed);
    } else {
      current.bullets[current.bullets.length - 1] += " " + trimmed;
    }
  }

  if (current) sections.push(current);
  return sections;
}

function sectionsToHTML(sections) {
  if (!sections.length) return "<div class='note'>No content.</div>";

  return sections.map(sec => {
    const topic = escapeHTML(sec.topic);
    const items = sec.bullets
      .map(b => `<li>${escapeHTML(b)}</li>`)
      .join("");

    return `
      <div class="section">
        <div class="topic">${topic}:</div>
        <div>
          <ul class="bullets">${items || "<li>(none)</li>"}</ul>
        </div>
      </div>
    `;
  }).join("");
}

function formatNow() {
  const raw = $("src").value;
  const sections = parseTopicBullets(raw);
  const html = sectionsToHTML(sections);
  $("out").innerHTML = html;
  return { raw, sections, html };
}

$("btnFormat").addEventListener("click", formatNow);

$("btnSave").addEventListener("click", () => {
  const payload = formatNow();

  if (!GAS_WEBAPP_URL || GAS_WEBAPP_URL.includes("PASTE_YOUR_WEBAPP_URL_HERE")) {
    alert("Paste your Apps Script Web App URL into GAS_WEBAPP_URL first.");
    return;
  }

  // Submit via form POST (avoids CORS issues)
  const form = $("saveForm");
  form.action = GAS_WEBAPP_URL;

  $("rawField").value = payload.raw;
  $("htmlField").value = payload.html;
  $("jsonField").value = JSON.stringify(payload.sections);

  form.submit();
  alert("Sent to Google Sheet (check your sheet).");
});

// Auto-format on load
formatNow();
