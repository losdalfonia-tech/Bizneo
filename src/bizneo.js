// Cliente del cronómetro de Bizneo HR usando la sesión web del usuario.
//
// En la portada de Bizneo el fichaje se hace con el "Cronómetro", un formulario htmx:
//   parado      → POST /chrono              (botón "Iniciar", campo kind = working_time | telework)
//   en marcha   → PUT  /chrono/<user_id>    (botón "Finalizar"; "Pausar" añade pause=<id>)
//   en pausa    → mismo formulario con el botón "Reanudar"
// En cada fichaje se descarga la portada, se lee el formulario (token CSRF, shift_id…) y el
// estado actual, se comprueba que la acción no está ya hecha, se envía la petición igual que
// htmx y se vuelve a cargar la página para verificar que el estado ha cambiado.

import { zonedToIso } from "./schedule.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class BizneoError extends Error {
  constructor(msg, kind = "error", detail = null) {
    super(msg);
    this.kind = kind;
    this.detail = detail;
  }
}

// ---------------- HTML ----------------

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
export const decode = (s) =>
  String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1));
    return ENT[e.toLowerCase()] ?? m;
  });

// Atributos de una etiqueta de apertura: '<input name="a" checked>' → {name:"a", checked:""}
export function attrsOf(tag) {
  const out = {};
  const body = tag.replace(/^<\s*[\w-]+/, "").replace(/\/?>$/, "");
  for (const m of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const text = (html) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function findChronoForm(html) {
  for (const m of html.matchAll(/<form\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if (/\bchronometer\b/.test(a.class || "") || /^chrono-form/.test(a.id || "")) {
      const end = html.indexOf("</form>", m.index);
      return { attrs: a, inner: html.slice(m.index + m[0].length, end < 0 ? undefined : end) };
    }
  }
  return null;
}

/**
 * Lee el cronómetro de la portada.
 * @returns {{state:"stopped"|"running"|"paused"|"unknown", verb, path, formId, fields:[string,string][],
 *   kinds:string[], buttons:{start,stop,resume,pauses:[]}, startedAt:string|null, registeredMin:number|null}}
 */
export function parseChrono(html) {
  const f = findChronoForm(html || "");
  if (!f) return { state: "unknown", reason: "No encuentro el cronómetro en la portada" };
  const { attrs: fa, inner } = f;

  const fields = [];
  const kinds = [];
  for (const m of inner.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if (!a.name || "disabled" in a) continue;
    const type = (a.type || "text").toLowerCase();
    if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
    if (type === "radio" || type === "checkbox") {
      if (a.name === "kind") kinds.push(a.value);
      if (!("checked" in a)) continue;
    }
    fields.push([a.name, a.value ?? (type === "checkbox" ? "on" : "")]);
  }
  for (const m of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const a = attrsOf("<textarea" + m[1] + ">");
    if (a.name && !("disabled" in a)) fields.push([a.name, decode(m[2])]);
  }

  // Botones del formulario (y los que lo referencian con form="id" desde fuera)
  const buttons = [];
  const seen = new Set();
  const addButtons = (src, mustReference) => {
    for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const a = attrsOf("<button" + m[1] + ">");
      if ((a.type || "submit").toLowerCase() !== "submit") continue;
      if (mustReference && a.form !== fa.id) continue;
      const key = m[0];
      if (seen.has(key)) continue;
      seen.add(key);
      buttons.push({ name: a.name || null, value: a.value ?? "", text: text(m[2]), gtm: a["data-gtm-action"] || "", start: "data-chronostart" in a });
    }
  };
  addButtons(inner, false);
  if (fa.id) addButtons(html.replace(inner, ""), true);

  const start = buttons.find((b) => b.start || /\biniciar\b/i.test(b.text) || /chrono start/i.test(b.gtm));
  const stop = buttons.find((b) => /\bfinalizar\b/i.test(b.text) || /chrono stop/i.test(b.gtm));
  const resume = buttons.find((b) => /\breanudar\b|\bcontinuar\b/i.test(b.text) || /chrono (resume|restart|continue)/i.test(b.gtm));
  const pauses = buttons.filter((b) => b.name === "pause" || /chrono pause/i.test(b.gtm));

  let state = "unknown";
  if (resume) state = "paused";
  else if (stop) state = "running";
  else if (start) state = "stopped";

  const verb = ["put", "patch", "post", "delete"].find((v) => fa["hx-" + v] !== undefined);
  const methodField = fields.find(([k]) => k === "_method")?.[1];
  const from = inner.match(/data-from="([^"]+)"/);
  const reg = inner.match(/<b>\s*(\d{1,2}):(\d{2})\s*<\/b>[\s\S]{0,300}?registrado hoy/i);

  return {
    state,
    verb: (verb || methodField || fa.method || "post").toUpperCase(),
    path: verb ? fa["hx-" + verb] : fa.action || "/chrono",
    formId: fa.id || null,
    fields,
    kinds,
    buttons: { start, stop, resume, pauses },
    startedAt: from && state !== "stopped" ? zonedToIso(decode(from[1])) : null,
    registeredMin: reg ? +reg[1] * 60 + +reg[2] : null,
  };
}

/** Mini-calendario de la portada: { "2026-11-02": {classes:["day","holiday"], type:"none"} } */
export function parseCalendar(html) {
  const days = {};
  for (const m of (html || "").matchAll(/<a\b[^>]*>/gi)) {
    if (!/requested_days/.test(m[0])) continue;
    const a = attrsOf(m[0]);
    const classes = (a.class || "").split(/\s+/).filter(Boolean);
    if (!classes.includes("day")) continue;
    const d = (a.href || a["hx-get"] || "").match(/requested_days(?:\]|%5D)=(\d{4}-\d{2}-\d{2})/i);
    if (d) days[d[1]] = { classes, type: a["data-type"] || null };
  }
  return days;
}

