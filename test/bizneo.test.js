import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseChrono, parseCalendar, dayOffReason, buildBody, mergeSetCookies, chronoAction, diagnose,
} from "../src/bizneo.js";
import { page, fakeBizneo } from "./helpers.js";

const cfg = (fake, extra = {}) => ({
  baseUrl: "https://empresa.bizneohr.com", cookie: "_hcmex_key=SFMy; device_id=dev", dryRun: false,
  pauseLabel: "Comida", fetchImpl: fake.fetch, ...extra,
});
const MON = { kind: "working_time", date: "2026-11-16" };

// ---------- lectura del HTML ----------

test("cronómetro parado: POST /chrono con sus campos", () => {
  const c = parseChrono(page("stopped"));
  assert.equal(c.state, "stopped");
  assert.equal(c.verb, "POST");
  assert.equal(c.path, "/chrono");
  assert.deepEqual(c.kinds, ["working_time", "telework"]);
  assert.equal(c.buttons.start.text, "Iniciar");
  assert.equal(c.registeredMin, 0);
  assert.equal(c.startedAt, null);
  assert.deepEqual(Object.fromEntries(c.fields), {
    _csrf_token: "CSRF-ABC", location_id: "", user_id: "1000", shift_id: "2000", kind: "working_time",
  });
});

test("cronómetro en marcha: PUT /chrono/<id>, hora de inicio y opción de pausa", () => {
  const c = parseChrono(page("running"));
  assert.equal(c.state, "running");
  assert.equal(c.verb, "PUT");
  assert.equal(c.path, "/chrono/1000");
  assert.equal(c.startedAt, "2026-11-16T09:57:57.000Z"); // 10:57:57 en Madrid (CET)
  assert.equal(c.registeredMin, 131);
  assert.equal(c.buttons.stop.text, "Finalizar");
  assert.equal(c.buttons.pauses.length, 1);
  assert.equal(c.buttons.pauses[0].value, "3000");
  assert.match(c.buttons.pauses[0].text, /^Comida/);
});

test("cronómetro en pausa (hipotético): botón Reanudar", () => {
  assert.equal(parseChrono(page("paused")).state, "paused");
});

test("página sin cronómetro → estado desconocido", () => {
  assert.equal(parseChrono("<html>hola</html>").state, "unknown");
});

test("cuerpo de Iniciar en teletrabajo", () => {
  const c = parseChrono(page("stopped"));
  const b = buildBody(c, c.buttons.start, { kind: "telework" });
  assert.equal(b.toString(), "_csrf_token=CSRF-ABC&location_id=&user_id=1000&shift_id=2000&kind=telework");
});

test("cuerpo de Finalizar y de Pausar", () => {
  const c = parseChrono(page("running"));
  assert.equal(buildBody(c, c.buttons.stop).toString(), "_method=put&_csrf_token=CSRF-DEF&location_id=&shift_id=2000&kind=rest&comment=");
  assert.equal(buildBody(c, c.buttons.pauses[0]).toString(), "_method=put&_csrf_token=CSRF-DEF&location_id=&shift_id=2000&kind=rest&comment=&pause=3000");
});

test("calendario: festivos, fines de semana y ausencias", () => {
  const cal = parseCalendar(page("stopped"));
  assert.equal(dayOffReason(cal["2026-11-16"]), null); // hoy, laborable
  assert.equal(dayOffReason(cal["2026-11-17"]), null);
  assert.equal(dayOffReason(cal["2026-12-01"]), null); // de otro mes
  assert.equal(dayOffReason(cal["2026-11-02"]), "holiday");
  assert.equal(dayOffReason(cal["2026-11-14"]), "no-working-day");
  assert.equal(dayOffReason(cal["2026-11-18"]), "tipo vacation");
  assert.equal(Object.keys(cal).length, 8); // no confunde el "day" de los eventos
});

