# Production Deployment

The production image serves the built frontend and Django API from one container.
Production publishes port `8001`; the frontend and API are both available there.
The frontend uses same-origin `/api` requests, so no Vite development server is needed.

## GitHub Actions secrets

Add these repository secrets:

- `DEPLOY_HOST`: Ubuntu server address or hostname
- `DEPLOY_USER`: SSH deployment user
- `DEPLOY_SSH_KEY`: private key for that user
- `GHCR_USERNAME`: GitHub username
- `GHCR_READ_TOKEN`: fine-grained GitHub token with read-only package access

The workflow checks Django and the frontend on pull requests. A push to `main` publishes
`ghcr.io/namit2405/endpoint-sentinel:latest`, pulls it on the Ubuntu host, recreates the
container, and verifies the health endpoint. Do not build the image manually on the
production host; manual Docker commands are only needed for the initial host bootstrap.

## Ubuntu host

Install Docker and copy the production Compose file to `/opt/endpoint-sentinel`:

```bash
sudo mkdir -p /opt/endpoint-sentinel
sudo cp compose.production.yml /opt/endpoint-sentinel/
sudo cp Backend/.env /opt/endpoint-sentinel/.env
sudo chmod 600 /opt/endpoint-sentinel/.env
```

Set production values in `/opt/endpoint-sentinel/.env`: `DEBUG=False`, a new
`SECRET_KEY`, `ALLOWED_HOSTS=103.164.67.226`, and same-origin values such as
`CORS_ALLOWED_ORIGINS=http://103.164.67.226:8001,http://103.164.67.226:5174`.

Log in once as the deployment user and start the stack:

```bash
docker login ghcr.io
cd /opt/endpoint-sentinel
docker compose -f compose.production.yml up -d
```

After this initial setup, pushes to `main` deploy automatically through GitHub Actions.

The application will be available at `http://103.164.67.226:8001`.
