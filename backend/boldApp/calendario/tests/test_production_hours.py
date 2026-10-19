import io
from datetime import date
from django.core.management import call_command
from django.test import SimpleTestCase
from boldApp.calendario.production_hours import production_schedule


class ProductionHoursTests(SimpleTestCase):
    def test_daytime_ranges_and_single_start_keep_their_assumptions(self):
        day = date(2026,10,19)
        for text, start, end in (("Cassesa 9:00 - 4:00","09:00","16:00"),
                ("Casa Médica 12:30pm - 5:00pm","12:30","17:00"),
                ("Morana 11 - 2pm","11:00","14:00"),
                ("Dasa 2.30 a 4.40","14:30","16:40"),
                ("Evento Corchos 7-9 pm","19:00","21:00"),
                ("Torino 10 AM","10:00","11:00")):
            blocks, warnings = production_schedule(text, day, daytime=True)
            self.assertFalse(warnings, text)
            self.assertEqual(len(blocks),1,text)
            self.assertIn("T"+start,blocks[0]["start"]["dateTime"])
            self.assertIn("T"+end,blocks[0]["end"]["dateTime"])
        self.assertIn("provisional",blocks[0]["note"])

    def test_separate_activities_do_not_fill_the_gap_and_addresses_are_not_times(self):
        day = date(2026,10,19)
        blocks, warnings = production_schedule("EMPAGUA 8:30 a 10:30 AM / CASSESA 12:00 a 4:30 PM",day,daytime=True)
        self.assertEqual(len(blocks),2)
        self.assertIn("T10:30",blocks[0]["end"]["dateTime"])
        self.assertIn("T12:00",blocks[1]["start"]["dateTime"])
        for text in ("Avene Z10", "Producción zona 14", "15 calle 8-13, Colonia Mariscal", "EDICIÓN"):
            self.assertEqual(production_schedule(text,day,daytime=True)[0],[],text)
        blocks, warnings = production_schedule("Empagua 8:00 a 12:00 AM",day,daytime=True)
        self.assertFalse(blocks)
        self.assertTrue(warnings)
