#!/bin/bash
export NODE_OPTIONS="--max-old-space-size=768"

# Install Abhaya Libre fonts for LibreOffice PDF conversion
FONT_SRC="/app/backend/src/assets/fonts"
FONT_DEST="/usr/local/share/fonts/abhaya"
if [ -d "$FONT_SRC" ]; then
  mkdir -p "$FONT_DEST"
  cp "$FONT_SRC"/AbhayaLibre*.ttf "$FONT_DEST/" 2>/dev/null || true
  fc-cache -f "$FONT_DEST" 2>/dev/null || true
fi

exec node backend/index.js
