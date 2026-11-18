"""Export the actual star schema and author a supported PBIP/PBIR project."""
from pathlib import Path
import csv,hashlib,json,os,uuid
from decimal import Decimal
from datetime import date,datetime
import psycopg
from pipeline import env,ROOT,write_json
env();out=ROOT/'powerbi';data=out/'data';data.mkdir(parents=True,exist_ok=True)
tables={'Orders':'fact_order','OrderItems':'fact_order_item','Payments':'fact_payment','Dates':'dim_date','Customers':'dim_customer','Products':'dim_product','Sellers':'dim_seller','Geography':'dim_geography','PaymentTypes':'dim_payment_type','OrderStatuses':'dim_order_status'}
metadata={};models=[]
with psycopg.connect(os.environ['OWNER_DATABASE_URL']) as c:
    for name,table in tables.items():
        cols=c.execute("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='analytics' AND table_name=%s ORDER BY ordinal_position",(table,)).fetchall();metadata[name]=cols
        rows=c.execute(f'SELECT * FROM analytics.{table}').fetchall()
        with (data/(table+'.csv')).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.writer(f);writer.writerow([x[0] for x in cols]);writer.writerows([['true' if v is True else 'false' if v is False else v.isoformat() if isinstance(v,(date,datetime)) else v for v in row] for row in rows])
        cs=[];types=[];nontext=[]
        for column,datatype in cols:
            typ='string';mtype='type text';fmt=None
            if datatype in ('integer','bigint','smallint'):typ='int64';mtype='Int64.Type'
            elif datatype=='numeric':typ='decimal';mtype='Currency.Type';fmt='0.00'
            elif datatype in ('date','timestamp without time zone','timestamp with time zone'):typ='dateTime';mtype='type date' if datatype=='date' else 'type datetime';fmt='yyyy-mm-dd'
            elif datatype=='boolean':typ='boolean';mtype='type logical'
            col={'name':column,'dataType':typ,'sourceColumn':column,'summarizeBy':'none'}
            if fmt:col['formatString']=fmt
            cs.append(col);types.append('{"'+column+'", '+mtype+'}')
            if typ!='string':nontext.append(column)
        blank=', '.join('"'+k+'"' for k in nontext)
        expr=['let',f'    Source = Csv.Document(File.Contents(SourceFolder & "\\{table}.csv"), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),','    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),',f'    Missing = Table.ReplaceValue(Headers, "", null, Replacer.ReplaceValue, {{{blank}}}),',f'    Typed = Table.TransformColumnTypes(Missing, {{{", ".join(types)}}}, "en-US")','in','    Typed']
        models.append({'name':name,'columns':cs,'partitions':[{'name':name,'mode':'import','source':{'type':'m','expression':expr}}]})
measures=[
 ('Order Count','COUNTROWS(Orders)','#,0'),('Delivered Orders','CALCULATE(COUNTROWS(Orders), Orders[status] = "delivered")','#,0'),
 ('Delivered Merchandise Value','CALCULATE(SUM(Orders[merchandise_value]), Orders[status] = "delivered")','"R$" #,0.00'),
 ('Delivered Freight Value','CALCULATE(SUM(Orders[freight_value]), Orders[status] = "delivered")','"R$" #,0.00'),
 ('Average Order Value','DIVIDE([Delivered Merchandise Value], [Delivered Orders])','"R$" #,0.00'),
 ('Eligible Deliveries','COUNTROWS(FILTER(Orders, NOT ISBLANK(Orders[late])))','#,0'),
 ('Late Orders','COUNTROWS(FILTER(Orders, Orders[late] == TRUE()))','#,0'),
 ('On Time Rate','DIVIDE([Eligible Deliveries] - [Late Orders], [Eligible Deliveries])','0.0%'),
 ('Average Delivery Days','AVERAGE(Orders[delivery_days])','0.0'),('Latest Review Score','AVERAGE(Orders[review_score])','0.00'),
 ('Reviewed Orders','COUNT(Orders[review_score])','#,0'),('Category Merchandise Value','CALCULATE(SUM(OrderItems[price]), OrderItems[status] = "delivered")','"R$" #,0.00'),
 ('Dataset Period','"Historical Olist commerce records | 2016–2018 | BRL"',''),
 ('Metric Definition','"Merchandise value excludes freight. Delivered orders only. Not platform revenue or profit."',''),
 ('Delivery Definition','"Late = delivered calendar date after estimated calendar date. Missing dates are excluded."',''),
 ('Review Definition','"Latest answered review per order; creation timestamp and source row break ties. Descriptive, not causal."',''),
 ('Source Attribution','"Data: Olist on Kaggle | CC BY-NC-SA 4.0 | Independent project by Bronson Hatch"','')]
