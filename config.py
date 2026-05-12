import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o")
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
METRIC_DATA_PATH = os.path.join(DATA_DIR, "metric_data.csv")
CAUSAL_RELATIONS_PATH = os.path.join(DATA_DIR, "causal_relations.xlsx")
