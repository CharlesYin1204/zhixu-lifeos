from pathlib import Path
import json,csv,hashlib,shutil,subprocess,sys,zipfile,xml.etree.ElementTree as ET
B=Path(__file__).resolve().parent;D=B.parent
oldmd=(D/'产品需求文档.md').read_text();audit=json.loads((D/'范围修订段落.json').read_text())
restores=[
 {'key':'AI来源展示','previousRevisionIndices':[1],'restored':'知识库：用户创建文本笔记、标题与分类/标签，查看、编辑、删除和搜索本人条目。AI上下文仅使用本人有权访问的记录，按近期记录和关键词相关性选择并裁剪；回答区展示“本次提供给AI的资料”及可定位的记录名称，不能把候选上下文冒称为逐句引用或证明模型实际引用每条资料。输入资料与系统指令隔离，缺乏依据时明确说明。附件视觉识别和资料列表不等同于向量RAG。'},
 {'key':'模型温度和输出上限','previousRevisionIndices':[2],'restored':'模型配置包括名称、供应商API Base URL、模型ID、API Key、启用状态、默认模型、temperature和maxTokens。温度允许0–2，显式输出上限为128–32768整数；空值使用服务端默认预算，明确配置上限时不得因重试或推理预算自动抬高。Agent可显式绑定模型或跟随默认值；修改后按绑定规则作用于下一次请求。密钥只在服务端加密保存、读取脱敏；URL校验协议与公网目标。'},
 {'key':'插件排序','previousRevisionIndices':[6],'restored':'管理员可创建/编辑插件名称、简介、分类、版本、价格、免费/付费类型和sortOrder，并分别设置listed上架销售与enabled允许运行。sortOrder为-100000至100000整数，前台按升序展示。授权分为安装关系与购买记录；免费安装、既有安装和已购重装按权益规则处理，客户端不能自行生成授权。'},
 {'key':'下架与安全停用独立','previousRevisionIndices':[5],'restored':'付费插件新安装由服务端验证有效购买记录；会员不自动包含单独销售的付费插件。listed=false为下架：阻止新购买及无授权的新安装，已安装用户仍可使用，已购用户仍可重装和使用。enabled=false为安全停用：所有用户都不能安装或运行，已有订单和记录保留；必须给出明确停用提示。免费改收费保留既有安装；管理员改价只影响新订单，历史订单快照不变。'},
 {'key':'创建订单requestId幂等','previousRevisionIndices':[20],'restored':'错误约定：400输入无效，401未登录，402余额或购买权益不足，403无权限/来源不允许，404资源不存在，409幂等键与请求参数冲突，429频率限制，502/503上游失败或未配置。模型超时明确报错并允许重试。order.create携带用户范围内的requestId，同键同商品/支付方式/渠道返回原订单及支付信息；同键改参数返回409；并发请求只创建一单。重试保留原价格与状态，不重复授予权益。未传requestId的旧调用保持兼容并可创建独立订单；正式前端提交必须携带requestId。支付回调与人工发放仍需事务幂等。'}]
md=oldmd.replace('产品需求文档 v1.0','产品需求文档 v1.1 草稿',1).replace('版本：一期实施需求 v1.0。','版本：v1.1增补实施需求草稿；v1.0已验收记录保留为历史证据。',1)
md=md.replace('基准日期：2026-10-14 · 本文件不包含任何凭证。','基准日期：2026-10-14 · 本文件不包含任何凭证。\n\n版本状态：v1.1产品契约草稿。HTTPS基础设施及供应商独立探测已有实证；新增应用能力、完整语音链路和APK1.1.0尚待统一部署与专项验收，不能据本文判断已上线。',1)
for item in restores:
 for ix in item['previousRevisionIndices']:
  old=audit[ix]['new'];assert old in md,(item['key'],ix);md=md.replace(old,item['restored'],1)
