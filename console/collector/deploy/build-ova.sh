#!/usr/bin/env bash
# =============================================================================
# Build a deployable AMDAI appliance VM image (OVA) on a Debian 12 base.
#
# Primary path: HashiCorp Packer with the qemu builder, producing an OVA via
# a Debian 12 cloud image + cloud-init first-boot provisioning that runs
# install-linux.sh and waits for console pairing.
#
# Fallback path (no Packer available): drives virt-install/qemu-img directly
# to build an equivalent qcow2/OVA using the same cloud-init user-data, for
# hosts that only have libvirt/qemu tooling.
#
# The resulting image is sized (disk + a recommended VM shape hint baked
# into cloud-init MOTD) according to the requested capacity profile; actual
# vCPU/RAM are set by whoever imports/deploys the OVA, since Packer/qemu
# builders don't control the eventual hypervisor's allocation.
#
# Usage:
#   ./build-ova.sh --profile medium [--output ./out] [--builder auto|packer|virt-install]
#
# Flags:
#   --profile <small|medium|large|xl>     Capacity profile to size disk/MOTD for (default: medium)
#   --output <dir>                        Output directory for the built image (default: ./dist)
#   --builder <auto|packer|virt-install>  Force a build path (default: auto)
#   --console-url <url>                   Baked into cloud-init as a default AMDAI_CONSOLE_URL
#   -h|--help                             Show this help
#
# Requires network access to fetch the Debian 12 generic cloud image unless
# DEBIAN_CLOUD_IMAGE_PATH already points at a cached copy.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
DEBIAN_CLOUD_IMAGE_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
WORK_DIR=""

PROFILE="medium"
OUTPUT_DIR="./dist"
BUILDER="auto"
CONSOLE_URL=""

log()  { printf '[amdai-ova] %s\n' "$*"; }
err()  { printf '[amdai-ova][ERROR] %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) PROFILE="${2:-}"; shift 2 ;;
      --output) OUTPUT_DIR="${2:-}"; shift 2 ;;
      --builder) BUILDER="${2:-}"; shift 2 ;;
      --console-url) CONSOLE_URL="${2:-}"; shift 2 ;;
      -h|--help)
        grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *) die "Unknown argument: $1" ;;
    esac
  done
}

validate_profile() {
  case "${PROFILE}" in
    small|medium|large|xl) ;;
    *) die "Invalid --profile '${PROFILE}' (expected small|medium|large|xl)" ;;
  esac
}

# Disk sizing mirrors src/lib/capacity.ts CAPACITY_PROFILES[*].requires.disk_gb,
# rounded up slightly to leave headroom for the OS + ring buffer.
disk_gb_for_profile() {
  case "${PROFILE}" in
    small)  echo 120 ;;
    medium) echo 1100 ;;
    large)  echo 2200 ;;
    xl)     echo 4400 ;;
  esac
}

# vCPU/RAM hint only — bakes a MOTD reminder; the actual allocation is set
# by whoever imports the OVA into their hypervisor.
shape_hint_for_profile() {
  case "${PROFILE}" in
    small)  echo "4 vCPU / 8 GB RAM" ;;
    medium) echo "8 vCPU / 32 GB RAM" ;;
    large)  echo "16 vCPU / 64 GB RAM" ;;
    xl)     echo "32 vCPU / 128 GB RAM" ;;
  esac
}

pick_builder() {
  if [ "${BUILDER}" != "auto" ]; then
    return 0
  fi
  if command -v packer >/dev/null 2>&1; then
    BUILDER="packer"
  elif command -v virt-install >/dev/null 2>&1 && command -v qemu-img >/dev/null 2>&1; then
    BUILDER="virt-install"
  else
    die "Neither 'packer' nor 'virt-install'+'qemu-img' found. Install one of them:
  Packer:       https://developer.hashicorp.com/packer/install
  virt-install: apt-get install virtinst libvirt-daemon-system qemu-utils qemu-system-x86"
  fi
}

