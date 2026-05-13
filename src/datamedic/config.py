"""全局配置模块，从环境变量加载 LLM、语音服务和数据路径等配置项。"""

from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

# LLM 配置（兼容 OpenAI 接口的任意服务）
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o")

# 阿里云 DashScope 语音服务
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
STT_MODEL = os.getenv("STT_MODEL", "paraformer-realtime-v2")
TTS_MODEL = os.getenv("TTS_MODEL", "cosyvoice-v2")
TTS_VOICE = os.getenv("TTS_VOICE", "longxiaochun_v2")

# 数据文件路径
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
METRIC_DATA_PATH = DATA_DIR / "metric_data.csv"
CAUSAL_RELATIONS_PATH = DATA_DIR / "causal_relations.xlsx"
