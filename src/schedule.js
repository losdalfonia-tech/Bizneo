// Lógica de horario: zona horaria, plan del día y qué fichaje toca ahora.
// Sin dependencias de Cloudflare para poder probarla con `node --test`.

export const STEPS = ["entrada", "pausa", "retorno", "salida"];
export const MODES = ["oficina", "casa", "libre", "auto"]; // orden del ciclo en el calendario

export const DEFAULT_CONFIG = {
  profile: { name: "", email: "" },
  schedule: {
    entrada: "09:00",
    pausa: "14:30",
    retorno: "15:30",
    objetivoMin: 495, // 8h 15m de trabajo efectivo
    jitterMin: 15, // la entrada se adelanta/retrasa al azar hasta ±15 min
    comida: true, // fichar pausa y retorno
    workdays: [1, 2, 3, 4, 5], // 1 = lunes ... 7 = domingo
    // Modo por defecto de cada día laborable cuando el calendario dice "auto"
    defaultModes: { 1: "oficina", 2: "oficina", 3: "oficina", 4: "casa", 5: "casa" },
    // En modo oficina, la entrada es manual. Si a esta hora no has fichado, no se hace nada ese día.
  },
  bizneo: {
    baseUrl: "https://TUEMPRESA.bizneohr.com",
    cookie: "",
    cookieSavedAt: null,
    cookieExpiresAt: null,
    csrfPage: "/", // página de la que se extrae <meta name="csrf-token">
    statusUrl: "", // opcional: endpoint para comprobar la sesión / estado
    workingJsonPath: "", // opcional: ruta en el JSON del estado que indica si estás trabajando (p.ej. "data.clocked_in")
    actions: {
      entrada: { method: "POST", url: "", body: "" },
      pausa: { method: "POST", url: "", body: "" },
      retorno: { method: "POST", url: "", body: "" },
      salida: { method: "POST", url: "", body: "" },
    },
  },
};

export function mergeConfig(saved) {
  const c = structuredClone(DEFAULT_CONFIG);
  if (!saved) return c;
  Object.assign(c.profile, saved.profile || {});
  Object.assign(c.schedule, saved.schedule || {});
  const b = saved.bizneo || {};
  Object.assign(c.bizneo, { ...b, actions: c.bizneo.actions });
  for (const s of STEPS) Object.assign(c.bizneo.actions[s], (b.actions || {})[s] || {});
  return c;
}

// ---------- tiempo ----------

export function localParts(date, tz = "Europe/Madrid") {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hh: +p.hour, mm: +p.minute, ss: +p.second,
    minutes: +p.hour * 60 + +p.minute,
    weekday: wd,
  };
}

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (min) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
export const fmtLocal = (iso, tz) => {
  if (!iso) return null;
  const p = localParts(new Date(iso), tz);
  return fromMin(p.minutes);
};

export function weekdayOf(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

// Modo efectivo de un día: lo que diga el calendario o, si es "auto", el de por defecto.
export function effectiveMode(dateStr, overrideMode, schedule) {
  const wd = weekdayOf(dateStr);
  if (overrideMode && overrideMode !== "auto") return overrideMode;
  if (!schedule.workdays.includes(wd)) return "libre";
  return schedule.defaultModes[wd] || "casa";
}

// ---------- plan ----------

export function randomInt(min, max) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return min + (a[0] % (max - min + 1));
}

// Plan de un día. Si ya hay entrada real, el resto se recalcula a partir de ella.
export function buildPlan(schedule, entradaRealMin = null, jitter = null) {
  const j = jitter ?? randomInt(-schedule.jitterMin, schedule.jitterMin);
  const entrada = entradaRealMin ?? toMin(schedule.entrada) + j;
  const comidaMin = schedule.comida ? toMin(schedule.retorno) - toMin(schedule.pausa) : 0;
  // pequeña variación (0–4 min) para que pausa/retorno no sean siempre exactos
  const pausa = toMin(schedule.pausa) + (jitter === null ? randomInt(0, 4) : 0);
  const retorno = pausa + comidaMin;
  const salida = entrada + schedule.objetivoMin + comidaMin;
  const plan = { entrada: fromMin(entrada), salida: fromMin(salida) };
  if (schedule.comida) Object.assign(plan, { pausa: fromMin(pausa), retorno: fromMin(retorno) });
  return plan;
}

// Siguiente paso pendiente según lo ya fichado.
export function nextStep(day, schedule) {
  const done = day.actual || {};
  const order = schedule.comida ? STEPS : ["entrada", "salida"];
  return order.find((s) => !done[s]) || null;
}

// Decide si en este minuto toca fichar algo. Devuelve el paso o null.
export function dueStep(day, schedule, nowMin) {
  if (day.mode === "libre" || day.finished) return null;
  const step = nextStep(day, schedule);
  if (!step) return null;
  if (step === "entrada" && day.mode === "oficina") return null; // entrada manual
  const at = day.plan?.[step];
  if (!at) return null;
  // margen: si han pasado más de 3 h del plan, no fichamos a destiempo (p.ej. worker caído)
  if (nowMin >= toMin(at) && nowMin - toMin(at) < 180) return step;
  return null;
}

// Minutos trabajados a partir de los fichajes reales.
export function workedMs(actual, nowMs) {
  if (!actual?.entrada) return 0;
  const t = (k) => (actual[k] ? Date.parse(actual[k]) : null);
  const end = t("salida") ?? nowMs;
  let ms = end - t("entrada");
  if (t("pausa")) ms -= (t("retorno") ?? Math.min(nowMs, end)) - t("pausa");
  return Math.max(0, ms);
}

export function dayStatus(day) {
  const a = day.actual || {};
  if (day.mode === "libre") return "libre";
  if (a.salida || day.finished) return "terminada";
  if (a.pausa && !a.retorno) return "pausa";
  if (a.entrada) return "en curso";
  return "pendiente";
}