md=md.replace('后续扩展：第三方日历双向同步、视频课程托管、语音输入、多模态附件 RAG、家庭协作、移动系统通知、插件开发者分账、原生 Android 离线同步和应用商店发布。列入路线图，不默认宣称一期已实现。','后续扩展：第三方日历双向同步、视频课程托管、多模态附件向量RAG、家庭协作、移动系统通知、插件开发者分账、原生Android离线同步和应用商店发布。语音交互、录音转写、图片理解已由本次用户要求纳入v1.1；附件向量RAG仍保留既有P2定义，二者不混同。')
md=md.replace('、后台温度/输出上限参数','')
md=md.replace('order.create 携带 type=membership/plugin、productId、paymentMethod=manual/epay/stripe，金额由服务端取价','order.create 携带 type=membership/plugin、productId、paymentMethod=manual/epay/stripe及requestId，金额由服务端取价，重复提交按用户与requestId幂等')
md=md.replace('models','models')
add='''

## v1.1 录音、语音与图像助手产品目标

本次明确增加录音、可连续说话的AI语音交互、上传图片和拍照解题，并扩展到学习、语言练习、表达和生活场景。交互借鉴自然语音产品的易用性：进入场景后点击开始、授权麦克风、说话并自然停顿，自动听取回复；支持静音、打断和结束，文字同步可回看。平台使用自身视觉风格与场景文案，不复制第三方品牌或宣称接入其服务。

入口统一为“多模态助手”，用户中心全部功能目录包含语音对话、拍照识图、录音转写。手机有易触达的开始/暂停/结束操作和底部导航；各状态显示清晰的听取、识别、思考、朗读、失败信息，避免将上传进度误显示成AI处理完成。后台增加媒体模型配置页。

HTTPS入口为https://154.40.47.111:3063，HTTP3060继续保留。浏览器录音/相机只在可信安全上下文及用户触发授权后调用；HTTP入口应提供转到HTTPS的明确操作。访客可了解场景，处理私人媒体与语音会话必须登录。

## v1.1 十三种场景与结果约定

| 类型 | 场景ID | 展示名称 | 用户操作与结果 |
| --- | --- | --- | --- |
| 连续语音 | english-free | 英语自由对话 | 根据水平聊日常话题，以短回复和追问延续练习，适度纠正一个具体问题 |
| 连续语音 | travel-talk | 旅行情景口语 | 选择机场、酒店、点餐、问路等情境，一次一轮角色对话 |
| 连续语音 | interview | 面试模拟 | 按岗位和语言逐题提问，针对回答反馈，不编造个人经历 |
| 连续语音 | study-qa | 学习问答 | 口述疑问，得到简短解释、例子和理解检查问题 |
| 连续语音 | speech-practice | 表达与演讲 | 根据转写内容反馈结构、措辞和表达清晰度，不据文字冒称评估真实发音或语调 |
| 图片 | homework | 拍题讲解 | 上传或拍摄题目，先识别题意再分步讲解；看不清时请求补图 |
| 图片 | essay-review | 作文与写作批改 | 读取可辨识原文，给结构/语言建议和修改示例，不虚构原句 |
| 图片 | notes-organize | 笔记整理 | 将纸质笔记/板书整理成提纲、概念和复习问题 |
| 图片 | chart-explain | 图表解读 | 读取轴、图例与数据，区分观察和推断，不编造精确数值 |
| 图片 | object-identify | 生活识物 | 描述物品可见特征、可能用途，明确不确定性 |
| 图片 | meal-log | 饮食记录助手 | 整理可见食物，重量/营养仅作明确标注的估计，不作诊断 |
| 录音 | class-notes | 课堂录音转写 | 录制或上传音频，确认后忠实转写并保存知识笔记 |
| 录音 | spoken-review | 口语录音转写 | 保留实际语言与原话，形成可回看的练习记录；不等同发音打分 |

十三场景是内容和交互契约；验收不能仅以十三个卡片存在代表全部场景真实运行成功。具体运行覆盖在功能表逐行记录。

## v1.1 连续语音链路、控制与边界

采用自有同源WebSocket与语音活动检测：客户端采集音频并检测说话/停顿，服务端识别为文字，调用对话模型，再将回复合成为语音。持续会话内无需每句手动上传，转写与回复同步显示，进入下一轮聆听。该方案为ASR→LLM→TTS串联连续交互，不宣称供应商原生Realtime或语音端到端模型已经可用。

语音流程包含未开始、请求权限、连接、聆听、处理中、朗读、静音、结束和错误状态。用户可静音麦克风、打断当前回复、结束会话；打断时停止当前播音和相关生成，避免旧回复在新一轮恢复播放。结束或页面离开应释放麦克风、连接和播放资源。文字历史按用户与场景保存，重载可恢复；更换场景开启对应的新会话，不混用提示词。

单次会话上限20分钟，单句上限20秒。达到上限显示原因并结束或提交当前合法片段，不能无限录制或无限占用供应商。每个成功语音轮次消耗1点AI额度；图像分析每次1点，录音转写每次1点。余额不足不启动扣费处理，失败/取消按服务端操作状态退款且不得重复退还；成功记录与扣费状态在事务中提交。供应商token未提供时展示未知，不能将应用额度等同于供应商账单。

供应商探测已证明：whisper-1转写、gpt-4o-mini视觉回答、gpt-4o-mini-tts MP3与PCM音频成功。原生gpt-4o-mini-realtime-preview/gpt-4o-realtime-preview仅WebSocket握手成功，随后account_deactivated，未获得可用音频或转写；不能记作原生实时能力通过。探测用合成英文语音和自制数学图片，不代表真实设备麦克风和相机验收。

## v1.1 录音与图片完整流程

录音使用MediaRecorder，用户点击开始才申请麦克风，可暂停、继续、停止、试听、丢弃重录；试听确认后上传并转写，成功保存知识笔记和附件来源。也允许上传已有音频。单文件不超过15MB、时长不超过180秒；服务端识别实际音频并拒绝视频、空文件、非法格式或超限内容，不能仅依赖文件扩展名。已上传文件和转写结果按本人权限访问。

图片支持从文件选择或相机拍摄，上传前展示预览，可移除重选并补充问题。每次分析1–4张不同图片，每张不超过8MB且不超过1600万像素；实际支持JPEG、PNG、WebP，不接受伪装扩展名、动画或不能解析的文件。服务端做图片解码/方向处理后保存。图片回答展示对应“图片1”等附件标识与预览，识别不清应明确说明。

图像对话可继续追问并回看历史；提供给模型的图片及文本资料只来自当前用户有权访问的资产。场景结果可以用于学习或记录，但不得将上传附件理解冒称为全文向量检索。删除附件应删除服务器私有资产及占用统计，历史引用显示已删除状态；已产生的独立笔记正文不应被未说明的附件删除顺带抹除。

## v1.1 私有资产、记录完整性与接口契约

媒体文件位于private/media，数据库media_assets包含user_id、类型、实际MIME、内部文件名、字节数和音频时长；公开接口不暴露磁盘绝对路径。资产列表、读取、删除、转写和分析必须按当前用户校验owner，不能通过猜测ID读取他人图片/录音。每人资产总额度100MB，上传时在事务中校验，删除后释放空间；通过可折叠“我的附件库”分页列出本人资产及已用容量；删除历史附件后不能再回看该原始图片或音频。

新增GET /api/media支持config、history、conversation、assets和asset；未登录只允许公开能力/场景配置，私人内容必须有有效会话。POST /api/media使用multipart上传媒体，JSON动作vision、transcribe、asset.delete处理分析/转写/删除。同源WSS路径和服务进程以最终部署配置为准，升级请求需校验会话和Origin，供应商Key留在服务端。

普通学习生活records首批每页500条，客户端按游标继续加载本人完整记录，不能在1500条处静默截断；仪表盘统计来自本人全库聚合，不能只统计当前页面。meta.checkedDates必须为合法日期数组并去重，tags及日期/分类/链接等字段按类型和长度校验；旧或导入异常值读取时安全归一化，不能让一个异常记录导致整个页面崩溃。

## v1.1 管理后台、Android与运维

后台媒体设置可分别选择对话/视觉/转写/合成模型，校验模型已启用及用途匹配；分别打开或关闭语音、图片、录音功能，并选择受支持音色。模型维护页支持capability、温度和输出上限，转写与合成模型可使用真实样本测试；配置读取仅显示已设置状态，不返回密钥。开关关闭时前台说明不可用，后端同样拒绝绕过操作。

Android计划发布1.1.0（versionCode3），继续使用com.zhixu.lifeos包名和已有签名，加载HTTPS3063。麦克风与相机权限只在用户触发录音/拍照并需要权限时申请；拒绝后可重试或使用文件上传，不能后台自动申请。WebView权限仅授予受信任同源页面请求的能力。高清相机捕获使用私有FileProvider临时文件与受控URI，处理取消、恢复和回传，禁止放开任意外部来源。

当前Android修改仅完成Java编译检查；1.1.0 APK尚待后台真实构建、签名/包信息/下载一致性验收，真实设备安装与麦克风/相机/状态恢复仍需真机。不能沿用旧1.0.1构建结果作为新包通过证据。

HTTPS基础设施11项检查已通过：有效同IP证书链、安全上下文、同源媒体权限策略、3063开放、HTTP3060保留及现有自动续期计划可见。这里只证明基础设施；当时3064语音服务未监听，因此不代表语音后端已上线。续期调度已只读检查，本次没有执行续期或dry-run。新媒体部署仍需构建、服务健康、同源WSS、移动权限与实际业务验收。

## v1.1 验收状态与对外表述

本次五项既有承诺恢复为当前范围：AI资料来源展示、temperature/maxTokens后台配置、plugin.sortOrder、listed与enabled独立语义、order.create requestId幂等。旧范围修订文件保留为历史审计，不能继续用旧缩小条款覆盖本版契约。order-idempotency-results.json已有14项隔离表测试通过，包含并发/快照/冲突/模拟支付；restored-contract-results.json目前仅lib阶段4项受控传输通过，不能称生产API或完整UI验证。

待统一部署后验收：13场景及三种媒体流程、连续语音多轮/静音/打断/结束、转写笔记持久化、图片来源/追问、资产隔离和配额、错误及退款、后台模型与开关、五项恢复契约、记录分页与异常值、新APK构建与下载。没有实测的行必须继续标注待验证，真实供应商探测不能替代平台集成验收。

真实收款仍等待易支付网关URL/PID/Key；Android真机和独立受控跨网络验收边界保留。既有六项P2（视频托管、附件向量检索、家庭/团队共享、退款对账、插件开发者SDK、原生离线同步）不作无关调整。
'''
md+=add;(B/'产品需求文档.md').write_text(md)
restoration={'status':'draft_not_published','historicalRevisionFile':'../范围修订段落.json','historicalRevisionSha256':hashlib.sha256((D/'范围修订段落.json').read_bytes()).hexdigest(),'retainedUnchanged':True,'restoredPromises':restores}
(B/'既有承诺恢复审计.json').write_text(json.dumps(restoration,ensure_ascii=False,indent=2))
payload=json.loads((D/'功能表数据.json').read_text());sheets={s['name']:s for s in payload['sheets']};byid={r[0]:r for s in payload['sheets'] for r in s['data']}
changed=[]
def change(n,**kw):
 r=byid[f'F-{n:03}'];before=r.copy()
 cols={'behavior':5,'acceptance':6,'status':8,'evidence':9}
 for k,v in kw.items():r[cols[k]]=v
 changed.append({'id':r[0],'before':before,'after':r.copy()})
