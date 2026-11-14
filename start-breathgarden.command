#!/bin/zsh
# Double-click on macOS: launches Breathgarden from Terminal so macOS asks
# Terminal for camera access (camera permission follows the launching app).
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
npm start