export const WORKING_CLASSES = ["day", "today", "out"];

// Motivo por el que un día no es laborable según Bizneo (festivo, ausencia, fin de semana…) o null.
export function dayOffReason(info) {
  if (!info) return null;
  const extra = info.classes.filter((c) => !WORKING_CLASSES.includes(c));
  if (info.type && info.type !== "none") extra.push(`tipo ${info.type}`);
  return extra.length ? extra.join(" ") : null;
}

export const OFF_LABEL = { holiday: "festivo", "no-working-day": "día no laborable" };
export const offLabel = (reason) =>
  reason ? reason.split(" ").map((c) => OFF_LABEL[c] || c).join(", ") : "";

// ---------------- sesión (cookies) ----------------

export function mergeSetCookies(cookie, setCookies, now = Date.now()) {
  const jar = new Map();
  for (const p of String(cookie || "").split(/;\s*/)) {
    const i = p.indexOf("=");
    if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  let sessionExpires = null;
  for (const sc of setCookies || []) {
    const [pair, ...attrs] = sc.split(";");
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    let exp = null;
    for (const a of attrs) {
      const j = a.indexOf("=");
      const k = (j < 0 ? a : a.slice(0, j)).trim().toLowerCase();
      const v = j < 0 ? "" : a.slice(j + 1).trim();
      if (k === "max-age") exp = new Date(now + +v * 1000);
      else if (k === "expires" && !exp) exp = new Date(v);
    }
    if (exp && !isNaN(exp) && +exp <= now) continue; // borrado de cookie: lo ignoramos
    jar.set(name, value);
    if (name === "_hcmex_key" && exp && !isNaN(exp)) sessionExpires = exp.toISOString();
  }
  return { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), sessionExpires };
}

function looksLikeLogin(res, html) {
  const loc = res.headers.get("location") || "";
  return (
    res.status === 401 ||
    (res.status >= 300 && res.status < 400 && /sign_in|login|session|auth/i.test(loc)) ||
    /name="user\[password\]"|id="new_user"/i.test(html || "")
  );
}

export class Session {
  constructor(cfg, fetchImpl) {
    if (!cfg.cookie) throw new BizneoError("No hay sesión de Bizneo configurada", "config");
    this.base = cfg.baseUrl.replace(/\/+$/, "");
    this.cookie = cfg.cookie;
    this.sessionExpires = null;
    // (en Workers, fetch debe llamarse sin "this": por eso la envoltura)
    this.fetch = fetchImpl || ((...a) => fetch(...a));
  }

  async request(path, init = {}) {
    const res = await this.fetch(this.base + path, {
      ...init,
      headers: { cookie: this.cookie, "user-agent": UA, ...(init.headers || {}) },
      redirect: "manual",
    });
    const body = await res.text();
    this.lastStatus = res.status;
    if (looksLikeLogin(res, body)) throw new BizneoError("La sesión de Bizneo ha caducado", "session");
    const sc = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (sc.length) {
      const m = mergeSetCookies(this.cookie, sc);
      this.cookie = m.cookie;
      if (m.sessionExpires) this.sessionExpires = m.sessionExpires;
    }
    return { res, body };
  }

  async home() {
    const { res, body } = await this.request("/", { headers: { accept: "text/html" } });
    if (res.status >= 400) throw new BizneoError(`Bizneo respondió ${res.status} al cargar la portada`, "http");
    if (res.status >= 300) throw new BizneoError(`Bizneo redirige la portada a ${res.headers.get("location")}`, "http");
    return body;
  }
}

