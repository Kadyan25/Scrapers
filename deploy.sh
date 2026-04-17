#!/bin/bash
# Deploy one or all actors to Apify.
# Usage:
#   ./deploy.sh                     — deploy all three actors
#   ./deploy.sh gmaps-full          — deploy one actor
#
# Why the copy step: apify push zips only the actor folder, so shared/ must
# be present inside it at deploy time. It is removed immediately after.

set -e

ACTORS="${1:-gmaps-full gmaps-no-website phone-enricher}"

for ACTOR in $ACTORS; do
  echo ""
  echo "=== Deploying $ACTOR ==="

  cp -r shared/ "actors/$ACTOR/shared/"

  (cd "actors/$ACTOR" && apify push)

  rm -rf "actors/$ACTOR/shared/"

  echo "=== Done: $ACTOR ==="
done

echo ""
echo "All done."
