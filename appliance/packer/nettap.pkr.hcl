packer {
  required_version = ">= 1.15.4, < 2.0.0"
  required_plugins {
    virtualbox = {
      version = "= 1.1.5"
      source  = "github.com/hashicorp/virtualbox"
    }
    vmware = {
      version = "= 2.1.3"
      source  = "github.com/vmware/vmware"
    }
  }
}

variable "architecture" {
  type    = string
  default = "amd64"
  validation {
    condition     = contains(["amd64", "arm64"], var.architecture)
    error_message = "Architecture must be amd64 or arm64."
  }
}

variable "hypervisor" {
  type    = string
  default = "virtualbox"
  validation {
    condition     = contains(["virtualbox", "vmware"], var.hypervisor)
    error_message = "Hypervisor must be virtualbox or vmware."
  }
}

variable "release_version" {
  type    = string
  default = "0.4.0-rc.1"
}

variable "source_commit" {
  type    = string
  default = "0000000000000000000000000000000000000000"
}

variable "source_tree" {
  type    = string
  default = "0000000000000000000000000000000000000000"
}

variable "source_archive" {
  type    = string
  default = ".packer/nettap-source.tar.gz"
}

variable "source_archive_sha256" {
  type    = string
  default = "0000000000000000000000000000000000000000000000000000000000000000"
}

variable "output_directory" {
  type    = string
  default = "output"
}

variable "evidence_directory" {
  type    = string
  default = "evidence"
}

variable "apt_snapshot" {
  type    = string
  default = "20260801T000000Z"
}

variable "evaluation_vcpus" {
  type    = number
  default = 6
}

variable "evaluation_memory_mib" {
  type    = number
  default = 12288
}

variable "evaluation_disk_mib" {
  type    = number
  default = 122880
}

locals {
  iso_url                  = var.architecture == "arm64" ? "https://cdimage.ubuntu.com/ubuntu/releases/24.04.4/release/ubuntu-24.04.4-live-server-arm64.iso" : "https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-live-server-amd64.iso"
  iso_sha256               = var.architecture == "arm64" ? "9a6ce6d7e66c8abed24d24944570a495caca80b3b0007df02818e13829f27f32" : "e907d92eeec9df64163a7e454cbc8d7755e8ddc7ed42f99dbc80c40f1a138433"
  artifact_stem            = "nettap-ai-${var.release_version}-${var.hypervisor}-${var.architecture}"
  virtualbox_guest_os_type = var.architecture == "arm64" ? "Ubuntu24_LTS_arm64" : "Ubuntu24_LTS_64"
  vmware_guest_os_type     = var.architecture == "arm64" ? "arm-other-64" : "ubuntu-64"
  boot_command = [
    "c<wait>",
    "linux /casper/vmlinuz autoinstall ds='nocloud-net;s=http://{{ .HTTPIP }}:{{ .HTTPPort }}/' ---<enter><wait>",
    "initrd /casper/initrd<enter><wait>",
    "boot<enter>"
  ]
  build_environment = [
    "NETTAP_RELEASE_VERSION=${var.release_version}",
    "NETTAP_SOURCE_COMMIT=${var.source_commit}",
    "NETTAP_SOURCE_TREE=${var.source_tree}",
    "NETTAP_SOURCE_ARCHIVE_SHA256=${var.source_archive_sha256}",
    "NETTAP_ISO_URL=${local.iso_url}",
    "NETTAP_ISO_SHA256=${local.iso_sha256}",
    "NETTAP_APT_SNAPSHOT=${var.apt_snapshot}",
    "NETTAP_ARCHITECTURE=${var.architecture}",
    "NETTAP_HYPERVISOR=${var.hypervisor}"
  ]
}

source "virtualbox-iso" "nettap" {
  boot_command         = local.boot_command
  boot_wait            = "5s"
  chipset              = var.architecture == "arm64" ? "armv8" : "ich9"
  cpus                 = var.evaluation_vcpus
  disk_size            = var.evaluation_disk_mib
  format               = "ova"
  guest_additions_mode = "disable"
  guest_os_type        = local.virtualbox_guest_os_type
  hard_drive_interface = "sata"
  headless             = true
  http_directory       = "${path.root}/http"
  iso_checksum         = "sha256:${local.iso_sha256}"
  iso_interface        = "sata"
  iso_url              = local.iso_url
  memory               = var.evaluation_memory_mib
  output_directory     = var.output_directory
  output_filename      = local.artifact_stem
  shutdown_command     = "true"
  shutdown_timeout     = "15m"
  ssh_password         = "packer"
  ssh_timeout          = "45m"
  ssh_username         = "packer"
  vm_name              = local.artifact_stem
  vboxmanage = [
    ["modifyvm", "{{.Name}}", "--firmware", "efi"],
    ["modifyvm", "{{.Name}}", "--nictype1", "82540EM"]
  ]
  export_opts = [
    "--manifest",
    "--vsys", "0",
    "--description", "NetTAP Network Intelligence ${var.release_version} evaluation appliance",
    "--version", var.release_version
  ]
}

source "vmware-iso" "nettap" {
  boot_command         = local.boot_command
  boot_wait            = "5s"
  cpus                 = var.evaluation_vcpus
  disk_size            = var.evaluation_disk_mib
  format               = "ova"
  guest_os_type        = local.vmware_guest_os_type
  headless             = true
  http_directory       = "${path.root}/http"
  iso_checksum         = "sha256:${local.iso_sha256}"
  iso_url              = local.iso_url
  memory               = var.evaluation_memory_mib
  network              = "nat"
  network_adapter_type = "e1000e"
  output_directory     = var.output_directory
  shutdown_command     = "true"
  shutdown_timeout     = "15m"
  ssh_password         = "packer"
  ssh_timeout          = "45m"
  ssh_username         = "packer"
  version              = 21
  vm_name              = local.artifact_stem
  vmx_data = {
    "firmware" = "efi"
  }
}

build {
  name = "nettap-appliance"
  sources = [
    "source.virtualbox-iso.nettap",
    "source.vmware-iso.nettap"
  ]

  provisioner "file" {
    source      = var.source_archive
    destination = "/tmp/nettap-source.tar.gz"
  }

  provisioner "shell" {
    environment_vars = local.build_environment
    execute_command  = "chmod +x {{ .Path }}; sudo -E env {{ .Vars }} {{ .Path }}"
    script           = "${path.root}/scripts/install-appliance.sh"
  }

  provisioner "file" {
    direction   = "download"
    source      = "/etc/nettap/build-manifest.json"
    destination = "${var.evidence_directory}/${local.artifact_stem}.build-manifest.json"
  }

  provisioner "file" {
    direction   = "download"
    source      = "/etc/nettap/sbom.cdx.json"
    destination = "${var.evidence_directory}/${local.artifact_stem}.sbom.cdx.json"
  }

  provisioner "shell" {
    expect_disconnect = true
    execute_command   = "chmod +x {{ .Path }}; sudo {{ .Path }}"
    script            = "${path.root}/scripts/seal-appliance.sh"
  }
}
