import {
  STEPS, MODES, KIND, mergeConfig, localParts, toMin, fromMin, fmtLocal, effectiveMode,
  buildPlan, dueStep, nextStep, missedBefore, workedMs, dayStatus, weekdayOf, dayHours,
  hasLunch, goalMin, recalcSalida, salidaFromRegistered,
} from "./schedule.js";
import { chronoAction, diagnose, checkSession, BizneoError, Session, offLabel, pageHints } from "./bizneo.js";
import { sendMail, notifyOnce } from "./notify.js";
import { loginPage, dashboardPage, settingsPage } from "./ui.js";

const DAY_TTL = 60 * 60 * 24 * 120; // los días se guardan 120 días
const MAX_RETRIES = 6;
const LABEL = { entrada: "Iniciar", pausa: "Pausar", retorno: "Reanudar", salida: "Finalizar" };

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
  await kv.put(env, "log", log.slice(0, 100));
}

async function getDay(env, cfg, date) {
  const calendar = await kv.get(env, "calendar", {});
  let day = await kv.get(env, `day:${date}`);
  const mode = effectiveMode(date, calendar[date], cfg.schedule);
  const hours = dayHours(cfg.schedule, weekdayOf(date));
  if (!day) {
    day = { date, mode, plan: buildPlan(hours, cfg.schedule.jitterMin), actual: {}, skipped: {}, finished: false, retries: {} };
  } else if (!day.actual?.entrada && !day.offReason) {
    day.mode = mode; // mientras no se haya entrado, el modo sigue al calendario
  }
  day.skipped ||= {};
  day.retries ||= {};
  day.override = calendar[date] || "auto";
  return day;
}
const saveDay = (env, day) => kv.put(env, `day:${day.date}`, day, DAY_TTL);

// Guarda la cookie si Bizneo la ha renovado (Set-Cookie) y actualiza la caducidad.
async function persistCookie(env, r) {
  if (!r?.cookie) return;
  const saved = (await kv.get(env, "config")) || {};
  const b = saved.bizneo || {};
  if (b.cookie === r.cookie && (!r.sessionExpires || b.cookieExpiresAt === r.sessionExpires)) return;
  saved.bizneo = { ...b, cookie: r.cookie, ...(r.sessionExpires ? { cookieExpiresAt: r.sessionExpires } : {}) };
  await kv.put(env, "config", saved);
}

// ---------------- fichar ----------------

const clientCfg = (cfg, env) => ({ ...cfg.bizneo, fetchImpl: env.__fetch });

