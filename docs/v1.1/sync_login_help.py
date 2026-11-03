from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,os,csv,re,shutil,html,zipfile,xml.etree.ElementTree as ET
B=Path(__file__).resolve().parent; D=B.parent; R=D.parent
OLD='.releases/20261014T135228Z-25423'; NEW='.releases/20261014T140449Z-27763'
DOC='[REDACTED_LARK_RESOURCE_TOKEN]'; SHEET='[REDACTED_LARK_RESOURCE_TOKEN]'
ENV={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1','LARKSUITE_CLI_NO_SKILLS_NOTIFIER':'1'}
def cli(domain,*args,payload=None):
 p=subprocess.run(['lark-cli',domain,*args,'--as','user'],input=payload,text=True,capture_output=True,env=ENV)
 v=json.loads(p.stdout if p.returncode==0 else p.stderr); assert p.returncode==0 and v.get('ok'),v
 if domain=='docs' and '+update' in args:assert v['data']['result']=='success' and not v['data'].get('warnings'),v
 return v
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2))
inspection=json.loads((D/'tests/login-help-inspection.json').read_text());assert inspection['release']==NEW and len(inspection['checks'])==4 and all(x['passed'] for x in inspection['checks']) and not inspection['errors']
olddata=json.loads((D/'功能表数据.json').read_text()); wanted=json.loads(json.dumps(olddata)); row=next(r for s in wanted['sheets'] for r in s['data'] if r[0]=='F-012')
row[5]='验证账号密码并建立会话；忘记密码时查看邮件未开通说明及管理员联系帮助'
row[6]='错误密码拒绝且成功进入用户中心；未开通邮件时不假称已发送，联系信息未配置则说明现状和联系管理员的渠道'
row[9]+=' login-help-inspection.json：生产匿名登录可展开“忘记密码”并进入联系帮助，邮件自助未开通/联系信息未配置的说明及390px布局通过；已配置supportContact显示仅用浏览器响应fixture验证，未修改生产设置。未发送邮件、重置密码或新增重置API。'
# Confirm exact affected row before writing, preserving all existing sheet structure/styles.
read=cli('sheets','+cells-get','--spreadsheet-token',SHEET,'--sheet-name','前台','--range','A13:J13','--include','value,style,truncation')
actual=[c.get('value','') for c in read['data']['ranges'][0]['cells'][0]]; oldrow=next(r for s in olddata['sheets'] for r in s['data'] if r[0]=='F-012');assert actual==oldrow,actual
writes=[{'sheet_name':'前台','range':f'{col}13:{col}13','cells':[[{'value':row[ix]}]]} for col,ix in [('F',5),('G',6),('J',9)]]
result=cli('sheets','+cells-set','--spreadsheet-token',SHEET,'--writes','-',payload=json.dumps(writes,ensure_ascii=False));save(B/'登录帮助功能表写入结果.json',result)
styles={'styles':[{'name':'前台','row_sizes':[{'range':'13:13','type':'auto'}]}]}
cli('sheets','+styles-put','--spreadsheet-token',SHEET,'--styles','-',payload=json.dumps(styles,ensure_ascii=False))
back={}
for s in wanted['sheets']:
 v=cli('sheets','+csv-get','--spreadsheet-token',SHEET,'--sheet-name',s['name']);assert not v['data'].get('has_more');back[s['name']]=v;rows=[]
 for line in v['data']['annotated_csv'].splitlines():
  m=re.match(r'\[row=(\d+)\] (.*)',line)
  if m:
   r=next(csv.reader([m[2]]))
   if r and re.fullmatch(r'F-\d{3}',r[0]):assert not any(r[10:]);rows.append(r[:10])
 assert rows==s['data'],s['name']
assert wanted['sheets'][-1]==olddata['sheets'][-1]
layout=cli('sheets','+cells-get','--spreadsheet-token',SHEET,'--sheet-name','前台','--range','F13:J13','--include','value,style,truncation');assert all(not c.get('isRowTruncated') and not c.get('isColTruncated') for c in layout['data']['ranges'][0]['cells'][0]);save(B/'登录帮助排版回读.json',layout)
print('F-012 three cells written; all 172 rows read back, changed row no clipping.',flush=True)
# Patch only existing PRD paragraphs; no sections or requirement rows added.
clause='找回密码若未配置邮件服务，应说明暂不可用并提供管理员处理路径，不能假称邮件已发送。'
addition=' 登录页现已提供“忘记密码？”折叠帮助并打开既有联系窗口；已配置supportContact时显示其内容，未配置时说明现状并引导从获取本站地址的渠道联系管理员，提醒勿发送密码。login-help-inspection.json记录生产未配置分支和移动布局检查；已配置分支仅通过浏览器响应fixture验证，不代表发送邮件或新增密码重置API。'
source=(B/'产品需求文档.xml').read_text();assert clause in source
newxml=source.replace(OLD,NEW).replace(html.escape(clause),html.escape(clause+addition))
# The media health report is historical; identify it as the earlier release check.
newxml=newxml.replace('，media-release-health.json确认四入口200、web/worker/voice active/enabled；','，login-help-inspection.json确认本次登录帮助修复；先前media-release-health.json确认四入口200、web/worker/voice active/enabled；')
v=cli('docs','+fetch','--doc',DOC,'--detail','full');remote=ET.fromstring('<root>'+v['data']['document']['content']+'</root>');target=ET.fromstring('<root>'+newxml+'</root>');original=ET.fromstring('<root>'+source+'</root>');key=lambda e:(e.tag,''.join(e.itertext()));assert [key(e) for e in remote]==[key(e) for e in original]
ops=[]
for previous,nextblock in zip(remote,target):
 if key(previous)!=key(nextblock):ops.append(cli('docs','+update','--doc',DOC,'--command','block_replace','--block-id',previous.attrib['id'],'--content','-',payload=ET.tostring(nextblock,encoding='unicode')))
