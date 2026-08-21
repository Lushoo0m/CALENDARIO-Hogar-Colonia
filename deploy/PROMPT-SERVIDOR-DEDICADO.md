# Prompt para llevar el calendario a un servidor dedicado propio

Guardá este texto. Cuando quieras avanzar con esto, abrí una conversación NUEVA (en Claude, en otra IA, o pegalo directo en un foro/comunidad de home server) y pegá el prompt de abajo, completando primero el `[corchete]` con los datos reales de tu máquina.

Si la conversación que vas a usar es otra sesión de Claude Code con acceso a este mismo repositorio, decíselo — así puede leer directamente los archivos de `deploy/` en vez de confiar solo en el resumen de abajo. Si es una IA sin acceso al repo (o una persona), quizás te convenga adjuntar o pegar el contenido de `deploy/GUIA-SERVIDOR-PROPIO.md`, `deploy/Caddyfile` y `deploy/calendario.service` junto con el prompt.

---

## Prompt (completá el corchete antes de pegarlo)

```
Tengo una aplicación web ya terminada y en uso real (no es una prueba) que
hoy corre en mi PC de Windows, y quiero pasarla a un servidor dedicado
propio en casa. Te explico cómo funciona y qué tengo preparado, y quiero
que me ayudes a llevarla ahí paso a paso.

## Qué es la app

"Calendario de Limpieza — Hogar Colonia": una agenda semanal de tareas de
limpieza para una residencia estudiantil (20 becados, 7 áreas: cocina,
cocina 2, comedor, sala de estudios, baño de estudios, lavadero,
escaleras). Un algoritmo reparte automáticamente quién limpia qué cada
semana, quien administra la revisa y aprueba, y queda guardado todo el
historial mes a mes.

## Stack técnico (sin frameworks, sin build step)

- Frontend: HTML/CSS/JS vanilla puro, sin React ni npm ni bundler. Un
  `index.html`, `core.js` (toda la lógica del algoritmo, sin DOM), `ui.js`
  (todo el renderizado y los eventos) y `styles.css`. Es una PWA
  instalable en el celular (`manifest.json` + `sw.js`).
- Backend: `server.js`, Node.js puro con el módulo `http` nativo — CERO
  dependencias de npm, no hay `node_modules` ni `package.json`. Sirve los
  archivos estáticos y una API mínima para leer/guardar el estado.
- Persistencia: un solo archivo `data.json` en la raíz del proyecto — sin
  base de datos.
- Auth: clave de acceso compartida (HTTP Basic Auth), generada sola la
  primera vez que arranca el servidor y guardada en `access-code.txt`.
  Bloquea automáticamente una IP por 10 minutos tras 5 intentos fallidos.
- `data.json` y `access-code.txt` están en `.gitignore` a propósito: nunca
  viajan por git, para que el código (que sí actualizo por git) y los
  datos reales de la residencia nunca se mezclen ni se pisen entre sí.

## Cómo corre hoy

En mi PC con Windows, con dos scripts `.bat`:
- `Iniciar Calendario.bat`: hace un respaldo local de toda la carpeta y
  arranca `node server.js` (puerto 3000).
- `Actualizar Calendario.bat`: respaldo, `git pull` de la rama del
  proyecto, y reinicia.

Hoy solo anda dentro de mi WiFi de casa (por IP local) — nadie de afuera
puede entrar.

## Lo que ya tengo preparado, pero nunca puse en práctica en hardware real

Dentro del propio repositorio, en la carpeta `deploy/`, ya armé (con
ayuda de Claude, en otra conversación) todo lo necesario para esto:

- `GUIA-SERVIDOR-PROPIO.md`: guía paso a paso completa — instalar Node,
  copiar la app, arranque automático con systemd, dirección fija con
  DuckDNS, port forwarding, HTTPS automático con Caddy (Let's Encrypt),
  endurecimiento (firewall ufw, SSH solo con clave, fail2ban,
  actualizaciones de seguridad automáticas), y respaldos (carpeta cifrada
  en el servidor con gocryptfs + copia automática a mi PC).
- `calendario.service`: unit de systemd para que arranque solo y se
  reinicie si se cuelga.
- `Caddyfile`: reverse proxy con HTTPS automático sobre un subdominio
  gratis de DuckDNS.
- `backup-data.sh` / `pull-backup.bat`: respaldo diario automático en el
  servidor + copia automática a mi PC.

## Mi hardware / situación real

[completar: qué máquina tenés hoy en mano — Raspberry Pi, mini PC, un NAS
(Synology, QNAP, etc.), un servidor que ya usás para otra cosa — qué
sistema operativo tiene si ya lo sabés, y si ya tenés algo corriendo ahí
(ej. Docker/Portainer) que debería convivir con esto]

## Cómo quiero que trabajemos

1. Antes de asumir nada, preguntame lo que haga falta sobre mi hardware y
   mi red real (marca/modelo del router, si el puerto 80/443 ya está
   ocupado por otra cosa, si prefiero Docker en vez de systemd "pelado",
   etc.) — la guía que ya tengo asume una Raspberry Pi o mini PC con
   Linux recién instalado, y mi caso puede ser distinto.
2. Revisá si lo que ya tengo preparado (arriba) sirve tal cual para mi
   máquina real, o hay que adaptarlo — no reinventes de cero si no hace
   falta, ya está pensado y probado en el papel.
3. Guiame paso a paso, explicando cada comando en criollo — no doy por
   sabido nada de administración de Linux ni de servidores.
4. Al final quiero: HTTPS automático en mi propio subdominio, que
   arranque solo si se corta la luz o se reinicia la máquina, backups
   automáticos (en el servidor y una copia en mi PC), y que quede
   razonablemente protegido para estar expuesto a internet.
5. Si en el futuro sumo otra app al mismo servidor, avisame qué hay que
   tener en cuenta para que cada una quede aislada de las demás (usuario
   de Linux propio, subdominio propio, sin compartir credenciales) —
   pero eso no es necesario ahora, solo tenelo presente.
```

---

### Por qué está armado así

- Le doy **el contexto técnico completo de la app** (stack, dónde vive
  cada cosa, cómo persiste los datos) para que la conversación nueva no
  tenga que adivinarlo ni pedírtelo de a poco.
- Aclaro explícitamente que **ya existe una guía preparada** (`deploy/`)
  para que no proponga una infraestructura distinta de cero — la idea es
  ejecutar/adaptar lo que ya está pensado, no rehacerlo.
- Le pido que **pregunte por tu hardware real antes de asumir nada**,
  porque la guía fue escrita pensando en una Raspberry Pi o mini PC
  "limpios" — si termina siendo un NAS u otra cosa, varios pasos cambian
  (por ejemplo, un NAS Synology usa Docker/Container Manager en vez de
  systemd directo).
- Dejo la puerta abierta a **sumar más apps más adelante** sin que haga
  falta rehacer este prompt — mismo patrón que `PROMPT-APP-COMIDA.md`.
