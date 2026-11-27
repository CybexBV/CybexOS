# The initrd an all-AMD laptop's boot loader reads before the disk unlock
# prompt: amdgpu's firmware, none of nouveau's NVIDIA GSP images, and about
# 100 MB rather than 1.4 GB (nix/modules/hardware.nix; 98 MiB on 2026-11-27,
# 16 MiB of it Intel microcode). Parity checks the module lists; this builds
# the actual module tree and initrd.
{ nixpkgs, pkgs, module, system }:
let
  amd = (nixpkgs.lib.nixosSystem {
    inherit system;
    modules = [ module ./machine.nix {
      cybexos.hardware.profile = "hp-zbook-ultra-g1a";
      cybexos.encrypted = true;
    } ];
  }).config;
  closure = amd.system.build.modulesClosure;
  initrd = "${amd.system.build.initialRamdisk}/${amd.system.boot.loader.initrdFile}";
in pkgs.runCommand "cybexos-initrd-firmware" { MAX_MIB = 200; } ''
  # Without amdgpu's firmware the checks below would pass for an empty tree.
  test -d ${closure}/lib/firmware/amdgpu
  if [ -e ${closure}/lib/firmware/nvidia ]; then
    echo "An all-AMD initrd carries NVIDIA firmware:" >&2
    find ${closure}/lib/firmware/nvidia -type f | head >&2
    exit 1
  fi
  size=$(stat -L -c %s ${initrd})
  echo "initrd: $size bytes"
  if [ "$size" -ge $((MAX_MIB * 1024 * 1024)) ]; then
    echo "The all-AMD initrd is $size bytes, over $MAX_MIB MiB." >&2
    exit 1
  fi
  echo "$size" > $out
''
