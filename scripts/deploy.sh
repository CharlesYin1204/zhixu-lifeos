#!/usr/bin/env bash
set -Eeuo pipefail
cd /www/wwwroot/xuexi
export PATH=/opt/laosiji-runtime/node-v22.16.0-linux-x64/bin:/usr/bin:/bin
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS=--max-old-space-size=700

[[ ${EUID} -eq 0 ]] || { echo 'Run deployment as root.' >&2; exit 1; }
[[ $# -eq 0 || ( $# -eq 1 && ${1:-} == --rollback ) ]] || { echo 'Usage: bash scripts/deploy.sh [--rollback]' >&2; exit 1; }
exec 9>private/deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }

nginx_bin=/www/server/nginx/sbin/nginx
nginx_main=/www/server/nginx/conf/nginx.conf
nginx_site=/www/server/panel/vhost/nginx/zhixu.conf
nginx_https_site=/www/server/panel/vhost/nginx/zhixu-https.conf
nginx_domain_site=/www/server/panel/vhost/nginx/xuexi.yinchao1204.vip.conf
https_enabled=0
[[ ! -f deploy/zhixu-https.conf ]] || https_enabled=1
domain_enabled=0
[[ ! -f deploy/zhixu-domain.conf ]] || domain_enabled=1
runtime_env=private/web-runtime.env
previous_env=private/web-previous.env
candidate_env=private/web-candidate.env
deployment_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
state="private/deploy-${deployment_id}"

read_release() {
  if [[ -f $1 ]]; then sed -n 's/^NEXT_DIST_DIR=//p' "$1" | tail -n 1; else printf '%s\n' '.next'; fi
}
valid_release() { [[ $1 == .next || $1 =~ ^\.releases/[a-zA-Z0-9._-]+$ ]]; }
write_env() {
  local destination=$1 release=$2
  (umask 077; printf 'NEXT_DIST_DIR=%s\n' "$release" >"${destination}.tmp")
  mv -f "${destination}.tmp" "$destination"
}
health() {
  local port=$1
  local origin=${2:-http://127.0.0.1:${port}}
  for attempt in {1..30}; do
    if curl --fail --silent --max-time 5 "${origin}/api/app?resource=health" |
      node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{const d=JSON.parse(s);process.exit(d.ok===true&&d.database==="connected"?0:1)}catch{process.exit(1)}})'; then
      curl --fail --silent --max-time 5 "${origin}/" >/dev/null && return 0
    fi
    sleep 1
  done
  return 1
}
switch_nginx() {
  local port=$1
  sed "s#proxy_pass http://127.0.0.1:3061;#proxy_pass http://127.0.0.1:${port};#" deploy/zhixu-nginx.conf >"${state}/nginx-next.conf"
  install -m 644 "${state}/nginx-next.conf" "$nginx_site"
  if [[ $https_enabled -eq 1 ]]; then
    sed "s#proxy_pass http://127.0.0.1:3061;#proxy_pass http://127.0.0.1:${port};#" deploy/zhixu-https.conf >"${state}/nginx-https-next.conf"
    install -m 644 "${state}/nginx-https-next.conf" "$nginx_https_site"
  fi
  if [[ $domain_enabled -eq 1 ]]; then
    sed "s#proxy_pass http://127.0.0.1:3061;#proxy_pass http://127.0.0.1:${port};#" deploy/zhixu-domain.conf >"${state}/nginx-domain-next.conf"
    install -m 644 "${state}/nginx-domain-next.conf" "$nginx_domain_site"
  fi
  "$nginx_bin" -t -c "$nginx_main"
  "$nginx_bin" -s reload -c "$nginx_main"
}

current_release=$(read_release "$runtime_env")
valid_release "$current_release" && [[ -s $current_release/BUILD_ID ]] || { echo 'Current release metadata is invalid; refusing to replace it.' >&2; exit 1; }
if [[ ${1:-} == --rollback ]]; then
  [[ -s $previous_env ]] || { echo 'No previous successful release is recorded.' >&2; exit 1; }
  target_release=$(read_release "$previous_env")
  valid_release "$target_release" && [[ -s $target_release/BUILD_ID ]] || { echo 'Previous release is missing.' >&2; exit 1; }
else
  target_release=".releases/${deployment_id}"
fi
if systemctl is-active --quiet zhixu-web-candidate || [[ -n $(ss -ltnH '( sport = :3062 )') ]]; then
  echo 'Port 3062 or the candidate service is already in use; inspect it before deploying.' >&2
  exit 1
fi

