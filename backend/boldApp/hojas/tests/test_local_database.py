from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
from unittest import skipUnless

from django.conf import settings
from django.db import connection
from django.db.backends.sqlite3.base import DatabaseWrapper
from django.test import SimpleTestCase


@skipUnless(settings.DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3", "Solo desarrollo con SQLite")
class LocalDatabaseTests(SimpleTestCase):
    def test_background_write_waits_before_reading_instead_of_upgrading_a_read_lock(self):
        with TemporaryDirectory() as directory:
            configuration = deepcopy(connection.settings_dict)
            configuration["NAME"] = str(Path(directory) / "sheets.sqlite3")
            configuration["OPTIONS"]["timeout"] = 2
            self.assertEqual(configuration["OPTIONS"]["transaction_mode"], "IMMEDIATE")
            first = DatabaseWrapper(configuration, alias="sheet_first")
            second_started, second_locked = Event(), Event()
            errors = []

            def background_save():
                second = DatabaseWrapper(deepcopy(configuration), alias="sheet_second")
                try:
                    second.connect()
                    second_started.set()
                    second._start_transaction_under_autocommit()
                    second_locked.set()
                    with second.cursor() as cursor:
                        cursor.execute("UPDATE counter SET value = value + 1")
                    second.commit()
                except Exception as error:
                    errors.append(error)
                finally:
                    second.close()

            worker = None
            try:
                first.connect()
                with first.cursor() as cursor:
                    cursor.execute("CREATE TABLE counter (value INTEGER)")
                    cursor.execute("INSERT INTO counter VALUES (0)")
                first._start_transaction_under_autocommit()
                worker = Thread(target=background_save)
                worker.start()
                self.assertTrue(second_started.wait(1))
                self.assertFalse(second_locked.wait(0.1))
                with first.cursor() as cursor:
                    cursor.execute("UPDATE counter SET value = value + 1")
                first.commit()
                worker.join(3)
                self.assertFalse(worker.is_alive())
                self.assertEqual(errors, [])
                with first.cursor() as cursor:
                    cursor.execute("SELECT value FROM counter")
                    self.assertEqual(cursor.fetchone()[0], 2)
            finally:
                first.close()
                if worker:
                    worker.join(3)
