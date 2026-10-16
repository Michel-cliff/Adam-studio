import sys
from pathlib import Path

# The acceptance scripts are plain modules next to this folder.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
