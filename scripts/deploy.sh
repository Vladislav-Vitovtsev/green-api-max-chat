#!/usr/bin/env bash
# Выкладка статики max-chat.vitovtsev.site: релиз в каталог по sha,
# атомарная смена симлинка, пять последних релизов.
set -euo pipefail
HOST="${DEPLOY_HOST:-deploy@85.198.96.107}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
BASE="/opt/portfolio/max-chat"
TARGET="${BASE}/releases/${SHA}"
KEY="${DEPLOY_KEY_FILE:-$HOME/.ssh/id_vitovtsev_deploy}"
KEY="${KEY/#\~/$HOME}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -f "$KEY" ] && SSH_OPTS+=(-i "$KEY")

echo "собираю"
(cd "$ROOT" && npm run build)

echo "выкладываю ${SHA}"
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p ${TARGET}"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$ROOT/dist/" "${HOST}:${TARGET}/"
ssh "${SSH_OPTS[@]}" "$HOST" "ln -sfn releases/${SHA} ${BASE}/current.tmp && mv -Tf ${BASE}/current.tmp ${BASE}/current"
ssh "${SSH_OPTS[@]}" "$HOST" "cd ${BASE}/releases && ACTIVE=\"\$(basename \"\$(readlink -f ${BASE}/current)\")\" && ls -1t | grep -vx \"\$ACTIVE\" | tail -n +5 | xargs -r rm -rf"
echo "готово: https://max-chat.vitovtsev.site"
