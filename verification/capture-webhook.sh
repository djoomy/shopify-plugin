#!/usr/bin/env bash
#
# Lance le serveur de capture des webhooks Djomy et l'expose sur une URL
# publique, le temps de déterminer le format exact de la signature (D8).
#
# Usage : npm run capture:webhook
#
# Laisser tourner pendant la configuration de l'URL côté Djomy et le paiement
# de test. Ctrl+C pour arrêter.

set -euo pipefail

PORT="${PORT:-3000}"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(dirname "$ICI")"

CLOUDFLARED="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"

if [ ! -x "$CLOUDFLARED" ]; then
  cat <<'AIDE'
cloudflared est introuvable.

Installation (une seule fois) :

  mkdir -p ~/.local/bin
  curl -fsSL -o ~/.local/bin/cloudflared \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x ~/.local/bin/cloudflared

Aucun compte Cloudflare n'est nécessaire : les tunnels « quick » sont anonymes
et éphémères.

Solution de repli sans installation :

  ssh -R 80:localhost:3000 nokey@localhost.run

AIDE
  exit 1
fi

nettoyer() {
  echo
  echo "Arrêt…"
  [ -n "${PID_SERVEUR:-}" ] && kill "$PID_SERVEUR" 2>/dev/null || true
  [ -n "${PID_TUNNEL:-}" ] && kill "$PID_TUNNEL" 2>/dev/null || true
}
trap nettoyer EXIT INT TERM

echo "Démarrage du serveur de capture sur le port $PORT…"
node "$ICI/capture-webhook.mjs" "$PORT" &
PID_SERVEUR=$!
sleep 2

if ! curl -sf -m 5 "http://127.0.0.1:$PORT/" > /dev/null; then
  echo "Le serveur de capture n'a pas démarré. Vérifier que le port $PORT est libre."
  exit 1
fi

JOURNAL="$(mktemp)"
echo "Ouverture du tunnel public…"
"$CLOUDFLARED" tunnel --url "http://localhost:$PORT" --no-autoupdate > "$JOURNAL" 2>&1 &
PID_TUNNEL=$!

URL=""
for _ in $(seq 1 30); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$JOURNAL" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Le tunnel n'a pas fourni d'URL. Journal :"
  tail -20 "$JOURNAL"
  exit 1
fi

cat <<INSTRUCTIONS

══════════════════════════════════════════════════════════════════════════════
  URL publique : $URL
══════════════════════════════════════════════════════════════════════════════

  1. Espace développeur Djomy → configuration des webhooks.
     Renseigner comme URL de notification :

         $URL/webhooks/djomy/test

  2. Déclencher un paiement de test :

         npm run verify:sandbox

     puis ouvrir l'URL de redirection affichée et régler le paiement.

  3. Le webhook reçu s'affichera ici, avec la formule de signature identifiée.
     Les captures sont conservées dans verification/captures/.

  Ctrl+C pour arrêter.

INSTRUCTIONS

wait "$PID_SERVEUR"
