{ config, lib, pkgs, ... }:
let
  cfg = config.cybexos;
  # Nixpkgs' ChatGPT (maintained there, updated with the machine Nixpkgs).
  # Keep the AppArmor rule pointed at the original executable; the Wayland
  # wrapper below delegates to this package without changing its resources.
  chatgpt = pkgs.chatgpt;
  assistant = pkgs.callPackage ../packages/assistant.nix {};
  libreswanPlugin = pkgs.callPackage ../packages/networkmanager-libreswan.nix {};
  waylandApps = import ../packages/wayland-apps.nix { inherit pkgs; };
  # The browser with proprietary applications: Nixpkgs' Google Chrome, an
  # unfree vendor download unpacked on the computer. Its wrapper selects
  # Wayland from the session's NIXOS_OZONE_WL (desktop.nix). Chrome does not
  # recognise Hyprland as a desktop with a keyring, so saved passwords would
  # stay unencrypted on disk; keep them in the GNOME keyring instead. Chrome
  # opens straight to a window: its first-run dialog would sit in front of
  # the welcome guide's sign-ins, and Software and Settings own the default
  # browser choice it offers.
  chrome = pkgs.google-chrome.override { commandLineArgs = "--password-store=gnome-libsecret --no-first-run"; };
  browser = if cfg.features.proprietary then "google-chrome.desktop" else "firefox.desktop";
  webStore = "https://clients2.google.com/service/update2/crx";
  # Chromium-family browsers each read their own system directory: Chrome
  # /etc/opt/chrome, Chromium /etc/chromium and Brave Origin /etc/brave.
  # Whichever of them a person uses gets the same namespaced policy file.
  policies = lib.mkIf (cfg.browser.policies != { }) { text = builtins.toJSON cfg.browser.policies; };
  # 1Password writes its browser-extension host into the browser profiles it
  # knows (Chrome's, and Origin's only since 8.12.42), and only once it has
  # run. Chrome also reads /etc/opt/chrome, and Chromium and Brave Origin
  # /etc/chromium. Point those system entries at the NixOS module's setgid
  # helper, with the extension origins 1Password itself allows.
  onePasswordHost = lib.mkIf (cfg.features.proprietary && config.programs._1password-gui.enable) {
    text = builtins.toJSON {
      name = "com.1password.1password";
      description = "1Password BrowserSupport";
      path = "${config.security.wrapperDir}/1Password-BrowserSupport";
      type = "stdio";
      allowed_origins = map (id: "chrome-extension://${id}/") [
        "hjlinigoblmkhjejkmbegnoaljkphmgo" "bkpbhnjcbehoklfkljkkbbmipaphipgl" "gejiddohjgogedgjnonbofjigllpkmbf"
        "khgocmkkpikpnmmkgmdnfckapcdkgfaf" "aeblfdkhhhdcdjpifhhbdiojplfjncoa" "dppgmdbiimibapkepcbdbmkaabgiofem"
      ];
    };
  };
  # The agent CLIs, from their makers' own release builds (pinned in
  # nix/packages, kept current by the vendor-updates workflow), so an update
  # never waits for NixOS to build them.
  codexCli = pkgs.callPackage ../packages/codex {};
  # The file manager, every app's Open and Save dialog through
  # xdg-desktop-portal, and "Show in folder" (nix/packages/folio.nix).
  folio = pkgs.callPackage ../packages/folio.nix {};
  claudeCode = pkgs.callPackage ../packages/claude-code {};
  # Claude in Chrome reaches Claude Code through a native messaging host.
  # Claude Code writes its own entry into each browser profile it knows on
  # its first /chrome, which Chrome then prefers; Brave Origin's profile is
  # not among them, and Origin reads /etc/chromium. This system entry answers
  # in both until then, with the extension origin Claude Code itself allows.
  claudeHost = lib.mkIf cfg.features.proprietary {
    text = builtins.toJSON {
      name = "com.anthropic.claude_code_browser_extension";
      description = "Claude Code Browser Extension Native Host";
      path = "${pkgs.writeShellScript "claude-code-chrome-native-host" "exec ${claudeCode}/bin/claude --chrome-native-host"}";
      type = "stdio";
      allowed_origins = [ "chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/" ];
    };
  };
