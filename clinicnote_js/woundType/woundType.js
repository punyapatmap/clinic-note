// =====================
// Wound shorthand expander
// =====================

// wound type dictionary (add more as you like)
const WOUND_TYPE = {
  lw: "LW",
  aw: "AW",
  cw: "Contusion wound",
  sw: "Stab wound",
  gw: "Gunshot wound",
  bw: "Bite wound",
  fw: "Fracture wound",
};

// side dictionary
const SIDE = {
  "1": "Lt.",
  "2": "Rt.",
};

// surface dictionary (supports combined codes like al, am, pl, pm)
const SURFACE = {
  a: "Anterior",
  p: "Posterior",
  l: "Lateral",
  m: "Medial",
  al: "Anterolateral",
  am: "Anteromedial",
  pl: "Posterolateral",
  pm: "Posteromedial",
};

// pattern: <w>-<h><type>@<side><surface>.<site>
// examples: 2-3lw@1a.forearm, 4-2lw@2p.arm, 2-3lw@1al.thigh, 4-2lw@2pm.leg
const WOUND_RE = /\b(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)([a-z]{1,3})@([12])([a-z]{1,2})\.([a-z][a-z0-9_-]*)\b/gi;

function titleCaseWord(s) {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function expandOne(match, w, h, typeCode, sideNum, surfCode, site) {
  const typeKey = String(typeCode).toLowerCase();
  const woundType = WOUND_TYPE[typeKey] || typeCode.toUpperCase();

  const side = SIDE[String(sideNum)] || sideNum;
  const surfKey = String(surfCode).toLowerCase();
  const surface = SURFACE[surfKey] || surfCode;

  const siteText = titleCaseWord(String(site));

  // format like: "2x3 cm Laceration wound at Lt. anterior Forearm"
  return `${w}x${h} cm ${woundType} at ${side} ${surface} ${siteText}`.trim();
}

function expandWoundText(text) {
  return text.replace(WOUND_RE, expandOne);
}

// Live update: show expanded in another box (safe + no caret issues)
function setupWoundExpander() {
  const src = document.getElementById("woundShort");
  const out = document.getElementById("woundExpanded");
  if (!src || !out) return;

  const render = () => {
    out.value = expandWoundText(src.value);
  };

  src.addEventListener("input", render);
  render();
}

setupWoundExpander();
