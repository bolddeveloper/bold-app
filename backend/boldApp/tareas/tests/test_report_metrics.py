from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError
from boldApp.tareas.report_metrics import distribution, phase_intervals
from boldApp.tareas.report_validation import validate_report, report_period


class ReportMetricContractTests(SimpleTestCase):
    def test_median_and_mean_do_not_turn_missing_times_into_zero(self):
        result=distribution([1,2,90,None])
        self.assertEqual(result,{'mean':31,'median':2,'sample_size':3,'unknown':1})
        self.assertIsNone(distribution([None])['mean'])

    def test_interval_replay_preserves_waits_blocks_restarts_and_same_time_order(self):
        start=datetime(2026,11,1,tzinfo=timezone.utc)
        states=[(0,'pending'),(1,'available'),(3,'in_progress'),(5,'blocked'),(8,'in_progress'),(9,'completed')]
        rows=[SimpleNamespace(sequence=i,occurred_at=start+timedelta(hours=hours),kind='phase.transition',
            before={'status':states[i-1][1] if i else None},after={'status':state}) for i,(hours,state) in enumerate(states)]
        result=phase_intervals(list(reversed(rows)),start+timedelta(hours=10))
        self.assertEqual(result['dependency_hours'],1)
        self.assertEqual(result['wait_hours'],2)
        self.assertEqual(result['active_hours'],3)
        self.assertEqual(result['blocked_hours'],3)
        self.assertEqual(result['cycle_hours'],6)
        self.assertFalse(result['clock_anomaly'])

    def test_invalid_free_form_queries_and_incompatible_charts_are_rejected(self):
        for definition in ({'sql':'select * from tasks'},{'metric':'employee.productivity'},
                           {'visualization':'line','group_by':'employee'}, {'filters':{'tasks':['not-an-id']}}):
            with self.assertRaises(ValidationError):validate_report(definition)

    def test_period_has_explicit_timezone_and_inclusive_final_local_date(self):
        definition=validate_report({'from':'2026-11-01','to':'2026-11-10','timezone':'America/Caracas'})
        start,end=report_period(definition)
        self.assertEqual(start.isoformat(),'2026-11-01T00:00:00-04:00')
        self.assertEqual(end.isoformat(),'2026-11-11T00:00:00-04:00')
