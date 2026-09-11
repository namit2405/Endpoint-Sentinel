"""
Dashboard URL routing for API endpoints.

Dashboard REST API endpoints (for React/TypeScript frontend):
  GET  /api/dashboard/overview/      — fleet summary, charts, stats
  GET  /api/dashboard/inventory/     — filterable machine list
  GET  /api/dashboard/machine/<id>/  — detailed report for one endpoint
  GET  /api/dashboard/compare/       — side-by-side comparison of two machines
  GET  /api/dashboard/search/        — full-text search across fields

Licensing APIs (for license management):
  POST /api/licenses/validate/           — validate a license key
  POST /api/licenses/activate-device/    — activate a device with license
  POST /api/licenses/deactivate-device/  — deactivate a device
  GET  /api/licenses/status/             — get license and device status

Agent APIs (for endpoint agents):
  POST /api/heartbeat/               — receive heartbeat from endpoint agents
  GET  /api/endpoints/status/        — return live presence JSON
  GET  /api/agent/commands/<hostname>/           — agent fetches pending commands
  POST /api/agent/commands/<id>/result/          — agent reports command result

Power Management APIs:
  POST /api/endpoints/<hostname>/power/on/        — trigger WoL
  POST /api/endpoints/<hostname>/power/shutdown/  — queue shutdown
  POST /api/endpoints/<hostname>/power/restart/   — queue restart

Real-Time Monitoring APIs:
  GET  /api/endpoints/current/              — latest metrics for all endpoints
  GET  /api/endpoints/<hostname>/history/   — historical metrics for one endpoint
  GET  /api/endpoints/health-history/       — health history for filtered endpoints
  POST /api/endpoints/health-history/       — agents post metric snapshots
"""
from django.urls import path
from . import views, api_views, auth_api, licensing_api, views_realtime_monitoring

app_name = "dashboard"

urlpatterns = [
    # ── Authentication APIs ────────────────────────────────────────────────
    path("api/auth/login/",    auth_api.login,      name="api_auth_login"),
    path("api/auth/logout/",   auth_api.logout,     name="api_auth_logout"),
    path("api/auth/user/",     auth_api.get_user,   name="api_auth_user"),

    # ── Dashboard REST API (for React frontend) ───────────────────────────
    path("api/dashboard/overview/",            api_views.overview,        name="api_overview"),
    path("api/dashboard/inventory/",           api_views.inventory,       name="api_inventory"),
    path("api/dashboard/machine/<int:pk>/",    api_views.machine_detail,  name="api_machine_detail"),
    path("api/dashboard/compare/",             api_views.compare,         name="api_compare"),
    path("api/dashboard/search/",              api_views.search,          name="api_search"),

    # ── Licensing APIs ─────────────────────────────────────────────────────
    path("api/licenses/validate/",             licensing_api.validate_license,        name="api_license_validate"),
    path("api/licenses/activate-device/",      licensing_api.activate_device,         name="api_license_activate"),
    path("api/licenses/deactivate-device/",    licensing_api.deactivate_device,       name="api_license_deactivate"),
    path("api/licenses/status/",               licensing_api.license_status,          name="api_license_status"),

    # ── Agent APIs ─────────────────────────────────────────────────────────
    path("api/heartbeat/",                     views.heartbeat,                       name="api_heartbeat"),
    path("api/endpoints/status/",              views.endpoints_status,                name="api_endpoints_status"),
    path("api/agent/commands/<str:hostname>/", views.agent_fetch_commands,            name="api_agent_fetch_commands"),
    path("api/agent/commands/<int:command_id>/result/", views.agent_report_command_result, name="api_agent_report_result"),

    # ── Power Management APIs ──────────────────────────────────────────────
    path("api/endpoints/<str:hostname>/power/on/",       views.power_on_wol,      name="api_power_on"),
    path("api/endpoints/<str:hostname>/power/shutdown/", views.power_shutdown,    name="api_power_shutdown"),
    path("api/endpoints/<str:hostname>/power/restart/",  views.power_restart,     name="api_power_restart"),

    # ── Real-Time Monitoring APIs ──────────────────────────────────────────
    path("api/endpoints/current/",             views_realtime_monitoring.current_metrics,        name="api_current_metrics"),
    path("api/endpoints/<str:hostname>/history/", views_realtime_monitoring.historical_metrics, name="api_historical_metrics"),
    path("api/endpoints/health-history/",     views_realtime_monitoring.health_history,         name="api_health_history"),
]


