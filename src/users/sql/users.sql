
-- Equivalentes SQL de las consultas ejecutables de users.repository.ts.
-- Los $n son parámetros PostgreSQL enviados por separado mediante Prisma.sql.

-- Inserta un nuevo usuario local si no existe, o actualiza si ya existe.
INSERT INTO estadistica_forms.app_users
  (id, identity_issuer, identity_subject, email, display_name, created_at, updated_at)
VALUES ($1, $2, $3, $4, NULL, $5, $6)
ON CONFLICT(identity_issuer, identity_subject) DO UPDATE SET
  email = COALESCE(excluded.email, app_users.email),
  updated_at = CASE
    WHEN excluded.email IS NOT NULL AND excluded.email IS DISTINCT FROM app_users.email
    THEN excluded.updated_at
    ELSE app_users.updated_at
  END
RETURNING
  id,
  email,
  display_name AS "displayName",
  created_at AS "createdAt",
  updated_at AS "updatedAt";

-- Busca el perfil local de la identidad validada por Descope.
SELECT
  id,
  email,
  display_name AS "displayName",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
FROM estadistica_forms.app_users
WHERE identity_issuer = $1 AND identity_subject = $2;

-- Actualiza el nombre del usuario local.
UPDATE estadistica_forms.app_users SET
  display_name = $1,
  updated_at = CASE
    WHEN display_name IS DISTINCT FROM $2 THEN $3
    ELSE updated_at
  END
WHERE identity_issuer = $4 AND identity_subject = $5
RETURNING
  id,
  email,
  display_name AS "displayName",
  created_at AS "createdAt",
  updated_at AS "updatedAt";
