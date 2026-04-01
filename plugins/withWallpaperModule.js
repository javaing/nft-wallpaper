const { withMainApplication } = require('@expo/config-plugins');

module.exports = function withWallpaperModule(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;

    // 注入 import
    if (!contents.includes('import com.nftwallpaper.app.WallpaperPackage')) {
      contents = contents.replace(
        /^(import com\.facebook\.react\.PackageList)/m,
        'import com.nftwallpaper.app.WallpaperPackage\n$1'
      );
    }

    // 注入 add(WallpaperPackage())
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
