"""Exact SQL conversion parity against the retained Python Decimal implementation."""
from decimal import Decimal
import json
from pathlib import Path
import re
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from src.domain.deterministic_calculations import Quantity, convert_unit
cases=[]
for value in ['0.1','1.005','1.015','-1.005','9007199254740993.1','1e128','1e-128']:
    for factor in ['1','1000','0.001','1e128','1e-128']:
        for places in [0,2,6,18]:
            command={'quantity':{'value':value,'unit':'supplied-unit','evidence_ids':['source-a']},'factor':factor,
                     'target_unit':'target-unit','conversion_evidence_id':'factor-a','factor_effective_on':None,'precision':places}
            expected=convert_unit(Quantity(Decimal(value),'supplied-unit',('source-a',)),target_unit='target-unit',factor=Decimal(factor),conversion_evidence_id='factor-a',precision=places)
            cases.append((command,expected))
query="select jsonb_agg(public.nexus_calculate_conversion(value) order by position) from jsonb_array_elements('"+json.dumps([c for c,_ in cases]).replace("'","''")+"'::jsonb) with ordinality as inputs(value,position);"
results=json.loads(subprocess.check_output(['psql','-X','-v','ON_ERROR_STOP=1','-At'],input=query.encode()))
assert len(results)==len(cases)
for actual,(_,expected) in zip(results,cases):
    assert Decimal(actual['value'])==expected.value,(actual,expected)
    assert actual['unit']==expected.unit and tuple(actual['evidence_ids'])==expected.evidence_ids
    normalize=lambda v:re.sub(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',lambda m:str(Decimal(m[0])),v)
    assert normalize(actual['formula'])==normalize(expected.formula)
print(f'RESEARCH_CONVERSION_PYTHON_ENGINE_PARITY_PASS cases={len(cases)}; supplied factors, target units, retained Decimal engine')
