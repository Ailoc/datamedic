import os
import uuid
import json
import requests
import streamlit as st
import streamlit.components.v1 as components
import plotly.io as pio

API_BASE_URL = "http://localhost:8000"

st.set_page_config(page_title="医院运营指标智能分析助手", layout="wide")
st.title("🏥 医院运营指标智能分析助手")

with st.sidebar:
    st.markdown("### 💡 使用提示")
    st.markdown("""
**你可以问我：**
- 查询数据："去年12月胸外科门诊人次"
- 看趋势："展示2025年骨科出院人次趋势"
- 对比："心内科和心外科手术人次对比"
- 分析原因："为什么门诊人次下降？"
- 排名："哪个科室手术人次最多？"

**支持多轮对话**，可以追问细节。
    """)
    st.markdown("---")
    st.markdown("📊 数据范围：2022.1 - 2025.12")
    st.markdown("🏥 覆盖科室：20个")
    st.markdown("📋 运营指标：51项")

if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())
if "messages" not in st.session_state:
    st.session_state.messages = []

# Voice input section
with open(os.path.join(os.path.dirname(__file__), "static", "voice_input.html"), "r") as f:
    voice_html = f.read()
components.html(voice_html, height=50)

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["text"])
        if msg.get("figures"):
            for fig_json in msg["figures"]:
                fig = pio.from_json(json.dumps(fig_json))
                st.plotly_chart(fig, use_container_width=True)

if user_input := st.chat_input("请输入您的问题，例如：去年12月胸外科门诊人次是多少？"):
    st.session_state.messages.append({"role": "user", "text": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

    with st.chat_message("assistant"):
        with st.spinner("思考中..."):
            try:
                response = requests.post(
                    f"{API_BASE_URL}/chat",
                    json={
                        "session_id": st.session_state.session_id,
                        "message": user_input,
                    },
                    timeout=60,
                )
                data = response.json()
                st.markdown(data["text"])

                if data.get("figures"):
                    for fig_json in data["figures"]:
                        fig = pio.from_json(json.dumps(fig_json))
                        st.plotly_chart(fig, use_container_width=True)

                st.session_state.messages.append({
                    "role": "assistant",
                    "text": data["text"],
                    "figures": data.get("figures", []),
                })

            except requests.exceptions.ConnectionError:
                error_msg = "⚠️ 无法连接到后端服务，请确保已启动 FastAPI 服务器：`uvicorn server:app --port 8000`"
                st.error(error_msg)
                st.session_state.messages.append({"role": "assistant", "text": error_msg})
            except Exception as e:
                error_msg = f"⚠️ 请求出错：{str(e)}"
                st.error(error_msg)
                st.session_state.messages.append({"role": "assistant", "text": error_msg})
