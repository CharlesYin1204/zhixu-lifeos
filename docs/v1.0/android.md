# 知序 LifeOS Android 客户端

客户端为实际可安装、带长期签名的原生 Android WebView APK，连接后台配置的网站。账户、AI 协作、会员、插件与用户中心均由同一服务器提供。移动端底部导航来自响应式网页。

## 构建

```bash
/opt/laosiji-runtime/node-v22.16.0-linux-x64/bin/node scripts/build-apk.mjs android/config.example.json
```

也可不传文件，通过 `APK_CONFIG_JSON` 提供 JSON 对象，或使用 `APK_APP_NAME`、`APK_VERSION_NAME`、`APK_VERSION_CODE`、`APK_SERVER_URL`、`APK_PACKAGE_ID` 环境变量。配置文件优先于环境变量。默认配置如下：

```json
{
  "appName": "知序 LifeOS",
  "versionName": "1.0.0",
  "versionCode": 1,
  "serverUrl": "http://154.40.47.111:3060",
  "packageId": "com.zhixu.lifeos"
}
```

后台必须验证管理员身份后调用构建器。推荐以 `process.execPath` 调用脚本，传独立配置文件绝对路径或 `APK_CONFIG_JSON` 环境变量；使用 `spawn` / `execFile` 参数数组，不要拼接 shell 命令。构建器同步完成后以退出码 0 表示成功，stdout 最后一行是 manifest JSON，错误写入 stderr 并返回非零退出码。构建有文件锁、参数校验及各子进程超时，APK 更新采用原子替换；失败不覆盖上次成功的 APK 和 manifest。

## 后台读取与下载

- 构建清单：`public/downloads/build.json`，包含五项配置、`buildStatus: "ready"`、`status: "ready"`、`downloadUrl`、`latestDownloadUrl`、`builtAt`、`size`、`sha256`、`certificateSha256`、SDK 版本和签名结果。
- 版本下载：`/api/download?file=zhixu-lifeos-{versionName}-{versionCode}.apk`。
- 最新版本：`/api/download?file=zhixu-lifeos.apk`。
- 新构建由后台保存其进行中或失败状态；本清单始终代表上次成功产物。
- 动态路由 `app/api/download/route.js` 只允许此应用 APK 文件名和 `build.json`，检查实际路径避免目录穿越或符号链接外跳，流式下载且禁用缓存，确保服务启动后生成的文件立即可下载。

## 环境与签名

复用已有 JDK 17、`/opt/gaoqiu-android/android-15` 中的 aapt/d8/zipalign/apksigner，以及 `/usr/lib/android-sdk/platforms/android-23/android.jar`。可用 `ANDROID_BUILD_TOOLS` 和 `ANDROID_JAR` 指定其他本地工具链，无需 Gradle 或完整 Android Studio。Java 子进程堆限制为 256MB。

`private/android-signing.jks` 和 `private/android-signing.pass` 首次构建自动生成，权限为 0600。必须一起备份到安全位置；勿放入 public、Git 或通过 API 返回。后续版本保留相同包名及签名密钥，并递增 `versionCode`，即可覆盖更新。改变包名会被 Android 视为另一款应用。构建锁 `private/apk-build.lock` 若因强制结束遗留，先确认对应 PID 已退出，再删除锁文件。

APK 的最低 Android 版本为 6.0（API 23），target SDK 为 28，定位为服务器直接分发版本；未配置应用商店发布流程。只声明网络访问权限，不申请定位、联系人、相机或存储等运行时权限。文件上传通过系统文档选择器完成。HTTP 网站按配置允许明文连接；HTTPS 证书错误会取消访问。应用只在 WebView 内打开配置地址同源链接，外部网址与 APK 下载交给系统浏览器，支持返回导航和网络故障重试页。

## 校验

```bash
/opt/gaoqiu-android/android-15/apksigner verify --verbose --print-certs public/downloads/zhixu-lifeos.apk
/opt/gaoqiu-android/android-15/aapt dump badging public/downloads/zhixu-lifeos.apk
TEST_BASE_URL=http://127.0.0.1:3061 /opt/laosiji-runtime/node-v22.16.0-linux-x64/bin/node --env-file=.env.local scripts/test-apk.mjs
```

自动验收脚本使用管理员环境凭据，通过后台重新构建当前版本，检查构建权限、构建状态、签名、包信息、下载哈希、非法配置保护、下载路径限制和配置的公网地址。它会创建后删除独立验收用户，不修改模型或支付配置。结果写入 `docs/tests/apk-results.json`；当前报告记录 1.0.1（versionCode 2）的十一项验收通过（含失败摘要、旧发布保留和非法配置保护），以及 `zhixu` 账号在 `ProtectSystem=strict` 下的构建证据。

服务器完成 APK 结构、DEX 编译、zip 对齐、v1/v2/v3 签名及哈希校验。真实 Android 设备上的安装、网页登录、返回、文件选择和系统浏览器下载仍需设备验收；服务器无 Android 模拟器。
