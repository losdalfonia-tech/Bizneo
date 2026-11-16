# Bizneo · Fichaje automático

Panel personal (Cloudflare Worker) que ficha solo en **tu cuenta de Bizneo HR**: entrada, pausa de comida, retorno y salida.

- **Panel** (`/me/dashboard`): cronómetro de la jornada, entrada/pausa/retorno/salida (real o prevista ≈), sincronizar con Bizneo, "terminar la jornada ahora", semana, calendario y registro de actividad.
- **Ajustes** (`/me/ajustes`): perfil, horario, modo por defecto de cada día, cookie de sesión de Bizneo y las peticiones de fichaje.
- **Cron** cada minuto: si toca un fichaje lo envía a Bizneo. Reintenta cada 5 min (máx. 6 veces) si falla.

## Modos de día
| Modo | Qué hace |
|---|---|
| 🏢 oficina ("Modo manual") | La entrada la fichas tú (botón del panel o en Bizneo + "Registrar"). Comida y salida automáticas. |
| 🏠 casa ("Modo automático") | Todo automático. La entrada se elige al azar dentro de ±`jitter` min. |
| 🌴 libre | No se ficha nada (vacaciones, festivos). |

Salida = entrada real + objetivo (8h 15m por defecto) + duración real de la comida.
En el calendario, toca un día futuro para cambiar su modo; el botón del modo de la tarjeta oscura cambia el de hoy.

## Puesta en marcha
```bash
npm install
npx wrangler login
npx wrangler kv namespace create STATE     # pega el id en wrangler.toml
npx wrangler secret put APP_PASSWORD       # contraseña del panel
npx wrangler secret put SESSION_SECRET     # cadena aleatoria larga
npm run deploy
```
Entra en `https://bizneo-fichaje.<tu-subdominio>.workers.dev`, ve a **Ajustes** y completa la sesión de Bizneo.

## Capturar las peticiones de Bizneo
Bizneo no tiene un endpoint público de "fichar" para usuarios, así que el Worker reproduce las peticiones que hace tu navegador:

1. Abre Bizneo en Chrome, **F12 → Network**, marca *Preserve log*.
2. Pulsa fichar en Bizneo. Copia **Request URL**, método y **Payload** de la nueva petición POST en "Entrada".
3. De esa misma petición copia el valor de la cabecera **cookie** en "Cookie de sesión" y pon la fecha de caducidad.
4. Repite para pausa, retorno y salida.

En URL y cuerpo puedes usar `{{iso}}`, `{{timestamp}}`, `{{date}}`, `{{time}}` y `{{mode}}` (`office`/`remote`).
El token CSRF (`<meta name="csrf-token">`) se obtiene solo antes de cada fichaje.
Cuando la cookie caduque verás "Sesión Bizneo caducada" en rojo y un error en Actividad: pega una nueva.

## Desarrollo local
```bash
cp .dev.vars.example .dev.vars
npm run dev        # http://localhost:8787 ; cron manual: curl "localhost:8787/__scheduled"
npm test
```
