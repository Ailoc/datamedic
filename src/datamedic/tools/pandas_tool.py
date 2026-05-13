"""沙箱化 Pandas 代码执行工具。

通过关键词黑名单、受限 builtins 和 SIGALRM 超时三重防护，
允许 LLM 在受控环境中执行用户自定义的数据分析代码。
"""

import signal
import pandas as pd
from datamedic.data.loader import load_metric_data

FORBIDDEN_KEYWORDS = ["import ", "open(", "exec(", "eval(", "__", "os.", "sys.", "subprocess"]
TIMEOUT_SECONDS = 5

SAFE_BUILTINS = {
    "abs": abs, "all": all, "any": any, "bool": bool,
    "dict": dict, "enumerate": enumerate, "filter": filter,
    "float": float, "format": format, "frozenset": frozenset,
    "getattr": getattr, "hasattr": hasattr, "hash": hash,
    "int": int, "isinstance": isinstance, "issubclass": issubclass,
    "iter": iter, "len": len, "list": list, "map": map,
    "max": max, "min": min, "next": next, "print": print,
    "range": range, "repr": repr, "reversed": reversed,
    "round": round, "set": set, "slice": slice, "sorted": sorted,
    "str": str, "sum": sum, "tuple": tuple, "type": type,
    "zip": zip,
}


class CodeTimeoutError(Exception):
    pass


def _timeout_handler(signum, frame):
    raise CodeTimeoutError("代码执行超时")


def run_pandas_code(code: str) -> str:
    for keyword in FORBIDDEN_KEYWORDS:
        if keyword in code:
            return f"错误：代码中包含禁止的操作（{keyword.strip()}），不允许执行。"

    df = load_metric_data()
    local_vars = {"df": df, "pd": pd}

    old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(TIMEOUT_SECONDS)

    try:
        exec(code, {"__builtins__": SAFE_BUILTINS}, local_vars)
        signal.alarm(0)
    except CodeTimeoutError:
        return "错误：代码执行超时（超过5秒），请简化查询逻辑。"
    except Exception as e:
        signal.alarm(0)
        return f"代码执行错误：{type(e).__name__}: {str(e)}"
    finally:
        signal.signal(signal.SIGALRM, old_handler)

    if "result" in local_vars:
        return str(local_vars["result"])
    return "代码执行完成，但未设置 result 变量。请将最终结果赋值给 result。"
