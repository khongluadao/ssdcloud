#!/bin/bash
set -e

KEYFILE_TMP="/tmp/mongo-keyfile"
RS_HOST="${MONGO_RS_HOST:-127.0.0.1:27017}"
DB_USER="${MONGO_INITDB_ROOT_USERNAME:-mon}"
DB_PASS="${MONGO_INITDB_ROOT_PASSWORD:-Son1234}"

cp /etc/mongo-keyfile "$KEYFILE_TMP"
chmod 600 "$KEYFILE_TMP"
chown mongodb:mongodb "$KEYFILE_TMP"

mongod \
  --replSet rs0 \
  --bind_ip_all \
  --auth \
  --keyFile "$KEYFILE_TMP" \
  --fork \
  --logpath /var/log/mongodb.log

until mongosh --quiet --eval "db.adminCommand({ ping: 1 }).ok" >/dev/null 2>&1; do
  sleep 1
done

# 1) Init replica set trước
mongosh --quiet <<EOF
try {
  const status = rs.status();
  print("Replica set already initialized");
} catch (e) {
  rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "$RS_HOST" }]
  });
  print("Replica set initialized");
}
EOF

# 2) Đợi node thành primary
until mongosh --quiet --eval "db.hello().isWritablePrimary" | grep -q true; do
  sleep 1
done

# 3) Tạo user sau khi đã là primary
mongosh --quiet <<EOF
use admin
try {
  db.createUser({
    user: "$DB_USER",
    pwd: "$DB_PASS",
    roles: [{ role: "root", db: "admin" }]
  });
  print("Root user created");
} catch (e) {
  if (
    e.codeName === "DuplicateKey" ||
    e.message.includes("already exists")
  ) {
    print("Root user already exists");
  } else {
    throw e;
  }
}
EOF

# 4) Test auth
mongosh -u "$DB_USER" -p "$DB_PASS" --authenticationDatabase admin --quiet --eval "db.adminCommand({ ping: 1 })"

tail -f /var/log/mongodb.log