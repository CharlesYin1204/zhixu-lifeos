"""Narrow preferred domain documentation sync; run only after verified release input exists."""
from pathlib import Path
from datetime import datetime, timezone
import json, subprocess, os, csv, re, shutil, html, zipfile, xml.etree.ElementTree as ET
B=Path(__file__).resolve().parent; D=B.parent; R=D.parent
DOC='[REDACTED_LARK_RESOURCE_TOKEN]'; SHEET='[REDACTED_LARK_RESOURCE_TOKEN]'
ENV={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1','LARKSUITE_CLI_NO_SKILLS_NOTIFIER':'1'}
def cli(domain,*args,payload=None):
 p=subprocess.run(['lark-cli',domain,*args,'--as','user'],input=payload,text=True,capture_output=True,env=ENV)
 v=json.loads(p.stdout if p.returncode==0 else p.stderr)
 assert p.returncode==0 and v.get('ok'), v
 if domain=='docs' and '+update' in args: assert v['data']['result']=='success' and not v['data'].get('warnings'),v
 return v
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2))
def rows_from(v):
 assert not v['data'].get('has_more');rows=[]
 for line in v['data']['annotated_csv'].splitlines():
  m=re.match(r'\[row=(\d+)\] (.*)',line)
  if m:
   row=next(csv.reader([m[2]]))
   if row and re.fullmatch(r'F-\d{3}',row[0]):assert not any(row[10:]);rows.append(row[:10])
 return rows
config=json.loads((B/'域名入口最终输入.json').read_text())
assert config['approvedForPublication'] is True
NEW=config['release'];OLD='.releases/20261014T150944Z-36035';BACKUP=config['backup']
plan=json.loads((B/'域名入口修订草案.json').read_text())
for file in config['reports']:
 report=json.loads((D/'tests'/file).read_text());checks=report.get('results',report.get('checks',[]));assert checks and any(r.get('passed') is True for r in checks) and not any(r.get('passed') is False for r in checks),file
 if 'passed' in report:assert bool(report['passed']),file
browser=json.loads((D/'tests'/config['primaryReport']).read_text())
assert browser['passed'] is True and not browser.get('errors') and not browser.get('pageErrors') and not browser.get('staticFailures') and browser['release']==NEW
health=json.loads((D/'tests'/config['healthReport']).read_text());assert health['release']==NEW
olddata=json.loads((D/'功能表数据.json').read_text());wanted=json.loads(json.dumps(olddata))
oldxml=(B/'产品需求文档.xml').read_text();original=ET.fromstring('<root>'+oldxml+'</root>')
target=ET.fromstring('<root>'+oldxml+'</root>')
for idx,text in plan['paragraphs'].items():
 block=target[int(idx)];assert block.tag=='p';block.text=text.replace('{release}',NEW)
target[2].text=target[2].text.replace(OLD,NEW)
# Keep the public landing acceptance linked to the release actually tested.
target[161].text=target[161].text.replace('最终Web发布','上一轮公开首页Web发布',1).replace('最新受限备份','该轮受限备份')
for text in [config['acceptanceHeading'],config['acceptanceText'],config['runtimeText']]:
 block=ET.Element('h1' if text==config['acceptanceHeading'] else 'p',{'seq':'auto'} if text==config['acceptanceHeading'] else {});block.text=text;target.append(block)
newxml='\n'.join(ET.tostring(x,encoding='unicode') for x in target)+'\n'
for s in wanted['sheets']:
 for row in s['data']:
  if row[0] not in plan['features']:continue
  for ix,value in plan['features'][row[0]].items():row[int(ix)]=value
  row[8]=config['featureStatuses'].get(row[0],row[8])
  row[9]=('' if row[9].startswith('历史证据：') else '历史证据：')+row[9]+' 本轮首选域名：'+config['featureEvidence'][row[0]]
