from pathlib import Path
import json,csv,subprocess,sys
B=Path(__file__).resolve().parent;D=B.parent
p=B/'功能表数据.json';d=json.loads(p.read_text());rows={r[0]:r for s in d['sheets'] for r in s['data']}
def change(ids,status,evidence):
 for n in ids:
  r=rows[f'F-{n:03}'];r[8]=status;r[9]=evidence
change([61],'已部署；资料来源库/handler已验证','restored-contract-results.json14/14：上下文仅含本人记录、chat来源随历史持久化且跨用户拒绝；使用受控AI传输，新增来源展示浏览器专项尚未提供。原真实助手及145/156导航证据保留。')
change([102],'已部署；模型参数库/API已验证','restored-contract-results.json lib4+API/handler10：温度和maxTokens保存读取/清空/非法值拒绝，显式预算不暗增；参数传输使用受控AI响应，管理表单专项未单独报告。')
change([93],'已部署；插件排序API已验证','restored-contract-results.json：sortOrder写入SQL且目录排序一致，-90/10/50顺序正确，3个非法值拒绝；原版本/价格UI验收保留。')
change([95,73],'已部署；下架/停用接口与handler已验证','restored-contract-results.json：下架已购仍可重装，未购不可新购/安装；下架运行保存笔记与来源，安全停用阻止运行安装。运行部分使用真实鉴权/DB与受控AI传输，不宣称本轮真实模型调用。')
change([138],'HTTPS基础设施已验证','https-readiness.json11/11：同IP可信证书、安全上下文、3063可用及3060保留；media-browser-results.json在HTTPS上执行真实浏览器采集API。物理麦克风/相机未测。')
change([139],'已部署并验证入口与场景目录','media-browser-results.json9/9：HTTPS展示13场景、用户中心分别进入三类工作区，手机布局和底栏正常，无浏览器异常；各场景实际模型输出另行验证。')
for n in range(140,153):
 r=rows[f'F-{n:03}'];r[8]='已部署；场景入口已验证，真实输出待专项';r[9]=r[9].split('；本行场景')[0]+'；media-browser-results.json验证13场景配置/入口，尚不能据此声称本场景真实输出通过。'
