#!/bin/sh

set -eu

if [ -x /opt/homebrew/bin/docker ]; then
  DOCKER_BIN=/opt/homebrew/bin/docker
elif [ -x /usr/local/bin/docker ]; then
  DOCKER_BIN=/usr/local/bin/docker
elif command -v docker >/dev/null 2>&1; then
  DOCKER_BIN=$(command -v docker)
else
  echo "docker executable not found. Install Docker or update mcp.json to point at the correct binary." >&2
  exit 127
fi

exec "$DOCKER_BIN" run --rm -i --pull always surrealdb/surrealmcp:latest start