# Fresh baseline compare, all five sheets, before any online write.
before={}
for s in olddata['sheets']:
 v=cli('sheets','+csv-get','--spreadsheet-token',SHEET,'--sheet-name',s['name']);assert rows_from(v)==s['data'],s['name'];before[s['name']]=v
save(B/'域名入口写前功能表复核.json',before)
v=cli('docs','+fetch','--doc',DOC,'--detail','full');remote=ET.fromstring('<root>'+v['data']['document']['content']+'</root>')
key=lambda e:(e.tag,''.join(e.itertext()))
assert [key(e) for e in remote]==[key(e) for e in original], 'Remote PRD changed since prepared baseline'
save(B/'域名入口写前文档复核.json',v)
writes=[];changed={}
for prev,s in zip(olddata['sheets'],wanted['sheets']):
 for rownum,(a,b) in enumerate(zip(prev['data'],s['data']),2):
  for col,(old,new) in enumerate(zip(a,b)):
   if old!=new:
    cell=f'{chr(65+col)}{rownum}';writes.append({'sheet_name':s['name'],'range':cell,'cells':[[{'value':new}]]});changed.setdefault(s['name'],set()).add(rownum)
assert len([r for s in wanted['sheets'] for r in s['data']])==172 and wanted['sheets'][-1]==olddata['sheets'][-1]
result=cli('sheets','+cells-set','--spreadsheet-token',SHEET,'--writes','-',payload=json.dumps(writes,ensure_ascii=False));save(B/'域名入口功能表写入结果.json',result)
styles={'styles':[{'name':name,'row_sizes':[{'range':f'{row}:{row}','type':'auto'} for row in sorted(rows)]} for name,rows in changed.items()]}
cli('sheets','+styles-put','--spreadsheet-token',SHEET,'--styles','-',payload=json.dumps(styles,ensure_ascii=False))
back={}
for s in wanted['sheets']:
 v=cli('sheets','+csv-get','--spreadsheet-token',SHEET,'--sheet-name',s['name']);assert rows_from(v)==s['data'],s['name'];back[s['name']]=v
layout={};cellcount=0
for name,rows in changed.items():
 for row in sorted(rows):
  v=cli('sheets','+cells-get','--spreadsheet-token',SHEET,'--sheet-name',name,'--range',f'F{row}:J{row}','--include','value,style,truncation');cells=v['data']['ranges'][0]['cells'][0]
  assert all(not c.get('isRowTruncated') and not c.get('isColTruncated') for c in cells),(name,row);layout[f'{name}:{row}']=v;cellcount+=len(cells)
save(B/'域名入口排版回读.json',layout)
print('Feature cells written and all 172 rows verified.',flush=True)
ops=[]
for previous,nextblock in zip(remote,target):
 if key(previous)!=key(nextblock):ops.append(cli('docs','+update','--doc',DOC,'--command','block_replace','--block-id',previous.attrib['id'],'--content','-',payload=ET.tostring(nextblock,encoding='unicode')))
extra=list(target)[len(remote):]
if extra:ops.append(cli('docs','+update','--doc',DOC,'--command','append','--content','-',payload='\n'.join(ET.tostring(e,encoding='unicode') for e in extra)))
v=cli('docs','+fetch','--doc',DOC,'--detail','full');actual=ET.fromstring('<root>'+v['data']['document']['content']+'</root>');assert [key(e) for e in actual]==[key(e) for e in target]
save(B/'域名入口文档更新结果.json',ops)
for p in [B/'产品需求文档.xml',D/'draft_81969f84_folder/draft.xml']:p.write_text(newxml)
for p in [B/'产品需求文档.md',D/'产品需求文档.md']:
 text=p.read_text()
 for a,b in zip(original,target):
  if key(a)!=key(b):
   old=''.join(a.itertext());new=''.join(b.itertext());assert old in text,old[:80];text=text.replace(old,new)
 text+='\n## '+config['acceptanceHeading']+'\n\n'+config['acceptanceText']+'\n\n'+config['runtimeText']+'\n';p.write_text(text)
