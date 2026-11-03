from pathlib import Path
import json,subprocess,xml.etree.ElementTree as ET,html,os
B=Path(__file__).parent
changes=json.loads((B/'范围修订段落.json').read_text())
x=json.loads((B/'飞书文档修订前.json').read_text())['data']['document']['content']
root=ET.fromstring('<root>'+x+'</root>')
by_text={''.join(e.itertext()):e.attrib.get('id') for e in root if e.tag=='p'}
assert all(c['old'] in by_text for c in changes)
log=[]
for i,c in enumerate(changes):
 block=by_text[c['old']]
 payload='<p>'+html.escape(c['new'])+'</p>'
 p=subprocess.run(['lark-cli','docs','+update','--as','user','--doc','[REDACTED_LARK_RESOURCE_TOKEN]','--command','block_replace','--block-id',block,'--content','-','--doc-format','xml'],input=payload,text=True,capture_output=True,env={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1'})
 try:r=json.loads(p.stdout if p.returncode==0 else p.stderr)
 except Exception:r={'ok':False,'error':p.stderr or p.stdout}
 log.append({'index':i,'oldBlock':block,'result':r})
 (B/'飞书范围修订日志.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
 if not r.get('ok') or r.get('data',{}).get('result') not in ['success',None]:
  print('FAILED',i,json.dumps(r,ensure_ascii=False),flush=True);raise SystemExit(1)
 print('updated',i+1,'of',len(changes),flush=True)
print('all_paragraph_updates_complete')
