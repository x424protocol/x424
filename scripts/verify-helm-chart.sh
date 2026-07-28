#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chart_dir="$repo_root/deploy/verifier/helm"
helm3_image="${HELM3_IMAGE:-alpine/helm:3.21.0@sha256:626f82264aa9b9ab9e232eb94e8c240bcc373bff7a29a20c848105e3a6f64b0e}"
helm4_image="${HELM4_IMAGE:-alpine/helm:4.2.0@sha256:af08f75a3130d666a50b9fc150f40987ef20b885cf67659aabf4b83a5f2c5501}"
kubeconform_image="${KUBECONFORM_IMAGE:-ghcr.io/yannh/kubeconform:v0.7.0@sha256:85dbef6b4b312b99133decc9c6fc9495e9fc5f92293d4ff3b7e1b30f5611823c}"

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/x424-helm.XXXXXX")"
trap 'rm -rf -- "$temp_dir"' EXIT

cd "$repo_root"

run_helm_image() {
  local image="$1"
  shift
  local container
  local container_status
  local start_status=0
  local arg
  local -a container_args=()

  for arg in "$@"; do
    if [[ "$arg" == "$chart_dir" ]]; then
      container_args+=("/chart")
    else
      container_args+=("$arg")
    fi
  done

  container="$(docker create "$image" "${container_args[@]}")"
  docker cp "$chart_dir" "$container:/chart"
  docker start --attach "$container" || start_status=$?
  container_status="$(docker inspect --format '{{.State.ExitCode}}' "$container")"
  docker rm "$container" >/dev/null

  if ((start_status != 0)); then
    return "$start_status"
  fi
  return "$container_status"
}

run_helm() {
  if command -v docker >/dev/null 2>&1; then
    run_helm_image "$helm3_image" "$@"
  elif command -v helm >/dev/null 2>&1; then
    helm "$@"
  else
    echo "Helm 3 or Docker is required to validate the chart." >&2
    return 1
  fi
}

run_kubeconform() {
  if command -v docker >/dev/null 2>&1; then
    docker run --rm --interactive "$kubeconform_image" "$@"
  elif command -v kubeconform >/dev/null 2>&1; then
    kubeconform "$@"
  else
    echo "Kubeconform or Docker is required to validate rendered resources." >&2
    return 1
  fi
}

package_version="$(node -p "require('./package.json').version")"
chart_metadata="$(run_helm show chart "$chart_dir")"
chart_version="$(awk '$1 == "version:" { print $2 }' <<<"$chart_metadata")"
app_version="$(awk '$1 == "appVersion:" { gsub(/\"/, "", $2); print $2 }' <<<"$chart_metadata")"

if [[ "$chart_version" != "$package_version" || "$app_version" != "$package_version" ]]; then
  echo "Chart version ($chart_version/$app_version) must match package version $package_version." >&2
  exit 1
fi

run_helm lint --strict "$chart_dir"
run_helm template x424-ci "$chart_dir" \
  --namespace x424-ci >"$temp_dir/default.yaml"
run_helm template x424-ci-restricted "$chart_dir" \
  --namespace x424-ci \
  --set config.deploymentProfile=prod-ha-0.2 \
  --set-string image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set 'networkPolicy.dnsCidrs[0]=10.96.0.10/32' \
  --set 'networkPolicy.worldCidrs[0]=203.0.113.0/24' \
  --set 'networkPolicy.redisCidrs[0]=10.0.0.0/8' \
  >"$temp_dir/restricted-egress.yaml"
run_helm template x424-ci-minimal "$chart_dir" \
  --namespace x424-ci \
  --set networkPolicy.enabled=false \
  --set podDisruptionBudget.enabled=false \
  >"$temp_dir/minimal.yaml"

if command -v docker >/dev/null 2>&1; then
  run_helm_image "$helm4_image" lint --strict "$chart_dir"
  run_helm_image "$helm4_image" template x424-ci-helm4 "$chart_dir" \
    --namespace x424-ci >"$temp_dir/helm4.yaml"
fi

for kubernetes_version in 1.25.0 1.31.0; do
  for manifest in default restricted-egress minimal; do
    run_kubeconform \
      -strict \
      -summary \
      -kubernetes-version "$kubernetes_version" \
      - <"$temp_dir/$manifest.yaml"
  done
done
if [[ -f "$temp_dir/helm4.yaml" ]]; then
  run_kubeconform \
    -strict \
    -summary \
    -kubernetes-version 1.31.0 \
    - <"$temp_dir/helm4.yaml"
fi

expected_image="ghcr.io/x424protocol/x424-verifier:${package_version}"
grep -F "image: \"$expected_image\"" "$temp_dir/default.yaml" >/dev/null
if [[ -f "$temp_dir/helm4.yaml" ]]; then
  grep -F "image: \"$expected_image\"" "$temp_dir/helm4.yaml" >/dev/null
fi
grep -F "port: 53" "$temp_dir/default.yaml" >/dev/null
grep -F "cidr: \"10.96.0.10/32\"" "$temp_dir/restricted-egress.yaml" >/dev/null
grep -F "cidr: \"203.0.113.0/24\"" "$temp_dir/restricted-egress.yaml" >/dev/null
grep -F "cidr: \"10.0.0.0/8\"" "$temp_dir/restricted-egress.yaml" >/dev/null
grep -A1 -F "name: X424_TRUST_PROXY_HOPS" "$temp_dir/default.yaml" |
  grep -F 'value: "0"' >/dev/null
if grep -Eq '^kind: (NetworkPolicy|PodDisruptionBudget)$' "$temp_dir/minimal.yaml"; then
  echo "Disabled optional resources were still rendered." >&2
  exit 1
fi

if run_helm template x424-ci-invalid "$chart_dir" \
  --set replicaCount=2 >"$temp_dir/invalid.yaml" 2>"$temp_dir/invalid.log"; then
  echo "The chart accepted an unsafe multi-replica World handoff deployment." >&2
  exit 1
fi

grep -F "value must be 1" "$temp_dir/invalid.log" >/dev/null

if run_helm template x424-ci-unsafe-prod "$chart_dir" \
  --set config.deploymentProfile=prod-ha-0.2 \
  --set-string image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  >"$temp_dir/unsafe-prod.yaml" 2>"$temp_dir/unsafe-prod.log"; then
  echo "The chart accepted production with unrestricted egress." >&2
  exit 1
fi

grep -F "requires non-empty networkPolicy.dnsCidrs, worldCidrs, and redisCidrs" \
  "$temp_dir/unsafe-prod.log" >/dev/null

if run_helm template x424-ci-unsafe-tag "$chart_dir" \
  --set config.deploymentProfile=prod-ha-0.2 \
  --set 'networkPolicy.dnsCidrs[0]=10.96.0.10/32' \
  --set 'networkPolicy.worldCidrs[0]=203.0.113.0/24' \
  --set 'networkPolicy.redisCidrs[0]=10.0.0.0/8' \
  >"$temp_dir/unsafe-tag.yaml" 2>"$temp_dir/unsafe-tag.log"; then
  echo "The chart accepted a mutable production image tag." >&2
  exit 1
fi

grep -F "requires image.digest; mutable image tags are forbidden" \
  "$temp_dir/unsafe-tag.log" >/dev/null
echo "helm verification ok: Helm 3/4 lint, values schema, render variants, restricted production egress, proxy boundary, HA guard, Kubernetes schemas"
