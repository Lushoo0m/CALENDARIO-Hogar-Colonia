# Actualizar el calendario automáticamente (sin copiar archivos a mano)

Esto reemplaza el "descargo el zip y reemplazo los archivos" por un doble click.
Hay una configuración inicial (una sola vez) y después queda para siempre.

## Paso 1 — Instalar Git (una sola vez)

Si nunca instalaste Git en esta PC:

1. Descargalo de <https://git-scm.com/download/win>
2. Instalalo dejando todas las opciones por defecto (solo ir haciendo "Siguiente").

## Paso 2 — Crear la carpeta conectada a las actualizaciones (una sola vez)

Esta carpeta va a **reemplazar** a la que usás ahora (la del zip). A partir de acá
vas a trabajar siempre desde esta carpeta nueva.

1. Elegí dónde la querés (por ejemplo el Escritorio) y abrí una terminal ahí:
   - En el explorador de Windows, entrá a esa ubicación, hacé clic derecho en un
     espacio vacío y elegí **"Git Bash aquí"** (u **"Abrir en Terminal"**).
2. Pegá este comando y presioná Enter:

   ```
   git clone -b claude/student-cleaning-calendar-p65urm https://github.com/Lushoo0m/calendario-hogar-colonia.git "Calendario Hogar Colonia"
   ```

3. Como el repositorio es privado, la primera vez Git va a abrir el navegador
   para que inicies sesión con la cuenta de GitHub que tiene acceso. Iniciá
   sesión una vez y listo — Windows se acuerda para la próxima.
4. Esto crea una carpeta nueva llamada **"Calendario Hogar Colonia"** con todo
   el código, pero sin tus datos reales (esos no viven en git, a propósito,
   para que nunca se mezclen ni se pisen).

## Paso 3 — Pasar tus datos reales a la carpeta nueva (una sola vez)

De tu carpeta **vieja** (la del zip), copiá estos dos archivos a la carpeta
**nueva** que acabás de clonar:

- `data.json` (tu calendario real: estudiantes, semanas, meses cerrados)
- `access-code.txt` (tu clave de acceso actual, si querés seguir usando la misma)

## Paso 4 — De ahora en más

- **Para usar el calendario**: entrá a la carpeta nueva y abrí `Iniciar Calendario.bat`,
  igual que siempre.
- **Para actualizar** cuando yo te avise que hay cambios nuevos: abrí
  `Actualizar Calendario.bat` (doble click). Antes de bajar nada, guarda una
  copia de seguridad completa de la carpeta tal cual está en ese momento
  (código y tus datos), y recién después baja los cambios.
- Si después de actualizar algo no anda como esperabas, contámelo — la copia
  de seguridad de justo antes queda guardada en la carpeta
  `backups-actualizaciones`, con fecha y hora, y volvemos ahí para revisarlo
  tranquilos.
- Podés dejar de usar la carpeta vieja (la del zip) — a partir de ahora todo
  pasa por la carpeta nueva.
