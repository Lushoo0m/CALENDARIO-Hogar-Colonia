# Guía: pasar el calendario a un servidor propio, con acceso desde cualquier lado

Esta guía es para cuando ya tengas la máquina física (Raspberry Pi o mini PC) en tus manos. Antes de eso no hay nada para hacer acá — segui usando `Iniciar Calendario.bat` en tu PC como hasta ahora.

El resultado final: el calendario va a andar en `https://tu-subdominio.duckdns.org`, accesible desde el celular con datos móviles, desde el trabajo, desde donde sea — sin que tu PC ni nada en tu casa (aparte del servidor nuevo) tenga que estar prendido a propósito para eso.

## Qué máquina comprar

- **Raspberry Pi 5 (4GB)** con case, fuente y una tarjeta microSD (o mejor, un SSD chiquito por USB) — es la opción más simple, más documentada en internet, y de sobra para esta app y alguna otra chica en el futuro. Rondando 100-130 USD el kit completo.
- **Mini PC con procesador Intel N100** — un poco más caro (120-180 USD), pero con más memoria/almacenamiento de entrada, y al ser una compu "normal" (no ARM como la Raspberry) a veces es más fácil de aggiornar con software nuevo más adelante. Buena opción si pensás correr varias apps a la vez (como la idea de venta de comida que mencionaste).

Cualquiera de las dos sirve. Los pasos de abajo son iguales para ambas (asumen Linux — Raspberry Pi OS o Ubuntu Server, ambos gratis).

## Cuánto vas a gastar, en criollo

Para tener el calendario (y otras apps privadas, de uso solo tuyo/familiar) andando en tu propio dominio, con el mínimo gasto posible:

