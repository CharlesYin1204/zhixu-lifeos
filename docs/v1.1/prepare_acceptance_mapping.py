from pathlib import Path
import json
B=Path(__file__).resolve().parent
updates={}
def put(ids,status,evidence):
 for n in ids:updates[f'F-{n:03}']={'status':status,'evidence':evidence}
put([43],'已实现并验证','event-status-results.json8项生产浏览器通过：新建默认进行中并可显式完成；跨天日期保留，完成/恢复后重载一致。原记录合同报告继续证明日期合法性与结束大于开始。')
put([44],'日程日期/状态列表已验证','event-status-results.json：桌面与手机全部/进行中/已完成筛选正常，跨天日期详情保持；旧done显示已完成且可恢复，无横向溢出。未把此项扩称所有时区转换专项验证。')
put([45],'编辑及完成/恢复已浏览器验证','event-status-results.json8/8：快捷及编辑表单完成/恢复，重载保持状态和日期，兼容旧done；生产桌面/手机通过，零AI/支付调用。删除功能已实现，独立删除点击链未在该报告测试。')
put([61],'真实助手及来源导航已验证','既有真实模型/会话与隔离证据保留；restored-contract14项验证本人来源及持久化，涉及模型传输受控；restored-ui5项生产浏览器点击来源打开准确本人记录，已删除来源保留标题且不可点击。该来源导航测试不产生AI调用。')
put([85],'统计浏览器与数据库核对通过','admin-contract-results.json共17项通过，其中只读后台总览核对实际用户数、订单数、已付收入与协作运行数一致。此行仅按报告列出的计数证明，不扩称每个统计口径均专项核对。')
put([86],'用户管理浏览器与接口已验证','admin-contract-results.json真实管理员UI搜索/编辑姓名、会员到期与精确AI余额并持久化；先前API脱敏和数据权限通过。仅使用临时账号，无真实收费或AI调用。')
put([87],'账号启停浏览器与接口已验证','admin-contract-results.json真实UI停用临时账号后原会话失效且不能登录，恢复后可新登录；record-contract报告补充停用管理员敏感接口阻止。')
put([88],'角色管理浏览器已验证','admin-contract-results.json临时普通用户提升/降级后实际后台页面访问立即改变；普通账号不能访问管理API。未修改用户既有账号角色。')
put([89,90],'套餐表单与持久化已浏览器验证','admin-contract-results.json：创建/编辑临时套餐，价格、周期、额度和多行权益保存重开一致；前台使用同一配置。该报告不收款，也不将表单保存等同真实支付。')
put([91],'套餐启停与前台卡片已浏览器验证','admin-contract-results.json：停用临时套餐后用户购买卡片消失，启用后恢复；真实付款未测试，服务端新单启用校验继续按实现及既有接口证据标注。')
put([102],'模型表单及参数库/API已验证','admin-contract17项：真实UI拒绝空Key、创建临时模型并加密存储、重开不泄密；restored-contract14项验证temperature/maxTokens边界/清空与受控参数透传。没有新增真实模型连通调用或参数表单逐值专项。')
put([103],'密钥表单/存储/脱敏已验证','admin-contract17项验证临时模型Key加密入库、重开不返回原值，22次临时管理操作审计不含Key；原公开产物定向扫描证据保留。不是全站渗透测试。')
put([104],'模型启停UI及受控服务验证','admin-contract真实UI启停临时模型；media-settings8项隔离MySQL+实际handler/service验证停用绑定模型后能力不可用且上游调用0次。后者使用mock传输，不是真实供应商调用。')
put([105],'默认模型替换受控验证通过','media-settings-results.json8项中：实际配置handler替换默认模型、清除旧默认，下一次普通chat服务调用命中新默认。使用隔离MySQL与mock provider；没有该动作浏览器或真实模型调用证明。')
put([114],'站点展示UI与保存handler已验证','admin-contract只读浏览器字段与既存值一致；media-settings8项隔离MySQL实际handler保存4个站点字段并由公开bootstrap读取，媒体/支付配置不被覆盖。未改生产共享站点设置，不冒称真实浏览器保存测试。')
put([115],'审计浏览器与凭据脱敏已验证','admin-contract-results.json：22次临时管理动作，审计UI展示操作主体与目标标识，未包含测试Key明文；原账号/配置字节保持且fixture清理。')
put([156],'附件删除历史状态已全面验证；资产分页UI未专项','media-attachments后台4/API4/浏览器5项：本人预览/链接有效，删除当前图片即时切为已删除、来源不可点击，手机重载不请求旧图片；录音删除移除笔记下载URL但保留正文。100MB配额隔离证据保留，完整附件库分页UI未独立覆盖。')
put([158],'真实媒体历史及删除占位已验证','既有真实语音历史和图片追问通过；media-attachments-browser5项验证删除当前/历史图片后预览和来源显示已删除且正文不丢失，手机刷新无旧图请求。新增删除测试零provider调用。')
put([160],'本人来源定位与删除状态已浏览器/API验证','restored-ui5项来源链接定位准确本人记录、已删除来源保留标题无可点击链接；media-attachments后台4/API4/浏览器5项涵盖图片和音频、bootstrap/records/export去除失效URL且保留转写正文。输入资料展示不冒称逐句引用。')
put([161],'模型绑定/权限受控验证；原显示UI已验','media-settings8项：隔离MySQL+实际route/service，普通用户403、无效模型/用途拒绝，4模型绑定改变后下一次服务请求使用新值。8个上游请求被mock捕获，无浏览器或实际provider推理；原媒体后台绑定显示已浏览器验收。')
put([162],'三种开关保存/执行拦截受控验证','media-settings8项：三个能力独立开关保存回读；关闭图像/录音/已连接语音时，在模型请求和额度预留前阻止，providerCalls=0且余额不变。隔离表及actual handler/service验证，不是实际浏览器点击或真实模型调用。')
put([163],'音色配置与下一请求受控验证','media-settings8项验证无效音色原子拒绝，alloy→nova保存后下一次实际合成服务调用携带新voice；provider传输mock捕获，不宣称真人听感或两音色真实生成对比。')
put([164],'订单重试幂等库层与生产UI已验证','order-idempotency14项隔离表并发/快照/409通过；restored-ui5项真实浏览器在服务器已创建订单后丢弃响应，再次点击复用同requestId，两提交仅1笔pending/manual订单，paidOrders=0，无实际收款。')
put([165],'1505条完整自动分页已API/浏览器验证','restored-contract API及restored-ui生产浏览器共同验证500/500/500/5四页完整加载1505条、不重复漏失，最旧记录可搜索和编辑；全库统计与cursor归属隔离仍有原API证据。')
payload={'state':'prepared_pending_remaining_media_scene_reports','release':'.releases/20261014T134144Z-23058','featureUpdates':updates,'reports':{'event-status-results.json':8,'media-attachments-backend-results.json':4,'media-attachments-api-results.json':4,'media-attachments-browser-results.json':5,'media-settings-results.json':8,'admin-contract-results.json':17,'restored-ui-results.json':5},'explicitScopeNotes':['media-settings uses isolated database and actual handler/services with mocked provider; no browser or real inference','restored-ui uses production browser but zero payment or AI call','media scene final per-scene output awaits final report; initial harness failures retained','No physical microphone/camera/Android device acceptance','Six existing P2 rows unchanged']}
(B/'待同步验收修订.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2));print('Prepared',len(updates),'precise feature evidence updates; no online mutation.')