models[0]['measures']=[{'name':n,'expression':e,**({'formatString':f} if f else {})} for n,e,f in measures]
rels=[]
for fact in ['Orders','OrderItems','Payments']:
    for dim,fk,pk in [('Dates','purchase_date','date_key'),('Customers','customer_key','customer_key'),('Geography','geography_key','geography_key')]:rels.append({'name':str(uuid.uuid5(uuid.NAMESPACE_URL,f'{fact}:{fk}')),'fromTable':fact,'fromColumn':fk,'toTable':dim,'toColumn':pk,'crossFilteringBehavior':'oneDirection'})
for fact,dim,key in [('OrderItems','Products','product_id'),('OrderItems','Sellers','seller_id'),('Payments','PaymentTypes','payment_type'),('Orders','OrderStatuses','status')]:rels.append({'name':str(uuid.uuid5(uuid.NAMESPACE_URL,f'{fact}:{key}')),'fromTable':fact,'fromColumn':key,'toTable':dim,'toColumn':key,'crossFilteringBehavior':'oneDirection'})
for fk in ['delivery_date','estimated_date']:rels.append({'name':str(uuid.uuid5(uuid.NAMESPACE_URL,f'Orders:{fk}')),'fromTable':'Orders','fromColumn':fk,'toTable':'Dates','toColumn':'date_key','isActive':False,'crossFilteringBehavior':'oneDirection'})
model={'name':'Commerce Operations Explorer','compatibilityLevel':1600,'model':{'culture':'en-US','defaultPowerBIDataSourceVersion':'powerBI_V3','sourceQueryCulture':'en-US','expressions':[{'name':'SourceFolder','kind':'m','expression':'"C:\\Users\\Bronson\\Documents\\CommerceExplorer\\data" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]'}],'tables':models,'relationships':rels}}
semantic=out/'Commerce.SemanticModel';semantic.mkdir(exist_ok=True)
write_json(semantic/'definition.pbism',{'$schema':'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json','version':'4.2','settings':{'qnaEnabled':False}});write_json(semantic/'model.bim',model)
report=out/'Commerce.Report';definition=report/'definition';definition.mkdir(parents=True,exist_ok=True)
write_json(out/'Commerce Operations Explorer.pbip',{'$schema':'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json','version':'1.0','artifacts':[{'report':{'path':'Commerce.Report'}}],'settings':{'enableAutoRecovery':True}})
write_json(report/'definition.pbir',{'$schema':'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json','version':'4.0','datasetReference':{'byPath':{'path':'../Commerce.SemanticModel'}}})
base='https://developer.microsoft.com/json-schemas/fabric/item/report/definition/'
write_json(definition/'version.json',{'$schema':base+'versionMetadata/1.0.0/schema.json','version':'2.0.0'})
write_json(definition/'report.json',{'$schema':base+'report/3.3.0/schema.json','themeCollection':{'baseTheme':{'name':'CY24SU10','reportVersionAtImport':{'visual':'1.8.0','report':'2.0.0','page':'1.3.0'},'type':'SharedResources'}},'objects':{},'settings':{'useStylableVisualContainerHeader':True,'exportDataMode':'AllowSummarized','defaultDrillFilterOtherVisuals':True}})
pages=[('sales','Sales overview'),('delivery','Delivery & reviews'),('definitions','Definitions & coverage')]
write_json(definition/'pages/pages.json',{'$schema':base+'pagesMetadata/1.0.0/schema.json','pageOrder':[x[0] for x in pages],'activePageName':'sales'})
def field(table,prop,measure=False):
    return {'field':{'Measure' if measure else 'Column':{'Expression':{'SourceRef':{'Entity':table}},'Property':prop}},'queryRef':table+'.'+prop,'nativeQueryRef':prop}