| Concepto | Costo | ¿Hace falta? |
|---|---|---|
| La máquina (Raspberry Pi o mini PC) | 100-180 USD, **una sola vez** | Sí |
| Sistema operativo (Raspberry Pi OS / Ubuntu Server) | Gratis | Sí |
| Node.js, Caddy, systemd, firewall, fail2ban | Gratis (software libre) | Sí |
| Dirección en internet — subdominio de DuckDNS (ej. `hogarcolonia.duckdns.org`) | **Gratis, para siempre** | Sí |
| Certificado HTTPS (Let's Encrypt, vía Caddy) | **Gratis, se renueva solo** | Sí |
| Electricidad de tener la máquina prendida 24/7 | Unos pocos dólares/pesos por mes (una Raspberry Pi consume como una lamparita chica) | Ya la pagás igual, no es un gasto nuevo importante |
| Tu internet de casa | Ya lo pagás | No es un gasto nuevo |

**En criollo: pagás la máquina una sola vez, y de ahí en adelante el costo mensual real es prácticamente cero** (unos centavos de luz). No hace falta comprar ningún dominio (`.com`, `.com.ar`, etc.) — el subdominio gratis de DuckDNS cumple exactamente la misma función. Si en algún momento preferís un dominio "lindo" propio (ej. `hogarcolonia.com` en vez de `hogarcolonia.duckdns.org`), eso sí tiene costo (10-15 USD/año), pero es 100% opcional — la app funciona igual de bien sin eso.

## 1. Preparar la máquina nueva

1. Instalá el sistema operativo (Raspberry Pi OS Lite para la Pi, o Ubuntu Server para un mini PC — el instalador de cada fabricante te guía).
2. Conectate a la máquina por SSH desde tu PC (o directo con teclado/monitor si preferís). Si es la primera vez que usás SSH, cualquier guía de "cómo conectarme por SSH a mi Raspberry Pi" te sirve — es un paso estándar, no específico de esta app.
3. Actualizá el sistema:
   ```
   sudo apt update && sudo apt upgrade -y
   ```
4. Instalá Node.js (versión 20 o superior):
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   node -v
   ```
   El último comando te tiene que mostrar algo como `v20.x.x`.

## 2. Copiar la app a la máquina nueva

La forma más simple: descargá el zip de la app (el mismo que ya tenés en tu PC) y copialo a la máquina nueva. Si tenés `scp` disponible en tu PC (Windows con OpenSSH ya lo trae, o Mac/Linux), desde una consola en la carpeta del calendario:

```
scp -r . TU_USUARIO@IP_DE_LA_MAQUINA_NUEVA:/home/TU_USUARIO/calendario-hogar-colonia
```

Si eso te resulta complicado, también podés simplemente copiar los archivos a un pendrive y pasarlos así, o subir el zip a la máquina nueva por cualquier medio que te resulte cómodo (Google Drive, WeTransfer, etc.) y descomprimirlo ahí con `unzip`.

**No copies `data.json` de tu PC actual** — vamos a traer los datos con el botón de exportar/importar (más prolijo y menos margen de error):

1. En tu PC, abrí el calendario como siempre → pestaña **Estudiantes** → **"Exportar copia completa"**. Se descarga un archivo `.json`.
2. Pasá ese archivo a la máquina nueva (por los mismos medios de arriba).
3. Más adelante en esta guía, cuando el servidor nuevo ya esté andando, abrilo, andá a Estudiantes → **"Importar copia"** → elegí ese archivo → confirmá. Ahí sí queda todo tu historial real en el servidor nuevo.

## 3. Que el calendario arranque solo (systemd)

1. Copiá `deploy/calendario.service` (viene en la carpeta de la app) a `/etc/systemd/system/calendario.service`:
   ```
   sudo cp deploy/calendario.service /etc/systemd/system/calendario.service
   ```
2. Editalo y reemplazá `TU_USUARIO` (aparece dos veces) por tu usuario real de Linux, por ejemplo `pi`:
   ```
   sudo nano /etc/systemd/system/calendario.service
   ```
   (`Ctrl+O` para guardar, `Ctrl+X` para salir de `nano`.)
3. Activalo:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable calendario
   sudo systemctl start calendario
   sudo systemctl status calendario
   ```
   Ahí tendrías que ver "active (running)" en verde. Este servicio va a arrancar solo cada vez que la máquina se prenda, y se reinicia solo si se cuelga.
4. Probá que ande localmente:
   ```
   curl -u hogar:$(cat access-code.txt) http://localhost:3000/ -o /dev/null -w "%{http_code}\n"
   ```
   Tendría que darte `200`.

## 4. Dirección fija en internet (DuckDNS)

Tu internet de casa cambia de dirección IP de tanto en tanto, así que necesitás un nombre fijo que apunte siempre a la IP actual.

1. Entrá a [duckdns.org](https://www.duckdns.org) y creá una cuenta gratis (podés entrar con Google).
2. Elegí un subdominio, por ejemplo `hogarcolonia` → te va a quedar `hogarcolonia.duckdns.org`.
3. Anotá el **token** que te muestra la página (una clave larga).
4. En la máquina nueva, creá un script que le avise a DuckDNS tu IP actual cada 5 minutos:
   ```
   mkdir -p ~/duckdns
   cat > ~/duckdns/duck.sh <<'EOF'
   echo url="https://www.duckdns.org/update?domains=TU_SUBDOMINIO&token=TU_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
   EOF
   chmod +x ~/duckdns/duck.sh
   ```
   Reemplazá `TU_SUBDOMINIO` y `TU_TOKEN` por los tuyos reales.
5. Que se ejecute solo cada 5 minutos:
   ```
   crontab -e
   ```
   Y agregá esta línea al final:
   ```
   */5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
   ```

## 5. Abrir el router hacia esa máquina (port forwarding)

Esto varía según la marca de tu router, pero el concepto es siempre el mismo:

1. Anotá la IP local de la máquina nueva dentro de tu red (con `hostname -I` en la propia máquina, o mirando la lista de dispositivos conectados en tu router).
2. Entrá a la configuración de tu router (normalmente `192.168.0.1` o `192.168.1.1` en el navegador) con el usuario/clave del router (viene en una etiqueta atrás, o se lo pedís a quien lo instaló).
3. Buscá la sección "Port Forwarding" / "Reenvío de puertos" / "Virtual Server" (el nombre exacto cambia según el router).
4. Agregá dos reglas, ambas apuntando a la IP local de la máquina nueva:
   - Puerto externo **80** → puerto interno **80**
   - Puerto externo **443** → puerto interno **443**
5. Es recomendable, si tu router lo permite, asignarle una **IP fija** (reserva DHCP) a la máquina nueva, para que el reenvío de puertos no se rompa el día que le cambie la IP local.

Si no encontrás la opción en tu router, buscá en internet "port forwarding" + la marca y modelo exacto de tu router — hay guías específicas para casi todos.

## 6. HTTPS automático (Caddy)

1. Instalá Caddy:
   ```
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install -y caddy
   ```
2. Copiá `deploy/Caddyfile` (viene en la carpeta de la app) a `/etc/caddy/Caddyfile`, reemplazando `tu-subdominio.duckdns.org` por el subdominio real que elegiste en el paso 4:
   ```
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo nano /etc/caddy/Caddyfile
   ```
3. Reiniciá Caddy:
   ```
   sudo systemctl restart caddy
   sudo systemctl status caddy
   ```
   Caddy va a pedir el certificado HTTPS solo (Let's Encrypt) la primera vez que alguien entre — no hace falta hacer nada más.

## 7. Probar todo

Con el celular **desconectado del WiFi de casa** (usando datos móviles, para probar que de verdad funciona desde afuera), entrá a:

```
https://tu-subdominio.duckdns.org
```

Te va a pedir usuario/clave — usá el contenido de `access-code.txt` de la máquina nueva. Si entra y ves el calendario, ya está: anda desde cualquier lado.

Por último, importá tu copia de seguridad (la que exportaste en el paso 2) desde la pestaña Estudiantes, para tener ahí todo tu historial real.

## Para actualizar la app más adelante

Cuando te mande una nueva versión (nuevos archivos), en la máquina nueva:

1. Copiá los archivos nuevos a la carpeta de la app (igual que en el paso 2, pero sin tocar `data.json`).
2. Reiniciá el servicio:
   ```
   sudo systemctl restart calendario
   ```

No hace falta tocar nada de Caddy ni DuckDNS para eso — solo el servicio del calendario.

## Notas de seguridad

- Guardá la clave larga de `access-code.txt` en un lugar seguro (no la mandes por WhatsApp a la vista de cualquiera) — es lo único que separa tu calendario del resto de internet.
- El servidor ya bloquea automáticamente una dirección durante 10 minutos después de 5 intentos de clave fallidos seguidos, para dificultar que alguien la adivine.
- Hacé una "Exportar copia completa" cada tanto (desde Estudiantes) y guardala aparte, como respaldo — por más que la máquina esté siempre prendida, un respaldo aparte nunca está de más.

## 8. Endurecer el servidor (para que no puedan "entrar y borrar todo")

Esto es importante hacerlo una sola vez, apenas la máquina esté expuesta a internet — es la diferencia real entre "cualquiera puede intentar entrar" y "prácticamente nadie puede". La clave larga del calendario protege LA APP, pero el sistema operativo de la máquina es una puerta aparte (por SSH) que también hay que cerrar bien.

### Firewall (solo dejar pasar lo necesario)

```
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Con esto, cualquier otro puerto queda cerrado a internet de entrada — solo SSH (para vos) y 80/443 (para Caddy).

### SSH: entrar con clave, no con contraseña

Esto es lo más importante de todo: una contraseña de SSH se puede intentar adivinar a fuerza bruta; una clave (par de archivos, uno público y uno privado) prácticamente no.

1. Desde tu PC (no desde el servidor), generá un par de claves si todavía no tenés uno:
   ```
   ssh-keygen -t ed25519
   ```
   (Enter para todo, dejar sin frase también está bien si tu PC ya está protegida con su propia clave de usuario.)
2. Copiá tu clave pública al servidor:
   ```
   ssh-copy-id TU_USUARIO@IP_DE_LA_MAQUINA
   ```
3. Probá que podés entrar SIN que te pida contraseña:
   ```
   ssh TU_USUARIO@IP_DE_LA_MAQUINA
   ```
4. Recién cuando eso funcione, deshabilitá el login por contraseña en el servidor:
   ```
   sudo nano /etc/ssh/sshd_config
   ```
   Buscá (o agregá) estas líneas y dejalas así:
   ```
   PasswordAuthentication no
   PermitRootLogin no
   ```
   Guardá y reiniciá SSH:
   ```
   sudo systemctl restart ssh
   ```

Desde acá en adelante, sin la clave privada de tu PC, nadie puede entrar por SSH — ni con la contraseña correcta.

### fail2ban (bloquear IPs que insisten)

```
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

Con la configuración por defecto ya bloquea automáticamente, por un rato, cualquier dirección que falle el login de SSH varias veces seguidas — el mismo concepto que ya tiene el propio calendario para su clave de acceso, pero aplicado a la puerta de entrada del sistema operativo.

### Actualizaciones de seguridad automáticas

```
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Elegí "Yes" cuando pregunte — así el sistema se aplica solo los parches de seguridad, sin que tengas que acordarte de hacerlo a mano.

### Respaldo local automático (aparte del "Exportar copia" manual)

1. Dejá el script `deploy/backup-data.sh` (ya viene en la carpeta de la app) ejecutable:
   ```
   chmod +x deploy/backup-data.sh
   ```
2. Que corra solo, todos los días a las 3 AM:
   ```
   crontab -e
   ```
   Y agregá:
   ```
   0 3 * * * /home/TU_USUARIO/calendario-hogar-colonia/deploy/backup-data.sh
   ```

Guarda los últimos 30 días en `backups/data-AAAA-MM-DD_HHMM.json` (y una copia `latest.json` con nombre fijo), sin depender de que te acuerdes de exportar a mano. Los pasos que siguen abajo llevan esto un paso más allá: guardar los respaldos cifrados en el propio servidor, Y ADEMÁS que una copia llegue sola a tu PC.

## 9. Respaldos: carpeta cifrada en el servidor + copia automática en tu PC

Pediste específicamente que el respaldo diario quede guardado en dos lugares: en un compartimiento cifrado del propio servidor, y en tu PC. Van los dos.

### 9a. Carpeta cifrada en el servidor (gocryptfs)

Una aclaración honesta antes de armar esto, para que sepas exactamente qué te protege y qué no: esta carpeta cifrada protege tus respaldos si alguien **se roba la máquina físicamente** y le saca el disco/tarjeta para leerlo en otra computadora — sin la clave, esos archivos son ilegibles. NO protege contra alguien que ya está **adentro** del servidor corriendo (por ejemplo si lograran esquivar todo lo de la sección 8) — mientras el servidor está prendido y funcionando normal, la carpeta está montada y visible como cualquier otra, porque el propio proceso de respaldo automático necesita poder escribir ahí sin que nadie tenga que tipear una clave a las 3 de la mañana. Es una capa extra contra el robo físico, no un reemplazo de la sección 8 (que es la que te protege de intrusos remotos).

1. Instalá gocryptfs:
   ```
   sudo apt install -y gocryptfs
   ```
2. Creá la carpeta cifrada y el punto de montaje:
   ```
   mkdir -p ~/respaldos-cifrados-raw ~/respaldos-cifrados
   gocryptfs -init ~/respaldos-cifrados-raw
   ```
   Te va a pedir que elijas una contraseña — **anotala en un lugar seguro aparte** (si la perdés, no hay forma de recuperar lo que haya adentro).
3. Guardá esa contraseña en un archivo con permisos bien restrictivos, para que el respaldo automático de las 3 AM pueda montarla sola sin que nadie esté presente:
   ```
   echo "TU_CONTRASEÑA_ELEGIDA" > ~/.respaldos-clave
   chmod 600 ~/.respaldos-clave
   ```
4. Montala (a mano, para probar):
   ```
   gocryptfs -passfile ~/.respaldos-clave ~/respaldos-cifrados-raw ~/respaldos-cifrados
   ```
   Si andá bien, no te va a pedir nada más y `~/respaldos-cifrados` va a quedar disponible como una carpeta común.
5. Que se monte sola al prender la máquina — creá `/etc/systemd/system/respaldos-montaje.service`:
   ```
   sudo nano /etc/systemd/system/respaldos-montaje.service
   ```
   Con este contenido (reemplazando `TU_USUARIO`):
   ```ini
   [Unit]
   Description=Montar carpeta cifrada de respaldos
   After=local-fs.target

   [Service]
   Type=forking
   User=TU_USUARIO
   ExecStart=/usr/bin/gocryptfs -passfile /home/TU_USUARIO/.respaldos-clave /home/TU_USUARIO/respaldos-cifrados-raw /home/TU_USUARIO/respaldos-cifrados
   ExecStop=/bin/fusermount -u /home/TU_USUARIO/respaldos-cifrados
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   ```
   Activalo:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now respaldos-montaje
   ```
6. Actualizá la línea de cron del paso anterior para que los respaldos vayan directo ahí adentro:
   ```
   crontab -e
   ```
   Reemplazá la línea de `backup-data.sh` por:
   ```
   0 3 * * * BACKUP_DIR=/home/TU_USUARIO/respaldos-cifrados /home/TU_USUARIO/calendario-hogar-colonia/deploy/backup-data.sh
   ```

### 9b. Copia automática en tu PC

Como tu PC no está siempre prendida, "todos los días a una hora fija" no es realista — en cambio, la idea es que se baje sola cada vez que prendés la PC y te logueás.

1. En tu PC, si todavía no tenés una clave SSH armada para entrar al servidor, seguí el paso "SSH: entrar con clave" de la sección 8 primero (`pull-backup.bat` la necesita para no pedirte contraseña cada vez).
2. Abrí `deploy/pull-backup.bat` (viene en la carpeta de la app) con el Bloc de notas y completá las 3 líneas de arriba con tus datos reales: tu usuario del servidor, la dirección (podés usar directamente `tu-subdominio.duckdns.org`), y la ruta de la app en el servidor.
3. Probalo con doble clic — te tendría que crear una carpeta `Respaldos-Calendario-HogarColonia` en tu usuario de Windows, con el archivo adentro.
4. Para que se ejecute solo: abrí el **Programador de tareas** de Windows (buscalo en el menú Inicio) → **Crear tarea básica** → nombre "Respaldo Calendario" → **Desencadenador: Al iniciar sesión** (no "Diariamente", porque si la PC está apagada a esa hora se lo pierde) → **Acción: Iniciar un programa** → elegí el archivo `pull-backup.bat`.

Con esto, cada vez que prendés tu PC y entrás a tu usuario de Windows, se baja sola la última copia de los datos — sin que tengas que acordarte de nada.

## Sobre el repositorio de GitHub

Todo lo de arriba protege la máquina; el código en sí vive en GitHub, que es otra puerta aparte:

- Activá verificación en dos pasos (2FA) en tu cuenta de GitHub — es la protección más importante contra que alguien entre a tu cuenta y borre o modifique el repositorio.
- Mantené el repositorio privado.
- Nunca compartas ni subas al repositorio ninguna clave (la de acceso del calendario, tokens, etc.) — quedan en archivos que ya están afuera del control de versiones (`data.json`, `access-code.txt`).
- Aunque alguien lograra borrar código del repositorio, git guarda el historial — casi siempre se puede recuperar. Lo que NO se recupera solo es `data.json` (nunca vive en GitHub) — por eso importan los respaldos de arriba.

## Sumar más apps al mismo servidor (calendario + hogar/finanzas + comida)

Vas a poder tener varias apps corriendo en la misma máquina física, cada una con su propia dirección (subdominio) y, si querés, "instalables" en el celular como accesos directos. Para que un problema en una app no afecte a las demás, la clave es **aislar cada proyecto**, no "cifrarlo" — el cifrado protege que alguien LEA tus datos si roba el disco físico, pero no evita que un programa con una falla borre sus propios archivos. Lo que realmente te protege de que un problema en una app se contagie a las otras es que cada una:

1. **Corra como su propio usuario de Linux**, sin permisos sobre las carpetas de las demás apps (ej. usuario `calendario`, usuario `finanzas`, usuario `comida`, cada uno dueño solo de su propia carpeta).
2. **Tenga su propio servicio de systemd** (una copia de `calendario.service` por app, con su propio usuario y carpeta).
3. **Tenga su propio subdominio** en el Caddyfile, cada uno apuntando a un puerto distinto:
   ```
   calendario.tudominio.duckdns.org {
       reverse_proxy localhost:3000
   }
   finanzas.tudominio.duckdns.org {
       reverse_proxy localhost:3001
   }
   comida.tudominio.duckdns.org {
       reverse_proxy localhost:3002
   }
   ```
4. **Tenga su propia clave de acceso**, sin reutilizar la de otra app.

Para la app de comida en particular (la única que va a manejar pedidos/pagos de gente de afuera de tu casa, así que la más expuesta), conviene ir un paso más allá y correrla en su propio **contenedor Docker** — un "sobrecito" aislado que ni siquiera comparte el sistema de archivos con las demás apps, aunque estén en la misma máquina. No hace falta migrar el calendario a Docker (ya funciona bien como está); pero para la app de comida, cuando la armes, es el estándar recomendado. Más abajo tenés un prompt para arrancar ese proyecto ya con esto en mente.

Si además querés protegerte contra el robo físico de la máquina (que alguien se la lleve y le saque el disco), ahí sí entra el cifrado de disco completo (LUKS) — es una capa extra, independiente de todo lo anterior, y opcional.
