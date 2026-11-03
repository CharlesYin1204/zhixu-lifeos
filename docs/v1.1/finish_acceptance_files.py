from pathlib import Path
import json,csv,zipfile,xml.etree.ElementTree as ET,shutil,hashlib
B=Path(__file__).resolve().parent;D=B.parent
v=json.loads((B/'最终回读验证.json').read_text());assert v['documentRevision']>45 and v['features']==172
remote=json.loads((D/'飞书最终文档回读.json').read_text())['data']['document']['content'];assert '.releases/20261014T135228Z-25423' in remote and 'v1.1 最终补充验收与质量修复' in remote
payload=json.loads((D/'功能表数据.json').read_text());ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with (D/'产品功能表.csv').open(encoding='utf-8-sig') as f:actual=list(csv.reader(f))
assert actual==[payload['sheets'][0]['columns']]+[r for s in payload['sheets'] for r in s['data']]
with zipfile.ZipFile(D/'产品功能表.xlsx') as z:
 assert z.testzip() is None
 for n,s in enumerate(payload['sheets'],1):
  xml=ET.fromstring(z.read(f'xl/worksheets/sheet{n}.xml'))
  rows=[[''.join(c.find('s:is',ns).itertext()) for c in r] for r in xml.findall('s:sheetData/s:row',ns)]
  assert rows==[s['columns']]+s['data']
