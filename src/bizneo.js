// Cliente de Bizneo HR basado en la sesión web del usuario.
//
// Bizneo no publica un endpoint oficial de "fichar" para usuarios, así que el panel
// reproduce la misma petición que hace el navegador cuando pulsas el botón de fichar.
// Las URLs/cuerpos de cada acción se configuran desde /me/ajustes (ver README:
// "Capturar las peticiones de Bizneo").

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function absolute(base, url) {
  return new URL(url, base.replace(/\/+$/, "") + "/").toString();
}

function fill(template, vars) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

function looksLikeLogin(res, text) {
  const loc = res.headers.get("location") || "";
  return (
    res.status === 401 ||
    (res.status >= 300 && res.status < 400 && /sign_in|login|session/i.test(loc)) ||
    /name="user\[password\]"|id="new_user"/.test(text || "")
  );
}

async function getCsrf(cfg) {
  const res = await fetch(absolute(cfg.baseUrl, cfg.csrfPage || "/"), {
    headers: { cookie: cfg.cookie, "user-agent": UA, accept: "text/html" },
    redirect: "manual",
  });
  const html = await res.text();
  if (looksLikeLogin(res, html)) throw new BizneoError("La sesión de Bizneo ha caducado", "session");
  const m = html.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/i) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+name="csrf-token"/i);
  return m ? m[1] : null;
}

export class BizneoError extends Error {
  constructor(msg, kind = "error", detail = null) {
    super(msg);
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * Ejecuta una acción de fichaje (entrada | pausa | retorno | salida).
 * @returns {{status:number, body:string}}
 */
export async function punch(cfg, step, vars) {
  const action = cfg.actions?.[step];
  if (!cfg.cookie) throw new BizneoError("No hay sesión de Bizneo configurada", "config");
  if (!action?.url) throw new BizneoError(`Falta la URL de "${step}" en Ajustes`, "config");

  const csrf = await getCsrf(cfg);
  const body = fill(action.body, vars);
  const headers = {
    cookie: cfg.cookie,
    "user-agent": UA,
    accept: "application/json, text/javascript, */*; q=0.01",
    "x-requested-with": "XMLHttpRequest",
    origin: cfg.baseUrl.replace(/\/+$/, ""),
    referer: absolute(cfg.baseUrl, cfg.csrfPage || "/"),
  };
  if (csrf) headers["x-csrf-token"] = csrf;
  if (body) {
    headers["content-type"] = body.trim().startsWith("{")
      ? "application/json"
      : "application/x-www-form-urlencoded; charset=UTF-8";
  }

  const res = await fetch(absolute(cfg.baseUrl, fill(action.url, vars)), {
    method: action.method || "POST",
    headers,
    body: body && action.method !== "GET" ? body : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  if (looksLikeLogin(res, text)) throw new BizneoError("La sesión de Bizneo ha caducado", "session");
  if (res.status >= 400) {
    throw new BizneoError(`Bizneo respondió ${res.status}`, "http", text.slice(0, 500));
  }
  return { status: res.status, body: text.slice(0, 500) };
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** Comprueba la sesión y, si hay statusUrl, intenta leer si estás trabajando. */
export async function status(cfg) {
  if (!cfg.cookie) return { ok: false, reason: "Sin sesión configurada" };
  try {
    if (!cfg.statusUrl) {
      await getCsrf(cfg);
      return { ok: true, working: null };
    }
    const res = await fetch(absolute(cfg.baseUrl, cfg.statusUrl), {
      headers: { cookie: cfg.cookie, "user-agent": UA, accept: "application/json, text/html" },
      redirect: "manual",
    });
    const text = await res.text();
    if (looksLikeLogin(res, text)) return { ok: false, reason: "La sesión de Bizneo ha caducado" };
    if (res.status >= 400) return { ok: false, reason: `Bizneo respondió ${res.status}` };
    let working = null;
    if (cfg.workingJsonPath) {
      try {
        const v = getPath(JSON.parse(text), cfg.workingJsonPath);
        working = v === undefined ? null : Boolean(v) && !/^(false|0|out|stopped|off)$/i.test(String(v));
      } catch {}
    }
    return { ok: true, working, raw: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
