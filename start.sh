#!/bin/bash
export NODE_OPTIONS="--max-old-space-size=768"
exec node backend/index.js