v=cli('docs','+fetch','--doc',DOC,'--detail','full');actual=ET.fromstring('<root>'+v['data']['document']['content']+'</root>');assert [key(e) for e in actual]==[key(e) for e in target]
save(B/'登录帮助文档更新结果.json',ops)
for p in [B/'产品需求文档.xml',D/'draft_81969f84_folder/draft.xml']:p.write_text(newxml)
for p in [B/'产品需求文档.md',D/'产品需求文档.md']:
 text=p.read_text().replace(OLD,NEW).replace(clause,clause+addition).replace('，media-release-health.json确认四入口200、web/worker/voice active/enabled；','，login-help-inspection.json确认本次登录帮助修复；先前media-release-health.json确认四入口200、web/worker/voice active/enabled；');p.write_text(text)
for p in [B/'飞书最终文档回读.json',D/'飞书最终文档回读.json']:save(p,v)
for p in [B/'飞书最终功能表回读.json',D/'飞书最终功能表回读.json']:save(p,back)
for p in [B/'功能表数据.json',D/'功能表数据.json']:save(p,wanted)
for p in [B/'implementation-status.json',D/'implementation-status.json']:
 j=json.loads(p.read_text());f=next(x for x in j['features'] if x['id']=='F-012');f.update(status=row[8],evidence=row[9]);save(p,j)
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
proof=json.loads((B/'最终回读验证.json').read_text());oldrevision=proof['documentRevision'];proof.update(verifiedAt=datetime.now(timezone.utc).isoformat(),documentRevision=v['data']['document']['revision_id'],docSections=len(actual.findall('h1')),docTopLevelParagraphs=len(actual.findall('p')),docTables=len(actual.findall('table')),currentRelease=NEW,loginHelp={'report':'docs/tests/login-help-inspection.json','productionChecks':3,'browserResponseFixtureChecks':1,'changedSheetCells':3,'documentParagraphsPatched':len(ops),'all172RowsMatch':True,'changedRowNoClipping':True},csvAll172RowsMatch=True,xlsxAll172RowsMatch=True)
for p in [B/'最终回读验证.json',D/'本地与在线交付一致性.json',D/'飞书最终状态验证.json']:save(p,proof)
p=D/'飞书交付状态.json';state=json.loads(p.read_text());state['document']['revision']=proof['documentRevision'];state['status_sync']=proof;state['delivery_appendix']['revision']=proof['documentRevision'];save(p,state)
for name in ['飞书待同步清单.json','待同步验收修订.json']:
 p=B/name;j=json.loads(p.read_text());j['verification']=proof;save(p,j)
# Current entry documents only. Keep historic evidence/release snapshots intact.
for p in [R/'README.md',D/'README.md',B/'README.md',D/'部署交付与验收报告.md',B/'部署交付与验收报告.md']:
 text=p.read_text().replace(OLD,NEW).replace('revision'+str(oldrevision),'revision'+str(proof['documentRevision']))
 if p.name=='部署交付与验收报告.md':
  text=text.replace('## 真实AI和媒体证据','登录页已补齐原有找回密码提示契约：邮件自助未开通时明确说明，并从“忘记密码？”打开联系帮助；未配置联系方式时提供原获取本站渠道联系管理员的指引，提醒勿发送密码。login-help-inspection.json的生产匿名入口、未配置说明及390px布局三项通过；已配置联系信息显示为浏览器响应fixture检查。没有发邮件或执行密码重置，也未新增重置API。\n\n## 真实AI和媒体证据')
  text=text.replace('| media-release-health.json | 最终版本健康 |','| media-release-health.json | 前一版本健康 |')
 p.write_text(text)
p=D/'文档交付验证.md';text=p.read_text().replace('2026-10-14T13:58:44.194965+00:00',proof['verifiedAt']).replace('revision'+str(oldrevision),'revision'+str(proof['documentRevision'])).replace('8组局部更新后全文','本轮'+str(len(ops))+'个既有段落局部更新后全文').replace('本轮360格写入','本轮仅F-012的3格写入').replace('最终release135228Z-25423','最终release140449Z-27763');text+='\n登录帮助补充：生产3项、浏览器响应fixture 1项通过；未新增邮件或密码重置系统。172行全量回读与CSV/XLSX一致性已重新验证，本轮变更行无截断，其余格式保持。\n';p.write_text(text)
print(json.dumps({'revision':proof['documentRevision'],'prdPatches':len(ops),'sheetCellsChanged':3,'features':172,'p2':6,'csvXlsxAllRowsMatch':True,'release':NEW},ensure_ascii=False),flush=True)