async function doPunch(env, cfg, day, step, source) {
  const now = new Date();
  const hora = fromMin(localParts(now, tz(env)).minutes);
  try {
    const r = await chronoAction(clientCfg(cfg, env), step, {
      kind: KIND[day.mode] || KIND.casa,
      date: day.date,
      checkCalendar: source === "auto",
    });
    await persistCookie(env, r);
    delete day.lastError;
    day.retries[step] = 0;

    if (r.outcome === "off") {
      day.mode = "libre";
      day.offReason = r.offReason;
      await addLog(env, { type: "info", step, source, msg: r.msg });
      return { ok: true, outcome: r.outcome, msg: r.msg };
    }
    if (r.outcome === "skipped") {
      day.skipped[step] = r.msg;
      await addLog(env, { type: "warn", step, source, msg: `${LABEL[step]}: no se ha hecho. ${r.msg}` });
      if (source === "auto") {
        await notifyOnce(env, cfg.profile.email, `skip:${day.date}:${step}`,
          `⚠ Bizneo: no se ha fichado "${LABEL[step]}" (${day.date})`,
          `A las ${hora} tocaba "${LABEL[step]}" pero no se ha enviado nada:\n\n${r.msg}\n\nRevisa tu cronómetro en Bizneo.`);
      }
      return { ok: true, outcome: r.outcome, msg: r.msg };
    }
    // done | simulated | already
    const iso = step === "entrada" && r.startedAt ? r.startedAt : now.toISOString();
    markDone(cfg, env, day, step, iso);
    if (r.outcome !== "simulated") noteBizneo(cfg, env, day, r);
    if (r.outcome === "simulated") day.simulated = { ...(day.simulated || {}), [step]: true };
    const msg = {
      done: `${LABEL[step]} fichado a las ${fmtLocal(iso, tz(env))}`,
      simulated: `${LABEL[step]} (simulado) · ${r.msg}`,
      already: `${LABEL[step]}: ${r.msg}`,
    }[r.outcome];
    await addLog(env, { type: r.outcome === "done" ? "ok" : "info", step, source, msg });
    return { ok: true, outcome: r.outcome, msg };
  } catch (e) {
    day.retries[step] = (day.retries[step] || 0) + 1;
    day.lastError = { step, msg: e.message, at: now.toISOString(), kind: e.kind };
    await addLog(env, { type: "error", step, source, msg: `${LABEL[step]}: ${e.message}`, detail: e.detail || undefined });
    if (source === "auto") {
      if (day.retries[step] >= MAX_RETRIES) day.skipped[step] = `Error tras ${MAX_RETRIES} intentos: ${e.message}`;
      const key = e.kind === "session" ? `session:${day.date}` : `fail:${day.date}:${step}`;
      const extra = e.kind === "session"
        ? "La sesión de Bizneo ha caducado. Copia una cookie nueva (_hcmex_key y device_id) y pégala en Ajustes del panel."
        : day.retries[step] >= MAX_RETRIES ? "Ya no se reintentará: ficha a mano en Bizneo." : `Se reintentará cada 5 minutos (máx. ${MAX_RETRIES} veces).`;
      await notifyOnce(env, cfg.profile.email, key,
        `❌ Bizneo: falló "${LABEL[step]}" (${day.date})`,
        `A las ${hora} no se pudo fichar "${LABEL[step]}":\n\n${e.message}\n\n${extra}`);
    }
    return { ok: false, error: e.message, kind: e instanceof BizneoError ? e.kind : "error" };
  }
}

// Guarda lo que Bizneo lleva registrado hoy y ajusta la hora de finalizar con ese dato.
function noteBizneo(cfg, env, day, { state, registeredMin }) {
  if (registeredMin == null || !state || state === "unknown") return;
  const now = new Date();
  day.bizneo = { state, registeredMin, at: now.toISOString() };
  if ((state === "running" || state === "paused") && day.actual.entrada && !day.finished) {
    const hours = dayHours(cfg.schedule, weekdayOf(day.date));
    const s = salidaFromRegistered(hours, day.plan, day.actual, { registeredMin, state, atMin: localParts(now, tz(env)).minutes });
    if (s) day.plan.salida = s;
  }
}

function markDone(cfg, env, day, step, iso) {
  day.actual[step] = iso;
  delete day.skipped[step];
  const hours = dayHours(cfg.schedule, weekdayOf(day.date));
  if (step === "entrada" || step === "retorno") {
    // la salida se recalcula a partir de la entrada real (y de la comida real)
    const s = recalcSalida(hours, day.actual, tz(env));
    if (s) day.plan.salida = s;
  }
  if (step === "salida") day.finished = true;
}

// ---------------- cron ----------------

async function tick(env) {
  const cfg = await loadConfig(env);
  const lp = localParts(new Date(), tz(env));
  const day = await getDay(env, cfg, lp.date);
  const before = JSON.stringify(day);

  const step = dueStep(day, lp.minutes);
  if (step) {
    for (const s of missedBefore(day, step)) day.skipped[s] = "No se fichó a su hora";
    const tries = day.retries[step] || 0;
    const last = day.lastError?.step === step ? Date.parse(day.lastError.at) : 0;
    // reintenta como mucho cada 5 min y hasta MAX_RETRIES veces
    if (tries < MAX_RETRIES && Date.now() - last > 5 * 60_000) {
      await doPunch(env, cfg, day, step, "auto");
    }
  }
  // KV gratuito: 1000 escrituras/día → sólo se guarda el día si ha cambiado
  if (JSON.stringify(day) !== before || !(await env.STATE.get(`day:${day.date}`))) await saveDay(env, day);

  // Comprobación diaria (a partir de las 07:30): sesión válida y caducidad de la cookie
  if (lp.minutes >= 7 * 60 + 30 && (await env.STATE.get("dailyCheck")) !== lp.date) {
    await env.STATE.put("dailyCheck", lp.date, { expirationTtl: 60 * 60 * 48 });
    await dailyCheck(env, cfg, lp.date);
  }
}