install -d -m 755 .releases .static-archive
install -d -m 700 "$state"
cp -a "$nginx_site" "${state}/nginx-before.conf"
if [[ $https_enabled -eq 1 && -f $nginx_https_site ]]; then cp -a "$nginx_https_site" "${state}/nginx-https-before.conf"; fi
if [[ $domain_enabled -eq 1 && -f $nginx_domain_site ]]; then cp -a "$nginx_domain_site" "${state}/nginx-domain-before.conf"; fi
cp -a /etc/systemd/system/zhixu-web.service "${state}/web-before.service"
if [[ -f $runtime_env ]]; then cp -a "$runtime_env" "${state}/runtime-before.env"; fi
write_env "${state}/release-before.env" "$current_release"
write_env "${state}/release-target.env" "$target_release"

# Build into a new directory. The serving release and worker remain untouched.
if [[ ${1:-} != --rollback ]]; then
  echo "Building ${target_release}; current release remains ${current_release}."
  NEXT_DIST_DIR="$target_release" npm run build
fi
[[ -s $target_release/BUILD_ID && -d $target_release/static ]] || { echo 'Candidate build artifacts are incomplete.' >&2; exit 1; }
chown -R zhixu:zhixu "$target_release"
cp -a "$current_release/static/." .static-archive/
cp -a "$target_release/static/." .static-archive/
chmod -R a+rX .static-archive

canonical_switched=0
nginx_changed=0
candidate_started=0
rollback_on_error() {
  local code=$1 line=$2 recovered=1
  trap - ERR INT TERM
  set +e
  echo "Deployment failed at line ${line}; attempting rollback to ${current_release}." >&2
  install -m 644 "${state}/web-before.service" /etc/systemd/system/zhixu-web.service || recovered=0
  if [[ -f ${state}/runtime-before.env ]]; then
    install -m 600 "${state}/runtime-before.env" "${runtime_env}.tmp" && mv -f "${runtime_env}.tmp" "$runtime_env" || recovered=0
  else
    rm -f "$runtime_env" || recovered=0
  fi
  systemctl daemon-reload || recovered=0
  if [[ $canonical_switched -eq 1 ]]; then systemctl restart zhixu-web.service && health 3061 || recovered=0; fi
  if [[ $recovered -eq 1 && $nginx_changed -eq 1 ]]; then
    install -m 644 "${state}/nginx-before.conf" "$nginx_site" || recovered=0
    if [[ $https_enabled -eq 1 ]]; then
      if [[ -f ${state}/nginx-https-before.conf ]]; then
        install -m 644 "${state}/nginx-https-before.conf" "$nginx_https_site" || recovered=0
      else
        rm -f "$nginx_https_site" || recovered=0
      fi
    fi
    if [[ $domain_enabled -eq 1 ]]; then
      if [[ -f ${state}/nginx-domain-before.conf ]]; then
        install -m 644 "${state}/nginx-domain-before.conf" "$nginx_domain_site" || recovered=0
      else
        rm -f "$nginx_domain_site" || recovered=0
      fi
    fi
    "$nginx_bin" -t -c "$nginx_main" && "$nginx_bin" -s reload -c "$nginx_main" || recovered=0
  fi
  if [[ $recovered -eq 1 ]]; then
    [[ $candidate_started -eq 0 ]] || systemctl stop zhixu-web-candidate.service
    echo "Previous deployment restored. Diagnostic state: ${state}" >&2
  else
    echo "Automatic rollback could not restore health. Candidate is retained; inspect ${state} and both web services before changing nginx." >&2
  fi
  exit "$code"
}
trap 'rollback_on_error $? "$LINENO"' ERR
trap 'rollback_on_error 130 "$LINENO"' INT
trap 'rollback_on_error 143 "$LINENO"' TERM

install -m 644 deploy/zhixu-web.service /etc/systemd/system/zhixu-web.service
install -m 644 deploy/zhixu-web-candidate.service /etc/systemd/system/zhixu-web-candidate.service
write_env "$candidate_env" "$target_release"
systemctl daemon-reload
candidate_started=1
systemctl start zhixu-web-candidate.service
health 3062
echo 'Candidate is healthy on 3062; switching nginx before replacing the canonical web process.'
nginx_changed=1
switch_nginx 3062
health 3060
if [[ $https_enabled -eq 1 ]]; then health 3063 https://154.40.47.111:3063; fi
if [[ $domain_enabled -eq 1 ]]; then health 443 https://xuexi.yinchao1204.vip; fi

write_env "$runtime_env" "$target_release"
canonical_switched=1
systemctl restart zhixu-web.service
health 3061
switch_nginx 3061
health 3060
if [[ $https_enabled -eq 1 ]]; then health 3063 https://154.40.47.111:3063; fi
if [[ $domain_enabled -eq 1 ]]; then health 443 https://xuexi.yinchao1204.vip; fi
systemctl stop zhixu-web-candidate.service
candidate_started=0
write_env "$previous_env" "$current_release"
trap - ERR INT TERM
echo "Published ${target_release}; previous release ${current_release} is retained."
echo 'The multi-agent worker was not restarted. Roll back with: bash scripts/deploy.sh --rollback'
