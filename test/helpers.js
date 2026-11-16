import { readFileSync } from "node:fs";
import { localParts } from "../src/schedule.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}.html`, import.meta.url), "utf8");
const CAL = fx("calendar");

export function page(state, { reg = "0:00", cal = CAL } = {}) {
  return fx(state).replace("__CAL__", cal).replace("__REG__", reg);
}

// Bizneo falso: mantiene el estado del cronómetro y registra las peticiones.
// lazy: como el Bizneo real, la portada trae el cronómetro vacío y lo carga desde /chrono/1000/hub_chrono
export function fakeBizneo({ state = "stopped", reg = "0:00", cal, setCookie, ignoreWrites = false, lazy = false } = {}) {
  const calls = [];
  let started = null; // "YYYY-MM-DD HH:MM:SS" en Madrid, cuando se inicia de verdad
  const self = {
    calls,
    get state() { return state; },
    writes: () => calls.filter((c) => c.method !== "GET"),
    fetch: async (url, init = {}) => {
      const u = new URL(url);
      const method = init.method || "GET";
      calls.push({ method, path: u.pathname, body: init.body ? new URLSearchParams(init.body) : null, headers: init.headers || {} });
      const headers = new Headers();
      if (setCookie) headers.append("set-cookie", setCookie);
      const render = () => {
        // tras finalizar, Bizneo muestra lo registrado en el día
        let html = page(state, { reg: state !== "stopped" ? "2:11" : started ? "8:15" : reg, cal });
        if (started) html = html.replace("2026-11-16 10:57:57", started);
        return html;
      };
      if (method === "GET" && u.pathname === "/") {
        let html = render();
        if (lazy) {
          html = html.replace(/<div id="chronometer-wrapper">[\s\S]*?<\/form><\/div>/,
            '<div id="chronometer-wrapper" hx-get="/chrono/1000/hub_chrono" hx-trigger="revealed" hx-select="#chronometer-wrapper"></div>');
        }
        return new Response(html, { status: 200, headers });
      }
      if (method === "GET" && u.pathname === "/chrono/1000/hub_chrono") {
        if (!lazy) return new Response("not found", { status: 404, headers });
        return new Response(render().match(/<div id="chronometer-wrapper">[\s\S]*?<\/form><\/div>/)[0], { status: 200, headers });
      }
      if (!ignoreWrites) {
        if (method === "POST" && u.pathname === "/chrono") {
          state = "running";
          const p = localParts(new Date());
          started = `${p.date} ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}:${String(p.ss).padStart(2, "0")}`;
        }
        if (method === "PUT" && u.pathname === "/chrono/1000") {
          const p = new URLSearchParams(init.body);
          if (state === "paused") state = "running";
          else if (p.get("pause")) state = "paused";
          else state = "stopped";
        }
      }
      return new Response("<div id=chronometer-wrapper></div>", { status: 200, headers });
    },
  };
  return self;
}

// KV en memoria compatible con env.STATE
export function memoryKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