test("cookies renovadas por Bizneo", () => {
  const r = mergeSetCookies("_hcmex_key=OLD; device_id=dev",
    ["_hcmex_key=NEW; path=/; expires=Wed, 16 Dec 2026 10:00:00 GMT; secure; HttpOnly; SameSite=Lax"]);
  assert.equal(r.cookie, "_hcmex_key=NEW; device_id=dev");
  assert.equal(r.sessionExpires, "2026-12-16T10:00:00.000Z");
  // una cookie ya caducada (borrado) no sustituye a la buena
  assert.equal(mergeSetCookies("_hcmex_key=OK", ["_hcmex_key=; max-age=0"]).cookie, "_hcmex_key=OK");
});

// ---------- acciones: nunca repetir lo que ya está hecho ----------

test("Iniciar: envía POST y verifica que queda en marcha", async () => {
  const f = fakeBizneo();
  const r = await chronoAction(cfg(f), "entrada", MON);
  assert.equal(r.outcome, "done");
  assert.equal(f.state, "running");
  const [w] = f.writes();
  assert.equal(w.method, "POST");
  assert.equal(w.path, "/chrono");
  assert.equal(w.body.get("kind"), "working_time");
  assert.equal(w.headers["hx-request"], "true");
  assert.equal(w.headers["x-csrf-token"], "CSRF-ABC");
  assert.ok(Math.abs(Date.parse(r.startedAt) - Date.now()) < 5000); // hora de inicio que muestra Bizneo
});

test("Iniciar con el cronómetro ya en marcha o en pausa: no envía nada", async () => {
  for (const state of ["running", "paused"]) {
    const f = fakeBizneo({ state });
    const r = await chronoAction(cfg(f), "entrada", MON);
    assert.equal(r.outcome, "already");
    assert.equal(f.writes().length, 0);
  }
});

test("Iniciar con el cronómetro parado pero tiempo ya registrado hoy: no reinicia", async () => {
  const f = fakeBizneo({ reg: "2:11" });
  const r = await chronoAction(cfg(f), "entrada", MON);
  assert.equal(r.outcome, "skipped");
  assert.equal(f.writes().length, 0);
});

test("Iniciar en festivo, fin de semana o vacaciones de Bizneo: no ficha", async () => {
  for (const date of ["2026-11-02", "2026-11-14", "2026-11-18"]) {
    const f = fakeBizneo();
    const r = await chronoAction(cfg(f), "entrada", { ...MON, date });
    assert.equal(r.outcome, "off", date);
    assert.equal(f.writes().length, 0);
  }
});

test("Iniciar si el día no aparece en el calendario: error, no ficha", async () => {
  const f = fakeBizneo({ cal: "" });
  await assert.rejects(chronoAction(cfg(f), "entrada", MON), /calendario/);
  assert.equal(f.writes().length, 0);
});

test("Pausar: envía la opción Comida; si ya está en pausa o parado, no", async () => {
  let f = fakeBizneo({ state: "running" });
  assert.equal((await chronoAction(cfg(f), "pausa", MON)).outcome, "done");
  assert.equal(f.writes()[0].body.get("pause"), "3000");
  assert.equal(f.state, "paused");

  f = fakeBizneo({ state: "paused" });
  assert.equal((await chronoAction(cfg(f), "pausa", MON)).outcome, "already");
  f = fakeBizneo({ state: "stopped" });
  assert.equal((await chronoAction(cfg(f), "pausa", MON)).outcome, "skipped");
  assert.equal(f.writes().length, 0);
});

test("Reanudar: sólo desde pausa", async () => {
  let f = fakeBizneo({ state: "paused" });
  assert.equal((await chronoAction(cfg(f), "retorno", MON)).outcome, "done");
  assert.equal(f.state, "running");
  f = fakeBizneo({ state: "running" });
  assert.equal((await chronoAction(cfg(f), "retorno", MON)).outcome, "already");
  assert.equal(f.writes().length, 0);
});

