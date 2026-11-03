from pathlib import Path
from collections import Counter
import json,csv,subprocess,sys
B=Path(__file__).resolve().parent;D=B.parent
voice=json.loads((D/'tests/media-voice-browser-results.json').read_text());assert voice['passed']
apk=json.loads((D/'tests/android-release-results.json').read_text());assert apk['passed']==12 and apk['artifact']['versionName']=='1.1.1'
p=B/'功能表数据.json';d=json.loads(p.read_text());rows={r[0]:r for s in d['sheets'] for r in s['data']}
def change(ids,status,evidence):
 for n in ids:rows[f'F-{n:03}'][8:10]=[status,evidence]
change([14,15,16,110,111,112,113,126,167],'APK1.1.1构建发布已验证；真机未测','android-release-results.json12/12：1.1.1(4)、com.zhixu.lifeos、HTTPS3063、minSDK23、v1/v2/v3签名、包信息、下载SHA一致、构建失败保留旧包。android-download-boundaries.json4/4为嵌入脚本/源码边界与Java编译，不是Android运行时。')
change([138],'HTTPS及媒体浏览器已验证','https-readiness.json11/11可信同IP证书/安全上下文，media-browser-results.json10/10及media-voice-browser-results.json生产HTTPS采集与WSS真实语音轮次通过；输入为合成WAV，非物理设备。')
change([139],'已实现并验证目录与导航','media-browser-results.json10/10：13场景及用户中心三类入口、360/390px布局和底栏、页面无异常；13种内容没有逐一真实模型验证。')
change([140],'真实英语语音链路已验证；物理设备未测','media-live-voice-results.json11项通过含英语两轮转写/PCM；media-voice-browser-results.json真实浏览器合成WAV→ASR→LLM→TTS实际非零PCM播放，历史2条，额度20→19，首音频3435ms/总3556ms；非真实声学设备。')
change([145],'真实拍题/追问与公式界面已验证','media-live-results.json前5项通过含自制2x+5=17图片真实解答x=6与历史图片追问/来源；该旧报告后段ASR429失败保留。media-browser-results.json验证保存的实际数学回答Markdown/KaTeX可读显示、360/390px不溢出。')
change([151],'真实录音转写及笔记接口已验证','media-live-voice-results.json通过公网真实上传音频→gpt-4o-transcribe转写→知识笔记及私有音频来源；media-browser-results.json录制暂停/继续/试听为测试WAV输入，未测物理课堂录音。')
change([153],'连续语音与浏览器控制已验证','公网WSS真实两轮非零PCM、第三轮打断退款、结束持久化通过；完整浏览器单轮通过实际AudioWorklet采集及音频播放。10项UI含静音/打断/离开释放采集；使用合成音频，无硬件验收。')
change([155],'录音浏览器与真实转写接口已验证','media-browser-results.json10/10包含MediaRecorder暂停/继续、试听、上传前删除；公网真实转写入知识笔记由media-live-voice-results.json确认。录音输入为合成/静音测试样本，不是真实麦克风。')
change([156],'私有资产/删除/配额已验证；列表UI未逐项专项','真实公网上传/隔离/删除释放容量与旧链接不可读通过；隔离backend验证100MB并发配额。可折叠附件库已实现，完整资产分页UI未单独实测。')
change([158],'真实历史及图像追问已验证','公网语音两轮保存4条消息；完整浏览器单轮历史2条回读；media-live-results.json前5项中的图片追问复用本人历史图像和来源成功。原旧ASR失败记录未改写。')
change([159],'真实扣费及取消退款已验证','公网voice报告3次成功操作扣3点、打断一次退款且历史保持；浏览器完整成功轮20→19。backend验证退款幂等，以及文字已完成后TTS失败保留结果不退款。')
change([160],'本人资料与媒体来源已验证','restored-contract-results.json14项确认chat/知识/协作本人来源；真实图像回答和追问附来源，录音转写笔记含音频引用。展示为提供给AI的资料，不冒称每条均被模型逐句引用。')
change([168],'权限/下载边界与编译已验证；真机待验收','1.1.1(4)清单/DEX检查权限/私有provider/恢复；android-download-boundaries.json4项通过嵌入blob脚本和源码检查，含2MB分块、撤销错误、同源Cookie下载/不跟随跳转、SAF。非Android设备执行。')
change([169],'自有串联语音已验证；原生Realtime不可用','原生Realtime探测握手后account_deactivated，无可用转写/音频。当前ASR=gpt-4o-transcribe，chat/vision=gpt-4o-mini，TTS=gpt-4o-mini-tts；真实公网WSS和完整浏览器串联语音通过，不能宣称原生Realtime成功。')
change([170],'后端与生产媒体边界已验证','backend12项隔离验证格式/配额/退款/VAD/WS会话；公网voice11项补充匿名/Origin/伪文件拒绝、跨用户私有资产隔离、同用户第二连接拒绝、删除与退款。未作全站渗透测试。')
change([171],'浏览器媒体10项及真实合成音频轮已验证','Chromium156实际getUserMedia/MediaRecorder/AudioWorklet/WSS，10项UI无异常，360/390px正常；完整语音轮已播放非零PCM。输入是虚拟麦克风合成WAV，不是物理硬件或人工听感验收。')
change([172],'代表性媒体端到端已验证','真实英语语音、公网图片解题/追问、录音转写入笔记已验证；13场景共用链路和入口已验，其他10场景内容未逐一调用真实模型。最终release .releases/20261014T132239Z-19416。')
for n in [141,142,143,144,146,147,148,149,150,152]:rows[f'F-{n:03}'][8]='已实现；入口/共用链路已验，本场景未单独真实调用';rows[f'F-{n:03}'][9]+=' 代表性英语/拍题/录音真实链路通过，不等于本行场景逐个实测。'
change([128],'HTTP/HTTPS地址已验证；跨网络专项未测','HTTP3060保留，HTTPS3063可信证书及生产媒体浏览器/WSS通过；早期HTTP外部日志36次成功记录。独立受控跨网络浏览器与物理移动网络验收未执行。')
change([130,131],'飞书需求与172项功能表已同步验证','同一飞书PRD与5张工作表扩展为172项；5条旧功能契约恢复，新增35行；完成后全文与全部A:J逐格回读、CSV/XLSX一致性检查，六条原P2保留。')
p.write_text(json.dumps(d,ensure_ascii=False,indent=2))
with (B/'产品功能表.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(d['sheets'][0]['columns']);w.writerows(r for sh in d['sheets'] for r in sh['data'])
subprocess.run([sys.executable,str(B/'export_xlsx.py')],check=True)
(B/'implementation-status.json').write_text(json.dumps({'date':'2026-10-14','phase':'v1.1已部署；逐项区分真实调用、受控验证及设备边界','source':'各项当前测试报告及v1.0保留历史证据','features':[{'id':r[0],'status':r[8],'evidence':r[9]} for sh in d['sheets'] for r in sh['data']],'statusCounts':dict(Counter(r[8] for r in rows.values()))},ensure_ascii=False,indent=2))
p=B/'产品需求文档.md';s=p.read_text().replace('产品需求文档 v1.1 草稿','产品需求文档 v1.1').replace('v1.1增补实施需求草稿','v1.1增补实施需求')
a=s.index('版本状态：');z=s.index('\n\n',a);s=s[:a]+'版本状态：v1.1已部署到.releases/20261014T132239Z-19416，HTTPS3063及HTTP3060可用。代表性英语连续语音、拍题及追问、录音转写真实验证完成；APK1.1.1(4)已发布。功能表172项分别记录接口/浏览器/真实调用证据及未单独测试项，不将场景入口或合成音频当作所有场景或物理设备验证。'+s[z:]
s=s.replace('## 2026-10-14 交付验证记录','## v1.0 历史交付验证记录')
s=s.replace('题解等媒体回答支持Markdown与KaTeX公式排版，避免将LaTeX公式只显示为原始反斜杠；该显示增强正在后续构建，尚待生产回归。','题解等媒体回答支持Markdown与KaTeX公式排版，真实保存的数学回答已通过浏览器显示及360/390px布局验证，避免直接展示原始公式反斜杠。')
s=s.replace('Android最终计划发布1.1.1（versionCode4）；1.1.0（versionCode3）已完成一次真实构建验证','Android已发布1.1.1（versionCode4）')
s=s.replace('当前1.1.0 APK已取得12项实际构建、签名/包信息/下载及权限结构检查证据。1.1.1将增加本地录音blob与私有附件的Android SAF保存，最终包仍待发布验证。','当前1.1.1 APK已取得12项实际构建、签名/包信息/下载及权限结构检查证据；另有4项嵌入blob脚本与原生下载边界检查，支持本地录音blob及私有附件的Android SAF保存。')
s=s.replace('真实业务和物理设备权限仍按各自报告验收。','代表性真实业务已按报告验收，物理设备权限仍未验收。')
s=s.replace('本次部署后继续验收：13场景及三种媒体流程、连续语音多轮/静音/打断/结束、转写笔记持久化、图片来源/追问、资产隔离和配额、错误及退款、后台模型与开关、五项恢复契约、记录分页与异常值、新APK构建与下载。没有实测的行必须继续标注待验证，真实供应商探测不能替代平台集成验收。','本次按报告覆盖三种媒体流程的代表性真实调用、连续语音多轮/控制、笔记持久化、图片来源/追问、资产隔离/配额、退款、恢复契约、分页与异常值和新APK构建。其余场景内容、后台开关/音色完整操作及部分边界未逐项专项实测，功能表保留准确状态，独立供应商探测不替代平台集成证据。')
s=s.split('\n## v1.1 部署后证据快照')[0].rstrip()
s+='''

## v1.1 最终交付与证据

当前入口https://154.40.47.111:3063，媒体工作区/?view=media，用户中心/?view=user，管理后台/?view=admin。原HTTP3060保留，麦克风和相机请使用HTTPS安全上下文。最终web release为.releases/20261014T132239Z-19416。五张功能表共172项：前台21、用户中心88、管理后台35、验收与依赖22、后续规划6。原范围修订文件保留审计，五项承诺已恢复为本版契约。

media-browser-results.json10项通过：Chromium156真实采集API、MediaRecorder、AudioWorklet与生产WSS，13场景入口、控制与释放采集、真实图片选取预览/删除、实际数学回答Markdown/KaTeX及360/390px布局。静音测试使用虚拟设备WAV，不是物理麦克风或相机。

media-live-voice-results.json11项通过：真实公网录音转写入知识笔记、两轮英语转写与非零PCM、第三轮打断仅退款一次、三次成功扣3点、历史4条、资产隔离和删除。原执行收尾的测试报告SQL误查不存在字段，产品断言已完成；报告根据保存记录和PASS输出恢复，明确首音频精确值缺失，不据此制造延迟指标。

media-voice-browser-results.json另完成真实浏览器端合成英文WAV→AudioWorklet→WSS→ASR→LLM→TTS及非零PCM播放，历史2条，额度20→19。本次实测首音频3435ms、总3556ms，属于单次样本而非服务延迟承诺；没有人工听感或真实声学设备验收。

media-live-results.json保留原始5项通过和其后ASR上游429失败：已成功真实解答自制题目2x+5=17并追问，图片来源保留；旧失败不改成全绿。当前ASR已切换gpt-4o-transcribe，新的真实语音报告证明恢复；chat/vision为gpt-4o-mini，TTS为gpt-4o-mini-tts。供应商原生Realtime仍account_deactivated，自有串联连续语音不冒称原生Realtime。

其余证据：媒体后端12项隔离测试、恢复契约14项（lib4+HTTP/handler10、AI受控传输）、订单幂等14项隔离测试、HTTPS基础设施11项；APK1.1.1发布12项和下载边界4项通过。十三场景共用链路和入口验证完成，只有代表性英语、拍题、录音有真实输出证据，其他内容未逐场景调用。真实收款资料缺失、Android真机和独立跨网络受控验收边界继续保留。

Android下载：https://154.40.47.111:3063/api/download?file=zhixu-lifeos-1.1.1-4.apk。版本1.1.1(4)，包名com.zhixu.lifeos，SHA-256为1f24d229fd2319628ccf3a7570fd9acc9da48a06f59438edb953cf5c05427601。web与worker按systemd运行，语音服务仅loopback3064，经同源HTTPS/WSS代理；媒体私有目录和加密/签名资料单独备份。复用同IP有效证书及现有自动续期任务，定期检查证书到期、续期日志和HTTPS健康；本次未执行续期或自动回滚演练。
'''
p.write_text(s)
print('v1.1 final local evidence ready: 172 rows, representative real media, APK1.1.1; no broad 13-scene claim.')
