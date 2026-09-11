# Endpoint Sentinel Backend

Django REST API backend for the Endpoint Sentinel security monitoring system.

## Architecture

This is a **REST API-only backend** that serves JSON data to the TypeScript React frontend. All server-side template rendering has been removed. The backend focuses on:

- **Dashboard REST APIs**: Endpoint data aggregation and reporting
- **Agent APIs**: Heartbeat monitoring and command delivery
- **Power Management APIs**: WoL, shutdown, restart operations

## Project Structure

```
Backend/
├── core/                    # Django project settings
│   ├── settings.py         # Configuration (no templates)
│   ├── urls.py            # Root URL routing
│   └── wsgi.py            # WSGI application
├── dashboard/             # Main Django app
│   ├── models.py          # Data models (EndpointReport, EndpointStatus, etc.)
│   ├── views.py           # Agent & power management APIs
│   ├── api_views.py       # Dashboard REST endpoints (JSON)
│   ├── urls.py            # Dashboard URL routing
│   ├── admin.py           # Django admin configuration
│   ├── risk.py            # Risk scoring logic
│   ├── services/          # Business logic
│   │   ├── power.py       # Wake-on-LAN implementation
│   │   └── report_storage.py  # S3/Filebase integration
│   └── migrations/        # Database migrations
├── heartbeat/             # Heartbeat monitoring app (optional)
├── parsers/               # Report parsing logic
├── manage.py              # Django management script
└── requirements.txt       # Python dependencies
```

## API Endpoints

### Dashboard REST APIs (for React Frontend)

All endpoints return JSON. Query parameters for filtering supported where noted.

```
GET  /api/dashboard/overview/              — Fleet summary, charts, stats
GET  /api/dashboard/inventory/             — Filterable machine list
  ?os=windows&risk=critical&firewall=on&antivirus=on&encryption=on&q=hostname

GET  /api/dashboard/machine/<id>/          — Detailed report for one endpoint
GET  /api/dashboard/compare/               — Side-by-side comparison
  ?a=<id_1>&b=<id_2>

GET  /api/dashboard/search/                — Full-text search
  ?q=search_term
```

### Agent APIs

Endpoints for agent heartbeat and command polling:

```
POST /api/heartbeat/                       — Agent sends heartbeat
GET  /api/endpoints/status/                — Get all endpoint statuses
GET  /api/agent/commands/<hostname>/       — Agent fetches pending commands
POST /api/agent/commands/<id>/result/      — Agent reports command result
```

### Power Management APIs

```
POST /api/endpoints/<hostname>/power/on/        — Wake-on-LAN trigger
POST /api/endpoints/<hostname>/power/shutdown/  — Queue shutdown command
POST /api/endpoints/<hostname>/power/restart/   — Queue restart command
```

## Setup

### Prerequisites

- Python 3.10+
- pip or conda
- PostgreSQL or SQLite (local dev)

### Installation

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables** (create `.env`):
   ```
   SECRET_KEY=your-secret-key
   DEBUG=True
   ALLOWED_HOSTS=localhost,127.0.0.1
   DB_ENGINE=django.db.backends.sqlite3
   DB_NAME=db.sqlite3
   HEARTBEAT_API_KEY=your-agent-api-key
   CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://localhost:5173
   CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
   ```

3. **Run migrations**:
   ```bash
   python manage.py migrate
   ```

4. **Create superuser** (for admin access):
   ```bash
   python manage.py createsuperuser
   ```

5. **Run development server**:
   ```bash
   python manage.py runserver
   ```

Backend will be available at `http://localhost:8000`

## Key Configuration

### CORS & Frontend Communication

The backend is configured to accept requests from the TypeScript frontend:

```python
# core/settings.py
CORS_ALLOWED_ORIGINS = [
    'http://localhost:3000',    # Frontend dev server port 1
    'http://localhost:5173',    # Frontend dev server port 2
]
```

Update `CORS_ALLOWED_ORIGINS` in `.env` for production.

### Template Rendering Removed

Unlike the old combined architecture, this backend no longer renders HTML templates. All template infrastructure has been removed:

- ❌ No `TEMPLATES` configuration
- ❌ No `django.template.*` middleware
- ❌ No template files in `dashboard/templates/`
- ❌ No static files in `dashboard/static/`
- ✅ REST API only, returns JSON

## Models

### EndpointReport

Stores security audit reports from agents. One report per endpoint per scan.

- **Fields**: OS info, security controls (firewall, AV, encryption, etc.), risk metrics
- **Key Fields**: `hostname`, `os_type`, `risk_score`, `risk_level`

### EndpointStatus

Tracks real-time status of endpoints (online/offline, health metrics).

- **Fields**: Last seen, health score, CPU/memory/disk %, process count
- **Primary Key**: `mac_address` (immutable identifier)

### EndpointCommand

Queue for asynchronous power management commands (shutdown, restart).

- **Statuses**: pending, delivered, executing, success, failed, expired
- **Agents poll** this table and execute commands

### PowerActionLog

Audit trail of all power management operations.

- **Fields**: Operation type, status, user, timestamp, source IP

## Risk Scoring

Risk scores are calculated in `dashboard/risk.py` based on security control status:

- **Healthy** (0-33): All critical controls enabled
- **Warning** (34-66): Some critical controls disabled
- **Critical** (67-100): Multiple critical controls disabled or missing

## Database

### SQLite (Local Development)

Default setup uses SQLite. Database file: `db.sqlite3`

### PostgreSQL (Production)

For production, configure PostgreSQL:

```python
# .env
DB_ENGINE=django.db.backends.postgresql
DB_NAME=endpoint_sentinel
DB_USER=postgres
DB_PASSWORD=your-password
DB_HOST=localhost
DB_PORT=5432
```

## Deployment

### Gunicorn + Nginx

1. **Install gunicorn**:
   ```bash
   pip install gunicorn
   ```

2. **Run with gunicorn**:
   ```bash
   gunicorn core.wsgi:application --bind 0.0.0.0:8000
   ```

3. **Nginx reverse proxy** (redirect traffic to gunicorn)

### Security Checklist

- [ ] Set `DEBUG=False` in production
- [ ] Use strong `SECRET_KEY`
- [ ] Configure `ALLOWED_HOSTS` properly
- [ ] Update `CSRF_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS`
- [ ] Use HTTPS in production
- [ ] Set up proper database backups
- [ ] Configure `HEARTBEAT_API_KEY` securely

## Development

### Running Tests

```bash
python manage.py test dashboard
```

### Creating Migrations

```bash
python manage.py makemigrations dashboard
python manage.py migrate
```

### Admin Interface

Access at `http://localhost:8000/admin/` after creating a superuser.

## Integration with Frontend

The TypeScript React frontend communicates with this backend via the REST APIs:

1. Frontend is served separately (dev server or static build)
2. Frontend makes HTTP requests to `/api/dashboard/*` endpoints
3. Backend returns JSON responses
4. Frontend renders UI components from JSON data

Frontend repository: `Frontend/src/frontend/`

## Troubleshooting

### CORS Errors

- Verify `CORS_ALLOWED_ORIGINS` includes your frontend URL
- Check browser console for specific error messages

### API Errors

- Check that migrations are run: `python manage.py migrate`
- Verify database is accessible
- Check logs: `python manage.py runserver` (dev server shows errors)

### Agent Connection Issues

- Verify `HEARTBEAT_API_KEY` matches on agents
- Check `ALLOWED_HOSTS` includes agent IPs
- Review firewall rules

## Contact & Support

For issues or questions about the Backend, refer to the project documentation or contact the development team.
