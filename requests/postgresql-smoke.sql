-- Consulta de solo lectura del usuario ficticio creado por pnpm db:smoke.
SELECT id, email, display_name, created_at, updated_at
FROM estadistica_forms.app_users
WHERE identity_issuer = 'urn:estadistica-forms:postgresql-smoke-test'
  AND identity_subject = 'postgresql-smoke-user';
