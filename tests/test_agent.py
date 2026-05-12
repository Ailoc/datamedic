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
