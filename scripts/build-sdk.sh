#!/usr/bin/env sh
# Rebuilds vendor/anthropic-sdk.min.js, the browser bundle of the official
# Anthropic TypeScript SDK used for the optional Claude recognition.
set -e
VERSION=${1:-0.131.0}
DIR=$(mktemp -d)
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$DIR"
npm init -y >/dev/null
npm install --silent "@anthropic-ai/sdk@$VERSION" esbuild@0.25.0
echo 'export { default } from "@anthropic-ai/sdk";' > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser --minify --legal-comments=eof --outfile=out.js
{ echo "// @anthropic-ai/sdk $VERSION — browser ESM bundle built with scripts/build-sdk.sh. MIT License, see vendor/LICENSE-anthropic-sdk."; cat out.js; } > "$ROOT/vendor/anthropic-sdk.min.js"
cp node_modules/@anthropic-ai/sdk/LICENSE "$ROOT/vendor/LICENSE-anthropic-sdk"
echo "Updated vendor/anthropic-sdk.min.js to $VERSION"
