# Settings' bridge to GNOME Online Accounts (desktop/goa-account): opens
# GOA's own sign-in dialog for one provider or one account, without GNOME's
# account list. Its own package with its own version, so a release that
# leaves it alone rebuilds nothing.
{ lib, stdenv, source, pkg-config, wrapGAppsHook4, gtk4, libadwaita,
  gnome-online-accounts, glib-networking, gsettings-desktop-schemas }:
stdenv.mkDerivation {
  pname = "cybexos-goa-account";
  version = "1";
  src = import ../package-source.nix {
    inherit lib source;
    paths = [ "desktop/goa-account" ];
  };
  nativeBuildInputs = [ pkg-config wrapGAppsHook4 ];
  # glib-networking: GOA's own HTTPS requests (token exchange, Nextcloud's
  # login flow) need its TLS module.
  buildInputs = [ gtk4 libadwaita gnome-online-accounts glib-networking gsettings-desktop-schemas ];
  buildPhase = ''
    runHook preBuild
    # A deprecation in a newer GTK or libadwaita must not stop a Nixpkgs update.
    $CC -O2 -Wall -Wextra -Werror -Wno-error=deprecated-declarations -o cybexos-goa-account desktop/goa-account/cybexos-goa-account.c \
      $(pkg-config --cflags --libs goa-backend-1.0 libadwaita-1)
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    install -Dm755 cybexos-goa-account $out/bin/cybexos-goa-account
    runHook postInstall
  '';
  doInstallCheck = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
  installCheckPhase = ''
    runHook preInstallCheck
    export HOME=$TMPDIR
    # Listing needs no display and no session bus. The providers are this
    # GOA build's: Fedora is compiled out of Nixpkgs' GOA.
    $out/bin/cybexos-goa-account list > providers.json
    for type in google ms_graph owncloud exchange imap_smtp webdav kerberos; do
      grep -q "\"type\":\"$type\"" providers.json
    done
    ! grep -q '"type":"fedora"' providers.json
    status=0; $out/bin/cybexos-goa-account add > /dev/null 2>&1 || status=$?
    test "$status" = 2
    # Nothing on the wrapper's data path may carry applications: a desktop
    # file without a MIME index there hides the system's indexed copy of
    # GOA's OAuth2 handler from the browser handoff.
    for dir in $(grep -ao "/nix/store/[^':\"]*" $out/bin/cybexos-goa-account | sort -u); do
      test ! -e "$dir/applications"
    done
    runHook postInstallCheck
  '';
  meta = {
    description = "Opens GNOME Online Accounts' sign-in dialog for Cybex OS Settings";
    license = lib.licenses.mit;
    mainProgram = "cybexos-goa-account";
    platforms = lib.platforms.linux;
  };
}
