# Android 客户端 v1.1.1

当前发布1.1.1（versionCode4），包名com.zhixu.lifeos，最低Android6.0/API23，target28，为联网WebView客户端。地址为https://154.40.47.111:3063；网站地址、版本及应用名称可由后台配置并重新构建。下载：https://154.40.47.111:3063/api/download?file=zhixu-lifeos-1.1.1-4.apk。

后台管理员触发构建，普通zhixu服务账号完成Java/DEX、资源打包、zipalign及长期密钥签名，状态building→ready；失败报告摘要且保留真实已发布包和元数据。最新发布通过android-release-results.json12项检查，v1/v2/v3签名有效，下载与manifest哈希一致。

SHA-256：1f24d229fd2319628ccf3a7570fd9acc9da48a06f59438edb953cf5c05427601；文件29149字节。证书指纹fa8b1161063c978964b42700a09e8371905b84b28557fbfb4efef7fce2db0420。继续更新必须保留包名及private/android-signing.jks、private/android-signing.pass，并递增versionCode；私有签名文件0600，不经公开API返回。

录音/拍照由用户触发后请求RECORD_AUDIO/CAMERA运行时权限；WebView仅将需要的能力授予配置同源页面，拒绝授权后可重新操作或上传已有文件。高清相机使用非导出私有FileProvider和临时受限URI，保存/恢复页面状态。HTTPS证书错误不绕过，外部网址由系统浏览器处理。

本地录音blob和私有附件可通过Android Storage Access Framework保存；blob采用有界分块传递，错误/取消时清理，原生携带Cookie下载限定同源且不跟随重定向，无暴露JavaScript bridge。android-download-boundaries.json4项为实际嵌入脚本在受控Blob/FileReader适配环境执行、源码边界检查及API23 Java编译，并非Android真机执行。

服务器没有连接Android真机或模拟器。设备安装、麦克风/相机权限、拍摄、录音听感、返回/恢复和文件保存均未完成物理设备验收；不能用APK结构和浏览器虚拟音频代替。

构建工具仍采用服务器已有JDK17与Android build tools，无需新增完整Android Studio。后台构建与下载的维护命令和可配置路径见根README及scripts/build-apk.mjs。代码、数据、媒体文件和签名应分别备份，任何备份都不得放到public目录。