change(61,behavior='真实助手回复并展示本次提供给AI的本人资料列表',acceptance='真实调用；资料仅含本人记录；不冒称逐条实际引用',status='v1.0对话已验证；来源展示恢复待部署验收',evidence='原对话证据保留；新增来源契约见restored-contract-results.json lib阶段4/4中的本人来源隔离，生产API/UI未测。')
change(102,behavior='配置地址名称模型ID及temperature/maxTokens',acceptance='温度0–2；显式输出128–32768；下一次调用生效且不暗增预算',status='参数恢复已实现；待生产部署验收',evidence='restored-contract-results.json lib4/4受控传输验证参数透传/显式预算/来源隔离；不是四次真实供应商调用。')
change(93,behavior='维护名称简介分类版本及sortOrder',acceptance='排序整数-100000至100000；前台升序一致',status='原资料编辑已验证；排序恢复待部署验收',evidence='已有version/价格UI证据保留；sortOrder已写入代码，待统一部署及专项。')
change(95,behavior='listed控制上架销售；enabled独立控制安全停用',acceptance='下架阻止新购但已安装可用/已购可重装；安全停用阻止全部用户安装运行',status='契约已恢复实现；待生产部署验收',evidence='order-idempotency-results.json14/14隔离表覆盖上下架/启用独立新购门禁；前端与重装/运行专项未测。')
change(73,acceptance='卸载保留记录；下架已购仍可重装；安全停用不可重装',status='原重装已验证；下架/停用区分待部署验收',evidence='v1.0人工付费后重装UI通过；新增listed/enabled契约待统一部署专项验证。')
new=[]
def add(n,sheet,module,name,priority,behavior,acceptance,dependency='媒体模型、HTTPS与当前用户权限',status='v1.1新增，待统一部署及专项验收',evidence='需求与源码草稿已准备；供应商独立探测不等于平台集成通过。'):
 r=[f'F-{n:03}',sheet,module,name,priority,behavior,acceptance,dependency,status,evidence];sheets[sheet]['data'].append(r);new.append(r)
