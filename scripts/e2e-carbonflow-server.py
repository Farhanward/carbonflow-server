import json
import os
import sys
import textwrap

try:
    import paramiko
except ImportError:
    print("paramiko is required. Install it with: pip install paramiko", file=sys.stderr)
    sys.exit(2)


HOST = os.environ.get("CF_SSH_HOST", "192.168.100.59")
USER = os.environ.get("CF_SSH_USER", "root")
PASSWORD = os.environ.get("CF_SSH_PASS", "")
COMPOSE_DIR = os.environ.get("CF_REMOTE_COMPOSE_DIR", "/opt/carbonflow/compose")


REMOTE_SCRIPT = r"""
set -eu

pass() { printf 'PASS|%s|%s\n' "$1" "$2"; }
fail() { printf 'FAIL|%s|%s\n' "$1" "$2"; exit 1; }

cd "__COMPOSE_DIR__" || fail compose_dir "missing compose directory"

docker --version >/dev/null 2>&1 && pass docker "docker cli available" || fail docker "docker cli missing"
docker compose version >/dev/null 2>&1 && pass compose "docker compose available" || fail compose "docker compose missing"
docker compose config --quiet && pass compose_config "docker compose config valid" || fail compose_config "docker compose config invalid"

required_containers="
carbonflow-control-panel
carbonflow-release-api
carbonflow-telemetry-api
carbonflow-litecart
carbonflow-litecart-db
carbonflow-n8n
carbonflow-npm
carbonflow-npm-db
carbonflow-cloudflared
carbonflow-crowdsec
carbonflow-ollama
carbonflow-cloakbrowser
"

for container in $required_containers; do
  running="$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)"
  [ "$running" = "true" ] && pass "container:$container" "running" || fail "container:$container" "not running"
done

for container in carbonflow-litecart-db carbonflow-npm-db; do
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
  [ "$health" = "healthy" ] && pass "health:$container" "healthy" || fail "health:$container" "health=$health"
done

cp_unauth="$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8088 || true)"
[ "$cp_unauth" = "401" ] && pass control_panel_auth "unauthenticated request rejected" || fail control_panel_auth "expected 401 got $cp_unauth"

cp_user="$(grep -E '^CONTROL_PANEL_USER=' .env | head -1 | cut -d= -f2-)"
cp_pass="$(grep -E '^CONTROL_PANEL_PASSWORD=' .env | head -1 | cut -d= -f2-)"
cp_auth="$(curl -fsS -u "$cp_user:$cp_pass" -o /tmp/carbonflow-control-panel.html -w '%{http_code}' http://127.0.0.1:8088 || true)"
[ "$cp_auth" = "200" ] && pass control_panel_login "authenticated panel reachable" || fail control_panel_login "expected 200 got $cp_auth"

docker exec carbonflow-control-panel node -e "fetch('http://release-api:3010/health').then(async r=>{const t=await r.text(); if(!r.ok) throw new Error(t); console.log(t)}).catch(e=>{console.error(e.message); process.exit(1)})" >/tmp/release-health.json
grep -q 'carbonflow-release-api' /tmp/release-health.json && pass release_api_health "health endpoint ok" || fail release_api_health "bad response"

docker exec carbonflow-control-panel node -e "fetch('http://release-api:3010/v1/apps/carbonledger/latest?version=0.0.0').then(async r=>{const j=await r.json(); if(!j.ok) throw new Error(JSON.stringify(j)); console.log(JSON.stringify(j))}).catch(e=>{console.error(e.message); process.exit(1)})" >/tmp/release-latest.json
grep -q '"ok":true' /tmp/release-latest.json && pass release_api_latest "latest endpoint ok" || fail release_api_latest "bad latest response"

docker exec carbonflow-control-panel node -e "fetch('http://telemetry-api:3000/health').then(async r=>{const t=await r.text(); if(!r.ok) throw new Error(t); console.log(t)}).catch(e=>{console.error(e.message); process.exit(1)})" >/tmp/telemetry-health.json
grep -q 'carbonflow-telemetry-api' /tmp/telemetry-health.json && pass telemetry_health "health endpoint ok" || fail telemetry_health "bad response"

telemetry_token="$(grep -E '^TELEMETRY_TOKEN=' .env | head -1 | cut -d= -f2-)"
docker exec -e TELEMETRY_TOKEN="$telemetry_token" carbonflow-control-panel node -e "fetch('http://telemetry-api:3000/v1/logs',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+process.env.TELEMETRY_TOKEN},body:JSON.stringify({appName:'e2e-carbonflow-server',clientId:'lan-smoke',severity:'info',version:'e2e',platform:'server',message:'E2E telemetry smoke test',context:{source:'codex'}})}).then(async r=>{const t=await r.text(); if(r.status!==202) throw new Error(r.status+' '+t); console.log(t)}).catch(e=>{console.error(e.message); process.exit(1)})" >/tmp/telemetry-post.json
grep -q '"ok":true' /tmp/telemetry-post.json && pass telemetry_ingest "authenticated log accepted" || fail telemetry_ingest "bad telemetry response"

docker exec carbonflow-control-panel node -e "fetch('http://n8n:5678/').then(r=>{if(r.status < 200 || r.status >= 500) throw new Error('status '+r.status); console.log('status='+r.status)}).catch(e=>{console.error(e.message); process.exit(1)})" >/tmp/n8n-http.txt
pass n8n_http "$(cat /tmp/n8n-http.txt)"

printf 'SUMMARY|carbonflow-server|E2E PASS\n'
"""


def main() -> int:
    if not PASSWORD:
        print("CF_SSH_PASS is required and was not saved in source.", file=sys.stderr)
        return 2

    script = REMOTE_SCRIPT.replace("__COMPOSE_DIR__", COMPOSE_DIR.replace('"', '\\"'))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, username=USER, password=PASSWORD, timeout=15)
    try:
        _, stdout, stderr = client.exec_command("sh -s", timeout=180)
        stdout.channel.sendall(script)
        stdout.channel.shutdown_write()
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
    finally:
        client.close()

    results = []
    for line in out.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and parts[0] in {"PASS", "FAIL", "SUMMARY"}:
            results.append({"status": parts[0], "check": parts[1], "detail": parts[2]})
        else:
            print(line)

    print(json.dumps({"host": HOST, "composeDir": COMPOSE_DIR, "results": results}, indent=2, ensure_ascii=False))
    if err.strip():
        print(err, file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
