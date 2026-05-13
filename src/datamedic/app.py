import streamlit as st


st.set_page_config(page_title="DataMedic 前端已迁移", layout="centered")

st.title("DataMedic 前端已迁移到 TypeScript")
st.markdown(
    """
新的主前端位于 `frontend/`，使用 React + TypeScript 构建。

启动方式：

```bash
.venv/bin/python -m uvicorn datamedic.server:app --host 127.0.0.1 --port 8000
cd frontend
npm run dev
```

然后打开 `http://localhost:5173`。
    """
)
