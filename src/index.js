import {
  STEPS, MODES, mergeConfig, localParts, toMin, fromMin, fmtLocal, effectiveMode,
  buildPlan, dueStep, nextStep, workedMs, dayStatus, weekdayOf,
} from "./schedule.js";
import { punch, status as bizneoStatus, BizneoError } from "./bizneo.js";
import { loginPage, dashboardPage, settingsPage } from "./ui.js";

const DAY_TTL = 60 * 60 * 24 * 120; // los días se guardan 120 días
const MAX_RETRIES = 6;

// ---------------- almacenamiento ----------------

const kv = {
  async get(env, key, fallback = null) {
    const v = await env.STATE.get(key, "json");
    return v ?? fallback;
  },
  put(env, key, value, ttl) {
    return env.STATE.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
  },
};

const loadConfig = async (env) => mergeConfig(await kv.get(env, "config"));
const tz = (env) => env.TZ || "Europe/Madrid";

async function addLog(env, entry) {
  const log = await kv.get(env, "log", []);
  log.unshift({ at: new Date().toISOString(), ...entry });
  await kv.put(env, "log", log.slice(0, 80));
}

async function getDay(env, cfg, date) {
  const calendar = await kv.get(env, "calendar", {});
  let day = await kv.get(env, `day:${date}`);
  const mode = effectiveMode(date, calendar[date], cfg.schedule);
  if (!day) {
    day = { date, mode, plan: buildPlan(cfg.schedule), actual: {}, finished: false, retries: {} };
  } else if (!day.actual?.entrada) {
    day.mode = mode; // mientras no se haya entrado, el modo sigue al calendario
  }
  day.override = calendar[date] || "auto";
  return day;
}
const saveDay = (env, day) => kv.put(env, `day:${day.date}`, day, DAY_TTL);

// ---------------- fichar ----------------

async function doPunch(env, cfg, day, step, source) {
  const now = new Date();
  const lp = localParts(now, tz(env));
  const vars = {
    iso: now.toISOString(),
    timestamp: String(Math.floor(now / 1000)),
    date: lp.date,
    time: fromMin(lp.minutes),
    mode: day.mode === "oficina" ? "office" : "remote",
  };
  try {
    const res = await punch(cfg.bizneo, step, vars);
    markDone(cfg, day, step, now.toISOString());
    delete day.lastError;
    await addLog(env, { type: "ok", step, source, msg: `${cap(step)} fichada a las ${vars.time}`, status: res.status });
    return { ok: true };
  } catch (e) {
    day.retries[step] = (day.retries[step] || 0) + 1;
    day.lastError = { step, msg: e.message, at: now.toISOString(), kind: e.kind };
    await addLog(env, { type: "error", step, source, msg: e.message, detail: e.detail || undefined });
    return { ok: false, error: e.message, kind: e instanceof BizneoError ? e.kind : "error" };
  }
}

function markDone(cfg, day, step, iso) {
  day.actual[step] = iso;
  if (step === "entrada") {
    // recalcula la salida a partir de la entrada real, conservando la comida planificada
    const entradaMin = toMin(fmtLocal(iso));
    const p = buildPlan(cfg.schedule, entradaMin);
    day.plan.entrada = p.entrada;
    day.plan.salida = p.salida;
  }
  if (step === "retorno" && day.actual.pausa) {
    // si la comida fue más larga/corta de lo previsto, ajusta la salida
    const comidaReal = (Date.parse(day.actual.retorno) - Date.parse(day.actual.pausa)) / 60000;
    const entradaMin = toMin(fmtLocal(day.actual.entrada));
    day.plan.salida = fromMin(entradaMin + cfg.schedule.objetivoMin + comidaReal);
  }
  if (step === "salida") day.finished = true;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------- cron ----------------

async function tick(env) {
  const cfg = await loadConfig(env);
  const lp = localParts(new Date(), tz(env));
  const day = await getDay(env, cfg, lp.date);
  const step = dueStep(day, cfg.schedule, lp.minutes);
  if (step) {
    const tries = day.retries[step] || 0;
    const last = day.lastError?.step === step ? Date.parse(day.lastError.at) : 0;
    // reintenta como mucho cada 5 min y hasta MAX_RETRIES veces
    if (tries < MAX_RETRIES && Date.now() - last > 5 * 60_000) {
      await doPunch(env, cfg, day, step, "auto");
    }
  }
  await saveDay(env, day);

  // aviso diario si la sesión de Bizneo está a punto de caducar
  const exp = cfg.bizneo.cookieExpiresAt && Date.parse(cfg.bizneo.cookieExpiresAt);
  if (exp && lp.hh === 8 && lp.mm === 0 && exp - Date.now() < 2 * 86400_000) {
    await addLog(env, { type: "warn", msg: "La sesión de Bizneo caduca en menos de 2 días: renuévala en Ajustes" });
  }
}

// ---------------- auth del panel ----------------

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, "");
}
const secretOf = (env) => env.SESSION_SECRET || env.APP_PASSWORD || "";

