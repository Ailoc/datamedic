import pytest


def test_build_system_prompt_contains_departments():
    from datamedic.agent.prompts import build_system_prompt
    prompt = build_system_prompt()
    assert "胸外科" in prompt
    assert "心内科" in prompt
    assert "门诊人次" in prompt
    assert "2022" in prompt


def test_build_system_prompt_contains_all_metrics():
    from datamedic.agent.prompts import build_system_prompt
    prompt = build_system_prompt()
    assert "nb_of_outp" in prompt
    assert "人次" in prompt


def test_build_system_prompt_contains_tool_stop_rules():
    from datamedic.agent.prompts import build_system_prompt

    prompt = build_system_prompt()
    assert "工具返回足够数据后必须直接总结并停止" in prompt
    assert "不要重复调用相同或等价参数的工具" in prompt
    assert "不要反复尝试" in prompt


def test_lru_memory_saver_evicts_all_thread_state():
    from datamedic.agent.agent import LRUMemorySaver

    saver = LRUMemorySaver(max_sessions=1)
    saver.storage["old-thread"][""] = {"checkpoint-1": ("checkpoint", "metadata", None)}
    saver.writes[("old-thread", "", "checkpoint-1")] = {
        ("task", 0): ("task", "channel", ("type", b"value"), "")
    }
    saver.blobs[("old-thread", "", "channel", "version-1")] = ("type", b"value")
    saver._access_order["old-thread"] = None
    saver._access_order["new-thread"] = None

    saver._evict()

    assert "old-thread" not in saver.storage
    assert not any(key[0] == "old-thread" for key in saver.writes)
    assert not any(key[0] == "old-thread" for key in saver.blobs)