def literal(value):return {'expr':{'Literal':{'Value':"'"+value.replace("'","''")+"'"}}}
def visual(page,name,kind,x,y,w,h,states,title):
    v={'$schema':base+'visualContainer/2.9.0/schema.json','name':name,'position':{'x':x,'y':y,'z':len(list((definition/'pages'/page/'visuals').glob('*'))) if (definition/'pages'/page/'visuals').exists() else 0,'width':w,'height':h,'tabOrder':int(y+x)},'visual':{'visualType':kind,'query':{'queryState':{key:{'projections':values} for key,values in states.items()}},'visualContainerObjects':{'title':[{'properties':{'show':{'expr':{'Literal':{'Value':'true'}}},'text':literal(title)}}]}}}
    write_json(definition/'pages'/page/'visuals'/name/'visual.json',v)
for page,title in pages:
    write_json(definition/'pages'/page/'page.json',{'$schema':base+'page/2.1.0/schema.json','name':page,'displayName':title,'displayOption':'FitToPage','height':720,'width':1280})
    visual(page,'context','card',30,14,1220,70,{'Values':[field('Orders','Dataset Period',True)]},title+' | Commerce Operations Explorer')
for i,measure in enumerate(['Delivered Merchandise Value','Order Count','Average Order Value','On Time Rate']):visual('sales','metric'+str(i),'card',30+i*310,105,290,115,{'Values':[field('Orders',measure,True)]},measure)
visual('sales','trend','lineChart',30,245,755,425,{'Category':[field('Dates','year_month')],'Y':[field('Orders','Delivered Merchandise Value',True)]},'Delivered merchandise by purchase month')
visual('sales','categories','clusteredBarChart',815,245,435,425,{'Category':[field('Products','category_name')],'Y':[field('Orders','Category Merchandise Value',True)]},'Delivered merchandise by category')
for i,measure in enumerate(['Eligible Deliveries','Late Orders','Average Delivery Days','Latest Review Score']):visual('delivery','metric'+str(i),'card',30+i*310,105,290,115,{'Values':[field('Orders',measure,True)]},measure)
visual('delivery','regions','tableEx',30,250,1220,420,{'Values':[field('Geography','state')]+[field('Orders',m,True) for m in ['Delivered Orders','Eligible Deliveries','On Time Rate','Average Delivery Days','Latest Review Score','Reviewed Orders']]},'Regional delivery and review coverage')
for i,measure in enumerate(['Metric Definition','Delivery Definition','Review Definition','Source Attribution']):visual('definitions','definition'+str(i),'card',30,110+i*140,1220,120,{'Values':[field('Orders',measure,True)]},['Merchandise and order value','Delivery eligibility','Customer reviews','Source and authorship'][i])
manifest={'data_version':json.loads((ROOT/'evidence/source-controls.json').read_text())['data_version'],'tables':{n:{'file':t+'.csv','sha256':hashlib.sha256((data/(t+'.csv')).read_bytes()).hexdigest()} for n,t in tables.items()},'status':'authored; Desktop verification pending','powerbi_source_folder':'C:\\Users\\Bronson\\Documents\\CommerceExplorer\\data'}
write_json(out/'export-manifest.json',manifest);print(json.dumps({'tables':len(tables),'measures':len(measures),'relationships':len(rels),'pages':3,'bytes':sum(p.stat().st_size for p in data.glob('*.csv'))}))

# Format editable report source; Desktop creates the distribution PBIX.
import polish_powerbi
