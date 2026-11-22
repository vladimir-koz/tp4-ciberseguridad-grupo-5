-- =============================================================================
-- Usuario de aplicación: contraseña externa y permisos de datos, sin DDL.
-- Solo se ejecuta automáticamente al inicializar un volumen vacío.
-- =============================================================================

\set ON_ERROR_STOP on
\getenv app_password DB_PASSWORD

BEGIN;
SET LOCAL password_encryption = 'scram-sha-256';

SELECT 'CREATE ROLE origen_app'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'origen_app')
\gexec

SELECT format(
    'ALTER ROLE origen_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
    :'app_password'
)
\gexec

REVOKE CREATE, TEMPORARY ON DATABASE origen FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE origen TO origen_app;
GRANT USAGE ON SCHEMA public TO origen_app;

GRANT SELECT, INSERT, UPDATE, DELETE
ON usuarios, productos, pedidos, pedido_items, comentarios TO origen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO origen_app;

COMMIT;
