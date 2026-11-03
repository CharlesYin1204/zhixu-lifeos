from pathlib import Path
from datetime import datetime,timezone
import csv,json,os,re,subprocess,sys,shutil,zipfile,xml.etree.ElementTree as ET
B=Path(__file__).resolve().parent;D=B.parent;TOKEN=os.environ.get('LARK_SHEET_TOKEN');env={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1','LARKSUITE_CLI_NO_SKILLS_NOTIFIER':'1'}
if not TOKEN: raise RuntimeError('缺少 LARK_SHEET_TOKEN 环境变量')
def cli(*args,payload=None):
 p=subprocess.run(['lark-cli','sheets',*args,'--spreadsheet-token',TOKEN,'--as','user'],input=payload,text=True,capture_output=True,env=env);v=json.loads(p.stdout if p.returncode==0 else p.stderr);assert p.returncode==0 and v.get('ok');return v
v=json.loads((B/'功能表数据.json').read_text());row=next(r for s in v['sheets'] for r in s['data'] if r[0]=='F-139');row[9]='media-browser-results.json10/10：13场景及用户中心三类入口、360/390px布局和底栏正常、无页面异常；原3场景加media-scenes-results.json10/10后，13场景均有真实样例内容证据，合成素材不等于物理设备验收。'
front=next(s for s in v['sheets'] if s['name']=='前台');n=next(i for i,r in enumerate(front['data'],2) if r[0]=='F-139')
writes=[{'sheet_name':'前台','range':f'J{n}:J{n}','cells':[[{'value':row[9]}]]}];result=cli('+cells-set','--writes','-',payload=json.dumps(writes,ensure_ascii=False));(B/'场景覆盖备注更新结果.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
back={}
for s in v['sheets']:
 r=cli('+csv-get','--sheet-name',s['name']);back[s['name']]=r;assert not r['data'].get('has_more');actual=[]
 for line in r['data']['annotated_csv'].splitlines():
  m=re.match(r'\[row=(\d+)\] (.*)',line)
  if m:
   rr=next(csv.reader([m[2]]))
   if rr and re.fullmatch(r'F-\d{3}',rr[0]):assert not any(rr[10:]);actual.append(rr[:10])
 assert actual==s['data'],s['name']
check=cli('+cells-get','--sheet-name','前台','--range',f'J{n}:J{n}','--include','value,style,truncation');c=check['data']['ranges'][0]['cells'][0][0];assert not c.get('isRowTruncated') and not c.get('isColTruncated')
(B/'场景覆盖备注排版回读.json').write_text(json.dumps(check,ensure_ascii=False,indent=2))
for p in [B/'飞书最终功能表回读.json',D/'飞书最终功能表回读.json']:p.write_text(json.dumps(back,ensure_ascii=False,indent=2))
for p in [B/'功能表数据.json',D/'功能表数据.json']:p.write_text(json.dumps(v,ensure_ascii=False,indent=2))
for p in [B/'implementation-status.json',D/'implementation-status.json']:
 j=json.loads(p.read_text());next(x for x in j['features'] if x['id']=='F-139')['evidence']=row[9];p.write_text(json.dumps(j,ensure_ascii=False,indent=2))
with (B/'产品功能表.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(v['sheets'][0]['columns']);w.writerows(r for s in v['sheets'] for r in s['data'])
subprocess.run([sys.executable,str(B/'export_xlsx.py')],check=True)
for name in ['产品功能表.csv','产品功能表.xlsx']:shutil.copy2(B/name,D/name)
p=B/'最终回读验证.json';proof=json.loads(p.read_text());proof.update(verifiedAt=datetime.now(timezone.utc).isoformat(),coverageNoteCorrectionVerified=True,followupCorrectedCells=1,totalSheetCellsWritten=proof['changedSheetCells']+1)
p.write_text(json.dumps(proof,ensure_ascii=False,indent=2));print('Corrected F-139 coverage note; all172 rows reverified and export refreshed.')
