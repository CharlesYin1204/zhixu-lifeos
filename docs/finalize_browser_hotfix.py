from pathlib import Path
import json
B=Path(__file__).resolve().parent
reports={}
for version in ('145','156'):
 file=B/'tests'/f'navigation-diagnostic-chromium{version}.json'
 v=json.loads(file.read_text())
 assert v.get('passed') and len(v['steps'])==52 and not v['pageerrors'] and not v['console'] and not v['failed'],file
 reports[version]=v
assert len(json.loads((B/'tests/deployment-results.json').read_text())['checks'])==19
r=json.loads((B/'tests/deployment-results.json').read_text());assert all(x['passed'] for x in r['checks'])
p=B/'页面故障验收待同步.json';issue=json.loads(p.read_text());issue.update(status='deployed_and_regression_verified',mustWaitFor=[],verified145At=reports['145'].get('completedAt'),verified156At=reports['156'].get('completedAt'));issue['verifiedReports']['Chromium145Navigation']='tests/navigation-diagnostic-chromium145.json:52 steps; passed; no pageerrors/console/request failures';issue['verifiedReports']['deployment']='tests/deployment-results.json:19 passed read-only checks';p.write_text(json.dumps(issue,ensure_ascii=False,indent=2))
p=B/'交付验收段落.json';a=json.loads(p.read_text());a[0]='本节为2026-10-14最终交付证据快照。用户报告的页面加载故障已在Chromium156精确复现、修复并部署至独立release .releases/20261014T124600Z-11885；修复后Chromium145与156各52步导航回归通过。功能表区分已实测、已实现但未单独专项实测、外部依赖及六项原有P2规划，不以主要页面渲染代表全部细项端到端验证。';a[4]='最终报告：API16/16、基础浏览器9/9、业务UI15/15、手机后台3/3、记录合同11/11、后端回归15/15、AI客户端9/9、APK11/11、重启恢复4/4、最新部署只读19/19通过。修复后Chromium156再次通过基础9项与业务UI15项，145/156各52步导航无运行时错误。原故障来自156滚动方法返回Promise被effect隐式返回；已改为不返回DOM方法结果。新旧各8个哈希资源均可读取，自动回滚路径未专项实测。证据在docs/tests，截图在docs/screenshots。';p.write_text(json.dumps(a,ensure_ascii=False,indent=2))
p=B/'部署交付与验收报告.md';s=p.read_text();s=s.replace('生产构建、部署及已列专项验证已完成；用户随后报告部分页面出现“This page couldn’t load”，正在排查，尚不作最终上线交付结论。','生产构建与部署完成。用户随后报告的“This page couldn’t load”已精确复现、修复上线，并通过Chromium145与156各52步导航回归。');s=s.replace('| deployment-results.json | 14/14 | 非root服务、沙箱、Nginx、定向密钥泄漏扫描；不是全站渗透测试 |','| deployment-results.json | 19/19 | 最新release、非root服务、沙箱、Nginx、新旧哈希资源与定向密钥扫描；不是全站渗透测试 |\n| navigation-diagnostic-chromium145.json | 52步通过 | 修复后旧版浏览器导航、助手历史与页面切换，无运行时/控制台/请求失败 |\n| navigation-diagnostic-chromium156.json | 52步通过 | 修复后新版浏览器完整导航，已无法复现原错误 |');s=s.replace('生产最终构建通过，未修改构建后业务代码。','修复后的Chromium156已重新执行基础9项与业务UI15项并通过，相关页面截图已更新。');s=s.replace('## APK\n','''## 页面故障修复

用户反馈AI助手及多页面出现“This page couldn’t load”。修复前已在Chromium156复现`TypeError: i is not a function`：该浏览器的scrollIntoView返回Promise，AIChat原effect隐式返回此值，React在清理时尝试调用它而报错；实测Chromium145返回undefined，所以早期回归未触发。修复将effect改为块体，不返回滚动方法结果。

修复已部署到.releases/20261014T124600Z-11885，buildId vKNS4V9WblnWpuEq7mbsv。Chromium145与156各52步导航、助手历史及页面切换回归通过，均无pageerror、控制台错误或请求失败；156另通过业务UI15项与基础页面9项。静态核对12个effect均为非async块体。修复前失败报告保留，用于说明重现和前后差异。

部署在独立release构建，候选健康通过后切换；旧.next与已发布哈希资源保留，新旧各8个资源均200且对应文件。候选进程已退出、3062无监听，web与worker生产服务正常；本轮worker未重启。自动回滚路径未专项实测。详情见页面加载故障修复记录.md。

## APK
''');p.write_text(s)
p=B/'页面加载故障修复记录.md';s=p.read_text().replace('Chromium 145/156完整回归仍在进行，尚不作最终验收通过结论。','Chromium 145与156各52步完整导航回归通过，修复验收完成。').replace('## 待完成验收','## 完成验收').replace('| Chromium156故障复验 | AI直达、历史会话恢复、新会话、AI与其他页面反复切换及前进后退均无上述错误 | 等待回归报告 |','| Chromium156故障复验 | AI直达、历史会话恢复、新会话、AI与其他页面反复切换及前进后退均无上述错误 | 52步通过；pageerrors/console/failed均空 |').replace('| Chromium145兼容回归 | 原支持浏览器的对应导航及助手流程仍通过 | 等待回归报告 |','| Chromium145兼容回归 | 原支持浏览器的对应导航及助手流程仍通过 | 52步通过；pageerrors/console/failed均空 |').replace('| 公开地址可用性 | 生产IP页面/API及新旧哈希资源按部署契约可用 | 等待部署报告 |','| 公开地址可用性 | 生产IP页面/API及新旧哈希资源按部署契约可用 | deployment-results.json 19/19；新旧各8资源200 |').replace('| 文档最终同步 | 根据实际报告更新PRD交付段落、功能表相关证据和交付报告，再全量回读 | 等待上线回归结论 |','| 文档最终同步 | 根据实际报告更新PRD交付段落、功能表相关证据和交付报告，再全量回读 | 结果见飞书最终状态验证.json与本地与在线交付一致性.json |');s=s.replace('故障修复通过后，仅更新相关功能的证据','此次仅更新相关功能的证据');s+='\n修复后报告：tests/navigation-diagnostic-chromium145.json、tests/navigation-diagnostic-chromium156.json；156另重跑ui-flow-results.json 15项和browser-results.json 9项。最新部署检查19项通过，自动回滚路径未专项实测。\n';p.write_text(s)
p=B/'文档交付验证.md';s=p.read_text().replace('随后用户报告部分页面出现“This page couldn’t load”，应用负责人正在排查。文档保留已执行测试的时间点证据，尚不作最终上线交付结论。','用户报告的页面加载故障已在Chromium156复现并修复上线；145/156各52步导航回归通过，156另重跑业务UI15项和基础9项通过。修复前失败报告保留。').replace('含页面加载反馈和外部验收边界','含页面加载故障修复、双版本浏览器回归和外部验收边界').replace('部署只读14均通过','最新部署只读19均通过');p.write_text(s)
p=B/'implementation-status.json';m=json.loads(p.read_text());m['phase']='最终生产交付；Chromium145/156导航回归已验证页面加载故障修复';
for f in m['features']:
 if f['id'] in ('F-002','F-061','F-062'):
  f['evidence']+=' 页面加载兼容修复已上线，navigation-diagnostic-chromium145.json和navigation-diagnostic-chromium156.json各52步导航通过、零运行时错误；156基础9项与业务UI15项重新通过。'
 if f['id']=='F-128':f['evidence']+=' 最新release部署19项通过，新旧各8哈希资源200；未执行独立跨网络受控浏览器。'
 if f['id']=='F-119':f['evidence']=f['evidence'].replace('deployment-results.json最终产物/public扫描','deployment-results.json 19项中对53个公开/归档文件扫描')
p.write_text(json.dumps(m,ensure_ascii=False,indent=2))
print('Prepared final repair evidence, local report and feature status updates; ready to synchronize.')
