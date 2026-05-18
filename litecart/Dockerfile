FROM php:8.3-apache

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends git unzip libzip-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev libicu-dev; \
  docker-php-ext-configure gd --with-freetype --with-jpeg; \
  docker-php-ext-install mysqli pdo_mysql zip gd opcache intl; \
  a2enmod rewrite headers; \
  rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  if [ ! -f /usr/src/litecart/.ready ]; then \
    git clone --depth=1 https://github.com/litecart/litecart.git /usr/src/litecart; \
    touch /usr/src/litecart/.ready; \
  fi

COPY docker-entrypoint.sh /usr/local/bin/carbonflow-litecart-entrypoint
RUN chmod +x /usr/local/bin/carbonflow-litecart-entrypoint

ENTRYPOINT ["carbonflow-litecart-entrypoint"]
CMD ["apache2-foreground"]