add(138,'前台','安全入口','HTTPS媒体入口','P0','提供HTTPS3063并保留HTTP3060','证书可信、安全上下文；HTTP页引导进入HTTPS','证书与Nginx','HTTPS基础设施已验证；媒体业务待部署','https-readiness.json11/11仅基础设施；当时3064未监听，未验真设备采集。')
add(139,'前台','多模态入口','十三场景导航','P1','用户中心完整目录可找到语音/图片/录音','13场景可选，桌面手机有完整入口和状态')
scene=json.loads('[]')
# Use the agreed scene contract, preserving IDs used by application code.
items=[('voice','english-free','英语自由对话','短轮次英语对话、适度纠正并追问'),('voice','travel-talk','旅行情景口语','机场酒店点餐问路的角色对话'),('voice','interview','面试模拟','按岗位语言逐题提问和具体反馈'),('voice','study-qa','学习问答','口述疑问获得解释、例子和理解问题'),('voice','speech-practice','表达与演讲','按转写反馈结构措辞，不冒称发音评测'),('image','homework','拍题讲解','识别题意、分步解题并标记看不清处'),('image','essay-review','作文与写作批改','引用可读原文给建议，不编造原句'),('image','notes-organize','笔记整理','纸质笔记或板书整理为提纲'),('image','chart-explain','图表解读','准确解释轴图例数据与推断边界'),('image','object-identify','生活识物','描述可见特征用途和不确定性'),('image','meal-log','饮食记录助手','记录可见食物、估计明确标注'),('recording','class-notes','课堂录音转写','确认音频后忠实转写保存知识笔记'),('recording','spoken-review','口语录音转写','保留原语言和原话便于复盘')]
for n,(mode,code,name,behavior) in enumerate(items,140):
 add(n,'用户中心','多模态场景',name,'P1',behavior,f'{code}场景真实处理并保存本人结果；无法处理时明确错误',evidence=f'对应lib/media-scenes.mjs mode={mode}, id={code}；本行场景尚未专项实测。')
