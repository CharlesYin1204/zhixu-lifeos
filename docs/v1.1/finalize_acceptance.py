from pathlib import Path
from collections import Counter
import json,csv,subprocess,sys
B=Path(__file__).resolve().parent;D=B.parent
scene=json.loads((D/'tests/media-scenes-results.json').read_text());assert scene['summary']=={'passed':10,'failed':0,'expectedScenes':10} and not scene.get('acceptancePending')
assert all(r['passed'] for r in scene['results'])
release='.releases/20261014T135228Z-25423';health=json.loads((D/'tests/media-release-health.json').read_text());assert health['release']==release
patch=json.loads((B/'待同步验收修订.json').read_text());data=json.loads((B/'功能表数据.json').read_text());rows={r[0]:r for s in data['sheets'] for r in s['data']}
for key,u in patch['featureUpdates'].items():rows[key][8:10]=[u['status'],u['evidence']]
for key,u in patch['featureContractUpdates'].items():rows[key][5:7]=[u['behavior'],u['acceptance']]
sceneIds={'travel-talk':141,'interview':142,'study-qa':143,'speech-practice':144,'essay-review':146,'notes-organize':147,'chart-explain':148,'object-identify':149,'meal-log':150,'spoken-review':152}
for r in scene['results']:
 n=sceneIds[r['scene']];row=rows[f'F-{n:03}'];row[8]='真实场景样例已验证；物理设备未测'
 row[9]=f'media-scenes-results.json最终10/10，{r["scene"]}真实HTTPS/WSS样例通过，结果/来源或文字历史持久化与扣费有记录。输入为合成语音或自制/AI生成图片，非物理麦克风/相机；不代表所有自然输入准确率。'
 if r['scene']=='speech-practice':row[9]+=' 英文输入得到相关中文反馈，未承诺同语种回复，也未将转写作为发音/语调评测。'
 if r['scene']=='meal-log':row[9]='meal-log真实最终样例1/1：只列broccoli/tomatoes/rice，时段/实际食用量/感受均待补充，不展示raw JSON，历史和原图来源保留，30→29；unit11/11、contract4/4受控验证结构化校验/模板/无效输出退款。初次与prompt-only失败保留，不能保证所有输入永不出错。'
