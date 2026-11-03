"""Dependency-free XLSX export from the product feature payload."""
from pathlib import Path
import json,zipfile,html,math
BASE=Path(__file__).parent
sheets=json.loads((BASE/'功能表数据.json').read_text())['sheets']
esc=lambda x:html.escape(str(x),quote=True)
ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
rels='http://schemas.openxmlformats.org/package/2006/relationships'
with zipfile.ZipFile(BASE/'产品功能表.xlsx','w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,len(sheets)+1))+'</Types>')
 z.writestr('_rels/.rels',f'<Relationships xmlns="{rels}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
 z.writestr('xl/workbook.xml',f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+''.join(f'<sheet name="{esc(s["name"])}" sheetId="{i}" r:id="rId{i}"/>' for i,s in enumerate(sheets,1))+'</sheets></workbook>')
 z.writestr('xl/_rels/workbook.xml.rels',f'<Relationships xmlns="{rels}">'+''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,len(sheets)+1))+f'<Relationship Id="rId{len(sheets)+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
 z.writestr('xl/styles.xml',f'''<styleSheet xmlns="{ns}"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243B35"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>''')
 for idx,s in enumerate(sheets,1):
  rows=[s['columns']]+s['data'];n=len(rows)
  content=[f'<worksheet xmlns="{ns}"><dimension ref="A1:J{n}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>']
  widths=[14,17,18,24,12,56,56,30,34,48]
  for i,w in enumerate(widths,1):content.append(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>')
  content.append('</cols><sheetData>')
  for ri,row in enumerate(rows,1):
   lines=max(math.ceil(sum(2 if ord(c)>255 else 1 for c in str(v))/(widths[ci]-2)) for ci,v in enumerate(row))
   height=32 if ri==1 else max(48,lines*16+12)
   content.append(f'<row r="{ri}" ht="{height}" customHeight="1">')
   for ci,value in enumerate(row):content.append(f'<c r="{chr(65+ci)}{ri}" t="inlineStr" s="{1 if ri==1 else 0}"><is><t xml:space="preserve">{esc(value)}</t></is></c>')
   content.append('</row>')
  content.append(f'</sheetData><autoFilter ref="A1:J{n}"/></worksheet>')
  z.writestr(f'xl/worksheets/sheet{idx}.xml',''.join(content))
print('xlsx_exported',len(sheets),'sheets',sum(len(s['data']) for s in sheets),'rows')
