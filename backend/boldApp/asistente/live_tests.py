"""Explicit opt-in: two real Codex calls with synthetic test records only."""
import os
from unittest import skipUnless
from django.test import TestCase
from .tests import AssistantTests as Fixture
from . import service
from boldApp.tareas.models import Task

@skipUnless(os.environ.get('BOLD_ASSISTANT_LIVE_ACCEPTANCE')=='synthetic-only','Opt-in Codex acceptance consumes the configured ChatGPT plan.')
class LivePlannerTests(TestCase):
    person=Fixture.person
    phase=Fixture.phase
    as_person=Fixture.as_person
    client_for=Fixture.client_for
    setUp=Fixture.setUp
    create=Fixture.create
    get=Fixture.get
    action=Fixture.action
    approve=Fixture.approve

    def test_synthetic_two_approval_workflow(self):
        pk=self.create('Crea exactamente dos tareas para mí en mi departamento, sin proyecto ni fechas: "Prueba sintética alfa" y "Prueba sintética beta". No completes tareas ni etapas.')
        self.assertTrue(service.infer(pk));data=self.get(pk)
        self.assertEqual(data['state'],'awaiting_scope',data)
        self.assertEqual(self.action(pk,'prepare').status_code,202)
        self.assertTrue(service.infer(pk));data=self.get(pk)
        self.assertEqual(data['state'],'awaiting_approval',data)
        self.assertEqual(len(data['proposal']['steps']),2)
        self.assertTrue(all(s['capability']=='tasks.create' for s in data['proposal']['steps']))
        self.assertFalse(Task.objects.filter(title='Prueba sintética alfa').exists())
        self.assertEqual(self.approve(pk).status_code,202);self.assertTrue(service.perform(pk))
        self.assertEqual(Task.objects.filter(title__in=['Prueba sintética alfa','Prueba sintética beta']).count(),2)
