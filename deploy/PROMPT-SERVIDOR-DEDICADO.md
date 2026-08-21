# Prompt para llevar el calendario a un servidor dedicado propio (Docker)

Guardá este texto. Cuando quieras avanzar con esto, abrí una conversación NUEVA (en Claude, en otra IA, o pegalo directo en un foro/comunidad de home server) y pegá el prompt de abajo, completando primero el `[corchete]` con los datos reales de tu máquina.

Si la conversación que vas a usar es otra sesión de Claude Code con acceso a este mismo repositorio, decíselo — así puede leer directamente los archivos de `deploy/` y `server.js` en vez de confiar solo en el resumen de abajo. Si es una IA sin acceso al repo (o una persona), quizás te convenga adjuntar o pegar el contenido de `deploy/GUIA-SERVIDOR-PROPIO.md`, `deploy/Caddyfile` y `server.js` junto con el prompt.

---

## Prompt (completá el corchete antes de pegarlo)

```
Tengo una aplicación web ya terminada y en uso real (no es una prueba) que
hoy corre en mi PC de Windows, y quiero pasarla a un servidor dedicado
propio en casa, corriendo en un contenedor Docker. Te explico cómo
funciona, qué ya dejé preparado del lado del código para esto, y qué
tengo armado de infraestructura — quiero que me ayudes a llevarla ahí
paso a paso.

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
  archivos estáticos y una API mínima (`GET`/`POST /api/state`) para
  leer/guardar el estado.
- Persistencia: un solo archivo `data.json` — sin base de datos.
- Auth: DOS niveles, por HTTP Basic Auth, cada uno con su propia clave
  larga generada sola la primera vez que arranca el servidor:
  - Admin (`access-code.txt`): acceso total, puede ver y guardar.
  - Invitado (`guest-code.txt`): solo puede ver (`GET`) — cualquier
    intento de guardar (`POST /api/state`) le devuelve 403.
  Bloquea automáticamente una IP por 10 minutos tras 5 intentos fallidos,
  contra cualquiera de las dos claves.
- **Ya preparado específicamente para Docker**: los tres archivos de datos
  (`data.json`, `access-code.txt`, `guest-code.txt`) viven en `DATA_DIR`
  si esa variable de entorno está definida (si no, quedan junto al código,
  como antes). La carpeta se crea sola si no existe — pensado para montar
  un volumen ahí y que un despliegue de imagen nueva nunca borre los datos
  reales, aunque el código se reemplace entero.
- `data.json`, `access-code.txt` y `guest-code.txt` están en `.gitignore`
  a propósito: nunca viajan por git, para que el código (que sí actualizo
  por git) y los datos reales de la residencia nunca se mezclen.

## Cómo corre hoy

En mi PC con Windows, con dos scripts `.bat` (`Iniciar Calendario.bat` /
`Actualizar Calendario.bat`), solo dentro de mi WiFi de casa — nadie de
afuera puede entrar. server.js no tiene Dockerfile todavía; corre directo
con `node server.js`.

## Lo que ya tengo preparado de infraestructura (pensado originalmente sin Docker)

Dentro del propio repositorio, en la carpeta `deploy/`, ya armé (con
ayuda de Claude, en otra conversación) esto — probablemente sigue
sirviendo para las partes que no son la app en sí, aunque la app termine
en un contenedor:

- `GUIA-SERVIDOR-PROPIO.md`: guía paso a paso completa pensada para
  correr `server.js` directo con systemd (sin Docker) — instalar Node,
  dirección fija con DuckDNS, port forwarding, HTTPS automático con Caddy
  (Let's Encrypt), endurecimiento (firewall ufw, SSH solo con clave,
  fail2ban, actualizaciones de seguridad automáticas), y respaldos
  (carpeta cifrada con gocryptfs + copia automática a mi PC).
- `calendario.service`: unit de systemd — probablemente ya no aplica tal
  cual si la app pasa a Docker (Docker maneja su propio reinicio/arranque
  automático), pero decime si conviene igual para algo.
- `Caddyfile`: reverse proxy con HTTPS automático sobre un subdominio
  gratis de DuckDNS — esto SÍ debería seguir sirviendo igual, apuntando
  al puerto que exponga el contenedor en vez de al proceso directo.
- `backup-data.sh` / `pull-backup.bat`: respaldo diario automático +
  copia a mi PC — habría que apuntarlos a la carpeta de DATA_DIR/el
  volumen de Docker en vez de a la carpeta del proyecto.

## Mi hardware / situación real

[completar: qué máquina tenés hoy en mano — Raspberry Pi, mini PC, un NAS
(Synology, QNAP, etc.), un servidor que ya usás para otra cosa — qué
sistema operativo tiene si ya lo sabés, si ya tenés Docker instalado o
hay que instalarlo, y si ya corrés otros contenedores ahí que debería
convivir con este]

## Cómo quiero que trabajemos

1. Antes de asumir nada, preguntame lo que haga falta sobre mi hardware y
   mi red real (marca/modelo del router, si el puerto 80/443 ya está
   ocupado, qué motor de Docker tengo — Docker Engine, Docker Desktop,
   Portainer, Docker Compose de un NAS, etc.).
2. Armame un `Dockerfile` simple para esta app (imagen base de Node,
   copiar el código, `CMD node server.js` — no hay build step ni
   dependencias que instalar) y un `docker-compose.yml` (o el equivalente
   de mi plataforma) con:
   - Un volumen persistente montado y `DATA_DIR` apuntando ahí.
   - El puerto interno del contenedor (3000) sin exponer directo a
     internet — atrás de Caddy, como ya tengo pensado.
3. Ayudame a enganchar ese contenedor con lo que ya tengo de `deploy/`
   (Caddy + DuckDNS + firewall + backups), avisándome específicamente qué
   hay que adaptar de esos archivos para que apunten al contenedor en vez
   de al proceso `node` directo.
4. Guiame paso a paso, explicando cada comando en criollo — no doy por
   sabido nada de administración de Linux, servidores, ni Docker.
5. Al final quiero: HTTPS automático en mi propio subdominio, que el
   contenedor arranque solo si se corta la luz o se reinicia la máquina,
   backups automáticos de la carpeta persistente (en el servidor y una
   copia en mi PC), y que quede razonablemente protegido para estar
   expuesto a internet.
6. Contame también si conviene entregarle a alguien la clave de invitado
   (solo lectura) para que pueda ver el calendario desde su celular sin
   poder tocar nada — y si hace falta algo extra de mi lado para eso o ya
   alcanza con pasarle esa clave.
7. Si en el futuro sumo otra app al mismo servidor, avisame qué hay que
   tener en cuenta para que cada contenedor quede aislado de los demás
   (red propia, credenciales propias, subdominio propio) — no es
   necesario ahora, solo tenelo presente.
```

