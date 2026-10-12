import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# En pruebas no se programa nada en segundo plano.
os.environ["PIPELINE_DAILY_AT"] = ""
os.environ["JOB_WORKER"] = "off"