// ---------------- acciones ----------------

const TARGET = { entrada: "running", pausa: "paused", retorno: "running", salida: "stopped" };
const STATE_TXT = { stopped: "parado", running: "en marcha", paused: "en pausa", unknown: "desconocido" };

// Cuerpo de la petición tal como lo enviaría htmx al pulsar `submitter`.
export function buildBody(chrono, submitter, overrides = {}) {
  const params = new URLSearchParams();
  const fields = chrono.fields.map(([k, v]) => [k, k in overrides ? overrides[k] : v]);
  for (const k of Object.keys(overrides)) if (!fields.some(([f]) => f === k)) fields.push([k, overrides[k]]);
  for (const [k, v] of fields) params.append(k, v);
  if (submitter?.name) params.append(submitter.name, submitter.value);
  return params;
}

export const hideCsrf = (params) =>
  [...params].map(([k, v]) => `${k}=${/csrf/i.test(k) ? "…" : v}`).join("&");

async function send(session, chrono, submitter, overrides) {
  const body = buildBody(chrono, submitter, overrides);
  const csrf = body.get("_csrf_token");
  const headers = {
    accept: "text/html, */*",
    "content-type": "application/x-www-form-urlencoded",
    "hx-request": "true",
    "hx-current-url": session.base + "/",
    "hx-target": "chronometer-wrapper",
    origin: session.base,
    referer: session.base + "/",
  };
  if (chrono.formId) headers["hx-trigger"] = chrono.formId;
  if (csrf) headers["x-csrf-token"] = csrf;
  const { res, body: resp } = await session.request(chrono.path, { method: chrono.verb, headers, body: body.toString() });
  if (res.status >= 400) throw new BizneoError(`Bizneo respondió ${res.status}`, "http", resp.slice(0, 300));
}

/**
 * Ejecuta un paso del cronómetro comprobando antes que no está ya hecho.
 * @param cfg  config.bizneo (+ fetchImpl opcional para tests)
 * @param step entrada | pausa | retorno | salida
 * @param opts { kind, date, checkCalendar, dryRun }
 * @returns {{outcome:"done"|"simulated"|"already"|"skipped"|"off", msg, startedAt?, request?, cookie, sessionExpires}}
 */
export async function chronoAction(cfg, step, opts = {}) {
  const session = new Session(cfg, cfg.fetchImpl);
  const dryRun = opts.dryRun ?? cfg.dryRun;
  const result = (outcome, msg, extra = {}) => ({ outcome, msg, cookie: session.cookie, sessionExpires: session.sessionExpires, ...extra });

  const html = await session.home();
  const c = parseChrono(html);
  if (c.state === "unknown") throw new BizneoError(c.reason || "No reconozco el estado del cronómetro", "parse");

  // ¿Ya está hecho?
  if (c.state === TARGET[step] || (step === "entrada" && c.state === "paused")) {
    if (step === "salida" && !c.registeredMin) {
      return result("skipped", "El cronómetro está parado y hoy no hay tiempo registrado: la jornada no se llegó a iniciar");
    }
    return result("already", `Ya estaba hecho: el cronómetro está ${STATE_TXT[c.state]}`, { startedAt: c.startedAt });
  }

  // ¿Se puede hacer desde el estado actual?
  if (step === "entrada") {
    if (c.registeredMin > 0) {
      return result("skipped", `El cronómetro está parado pero hoy ya hay ${fmtReg(c.registeredMin)} registradas: no se vuelve a iniciar`);
    }
    if (opts.checkCalendar !== false) {
      const cal = parseCalendar(html);
      const info = cal[opts.date];
      if (!info) throw new BizneoError(`No encuentro el día ${opts.date} en el calendario de Bizneo: no se ficha por si es festivo o vacaciones`, "parse");
      const off = dayOffReason(info);
      if (off) return result("off", `Bizneo marca hoy como ${offLabel(off)}: no se ficha`, { offReason: off });
    }
  }
  if ((step === "pausa" || step === "retorno") && c.state === "stopped") {
    return result("skipped", "El cronómetro está parado: la jornada no está iniciada");
  }
  if (step === "retorno" && c.state === "running") {
    return result("already", "El cronómetro ya está en marcha");
  }

  // Petición
  let submitter;
  let overrides = {};
  let preResume = false;
  if (step === "entrada") {
    submitter = c.buttons.start;
    if (opts.kind) {
      if (c.kinds.length && !c.kinds.includes(opts.kind)) {
        throw new BizneoError(`Bizneo no ofrece la opción "${opts.kind}" (hay: ${c.kinds.join(", ")})`, "parse");
      }
      overrides.kind = opts.kind;
    }
  } else if (step === "pausa") {
    const want = new RegExp(cfg.pauseLabel || "comida", "i");
    submitter = c.buttons.pauses.find((b) => want.test(b.text)) || c.buttons.pauses[0];
    if (!submitter) throw new BizneoError("No encuentro la opción de pausa en el cronómetro", "parse");
  } else if (step === "retorno") {
    submitter = c.buttons.resume;
  } else if (step === "salida") {
    submitter = c.buttons.stop;
    if (!submitter && c.state === "paused") preResume = true; // en pausa sin "Finalizar": reanudar y finalizar
  }
  if (!submitter && !preResume) throw new BizneoError(`No encuentro el botón para "${step}"`, "parse");

  const desc = `${c.verb} ${c.path}`;
  if (dryRun) {
    const body = submitter ? hideCsrf(buildBody(c, submitter, overrides)) : "(reanudar y finalizar)";
    return result("simulated", `Modo prueba: habría enviado ${desc} (${body})`, { request: { method: c.verb, path: c.path, body } });
  }

  let cur = c;
  if (preResume) {
    await send(session, cur, cur.buttons.resume, {});
    cur = parseChrono(await session.home());
    if (!cur.buttons.stop) throw new BizneoError("Tras reanudar no aparece el botón Finalizar", "verify");
    submitter = cur.buttons.stop;
  }
  await send(session, cur, submitter, overrides);

  // Verificación
  const after = parseChrono(await session.home());
  if (after.state !== TARGET[step]) {
    throw new BizneoError(`Bizneo no ha cambiado el estado: el cronómetro sigue ${STATE_TXT[after.state]}`, "verify");
  }
  return result("done", `Hecho (${desc})`, { startedAt: after.startedAt });
}

