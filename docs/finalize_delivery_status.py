"""Keep the verified feature statuses in local exports and the existing Lark sheet.

Only I:J are changed online. Requirements, priorities, styles and roadmap stay intact.
"""
from pathlib import Path
import csv
import io
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

B = Path(__file__).resolve().parent
TOKEN = os.environ.get('LARK_SHEET_TOKEN')
if not TOKEN:
    raise RuntimeError('缺少 LARK_SHEET_TOKEN 环境变量')
ENV = {**os.environ, 'LARKSUITE_CLI_NO_UPDATE_NOTIFIER': '1', 'LARKSUITE_CLI_NO_SKILLS_NOTIFIER': '1'}

def cli(*args, payload=None):
    p = subprocess.run(['lark-cli', *args, '--as', 'user'], input=payload, text=True, capture_output=True, env=ENV)
    result = json.loads(p.stdout if p.returncode == 0 else p.stderr)
    if p.returncode or not result.get('ok'):
        raise RuntimeError(result)
    return result

def read_sheet(name):
    result = cli('sheets', '+csv-get', '--spreadsheet-token', TOKEN, '--sheet-name', name)
    data = result['data']
    # The normal warning is positioning guidance, not an indication of truncation.
    warning = data.get('warning_message', '')
    assert not data.get('has_more') and not data.get('truncated'), name
    assert data['col_indices'][:10] == list('ABCDEFGHIJ'), (name, warning)
    rows = {}
    for line in data['annotated_csv'].splitlines():
        m = re.match(r'\[row=(\d+)\] (.*)', line)
        if m:
            rows[int(m.group(1))] = next(csv.reader([m.group(2)]))
    return result, rows

def synchronize():
    payload = json.loads((B/'功能表数据.json').read_text())
    mapping = json.loads((B/'implementation-status.json').read_text())
    statuses = {row['id']: row for row in mapping['features']}
    assert len(statuses) == 137
    before, writes = {}, []
    for sheet in payload['sheets']:
        result, rows = read_sheet(sheet['name'])
        before[sheet['name']] = result
        actual = [r for r in rows.values() if r and re.fullmatch(r'F-\d{3}', r[0])]
        assert len(actual) == len(sheet['data']), (sheet['name'], len(actual))
        assert [r[:8] for r in actual] == [r[:8] for r in sheet['data']], sheet['name']
        locations = {r[0]: n for n, r in rows.items() if r and re.fullmatch(r'F-\d{3}', r[0])}
        changed = []
        for row in sheet['data']:
            status = statuses[row[0]]
            new = [status['status'], status['evidence']]
            row[8:10] = new
            n = locations[row[0]]
            if rows[n][8:10] != new:
                changed.append((n, new))
        # Keep the payload compact by grouping consecutive changed rows.
        groups = []
        for n, new in changed:
            if groups and groups[-1][-1][0] + 1 == n:
                groups[-1].append((n, new))
            else:
                groups.append([(n, new)])
        for group in groups:
            writes.append({'sheet_name': sheet['name'], 'range': f'I{group[0][0]}:J{group[-1][0]}',
                           'cells': [[{'value': v} for v in new] for _, new in group]})
    (B/'飞书状态同步前回读.json').write_text(json.dumps(before, ensure_ascii=False, indent=2))
    (B/'飞书状态列更新.json').write_text(json.dumps(writes, ensure_ascii=False, indent=2))
    log=[]
    for start in range(0, len(writes), 50):
        result = cli('sheets', '+cells-set', '--spreadsheet-token', TOKEN, '--writes', '-',
                     payload=json.dumps(writes[start:start+50], ensure_ascii=False))
        log.append(result)
    (B/'飞书状态列更新结果.json').write_text(json.dumps(log, ensure_ascii=False, indent=2))
    after={}
    checked=0
    for sheet in payload['sheets']:
        result, rows = read_sheet(sheet['name'])
        after[sheet['name']] = result
        actual = [r for r in rows.values() if r and re.fullmatch(r'F-\d{3}', r[0])]
        assert [r[:10] for r in actual] == sheet['data'], sheet['name']
        checked += len(actual)
    assert checked == 137
    (B/'飞书最终功能表回读.json').write_text(json.dumps(after, ensure_ascii=False, indent=2))
    (B/'功能表数据.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    with (B/'产品功能表.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer=csv.writer(f)
        writer.writerow(payload['sheets'][0]['columns'])
        for sheet in payload['sheets']:
            writer.writerows(sheet['data'])
    subprocess.run([sys.executable, str(B/'export_xlsx.py')], check=True)
    record = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'features': checked,
              'changedRanges': len(writes), 'changedCells': sum(len(w['cells'])*2 for w in writes),
              'columns': 'I:J', 'fullReadbackMatches': True,
              'requirementsAndRoadmapUnchanged': True}
    (B/'飞书最终状态验证.json').write_text(json.dumps(record, ensure_ascii=False, indent=2))
    print(json.dumps(record, ensure_ascii=False))

if __name__ == '__main__':
    synchronize()
