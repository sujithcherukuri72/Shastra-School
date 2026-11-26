#!/bin/sh
# Runs once, on first start of an empty Postgres volume.
# Creates a least-privilege application role that owns only the app database.
# The superuser is used for nothing else.
set -eu

: "${DB_APP_USER:?DB_APP_USER is required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"
: "${DB_NAME:?DB_NAME is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname postgres \
  -v app_user="$DB_APP_USER" -v app_pass="$DB_APP_PASSWORD" -v db_name="$DB_NAME" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_pass'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE :"db_name" OWNER :"app_user";
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db_name" TO :"app_user";
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB_NAME" -v app_user="$DB_APP_USER" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO :"app_user";
SQL
