# Bizneo · Fichaje automático

Panel personal (Cloudflare Worker) que ficha solo en **tu cuenta de Bizneo HR** usando el **Cronómetro** de la portada: Iniciar, Pausar (comida), Reanudar y Finalizar.

- **Cron cada minuto**: cuando llega la hora de un paso, lo ejecuta en Bizneo. Si falla, reintenta cada 5 min (máx. 6 veces).
- **Nunca repite un paso**: antes de pulsar cualquier botón lee el estado real del cronómetro. Si ya está iniciado, no lo vuelve a iniciar; si ya está en pausa, no vuelve a pausar; si ya está parado, no finaliza. Después de cada acción vuelve a cargar la página para **verificar** que el estado ha cambiado.
- **Festivos y vacaciones automáticos**: antes de iniciar mira el mini-calendario de Bizneo. Si hoy tiene cualquier marca distinta de laborable (festivo, fin de semana, ausencia…), no se ficha.
- **Avisos por correo** (Resend): fallo de un fichaje, paso no realizado, sesión caducada y cookie a punto de caducar.
- **Modo prueba** (activado por defecto): hace todas las comprobaciones pero no envía nada a Bizneo; el registro muestra lo que habría enviado.

## Horario por defecto

| Día | Modo | Iniciar | Pausar | Reanudar | Finalizar | Objetivo |
|---|---|---|---|---|---|---|
| Lunes y martes | 🏢 oficina | 09:00 | 14:30 | 15:30 | 18:15 | 8h 15m |
| Miércoles y jueves | 🏠 casa | 09:00 | 14:30 | 15:30 | 18:15 | 8h 15m |
| Viernes | 🏠 casa | 08:00 | — | — | 15:00 | 7h |

- Cada día se elige un **desfase aleatorio de 0 a 5 min**, el mismo para iniciar y finalizar (la jornada dura lo mismo). La comida tiene su propio desfase y siempre dura 1 h.
- La hora de finalizar se recalcula con la **hora real de inicio** que muestra Bizneo (y con la duración real de la comida).
- Si un paso se queda sin hacer más de 60 min (p. ej. Cloudflare caído), no se ficha con retraso: se pasa al siguiente y se avisa.
- 🏢/🏠 es la opción del cronómetro de Bizneo (`kind = working_time | telework`). Se cambia por día desde el calendario del panel; 🌴 libre = no fichar ese día.

Todo se edita en **Ajustes**.

## Cómo ficha (para mantenimiento)

| Estado del cronómetro | Petición | Botón |
|---|---|---|
| parado | `POST /chrono` (`_csrf_token`, `location_id`, `user_id`, `shift_id`, `kind`) | Iniciar |
| en marcha | `PUT /chrono/<user_id>` (`_method=put`, `_csrf_token`, `shift_id`, `kind=rest`, `comment`) | Finalizar |
| en marcha | lo mismo + `pause=<id>` (opción «Comida») | Pausar |
| en pausa | el botón «Reanudar» del mismo formulario | Reanudar |

Los campos, la ruta y el token CSRF se leen del HTML en cada fichaje, así que si Bizneo cambia el `shift_id` o la ruta, sigue funcionando. El estado «en pausa» todavía no se ha visto con HTML real: el primer día, revisa el registro tras la pausa.

## Puesta en marcha

```bash
npm install
npx wrangler login
npx wrangler kv namespace create STATE     # pega el id en wrangler.toml
npx wrangler secret put APP_PASSWORD       # contraseña del panel
npx wrangler secret put SESSION_SECRET     # cadena aleatoria larga
npx wrangler secret put RESEND_API_KEY     # clave de https://resend.com (avisos)
npm run deploy
```

1. Entra en `https://bizneo-fichaje.<tu-subdominio>.workers.dev` → **Ajustes**.
2. **Perfil**: pon el email de avisos y pulsa *Enviar correo de prueba*. Sin dominio propio, Resend sólo envía al correo con el que te diste de alta en Resend.
3. **Sesión de Bizneo**: pega `_hcmex_key=…; device_id=…` (F12 → Application → Cookies) y pulsa *Guardar y diagnosticar*. Debe mostrar el estado del cronómetro, el token CSRF y «hoy laborable».
4. Deja el **modo prueba** uno o dos días y revisa en *Actividad* los «habría enviado…».
5. Cuando cuadre, cambia el modo a **Real**.

## Desarrollo local

```bash
cp .dev.vars.example .dev.vars
npm run dev        # http://localhost:8787 ; cron manual: curl "localhost:8787/__scheduled"
npm test
```

Los tests usan HTML real del cronómetro (con identificadores inventados) en `test/fixtures/` y simulan un día entero minuto a minuto.
