FROM php:8.3-apache

COPY docker/apache-daymark.conf /etc/apache2/conf-available/daymark-security.conf

RUN docker-php-ext-install sqlite3 \
    && a2enconf daymark-security

COPY . /var/www/html/

RUN mkdir -p /var/www/html/data \
    && chown -R www-data:www-data /var/www/html/data

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD php -r '$response = @file_get_contents("http://127.0.0.1/api.php?endpoint=/api/health"); exit($response === false ? 1 : 0);'
