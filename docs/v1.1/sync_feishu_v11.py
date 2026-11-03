from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import json,subprocess,os,re,csv,io,html,difflib,xml.etree.ElementTree as ET,zipfile,shutil
B=Path(__file__).resolve().parent;D=B.parent
SHEET='[REDACTED_LARK_RESOURCE_TOKEN]';DOC='[REDACTED_LARK_RESOURCE_TOKEN]'
ENV={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1','LARKSUITE_CLI_NO_SKILLS_NOTIFIER':'1'}
def cli(domain,*args,payload=None):
 p=subprocess.run(['lark-cli',domain,*args,'--as','user'],input=payload,text=True,capture_output=True,env=ENV)
 v=json.loads(p.stdout if p.returncode==0 else p.stderr)
 assert p.returncode==0 and v.get('ok'),v
 if domain=='docs' and '+update' in args:assert v['data']['result']=='success' and not v['data'].get('warnings'),v
 return v
def read_sheet(name):
 v=cli('sheets','+csv-get','--spreadsheet-token',SHEET,'--sheet-name',name);d=v['data'];assert not d.get('has_more') and not d.get('truncated'),name
 rows={}
 for line in d['annotated_csv'].splitlines():
  m=re.match(r'\[row=(\d+)\] (.*)',line)
  if m:
   values=next(csv.reader([m[2]]));assert not any(values[10:]),('Unexpected populated columns',name);rows[int(m[1])]=values[:10]
 return v,rows
wanted=json.loads((B/'功能表数据.json').read_text());old=json.loads((D/'功能表数据.json').read_text());oldby={s['name']:s for s in old['sheets']}
before={};writes=[]
for s in wanted['sheets']:
 v,rows=read_sheet(s['name']);before[s['name']]=v
 actual=[r for r in rows.values() if r and re.fullmatch(r'F-\d{3}',r[0])]
 assert actual in (oldby[s['name']]['data'],s['data']),('Remote unexpectedly changed',s['name'])
 changed=[]
 for i,row in enumerate(s['data'],2):
  if rows.get(i)!=row:changed.append((i,row))
 groups=[]
 for n,row in changed:
  if groups and groups[-1][-1][0]+1==n:groups[-1].append((n,row))
  else:groups.append([(n,row)])
 for group in groups:writes.append({'sheet_name':s['name'],'range':f'A{group[0][0]}:J{group[-1][0]}','cells':[[{'value':v} for v in row] for _,row in group]})
(B/'飞书同步前功能表.json').write_text(json.dumps(before,ensure_ascii=False,indent=2));(B/'飞书功能表写入.json').write_text(json.dumps(writes,ensure_ascii=False,indent=2))
wr=[]
for i in range(0,len(writes),50):wr.append(cli('sheets','+cells-set','--spreadsheet-token',SHEET,'--writes','-',payload=json.dumps(writes[i:i+50],ensure_ascii=False)))
(B/'飞书功能表写入结果.json').write_text(json.dumps(wr,ensure_ascii=False,indent=2))
after={}
for s in wanted['sheets']:
 v,rows=read_sheet(s['name']);after[s['name']]=v;actual=[r for r in rows.values() if r and re.fullmatch(r'F-\d{3}',r[0])];assert actual==s['data'],s['name']
(B/'飞书最终功能表回读.json').write_text(json.dumps(after,ensure_ascii=False,indent=2));print('sheet: 172 full rows verified',flush=True)
# Translate our paragraph-style PRD and the new scenario matrix to Docx XML.
blocks=[];lines=(B/'产品需求文档.md').read_text().splitlines();i=0
while i<len(lines):
 line=lines[i].strip()
 if not line:i+=1;continue
 if line.startswith('# '):blocks.append('<title>'+html.escape(line[2:])+'</title>');i+=1;continue
 if line.startswith('## '):blocks.append('<h1 seq="auto">'+html.escape(line[3:])+'</h1>');i+=1;continue
 if line.startswith('|'):
  table=[]
  while i<len(lines) and lines[i].strip().startswith('|'):
   vals=[v.strip() for v in lines[i].strip().strip('|').split('|')]
   if not all(re.fullmatch(r':?-+:?',v) for v in vals):table.append(vals)
   i+=1
  x='<table><thead><tr>'+''.join('<th background-color="light-gray"><p>'+html.escape(c)+'</p></th>' for c in table[0])+'</tr></thead><tbody>'
  x+=''.join('<tr>'+''.join('<td><p>'+html.escape(c)+'</p></td>' for c in row)+'</tr>' for row in table[1:])+'</tbody></table>';blocks.append(x);continue
 para=[line];i+=1
 while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|')):para.append(lines[i].strip());i+=1
 blocks.append('<p>'+html.escape(' '.join(para))+'</p>')
target=ET.fromstring('<root>'+''.join(blocks)+'</root>');(B/'产品需求文档.xml').write_text('\n'.join(blocks)+'\n')
v=cli('docs','+fetch','--doc',DOC,'--detail','full');(B/'飞书同步前文档.json').write_text(json.dumps(v,ensure_ascii=False,indent=2));remote=ET.fromstring('<root>'+v['data']['document']['content']+'</root>')
key=lambda e:(e.tag,''.join(e.itertext()))
ops=[]
if key(remote[0])!=key(target[0]):
 ops.append(cli('docs','+update','--doc',DOC,'--command','str_replace','--pattern',''.join(remote[0].itertext()),'--content',''.join(target[0].itertext())))
 v=cli('docs','+fetch','--doc',DOC,'--detail','full');remote=ET.fromstring('<root>'+v['data']['document']['content']+'</root>')
matcher=difflib.SequenceMatcher(a=[key(e) for e in remote],b=[key(e) for e in target],autojunk=False)
changes=[op for op in matcher.get_opcodes() if op[0]!='equal'];print('document operations:',len(changes),flush=True)
for action,a1,a2,b1,b2 in reversed(changes):
 content=''.join(ET.tostring(e,encoding='unicode') for e in list(target)[b1:b2])
 if action=='insert':args=['--command','block_insert_after','--block-id',remote[a1-1].attrib['id'] if a1 else '0','--content','-']
 elif action=='delete':args=['--command','block_delete','--start-block-id',remote[a1].attrib['id'],'--end-block-id',remote[a2-1].attrib['id']]
 else:args=['--command','block_replace','--start-block-id',remote[a1].attrib['id'],'--end-block-id',remote[a2-1].attrib['id'],'--content','-']
 ops.append(cli('docs','+update','--doc',DOC,*args,payload=content))
(B/'飞书文档局部更新结果.json').write_text(json.dumps(ops,ensure_ascii=False,indent=2))
v=cli('docs','+fetch','--doc',DOC,'--detail','full');(B/'飞书最终文档回读.json').write_text(json.dumps(v,ensure_ascii=False,indent=2));actual=ET.fromstring('<root>'+v['data']['document']['content']+'</root>')
assert [key(e) for e in actual]==[key(e) for e in target], 'Full PRD text mismatch'
styles={'styles':[{'name':s['name'],'cell_styles':[{'range':f'A1:J{len(s["data"])+1}','font_size':11,'vertical_alignment':'top','word_wrap':'auto-wrap'},{'range':'A1:J1','font_weight':'bold','font_color':'#FFFFFF','background_color':'#243B35','vertical_alignment':'middle'},{'range':f'A2:E{len(s["data"])+1}','background_color':'#F2F5F2'},{'range':f'I2:J{len(s["data"])+1}','background_color':'#FFF7E8'}],'row_sizes':[{'range':f'2:{len(s["data"])+1}','type':'auto'}]} for s in wanted['sheets']]}
(B/'飞书样式结果.json').write_text(json.dumps(cli('sheets','+styles-put','--spreadsheet-token',SHEET,'--styles','-',payload=json.dumps(styles,ensure_ascii=False)),ensure_ascii=False,indent=2))
styleback={};count=0;clipped=[]
for s in wanted['sheets']:
 r=cli('sheets','+cells-get','--spreadsheet-token',SHEET,'--sheet-name',s['name'],'--range',f'I2:J{len(s["data"])+1}','--include','value,style,truncation');styleback[s['name']]=r;assert not r['data'].get('has_more')
 for ran in r['data']['ranges']:
  for row in ran['cells']:
   for c in row:
    count+=1
    if c.get('isRowTruncated') or c.get('isColTruncated'):clipped.append(c)
assert count==344 and not clipped,(count,clipped)
(B/'飞书证据列排版回读.json').write_text(json.dumps(styleback,ensure_ascii=False,indent=2))
with zipfile.ZipFile(B/'产品功能表.xlsx') as z:
 assert z.testzip() is None
 for n in z.namelist():
  if n.endswith(('.xml','.rels')):ET.fromstring(z.read(n))
verification={'verifiedAt':datetime.now(timezone.utc).isoformat(),'features':172,'newFeatures':max(0,172-sum(len(s['data']) for s in old['sheets'])),'versionAddedFeatures':35,'sheets':{s['name']:len(s['data']) for s in wanted['sheets']},'fullSheetCellsMatch':True,'docFullTextMatchesXml':True,'docSections':len(actual.findall('h1')),'docTopLevelParagraphs':len(actual.findall('p')),'docTables':len(actual.findall('table')),'documentRevision':v['data']['document'].get('revision_id'),'xlsxZipAndXmlValid':True,'statusEvidenceCellsChecked':count,'clippedCells':0,'p2Unchanged':wanted['sheets'][-1]==old['sheets'][-1],'changedSheetCells':sum(len(w['cells'])*10 for w in writes)}
(B/'最终回读验证.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2))
# Promote verified files only after both online artifacts and export checks pass.
archive=D/'v1.0';archive.mkdir(exist_ok=True)
for name in ['产品需求文档.md','功能表数据.json','产品功能表.csv','产品功能表.xlsx','implementation-status.json','部署交付与验收报告.md','飞书交付状态.json']:
 if (D/name).exists() and not (archive/name).exists():shutil.copy2(D/name,archive/name)
for name in ['产品需求文档.md','功能表数据.json','产品功能表.csv','产品功能表.xlsx','implementation-status.json','飞书最终文档回读.json','飞书最终功能表回读.json','飞书证据列排版回读.json']:
 shutil.copy2(B/name,D/name)
shutil.copy2(B/'产品需求文档.xml',D/'draft_81969f84_folder/draft.xml')
for name in ['本地与在线交付一致性.json','飞书最终状态验证.json']:(D/name).write_text(json.dumps(verification,ensure_ascii=False,indent=2))
status=json.loads((D/'飞书交付状态.json').read_text());status['document'].update(sections=verification['docSections'],paragraphs=verification['docTopLevelParagraphs'],tables=verification['docTables'],revision=verification['documentRevision']);status['spreadsheet'].update(features=172,sheets=verification['sheets']);status['status_sync']=verification;status['implementation_note']='v1.1最终验收已同步：13场景真实样例、日程/附件修复及后台配置证据区分；合成素材不是物理设备，真实收款/真机/跨网络边界保留。';status['delivery_appendix']={'title':'v1.1 最终交付与证据','verified':True,'revision':verification['documentRevision']};(D/'飞书交付状态.json').write_text(json.dumps(status,ensure_ascii=False,indent=2))
print(json.dumps(verification,ensure_ascii=False),flush=True)
