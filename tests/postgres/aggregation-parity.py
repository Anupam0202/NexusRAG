"""Compare real SQL aggregates with the retained Decimal engine, never model math."""
from decimal import Decimal
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from src.domain.deterministic_calculations import AggregationOperation, Quantity, aggregate

cases=[]
for operation in AggregationOperation:
    for values in [('0.1','0.2'),('1','3','8'),('-1','-1','2','8'),
                   ('9007199254740993.1','0.2'),('1e128','1e-128'),('1.005','1.015'),('0','-0','0')]:
        for places in [0,2,6,18]:
            for variation in ['plain','missing','grouped']:
                quantities=[{'value':value,'unit':'USD','evidence_ids':[f'input-{index}','shared']}
                            for index,value in enumerate(values)]
                weights=[str(index+1) for index in range(len(quantities))] if operation is AggregationOperation.WEIGHTED_AVERAGE else []
                if variation=='missing':
                    quantities.insert(1,{'value':None,'unit':'USD','evidence_ids':['excluded']})
                    if weights:weights.insert(1,'0')
                if variation=='grouped':
                    for index,q in enumerate(quantities):q['group']='A' if index%2==0 else 'B'
                cases.append({'operation':operation.value,'values':quantities,'weights':weights,'precision':places,
                              'grouped':variation=='grouped','missing_value_treatment':'EXCLUDE' if variation=='missing' else 'REJECT'})
payload=json.dumps(cases).replace("'","''")
query="select jsonb_agg(public.nexus_calculate_aggregation(value) order by position) from jsonb_array_elements('"+payload+"'::jsonb) with ordinality as inputs(value,position);"
results=json.loads(subprocess.check_output(['psql','-X','-v','ON_ERROR_STOP=1','-At'],input=query.encode()))
assert len(results)==len(cases)
for command,result in zip(cases,results):
    names=sorted({q.get('group','') for q in command['values']})
    assert len(result['groups'])==len(names)
    for name,group in zip(names,result['groups']):
        all_inputs=[(i,q) for i,q in enumerate(command['values']) if q.get('group','')==name]
        included=[(i,q) for i,q in all_inputs if q['value'] is not None]
        weights=tuple(Decimal(command['weights'][i]) for i,_ in included) if command['weights'] else ()
        expected=aggregate(AggregationOperation(command['operation']),tuple(Quantity(Decimal(q['value']),q['unit'],tuple(q['evidence_ids'])) for _,q in included),
                           weights=weights,precision=command['precision'],missing_value_treatment=command['missing_value_treatment'])
        assert group['group']==(name or None)
        assert group['total_count']==len(all_inputs) and group['included_count']==len(included)
        assert group['excluded_input_indices']==[i for i,q in all_inputs if q['value'] is None]
        assert tuple(group['evidence_ids'])==expected.evidence_ids and group['unit']==expected.unit
        if isinstance(expected.output,Decimal):assert Decimal(group['value'])==expected.output,(command,group,expected)
        elif command['operation']=='RANK':
            assert [(row['input_index'],Decimal(row['value'])) for row in group['rows']]==[(included[int(i)][0],Decimal(v)) for i,v in expected.output]
            assert [row['position'] for row in group['rows']]==list(range(1,len(included)+1))
        else:assert [(row['key'],Decimal(row['value'])) for row in group['rows']]==[(k,Decimal(v)) for k,v in expected.output]
print(f'RESEARCH_AGGREGATION_PYTHON_ENGINE_PARITY_PASS cases={len(cases)}; nine operations, grouped/missing variants, exact Decimal engine')