const fmtReg = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;

/** Estructura de una página (sin textos ni valores) para depurar cuando no se encuentra el cronómetro. */
export function pageHints(html, status) {
  const uniq = (a) => [...new Set(a)].slice(0, 25);
  const tags = [...(html || "").matchAll(/<(form|div|section|turbo-frame|span|a|button)\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  return {
    status,
    length: (html || "").length,
    title: ((html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim().slice(0, 80),
    csrfMeta: /name="csrf-token"/i.test(html || ""),
    lazy: uniq(tags.filter((a) => /load|revealed|intersect/.test(a["hx-trigger"] || "")).map((a) => `${a["hx-get"] || a["hx-post"] || "?"} [${a["hx-trigger"]}]`)),
    chrono: uniq(tags.flatMap((a) => Object.entries(a).filter(([k, v]) => /chrono/i.test(v) && !/csrf/i.test(k)).map(([k, v]) => `${k}=${v.slice(0, 80)}`))),
    forms: uniq(tags.filter((a) => a.action || a["hx-post"] || a["hx-put"]).map((a) => `${a.id || ""} ${a["hx-put"] || a["hx-post"] || a.action}`)),
    ids: uniq(tags.map((a) => a.id).filter((id) => id && /chrono|hub|main/i.test(id))),
  };
}

/** Diagnóstico sin fichar: estado del cronómetro, opciones y cómo ve Bizneo el día. */
export async function diagnose(cfg, date) {
  const session = new Session(cfg, cfg.fetchImpl);
  const html = await session.home();
  const c = parseChrono(html);
  const info = parseCalendar(html)[date] || null;
  return {
    ok: c.state !== "unknown",
    state: c.state,
    stateTxt: STATE_TXT[c.state],
    startedAt: c.startedAt,
    registeredMin: c.registeredMin,
    request: c.state === "unknown" ? null : `${c.verb} ${c.path}`,
    csrf: c.fields?.some(([k, v]) => k === "_csrf_token" && v) || false,
    kinds: c.kinds || [],
    pauses: (c.buttons?.pauses || []).map((b) => b.text),
    today: info ? { classes: info.classes, off: dayOffReason(info) } : null,
    cookie: session.cookie,
    sessionExpires: session.sessionExpires,
    reason: c.reason,
    hints: c.state === "unknown" ? pageHints(html, session.lastStatus) : undefined,
  };
}

/** Comprueba sólo que la sesión es válida. */
export async function checkSession(cfg) {
  const session = new Session(cfg, cfg.fetchImpl);
  const html = await session.home();
  return { ok: true, chrono: parseChrono(html).state, cookie: session.cookie, sessionExpires: session.sessionExpires };
}
