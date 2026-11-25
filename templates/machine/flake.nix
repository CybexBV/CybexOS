{
  description = "Personal Cybex OS machine; keep credentials outside this tree";
  inputs = {
    # The fresh installer names the branch of the medium's own Nixpkgs lock here;
    # cybex update moves it with a release on a later NixOS branch.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # The fresh installer replaces this with the medium's exact release revision.
    cybexos.url = "github:CybexBV/CybexOS/REPLACE_WITH_AUTHENTICATED_REVISION";
    cybexos.inputs.nixpkgs.follows = "nixpkgs";
    # Add personal inputs explicitly. cybex update never refreshes these implicitly.
  };
  outputs = { nixpkgs, cybexos, ... }: {
    nixosConfigurations.cybexos = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [ cybexos.nixosModules.default ./hardware-configuration.nix ./machine.nix ./settings.nix ./local ];
    };
  };
}
