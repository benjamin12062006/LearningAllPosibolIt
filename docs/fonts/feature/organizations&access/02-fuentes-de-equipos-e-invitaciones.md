# 02 — Fuentes para equipos, invitaciones y último owner (E1.3)

Fecha de creación: 2026-11-02  
Estado: Investigación que respalda el [plan 02](../../../plans/feature/organizations&access/02-plan-e1.3-equipos-e-invitaciones.md).  
Relacionada con: [ficha 01](01-fuentes-de-acceso-y-organizaciones.md) (C3–C7, F31–F34), [fuentes técnicas de feeds](../feeds&publications/02-fuentes-tecnicas.md) (F25), [transición del backend](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md).

## Curso

Curso: **Learn how to build a secure ecommerce application with Go (Golang)** (carpeta `Go/Ecommerce Seguro con Go`), sección 8 «Mail and Password Resets». Instructor no consta en los archivos. Ruta relativa a la biblioteca `/Users/benji/Documents/chrome-extencions/trancripciones/`: `Go/Ecommerce Seguro con Go/Sección 8 Mail and Password Resets/`. Consulta: 2026-11-02. No se reconstruyó código: el curso usa Go y enlaces firmados, y aquí solo se toma el criterio.

| ID | Lección y localizador | Evidencia | Uso en el proyecto |
| --- | --- | --- | --- |
| C8 | `98. Password resets.md`, línea 15; búsqueda «one time use email that with an expiry date» | El enlace es de un solo uso y caduca. | La invitación caduca a los 7 días y se consume al aceptarla. |
| C9 | `108. Setting an expiry for password reset emails.md`, líneas 13–15; búsqueda «only good for, let's say 60 Minutes» | La caducidad se comprueba en el servidor al usar el enlace. | La aceptación compara `expires_at` dentro de la misma consulta que la consume. |
| C10 | `108. Setting an expiry for password reset emails.md`, línea 19; búsqueda «change the email in this payload variable» | Si el cliente envía el correo, un atacante puede cambiarlo. | El correo de quien acepta sale de la sesión, nunca del cuerpo de la petición. |

**Contraste.** El curso usa enlaces firmados sin estado (HMAC sobre la URL). Aquí no sirven: una invitación tiene que poder revocarse y consumirse una sola vez, y eso exige estado en la base. Se elige token aleatorio con su hash guardado, el mismo mecanismo que el token de entrega de feeds (F25).

## Documentación oficial

Consulta: 2026-11-02.

| ID | Fuente y sección | Evidencia | Uso |
| --- | --- | --- | --- |
| F35 | [OWASP — Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), «Introduction» y «General Security Practices» | Los tokens se generan con un generador criptográfico, son lo bastante largos, se guardan de forma segura, son «Single use and expire after an appropriate period» y están ligados a un usuario. La página no fija la duración ni dice «hash» literalmente: remite a la guía de almacenamiento. | 32 bytes de `randomBytes`, solo el SHA-256 en la base, un solo uso, caducidad y destinatario por correo. Los 7 días son decisión propia. |
| F25 | [Node.js v26 — Crypto](https://nodejs.org/docs/latest-v26.x/api/crypto.html), ya registrada en feeds | `randomBytes(32).toString('base64url')` da 43 caracteres. | Mismo formato que el token de entrega. |
| F36 | [PostgreSQL 17 — 13.2.1 Read Committed](https://www.postgresql.org/docs/17/transaction-iso.html) | Si otra transacción modificó la fila, la segunda «will wait for the first updating transaction to commit or roll back» y «The search condition of the command (the WHERE clause) is re-evaluated». | Proteger al último owner: se bloquean con `FOR UPDATE` las filas de owners, actor y destino. Si dos owners se degradan a la vez, la segunda transacción vuelve a evaluar `role = 'owner'`, ve un solo owner y se rechaza. |
| F37 | [Descope — JWT Templates](https://docs.descope.com/management/jwt-templates) | Descope fija `sub`, `amr`, `act` e `iss` en todo JWT; la página no documenta un claim de correo ni de correo verificado por defecto. | **Límite.** El correo de la sesión es opcional y no prueba verificación. Aceptar exige token + correo de la sesión igual al invitado. La verificación fuerte (`verifiedEmail` del usuario, presente en los tipos de `@descope/node-sdk`) requiere la API de gestión y queda pendiente. |

## Evidencia del proyecto

- [delivery-token.ts](../../../../src/feeds/delivery-token.ts): token de 32 bytes, solo se guarda el hash y se busca por índice único. Se replica en organizaciones en lugar de importarlo: organizaciones no puede depender de feeds (C7). Unificarlo en `common` queda para cuando feeds cierre.
- [prueba de Descope](../../../autenticacion-descope/01-prueba-auth-end-to-end.md): el inicio de sesión del proyecto usa Email OTP o Magic Link, que exigen controlar el correo de acceso. Eso apoya, sin demostrarlo, que el correo de la sesión pertenece a quien la abre.

## Límites

Ninguna fuente enseña invitaciones a una organización. El modelo de invitaciones, roles asignables y la regla del dueño de la organización personal son propuesta propia sobre [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md).
