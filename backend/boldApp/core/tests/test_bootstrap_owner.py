from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from boldApp.core.models import PositionAssignment, UserAccount


class BootstrapOwnerTests(TestCase):
    @patch.dict("os.environ", {"BOLD_BOOTSTRAP_OWNER_PASSWORD": "Una frase segura 2026!"})
    def test_creates_one_protected_owner_without_demo_seed(self):
        call_command("bootstrap_owner", email="owner@bold.gt", name="Persona Propietaria")

        account = UserAccount.objects.get(email="owner@bold.gt")
        assignment = PositionAssignment.objects.get(employee=account.employee, is_active=True)
        self.assertTrue(account.is_superuser)
        self.assertTrue(account.is_staff)
        self.assertEqual(assignment.position.job_role.level, "owner")
        self.assertEqual(assignment.position.unit.name, "Dirección")
        self.assertEqual(assignment.position.unit.parent_unit.name, "Bold")

        with self.assertRaises(CommandError):
            call_command("bootstrap_owner", email="other@bold.gt", name="Otro Propietario")
