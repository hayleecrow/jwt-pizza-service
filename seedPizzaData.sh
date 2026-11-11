#!/bin/bash
# Usage: ./seedPizzaData.sh https://pizza-service.yourdomain.click <admin-email> <admin-password>
# Adds the sample data the traffic script needs: users d@jwt.com and f@jwt.com,
# a franchise (id 1) with a store, and a menu item. Safe to re-run; it skips what exists.

if [ $# -lt 3 ]; then
  echo "Usage: $0 <host> <admin-email> <admin-password>"
  exit 1
fi
host=$1
admin_email=$2
admin_pw=$3
json='Content-Type: application/json'

register() { # $1=name $2=email $3=password
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$host/api/auth" -H "$json" \
    -d "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"$3\"}")
  echo "Register $2... $code (200 = created, 500 = probably already exists)"
}

register "pizza diner" d@jwt.com diner
register "pizza franchisee" f@jwt.com franchisee

token=$(curl -s -X PUT "$host/api/auth" -H "$json" \
  -d "{\"email\":\"$admin_email\",\"password\":\"$admin_pw\"}" | jq -r '.token')
if [ -z "$token" ] || [ "$token" = "null" ]; then
  echo "Admin login failed; check the admin email/password. Stopping."
  exit 1
fi
auth="Authorization: Bearer $token"
echo "Admin login... ok"

franchises=$(curl -s "$host/api/franchise?page=0&limit=10&name=*" | jq -r '.franchises | length')
if [ "$franchises" = "0" ]; then
  echo "Create franchise... $(curl -s -o /dev/null -w '%{http_code}' -X POST "$host/api/franchise" \
    -H "$json" -H "$auth" -d '{"name":"pizzaPocket","admins":[{"email":"f@jwt.com"}]}')"
  echo "Create store... $(curl -s -o /dev/null -w '%{http_code}' -X POST "$host/api/franchise/1/store" \
    -H "$json" -H "$auth" -d '{"franchiseId":1,"name":"SLC"}')"
else
  echo "Franchise already exists; skipping."
fi

menu=$(curl -s "$host/api/order/menu" | jq -r 'length')
if [ "$menu" = "0" ]; then
  echo "Add menu item... $(curl -s -o /dev/null -w '%{http_code}' -X PUT "$host/api/order/menu" \
    -H "$json" -H "$auth" \
    -d '{"title":"Veggie","description":"A garden of delight","image":"pizza1.png","price":0.0038}')"
else
  echo "Menu already has $menu items; skipping."
fi

curl -s -o /dev/null -X DELETE "$host/api/auth" -H "$auth"
echo "Done. Now check: curl -s $host/api/order/menu"
