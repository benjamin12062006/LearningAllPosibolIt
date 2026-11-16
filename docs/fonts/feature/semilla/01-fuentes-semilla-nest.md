# 01 — Fuentes de la semilla de desarrollo

Fecha de creación: 2026-11-14  
Relacionada con: [ficha del curso y las reconstrucciones](../../db/05-curso-nest-semilla-reconstrucciones.md), [plan histórico](../../../plans/db/02-plan-semillas-de-desarrollo.md).

- Fernando Herrera, NestJS Backend Completo, sección 5, lecciones 61 y 63. La lección 61 coloca la carga en SeedService. La 63 exporta e importa servicios de otros módulos. Se reutilizan las reconstrucciones R1 y R3 que ya están registradas en la ficha del curso.
- [NestJS, Standalone applications](https://docs.nestjs.com/standalone-applications), consultada el 2026-11-14. Un contexto obtiene los providers con `app.get()`. Se cierra con `app.close()`. En KTSU se compone desde el script de desarrollo para conservar los servicios de hojas, trabajos y artefactos.
- [Prisma 7, Seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding), consultada el 2026-11-14. La carga se invoca bajo demanda. La adaptación de KTSU crea su propio PGlite, aplica las migraciones existentes y protege los artefactos con un directorio de semilla exclusivo.
