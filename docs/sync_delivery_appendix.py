"""Update only the delivery appendix of the existing product requirements document."""
from pathlib import Path
import html
import json
import os
import subprocess
import xml.etree.ElementTree as ET

B=Path(__file__).resolve().parent
TOKEN=os.environ.get('LARK_DOC_TOKEN')
if not TOKEN:
    raise RuntimeError('缺少 LARK_DOC_TOKEN 环境变量')
TITLE='2026-10-14 交付验证记录'
ENV={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1','LARKSUITE_CLI_NO_SKILLS_NOTIFIER':'1'}

def cli(*args, payload=None):
    p=subprocess.run(['lark-cli','docs',*args,'--as','user','--doc',TOKEN],input=payload,text=True,capture_output=True,env=ENV)
    data=json.loads(p.stdout if p.returncode==0 else p.stderr)
    assert p.returncode==0 and data.get('ok'),data
    return data

paragraphs=json.loads((B/'交付验收段落.json').read_text())
before=cli('+fetch','--detail','full')
(B/'飞书验收同步前全文.json').write_text(json.dumps(before,ensure_ascii=False,indent=2))
root=ET.fromstring('<root>'+before['data']['document']['content']+'</root>')
heads=[x for x in root if x.tag=='h1' and ''.join(x.itertext())==TITLE]
payload='<h1 seq="auto">'+TITLE+'</h1>'+''.join('<p>'+html.escape(p)+'</p>' for p in paragraphs)
if heads:
    head=heads[0]
    assert list(root).index(head) > 0
    final=list(root)[-1]
    result=cli('+update','--command','block_replace','--start-block-id',head.attrib['id'],'--end-block-id',final.attrib['id'],'--content','-',payload=payload)
else:
    result=cli('+update','--command','append','--content','-',payload=payload)
assert result.get('data',{}).get('result')=='success',result
(B/'飞书验收段落更新结果.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
after=cli('+fetch','--detail','full')
(B/'飞书最终文档回读.json').write_text(json.dumps(after,ensure_ascii=False,indent=2))
root=ET.fromstring('<root>'+after['data']['document']['content']+'</root>')
head=[x for x in root if x.tag=='h1' and ''.join(x.itertext())==TITLE][0]
index=list(root).index(head)
actual=[''.join(x.itertext()) for x in list(root)[index+1:]]
assert actual==paragraphs,(actual,paragraphs)
assert len([x for x in root if x.tag=='h1'])==19
md=B/'产品需求文档.md'
text=md.read_text().split('\n## '+TITLE)[0].rstrip()
md.write_text(text+'\n\n## '+TITLE+'\n\n'+'\n\n'.join(paragraphs)+'\n')
draft=B/'draft_81969f84_folder/draft.xml'
x=draft.read_text().split('<h1 seq="auto">'+TITLE)[0].rstrip()
draft.write_text(x+'\n'+payload+'\n')
status=json.loads((B/'飞书交付状态.json').read_text())
status['document'].update(sections=19,paragraphs=len([x for x in root if x.tag=='p']))
status['implementation_note']='状态与证据已同步功能表；支付真实商户资料未配置、Android真机尚未验收。'
status['delivery_appendix']={'title':TITLE,'paragraphs':len(paragraphs),'verified':True,'revision':after['data']['document'].get('revision_id')}
(B/'飞书交付状态.json').write_text(json.dumps(status,ensure_ascii=False,indent=2))
print(json.dumps(status['delivery_appendix'],ensure_ascii=False))