test("Finalizar: desde marcha; ya parado no envía nada", async () => {
  let f = fakeBizneo({ state: "running" });
  assert.equal((await chronoAction(cfg(f), "salida", MON)).outcome, "done");
  assert.equal(f.writes()[0].method, "PUT");
  assert.equal(f.writes()[0].body.get("pause"), null);
  assert.equal(f.state, "stopped");

  f = fakeBizneo({ state: "stopped", reg: "8:15" });
  assert.equal((await chronoAction(cfg(f), "salida", MON)).outcome, "already");
  f = fakeBizneo({ state: "stopped", reg: "0:00" });
  assert.equal((await chronoAction(cfg(f), "salida", MON)).outcome, "skipped");
  assert.equal(f.writes().length, 0);
});

test("Finalizar estando en pausa sin botón Finalizar: reanuda y finaliza", async () => {
  const f = fakeBizneo({ state: "paused" });
  assert.equal((await chronoAction(cfg(f), "salida", MON)).outcome, "done");
  assert.equal(f.writes().length, 2);
  assert.equal(f.state, "stopped");
});

test("si Bizneo no cambia el estado, es un error", async () => {
  const f = fakeBizneo({ ignoreWrites: true });
  await assert.rejects(chronoAction(cfg(f), "entrada", MON), /no ha cambiado/);
});

test("modo prueba: comprueba todo pero no envía nada", async () => {
  const f = fakeBizneo();
  const r = await chronoAction(cfg(f, { dryRun: true }), "entrada", { ...MON, kind: "telework" });
  assert.equal(r.outcome, "simulated");
  assert.match(r.msg, /POST \/chrono/);
  assert.match(r.msg, /kind=telework/);
  assert.doesNotMatch(r.msg, /CSRF-ABC/);
  assert.equal(f.writes().length, 0);
});

test("sesión caducada: redirección a login", async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: "/users/sign_in" } });
  await assert.rejects(chronoAction(cfg({ fetch: fetchImpl }), "entrada", MON), (e) => e.kind === "session");
});

test("diagnóstico y renovación de cookie", async () => {
  const f = fakeBizneo({ setCookie: "_hcmex_key=NEW; path=/; max-age=2592000" });
  const d = await diagnose(cfg(f), "2026-11-16");
  assert.equal(d.state, "stopped");
  assert.equal(d.csrf, true);
  assert.deepEqual(d.today, { classes: ["day", "today"], off: null });
  assert.equal(d.cookie, "_hcmex_key=NEW; device_id=dev");
  assert.ok(d.sessionExpires);
});

// ---------- Bizneo real: el cronómetro se carga aparte ----------

test("portada con cronómetro diferido: lo pide a /chrono/<id>/hub_chrono", async () => {
  const f = fakeBizneo({ lazy: true });
  const home = await (await f.fetch("https://empresa.bizneohr.com/")).text();
  assert.equal(parseChrono(home).state, "unknown");
  f.calls.length = 0;
  const d = await diagnose(cfg(f), "2026-11-16");
  assert.equal(d.state, "stopped");
  assert.equal(d.lazyUrl, "/chrono/1000/hub_chrono");
  const frag = f.calls.find((c) => c.path === "/chrono/1000/hub_chrono");
  assert.equal(frag.headers["hx-request"], "true");
  assert.deepEqual(d.today, { classes: ["day", "today"], off: null });
});

test("día completo de acciones con cronómetro diferido", async () => {
  const f = fakeBizneo({ lazy: true });
  for (const [step, outcome] of [["entrada", "done"], ["entrada", "already"], ["pausa", "done"], ["retorno", "done"], ["salida", "done"], ["salida", "already"]]) {
    assert.equal((await chronoAction(cfg(f), step, MON)).outcome, outcome, step);
  }
  assert.equal(f.writes().length, 4);
  assert.equal(f.state, "stopped");
});
