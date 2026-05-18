#!/bin/sh
set -eu

if [ ! -f /var/www/html/index.php ]; then
  cp -a /usr/src/litecart/public_html/. /var/www/html/
  chown -R www-data:www-data /var/www/html
fi

cat > /usr/local/etc/php/conf.d/carbonflow.ini <<'EOF'
memory_limit=192M
upload_max_filesize=64M
post_max_size=64M
max_execution_time=120
opcache.enable=1
opcache.memory_consumption=64
opcache.max_accelerated_files=12000
opcache.validate_timestamps=1
EOF

exec "$@"
