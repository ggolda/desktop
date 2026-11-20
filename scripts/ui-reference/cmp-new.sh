#!/bin/bash
# cmp-new.sh <state> <size 1280x800|1920x1080>  : capture the running new app and compose legacy | new | diff
cd "$(dirname "$0")/../.."
state=$1; size=$2
case $size in 1280x800) W=1280; H=800;; 1920x1080) W=1920; H=1080;; esac
# same OUTER size as the legacy references; both frameless windows have 8 px invisible borders (compare.py --crop)
powershell -NoProfile -File scripts/ui-reference/shot-new.ps1 -Out test-results/parity/editor/new-$state-$size.png -Width $W -Height $H
python scripts/ui-reference/compare.py docs/rework/ui-reference/editor/$state-$size.png test-results/parity/editor/new-$state-$size.png test-results/parity/editor/cmp-$state-$size.png --crop --diff
