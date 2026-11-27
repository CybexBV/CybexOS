# Folio ("Files"), Omarchy's file manager (https://github.com/omacom/folio,
# MIT): the file manager, the Open and Save dialogs other apps ask
# xdg-desktop-portal for (`folio chooser`), and "Show in folder"
# (org.freedesktop.FileManager1). Nixpkgs does not package it, so Cybex OS
# builds this pinned release itself, as it builds Omasnap and Omawrite.
#
# Folio expects three Omarchy pieces; this package supplies Cybex OS ones:
# - Its colours follow Omarchy's theme folder. It reads the colours the
#   shell renders into ~/.local/state/cybexos/theme/folio instead
#   (desktop/quickshell/scripts/theme_folio.py).
# - Its language follows ~/.config/omarchy/language. Without that file it
#   follows the session's locale, which Settings → Region sets, as the
#   shell does (Common/I18n.qml).
# - Its LocalSend entry runs `localsend --headless send`, a command of the
#   Arch package. Cybex OS's LocalSend is Nixpkgs' `localsend_app`, which
#   opens with the chosen files ready to send.
# Text size follows GNOME's text-scaling-factor through the portal, which
# the shell's GTK theme target sets (theme_gtk.py).
#
# Its dialogs open as windows of their own, not attached to the app that
# asked (its README says so). Folio's xdg-foreign code is built only with
# Qt6::GuiPrivate, and with it 0.7.5 does not compile (tried 2026-11-27);
# Hyprland floats and centres them instead (desktop/hypr/looknfeel.lua).
#
# The suite takes a minute, so machines build without it and
# `checks.<system>.folio` runs it (passthru.tests.suite).
{ lib, stdenv, fetchFromGitHub, cmake, ninja, pkg-config, qt6, glib, fontconfig, zlib, wayland,
  libarchive, poppler-utils, jq, shared-mime-info, coreutils }:
let
  # Folio's optional previews (Qt PDF, Qt Multimedia) load these at run time.
  qtModules = with qt6; [ qtbase qtdeclarative qtwayland qtsvg qtimageformats qtmultimedia qtwebengine ];
in stdenv.mkDerivation (finalAttrs: {
  pname = "folio";
  version = "0.7.5";
  src = fetchFromGitHub {
    owner = "omacom";
    repo = "folio";
    tag = "v${finalAttrs.version}";
    hash = "sha256-VOLVGgpqnaYuVmDlHOQCTrRff4sOfRA7msDD89ZkYGE=";
  };
  postPatch = ''
    substituteInPlace src/theme.cpp \
      --replace-fail '"/.local/state/omarchy/current"' '"/.local/state/cybexos/theme/folio"'
    # The one fallback in readLanguage: no language file.
    substituteInPlace src/translator.cpp \
      --replace-fail 'return "en";' 'return QLocale::system().language() == QLocale::C ? QStringLiteral("en") : QLocale::system().name().section(QStringLiteral("_"), 0, 0);'
    substituteInPlace plugins/localsend/manifest.json \
      --replace-fail '"requires": ["localsend"]' '"requires": ["localsend_app"]' \
      --replace-fail '"command": ["localsend", "--headless", "send"]' '"command": ["localsend_app"]'
    substituteInPlace tests/folio_tests.cpp \
      --replace-fail '{{"localsend", "#!/bin/sh\n"}}' '{{"localsend_app", "#!/bin/sh\n"}}' \
      --replace-fail 'QStringList({"localsend", "--headless", "send"})' 'QStringList({"localsend_app"})'
    # The suite's stand-in thumbnailers name programs by their usual paths;
    # the build sandbox has /bin/sh only.
    substituteInPlace tests/folio_tests.cpp \
      --replace-quiet /bin/cp ${coreutils}/bin/cp \
      --replace-quiet /bin/true ${coreutils}/bin/true \
      --replace-quiet /bin/false ${coreutils}/bin/false
    # folderModelStopsReadingWhatsBeenOvertaken asks that the next folder
    # shows in under half the time a big folder's search takes, in whole
    # milliseconds. On a fast disk 20,000 files are searched in 3 ms and the
    # overtaken search stops in 1 ms, so 1 < 3 / 2 failed 9 runs in 10
    # (2026-11-27). 100,000 files take 16 ms; the claim is unchanged.
    substituteInPlace tests/folio_tests.cpp \
      --replace-fail $'i < 20000; ++i)\n            write(big.filePath' $'i < 100000; ++i)\n            write(big.filePath'
  '';
  strictDeps = true;
  nativeBuildInputs = [ cmake ninja pkg-config qt6.wrapQtAppsHook ];
  buildInputs = qtModules ++ [ glib fontconfig zlib wayland ];
  cmakeFlags = [ (lib.cmakeBool "BUILD_TESTING" finalAttrs.doCheck) ];
  doCheck = false;
  nativeCheckInputs = [ jq poppler-utils libarchive shared-mime-info ];
  # Run the suite directly: ctest hides its output. It runs offscreen and
  # needs the MIME database and Qt's QML modules the wrapper gives the app.
  checkPhase = ''
    runHook preCheck
    export QT_QPA_PLATFORM=offscreen QT_FORCE_STDERR_LOGGING=1 HOME=$TMPDIR XDG_RUNTIME_DIR=$TMPDIR/run
    export QML_IMPORT_PATH=${lib.makeSearchPath "lib/qt-6/qml" qtModules}
    export QT_PLUGIN_PATH=${lib.makeSearchPath "lib/qt-6/plugins" qtModules}
    export XDG_DATA_DIRS=${shared-mime-info}/share
    mkdir -p -m 0700 $XDG_RUNTIME_DIR
    ./folio_tests
    runHook postCheck
  '';
  # Archive listing and extraction (bsdtar) and PDF thumbnails (pdftoppm);
  # the session's own programs come first.
  qtWrapperArgs = [ "--suffix" "PATH" ":" (lib.makeBinPath [ libarchive poppler-utils ]) ];
  passthru.tests.suite = finalAttrs.finalPackage.overrideAttrs { doCheck = true; };
  meta = {
    description = "Keyboard-first file manager and file chooser that follows the desktop theme";
    homepage = "https://github.com/omacom/folio";
    license = lib.licenses.mit;
    mainProgram = "folio";
    platforms = lib.platforms.linux;
  };
})
