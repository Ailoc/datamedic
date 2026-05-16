import pytest
from concurrent.futures import ThreadPoolExecutor


def test_run_pandas_simple_query():
    from datamedic.tools.pandas_tool import run_pandas_code
    code = "result = df[(df['科室']=='胸外科') & (df['指标名称']=='门诊人次') & (df['年份']==2024) & (df['月份']==12)]['数值'].values[0]"
    result = run_pandas_code(code)
    assert "8772" in result


def test_run_pandas_calculation():
    from datamedic.tools.pandas_tool import run_pandas_code
    code = "subset = df[(df['科室']=='胸外科') & (df['指标名称']=='门诊人次') & (df['年份']==2025)]\nresult = int(subset.loc[subset['数值'].idxmax(), '月份'])"
    result = run_pandas_code(code)
    assert "12" in result


def test_run_pandas_blocks_import():
    from datamedic.tools.pandas_tool import run_pandas_code
    code = "import os\nresult = os.listdir('.')"
    result = run_pandas_code(code)
    assert "禁止" in result or "不允许" in result or "错误" in result


def test_run_pandas_no_result_variable():
    from datamedic.tools.pandas_tool import run_pandas_code
    code = "x = 42"
    result = run_pandas_code(code)
    assert "result" in result


def test_run_pandas_blocks_function_definitions():
    from datamedic.tools.pandas_tool import run_pandas_code

    code = "def helper():\n    return len(df)\nresult = helper()"
    result = run_pandas_code(code)

    assert "禁止" in result or "不允许" in result or "错误" in result


def test_run_pandas_blocks_dunder_attribute_access():
    from datamedic.tools.pandas_tool import run_pandas_code

    result = run_pandas_code("result = df.__class__")

    assert "禁止" in result or "不允许" in result or "错误" in result


def test_run_pandas_works_outside_main_thread():
    from datamedic.tools.pandas_tool import run_pandas_code

    with ThreadPoolExecutor(max_workers=1) as executor:
        result = executor.submit(run_pandas_code, "result = len(df)").result(timeout=10)

    assert "48960" in result
