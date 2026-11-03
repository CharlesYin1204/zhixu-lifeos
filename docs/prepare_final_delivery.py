from pathlib import Path
from collections import Counter
import json
B=Path(__file__).resolve().parent
mapping=json.loads((B/'implementation-status.json').read_text())
source=json.loads((B/'功能表数据.json').read_text())
rows={int(r[0][2:]):r for s in source['sheets'] for r in s['data']}
features={int(r['id'][2:]):r for r in mapping['features']}
for n,f in features.items():
 if n>=132: continue
 r=rows[n]
 component='Dashboard / LifeOS'
 if 5<=n<=10 or 70<=n<=74: component='PluginMarket / Membership / CheckoutModal'
 elif 11<=n<=13: component='Login / LifeOS'
 elif 14<=n<=16: component='APKDownload'
 elif 19<=n<=24 or 75<=n<=83: component='UserCenter / Membership'
 elif 25<=n<=59: component='RecordModal / RecordsPage / Knowledge / FocusTimer'
 elif 60<=n<=63: component='AIChat / RecordsPage'
 elif 64<=n<=69: component='AgentStudio'
 elif 84<=n<=115: component='Admin / AdminEditModal / AdminPayment / AdminAPK / AdminSiteSettings'
 f['status']='已实现，未单独专项实测'
 f['evidence']=f'静态确认 components/LifeOS.jsx 的 {component} 与 app/api/app/route.js 对应实现已包含「{r[3]}」；相关生产API与主要页面测试通过，本行完整操作链未单独专项实测。'
def setv(nums,evidence,status='已实现并验证'):
 for n in nums: features[n].update(status=status,evidence=evidence)
