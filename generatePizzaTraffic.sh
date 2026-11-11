#!/bin/bash
# Usage: ./generatePizzaTraffic.sh http://localhost:3000 [minutes]
# Simulates traffic against the pizza service for [minutes] (default 45), then stops itself.

if [ -z "$1" ]; then
  echo "Usage: $0 <host> [minutes]   e.g. $0 http://localhost:3000 45"
  exit 1
fi
host=$1
minutes=${2:-45}

pids=()
cleanup() {
  echo "Stopping traffic..."
  kill "${pids[@]}" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

login() { # $1=email $2=password -> prints token
  curl -s -X PUT "$host/api/auth" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\", \"password\":\"$2\"}" | jq -r '.token'
}

# 1. Browse the menu every 3 seconds (GET traffic)
while true; do
  echo "Requesting menu... $(curl -s -o /dev/null -w '%{http_code}' "$host/api/order/menu")"
  sleep 3
done &
pids+=($!)

# 2. Invalid login every 10 seconds (failed auth + 404s)
while true; do
  echo "Invalid login... $(curl -s -o /dev/null -w '%{http_code}' -X PUT "$host/api/auth" \
    -H 'Content-Type: application/json' -d '{"email":"unknown@jwt.com","password":"bad"}')"
  sleep 10
done &
pids+=($!)

# 3. Franchisee logs in, stays 2 minutes, logs out (active users)
while true; do
  token=$(login f@jwt.com franchisee)
  echo "Login franchisee... $([ "$token" != "null" ] && echo ok || echo FAILED)"
  sleep 110
  curl -s -o /dev/null -X DELETE "$host/api/auth" -H "Authorization: Bearer $token"
  echo "Logout franchisee"
  sleep 10
done &
pids+=($!)

# 4. Diner logs in, buys 1 pizza every ~15s, logs out after ~1 minute (sales, revenue, pizza latency)
while true; do
  token=$(login d@jwt.com diner)
  echo "Login diner... $([ "$token" != "null" ] && echo ok || echo FAILED)"
  for i in 1 2 3 4; do
    echo "Bought a pizza... $(curl -s -o /dev/null -w '%{http_code}' -X POST "$host/api/order" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $token" \
      -d '{"franchiseId": 1, "storeId":1, "items":[{ "menuId": 1, "description": "Veggie", "price": 0.05 }]}')"
    sleep 15
  done
  curl -s -o /dev/null -X DELETE "$host/api/auth" -H "Authorization: Bearer $token"
  echo "Logout diner"
  sleep 10
done &
pids+=($!)

# 5. Hungry diner orders 22 pizzas every 2 minutes (factory failure, 500s, slow latency)
while true; do
  token=$(login d@jwt.com diner)
  items='{ "menuId": 1, "description": "Veggie", "price": 0.05 }'
  for ((i = 0; i < 21; i++)); do
    items+=', { "menuId": 1, "description": "Veggie", "price": 0.05 }'
  done
  echo "Bought too many pizzas... $(curl -s -o /dev/null -w '%{http_code}' -X POST "$host/api/order" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $token" \
    -d "{\"franchiseId\": 1, \"storeId\":1, \"items\":[$items]}")"
  curl -s -o /dev/null -X DELETE "$host/api/auth" -H "Authorization: Bearer $token"
  sleep 120
done &
pids+=($!)

echo "Generating traffic against $host for $minutes minutes. Press CTRL-C to stop early."
sleep $((minutes * 60))
cleanup