write_cloud_init() {
  local ci_dir="$1" disk_gb="$2" shape_hint="$3"
  mkdir -p "${ci_dir}"
  cat > "${ci_dir}/meta-data" <<-EOF
	instance-id: amdai-appliance-${PROFILE}
	local-hostname: amdai-collector
	EOF

  # First-boot: run install-linux.sh unattended with the baked-in profile,
  # print pairing instructions to the console/MOTD. The console URL/token
  # are supplied at first login (or via cloud-init instance-data override)
  # rather than baked permanently, so one OVA image serves any customer.
  cat > "${ci_dir}/user-data" <<-EOF
	#cloud-config
	hostname: amdai-collector
	fqdn: amdai-collector.local
	package_update: true
	package_upgrade: false
	write_files:
	  - path: /opt/amdai-pairing/pair.sh
	    permissions: '0755'
	    content: |
	      #!/usr/bin/env bash
	      set -euo pipefail
	      echo "AMDAI appliance first-boot pairing (profile: ${PROFILE}, recommended ${shape_hint})"
	      read -r -p "Console URL [${CONSOLE_URL}]: " console_url
	      console_url="\${console_url:-${CONSOLE_URL}}"
	      read -r -p "Pairing token: " token
	      /opt/amdai/deploy/install-linux.sh --profile ${PROFILE} --unattended \\
	        --console-url "\${console_url}" --token "\${token}"
	  - path: /etc/motd
	    content: |
	      ==============================================================
	      AMDAI collector appliance (profile: ${PROFILE})
	      Recommended VM shape: ${shape_hint}, ${disk_gb} GB disk
	      Run: sudo /opt/amdai-pairing/pair.sh
	      to finish pairing with your AMDAI console.
	      ==============================================================
	runcmd:
	  - [ mkdir, -p, /opt/amdai ]
	  - [ rsync, -a, /opt/amdai-src/, /opt/amdai/ ]
	growpart:
	  mode: auto
	  devices: ['/']
	resize_rootfs: true
	EOF
}

build_with_packer() {
  local disk_gb="$1" shape_hint="$2"
  WORK_DIR="$(mktemp -d)"
  trap 'rm -rf "${WORK_DIR}"' EXIT

  local ci_dir="${WORK_DIR}/cloud-init"
  write_cloud_init "${ci_dir}" "${disk_gb}" "${shape_hint}"

  cp -a "${SCRIPT_DIR}/.." "${WORK_DIR}/amdai-src"

  cat > "${WORK_DIR}/amdai.pkr.hcl" <<-EOF
	packer {
	  required_plugins {
	    qemu = {
	      version = ">= 1.1.0"
	      source  = "github.com/hashicorp/qemu"
	    }
	  }
	}

	variable "profile" { type = string, default = "${PROFILE}" }
	variable "disk_gb" { type = number, default = ${disk_gb} }

	source "qemu" "amdai" {
	  iso_url          = "${DEBIAN_CLOUD_IMAGE_URL}"
	  iso_checksum     = "none"
	  disk_image       = true
	  output_directory = "${OUTPUT_DIR}/packer-build-${PROFILE}"
	  format           = "qcow2"
	  disk_size        = "\${var.disk_gb}G"
	  accelerator      = "kvm"
	  cpus             = 2
	  memory           = 2048
	  headless         = true
	  ssh_username     = "debian"
	  ssh_timeout      = "10m"
	  qemuargs = [
	    ["-cdrom", "${WORK_DIR}/seed.iso"]
	  ]
	  vm_name = "amdai-collector-${PROFILE}"
	}

	build {
	  sources = ["source.qemu.amdai"]

	  provisioner "shell" {
	    inline = [
	      "sudo mkdir -p /opt/amdai-src",
	      "sudo mkdir -p /opt/amdai-pairing"
	    ]
	  }
	  provisioner "file" {
	    source      = "${WORK_DIR}/amdai-src/"
	    destination = "/tmp/amdai-src"
	  }
	  provisioner "shell" {
	    inline = [
	      "sudo rsync -a /tmp/amdai-src/ /opt/amdai-src/",
	      "sudo chmod +x /opt/amdai-src/deploy/*.sh"
	    ]
	  }

	  post-processor "shell-local" {
	    inline = [
	      "qemu-img convert -O vmdk ${OUTPUT_DIR}/packer-build-${PROFILE}/*.qcow2 ${OUTPUT_DIR}/amdai-collector-${PROFILE}.vmdk || true"
	    ]
	  }
	}
	EOF

  command -v genisoimage >/dev/null 2>&1 && \
    genisoimage -output "${WORK_DIR}/seed.iso" -volid cidata -joliet -rock "${ci_dir}/user-data" "${ci_dir}/meta-data" || \
    log "genisoimage not found; the packer build's qemuargs cdrom seed may be empty. Install genisoimage/cloud-image-utils."

  mkdir -p "${OUTPUT_DIR}"
  log "Running: packer build (Debian 12, profile ${PROFILE}, ${disk_gb} GB disk)"
  ( cd "${WORK_DIR}" && packer init amdai.pkr.hcl 2>/dev/null || true; packer build amdai.pkr.hcl )
  log "Packer build complete. Output under ${OUTPUT_DIR}/packer-build-${PROFILE}/"
}

