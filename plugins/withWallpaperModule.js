const { withMainApplication } = require('@expo/config-plugins');

module.exports = function withWallpaperModule(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;

    // 注入 import（找 package 宣告後第一個 import 前插入）
    if (!contents.includes('import com.nftwallpaper.app.WallpaperPackage')) {
      // 在第一個 import 行前面插入
      contents = contents.replace(
        /(import\s)/,
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