async function makeSid(env) {
  const exp = Date.now() + 30 * 86400_000;
  return `${exp}.${await hmac(secretOf(env), String(exp))}`;
}
async function authed(req, env) {
  const sid = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
  if (!sid) return false;
  const [exp, sig] = sid.split(".");
  return +exp > Date.now() && sig === (await hmac(secretOf(env), exp));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------- estado para el panel ----------------

function publicConfig(cfg) {
  const c = structuredClone(cfg);
  c.bizneo.hasCookie = Boolean(c.bizneo.cookie);
  c.bizneo.cookie = c.bizneo.cookie ? "•••• guardada (" + c.bizneo.cookie.length + " caracteres)" : "";
  return c;
}

function dayView(day, env, cfg) {
  const actual = {};
  for (const s of STEPS) actual[s] = fmtLocal(day.actual?.[s], tz(env));
  return {
    date: day.date, mode: day.mode, override: day.override, plan: day.plan, actual,
    actualIso: day.actual, status: dayStatus(day), lastError: day.lastError || null,
    next: nextStep(day, cfg.schedule), finished: day.finished,
    workedMs: workedMs(day.actual, Date.now()),
  };
}

function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function buildState(env, month) {
  const cfg = await loadConfig(env);
  const lp = localParts(new Date(), tz(env));
  const today = await getDay(env, cfg, lp.date);
  const calendar = await kv.get(env, "calendar", {});

  const monday = addDays(lp.date, 1 - lp.weekday);
  const week = [];
  for (let i = 0; i < 5; i++) {
    const date = addDays(monday, i);
    const d = date === lp.date ? today : await kv.get(env, `day:${date}`);
    week.push(d ? dayView(d, env, cfg) : {
      date, mode: effectiveMode(date, calendar[date], cfg.schedule), actual: {},
      status: date < lp.date ? "sin datos" : "pendiente",
    });
  }

  const m = month || lp.date.slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cal = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${m}-${String(d).padStart(2, "0")}`;
    cal.push({ date, weekday: weekdayOf(date), override: calendar[date] || "auto",
      mode: effectiveMode(date, calendar[date], cfg.schedule) });
  }

  return {
    now: new Date().toISOString(), today: dayView(today, env, cfg), week, month: m, calendar: cal,
    config: publicConfig(cfg), log: (await kv.get(env, "log", [])).slice(0, 25),
  };
}

// ---------------- HTTP ----------------

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const redirect = (to, extra = {}) => new Response(null, { status: 302, headers: { location: to, ...extra } });

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/login" && req.method === "POST") {
    const form = await req.formData();
    if (env.APP_PASSWORD && safeEqual(String(form.get("password") || ""), env.APP_PASSWORD)) {
      return redirect("/me/dashboard", {
        "set-cookie": `sid=${await makeSid(env)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
      });
    }
    return html(loginPage(env.APP_PASSWORD ? "Contraseña incorrecta" : "Falta configurar APP_PASSWORD"), 401);
  }
  if (path === "/logout") {
    return redirect("/", { "set-cookie": "sid=; Path=/; Max-Age=0" });
  }

  const ok = await authed(req, env);
  if (path === "/" || path === "/login") return ok ? redirect("/me/dashboard") : html(loginPage());
  if (!ok) return path.startsWith("/api/") ? json({ error: "No autenticado" }, 401) : redirect("/");

  if (path === "/me/dashboard") return html(dashboardPage());
  if (path === "/me/ajustes") return html(settingsPage());

  if (path === "/api/state") return json(await buildState(env, url.searchParams.get("month")));

  if (req.method !== "POST") return json({ error: "No encontrado" }, 404);
  const body = await req.json().catch(() => ({}));
  const cfg = await loadConfig(env);
  const lp = localParts(new Date(), tz(env));

  switch (path) {
    // Fichar ahora el siguiente paso (o uno concreto)
    case "/api/punch": {
      const day = await getDay(env, cfg, lp.date);
      const step = body.step || nextStep(day, cfg.schedule);
      if (!step) return json({ error: "La jornada ya está completa" }, 400);
      const r = await doPunch(env, cfg, day, step, "manual");
      await saveDay(env, day);
      return json(r, r.ok ? 200 : 502);
    }
    // Terminar la jornada ahora (cierra la pausa si estabas en ella)
    case "/api/finish": {
      const day = await getDay(env, cfg, lp.date);
      if (!day.actual.entrada) return json({ error: "Aún no has fichado la entrada" }, 400);
      if (day.actual.pausa && !day.actual.retorno) {
        const r = await doPunch(env, cfg, day, "retorno", "manual");
        if (!r.ok) { await saveDay(env, day); return json(r, 502); }
      }
      const r = await doPunch(env, cfg, day, "salida", "manual");
      await saveDay(env, day);
      return json(r, r.ok ? 200 : 502);
    }
    // Registrar un fichaje que ya hiciste en Bizneo (sin enviar nada)
    case "/api/mark": {
      const day = await getDay(env, cfg, lp.date);
      if (!STEPS.includes(body.step) || !/^\d{2}:\d{2}$/.test(body.time || "")) {
        return json({ error: "Paso u hora no válidos" }, 400);
      }
      const offsetMin = lp.minutes - toMin(body.time);
      const iso = new Date(Date.now() - offsetMin * 60000).toISOString();
      markDone(cfg, day, body.step, iso);
      await saveDay(env, day);
      await addLog(env, { type: "info", step: body.step, source: "manual", msg: `${cap(body.step)} registrada a mano: ${body.time}` });
      return json({ ok: true });
    }
    // Deshacer un fichaje registrado en el panel (no lo borra de Bizneo)
    case "/api/unmark": {
      const day = await getDay(env, cfg, lp.date);
      const i = STEPS.indexOf(body.step);
      if (i < 0) return json({ error: "Paso no válido" }, 400);
      for (const s of STEPS.slice(i)) delete day.actual[s];
      day.finished = false;
      day.retries = {};
      await saveDay(env, day);
      return json({ ok: true });
    }
    // Cambiar el modo de hoy (oficina → casa → libre → auto)
    case "/api/today-mode":
    case "/api/calendar": {
      const date = path === "/api/today-mode" ? lp.date : body.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return json({ error: "Fecha no válida" }, 400);
      if (date < lp.date) return json({ error: "No se pueden cambiar días pasados" }, 400);
      const calendar = await kv.get(env, "calendar", {});
      // si el día está en "auto", el ciclo empieza desde el modo que tiene en la práctica
      // y si vuelve al modo por defecto, se guarda como "auto" (sin excepción en el calendario)
      const CYCLE = ["oficina", "casa", "libre"];
      const def = effectiveMode(date, null, cfg.schedule);
      const cur = calendar[date] || def;
      let next = body.mode && MODES.includes(body.mode) ? body.mode : CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      if (next === def) next = "auto";
      if (next === "auto") delete calendar[date]; else calendar[date] = next;
      await kv.put(env, "calendar", calendar);
      if (date === lp.date) { const day = await getDay(env, cfg, date); await saveDay(env, day); }
      return json({ ok: true, mode: next });
    }
    // Comprobar sesión/estado en Bizneo
    case "/api/sync": {
      const st = await bizneoStatus(cfg.bizneo);
      const day = await getDay(env, cfg, lp.date);
      if (st.ok && st.working === true && !day.actual.entrada) {
        markDone(cfg, day, "entrada", new Date().toISOString());
        await addLog(env, { type: "info", step: "entrada", source: "sync", msg: "Bizneo indica que ya estás trabajando: entrada registrada" });
      }
      await saveDay(env, day);
      await addLog(env, { type: st.ok ? "ok" : "error", source: "sync", msg: st.ok ? "Sesión de Bizneo válida" : st.reason });
      return json(st, st.ok ? 200 : 502);
    }
    // Recalcular el plan de hoy (nuevo azar en la entrada)
    case "/api/replan": {
      const day = await getDay(env, cfg, lp.date);
      if (day.actual.entrada) return json({ error: "La jornada ya ha empezado" }, 400);
      day.plan = buildPlan(cfg.schedule);
      day.retries = {};
      await saveDay(env, day);
      return json({ ok: true, plan: day.plan });
    }
    case "/api/config": {
      const saved = (await kv.get(env, "config")) || {};
      const next = mergeConfig(saved);
      if (body.profile) {
        for (const k of ["name", "email"]) if (typeof body.profile[k] === "string") next.profile[k] = body.profile[k].trim().slice(0, 120);
      }
      if (body.schedule) Object.assign(next.schedule, sanitizeSchedule(body.schedule, next.schedule));
      if (body.bizneo) {
        const b = body.bizneo;
        for (const k of ["baseUrl", "csrfPage", "statusUrl", "workingJsonPath"]) {
          if (typeof b[k] === "string") next.bizneo[k] = b[k].trim();
        }
        if (typeof b.cookie === "string" && b.cookie.trim()) {
          next.bizneo.cookie = b.cookie.trim().replace(/^cookie:\s*/i, "");
          next.bizneo.cookieSavedAt = new Date().toISOString();
          next.bizneo.cookieExpiresAt = b.cookieExpiresAt
            ? new Date(b.cookieExpiresAt).toISOString()
            : new Date(Date.now() + 14 * 86400_000).toISOString();
        } else if (b.cookieExpiresAt) {
          next.bizneo.cookieExpiresAt = new Date(b.cookieExpiresAt).toISOString();
        }
        if (b.clearCookie) { next.bizneo.cookie = ""; next.bizneo.cookieExpiresAt = null; }
        for (const s of STEPS) {
          const a = b.actions?.[s];
          if (a) next.bizneo.actions[s] = {
            method: ["POST", "PUT", "PATCH", "GET"].includes(a.method) ? a.method : "POST",
            url: String(a.url || "").trim(), body: String(a.body || ""),
          };
        }
      }
      await kv.put(env, "config", next);
      // si hoy aún no ha empezado, rehace el plan con el horario nuevo
      const day = await getDay(env, cfg, lp.date);
      if (!day.actual.entrada && body.schedule) { day.plan = buildPlan(next.schedule); await saveDay(env, day); }
      return json({ ok: true });
    }
    case "/api/test-action": {
      // prueba la sesión sin fichar: sólo pide el token CSRF
      const st = await bizneoStatus({ ...cfg.bizneo, statusUrl: "" });
      return json(st, st.ok ? 200 : 502);
    }
  }
  return json({ error: "No encontrado" }, 404);
}

