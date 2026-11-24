{ config, lib, pkgs, ... }:
let
  # Copy once into mutable NetworkManager state. ensureProfiles would restore
  # the vendor values on every activation, undoing the network widget's choice.
  wired = pkgs.writeText "cybexos-wired.nmconnection" ''
    [connection]
    id=Cybex OS Wired
    uuid=eb7f047d-b8bf-4c3d-a9d6-884ff7ab9b64
    type=ethernet
    autoconnect=true
    autoconnect-priority=-100
    multi-connect=3

    [ipv4]
    method=auto

    [ipv6]
    method=auto
  '';
in {
  # Wired connections use the DNS the network advertises (company resolvers,
  # captive portals), as the network menu's Automatic choice does. Google is
  # the fallback only when no network names a resolver, and stays one click
  # away in the network menu. The installation medium uses the same default.
  config = lib.mkIf ((config.cybexos.enable || config.cybexos.installationMedium) && config.networking.networkmanager.enable) {
    # A single DNS manager accepts per-link settings from both NetworkManager
    # and Tailscale. Do not force --accept-dns=false or overwrite VPN choices.
    services.resolved.enable = lib.mkDefault true;
    services.resolved.settings.Resolve.FallbackDNS = lib.mkDefault [
      "8.8.8.8" "8.8.4.4" "2001:4860:4860::8888" "2001:4860:4860::8844"
    ];
    systemd.services.cybexos-network-defaults = {
      description = "Initialize the editable wired network default on a fresh system";
      wantedBy = [ "NetworkManager.service" ];
      before = [ "NetworkManager.service" ];
      unitConfig.ConditionPathExists = "!/var/lib/cybexos-network/defaults-initialized";
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        StateDirectory = "cybexos-network";
        StateDirectoryMode = "0700";
        UMask = "0077";
      };
      path = [ pkgs.coreutils ];
      script = ''
        # Personal, declarative and initrd-created profiles always win. This
        # initializer never edits or replaces a connection that already exists.
        for directory in /etc/NetworkManager/system-connections /run/NetworkManager/system-connections /usr/lib/NetworkManager/system-connections; do
          for profile in "$directory"/*; do
            if [ -f "$profile" ]; then
              touch /var/lib/cybexos-network/defaults-initialized
              exit 0
            fi
          done
        done
        install -d -m 0700 /etc/NetworkManager/system-connections
        install -m 0600 ${wired} /etc/NetworkManager/system-connections/cybexos-wired.nmconnection
        touch /var/lib/cybexos-network/defaults-initialized
      '';
    };
  };
}
