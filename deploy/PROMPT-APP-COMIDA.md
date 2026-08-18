# Prompt para arrancar el proyecto de la app de venta de comida

Guardá este texto. El día que quieras empezar ese proyecto, abrí una conversación NUEVA con Claude (no dentro de esta del calendario, para no mezclar los dos proyectos) y pegá el prompt de abajo, completando primero los `[corchetes]` con los datos reales de tu negocio.

No hace falta que sepas programación para completarlo — son preguntas de negocio (qué vendés, cómo se cobra, etc.), Claude se encarga de la parte técnica.

---

## Prompt (completá los corchetes antes de pegarlo)

```
Quiero que me ayudes a construir, de cero, una aplicación web para vender
comida — pensada para uso real, no una maqueta. Estos son los datos del
negocio:

- Nombre del negocio: [completar]
- Qué se vende: [ej: viandas caseras, pedidos por día, menú fijo semanal, etc.]
- Cómo se hacen los pedidos hoy (si ya vendés de alguna forma): [completar]
- Zona de entrega / retiro en local / ambos: [completar]
- Cómo se cobra hoy (efectivo, transferencia, Mercado Pago, etc.) y cómo
  te gustaría cobrar en la app: [completar]
- Quién va a usar la app: ¿solo vos para armar pedidos, o clientes van a
  pedir ellos mismos desde su celular?: [completar]
- País / moneda: [completar]

## Contexto técnico importante — leelo antes de proponer nada

Ya tengo un servidor físico dedicado (propio, en casa) donde corre otra
app mía (un calendario de tareas para un hogar de estudiantes), con esta
infraestructura ya armada y funcionando:

- Un reverse proxy con Caddy que da HTTPS automático (Let's Encrypt) a
  cada app por su propio subdominio de DuckDNS.
- Cada app corre aislada de las demás: usuario de Linux propio, servicio
  propio, credenciales propias — ninguna comparte nada con las otras.
- Para esta app nueva específicamente (por manejar pedidos y plata de
  gente de afuera de mi casa, es la más expuesta de todas) quiero que
  corra en su propio contenedor Docker, separado del resto.
- Quiero un subdominio propio para esta app (ej. comida.tudominio.duckdns.org)
  y que sea instalable en el celular como una app (PWA — ícono en la
  pantalla de inicio, sin pasar por el navegador).
- A diferencia del calendario (que es privado, con clave para toda la
  familia), ESTA app es de cara al público: cualquier cliente tiene que
  poder entrar al link y ver el menú/hacer un pedido SIN ningún usuario
  ni contraseña — como cualquier sitio de venta online. La protección con
  login, si hace falta, va solo del lado del panel donde yo administro el
  menú y los pedidos, nunca del lado del cliente que solo quiere comprar.

## Cómo quiero que trabajemos

1. Antes de escribir código, hacéme las preguntas que falten para entender
   bien el negocio (no asumas nada de lo que no te dije arriba).
2. Proponeme una arquitectura simple, acorde al tamaño real del negocio —
   nada de sobre-ingeniería. Si hace falta procesar pagos de verdad,
   explicame las opciones para [país/moneda que completaste arriba] y sus
   implicancias de seguridad antes de elegir una.
3. Explicame cada decisión técnica en palabras simples, doy por hecho que
   no sé programar — como si me estuvieras explicando por primera vez.
4. Cuando el código esté listo, ayudame a dejarlo andando en mi servidor
   siguiendo el mismo patrón que ya tengo (Docker, Caddy, subdominio
   propio, credenciales propias) — no reinventemos la infraestructura.
```

---

### Por qué está armado así

- Le pedí explícitamente que **pregunte antes de asumir** — así no arranca construyendo algo que no es lo que necesitás.
- Le di el **contexto de infraestructura** para que la app nueva encaje con lo que ya tenés, en vez de proponerte otra cosa desde cero.
- Le pedí **Docker y subdominio propio** para esta app en particular, porque va a manejar pagos y datos de gente de afuera — es la que más conviene aislar bien.
- Si en el futuro sumás una tercera app (la de gestión del hogar y finanzas), podés reusar este mismo prompt como base, cambiando la sección de "qué hace la app" y bajando el nivel de aislamiento si esa app es de uso solo tuyo/familiar (no maneja pagos de terceros).