setv([1,2,3], 'browser-results.json 9/9：桌面首页与主要导航渲染；390px全部主要用户页面无整页横向溢出。desktop-overview.png / mobile-overview.png 已目视核验。')
setv([8,71,93,94,97], 'ui-flow-results.json：管理员创建插件version 1.2.3、改价7.31→9.37；用户按9.37下单、后台人工确认；详情展示流水与支付时间；已购重装不新增订单。真实商户收款不在此证据内。')
setv([11,13,20,25,26,35], 'browser-results.json：真实注册、创建任务、完成任务、刷新后会话和数据保持、新增知识笔记；api-results.json 16/16补充鉴权与数据持久化。')
setv([12], 'mobile-admin-results.json 3/3：390px真实公网地址浏览器通过键盘Enter提交登录表单并成功进入后台；regression-results.json覆盖错误密码和密码边界。')
setv([18], 'mobile-admin-results.json验证登录表单可用键盘Enter提交；components/LifeOS.jsx包含表单label、按钮aria-label及原生键盘可操作控件。未完成全站无障碍审计。','登录键盘操作已验证；其余未单独专项实测')
setv([14,15,16], 'ui-flow-results.json匿名访问APK页及下载成功；apk-results.json 11/11核验真实1.0.1(2)、com.zhixu.lifeos、minSDK23(Android6+)、签名及公开下载哈希。在线WebView，未测试真机安装。')
setv([21,22], 'ui-flow-results.json：用户中心学习成长、生活管理、AI与效率、账户与应用四组入口显示；browser-results.json覆盖全部主要用户页面。')
setv([23,125], 'browser-results.json与mobile-admin-results.json：390px主要用户页面及全部13个后台tab无整页横向溢出、底栏可见；mobile-user.png / mobile-admin.png 经目视核验。')
setv([29], 'ui-flow-results.json真实表单保存并重新打开计划起止日期、每日学习分钟；record-contract-results.json拒绝结束早于开始，11/11通过。')
setv([30], 'record-contract-results.json验证关联目标只能是本人且类型正确；目标完成状态与100%进度双向联动，创建/更新均验证。')
setv([32,34], 'ui-flow-results.json课程URL保存后重新打开保持，列表提供可点击外链且安全rel正确；api-results.json覆盖course记录持久化。')
setv([33,58], 'record-contract-results.json：课程/目标完成=100%，100%自动完成；创建和修改均通过，后端数据持久化正确。')
setv([36,38], 'api-results.json：本人知识笔记可修改并删除，数据隔离通过；browser-results.json已覆盖笔记新增。笔记编辑/删除的浏览器点击链未单独测试。','已实现，接口已验证')
setv([39], 'ui-flow-results.json：习惯每周5天频率保存、重新打开及列表展示保持；record-contract-results.json拒绝非整数与1–7范围外频率。')
setv([43], 'ui-flow-results.json：跨天日程2026-10-16 19:30→2026-10-17 10:15保存并重开保持；record-contract-results.json验证日期合法性、结束大于开始及跨天规则。')
setv([46,47,48], 'ui-flow-results.json使用受控浏览器时间验证真实25/5计时器开始/暂停/关闭重开、自动25分钟保存、5分钟休息不重复、手动1分钟保存；record-contract-results.json验证并发保存同一会话仅一条记录。')
setv([49,50], 'api-results.json收入/支出记录持久化；record-contract-results.json拒绝0与不足1分金额，1分存储为整数1。表单界面已实现，收支表单未单独浏览器实测。','已实现，接口已验证')
setv([53,54,55], 'ui-flow-results.json健康表单睡眠7.5小时、饮水1800ml、运动30分钟保存并重新打开保持；api-results.json覆盖健康记录持久化。')
setv([56], 'browser-results.json健康页面渲染与390px布局通过，ui-flow-results.json真实健康数据保存重开通过；健康界面仅提供记录/趋势，不给出诊断。')
setv([57], 'api-results.json真实创建goal记录持久化；record-contract-results.json验证目标状态进度与关联归属。目标表单UI单独创建链未专项覆盖。','已实现，接口已验证')
setv([61,62], 'api-results.json真实助手返回并保留本人历史且跨用户不可见；ui-flow-results.json实际浏览器获得135字模型回复，刷新后历史恢复，截图desktop-ai-real.png。')
setv([65,66,67,121], 'ai-workflow-results.json真实run dec971ee-b416-4537-a784-09d595e1c472：规划→三专家并行→审阅，56.6秒、5条调用8810 tokens、余额30→25、1594字结果；阶段时序与DB二次回读一致。')
setv([69], 'api-results.json与ai-workflow-results.json：本人五阶段运行/结果持久化，跨用户隔离与再次读取通过；browser-results.json协作页及后台监控tab显示。单条历史展开链未专项覆盖。','已实现，接口已验证')
setv([70], 'browser-results.json真实免费插件安装通过；api-results.json权限校验通过；lib/payments.mjs与路由对用户/插件唯一安装处理，重复安装专项链未单独覆盖。','已实现，安装已验证')
setv([73], 'ui-flow-results.json：用户在管理员确认付费订单后卸载并重新安装已购插件，未产生第二笔订单。')
setv([74], 'api-results.json真实执行已安装插件AI并将输出保存知识笔记；regression-results.json验证缺失Agent时拒绝执行。插件执行按钮点击链未单独浏览器覆盖。','已实现，真实AI接口已验证')
setv([75,76,77], 'api-results.json会员订单与人工支付权益发放通过；regression-results.json会员到期保留既有额度、管理员改会员行为通过；record-contract-results.json到期会员调额度不追加权益。会员购买UI未单独专项实测。','已实现，权益接口已验证')
setv([81,82,83], 'api-results.json个人资料更新、退出后原会话失效、记录/会话/运行跨用户隔离均通过；restart-results.json会话与数据在进程重启后保持。','已实现，接口已验证')
setv([84,117], 'api-results.json普通用户管理接口403；record-contract-results.json停用用户及停用管理员已有会话不可继续访问；browser-results.json与mobile-admin-results.json管理员真实登录后台成功。')
setv([86,87], 'record-contract-results.json后台禁用用户后会话失效、恢复后可用；API用户列表脱敏，browser-results.json后台用户tab渲染。管理员UI启停按钮链未单独专项实测。','已实现，管理接口已验证')
setv([92,96], 'ui-flow-results.json真实管理员插件列表/编辑及订单列表/确认/详情流程通过；mobile-admin-results.json全部13个管理tab在390px正常呈现。')
setv([79,98,101,124], '已实现支付宝/微信易支付兼容网关配置、订单与配置缺失保护。尚未提供网关URL、商户PID、商户Key，真实在线收款未启用；当前可人工确认。见lib/payments.mjs、AdminPayment及api-results.json。','已实现，真实收款待商户配置')
setv([99,100,123], 'api-results.json与regression-results.json：模拟有效签名通知、错误签名/金额、重复通知幂等、取消后晚到有效回调规则通过；未进行真实商户扣款。','签名与幂等已验证；真实收款待配置')
setv([103,119], 'api-results.json后台模型Key脱敏；deployment-results.json最终产物/public扫描无已配置密钥明文、公开页面与bootstrap不泄露；受限文件0600、目录0700。此为定向检查，不是全站渗透测试。')
setv([106], 'api-results.json管理员分别测试两个已配置真实模型，均返回有效文本与耗时；browser-results.json模型配置页面渲染。管理员测试按钮点击未单独专项覆盖。','已实现，真实模型接口已验证')
setv([109], 'API真实调用记录含模型/状态/用量；ai-client-results.json 9/9受控响应验证未知usage保留null、明确0保留0；生产schema默认NULL；browser-results.json AI调用记录tab渲染。')
setv([110,111,112,113,126], 'apk-results.json 11/11：普通生产服务账号zhixu后台构建building→ready，v1/v2/v3签名/对齐/包信息/下载SHA一致；非法配置400、构建失败错误摘要及旧发布包/元数据保留、路径穿越拒绝。真机未测。')
setv([116,118], 'api-results.json：不同用户记录、会话、协作运行隔离；付费插件必须获得权益，订单金额由服务端读取；ui-flow-results.json后台改价9.37后用户订单亦为9.37。')
setv([120,129], 'restart-results.json 4/4：部署重启web/worker PID变化，之前保存记录和session保持；SIGKILL网页进程后systemd自动拉起，原记录/会话仍可读取，公开IP健康200。')
setv([122], 'ai-client-results.json 9/9通过受控上游验证超时/重试/拒绝/空内容/截断/未知用量；regression-results.json验证协作预检、排队失败退款和幂等。故障注入为受控测试，非真实供应商事故。')
setv([127], 'APK真实构建、签名与下载已验证；当前没有连接Android真机或模拟器，设备安装/登录/返回/文件选择尚未验收。','待Android设备验收')
setv([128], '公开IP:3060浏览器/API/APK实测通过；external-traffic-observations.json记录排除本机地址后36次外部客户端2xx（首页5、API GET29/POST2）。独立受控浏览器跨网络验收未执行。','公开地址与外部访问日志已验证；跨网络专项未测')
setv([130,131], '已有真实飞书PRD与五张工作表137项；最终状态仅更新I:J，需求及六项P2定义保留；全文和137项全量回读与本地XML/JSON/CSV比对，XLSX另做包结构/XML校验。')
mapping.update(phase='最终生产交付；实现与已取得验收证据已逐项区分',source='2026-10-14最终测试报告、当前源码与飞书全量回读；旧审查仅历史快照',statusCounts=dict(Counter(f['status'] for f in features.values())))
(B/'implementation-status.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2))
manifest=json.loads((B.parent/'public/downloads/build.json').read_text())
paragraphs=[
'本节为2026-10-14最终交付证据快照。生产构建、网页/工作进程部署和最终专项验收已结束。功能表逐项区分已实测、已实现但未单独专项实测、外部依赖及六项原有P2规划；不以主要页面渲染代表每一细项端到端验证。',
'部署入口http://154.40.47.111:3060/，用户中心/?view=user，管理后台/?view=admin；代码/www/wwwroot/xuexi，MySQL业务库xuexi。配套飞书表格https://rjppwe2dlq09.jp.larksuite.com/sheets/[REDACTED_LARK_RESOURCE_TOKEN]，共5张表137项，最终I:J状态和证据已批量写入并全量回读；本地CSV/XLSX同步。',
'已实现注册登录和多用户隔离；任务、学习计划、课程、知识、习惯、日程、番茄专注、财务、健康、复盘；真实助手及多Agent；免费/付费插件安装、会员和订单；用户中心全部功能分组；后台用户/套餐/插件价格/支付/模型及Agent/协作和调用记录/APK/站点配置。专项UI已验证字段重开持久化、跨天日程、每周习惯频率、课程外链、25/5计时器、真实助手历史和付费插件人工确认后重新安装。',
'真实多Agent运行dec971ee-b416-4537-a784-09d595e1c472完成规划、study/life/wellness三专家并行及审阅，56.6秒、5条调用8810 tokens、余额30→25、1594字结果，数据库二次回读一致；两模型连通、单助手、插件AI执行及保存也有真实API记录。AI客户端9项为受控响应测试，不是9次真实供应商调用。',
'最终报告：API16/16、基础浏览器9/9、业务UI15/15、手机后台3/3、记录合同11/11、后端回归15/15、AI客户端9/9、APK11/11、重启恢复4/4、部署只读14/14通过。浏览器无JS异常，390px主要用户页和全部13个后台tab无整页溢出。重启及SIGKILL自动拉起后原数据和会话保持；证据在docs/tests，截图在docs/screenshots。',
'真实APK为联网WebView客户端1.0.1（versionCode2），包名com.zhixu.lifeos，最低Android6.0。普通生产服务账号后台构建、v1/v2/v3签名、对齐、下载哈希、失败摘要与旧发布包保留均通过。下载http://154.40.47.111:3060/api/download?file=zhixu-lifeos.apk；没有连接Android真机或模拟器，设备安装/登录/返回/文件选择未验收。',
'用户已选择支付宝/微信易支付兼容网关，但网关URL、商户PID和Key尚未提供，真实在线收款未启用。人工确认流程、服务端取价、签名/金额校验、幂等发放已测试；模拟签名通知不能代表实际商户收款。真实商户配置和一笔实际支付验收仍需完成。',
'公网IP浏览器/API/APK访问已通过；Nginx去除本机地址后已有36次外部客户端成功记录，详见external-traffic-observations.json，未记录客户IP。独立受控浏览器跨网络验收尚未执行，此日志也不代表Android真机测试。原有六项P2规划保持原定义；最终数据库备份为database/backups/xuexi-2026-10-14T12-32-36-012Z.sql.gz，gzip完整性已验证。']
(B/'交付验收段落.json').write_text(json.dumps(paragraphs,ensure_ascii=False,indent=2))
report='''# 知序 LifeOS 部署交付与验收报告

更新日期：2026-10-14（Asia/Shanghai）。生产构建、部署及最终专项验证已完成。功能表区分已实测与已实现但未逐项专项实测；不将137项统一标成全部验收通过。

## 访问与文件

| 交付项 | 位置 |
| --- | --- |
| 网站 | http://154.40.47.111:3060/ |
| 用户中心 | http://154.40.47.111:3060/?view=user |
| 管理后台 | http://154.40.47.111:3060/?view=admin |
| Android APK | http://154.40.47.111:3060/api/download?file=zhixu-lifeos.apk |
| 飞书需求文档 | https://rjppwe2dlq09.jp.larksuite.com/docx/[REDACTED_LARK_RESOURCE_TOKEN] |
| 飞书功能表 | https://rjppwe2dlq09.jp.larksuite.com/sheets/[REDACTED_LARK_RESOURCE_TOKEN] |
| 代码与数据库 | /www/wwwroot/xuexi；MySQL xuexi；database/schema.sql |
| 本地需求与表格 | docs/产品需求文档.md、产品功能表.csv、产品功能表.xlsx |
| 逐项状态及证据 | docs/implementation-status.json；137项，与飞书I:J一致 |
| 管理员登录资料 | 受限文件private/admin-credentials.txt；公开文档不包含凭据 |

## 产品能力

React前端与Next.js/Node.js后端已部署。前台有产品工作台、插件搜索分类、会员方案、登录注册及Android下载。用户中心包含学习成长、生活管理、AI与效率、账户与应用四组全部功能入口，个人资料、会员及AI余额、本人订单与导出。

学习生活模块包括任务、目标式学习计划、课程资源与进度、知识笔记、习惯频率与打卡、跨天日程、25/5番茄专注、收支记账、饮水/睡眠/运动、目标和复盘。管理员可管理用户、角色、会员套餐、插件和价格、订单、支付、AI模型及Agent、协作与调用记录、APK构建发布及站点设置。功能已实现但未单独专项实测的行在表格明确标注。

## 真实AI与插件交易

两个配置模型的管理员接口测试、单助手回复/历史/隔离、插件AI执行及结果保存已有真实模型响应。浏览器也已验证实际助手回复和刷新后的历史恢复。

真实多Agent运行dec971ee-b416-4537-a784-09d595e1c472完成规划→study/life/wellness三专家并行→审阅；约56.6秒，五条调用共8810 tokens，余额30→25，输出1594字。专家时间重叠，审阅在专家全部完成后开始；数据库二次回读一致。该运行与调用记录作为审计证据保留，测试账号已停用。

真实浏览器交易链已验证管理员插件7.31→9.37改价、用户9.37下单、管理员人工确认和订单流水详情、已购卸载重装不再付费。易支付签名/金额校验及幂等使用模拟通知测试，没有发生真实商户收款。

## 最终测试结果

| 证据（docs/tests） | 结果 | 覆盖与限制 |
| --- | --- | --- |
| api-results.json | 16/16 | 两真实模型、单助手、插件、多Agent、权限隔离、订单与模拟回调、记录与会话 |
| browser-results.json | 9/9 | 桌面及390px主要页面、注册/任务/笔记/免费插件、后台tab；无JS异常 |
| ui-flow-results.json | 15/15 | 13业务流程及无JS异常/清理检查；字段持久化、习惯频率、跨天日程、25/5计时、真实AI历史、插件价格与人工订单 |
| mobile-admin-results.json | 3/3 | 键盘Enter登录、390px全部13个后台tab与底栏、无JS异常 |
| record-contract-results.json | 11/11 | 归属、日期、进度联动、金额、频率、focus幂等、停用与会员额度 |
| regression-results.json | 15/15 | 密码边界、队列/额度/退款、并发、支付幂等、会员和记录校验 |
| ai-client-results.json | 9/9 | 受控上游错误/重试/拒绝/截断/未知usage；非九次真实模型调用 |
| ai-workflow-results.json | 五阶段真实完成 | 三专家并行、审阅、用量/余额/持久化 |
| apk-results.json | 11/11 | 服务账号后台构建、签名、下载、错误摘要与旧发布保留、非法配置和路径 |
| restart-results.json | 4/4 | 部署重启和SIGKILL恢复后数据/session保持、IP健康200 |
| deployment-results.json | 14/14 | 非root服务、沙箱、Nginx、定向密钥泄漏扫描；不是全站渗透测试 |
| external-traffic-observations.json | 36次外部2xx | 排除本机后的Nginx流量证据；非受控跨网络浏览器验收 |
| 飞书最终状态验证.json | 137项一致 | 五张表全量回读，本地JSON/CSV/XLSX同步 |

截图位于docs/screenshots，含desktop-overview.png、desktop-user.png、desktop-admin.png、desktop-models.png、desktop-ai-real.png、mobile-overview.png、mobile-user.png、mobile-admin.png。生产最终构建通过，未修改构建后业务代码。

## APK

在线WebView客户端1.0.1（versionCode2），com.zhixu.lifeos，最低Android6.0。普通生产服务账号zhixu通过后台触发building→ready；v1/v2/v3签名及下载一致。最近构建时间：BUILD_AT。SHA-256：`APK_SHA`。此构建和签名证据不代替真实设备验收。

## 外部验收边界

1. 真实在线收款未启用：支付宝/微信易支付兼容渠道已确定，仍缺网关URL、商户PID和商户Key。配置真实商户并完成一笔真实支付后方可验收。当前支持管理员核实后的人工确认流程。
2. Android真机尚未验收：无连接真机或模拟器。安装、登录、返回、文件选择及系统浏览器跳转待设备验证。
3. 公网外部访问日志已有成功记录；独立受控浏览器跨网络验收未执行。服务器通过自身公开IP进行浏览器/API/APK验收成功，外部日志36次2xx另提供实际可达证据；不能把这些作为真机测试。

原有六项P2规划：视频托管、附件向量检索、家庭/团队共享、退款对账、插件开发者SDK、原生离线同步。保留原定义，未计为一期已完成。

## 部署与维护

Nginx监听3060转发127.0.0.1:3061；zhixu-web.service提供页面/API，zhixu-worker.service处理持久化多Agent队列，两者均为普通zhixu账号并启用自启动。重启数据保持与进程异常后自动拉起已实测。

最终数据库备份：/www/wwwroot/xuexi/database/backups/xuexi-2026-10-14T12-32-36-012Z.sql.gz，gzip完整性通过。运维步骤见根目录README.md，APK见docs/android.md；加密主密钥、APK长期签名资料及凭据仅存受限目录并应独立备份。后台可更新APK地址/版本并重新构建发布。
'''
report=report.replace('APK_SHA',manifest['sha256']).replace('BUILD_AT',manifest.get('builtAt','2026-10-14T12:31:24.137Z'))
(B/'部署交付与验收报告.md').write_text(report)
p=B/'android.md'; p.write_text(p.read_text().replace('的九项验收通过','的十一项验收通过（含失败摘要、旧发布保留和非法配置保护）'))
print(json.dumps(mapping['statusCounts'],ensure_ascii=False))
