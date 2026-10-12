from datetime import datetime
from zoneinfo import ZoneInfo

from app.scheduler import seconds_until

BOG = ZoneInfo("America/Bogota")


def test_programa_la_misma_noche_o_la_siguiente():
    assert seconds_until("02:00", datetime(2026, 10, 7, 1, 0, tzinfo=BOG)) == 3600
    assert seconds_until("02:00", datetime(2026, 10, 7, 2, 0, tzinfo=BOG)) == 24 * 3600
    assert seconds_until("02:00", datetime(2026, 10, 7, 23, 0, tzinfo=BOG)) == 3 * 3600
