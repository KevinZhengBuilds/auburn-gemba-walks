/**
 * Auburn Gemba Walks backend: a Google Apps Script web app bound to a Google Sheet.
 *
 * The GitHub Pages site posts JSON here. Every call must carry the password stored in this
 * script's properties (GEMBA_PASSWORD). The password never lives in the GitHub repo.
 *
 * Rules enforced here (not just in the page):
 *   - Wrong password: nothing is read or written.
 *   - Walks can only be saved or deleted for TODAY in Pacific time. Past walks are locked.
 *     To fix an old walk, edit the Walks tab in the Sheet directly.
 *
 * Sheet layout (created by setup()):
 *   Zones tab: id | name | sla_hours | order        (edit here to add or rename zones)
 *   Walks tab: date | <one column per zone id> | note | logged_by | updated_at
 */

const TZ = "America/Los_Angeles";
const WALKS = "Walks";
const ZONES = "Zones";
const FIXED = ["date", "note", "logged_by", "updated_at"];

/** Run once from the Apps Script editor after pasting this file. Safe to run again. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const z = ss.getSheetByName(ZONES) || ss.insertSheet(ZONES);
  if (z.getLastRow() === 0) {
    z.appendRow(["id", "name", "sla_hours", "order"]);
    [
      ["return", "Return Zone", 24, 1],
      ["infleet", "Infleet Zone", 48, 2],
      ["mqi", "MQI Zone", 24, 3],
      ["shuttle", "Shuttle Zone", 24, 4],
    ].forEach((r) => z.appendRow(r));
    z.setFrozenRows(1);
  }
  const w = ss.getSheetByName(WALKS) || ss.insertSheet(WALKS);
  if (w.getLastRow() === 0) {
    w.appendRow(["date", "return", "infleet", "mqi", "shuttle", "note", "logged_by", "updated_at"]);
    w.getRange("A:A").setNumberFormat("@");
    w.appendRow(["2026-11-09", 16, 9, "", "", "", "", ""]);
    w.appendRow(["2026-11-11", 6, 2, "", "", "", "", ""]);
    w.setFrozenRows(1);
  }
  const pw = PropertiesService.getScriptProperties().getProperty("GEMBA_PASSWORD");
  if (!pw) {
    throw new Error("Sheets are ready. Now add a script property named GEMBA_PASSWORD " +
      "(Project Settings > Script properties), then deploy as a web app.");
  }
}

function doGet() {
  return out({ ok: true, service: "auburn-gemba-walks" });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return out({ ok: false, error: "bad_request" });
  }

  const pw = PropertiesService.getScriptProperties().getProperty("GEMBA_PASSWORD");
  if (!pw) return out({ ok: false, error: "not_configured" });
  if (String(req.pw || "") !== pw) {
    Utilities.sleep(1000); // slows down guessing
    return out({ ok: false, error: "wrong_password" });
  }

  const today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");

  if (req.action === "list") return out(snapshot(today));

  if (req.action === "save" || req.action === "delete") {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      return out(req.action === "save" ? save(req, today) : remove(req, today));
    } finally {
      lock.releaseLock();
    }
  }
  return out({ ok: false, error: "unknown_action" });
}

/* ---------- actions ---------- */

function save(req, today) {
  if (req.date && req.date !== today) return { ok: false, error: "locked", today: today };
  const ids = readZones().map((z) => z.id);
  const counts = {};
  for (const id of ids) {
    const v = req.counts ? req.counts[id] : undefined;
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return { ok: false, error: "bad_count" };
    counts[id] = n;
  }
  if (!Object.keys(counts).length) return { ok: false, error: "no_counts" };

  const sh = sheet(WALKS);
  const header = headerOf(sh);
  ids.forEach((id) => {
    if (header.indexOf(id) === -1) {
      sh.getRange(1, header.length + 1).setValue(id);
      header.push(id);
    }
  });

  const row = header.map((col) => {
    if (col === "date") return today;
    if (col === "note") return clean(req.note, 1000);
    if (col === "logged_by") return clean(req.by, 60);
    if (col === "updated_at") return new Date().toISOString();
    return Object.prototype.hasOwnProperty.call(counts, col) ? counts[col] : "";
  });

  const r = findRow(sh, today);
  sh.getRange(r || sh.getLastRow() + 1, 1).setNumberFormat("@");
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return snapshot(today);
}

function remove(req, today) {
  if (req.date !== today) return { ok: false, error: "locked", today: today };
  const sh = sheet(WALKS);
  const r = findRow(sh, today);
  if (r) sh.deleteRow(r);
  return snapshot(today);
}

/* ---------- reads ---------- */

function snapshot(today) {
  return { ok: true, today: today, zones: readZones(), walks: readWalks() };
}

function readZones() {
  const sh = sheet(ZONES);
  if (sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  return vals
    .filter((r) => String(r[0]).trim())
    .map((r) => ({
      id: String(r[0]).trim(),
      name: String(r[1] || r[0]).trim(),
      sla_hours: Number(r[2]) || 0,
      order: Number(r[3]) || 99,
    }));
}

function readWalks() {
  const sh = sheet(WALKS);
  if (sh.getLastRow() < 2) return [];
  const header = headerOf(sh);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getValues();
  const out = [];
  vals.forEach((r) => {
    const date = asDate(r[0]);
    if (!date) return;
    const w = { date: date, counts: {}, note: "", logged_by: "", updated_at: "" };
    header.forEach((col, i) => {
      if (col === "date") return;
      if (col === "note") w.note = String(r[i] || "");
      else if (col === "logged_by") w.logged_by = String(r[i] || "");
      else if (col === "updated_at") w.updated_at = r[i] instanceof Date ? r[i].toISOString() : String(r[i] || "");
      else if (col && r[i] !== "" && r[i] !== null && !isNaN(Number(r[i]))) w.counts[col] = Number(r[i]);
    });
    out.push(w);
  });
  return out;
}

/* ---------- helpers ---------- */

function sheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error("Missing tab: " + name + ". Run setup() first.");
  return sh;
}

function headerOf(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map((h) => String(h).trim());
}

function findRow(sh, date) {
  if (sh.getLastRow() < 2) return 0;
  const col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) if (asDate(col[i][0]) === date) return i + 2;
  return 0;
}

function asDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd");
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** Trim, cap length, and stop text starting with = + - @ from being read as a formula. */
function clean(v, max) {
  let s = String(v || "").trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
