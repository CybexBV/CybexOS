{ lib, stdenv, fetchurl, cmake, ninja, qt6, dbus, makeFontsConf, dejavu_fonts, wqy_microhei, fontconfig }:
stdenv.mkDerivation (finalAttrs: {
  pname = "omawrite";
  version = "0.7.8";
  src = fetchurl {
    name = "omawrite-source.tar.gz";
    url = "https://codeload.github.com/omacom/omawrite/tar.gz/1c09d424bdcb7e08a1f19f79e44d687bf0777ddc";
    hash = "sha256-webmCzl5SwK/oHTPNMe1zE0Z1MW8oGh6RMyxBsPYwBc=";
  };
  nativeBuildInputs = [ cmake ninja qt6.wrapQtAppsHook ];
  buildInputs = [ qt6.qtbase qt6.qtdeclarative qt6.qtwayland ];
  # Machines skip building and running omawrite_tests; checks.<system>.omawrite runs it.
  # Test-only inputs (dbus, test fonts, fonts.conf) live only on passthru.tests.suite
  # so user machines never fetch or build them.
  ninjaFlags = lib.optionals (!finalAttrs.doCheck) [ "omawrite" ];
  doCheck = false;
  installPhase = ''
    runHook preInstall
    install -Dm755 omawrite $out/bin/omawrite
    install -Dm644 ../pkgbuild/omawrite.desktop $out/share/applications/omawrite.desktop
    install -Dm644 ../pkgbuild/omawrite.svg $out/share/icons/hicolor/scalable/apps/omawrite.svg
    runHook postInstall
  '';
  passthru.tests.suite = finalAttrs.finalPackage.overrideAttrs {
    doCheck = true;
    nativeCheckInputs = [ dbus ];
    preCheck = ''
      export HOME=$TMPDIR
      export XDG_RUNTIME_DIR=$TMPDIR/run
      mkdir -p -m 0700 "$XDG_RUNTIME_DIR" "$TMPDIR/bin"
      # Nix's build sandbox has no /etc/dbus-1/session.conf; point --session at dbus's own config.
      cat > "$TMPDIR/bin/dbus-daemon" <<'EOF'
      #!${stdenv.shell}
      args=()
      for arg in "$@"; do
        if [ "$arg" = "--session" ]; then
          args+=(--config-file="${dbus}/share/dbus-1/session.conf")
        else
          args+=("$arg")
        fi
      done
      exec "${dbus}/bin/dbus-daemon" "''${args[@]}"
      EOF
      chmod +x "$TMPDIR/bin/dbus-daemon"
      export PATH="$TMPDIR/bin:$PATH"
      export QML_IMPORT_PATH="${qt6.qtdeclarative}/${qt6.qtbase.qtQmlPrefix}"
      export QT_PLUGIN_PATH="${qt6.qtbase}/${qt6.qtbase.qtPluginPrefix}:${qt6.qtwayland}/${qt6.qtbase.qtPluginPrefix}"
      export FONTCONFIG_FILE=${makeFontsConf {
        fontDirectories = [ dejavu_fonts wqy_microhei ];
        includes = [ "${fontconfig.out}/etc/fonts/conf.d" ];
      }}
    '';
  };
  meta = {
    license = lib.licenses.gpl3Only;
    mainProgram = "omawrite";
  };
})
