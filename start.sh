#!/bin/bash
export NODE_OPTIONS="--max-old-space-size=1024"
exec node backend/index.js