build_with_virt_install() {
  local disk_gb="$1" shape_hint="$2"
  WORK_DIR="$(mktemp -d)"
  trap 'rm -rf "${WORK_DIR}"' EXIT

  command -v virt-install >/dev/null 2>&1 || die "virt-install not found."
  command -v qemu-img >/dev/null 2>&1 || die "qemu-img not found."
  command -v genisoimage >/dev/null 2>&1 || command -v cloud-localds >/dev/null 2>&1 || \
    die "Need genisoimage or cloud-localds (cloud-image-utils) to build the cloud-init seed ISO."

  mkdir -p "${OUTPUT_DIR}"
  local base_image="${OUTPUT_DIR}/debian-12-base.qcow2"
  local disk_image="${OUTPUT_DIR}/amdai-collector-${PROFILE}.qcow2"
  local seed_iso="${WORK_DIR}/seed.iso"
  local ci_dir="${WORK_DIR}/cloud-init"

  if [ ! -f "${base_image}" ]; then
    log "Downloading Debian 12 generic cloud image."
    curl -fsSL -o "${base_image}" "${DEBIAN_CLOUD_IMAGE_URL}"
  fi

  write_cloud_init "${ci_dir}" "${disk_gb}" "${shape_hint}"
  if command -v cloud-localds >/dev/null 2>&1; then
    cloud-localds "${seed_iso}" "${ci_dir}/user-data" "${ci_dir}/meta-data"
  else
    genisoimage -output "${seed_iso}" -volid cidata -joliet -rock "${ci_dir}/user-data" "${ci_dir}/meta-data"
  fi

  log "Resizing base image copy to ${disk_gb}G for profile ${PROFILE}."
  cp "${base_image}" "${disk_image}"
  qemu-img resize "${disk_image}" "${disk_gb}G"

  log "Creating transient VM via virt-install to run first-boot provisioning."
  local shape
  case "${PROFILE}" in
    small)  shape="--vcpus 4 --memory 8192" ;;
    medium) shape="--vcpus 8 --memory 32768" ;;
    large)  shape="--vcpus 16 --memory 65536" ;;
    xl)     shape="--vcpus 32 --memory 131072" ;;
  esac

  # shellcheck disable=SC2086
  virt-install \
    --name "amdai-build-${PROFILE}" \
    ${shape} \
    --disk path="${disk_image}",format=qcow2 \
    --disk path="${seed_iso}",device=cdrom \
    --os-variant debian12 \
    --import \
    --graphics none \
    --noautoconsole \
    --wait -1 || log "virt-install returned non-zero; inspect the domain console/logs before shipping this image."

  virsh undefine "amdai-build-${PROFILE}" --nvram 2>/dev/null || true
  log "Image ready: ${disk_image} (convert to OVA/VMDK with 'qemu-img convert -O vmdk' if your hypervisor needs it)."
}

main() {
  parse_args "$@"
  validate_profile
  local disk_gb shape_hint
  disk_gb="$(disk_gb_for_profile)"
  shape_hint="$(shape_hint_for_profile)"
  pick_builder
  log "Builder: ${BUILDER}; profile: ${PROFILE}; disk: ${disk_gb} GB; shape hint: ${shape_hint}"

  case "${BUILDER}" in
    packer) build_with_packer "${disk_gb}" "${shape_hint}" ;;
    virt-install) build_with_virt_install "${disk_gb}" "${shape_hint}" ;;
    *) die "Unknown builder '${BUILDER}'" ;;
  esac
}

main "$@"
