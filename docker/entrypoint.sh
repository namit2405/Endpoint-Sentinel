#!/bin/sh
set -eu

cd /app/Backend
python manage.py migrate --noinput
python manage.py collectstatic --noinput
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/endpoint-sentinel.conf
