"""Apply supported PBIR formatting to editable source. Save PBIX using Desktop."""
from pathlib import Path
import json
from pipeline import ROOT,write_json
def expr(v):return {'expr':{'Literal':{'Value':str(v)+'D' if isinstance(v,(int,float)) else "'"+v+"'"}}}
def color(v):return {'solid':{'color':expr(v)}}
def polish(v):
    visual=v['visual'];name=v['name'];kind=visual['visualType'];objects=visual.setdefault('objects',{})
    if kind=='textbox':return v
    if name=='context' or name.startswith('definition'):
        title=visual['visualContainerObjects']['title'][0]['properties']['text']['expr']['Literal']['Value'][1:-1]
        prop=visual['query']['queryState']['Values']['projections'][0]['field']['Measure']['Property']
        model=json.loads((ROOT/'powerbi/Commerce.SemanticModel/model.bim').read_text())
        measures={m['name']:m['expression'].strip('"') for t in model['model']['tables'] for m in t.get('measures',[])}
        text='Historical Olist commerce records · 2016–2018 · Brazilian reais (BRL)' if name=='context' else measures[prop]
        def paragraph(text,size,bold=False):return {'textRuns':[{'value':text,'textStyle':{'fontFamily':'Segoe UI','fontSize':size,'fontWeight':'bold' if bold else 'normal','color':'#244D3A'}}]}
        v['visual']={'visualType':'textbox','objects':{'general':[{'properties':{'paragraphs':[paragraph(title,'14pt',True),paragraph(text,'12pt')]}}]}}
        return v
    title=visual['visualContainerObjects']['title'][0]['properties'];title['fontSize']=expr(11);title['fontColor']=color('#325441');title['fontFamily']=expr('Segoe UI')
    visual['visualContainerObjects']['background']=[{'properties':{'color':color('#FFFFFF'),'transparency':expr(0)}}]
    if kind=='card':
        size=16 if name=='context' else 12 if name.startswith('definition') else 28
        props={'fontSize':expr(size),'color':color('#244D3A'),'fontFamily':expr('Segoe UI')}
        if name not in ['context'] and not name.startswith('definition'):
            props['displayUnits']=expr(0);props['labelPrecision']={'expr':{'Literal':{'Value':'2L'}}}
            prop=visual['query']['queryState']['Values']['projections'][0]['field']['Measure']['Property']
            if prop in ['Order Count','Delivered Orders','Late Orders','Eligible Deliveries','Reviewed Orders']:props['labelPrecision']={'expr':{'Literal':{'Value':'0L'}}}
        objects['labels']=[{'properties':props}];objects['categoryLabels']=[{'properties':{'show':{'expr':{'Literal':{'Value':'false'}}}}}]
    elif kind in ['lineChart','clusteredBarChart']:
        objects['dataPoint']=[{'properties':{'defaultColor':color('#347A61')}}]
        for axis in ['categoryAxis','valueAxis']:objects[axis]=[{'properties':{'fontSize':expr(9),'showAxisTitle':{'expr':{'Literal':{'Value':'false'}}}}}]
        if kind=='clusteredBarChart':
            measure=visual['query']['queryState']['Y']['projections'][0]['field']
            visual['query']['sortDefinition']={'sort':[{'field':measure,'direction':'Descending'}],'isDefaultSort':True}
    return v
for path in (ROOT/'powerbi/Commerce.Report/definition').rglob('visual.json'):write_json(path,polish(json.loads(path.read_text())))
