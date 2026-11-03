# v1.1 正式交付与补充验收

最终web已部署.releases/20261014T152414Z-38684，首选https://xuexi.yinchao1204.vip（原IP HTTPS3063保留），APK1.1.2(5)。原飞书需求文档与五张功能表已正式同步；本目录是当前正式版本记录，上一级同名文件为交付入口。

功能表172项，六项P2未改；本次只修订已有功能与证据，没有新增需求行。在线PRD revision108，32章、134个顶层正文段落、1张场景表，全文与本地XML一致。172行A:J全量回读、CSV/XLSX逐值一致；344个状态/证据格无截断。

本轮补充日程8、附件backend4/API4/browser5、restored-ui5、admin-contract17、media-settings8项；模型配置专项使用隔离MySQL/actual handler/service及mock传输，不是自然设备或真实供应商调用。其余十媒体场景10/10加原三场景后，13场景均有真实样例；素材仍为合成语音、自制图和AI生成图。餐食原始/prompt-only失败保留，结构化模板unit11、contract4和最终真实1项通过，结论限于所测样例与契约。

当前精确映射及回读：待同步验收修订.json、飞书待同步清单.json（名称保留，内部均为published_and_full_readback_verified）、最终回读验证.json。旧范围修订哈希及恢复审计保留。merchant资料、Android媒体及自然采集设备、独立跨网络边界保留；用户已确认1.1.2覆盖安装后首页正常显示。

此前已完成后台/admin、/admin/login与个人/user、/login的页面、导航、API和会话分离；原十四个后台模块保留，新增后台账户入口。2026-10-14已完成用户中心与管理员后台分离：/user、/login使用个人导航与/api/app，/admin、/admin/login使用独立后台导航与/api/admin，数据库scope和Cookie均分开。原十四个管理模块保留，另设“后台账户”修改名称和密码；双端分别登录退出，同一账户改密码撤销全部旧会话。portal-separation-results.json在UI发布144931上完成17项生产Chromium156检查，包括15个后台section在1440/390/360px的45组导航布局、22个个人入口、旧地址跳转、刷新/前进后退、双端账户及会话边界、后台改密码；零页面异常、零后台个人数据请求。该版本发现HTTPS Cookie未标Secure，修复后最终145454上的portal-cookie-results.json六项实测通过，包含两端真实HTTPS浏览器登录与HTTP API兼容。UI未因Cookie补丁更改；不把此前17项写成最终版本完整重跑。

本轮已完成公开首页与登录后用户功能分离。2026-10-14已将/改为公开产品落地页；登录后访问/仍显示公开介绍，/login为独立登录注册页。个人侧栏、搜索、通知和五项功能底栏仅在有效用户会话下的/user中展示；/user默认全部功能中心，个人概览为/user?view=overview，媒体为/user?view=media。所有个人功能使用/user?view=...，旧/?view=...兼容跳转；/user具备服务端和客户端双重登录检查，只有管理员会话不能进入。公开首页展示学习生活、多Agent分工、13场景、当前启用会员价格和真实APK；插件目录/分类/搜索按本次要求改为登录后访问。后台/admin与/admin/login保持上一轮独立框架和会话。

上一轮修复首选域名访问。首选地址现为https://xuexi.yinchao1204.vip，无需端口，/为公开落地页，/login与/user为用户入口，/admin/login与/admin为独立后台。此次无法打开的原因是域名代理把明文HTTP发到IP的TLS3063端口，导致上游400；现已改为本机HTTP应用端口127.0.0.1:3061并保留原Host。域名及IP代理一并纳入发布切换/配置恢复；媒体受控来源增加首选域名并兼容既有IP。域名与IP按主机分别建立会话，账号和数据库不变。APP_URL及易支付通知URL保留原HTTP IP，现有APK1.1.1(4)仍加载IP HTTPS，该轮未重建APK。

当前Android发布1.1.2(5)，用户同机覆盖安装后已确认首页正常显示。当前已发布Android1.1.2（versionCode5），下载https://xuexi.yinchao1204.vip/api/download?file=zhixu-lifeos-1.1.2-5.apk，默认站点从旧IP3063改为首选域名HTTPS。保留com.zhixu.lifeos包名及同一长期签名，支持覆盖升级，旧1.1.1文件继续保留。新增主页面网络/HTTP/TLS失败、加载超时和空页面就绪检查的原生诊断、重试及系统浏览器打开；子资源失败不会隐藏正常主文档，TLS错误仍取消连接，诊断只展示站点与原因，移除URL查询/片段/用户信息。恢复历史仅接受当前配置同源，避免升级后恢复旧IP页。用户先确认同一手机浏览器可以打开域名，随后确认同机覆盖安装1.1.2后“首页正常显示”；这确认新版安装启动首页，不延伸到录音、拍照、支付或其他设备功能。旧APK空白/网页不可用的设备根因仍未确认。
