packer {
  required_version = ">= 1.11.0"
  required_plugins {
    virtualbox = {
      version = ">= 1.1.3, < 2.0.0"
      source  = "github.com/hashicorp/virtualbox"
    }
    vmware = {
      version = ">= 1.1.0, < 2.0.0"
      source  = "github.com/hashicorp/vmware"
    }
  }
}

variable "release_version" {
  type    = string
  default = "0.4.0-rc.1"
}

variable "architecture" {
  type    = string
  default = "amd64"
  validation {
    condition     = contains(["amd64", "arm64"], var.architecture)
    error_message = "architecture must be amd64 or arm64"
  }
}

variable "ubuntu_iso_url" {
  type    = string
  default = "https://releases.ubuntu.com/24.04/ubuntu-24.04.4-live-server-amd64.iso"
}

variable "ubuntu_iso_checksum" {
  type    = string
  default = "sha256:e907d92eeec9df64163a7e454cbc8d7755e8ddc7ed42f99dbc80c40f1a138433"
}

variable "virtualbox_guest_os_type" {
  type    = string
  default = "Ubuntu_64"
}

variable "vmware_guest_os_type" {
  type    = string
  default = "ubuntu-64"
}

variable "source_archive" {
  type    = string
  default = "build/nettap-source.tar.gz"
}

variable "source_commit" {
  type    = string
  default = "unknown"
}

variable "build_password" {
  type      = string
  sensitive = true
}

variable "build_password_hash" {
  type      = string
  sensitive = true
}

variable "cpus" {
  type    = number
  default = 6
}

variable "memory_mb" {
  type    = number
  default = 12288
}

variable "disk_mb" {
  type    = number
  default = 122880
}

locals {
  appliance_name = "nettap-ai-${var.release_version}-${var.architecture}"
  build_user      = "packer"
  boot_command = [
    "<wait3><esc><wait>",
    "e<wait>",
    "<down><down><down><end>",
    " autoinstall ds=nocloud-net\\;s=http://{{ .HTTPIP }}:{{ .HTTPPort }}/",
    "<f10><wait>",
  ]
  cd_content = {
    "meta-data" = "instance-id: nettap-packer\nlocal-hostname: nettap-ai\n"
    "user-data" = templatefile("${path.root}/http/user-data.pkrtpl", {
      hostname      = "nettap-ai"
      build_user    = local.build_user
      password_hash = var.build_password_hash
    })
  }
}

source "virtualbox-iso" "target" {
  vm_name              = "${local.appliance_name}-virtualbox"
  guest_os_type        = var.virtualbox_guest_os_type
  iso_url              = var.ubuntu_iso_url
  iso_checksum         = var.ubuntu_iso_checksum
  format               = "ova"
  output_directory     = "output/virtualbox-${var.architecture}"
  output_filename      = "${local.appliance_name}-virtualbox"
  headless             = true
  cpus                 = var.cpus
  memory               = var.memory_mb
  disk_size            = var.disk_mb
  hard_drive_interface = "sata"
  iso_interface        = "sata"
  rtc_time_base        = "UTC"
  guest_additions_mode = "disable"
  http_directory       = "${path.root}/http"
  cd_content           = local.cd_content
  cd_label             = "cidata"
  boot_command         = local.boot_command
  boot_wait            = "5s"
  ssh_username         = local.build_user
  ssh_password         = var.build_password
  ssh_timeout          = "45m"
  shutdown_command     = "echo '${var.build_password}' | sudo -S shutdown -P now"
  shutdown_timeout     = "15m"
  export_opts = [
    "--manifest",
    "--vsys", "0",
    "--product", "NetTAP Network Intelligence",
    "--vendor", "NetTAP Technology Limited",
    "--version", var.release_version,
    "--description", "Private network evidence and packet analysis appliance",
  ]
}

source "vmware-iso" "target" {
  vm_name          = "${local.appliance_name}-vmware"
  guest_os_type    = var.vmware_guest_os_type
  iso_url          = var.ubuntu_iso_url
  iso_checksum     = var.ubuntu_iso_checksum
  output_directory = "output/vmware-${var.architecture}"
  headless         = true
  cpus             = var.cpus
  memory           = var.memory_mb
  disk_size        = var.disk_mb
  disk_type_id     = "0"
  http_directory   = "${path.root}/http"
  cd_content       = local.cd_content
  cd_label         = "cidata"
  boot_command     = local.boot_command
  boot_wait        = "5s"
  ssh_username     = local.build_user
  ssh_password     = var.build_password
  ssh_timeout      = "45m"
  shutdown_command = "echo '${var.build_password}' | sudo -S shutdown -P now"
  shutdown_timeout = "15m"
}

build {
  name = "nettap-appliance-${var.architecture}"
  sources = [
    "source.virtualbox-iso.target",
    "source.vmware-iso.target",
  ]

  provisioner "file" {
    source      = var.source_archive
    destination = "/tmp/nettap-source.tar.gz"
  }

  provisioner "shell" {
    execute_command = "echo '${var.build_password}' | sudo -S env {{ .Vars }} bash '{{ .Path }}'"
    environment_vars = [
      "NETTAP_RELEASE_VERSION=${var.release_version}",
      "NETTAP_ARCHITECTURE=${var.architecture}",
      "NETTAP_SOURCE_COMMIT=${var.source_commit}",
    ]
    script = "${path.root}/../scripts/provision.sh"
  }

  post-processor "manifest" {
    output     = "output/packer-${var.architecture}.json"
    strip_path = false
    custom_data = {
      release_version = var.release_version
      architecture    = var.architecture
      ubuntu_iso      = var.ubuntu_iso_url
      ubuntu_sha256   = var.ubuntu_iso_checksum
    }
  }
}