---

### Por qué está armado así

- Le doy **el contexto técnico completo de la app** (stack, auth de dos
  niveles, cómo persiste los datos, qué ya está pensado para Docker) para
  que la conversación nueva no tenga que adivinarlo ni pedírtelo de a
  poco.
- Aclaro que **la guía existente (`deploy/`) fue pensada sin Docker**
  (systemd directo) — así la conversación nueva sabe qué partes siguen
  sirviendo tal cual (Caddy, DuckDNS, firewall, backups) y cuáles hay que
  adaptar (el `.service`, que Docker probablemente reemplaza) en vez de
  asumir que todo aplica igual.
- Destaco que **`DATA_DIR` ya está implementado en `server.js`
  específicamente para esto** — el trabajo pendiente es de infraestructura
  (Dockerfile, compose, volumen, red), no de código.
- Sumo el **acceso de invitado** como algo a tener en cuenta al planificar
  (quién más va a mirar el calendario) aunque no cambie nada de la
  infraestructura en sí.
- Le pido que **pregunte por tu hardware/plataforma Docker real antes de
  asumir nada**, porque "Docker" cambia bastante según sea Docker Engine
  puro, Docker Desktop, o el gestor de contenedores propio de un NAS.
- Dejo la puerta abierta a **sumar más apps más adelante** sin que haga
  falta rehacer este prompt — mismo patrón que `PROMPT-APP-COMIDA.md`.
