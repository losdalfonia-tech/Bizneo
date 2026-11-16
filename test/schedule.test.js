import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG, buildPlan, recalcSalida, dueStep, nextStep, missedBefore, workedMs, effectiveMode,
  localParts, zonedToIso, mergeConfig, goalMin, toMin,
} from "../src/schedule.js";

const S = DEFAULT_CONFIG.schedule;
const LJ = S.days[1];
const V = S.days[5];
const fixed = (...vals) => () => vals.shift();

test("plan lunes-jueves: mismo desfase en iniciar y finalizar, la comida el suyo", () => {
  const p = buildPlan(LJ, 5, fixed(3, 2));
  assert.deepEqual(p, { entrada: "09:03", salida: "18:18", pausa: "14:32", retorno: "15:32" });
});

test("plan viernes: jornada continua sin comida", () => {
  assert.deepEqual(buildPlan(V, 5, fixed(4, 1)), { entrada: "08:04", salida: "15:04" });
});

test("desfase aleatorio entre 0 y 5 min", () => {
  for (let i = 0; i < 300; i++) {
    const p = buildPlan(LJ, 5);
    const d = toMin(p.entrada) - toMin("09:00");
    assert.ok(d >= 0 && d <= 5, p.entrada);
    assert.equal(toMin(p.salida) - toMin(p.entrada), toMin("18:15") - toMin("09:00"));
    assert.equal(toMin(p.retorno) - toMin(p.pausa), 60);
  }
});

test("objetivo: 8h15 de lunes a jueves, 7h el viernes", () => {
  assert.equal(goalMin(LJ), 495);
  assert.equal(goalMin(V), 420);
});

test("salida recalculada con la entrada real y la comida real", () => {
  const a = { entrada: "2026-11-16T08:02:00Z" }; // 09:02 Madrid
  assert.equal(recalcSalida(LJ, a), "18:17");
  a.pausa = "2026-11-16T13:31:00Z";
  a.retorno = "2026-11-16T14:36:00Z"; // comida de 65 min
  assert.equal(recalcSalida(LJ, a), "18:22");
});

const lunes = () => ({ mode: "oficina", plan: { entrada: "09:03", pausa: "14:32", retorno: "15:32", salida: "18:18" }, actual: {}, skipped: {} });

test("ficha cada paso al llegar su hora", () => {
  const d = lunes();
  assert.equal(dueStep(d, toMin("09:02")), null);
  assert.equal(dueStep(d, toMin("09:03")), "entrada");
  d.actual.entrada = "x";
  assert.equal(dueStep(d, toMin("14:31")), null);
  assert.equal(dueStep(d, toMin("14:32")), "pausa");
  d.actual.pausa = "x";
  assert.equal(dueStep(d, toMin("15:32")), "retorno");
  d.actual.retorno = "x";
  assert.equal(dueStep(d, toMin("18:18")), "salida");
  d.actual.salida = "x";
  assert.equal(dueStep(d, toMin("18:30")), null);
});

test("no ficha con más de 60 min de retraso y no bloquea los pasos siguientes", () => {
  const d = lunes();
  assert.equal(dueStep(d, toMin("10:03")), null); // entrada perdida
  assert.equal(dueStep(d, toMin("14:40")), "pausa"); // pasa al último paso que toca
  assert.deepEqual(missedBefore(d, "pausa"), ["entrada"]);
});

test("pasos omitidos cuentan como tratados", () => {
  const d = lunes();
  d.skipped.entrada = "festivo";
  assert.equal(nextStep(d), "pausa");
  assert.equal(dueStep(d, toMin("09:10")), null);
});

test("día libre no ficha", () => {
  assert.equal(dueStep({ ...lunes(), mode: "libre" }, toMin("09:10")), null);
});

test("tiempo trabajado descuenta la comida", () => {
  const a = { entrada: "2026-11-16T08:00:00Z", pausa: "2026-11-16T12:00:00Z", retorno: "2026-11-16T13:00:00Z", salida: "2026-11-16T17:15:00Z" };
  assert.equal(workedMs(a, 0) / 60000, 495);
});

test("modo por defecto: lunes y martes oficina, resto casa, fin de semana libre", () => {
  assert.equal(effectiveMode("2026-11-16", undefined, S), "oficina");
  assert.equal(effectiveMode("2026-11-17", undefined, S), "oficina");
  assert.equal(effectiveMode("2026-11-18", undefined, S), "casa");
  assert.equal(effectiveMode("2026-11-20", undefined, S), "casa");
  assert.equal(effectiveMode("2026-11-21", undefined, S), "libre");
  assert.equal(effectiveMode("2026-11-16", "libre", S), "libre");
});

test("hora de Madrid", () => {
  const p = localParts(new Date("2026-11-16T08:09:00Z"));
  assert.equal(p.date, "2026-11-16");
  assert.equal(p.minutes, 9 * 60 + 9);
  assert.equal(p.weekday, 1);
  assert.equal(zonedToIso("2026-11-16 10:57:57"), "2026-11-16T09:57:57.000Z");
  assert.equal(zonedToIso("2026-07-01 09:00:00"), "2026-07-01T07:00:00.000Z"); // verano
});

test("mergeConfig ignora la configuración antigua y conserva el horario por defecto", () => {
  const c = mergeConfig({ schedule: { entrada: "08:00", objetivoMin: 400 }, bizneo: { actions: {}, cookie: "a=1" } });
  assert.equal(c.schedule.days[1].entrada, "09:00");
  assert.equal(c.bizneo.cookie, "a=1");
  assert.equal(c.bizneo.dryRun, true);
  assert.equal(c.bizneo.actions, undefined);
});
