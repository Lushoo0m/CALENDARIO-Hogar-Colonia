# Guía: pasar el calendario a un servidor propio, con acceso desde cualquier lado

Esta guía es para cuando ya tengas la máquina física (Raspberry Pi o mini PC) en tus manos. Antes de eso no hay nada para hacer acá — segui usando `Iniciar Calendario.bat` en tu PC como hasta ahora.

El resultado final: el calendario va a andar en `https://tu-subdominio.duckdns.org`, accesible desde el celular con datos móviles, desde el trabajo, desde donde sea — sin que tu PC ni nada en tu casa (aparte del servidor nuevo) tenga que estar prendido a propósito para eso.

## Qué máquina comprar

- **Raspberry Pi 5 (4GB)** con case, fuente y una tarjeta microSD (o mejor, un SSD chiquito por USB) — es la opción más simple, más documentada en internet, y de sobra para esta app y alguna otra chica en el futuro. Rondando 100-130 USD el kit completo.
- **Mini PC con procesador Intel N100** — un poco más caro (120-180 USD), pero con más memoria/almacenamiento de entrada, y al ser una compu "normal" (no ARM como la Raspberry) a veces es más fácil de aggiornar con software nuevo más adelante. Buena opción si pensás correr varias apps a la vez (como la idea de venta de comida que mencionaste).

Cualquiera de las dos sirve. Los pasos de abajo son iguales para ambas (asumen Linux — Raspberry Pi OS o Ubuntu Server, ambos gratis).

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
