#!/bin/bash
# Starts the built app with a throw-away profile holding the `typical` fixture (parity compare loop).
cd "$(dirname "$0")/../.."
D=$(mktemp -d)
node scripts/fixtures/copy-collections.mjs typical "$D" > /dev/null
mkdir -p test-results/parity
cygpath -w "$D" > test-results/parity/userdata.txt
SLOBS_USERDATA_DIR="$D" npx electron . --disable-features=CalculateNativeWinOcclusion --force-device-scale-factor=1 --remote-debugging-port=9223 > test-results/parity/app.log 2>&1 &
sleep 30
