#!/bin/sh
# Container health check — used by docker-compose / ECS
curl -sf http://localhost:3000/health | grep -q '"status":"ok"'
