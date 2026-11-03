from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import csv,json,subprocess,os,xml.etree.ElementTree as ET,zipfile
B=Path(__file__).resolve().parent
TOKEN=os.environ.get('LARK_SHEET_TOKEN')
if not TOKEN:
    raise RuntimeError('缺少 LARK_SHEET_TOKEN 环境变量')
env={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1','LARKSUITE_CLI_NO_SKILLS_NOTIFIER':'1'}
def cli(*args,payload=None):
 p=subprocess.run(['lark-cli','sheets',*args,'--spreadsheet-token',TOKEN,'--as','user'],input=payload,text=True,capture_output=True,env=env)
 v=json.loads(p.stdout if p.returncode==0 else p.stderr); assert p.returncode==0 and v.get('ok'),v;return v
sheets=json.loads((B/'功能表数据.json').read_text())['sheets']
styles={'styles':[{'name':s['name'],'cell_styles':[{'range':f'I2:J{len(s["data"])+1}','word_wrap':'auto-wrap'}],'row_sizes':[{'range':f'2:{len(s["data"])+1}','type':'auto'}]} for s in sheets]}
r=cli('+styles-put','--styles','-',payload=json.dumps(styles,ensure_ascii=False))
(B/'飞书最终样式更新结果.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
checks={}; cells=0;clipped=[]
for s in sheets:
 v=cli('+cells-get','--sheet-name',s['name'],'--range',f'I2:J{len(s["data"])+1}','--include','value,style,truncation')
 checks[s['name']]=v
 d=v['data'];assert not d.get('has_more'),s['name']
 for ran in d['ranges']:
  for row in ran['cells']:
   for c in row:
    cells+=1
    if c.get('isRowTruncated') or c.get('isColTruncated'):clipped.append(c)
assert cells==274 and not clipped,(cells,clipped)
(B/'飞书证据列排版回读.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
online=json.loads((B/'飞书最终文档回读.json').read_text())['data']['document']['content']
a=ET.fromstring('<root>'+online+'</root>');b=ET.fromstring('<root>'+(B/'draft_81969f84_folder/draft.xml').read_text()+'</root>')
assert [(e.tag,''.join(e.itertext())) for e in a]==[(e.tag,''.join(e.itertext())) for e in b]
with zipfile.ZipFile(B/'产品功能表.xlsx') as z:
 assert z.testzip() is None
 for name in z.namelist():
  if name.endswith(('.xml','.rels')):ET.fromstring(z.read(name))
with (B/'产品功能表.csv').open(encoding='utf-8-sig') as f: csvrows=list(csv.reader(f))
assert len(csvrows)==138
assert not any(r[8]=='需求已定义，待实现验收' for r in csvrows[1:])
status=json.loads((B/'飞书交付状态.json').read_text())
status['status_sync']=json.loads((B/'飞书最终状态验证.json').read_text())
status['status_sync'].update(evidenceCellsClippingChecked=cells,evidenceCellsClipped=0)
issue=json.loads((B/'页面故障验收待同步.json').read_text()) if (B/'页面故障验收待同步.json').exists() else {}
resolved=issue.get('status')=='deployed_and_regression_verified'
issue_note='用户报告的页面加载故障已复现修复，生产Chromium145/156导航回归通过。' if resolved else '用户报告的页面加载问题仍在排查，尚不作最终上线交付结论。'
status['implementation_note']='137项实现/测试证据已同步。真实收款待商户资料，Android真机和独立受控跨网络浏览器未验收；公网外部日志已有36次成功记录。'+issue_note
(B/'飞书交付状态.json').write_text(json.dumps(status,ensure_ascii=False,indent=2))
verification={'verifiedAt':datetime.now(timezone.utc).isoformat(),'docHeadings':len(a.findall('h1')),'docParagraphs':len(a.findall('p')),'docFullTextMatchesLocalXml':True,'xlsxZipAndXmlValid':True,'features':137,'statusCounts':dict(Counter(r[8] for r in csvrows[1:])),'statusAndEvidenceCells':cells,'clippedCells':0,'releaseIssue':issue_note}
(B/'本地与在线交付一致性.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2))
print(json.dumps(verification,ensure_ascii=False))
