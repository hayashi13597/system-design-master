#!/bin/sh
set -eu
until PGPASSWORD="$POSTGRES_PASSWORD" pg_isready -h postgres -U postgres; do sleep 1; done
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  PGPASSWORD="$POSTGRES_PASSWORD" pg_basebackup -h postgres -U replicator -D "$PGDATA" -Fp -Xs -P -R
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
fi
exec docker-entrypoint.sh postgres -c hot_standby=on