rows['F-172'][8:10]=['13场景均有真实样例证据；设备未测','原英语/拍题/课堂录音3场景，加media-scenes-results.json最终10/10，共13场景真实样例覆盖。补充测试累计6语音轮、9图像调用、1录音转写，16成功操作扣16点；初始harness和餐食质量失败保留。合成/生成输入不等于自然设备、全量准确率或人工听感。']
for row in rows.values():row[9]=row[9].replace('.releases/20261014T132650Z-20674',release)
(B/'功能表数据.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
with (B/'产品功能表.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(data['sheets'][0]['columns']);w.writerows(r for s in data['sheets'] for r in s['data'])
subprocess.run([sys.executable,str(B/'export_xlsx.py')],check=True)
(B/'implementation-status.json').write_text(json.dumps({'date':'2026-10-14','phase':'v1.1最终补充验收；13场景真实样例、状态/附件修复、受控后台契约均按证据区分','source':'最新生产/隔离/真实样例报告及保留的历史失败证据','features':[{'id':r[0],'status':r[8],'evidence':r[9]} for s in data['sheets'] for r in s['data']],'statusCounts':dict(Counter(r[8] for r in rows.values()))},ensure_ascii=False,indent=2))
p=B/'产品需求文档.md';s=p.read_text().replace('.releases/20261014T132650Z-20674',release).replace('database/backups/xuexi-2026-10-14T13-25-41-872Z.sql.gz','database/backups/xuexi-2026-10-14T13-54-10-210Z.sql.gz')
s=s.replace('代表性英语连续语音、拍题及追问、录音转写真实验证完成','13种媒体场景均已取得真实模型样例输出与持久化/扣费证据').replace('不将场景入口或合成音频当作所有场景或物理设备验证','真实调用使用合成语音、自制或生成图片，不等同物理设备、自然输入全覆盖或模型准确率保证')
s=s.replace('日程：支持标题、日期时间、类型、备注与完成状态，按当前用户展示。','日程：支持标题、日期时间、类型、备注与完成状态，按当前用户展示。用户可通过快捷操作或编辑表单完成/恢复日程，旧done兼容为已完成，全部/进行中/已完成筛选与手机操作保持一致。')
s=s.replace('删除附件应删除服务器私有资产及占用统计，历史引用显示已删除状态；已产生的独立笔记正文不应被未说明的附件删除顺带抹除。','删除附件会删除私有资产并释放占用；当前和历史预览/来源立即显示已删除，重载或导出不再提供失效URL，旧图片不会继续请求。转写和其他已产生的独立笔记正文保持，已删除来源保留标题但不可点击。')
s=s.replace('| 图片 | meal-log | 饮食记录助手 | 整理可见食物，重量/营养仅作明确标注的估计，不作诊断 |','| 图片 | meal-log | 饮食记录助手 | 结构化提取可见食物，由服务器模板整理记录；时段、实际食用量、个人感受待本人补充，建议与事实分开 |')
s=s.replace('其余场景内容、后台开关/音色完整操作及部分边界未逐项专项实测，功能表保留准确状态，独立供应商探测不替代平台集成证据。','其余十种场景已追加真实样例；后台开关/音色/模型绑定通过隔离MySQL与实际handler/service、mock上游传输测试，不能称实际浏览器点击或音色听感评估。仍未单独测试的边界在功能表明确保留，独立供应商探测不替代平台集成证据。')
s=s.replace('十三场景共用链路和入口验证完成，只有代表性英语、拍题、录音有真实输出证据，其他内容未逐场景调用。','十三场景现均有真实样例调用证据：原英语、拍题、课堂录音三种加补充报告十种。素材为合成英语音频、干净生成文字/图表、自制及AI生成图片，不代表真实麦克风/相机、手写或复杂自然照片的全面验证。')
s+='''

## v1.1 最终补充验收与质量修复

event-status-results.json8/8证明生产桌面/手机日程创建、快捷和表单完成/恢复、跨天字段持久化、旧done兼容及三种筛选；零AI与支付调用。media-attachments-backend-results4/4、API4/4、browser5/5证明图片/录音删除后当前及历史预览/来源显示已删除，bootstrap、records、export不返回失效URL，正文保留，手机刷新不再请求旧图。

restored-ui-results.json5/5在生产浏览器验证：服务器已提交订单后丢弃响应，再点击复用requestId，两提交仅一笔pending/manual订单、无付款；1505条记录按500/500/500/5自动全加载，最旧记录可查可编辑；本人来源可打开准确记录、已删除来源不可点击。admin-contract-results.json17项覆盖真实后台表单、角色/启停、套餐、审计与DB核对；media-settings-results.json8项是隔离MySQL+实际handler/service+mock provider，覆盖模型绑定、音色下一请求变化、开关拦截扣费前请求、默认模型替换及站点保存，不是八次真实模型调用或浏览器配置操作。

media-scenes-results.json最终新增十场景10/10，合并既有三场景后十三场景均有真实样例。新增测试累计6个语音轮次、9次视觉调用、1次录音转写，16次成功操作共扣16点；4个临时用户、10个上传资产及关联数据清零。三个早期语义断言过窄而中断的测试已保留初始失败及补测，不能与真实产品质量缺陷混同。

餐食真实样例另发现模型把未知午餐时段、口味或饱腹感写为个人经历，单纯提示词调整仍未解决；两个失败阶段保留。最终修复要求模型仅提供foods/uncertainties/general suggestions事实结构，经服务器校验后用固定Markdown模板展示；用餐时间、实际食用量、个人感受标待补充，不把JSON呈现给用户。非法结构或附加日记字段拒绝、退款且不存历史。meal-log-unit-results11/11为纯解析/模板边界，meal-log-contract-results4/4为实际服务与隔离DB加mock上游；media-scenes-meal-structured-results1/1为最终生产真实样例，正确列出米饭/西兰花/番茄，三个个人字段待补充，原图来源和历史保留、扣1点。该结论只覆盖本样例及契约边界，不保证所有食物识别、建议或未知细节永不出错。

最终release为.releases/20261014T135228Z-25423，media-release-health.json确认四入口200、web/worker/voice active/enabled；APK仍为已发布1.1.1(4)。最新受限数据库备份database/backups/xuexi-2026-10-14T13-54-10-210Z.sql.gz。真实收款商户资料、Android真机/自然采集设备、独立跨网络专项及六项原有P2边界不变。
'''
p.write_text(s)
p=B/'部署交付与验收报告.md';s=p.read_text().replace('.releases/20261014T132650Z-20674',release).replace('database/backups/xuexi-2026-10-14T13-25-41-872Z.sql.gz','database/backups/xuexi-2026-10-14T13-54-10-210Z.sql.gz')
s=s.replace('13种场景仅完成入口及共用链路验证，代表性英语、拍题、录音有真实内容证据，未逐一调用全部场景模型。','13种场景现均有真实样例内容证据：原3种加新media-scenes-results.json10/10。语音为合成英文，文字图表为干净生成图，物品/餐食为经目视检查的AI生成图片；这不证明所有自然输入准确率、手写/实拍能力或硬件效果。')
s=s.replace('## APK与外部边界','''## 追加验收与餐食修复

生产日程完成/恢复8项、附件删除后历史状态后台4/API4/浏览器5项通过。restored-ui5项真实浏览器证明丢响应重试只一笔未付款订单、1505记录全分页及精确本人来源导航。后台admin-contract17项浏览器/DB证据与media-settings8项受控服务证据分开记录；后者采用隔离MySQL、实际route/service及mock provider，包含模型/音色下一请求、三个开关、默认模型与站点配置，没有真实模型或浏览器配置调用。

新增十场景报告最终10/10，累计6语音轮、9视觉、1录音操作，扣16点且全部临时账号/资产清理。三个初始harness失败和补测保留。餐食另有真实质量缺陷：模型虚构了未提供的时段/感受，prompt-only复测仍失败；最终以结构化事实校验和服务端固定模板修复。unit11/11、受控service合同4/4及最终真实餐食1/1通过，时间/实际食用量/个人感受保持待补充，结果/来源持久化且扣1点。保留两阶段失败，不保证所有未来样本永不出错，不向用户显示raw JSON。

最新报告：event-status-results.json、media-attachments-backend-results.json、media-attachments-api-results.json、media-attachments-browser-results.json、restored-ui-results.json、admin-contract-results.json、media-settings-results.json、media-scenes-results.json、meal-log-unit-results.json、meal-log-contract-results.json、media-scenes-meal-structured-results.json。功能表172项按各报告实际范围更新。

## APK与外部边界''')
p.write_text(s)
patch.update(state='final_evidence_applied_ready_to_publish',release=release,releaseState='production_healthy',mealIssueNote='原始及prompt-only真实失败保留；结构化模板真实样例1/1及11/4项契约已通过，范围仅样例和所测边界。');(B/'待同步验收修订.json').write_text(json.dumps(patch,ensure_ascii=False,indent=2))
print('Applied 25 scoped evidence mappings, 10 real scene results and meal contract; 172 rows retained.')
