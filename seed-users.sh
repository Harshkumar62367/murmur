#!/bin/sh
# Create the two demo users (idempotent).
# Runs as the container entrypoint before /authserver serve starts.
set +e

for entry in "harsh@demo.io:speedrun-demo:Harsh" "maya@demo.io:speedrun-demo:Maya"; do
  email=$(echo "$entry" | cut -d: -f1)
  pw=$(echo "$entry" | cut -d: -f2)
  name=$(echo "$entry" | cut -d: -f3)
  echo "[seed] creating user $email"
  /authserver admin user create --email "$email" --name "$name" --password "$pw" 2>&1 | head -1
done

echo "[seed] done"
