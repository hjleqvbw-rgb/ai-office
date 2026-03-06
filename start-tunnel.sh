#!/bin/bash

DOMAIN="duelistic-osvaldo-nonobediently.ngrok-free.dev"

echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  🏢 AI Office 啟動中...                                      │"
echo "│  📱 固定網址：https://$DOMAIN  │"
echo "└──────────────────────────────────────────────────────────────┘"
echo ""

trap 'kill $(jobs -p) 2>/dev/null' EXIT

npm run dev &
sleep 3
ngrok http --domain="$DOMAIN" 3000

wait