async function dailyCheck(env, cfg, date) {
  const to = cfg.profile.email;
  if (!cfg.bizneo.cookie) {
    await notifyOnce(env, to, `nocookie:${date}`, "⚠ Bizneo: no hay sesión configurada",
      "El fichaje automático no tiene cookie de Bizneo. Pégala en Ajustes del panel.");
    return;
  }
  try {
    const r = await checkSession(clientCfg(cfg, env));
    await persistCookie(env, r);
  } catch (e) {
    await addLog(env, { type: "error", source: "check", msg: `Comprobación diaria: ${e.message}` });
    await notifyOnce(env, to, `session:${date}`,
      e.kind === "session" ? "🚨 Bizneo: la sesión ha caducado" : "⚠ Bizneo: falló la comprobación diaria",
      `${e.message}\n\nMientras no se arregle, no se fichará. Copia una cookie nueva (_hcmex_key y device_id) y pégala en Ajustes del panel.`);
    return;
  }
  const exp = (await loadConfig(env)).bizneo.cookieExpiresAt;
  if (exp) {
    const days = Math.floor((Date.parse(exp) - Date.now()) / 86400_000);
    if (days <= cfg.alerts.daysBefore) {
      await addLog(env, { type: "warn", source: "check", msg: `La cookie de Bizneo caduca en ${days} día(s)` });
      await notifyOnce(env, to, `expiry:${date}`,
        `⏳ Bizneo: la cookie caduca en ${days} día(s)`,
        `La sesión de Bizneo caduca el ${new Date(exp).toLocaleDateString("es-ES", { timeZone: tz(env) })}.\n\n` +
        "Para renovarla: entra en Bizneo, F12 → Application → Cookies → copia _hcmex_key y device_id y pégalos en Ajustes del panel.");
    }
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

function publicConfig(cfg, env) {
  const c = structuredClone(cfg);
  c.bizneo.hasCookie = Boolean(c.bizneo.cookie);
  c.bizneo.cookie = c.bizneo.cookie ? "•••• guardada (" + c.bizneo.cookie.length + " caracteres)" : "";
  c.mail = Boolean(env.RESEND_API_KEY);
  return c;
}

function dayView(day, env, cfg) {
  const actual = {};
  for (const s of STEPS) actual[s] = fmtLocal(day.actual?.[s], tz(env));
  return {
    date: day.date, mode: day.mode, override: day.override, plan: day.plan, actual,
    actualIso: day.actual, skipped: day.skipped || {}, simulated: day.simulated || {},
    status: dayStatus(day), lastError: day.lastError || null, offReason: day.offReason ? offLabel(day.offReason) : null,
    next: nextStep(day), finished: day.finished,
    workedMs: bizneoWorkedMs(day) ?? workedMs(day.actual, Date.now()),
    bizneoMin: day.bizneo?.registeredMin ?? null,
    goalMin: goalMin(dayHours(cfg.schedule, weekdayOf(day.date))),
  };
}

// Tiempo de hoy según Bizneo (registrado + lo transcurrido desde que se leyó, si está en marcha).
function bizneoWorkedMs(day) {
  const b = day.bizneo;
  if (!b || b.registeredMin == null) return null;
  const running = b.state === "running" && !day.actual?.salida && !(day.actual?.pausa && !day.actual?.retorno);
  return b.registeredMin * 60000 + (running ? Date.now() - Date.parse(b.at) : 0);
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
    week.push(d ? dayView({ skipped: {}, ...d }, env, cfg) : {
      date, mode: effectiveMode(date, calendar[date], cfg.schedule), actual: {}, skipped: {},
      plan: date > lp.date ? buildPlan(dayHours(cfg.schedule, weekdayOf(date)), 0) : {},
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
    config: publicConfig(cfg, env), log: (await kv.get(env, "log", [])).slice(0, 30),
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
    // Fichar ahora el siguiente paso (o uno concreto). Siempre comprueba antes el estado en Bizneo.
    case "/api/punch": {
      const day = await getDay(env, cfg, lp.date);
      const step = body.step || nextStep(day);
      if (!STEPS.includes(step)) return json({ error: "La jornada ya está completa" }, 400);
      const r = await doPunch(env, cfg, day, step, "manual");
      await saveDay(env, day);
      return json(r, r.ok ? 200 : 502);
    }
    // Terminar la jornada ahora (si estás en pausa, Bizneo la cierra)
    case "/api/finish": {
      const day = await getDay(env, cfg, lp.date);
      if (!day.actual.entrada) return json({ error: "Aún no se ha iniciado la jornada" }, 400);
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
      markDone(cfg, env, day, body.step, iso);
      await saveDay(env, day);
      await addLog(env, { type: "info", step: body.step, source: "manual", msg: `${LABEL[body.step]} registrado a mano: ${body.time}` });
      return json({ ok: true });
    }
    // Deshacer un fichaje registrado en el panel (no lo borra de Bizneo)
    case "/api/unmark": {
      const day = await getDay(env, cfg, lp.date);
      const i = STEPS.indexOf(body.step);
      if (i < 0) return json({ error: "Paso no válido" }, 400);
      for (const s of STEPS.slice(i)) { delete day.actual[s]; delete day.skipped[s]; }
      day.finished = false;
      day.retries = {};
      await saveDay(env, day);
      return json({ ok: true });
    }
    // Cambiar el modo de hoy o de un día futuro (oficina → casa → libre)
    case "/api/today-mode":
    case "/api/calendar": {
      const date = path === "/api/today-mode" ? lp.date : body.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return json({ error: "Fecha no válida" }, 400);
      if (date < lp.date) return json({ error: "No se pueden cambiar días pasados" }, 400);
      const calendar = await kv.get(env, "calendar", {});
      const CYCLE = ["oficina", "casa", "libre"];
      const def = effectiveMode(date, null, cfg.schedule);
      const cur = calendar[date] || def;
      let next = body.mode && MODES.includes(body.mode) ? body.mode : CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      if (next === def) next = "auto";
      if (next === "auto") delete calendar[date]; else calendar[date] = next;
      await kv.put(env, "calendar", calendar);
      if (date === lp.date) {
        const day = await getDay(env, cfg, date);
        if (day.offReason && next !== "libre" && next !== "auto") delete day.offReason; // forzar trabajo en un día que Bizneo marca libre
        day.mode = effectiveMode(date, calendar[date], cfg.schedule);
        await saveDay(env, day);
      }
      return json({ ok: true, mode: next });
    }
    // Leer el estado real del cronómetro y ajustar el panel
    case "/api/sync": {
      const day = await getDay(env, cfg, lp.date);
      let st;
      try {
        const s = new Session(clientCfg(cfg, env), env.__fetch);
        const { home: page, chrono } = await s.load();
        st = chrono;
        await persistCookie(env, { cookie: s.cookie, sessionExpires: s.sessionExpires });
        if (st.state === "unknown") {
          await kv.put(env, "debug:last", { at: new Date().toISOString(), hints: pageHints(page, s.lastStatus) }, 60 * 60 * 24 * 7);
          throw new BizneoError(`${st.reason || "No reconozco el estado del cronómetro"} (detalles guardados para revisar)`, "parse");
        }
      } catch (e) {
        await addLog(env, { type: "error", source: "sync", msg: e.message });
        return json({ ok: false, error: e.message }, 502);
      }
      const nowIso = new Date().toISOString();
      if ((st.state === "running" || st.state === "paused") && !day.actual.entrada) markDone(cfg, env, day, "entrada", st.startedAt || nowIso);
      if (st.state === "paused" && !day.actual.pausa) markDone(cfg, env, day, "pausa", nowIso);
      if (st.state === "running" && day.actual.pausa && !day.actual.retorno) markDone(cfg, env, day, "retorno", nowIso);
      if (st.state === "stopped" && day.actual.entrada && !day.actual.salida) markDone(cfg, env, day, "salida", nowIso);
      noteBizneo(cfg, env, day, st);
      await saveDay(env, day);
      const txt = { stopped: "parado", running: "en marcha", paused: "en pausa" }[st.state] +
        (st.registeredMin != null ? ` · ${Math.floor(st.registeredMin / 60)}:${String(st.registeredMin % 60).padStart(2, "0")} registradas hoy` : "");
      await addLog(env, { type: "ok", source: "sync", msg: `Cronómetro de Bizneo: ${txt}` });
      return json({ ok: true, state: st.state, msg: `Cronómetro: ${txt}` });
    }
    // Recalcular el plan de hoy (nuevo desfase)
    case "/api/replan": {
      const day = await getDay(env, cfg, lp.date);
      if (day.actual.entrada) return json({ error: "La jornada ya ha empezado" }, 400);
      day.plan = buildPlan(dayHours(cfg.schedule, lp.weekday), cfg.schedule.jitterMin);
      day.retries = {};
      day.skipped = {};
      await saveDay(env, day);
      return json({ ok: true, plan: day.plan });
    }
    case "/api/config": {
      const saved = (await kv.get(env, "config")) || {};
      const next = mergeConfig(saved);
      if (body.profile) {
        for (const k of ["name", "email"]) if (typeof body.profile[k] === "string") next.profile[k] = body.profile[k].trim().slice(0, 120);
      }
      if (body.schedule) {
        const r = sanitizeSchedule(body.schedule, next.schedule);
        if (r.error) return json({ error: r.error }, 400);
        Object.assign(next.schedule, r.out);
      }
      if (body.bizneo) {
        const b = body.bizneo;
        if (typeof b.baseUrl === "string" && b.baseUrl.trim()) {
          if (!/^https:\/\/[\w.-]+\/?$/.test(b.baseUrl.trim())) return json({ error: "La URL de Bizneo debe ser https://empresa.bizneohr.com" }, 400);
          next.bizneo.baseUrl = b.baseUrl.trim().replace(/\/+$/, "");
        }
        if (typeof b.dryRun === "boolean") next.bizneo.dryRun = b.dryRun;
        if (typeof b.pauseLabel === "string" && b.pauseLabel.trim()) next.bizneo.pauseLabel = b.pauseLabel.trim().slice(0, 40);
        if (typeof b.cookie === "string" && b.cookie.trim()) {
          const cookie = normalizeCookie(b.cookie);
          if (!/(^|;\s*)_hcmex_key=/.test(cookie)) return json({ error: "Falta la cookie _hcmex_key (formato: _hcmex_key=…; device_id=…)" }, 400);
          // Sólo se guarda si Bizneo la acepta
          try {
            const r = await checkSession({ ...next.bizneo, cookie, fetchImpl: env.__fetch });
            next.bizneo.cookie = r.cookie;
            next.bizneo.cookieSavedAt = new Date().toISOString();
            next.bizneo.cookieExpiresAt = r.sessionExpires || (b.cookieExpiresAt ? new Date(b.cookieExpiresAt).toISOString() : null);
          } catch (e) {
            return json({ error: `Bizneo no acepta esta cookie: ${e.message}` }, 400);
          }
        } else if (b.cookieExpiresAt) {
          next.bizneo.cookieExpiresAt = new Date(b.cookieExpiresAt).toISOString();
        }
        if (b.clearCookie) { next.bizneo.cookie = ""; next.bizneo.cookieExpiresAt = null; }
      }
      if (body.alerts && Number.isFinite(+body.alerts.daysBefore)) next.alerts.daysBefore = Math.max(0, Math.min(30, +body.alerts.daysBefore));
      await kv.put(env, "config", next);
      // si hoy aún no ha empezado, rehace el plan con el horario nuevo
      if (body.schedule) {
        const day = await getDay(env, next, lp.date);
        if (!day.actual.entrada) { day.plan = buildPlan(dayHours(next.schedule, lp.weekday), next.schedule.jitterMin); day.mode = effectiveMode(lp.date, day.override, next.schedule); await saveDay(env, day); }
      }
      return json({ ok: true });
    }
    // Diagnóstico sin fichar
    case "/api/test-action": {
      try {
        const d = await diagnose(clientCfg(cfg, env), lp.date);
        await persistCookie(env, d);
        if (d.hints) await kv.put(env, "debug:last", { at: new Date().toISOString(), hints: d.hints }, 60 * 60 * 24 * 7);
        delete d.cookie;
        const msg = d.ok
          ? `Diagnóstico: cronómetro ${d.stateTxt}` + (d.today ? `, hoy ${d.today.off ? offLabel(d.today.off) : "laborable"}` : ", día no encontrado en el calendario")
          : `Diagnóstico: ${d.reason}`;
        await addLog(env, { type: d.ok ? "ok" : "error", source: "check", msg });
        return json({ ...d, msg }, d.ok ? 200 : 502);
      } catch (e) {
        await addLog(env, { type: "error", source: "check", msg: `Diagnóstico: ${e.message}` });
        return json({ ok: false, error: e.message }, 502);
      }
    }
    case "/api/test-mail": {
      const r = await sendMail(env, cfg.profile.email, "✅ Prueba de avisos del fichaje Bizneo",
        "Si lees esto, los avisos por correo funcionan.");
      return json(r, r.ok ? 200 : 502);
    }
  }
  return json({ error: "No encontrado" }, 404);
}

// Acepta "Cookie: a=1; b=2", "a=1; b=2" o una línea por cookie.
function normalizeCookie(raw) {
  return raw.trim().replace(/^cookie:\s*/i, "")
    .split(/[;\n]+/).map((p) => p.trim()).filter((p) => p.includes("="))
    .join("; ");
}

function sanitizeSchedule(s, cur) {
  const out = {};
  const hhmm = /^\d{2}:\d{2}$/;
  if (Number.isFinite(+s.jitterMin) && +s.jitterMin >= 0 && +s.jitterMin <= 30) out.jitterMin = +s.jitterMin;
  if (s.days && typeof s.days === "object") {
    out.days = { ...cur.days };
    for (const [wd, h] of Object.entries(s.days)) {
      if (!(+wd >= 1 && +wd <= 7) || !h) continue;
      if (!hhmm.test(h.entrada || "") || !hhmm.test(h.salida || "")) { delete out.days[wd]; continue; }
      const d = { entrada: h.entrada, salida: h.salida, pausa: "", retorno: "" };
      if (toMin(d.salida) <= toMin(d.entrada)) return { error: `${DOW[wd - 1]}: la salida debe ser posterior a la entrada` };
      if (hhmm.test(h.pausa || "") && hhmm.test(h.retorno || "")) {
        if (!(toMin(d.entrada) < toMin(h.pausa) && toMin(h.pausa) < toMin(h.retorno) && toMin(h.retorno) < toMin(d.salida))) {
          return { error: `${DOW[wd - 1]}: la comida debe estar dentro de la jornada` };
        }
        d.pausa = h.pausa;
        d.retorno = h.retorno;
      }
      out.days[wd] = d;
    }
  }
  if (s.defaultModes && typeof s.defaultModes === "object") {
    out.defaultModes = { ...cur.defaultModes };
    out.workdays = [];
    for (const [k, v] of Object.entries(s.defaultModes)) {
      if (!["oficina", "casa", "libre"].includes(v)) continue;
      out.defaultModes[k] = v;
      if (v !== "libre") out.workdays.push(+k);
    }
    out.workdays.sort();
  }
  return { out };
}
const DOW = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export default {
  fetch: (req, env) => handle(req, env).catch((e) => json({ error: e.message }, 500)),
  scheduled: (event, env, ctx) => ctx.waitUntil(tick(env)),
};

// Para tests
export { tick, doPunch, getDay };
