// Lógica de horario: zona horaria, plan del día y qué fichaje toca ahora.
// Sin dependencias de Cloudflare para poder probarla con `node --test`.

export const STEPS = ["entrada", "pausa", "retorno", "salida"];
export const MODES = ["oficina", "casa", "libre", "auto"]; // orden del ciclo en el calendario

// Valor del selector 🏢/🏠 del cronómetro de Bizneo según el modo del día.
export const KIND = { oficina: "working_time", casa: "telework" };

// Minutos de margen: pasado este tiempo desde la hora prevista, no se ficha a destiempo.
export const WINDOW_MIN = 60;

const LJ = { entrada: "09:00", salida: "18:15", pausa: "14:30", retorno: "15:30" };

export const DEFAULT_CONFIG = {
  profile: { name: "", email: "" }, // email = a dónde se envían los avisos
  schedule: {
    jitterMin: 5, // desfase aleatorio de 0 a N min (mismo en entrada y salida)
    // Horario por día de la semana (1 = lunes ... 7 = domingo). Sin pausa/retorno = jornada continua.
    days: {
      1: { ...LJ }, 2: { ...LJ }, 3: { ...LJ }, 4: { ...LJ },
      5: { entrada: "08:00", salida: "15:00", pausa: "", retorno: "" },
    },
    workdays: [1, 2, 3, 4, 5],
    // 🏢 oficina = presencial (working_time) · 🏠 casa = teletrabajo (telework)
    defaultModes: { 1: "oficina", 2: "oficina", 3: "casa", 4: "casa", 5: "casa" },
  },
  bizneo: {
    baseUrl: "https://fractalia.bizneohr.com",
    cookie: "",
    cookieSavedAt: null,
    cookieExpiresAt: null,
    dryRun: true, // modo prueba: comprueba todo pero no envía nada a Bizneo
    pauseLabel: "Comida", // opción del desplegable "Pausar"
  },
  alerts: { daysBefore: 5 }, // aviso por correo cuando queden N días para que caduque la cookie
};

const HHMM = /^\d{2}:\d{2}$/;

export function mergeConfig(saved) {
  const c = structuredClone(DEFAULT_CONFIG);
  if (!saved) return c;
  Object.assign(c.profile, saved.profile || {});
  const s = saved.schedule || {};
  if (Number.isFinite(s.jitterMin)) c.schedule.jitterMin = s.jitterMin;
  if (Array.isArray(s.workdays)) c.schedule.workdays = s.workdays;
  if (s.defaultModes) Object.assign(c.schedule.defaultModes, s.defaultModes);
  if (s.days) {
    for (const [wd, h] of Object.entries(s.days)) {
      if (h && HHMM.test(h.entrada || "") && HHMM.test(h.salida || "")) c.schedule.days[wd] = { pausa: "", retorno: "", ...h };
    }
  }
  const b = saved.bizneo || {};
  for (const k of Object.keys(c.bizneo)) if (b[k] !== undefined) c.bizneo[k] = b[k];
  Object.assign(c.alerts, saved.alerts || {});
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

// "2026-11-16 10:57:57" en hora de Madrid → ISO UTC
export function zonedToIso(local, tz = "Europe/Madrid") {
  const m = String(local || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const p = localParts(new Date(asUtc), tz);
  const [y, mo, d] = p.date.split("-").map(Number);
  const offset = Date.UTC(y, mo - 1, d, p.hh, p.mm, p.ss) - asUtc;
  return new Date(asUtc - offset).toISOString();
}

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (min) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
export const fmtLocal = (iso, tz = "Europe/Madrid") => {
  if (!iso) return null;
  const p = localParts(new Date(iso), tz);
  return fromMin(p.minutes);
};

export function weekdayOf(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

export const dayHours = (schedule, wd) => schedule.days?.[wd] || schedule.days?.[String(wd)] || null;
export const hasLunch = (h) => Boolean(h && HHMM.test(h.pausa || "") && HHMM.test(h.retorno || ""));

// Minutos de trabajo efectivo de un horario (sin la comida).
export function goalMin(h) {
  if (!h) return 0;
  const lunch = hasLunch(h) ? toMin(h.retorno) - toMin(h.pausa) : 0;
  return toMin(h.salida) - toMin(h.entrada) - lunch;
}

// Modo efectivo de un día: lo que diga el calendario o, si es "auto", el de por defecto.
export function effectiveMode(dateStr, overrideMode, schedule) {
  const wd = weekdayOf(dateStr);
  if (overrideMode && overrideMode !== "auto") return overrideMode;
  if (!schedule.workdays.includes(wd) || !dayHours(schedule, wd)) return "libre";
  return schedule.defaultModes[wd] || "casa";
}

// ---------- plan ----------

export function randomInt(min, max) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return min + (a[0] % (max - min + 1));
}

// Plan de un día: entrada y salida con el mismo desfase (la jornada dura lo mismo);
// la comida tiene su propio desfase, igual en la salida y en la vuelta (siempre dura lo mismo).
export function buildPlan(hours, jitterMin = 5, rnd = randomInt) {
  if (!hours) return {};
  const j = rnd(0, jitterMin);
  const jl = rnd(0, jitterMin);
  const plan = { entrada: fromMin(toMin(hours.entrada) + j), salida: fromMin(toMin(hours.salida) + j) };
  if (hasLunch(hours)) {
    plan.pausa = fromMin(toMin(hours.pausa) + jl);
    plan.retorno = fromMin(toMin(hours.retorno) + jl);
  }
  return plan;
}

// Salida a partir de lo fichado de verdad: entrada real + duración de la jornada,
// corrigiendo si la comida real fue más larga o más corta de lo previsto.
export function recalcSalida(hours, actual, tz = "Europe/Madrid") {
  if (!hours || !actual?.entrada) return null;
  let dur = toMin(hours.salida) - toMin(hours.entrada);
  if (hasLunch(hours) && actual.pausa && actual.retorno) {
    const real = Math.round((Date.parse(actual.retorno) - Date.parse(actual.pausa)) / 60000);
    dur += real - (toMin(hours.retorno) - toMin(hours.pausa));
  }
  return fromMin(toMin(fmtLocal(actual.entrada, tz)) + dur);
}

export const stepsOf = (plan) => STEPS.filter((s) => plan?.[s]);
const handled = (day, s) => Boolean(day.actual?.[s] || day.skipped?.[s]);

// Siguiente paso pendiente según lo ya fichado u omitido.
export function nextStep(day) {
  return stepsOf(day.plan).find((s) => !handled(day, s)) || null;
}

// Decide si en este minuto toca fichar algo. Devuelve el último paso cuya hora ya ha
// llegado y que no se ha hecho, siempre que no hayan pasado más de WINDOW_MIN minutos.
// (Si un paso anterior se quedó sin hacer, no se ficha con retraso: se pasa al siguiente.)
export function dueStep(day, nowMin, windowMin = WINDOW_MIN) {
  if (day.mode === "libre" || day.finished) return null;
  let due = null;
  for (const s of stepsOf(day.plan)) {
    if (!handled(day, s) && nowMin >= toMin(day.plan[s])) due = s;
  }
  if (!due || nowMin - toMin(day.plan[due]) >= windowMin) return null;
  return due;
}

// Pasos anteriores a `step` que se quedaron sin hacer.
export function missedBefore(day, step) {
  const order = stepsOf(day.plan);
  return order.slice(0, order.indexOf(step)).filter((s) => !handled(day, s));
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
