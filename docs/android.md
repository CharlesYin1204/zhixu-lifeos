# Android 客户端 v1.1.2

当前发布1.1.2（versionCode5），包名com.zhixu.lifeos，最低Android6.0/API23，target28，为联网WebView客户端。默认站点为https://xuexi.yinchao1204.vip/；网站地址、版本及应用名称可由后台配置并重新构建。下载：https://xuexi.yinchao1204.vip/api/download?file=zhixu-lifeos-1.1.2-5.apk。

后台管理员触发构建，普通zhixu服务账号完成Java/DEX、资源打包、zipalign及长期密钥签名，状态building→ready；失败报告摘要且保留真实已发布包和元数据。旧1.1.1由android-release-results.json记录12项检查；当前1.1.2的实际构建、签名、元数据及下载核对见apk-startup-release-results.json。工具未执行Android真机或模拟器运行验证；用户另行反馈同机覆盖安装1.1.2后首页正常显示，仅确认安装启动首页。

SHA-256：a586925eba35f322a61b0b9724c0b978e0a9f7a29dad2d3b81bf49e0feb59404；文件33245字节。证书指纹fa8b1161063c978964b42700a09e8371905b84b28557fbfb4efef7fce2db0420。继续更新必须保留包名及private/android-signing.jks、private/android-signing.pass，并递增versionCode；私有签名文件0600，不经公开API返回。

录音/拍照由用户触发后请求RECORD_AUDIO/CAMERA运行时权限；WebView仅将需要的能力授予配置同源页面，拒绝授权后可重新操作或上传已有文件。高清相机使用非导出私有FileProvider和临时受限URI，保存/恢复页面状态。HTTPS证书错误不绕过，外部网址由系统浏览器处理。

本地录音blob和私有附件可通过Android Storage Access Framework保存；blob采用有界分块传递，错误/取消时清理，原生携带Cookie下载限定同源且不跟随重定向，无暴露JavaScript bridge。android-download-boundaries.json4项为实际嵌入脚本在受控Blob/FileReader适配环境执行、源码边界检查及API23 Java编译，并非Android真机执行。

服务器没有连接Android真机或模拟器，工具报告未做设备运行测试。用户已单独确认同机覆盖安装1.1.2后首页正常显示；登录、麦克风/相机权限、拍摄、录音听感、返回/恢复、文件保存和支付等未在该反馈中验收，不能用APK结构和浏览器虚拟音频代替。

构建工具仍采用服务器已有JDK17与Android build tools，无需新增完整Android Studio。后台构建与下载的维护命令和可配置路径见根README及scripts/build-apk.mjs。代码、数据、媒体文件和签名应分别备份，任何备份都不得放到public目录。

新1.1.2(5)已改为默认域名HTTPS；旧1.1.1包仍内置IP HTTPS，旧包与IP站点继续保留。新原生错误处理需要安装新包才生效，签名与包名保持以支持覆盖升级。

## 加载失败与本轮验收

当前已发布Android1.1.2（versionCode5），下载https://xuexi.yinchao1204.vip/api/download?file=zhixu-lifeos-1.1.2-5.apk，默认站点从旧IP3063改为首选域名HTTPS。保留com.zhixu.lifeos包名及同一长期签名，支持覆盖升级，旧1.1.1文件继续保留。新增主页面网络/HTTP/TLS失败、加载超时和空页面就绪检查的原生诊断、重试及系统浏览器打开；子资源失败不会隐藏正常主文档，TLS错误仍取消连接，诊断只展示站点与原因，移除URL查询/片段/用户信息。恢复历史仅接受当前配置同源，避免升级后恢复旧IP页。用户先确认同一手机浏览器可以打开域名，随后确认同机覆盖安装1.1.2后“首页正常显示”；这确认新版安装启动首页，不延伸到录音、拍照、支付或其他设备功能。旧APK空白/网页不可用的设备根因仍未确认。

apk-startup-release-results.json五组实际验证通过：管理员API异步构建building→ready、相同证书与v1/v2/v3签名及对齐、Manifest/DEX中的新域名/启动/媒体权限、版本化下载与latest别名及manifest字节一致、前台版本更新与旧产物保留；其他站点/支付/模型配置未变。新文件33245字节，SHA-256为a586925eba35f322a61b0b9724c0b978e0a9f7a29dad2d3b81bf49e0feb59404，证书SHA-256为fa8b1161063c978964b42700a09e8371905b84b28557fbfb4efef7fce2db0420。android-startup-results.json16项使用从真实MainActivity原样提取的方法/回调及确定性替身在JVM执行，并将完整源码编译到API23；覆盖主/子资源错误、TLS取消、空页面/超时、重试、过期回调、生命周期、旧IP恢复拒绝及诊断脱敏，但替身不实现Android/Chromium/TLS，DOM结果是受控值，不能称真机或模拟器测试。apk-previous-startup-audit.json仅排查旧包签名/启动/API23符号，未定位设备白屏根因。apk-domain-browser-results.json另有2项只读页面检查：使用手机视口和已观察到的Android16/Chrome138 User-Agent字符串访问域名首页与/login，实际引擎为Chromium156，页面200且有可见内容、无脚本错误或失败请求；未登录、未修改业务数据，不等同Android WebView运行。上述工具未执行真实Android安装/覆盖升级/页面渲染、录音相机或错误按钮操作；deviceTested:false保留为工具执行范围。apk-user-device-acceptance.json记录用户随后反馈同机覆盖安装1.1.2后首页正常显示，单独作为用户安装启动首页验收；不表示登录、录音、拍照、支付、错误按钮、状态恢复等真机功能已验收。Web保持.releases/20261014T152414Z-38684，最新受限备份database/backups/xuexi-2026-10-14T15-40-00-663Z.sql.gz；原支付商户及六项P2边界不变。
