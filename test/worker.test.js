import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { tick } from "../src/index.js";
import { fakeBizneo, memoryKV } from "./helpers.js";

// Simula un día entero llamando al cron cada minuto (horas en UTC; Madrid = UTC+1 en noviembre).
async function runDay(dateUtc, fake, { from = "07:00", to = "18:00", config = {} } = {}) {
  const STATE = memoryKV();
  let puts = 0;
  const put = STATE.put.bind(STATE);
  STATE.put = (k, v) => { puts++; return put(k, v); };
  await put("config", JSON.stringify({
    profile: { email: "" },
    bizneo: { baseUrl: "https://empresa.bizneohr.com", cookie: "_hcmex_key=SFMy; device_id=dev", dryRun: false },
    ...config,
  }));
  const env = { STATE, __fetch: fake.fetch, TZ: "Europe/Madrid" };
  const start = Date.parse(`${dateUtc}T${from}:00Z`);
  const end = Date.parse(`${dateUtc}T${to}:00Z`);
  mock.timers.enable({ apis: ["Date"], now: start });
  try {
    for (let t = start; t <= end; t += 60_000) {
      mock.timers.setTime(t);
      await tick(env);
    }
  } finally {
    mock.timers.reset();
  }
  const date = new Date(start + 3600_000).toISOString().slice(0, 10);
  return { day: JSON.parse(STATE.m.get(`day:${date}`)), log: JSON.parse(STATE.m.get("log") || "[]"), puts };
}

test("lunes completo: Iniciar, Pausar, Reanudar y Finalizar una sola vez cada uno", async () => {
  const f = fakeBizneo();
  const { day, puts } = await runDay("2026-11-16", f);
  const w = f.writes();
  assert.deepEqual(w.map((c) => c.method + " " + c.path + (c.body.get("pause") ? " pause" : "")),
    ["POST /chrono", "PUT /chrono/1000 pause", "PUT /chrono/1000", "PUT /chrono/1000"]);
  assert.equal(w[0].body.get("kind"), "working_time"); // lunes = oficina
  assert.equal(f.state, "stopped");
  assert.ok(day.finished);
  assert.deepEqual(Object.keys(day.actual), ["entrada", "pausa", "retorno", "salida"]);
  assert.ok(puts < 40, `demasiadas escrituras en KV: ${puts}`);
  // salida = entrada real + 9h15 (misma duración de jornada)
  const min = (iso) => Math.round(Date.parse(iso) / 60000);
  assert.equal(min(day.actual.salida) - min(day.actual.entrada), 9 * 60 + 15);
});

test("miércoles: Iniciar en teletrabajo", async () => {
  const cal = '<a href="/x?absence[requested_days]=2026-11-18" class="day">18</a>';
  const f = fakeBizneo({ cal });
  await runDay("2026-11-18", f, { to: "08:30" });
  assert.equal(f.writes()[0].body.get("kind"), "telework");
});

test("festivo en Bizneo (2 de noviembre): no se envía nada en todo el día", async () => {
  const f = fakeBizneo();
  const { day } = await runDay("2026-11-02", f);
  assert.equal(f.writes().length, 0);
  assert.equal(day.mode, "libre");
  assert.equal(day.offReason, "holiday");
});

test("si ya iniciaste a mano, no se vuelve a iniciar", async () => {
  const f = fakeBizneo({ state: "running" });
  const { day } = await runDay("2026-11-16", f, { to: "08:30" });
  assert.equal(f.writes().length, 0);
  assert.ok(day.actual.entrada);
});

test("si Bizneo falla, reintenta como mucho 6 veces y deja de intentarlo", async () => {
  const f = fakeBizneo({ ignoreWrites: true });
  const { day } = await runDay("2026-11-16", f, { to: "09:30" });
  assert.equal(f.writes().length, 6);
  assert.match(day.skipped.entrada, /6 intentos/);
});

test("modo prueba: un día entero sin escribir nada en Bizneo", async () => {
  const f = fakeBizneo();
  const { day, log } = await runDay("2026-11-16", f, { config: { bizneo: { baseUrl: "https://empresa.bizneohr.com", cookie: "_hcmex_key=SFMy", dryRun: true } } });
  assert.equal(f.writes().length, 0);
  assert.ok(day.simulated.entrada);
  assert.ok(log.some((l) => /habría enviado POST \/chrono/.test(l.msg)));
});

test("lunes completo con el cronómetro diferido (como el Bizneo real)", async () => {
  const f = fakeBizneo({ lazy: true });
  const { day } = await runDay("2026-11-16", f);
  assert.equal(f.writes().length, 4);
  assert.ok(day.finished);
});