function sanitizeSchedule(s, cur) {
  const out = {};
  const hhmm = /^\d{2}:\d{2}$/;
  for (const k of ["entrada", "pausa", "retorno"]) if (hhmm.test(s[k] || "")) out[k] = s[k];
  if (Number.isFinite(+s.objetivoMin) && +s.objetivoMin > 0 && +s.objetivoMin < 720) out.objetivoMin = +s.objetivoMin;
  if (Number.isFinite(+s.jitterMin) && +s.jitterMin >= 0 && +s.jitterMin <= 60) out.jitterMin = +s.jitterMin;
  if (typeof s.comida === "boolean") out.comida = s.comida;
  if (Array.isArray(s.workdays)) out.workdays = s.workdays.map(Number).filter((n) => n >= 1 && n <= 7);
  if (s.defaultModes && typeof s.defaultModes === "object") {
    out.defaultModes = { ...cur.defaultModes };
    for (const [k, v] of Object.entries(s.defaultModes)) if (["oficina", "casa", "libre"].includes(v)) out.defaultModes[k] = v;
  }
  return out;
}

export default {
  fetch: (req, env) => handle(req, env).catch((e) => json({ error: e.message }, 500)),
  scheduled: (event, env, ctx) => ctx.waitUntil(tick(env)),
};
