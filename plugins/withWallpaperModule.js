const { withMainApplication } = require('@expo/config-plugins');

/**
 * Config Plugin：每次 expo prebuild 時自動把 WallpaperPackage 注入 MainApplication.kt
 */
module.exports = function withWallpaperModule(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;

    // 已經注入過就跳過
    if (contents.includes('add(WallpaperPackage())')) {
      return mod;
    }

    // 在 packages.apply 區塊內加入 WallpaperPackage
    contents = contents.replace(
      /PackageList\(this\)\.packages\.apply \{[\s\S]*?\}/,
      (match) => {
        // 取出縮排
        const indent = match.match(/^(\s+)PackageList/m)?.[1] ?? '        ';
        return match.replace(
          /(\s+)\}/,
          `\n${indent}  add(WallpaperPackage())\n${indent}}`
        );
      }
    );

    mod.modResults.contents = contents;
    return mod;
  });
};