in {
  options.cybexos.browser.policies = lib.mkOption {
    type = lib.types.attrsOf lib.types.anything;
    default = {};
    description = ''
      Enterprise policies for Chromium-family browsers (Google Chrome,
      Chromium and Brave Origin); administrator values override vendor defaults.
    '';
  };
  options.cybexos.applications.spotify = lib.mkOption {
    type = lib.types.bool;
    default = cfg.features.proprietary;
    defaultText = lib.literalExpression "config.cybexos.features.proprietary";
    internal = true;
    description = ''
      Install Spotify with the proprietary applications. Checks that don't
      exercise it turn it off: its download comes from api.snapcraft.io,
      which CI runners can't always reach.
    '';
  };
  config = lib.mkIf cfg.enable {
    environment.systemPackages = with pkgs; [
      cfg.desktopPackage cfg.updaterPackage
      (pkgs.callPackage ../packages/omawrite.nix {}) (pkgs.callPackage ../packages/omasnap.nix {})
      oh-my-posh cfg.dictationPackage
      hyprland quickshell hyprlock hypridle hyprsunset hyprpicker
      wl-clipboard cliphist grim slurp wayfreeze wf-recorder tesseract zbar qrencode
      imagemagick libnotify wtype pulseaudio
      wlr-randr brightnessctl playerctl pavucontrol networkmanagerapplet bluez polkit
      kitty fish firefox folio pinta evince file-roller unicode-emoji
      system-config-printer libqalculate libva-utils v4l-utils ffmpegthumbnailer orca
      gnome-calculator gnome-text-editor simple-scan solaar mpv imv yt-dlp ffmpeg
      localsend neovim nano git gh openssh curl wget jq ripgrep fd fzf zoxide direnv eza xdg-terminal-exec
      bat tree unzip zip btop fastfetch delta glow duf dust pciutils usbutils lm_sensors
      strace net-tools dmidecode yq-go file _7zz bc bzip2 cifs-utils compsize
      man-pages mtr nmap tcpdump traceroute whois bind.dnsutils hunspell hunspellDicts.en_US
      age libsecret gnome-keyring p11-kit pam_u2f libfido2 fprintd fwupd sbctl efibootmgr restic
      btrfs-progs cryptsetup parted gptfdisk dosfstools util-linux openssl shadow
      (python3.withPackages (p: [ p.pygobject3 p.pillow p.dbus-python ]))
      gsettings-desktop-schemas adwaita-icon-theme adw-gtk3 glib
      # The agent CLIs are part of every installation. Claude Code is unfree.
      codexCli
    ] ++ lib.optionals cfg.features.proprietary [ chrome waylandApps.chatgpt claudeCode ]
      ++ lib.optionals (cfg.features.proprietary && cfg.applications.spotify) [ waylandApps.spotify ]
      ++ lib.optionals cfg.features.assistant [ assistant ]
      ++ lib.optionals cfg.features.developer [ git-lfs gcc cmake gnumake mold sccache rustup nodejs bun jdk25 tree-sitter python3 ruff shellcheck lazygit lazydocker android-tools balena-cli (pkgs.callPackage ../packages/mdview.nix {}) (pkgs.callPackage ../packages/t3-code.nix {}) ]
      ++ lib.optionals cfg.features.podman [ distrobox podman-compose ]
      ++ lib.optionals cfg.features.steam [ mangohud protonup-qt ]
      ++ lib.optionals cfg.features.connectedWidgets [ gnome-calendar ]
      # Settings adds and reconnects online accounts through its own helper,
      # which opens GNOME Online Accounts' dialog for one provider: wherever
      # the accounts service runs, however it was enabled.
      ++ lib.optionals config.services.gnome.gnome-online-accounts.enable
        [ (pkgs.callPackage ../packages/goa-account.nix { source = ../..; }) ];
    fonts.packages = with pkgs; [
      (pkgs.callPackage ../packages/fonts.nix {}) (pkgs.callPackage ../packages/space-grotesk.nix {}) figtree geist-font
      (pkgs.callPackage ../packages/symbols-font.nix { source = ../..; })
      nerd-fonts.jetbrains-mono nerd-fonts.fira-code inter ibm-plex noto-fonts
      noto-fonts-color-emoji font-awesome fira-code jetbrains-mono
    ];
    services.tailscale.enable = lib.mkDefault cfg.features.tailscale;
    virtualisation.docker = { enable = lib.mkDefault cfg.features.docker; enableOnBoot = false; };
    virtualisation.podman.enable = lib.mkDefault cfg.features.podman;
    # Docker's socket remains root-owned. Wheel is not put in docker.
    programs._1password.enable = lib.mkDefault cfg.features.proprietary;
    # Match upstream's exact-executable user-namespace exception for Chromium's
    # sandbox; do not turn off sandboxing or weaken unrelated AppArmor policy.
    security.apparmor.policies.chatgpt = lib.mkIf cfg.features.proprietary {
      profile = ''
        abi <abi/4.0>,
        include <tunables/global>
        profile chatgpt "${chatgpt}/lib/chatgpt/ChatGPT" flags=(unconfined) {
          userns,
          include if exists <local/chatgpt>
        }
      '';
      state = "enforce";
    };
    # The package's own rule: drop bundled-plugin copies of replaced versions.
    systemd.user.tmpfiles.rules = lib.mkIf cfg.features.proprietary [ "e %C/chatgpt/bundled-plugins-v2 - - - 0" ];
    programs._1password-gui = {
      enable = lib.mkDefault cfg.features.proprietary;
      package = lib.mkDefault waylandApps._1password-gui;
      polkitPolicyOwners = [ cfg.primaryUser ];
    };
    programs.steam = { enable = lib.mkDefault cfg.features.steam; remotePlay.openFirewall = false; dedicatedServer.openFirewall = false; };
    programs.gamemode.enable = lib.mkDefault cfg.features.steam;
    services.flatpak.enable = lib.mkDefault true;
    # Software offers Flathub apps for the signed-in account; each account
    # gets the remote once, from the repository file that ships with Cybex OS.
    environment.etc."cybexos/flathub-enabled" = lib.mkIf (cfg.features.flathub && config.services.flatpak.enable) { text = "enabled\n"; };
    # Programs downloaded as plain Linux binaries (vendor tarballs, language
    # toolchains, Python wheels, editor extensions) expect the standard dynamic
    # loader and common libraries. nix-ld provides them from the same set
    # NixOS's AppImage runtime uses. AppImages start directly through binfmt.
    programs.nix-ld = {
      enable = lib.mkDefault true;
      libraries = (pkgs.appimageTools.defaultFhsEnvArgs.multiPkgs pkgs)
        ++ (with pkgs; [ gtk3 krb5 libsecret icu libffi libnotify ]);
    };
    programs.appimage = { enable = lib.mkDefault true; binfmt = lib.mkDefault true; };
    xdg.mime = let
      # Register GNOME Online Accounts' OAuth2 return links explicitly (both
      # default and added association, since xdg-desktop-portal checks
      # recommended applications for custom schemes). Even a process that
      # inherited an unindexed package share folder ahead of
      # /run/current-system/sw/share still resolves the handler.
      goaOAuth = lib.optionalAttrs config.services.gnome.gnome-online-accounts.enable (lib.genAttrs [
        "x-scheme-handler/goa-oauth2"
        "x-scheme-handler/com.googleusercontent.apps.44438659992-7kgjeitenc16ssihbtdjbgguch7ju55s"
      ] (_: lib.mkDefault "org.gnome.OnlineAccounts.OAuth2.desktop"));
    in {
      enable = true;
      addedAssociations = goaOAuth;
      defaultApplications = {
        "x-scheme-handler/http" = lib.mkDefault browser;
        "x-scheme-handler/https" = lib.mkDefault browser;
        "text/html" = lib.mkDefault browser;
        "application/xhtml+xml" = lib.mkDefault browser;
        "x-scheme-handler/about" = lib.mkDefault browser;
        "x-scheme-handler/unknown" = lib.mkDefault browser;
        "text/plain" = lib.mkDefault "org.gnome.TextEditor.desktop";
        "application/pdf" = lib.mkDefault "org.gnome.Evince.desktop";
        "image/png" = lib.mkDefault "imv.desktop";
        "image/jpeg" = lib.mkDefault "imv.desktop";
        "image/webp" = lib.mkDefault "imv.desktop";
        "video/mp4" = lib.mkDefault "mpv.desktop";
        "video/webm" = lib.mkDefault "mpv.desktop";
        "video/x-matroska" = lib.mkDefault "mpv.desktop";
        # Software's Files, Music and Email defaults. Nothing handles email
        # links until someone chooses an app or a web mail service.
        "inode/directory" = lib.mkDefault "folio.desktop";
      } // lib.genAttrs [ "audio/mpeg" "audio/flac" "audio/ogg" "audio/x-vorbis+ogg" "audio/x-opus+ogg" "audio/mp4" "audio/x-wav" ]
        (_: lib.mkDefault "mpv.desktop")
        // goaOAuth;
    };
    environment.etc."xdg/xdg-terminals.list".text = "kitty.desktop\n";
    services.gnome.gnome-keyring.enable = true;
    services.gnome.at-spi2-core.enable = lib.mkDefault true;
    services.speechd.enable = lib.mkDefault true;
    services.gnome.gnome-online-accounts.enable = lib.mkDefault cfg.features.connectedWidgets;
    services.gnome.evolution-data-server.enable = lib.mkDefault cfg.features.connectedWidgets;
    # Microsoft 365 and Exchange calendars: Evolution Data Server reads them
    # only through evolution-ews's backends (a GOA ms_graph account becomes a
    # microsoft365 collection, an exchange account an ews one). Prebuilt.
    services.gnome.evolution-data-server.plugins =
      lib.mkIf config.services.gnome.evolution-data-server.enable [ pkgs.evolution-ews ];
    programs.gnupg.agent = { enable = true; pinentryPackage = pkgs.pinentry-gnome3; };
    # Folio answers every app's Open and Save dialog through the portal:
    # GTK 4, Qt (QT_QPA_PLATFORMTHEME, desktop.nix), Chromium and Electron
    # ask the portal when one is running, and Firefox once told to (below).
    # GTK 3 apps keep GTK's own dialog: GTK_USE_PORTAL would also send their
    # links and files through the portal's Open With chooser.
    xdg.portal.extraPortals = [ folio ];
    xdg.portal.config.hyprland."org.freedesktop.impl.portal.FileChooser" = [ "folio" "gtk" ];
    programs.firefox = {
      enable = lib.mkDefault true;
      # 1 always uses the portal's file chooser; Firefox's default does so
      # only inside Flatpak and Snap.
      policies.Preferences."widget.use-xdg-desktop-portal.file-picker" = lib.mkDefault { Value = 1; Status = "default"; };
      policies.ExtensionSettings = lib.mkIf cfg.features.proprietary {
        "{d634138d-c276-4fc8-924b-40a0ea21d284}" = {
          installation_mode = lib.mkDefault "force_installed";
          install_url = lib.mkDefault "https://addons.mozilla.org/firefox/downloads/latest/1password-x-password-manager/latest.xpi";
        };
      };
    };
    cybexos.browser.policies = lib.mkIf cfg.features.proprietary {
      # Software and Settings choose the default browser. Every browser that
      # reads this file would otherwise make itself the default when it
      # starts, undoing that choice.
      DefaultBrowserSettingEnabled = lib.mkDefault false;
      RestoreOnStartup = lib.mkDefault 1;
      SpellcheckLanguage = lib.mkDefault [ (lib.toLower (lib.head (lib.splitString "_" config.i18n.defaultLocale))) ];
      # 1Password, which cannot be removed.
      ExtensionInstallForcelist = lib.mkDefault [ "aeblfdkhhhdcdjpifhhbdiojplfjncoa;${webStore}" ];
      # Claude in Chrome and ChatGPT arrive on their own, so the agents can
      # use the browser, and can be turned off like any other extension.
      ExtensionSettings = lib.genAttrs [ "fcoeoabgfenejglbffodgkkbkcdhcgfn" "hehggadaopoacecdllhhajmbjkdcmajg" ] (_: {
        installation_mode = lib.mkDefault "normal_installed";
        update_url = lib.mkDefault webStore;
      });
    };
    environment.etc."opt/chrome/policies/managed/cybexos.json" = policies;
    environment.etc."chromium/policies/managed/cybexos.json" = policies;
    environment.etc."brave/policies/managed/cybexos.json" = policies;
    environment.etc."opt/chrome/native-messaging-hosts/com.1password.1password.json" = onePasswordHost;
    environment.etc."chromium/native-messaging-hosts/com.1password.1password.json" = onePasswordHost;
    environment.etc."opt/chrome/native-messaging-hosts/com.anthropic.claude_code_browser_extension.json" = claudeHost;
    environment.etc."chromium/native-messaging-hosts/com.anthropic.claude_code_browser_extension.json" = claudeHost;
    # Cybex OS keeps Codex current: no update notice, and no background daemon
    # installing newer Codex releases into ~/.codex (Nixpkgs builds Codex with
    # it off). A person's own ~/.codex/config.toml still overrides this.
    environment.etc."codex/config.toml".text = lib.mkDefault ''
      check_for_update_on_startup = false

      [features]
      daemon_auto_start = false
    '';
    hardware.sane.enable = lib.mkDefault true;
    # Driverless printers remain available; retain the maintained free drivers
    # for devices that need them. HP's proprietary firmware plugin is a local,
    # explicit choice, never an implicit unfree dependency of basic printing.
    services.printing.drivers = lib.mkDefault [ pkgs.gutenprint pkgs.hplip ];
    hardware.sane.extraBackends = lib.mkDefault [ pkgs.hplip ];
    # GNOME recommends maintained Libreswan for Cisco IKEv1/IPsec. The archived
    # vpnc plugin still has unfixed local-root CVEs and is never permitted.
    networking.networkmanager.plugins = with pkgs; [ networkmanager-openvpn networkmanager-openconnect networkmanager-ssh libreswanPlugin ];
    # Expected local builds (nix/modules/prebuilt.nix): the plugin's helper-path
    # fix, ChatGPT and its workspace runtime, and Steam's FHS runtime, whose
    # free wrapper carries the unfree client.
    cybexos.updates.expectedBuilds = [ libreswanPlugin ]
      # AppArmor references the original unfree download, outside its launcher.
      ++ lib.optional cfg.features.proprietary chatgpt
      # ChatGPT's workspace runtime: a second unfree download of its own
      # (Nixpkgs, November 2026), below ChatGPT rather than in the system's
      # packages. Its inputs must still come prebuilt.
      ++ lib.optional (cfg.features.proprietary && (chatgpt.primaryRuntime or null) != null) chatgpt.primaryRuntime
      ++ lib.optional config.programs.steam.enable config.programs.steam.package.run;
    services.libreswan.enable = lib.mkDefault true;
    environment.etc."cybexos/emoji-test.txt".source = "${pkgs.unicode-emoji}/share/unicode/emoji/emoji-test.txt";
    i18n.inputMethod = { enable = true; type = "ibus"; ibus.engines = with pkgs.ibus-engines; [ anthy chewing hangul libpinyin m17n typing-booster ]; };
  };
}
