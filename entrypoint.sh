#!/bin/bash

if [ "$DEBUG" = "1" ]; then
  echo "🛠️ Starting in debug mode..."
  exec node --inspect=0.0.0.0:9229 Myserver.js
else
  echo "🚀 Starting in normal mode..."
  exec node Myserver.js
fi