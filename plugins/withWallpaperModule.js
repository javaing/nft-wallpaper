const { withMainApplication } = require('@expo/config-plugins');

module.exports = function withWallpaperModule(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;

    // WallpaperPackage is in the same package (com.nftwallpaper.app),
    // so NO import is needed in Kotlin — same-package classes are always visible.

    // Inject add(WallpaperPackage()) into PackageList.packages.apply block
    if (!contents.includes('add(WallpaperPackage())')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply \{[\s\S]*?\}/,
        (match) => {
          const indent = match.match(/^(\s+)PackageList/m)?.[1] ?? '        ';
          return match.replace(
            /(\s+)\}$/,
            `\n${indent}  add(WallpaperPackage())\n${indent}}`
          );
        }
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
