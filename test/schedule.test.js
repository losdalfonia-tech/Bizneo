import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, buildPlan, dueStep, workedMs, effectiveMode, localParts, mergeConfig } from "../src/schedule.js";

const S = DEFAULT_CONFIG.schedule;

test("plan: salida = entrada + objetivo + comida (como en la captura)", () => {
  const p = buildPlan(S, 8 * 60 + 44);
  assert.equal(p.entrada, "08:44");
  assert.equal(p.salida, "17:59");
});

test("plan con azar respeta el margen", () => {
  for (let i = 0; i < 200; i++) {
    const p = buildPlan(S);
    const [h, m] = p.entrada.split(":").map(Number);
    const d = h * 60 + m - 540;
    assert.ok(d >= -15 && d <= 15, p.entrada);
  }
});

test("oficina: no ficha la entrada sola, pero sí la comida", () => {
  const day = { mode: "oficina", plan: { entrada: "09:00", pausa: "14:30", retorno: "15:30", salida: "18:15" }, actual: {} };
  assert.equal(dueStep(day, S, 600), null);
  day.actual.entrada = "x";
  assert.equal(dueStep(day, S, 14 * 60 + 29), null);
  assert.equal(dueStep(day, S, 14 * 60 + 30), "pausa");
});

test("casa: ficha la entrada al llegar la hora, no 3h tarde", () => {
  const day = { mode: "casa", plan: { entrada: "09:00", pausa: "14:30", retorno: "15:30", salida: "18:15" }, actual: {} };
  assert.equal(dueStep(day, S, 539), null);
  assert.equal(dueStep(day, S, 540), "entrada");
  assert.equal(dueStep(day, S, 540 + 181), null);
});

test("libre no ficha", () => {
  assert.equal(dueStep({ mode: "libre", plan: { entrada: "09:00" }, actual: {} }, S, 600), null);
});

test("tiempo trabajado descuenta la comida", () => {
  const a = { entrada: "2026-11-16T08:00:00Z", pausa: "2026-11-16T12:00:00Z", retorno: "2026-11-16T13:00:00Z", salida: "2026-11-16T17:15:00Z" };
  assert.equal(workedMs(a, 0) / 60000, 495);
  const enPausa = { entrada: a.entrada, pausa: a.pausa };
  assert.equal(workedMs(enPausa, Date.parse("2026-11-16T12:30:00Z")) / 60000, 240);
});

test("modo efectivo usa por defecto según día", () => {
  assert.equal(effectiveMode("2026-11-16", undefined, S), "oficina"); // lunes
  assert.equal(effectiveMode("2026-11-19", undefined, S), "casa"); // jueves
  assert.equal(effectiveMode("2026-11-21", undefined, S), "libre"); // sábado
  assert.equal(effectiveMode("2026-11-16", "casa", S), "casa");
});

test("hora local de Madrid (CET)", () => {
  const p = localParts(new Date("2026-11-16T08:09:00Z"));
  assert.equal(p.date, "2026-11-16");
  assert.equal(p.minutes, 9 * 60 + 9);
  assert.equal(p.weekday, 1);
});

test("mergeConfig conserva acciones por defecto", () => {
  const c = mergeConfig({ bizneo: { baseUrl: "x", actions: { entrada: { url: "/a" } } } });
  assert.equal(c.bizneo.actions.entrada.url, "/a");
  assert.equal(c.bizneo.actions.salida.method, "POST");
});