for p in [B/'飞书最终文档回读.json',D/'飞书最终文档回读.json']:save(p,v)
for p in [B/'飞书最终功能表回读.json',D/'飞书最终功能表回读.json']:save(p,back)
for p in [B/'功能表数据.json',D/'功能表数据.json']:save(p,wanted)
featuremap={r[0]:r for s in wanted['sheets'] for r in s['data']}
for p in [B/'implementation-status.json',D/'implementation-status.json']:
 j=json.loads(p.read_text())
 for f in j['features']:
  if f['id'] in plan['affectedFeatureIds']:f.update(status=featuremap[f['id']][8],evidence=featuremap[f['id']][9])
 save(p,j)
with (B/'产品功能表.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(wanted['sheets'][0]['columns']);w.writerows(r for s in wanted['sheets'] for r in s['data'])
subprocess.run(['python3',str(B/'export_xlsx.py')],check=True)
for n in ['产品功能表.csv','产品功能表.xlsx']:shutil.copy2(B/n,D/n)
with (D/'产品功能表.csv').open(encoding='utf-8-sig') as f:assert list(csv.reader(f))==[wanted['sheets'][0]['columns']]+[r for s in wanted['sheets'] for r in s['data']]
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(D/'产品功能表.xlsx') as z:
 assert z.testzip() is None
 for i,s in enumerate(wanted['sheets'],1):
  x=ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'));rows=[[''.join(c.find('s:is',ns).itertext()) for c in r] for r in x.findall('s:sheetData/s:row',ns)];assert rows==[s['columns']]+s['data']
proof=json.loads((B/'最终回读验证.json').read_text());oldrevision=proof['documentRevision'];oldsections=proof['docSections'];oldparagraphs=proof['docTopLevelParagraphs']
proof.update(verifiedAt=datetime.now(timezone.utc).isoformat(),documentRevision=v['data']['document']['revision_id'],docSections=len(actual.findall('h1')),docTopLevelParagraphs=len(actual.findall('p')),docTables=len(actual.findall('table')),currentRelease=NEW,changedSheetCells=len(writes),changedRowLayoutCellsChecked=cellcount,preferredDomain={'reports':config['reports'],'affectedFeatureIds':plan['affectedFeatureIds'],'changedSheetCells':len(writes),'docPatchOperations':len(ops),'all172RowsMatch':True,'changedRowsNoClipping':True,'legacyHistoryPreserved':True},csvAll172RowsMatch=True,xlsxAll172RowsMatch=True)
proof['previousSyncSheetCellsWritten']=proof.get('totalSheetCellsWritten',0);proof['totalSheetCellsWritten']=proof['previousSyncSheetCellsWritten']+len(writes)
for p in [B/'最终回读验证.json',D/'本地与在线交付一致性.json',D/'飞书最终状态验证.json']:save(p,proof)
p=D/'飞书交付状态.json';state=json.loads(p.read_text());state['document']['revision']=proof['documentRevision'];state['status_sync']=proof;state['delivery_appendix']['revision']=proof['documentRevision'];save(p,state)
for name in ['飞书待同步清单.json','待同步验收修订.json']:
 p=B/name;j=json.loads(p.read_text());j['verification']=proof;save(p,j)
for p in [R/'README.md',D/'README.md',B/'README.md',D/'部署交付与验收报告.md',B/'部署交付与验收报告.md']:
 text=p.read_text().replace(OLD,NEW,1).replace('revision'+str(oldrevision),'revision'+str(proof['documentRevision'])).replace(f'{oldsections}章、{oldparagraphs}个顶层正文段落',f"{proof['docSections']}章、{proof['docTopLevelParagraphs']}个顶层正文段落")
 if p==R/'README.md':
  for label in ['网站','语音、录音与图片解题','用户中心','用户登录','管理后台','管理员登录']:
   text=text.replace('- '+label+'：https://154.40.47.111:3063','- '+label+'：https://xuexi.yinchao1204.vip')
  text=text.replace('- 原 HTTP 入口继续保留：','- 原 IP HTTPS 入口继续保留：https://154.40.47.111:3063/\n- 原 HTTP 入口继续保留：')
  text=text.replace('Nginx 提供 HTTPS 3063 和 HTTP 3060','Nginx 提供首选域名 HTTPS 443，并保留 IP HTTPS 3063 和 HTTP 3060')
  text=text.replace('Nginx 暂时切至候选','Nginx 的域名与 IP 入口一并暂时切至候选')
  text=text.replace('## 开发与部署','首选地址为 `https://xuexi.yinchao1204.vip`，无需端口，账户和数据沿用现有数据库。原 IP HTTPS/HTTP 入口继续兼容；域名与 IP 按主机分别建立浏览器会话。现有 APP_URL 和支付通知 URL 保持原值，已发布 Android 1.1.1 仍加载 IP HTTPS，本轮未重建 APK。\n\n## 开发与部署',1)
 elif p.name=='部署交付与验收报告.md':
  lines=text.splitlines()
  for ix,line in enumerate(lines):
   if line.startswith('| ') and 'https://154.40.47.111:3063' in line and '/api/download?' not in line:lines[ix]=line.replace('https://154.40.47.111:3063','https://xuexi.yinchao1204.vip')
  text='\n'.join(lines)+'\n'
  text=text.replace('| 原HTTP入口（保留） |','| 原IP HTTPS入口（保留） | https://154.40.47.111:3063/ |\n| 原HTTP入口（保留） |')
  text=text.replace('## 公开首页与登录后用户功能','## 上一轮公开首页与登录后用户功能')
  text=text.replace('## 真实AI和媒体证据','## 首选域名访问修复\n\n'+config['acceptanceText']+'\n\n'+config['runtimeText']+'\n\n## 真实AI和媒体证据',1)
  text=re.sub(r'最新数据库备份`database/backups/[^`]+`','最新数据库备份`'+BACKUP+'`',text)
  text=text.replace('Nginx公开3060与HTTPS3063','Nginx提供首选域名HTTPS443，并保留IP3060与HTTPS3063')
 else:
  text=text.replace('正式入口https://154.40.47.111:3063','首选入口https://xuexi.yinchao1204.vip（无需端口），原IP HTTPS3063保留',1)
  text=text.replace('，HTTPS3063，APK1.1.1', '，首选https://xuexi.yinchao1204.vip（原IP HTTPS3063保留），APK1.1.1',1)
  text+='\n本轮修复首选域名访问。'+config['acceptanceText']+'\n'
 p.write_text(text)
p=D/'android.md';text=p.read_text();text+='\n浏览器首选域名为https://xuexi.yinchao1204.vip；现有1.1.1(4)安装包仍加载上述IP HTTPS站点，IP入口继续保留，因此本轮未重建APK或更换签名。更改APK内置URL时才需递增版本并重新构建。\n';p.write_text(text)
p=D/'文档交付验证.md';text=p.read_text();text+='\n## 首选域名同步\n\n'+proof['verifiedAt']+'，PRD revision'+str(proof['documentRevision'])+'。仅修改既有'+str(len(plan['affectedFeatureIds']))+'项需求的'+str(len(writes))+'个单元格；全172行回读与CSV/XLSX逐值一致，P2六项保持。变更行F:J共'+str(cellcount)+'格无截断，文档全文与XML一致；历史v1.0证据保留。\n';p.write_text(text)
plan['status']='published_and_full_readback_verified';plan['verification']=proof;save(B/'域名入口修订草案.json',plan)
print(json.dumps({'revision':proof['documentRevision'],'prdPatchOperations':len(ops),'sheetCellsChanged':len(writes),'features':172,'p2':6,'csvXlsxAllRowsMatch':True,'release':NEW},ensure_ascii=False),flush=True)