add(153,'用户中心','连续语音','自动停顿与会话控制','P0','同源WSS、VAD自动停顿→ASR→LLM→TTS，静音/打断/结束','连续多轮真实回复；打断不再播旧音频；结束释放资源')
add(154,'用户中心','连续语音','会话与单句上限','P0','会话20分钟、单句20秒，显示状态与上限原因','服务端和前端限制有效，不能无限占用')
add(155,'用户中心','录音','录制暂停试听确认','P0','MediaRecorder开始/暂停/继续/停止/试听，确认后上传','180秒/15MB内；取消不上传；转写成功有本人知识笔记')
add(156,'用户中心','媒体资产','私有附件列表与删除','P0','可折叠我的附件库，分页查看本人资产、容量及删除','100MB总额；删除释放容量且历史附件不可重看；文件须鉴权')
add(157,'用户中心','图片','上传拍照预览与限制','P0','相机或选文件、预览/移除/补充问题','1–4图、每8MB/1600万像素、真实JPEG/PNG/WebP；伪格式拒绝')
add(158,'用户中心','媒体历史','文字历史与图像追问','P1','回看本人语音/图片会话并继续同场景图像追问','重载保持、不同场景不混用、跨用户不可读')
add(159,'用户中心','媒体额度','扣费失败退款','P0','语音成功轮/图片分析/录音转写各1点','不足拒绝；失败或取消退款幂等；成功状态与持久化事务一致')
add(160,'用户中心','AI来源','资料与附件来源展示','P1','显示本次提供给AI的本人记录及图片/音频附件','区分输入资料与逐句引用；删除资产不展示可读伪链接')
add(161,'管理员后台','媒体设置','四类媒体模型选择','P0','配置chat/vision/transcription/speech模型','启用及用途匹配；真实测试反馈；Key脱敏')
add(162,'管理员后台','媒体设置','语音图片录音开关','P0','分别开关三种能力','前台提示与服务端拒绝一致，普通用户不能修改')
add(163,'管理员后台','媒体设置','合成音色选择','P1','选择支持的TTS音色','有效枚举校验，下一轮按配置生成真实音频')
add(164,'用户中心','订单','requestId创建幂等','P0','同一提交重试返回原订单与支付信息','并发只一单；改商品/渠道409；保留价格快照与已付/取消状态','数据库与支付配置','库层14项已验证；待生产集成验收','order-idempotency-results.json14/14，隔离表、模拟网关、真实付款0次；正式前端带requestId。')
add(165,'用户中心','记录完整性','500条游标完整加载','P0','自动按页读取所有本人记录，全库聚合统计','超过1500条不截断、不重复遗漏；统计不依赖已载页','数据库','已实现，待部署专项验收','GET bootstrap/records游标和全库统计已落盘；当前无对应专项完成报告。')
add(166,'验收与依赖','记录安全','meta校验与旧值保底','P0','checkedDates/tags/文本字段类型校验，旧异常值安全读取','非法新输入拒绝；旧异常值不导致整页崩溃','数据库','已实现，待部署专项验收','lib/record-meta.mjs已落盘；不能用旧记录合同报告代替此次新增边界。')
add(167,'前台','Android','APK1.1.0 HTTPS发布','P0','发布versionName1.1.0/versionCode3，使用HTTPS3063','同包名签名、后台构建真实完成、新包元数据与下载哈希一致','Android工具链','Java编译通过；新APK待构建验证','不能沿用旧1.0.1 APK11项证据；真机未测。')
add(168,'验收与依赖','Android','麦克风相机与恢复','P0','用户触发运行时权限、同源授权、高清捕获FileProvider和状态恢复','拒绝/取消可恢复；外站无权限；真实设备录音拍照回传','Android真机','代码已编译；待新包和真机验收','用户触发权限及相机provider已落盘；Java编译不等于设备通过。')
add(169,'验收与依赖','语音架构','原生Realtime边界','P0','明确串联连续语音实现及供应商原生状态','原生握手后失败不标成功；ASR/LLM/TTS链路独立验收','供应商能力','供应商探测完成；原生Realtime不可用','media-provider-probe.json：原生account_deactivated；whisper1/vision/TTS真实成功，media-pcm-probe.json PCM200且有有效样本。')
add(170,'验收与依赖','媒体安全','资产隔离配额与请求来源','P0','owner校验、私有目录、真实格式/容量限制、WS来源会话验证','跨用户/伪格式/超限/非授权Origin拒绝，不泄露Key','媒体服务与数据库')
add(171,'验收与依赖','媒体界面','浏览器采集和异常','P0','桌面手机权限允许/拒绝，录音和拍照，网络/模型错误恢复','无全局页面错误；设备测试与合成fixture分别记录','浏览器和真实设备')
add(172,'验收与依赖','媒体集成','真实媒体端到端','P0','真实语音多轮、图片问题、转写入知识库及后台配置','平台接口与UI获得真实供应商内容/音频并持久化，额度正确','HTTPS与模型')
assert len(new)==35
assert sum(len(s['data']) for s in payload['sheets'])==172
assert payload['sheets'][-1]==json.loads((D/'功能表数据.json').read_text())['sheets'][-1]
(B/'功能表数据.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
with (B/'产品功能表.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(payload['sheets'][0]['columns']);w.writerows(r for s in payload['sheets'] for r in s['data'])
shutil.copy2(D/'export_xlsx.py',B/'export_xlsx.py');subprocess.run([sys.executable,str(B/'export_xlsx.py')],check=True)
with zipfile.ZipFile(B/'产品功能表.xlsx') as z:
 assert z.testzip() is None
 for file in z.namelist():
  if file.endswith(('.xml','.rels')):ET.fromstring(z.read(file))
plan={'status':'local_draft_not_published','previousFeatureCount':137,'draftFeatureCount':172,'newRows':new,'changedExistingRows':changed,'p2Unchanged':True,'sheets':{s['name']:len(s['data']) for s in payload['sheets']},'mustAwait':['unified application deployment','actual media API/UI and WebSocket reports','APK1.1.0 actual build report'],'onlinePrd':'https://rjppwe2dlq09.jp.larksuite.com/docx/[REDACTED_LARK_RESOURCE_TOKEN]','onlineSheet':'https://rjppwe2dlq09.jp.larksuite.com/sheets/[REDACTED_LARK_RESOURCE_TOKEN]','validation':{'featureIdsUnique':len({r[0] for s in payload['sheets'] for r in s['data']})==172,'xlsxZipXmlValid':True,'historicalRevisionUnchanged':True}}
(B/'飞书待同步清单.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
print(json.dumps({'draftFeatures':172,'newFeatures':35,'changedExisting':len(changed),'sheets':plan['sheets'],'status':plan['status']},ensure_ascii=False))
