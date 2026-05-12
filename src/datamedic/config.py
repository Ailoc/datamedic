from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o")
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")

PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
METRIC_DATA_PATH = DATA_DIR / "metric_data.csv"
CAUSAL_RELATIONS_PATH = DATA_DIR / "causal_relations.xlsx"
