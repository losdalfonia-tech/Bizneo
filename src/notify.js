// Avisos por correo con Resend (https://resend.com).
//
// Secretos/variables del Worker:
//   RESEND_API_KEY  (secreto)  clave de API de Resend
//   MAIL_FROM       (opcional) remitente; por defecto el de pruebas de Resend, que sólo
//                   puede enviar al correo con el que te diste de alta en Resend.
// El destinatario es el email del perfil (Ajustes → Perfil).

const DEFAULT_FROM = "Fichaje Bizneo <onboarding@resend.dev>";

export async function sendMail(env, to, subject, text) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "Falta el secreto RESEND_API_KEY" };
  if (!to) return { ok: false, reason: "Falta el email de avisos en Ajustes → Perfil" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM || DEFAULT_FROM, to: [to], subject, text }),
  });
  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => "");
  return { ok: false, reason: `Resend respondió ${res.status}: ${body.slice(0, 200)}` };
}

// Envía un aviso una sola vez por `key` (se recuerda en KV durante `ttl` segundos).
export async function notifyOnce(env, to, key, subject, text, ttl = 60 * 60 * 20) {
  const k = `notified:${key}`;
  if (await env.STATE.get(k)) return { ok: true, skipped: true };
  const r = await sendMail(env, to, subject, text);
  if (r.ok) await env.STATE.put(k, "1", { expirationTtl: ttl });
  return r;
}