root=ET.fromstring('<root>'+remote+'</root>');draft=ET.fromstring('<root>'+(D/'draft_81969f84_folder/draft.xml').read_text()+'</root>');key=lambda e:(e.tag,''.join(e.itertext()));assert [key(e) for e in root]==[key(e) for e in draft]
v.update(csvAll172RowsMatch=True,xlsxAll172RowsMatch=True)
for p in [B/'最终回读验证.json',D/'本地与在线交付一致性.json',D/'飞书最终状态验证.json']:p.write_text(json.dumps(v,ensure_ascii=False,indent=2))
shutil.copy2(B/'部署交付与验收报告.md',D/'部署交付与验收报告.md')
p=D/'飞书交付状态.json';s=json.loads(p.read_text());s['status_sync']=v;s['delivery_appendix']={'title':'v1.1 最终补充验收与质量修复','verified':True,'revision':v['documentRevision']};s['implementation_note']='172项最终验收已同步；13场景各有真实样例，素材与mock范围明确；日程/附件/餐食修复已验证，真实收款/物理设备/独立跨网络边界保留。';p.write_text(json.dumps(s,ensure_ascii=False,indent=2))
p=B/'待同步验收修订.json';s=json.loads(p.read_text());s.update(state='published_and_full_readback_verified',verification=v);p.write_text(json.dumps(s,ensure_ascii=False,indent=2))
p=B/'飞书待同步清单.json';s=json.loads(p.read_text());s.update(status='published_and_full_readback_verified',verification=v,mustAwait=[],newRows=[r for sh in payload['sheets'] for r in sh['data'] if int(r[0][2:])>=138]);by={r[0]:r for sh in payload['sheets'] for r in sh['data']}
for row in s['changedExistingRows']:row['after']=by[row['id']]
p.write_text(json.dumps(s,ensure_ascii=False,indent=2))
p=B/'既有承诺恢复审计.json';s=json.loads(p.read_text());assert s['historicalRevisionSha256']==hashlib.sha256((D/'范围修订段落.json').read_bytes()).hexdigest()
(D/'README.md').write_text('''# 知序 LifeOS v1.1 产品交付文档

正式入口https://154.40.47.111:3063，原HTTP3060保留；麦克风/相机使用HTTPS。最终web为.releases/20261014T135228Z-25423，APK1.1.1（versionCode4）。

- 产品需求文档.md：正式需求与最终补充验收，含13场景真实样例、日程状态/附件删除/餐食事实模板修复及准确验证边界。
- 产品功能表.xlsx / 产品功能表.csv：172项，前台21、用户中心88、管理员后台35、验收与依赖22、P2六项；与原飞书功能表全量一致。
- implementation-status.json：逐项记录浏览器/接口/实际模型、隔离DB或mock传输证据及未单独专项实测项。
- 部署交付与验收报告.md：当前入口、报告计数、voice service、证书续期、备份及外部验收边界。
- 飞书交付状态.json / 本地与在线交付一致性.json：原在线链接、最新revision、全文及172行CSV/XLSX一致性证据。
- android.md：APK1.1.1权限、下载、签名；没有Android物理设备验收。
- v1.1/：正式文档源文件、范围恢复审计和本轮精确验收映射/同步回读；v1.0/保留旧交付快照。
- tests/：保留原始失败与后续修复/复测，区分harness断言问题和实际餐食质量缺陷；不将旧失败涂改成成功。

13场景真实调用使用合成语音及自制/生成图像，不能代替自然麦克风/相机、真实Android设备或准确率全覆盖。真实收款缺商户资料，独立受控跨网络未专项验收。历史范围修订/早期差距文件不能覆盖当前正式契约。文档不含密码或API密钥。
''')
(B/'README.md').write_text(f'''# v1.1 正式交付与补充验收

最终web已部署.releases/20261014T135228Z-25423，HTTPS3063，APK1.1.1(4)。原飞书需求文档与五张功能表已正式同步；本目录是当前正式版本记录，上一级同名文件为交付入口。

功能表172项，六项P2未改；本次只修订已有功能与证据，没有新增需求行。在线PRD revision{v['documentRevision']}，{v['docSections']}章、{v['docTopLevelParagraphs']}个顶层正文段落、1张场景表，全文与本地XML一致。172行A:J全量回读、CSV/XLSX逐值一致；344个状态/证据格无截断。

本轮补充日程8、附件backend4/API4/browser5、restored-ui5、admin-contract17、media-settings8项；模型配置专项使用隔离MySQL/actual handler/service及mock传输，不是自然设备或真实供应商调用。其余十媒体场景10/10加原三场景后，13场景均有真实样例；素材仍为合成语音、自制图和AI生成图。餐食原始/prompt-only失败保留，结构化模板unit11、contract4和最终真实1项通过，结论限于所测样例与契约。

当前精确映射及回读：待同步验收修订.json、飞书待同步清单.json（名称保留，内部均为published_and_full_readback_verified）、最终回读验证.json。旧范围修订哈希及恢复审计保留。merchant资料、Android真机/自然采集设备、独立跨网络边界不变。
''')
(D/'文档交付验证.md').write_text(f'''# v1.1 最终文档交付验证

验证时间：{v['verifiedAt']}。

- [原飞书PRD](https://rjppwe2dlq09.jp.larksuite.com/docx/[REDACTED_LARK_RESOURCE_TOKEN])：revision{v['documentRevision']}，{v['docSections']}章、{v['docTopLevelParagraphs']}个顶层正文段落、1张13场景表；8组局部更新后全文与本地XML逐块一致。
- [原飞书功能表](https://rjppwe2dlq09.jp.larksuite.com/sheets/[REDACTED_LARK_RESOURCE_TOKEN])：172项（21/88/35/22/6），本轮{v['changedSheetCells']}格写入、全部A:J回读一致；没有新增行，六项P2原样保留。
- 344个状态/证据格换行与行高检查无截断。CSV和XLSX全172行及各表表头与JSON逐值一致，ZIP/XML有效。
- 最终release135228Z-25423与新备份13-54-10均已写入；v1.0历史和旧测试失败保留，旧范围修订SHA未变。

当前13场景都有真实模型样例输出；合成语音与生成图像不等于物理麦克风/相机、Android真机或全量准确率。media-settings是隔离DB及mock传输，餐食修复结论限于实际样例和契约测试。真实收款和独立跨网络专项仍未完成。

证据：v1.1/最终回读验证.json、飞书最终文档回读.json、飞书最终功能表回读.json、飞书交付状态.json、本地与在线交付一致性.json。
''')
print(json.dumps(v,ensure_ascii=False))
