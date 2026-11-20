"""Compare actual PostgreSQL execution with the retained Decimal implementation."""
from decimal import Decimal
import json
from pathlib import Path
import re
import subprocess
import sys

root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'backend'))
from src.domain.deterministic_calculations import CalculationOperation, Quantity, calculate

cases=[]
for operation in CalculationOperation:
    for a,b in [('0.1','0.2'),('1','3'),('-1','8'),('3','8'),('1e128','1e-128'),
                ('-100','-125'),('9007199254740993.1','0.2')]:
        for places in [0,2,6,18]:
            command={'operation':operation.value,'left':{'value':a,'unit':'USD','evidence_ids':['a']},
                     'right':{'value':b,'unit':'USD','evidence_ids':['b']},'precision':places}
            expected=calculate(operation,Quantity(Decimal(a),'USD',('a',)),Quantity(Decimal(b),'USD',('b',)),precision=places)
            cases.append((command,expected))
payload=json.dumps([command for command,_ in cases]).replace("'","''")
query="select jsonb_agg(public.nexus_calculate_binary(value) order by position) from jsonb_array_elements('"+payload+"'::jsonb) with ordinality as inputs(value,position)"
actual=json.loads(subprocess.check_output(['psql','-X','-v','ON_ERROR_STOP=1','-At','-c',query]))
assert len(actual)==len(cases)
for result,(_,expected) in zip(actual,cases):
    assert Decimal(result['value'])==expected.value,(result,expected)
    assert result['unit']==expected.unit and tuple(result['evidence_ids'])==expected.evidence_ids
    # SQL retains entered spelling; Decimal canonicalizes scientific notation.
    normalized=re.sub(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',lambda m:str(Decimal(m[0])),result['formula'])
    assert normalized==expected.formula,(result,expected)
print(f'RESEARCH_CALCULATION_PYTHON_ENGINE_PARITY_PASS cases={len(cases)}; seven operations, exact retained Decimal engine')
