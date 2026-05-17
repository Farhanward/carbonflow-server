# CarbonFlow Server

Full self-hosted stack for CarbonFlow platform.

## Services
| Service | URL | Description |
|---------|-----|-------------|
| Shop | shop.yourdomain.com | LiteCart e-commerce |
| Admin | admin.yourdomain.com | Nginx Proxy Manager |
| n8n | n8n.yourdomain.com | Workflow automation |
| Release API | releases.yourdomain.com | App update delivery |
| Telemetry | telemetry.yourdomain.com | Usage analytics |
| Control Panel | app.yourdomain.com | Server management |

## Quick Install

```bash
cp .env.example .env
# Fill in .env values
docker compose up -d
```

## Requirements
- Ubuntu 22.04+
- Docker + Docker Compose
- Cloudflare account (tunnel + DNS)
- Domain name

## Subscription
250 SAR/month — activation key required.
Contact: support@carbonflows.store