change([153],'已部署；连接/控制已验证，真实语音链路待验收','media-browser-results.json：生产WSS连接、静音/打断/结束及离开释放麦克风通过；实际getUserMedia/AudioWorklet输入为静音测试WAV，无声学硬件或真实回答。media-backend-results.json另有受控VAD/取消状态机证据。')
change([154],'已实现；单句限制隔离验证，完整会话待专项','media-backend-results.json12/12含VAD短噪声忽略、700ms静音断句和长语音边界；20分钟会话上限未提供独立生产计时报告。')
change([155],'已部署；录音浏览器流程已验证，转写链路待验收','media-browser-results.json：实际MediaRecorder暂停/继续、试听、上传前删除通过；输入为测试静音WAV，不是物理麦克风。backend验证真实MP3解码归一化；最终真实转写保存待报告。')
change([156],'已部署；私有上传/删除与配额隔离验证','media-browser-results.json真实图片选取、上传、预览和删除通过；media-backend-results.json验证本人私有WebP、并发100MB配额锁、删除后历史链接缺失。折叠附件库完整列表UI另按最终报告标注。')
change([157],'已部署；图片选取上传预览与限制已验证','浏览器测试真实图片文件选择、预览和删除；backend12项覆盖解码重编码、魔数/损坏/字节超限拒绝。拍摄真实硬件与每个像素/多图边界未逐项实测。')
change([158],'已部署；媒体历史持久化待真实专项','相关mediaConversation/mediaHistory及媒体UI已实现；浏览器静音测试不产生AI轮次，不能证明真实媒体回答历史。')
change([159],'已实现；额度状态机隔离验证','media-backend-results.json：预留额度重复失败仅退一次；有效回复前打断取消并退款；已有有效文本后TTS失败保留历史且不退已完成轮次。真实媒体请求扣费待专项。')
change([160],'已部署；记录来源接口验证，媒体来源待真实专项','restored-contract-results.json14/14：本人来源隔离、chat历史来源及协作结果保存笔记来源通过；AI采用受控传输。媒体图片/音频来源完整链路待真实报告。')
change([161],'已部署；后台模型绑定展示已验证','media-browser-results.json后台媒体设置展示实际模型绑定及合法capability；供应商ASR/TTS/vision独立探测成功。管理员保存新绑定并执行的完整链路未单独验收。')
change([162,163],'已部署，未单独专项实测','媒体后台及服务端开关/音色配置代码已实现，browser测试仅确认实际绑定和用途展示；开关绕过拒绝、音色切换下一轮真实生成尚无单独报告。')
change([164],'幂等库层14项已验证；生产提交UI待专项','order-idempotency-results.json14/14隔离表：16并发6连接只一单、用户范围与冲突409、快照/已付取消保持；模拟网关，真实付款0次。正式前端已携带requestId。')
change([165],'已部署；1505条分页与全库统计API验证','restored-contract-results.json：1505条分500/500/500/5页，无重复遗漏；统计tasks500/completed250/focus2010，cursor隔离通过。浏览器1505条自动加载未单独测试。')
change([166],'已部署；异常meta读写API已验证','restored-contract-results.json：6条旧异常meta安全读取，8类新非法输入拒绝，合法checkedDates去重。')
change([167],'1.1.0已构建验证；最终1.1.1待发布','apk-results.json当前1.1.0(3)12/12：HTTPS3063、签名/包信息/下载一致、媒体权限及provider/恢复DEX检查；计划补blob/私有附件SAF下载后发布1.1.1(4)，不可用旧包证据替代。')
change([168],'APK权限结构已验证；新版及真机待验收','1.1.0清单/DEX检查同源权限、非导出provider、受限URI与状态恢复通过；1.1.1本地录音blob及私有附件SAF保存待最终构建。无Android设备，真实权限/录音/拍照未测。')
change([169],'原生Realtime失败已确认；串联语音待真实集成','media-provider-probe.json：原生握手后account_deactivated无音频；whisper-1、gpt-4o-mini视觉、TTS MP3真实成功，media-pcm-probe.json PCM200。生产自有WSS已连接，真实音频轮次待报告。')
change([170],'后端隔离12项已验证；生产边界待专项','media-backend-results.json：owner跨用户读取/删除隔离、真实格式解码、并发配额与退款、WS需活动会话与显式许可Origin。隔离loopback服务测试，不冒称全部生产HTTP边界已测。')
change([171],'浏览器媒体9项已验证；物理设备未测','Chromium156在HTTPS上实际getUserMedia/MediaRecorder/AudioWorklet/WSS，静音测试WAV输入；手机布局及导航释放采集通过、无异常。没有真实麦克风/相机/Android设备验收。')
change([172],'生产媒体已部署，真实端到端验证进行中','release .releases/20261014T131611Z-17790，3064仅loopback语音服务启用，web与空队列worker已重启。等待真实供应商API/WSS多轮、图片和转写记录及扣费报告。')
p.write_text(json.dumps(d,ensure_ascii=False,indent=2))
with (B/'产品功能表.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(d['sheets'][0]['columns']);w.writerows(r for s in d['sheets'] for r in s['data'])
subprocess.run([sys.executable,str(B/'export_xlsx.py')],check=True)
p=B/'飞书待同步清单.json';v=json.loads(p.read_text());v.update(status='deployed_draft_waiting_real_media_and_final_apk',newRows=[r for s in d['sheets'] for r in s['data'] if int(r[0][2:])>=138]);
for item in v['changedExistingRows']:item['after']=rows[item['id']]
v['mustAwait']=['real media API/WSS acceptance report','final APK1.1.1(4) build and download verification','root approval to synchronize final evidence'];p.write_text(json.dumps(v,ensure_ascii=False,indent=2))
p=B/'产品需求文档.md';s=p.read_text();s=s.replace('版本状态：v1.1产品契约草稿。HTTPS基础设施及供应商独立探测已有实证；新增应用能力、完整语音链路和APK1.1.0尚待统一部署与专项验收，不能据本文判断已上线。','版本状态：v1.1应用已部署到.releases/20261014T131611Z-17790，HTTPS3063与HTTP3060可用，3064语音服务仅loopback启用。本地文档正在汇总最终验收；浏览器媒体9项、后端隔离12项、恢复契约14项及订单幂等14项已取得证据。真实媒体API/WSS链路验证与最终APK1.1.1仍在进行，飞书尚未同步本版。')
s=s.replace('每个成功语音轮次消耗1点AI额度；图像分析每次1点，录音转写每次1点。余额不足不启动扣费处理，失败/取消按服务端操作状态退款且不得重复退还；成功记录与扣费状态在事务中提交。','每个产生有效文本回复的语音轮次消耗1点AI额度；图像分析每次1点，录音转写每次1点。余额不足不启动扣费处理。生成有效回复前失败或打断应取消并按预留状态退款，重复失败只能退一次；有效文本已经保存并完成扣费后，如后续语音合成失败，保留文字结果并提示语音失败，不退款已完成轮次。成功记录与扣费状态在事务中提交。')
s=s.replace('Android计划发布1.1.0（versionCode3）','Android最终计划发布1.1.1（versionCode4）；1.1.0（versionCode3）已完成一次真实构建验证')
s=s.replace('当前Android修改仅完成Java编译检查；1.1.0 APK尚待后台真实构建、签名/包信息/下载一致性验收，真实设备安装与麦克风/相机/状态恢复仍需真机。不能沿用旧1.0.1构建结果作为新包通过证据。','当前1.1.0 APK已取得12项实际构建、签名/包信息/下载及权限结构检查证据。1.1.1将增加本地录音blob与私有附件的Android SAF保存，最终包仍待发布验证。真实设备安装、麦克风/相机、状态恢复和文件保存需真机；不能以清单/DEX检查代替物理设备执行。')
s=s.replace('当时3064语音服务未监听，因此不代表语音后端已上线。','该基础设施报告生成时3064尚未监听，不能单独用它证明语音后端上线；本次部署后生产WSS连接已由媒体浏览器报告验证。')
s=s.replace('新媒体部署仍需构建、服务健康、同源WSS、移动权限与实际业务验收。','新媒体已完成构建和部署，并有同源WSS连接及测试输入的浏览器采集证据；真实业务和物理设备权限仍按各自报告验收。')
s=s.replace('restored-contract-results.json目前仅lib阶段4项受控传输通过，不能称生产API或完整UI验证。','restored-contract-results.json已有lib4项及生产HTTP/handler10项通过，覆盖参数、排序、上下架权益、来源、1505条分页、全库统计和meta保底；涉及模型的handler使用受控AI传输，不能称14次真实供应商调用，也不能冒称全部新增UI逐项实测。')
s=s.replace('待统一部署后验收：','本次部署后继续验收：')
s+='''

## v1.1 部署后证据快照（待最终真实媒体报告）

截至此快照，生产release为.releases/20261014T131611Z-17790，HTTPS3063及HTTP3060正常；语音服务3064只监听loopback。媒体浏览器9项通过，使用Chromium156实际getUserMedia、MediaRecorder、AudioWorklet和生产WSS，但音频输入来自静音测试WAV，既不是物理麦克风也不包含真实模型回答。图片选取使用真实图片文件，但不等同于相机拍摄。

媒体后端12项隔离测试验证格式解码、owner隔离、100MB并发配额、VAD、额度及取消状态机；涉及上游的测试为受控依赖。真实媒体API/WSS与ASR→LLM→TTS正在专项验证，最终状态以随后报告为准。原生Realtime接口仍未恢复可用，不能把自有连续语音服务称为供应商原生Realtime。

已恢复的模型参数、插件排序、上下架/安全停用、来源与记录完整性有14项库/API/handler证据；订单创建幂等有14项隔离表证据。APK1.1.0(3)12项已通过，最终1.1.1(4)待补下载能力后发布。飞书和最终交付结论等待真实媒体报告及最终安装包，不把目前快照当作全部新增能力验收完成。
'''
p.write_text(s)
print('Updated 172 local feature statuses with scoped evidence; real media and final APK remain pending.')
