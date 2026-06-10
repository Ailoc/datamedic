"""沙箱化 Pandas 代码执行工具。

通过 AST 校验、受限 builtins 和进程池超时防护，
允许 LLM 在受控环境中执行受限的数据分析代码。
"""

import ast
import logging
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FuturesTimeout

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5
DANGEROUS_CALL_NAMES = {
    "__import__",
    "breakpoint",
    "compile",
    "eval",
    "exec",
    "globals",
    "input",
    "locals",
    "open",
    "vars",
}
DANGEROUS_ATTRIBUTE_CALLS = {
    "read_csv",
    "read_excel",
    "read_feather",
    "read_hdf",
    "read_json",
    "read_orc",
    "read_parquet",
    "read_pickle",
    "read_sql",
    "read_table",
    "to_clipboard",
    "to_csv",
    "to_excel",
    "to_feather",
    "to_hdf",
    "to_json",
    "to_orc",
    "to_parquet",
    "to_pickle",
    "to_sql",
}
FORBIDDEN_NODE_TYPES = (
    ast.AsyncFor,
    ast.AsyncFunctionDef,
    ast.AsyncWith,
    ast.Await,
    ast.ClassDef,
    ast.Delete,
    ast.For,
    ast.FunctionDef,
    ast.Global,
    ast.Import,
    ast.ImportFrom,
    ast.Lambda,
    ast.Nonlocal,
    ast.Raise,
    ast.Try,
    ast.While,
    ast.With,
)

SAFE_BUILTINS = {
    "abs": abs, "all": all, "any": any, "bool": bool,
    "dict": dict, "enumerate": enumerate, "filter": filter,
    "float": float, "format": format, "frozenset": frozenset,
    "hash": hash,
    "int": int, "isinstance": isinstance, "issubclass": issubclass,
    "iter": iter, "len": len, "list": list, "map": map,
    "max": max, "min": min, "next": next, "print": print,
    "range": range, "repr": repr, "reversed": reversed,
    "round": round, "set": set, "slice": slice, "sorted": sorted,
    "str": str, "sum": sum, "tuple": tuple,
    "zip": zip,
}


class PandasCodeValidator(ast.NodeVisitor):
    """拒绝不需要的 Python 结构和明显危险的调用。"""

    def __init__(self):
        self.errors: list[str] = []

    def visit(self, node):  # noqa: D102
        if isinstance(node, FORBIDDEN_NODE_TYPES):
            self.errors.append(type(node).__name__)
            return
        super().visit(node)

    def visit_Attribute(self, node: ast.Attribute):
        if node.attr.startswith("__"):
            self.errors.append(node.attr)
            return
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name):
        if node.id.startswith("__"):
            self.errors.append(node.id)

    def visit_Call(self, node: ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id in DANGEROUS_CALL_NAMES:
            self.errors.append(node.func.id)
            return
        if isinstance(node.func, ast.Attribute) and node.func.attr in DANGEROUS_ATTRIBUTE_CALLS:
            self.errors.append(node.func.attr)
            return
        self.generic_visit(node)


def _validate_code(code: str) -> str | None:
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as e:
        return f"代码解析错误：SyntaxError: {e.msg}"

    validator = PandasCodeValidator()
    validator.visit(tree)
    if validator.errors:
        return f"错误：代码中包含禁止的操作（{validator.errors[0]}），不允许执行。"
    return None


def _exec_in_subprocess(code: str) -> str:
    """Execute validated Pandas code in a subprocess with its own data copy."""
    from datamedic.data.loader import load_metric_data as _load
    import pandas as _pd

    df = _load().copy()
    local_vars = {"df": df, "pd": _pd}
    exec(code, {"__builtins__": SAFE_BUILTINS}, local_vars)
    if "result" in local_vars:
        return str(local_vars["result"])
    return "代码执行完成，但未设置 result 变量。请将最终结果赋值给 result。"


def run_pandas_code(code: str) -> str:
    logger.debug("pandas_code execution requested: %.100s", code)
    validation_error = _validate_code(code)
    if validation_error:
        logger.warning("Pandas code rejected: %s", validation_error)
        return validation_error

    executor = ProcessPoolExecutor(max_workers=1)
    try:
        future = executor.submit(_exec_in_subprocess, code)
        try:
            result = future.result(timeout=TIMEOUT_SECONDS)
            logger.debug("Pandas code executed successfully, result_length=%d", len(str(result)))
            return result
        except FuturesTimeout:
            future.cancel()
            logger.warning("Pandas code execution timed out (%ds)", TIMEOUT_SECONDS)
            return "错误：代码执行超时（超过5秒），请简化查询逻辑。"
    except Exception as e:
        logger.warning("Pandas code execution failed: %s", e, exc_info=True)
        return f"代码执行错误：{type(e).__name__}: {str(e)}"
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
