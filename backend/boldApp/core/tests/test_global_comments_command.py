import io

from django.core.management import call_command
from django.test import TestCase

from boldApp.core.models import JobRole, JobRolePermission, Permission


class GlobalCommentsCommandTests(TestCase):
    def test_global_comments_preserve_other_permissions_denials_and_rule_ids(self):
        permission = Permission.objects.get(code="tasks.comment.create")
        role = JobRole.objects.create(title="Colaborador")
        denied = JobRole.objects.create(title="Restringido")
        missing = JobRole.objects.create(title="Sin regla")
        rule = JobRolePermission.objects.create(job_role=role, permission=permission, effect="allow", scope_type="own_unit")
        JobRolePermission.objects.create(job_role=denied, permission=permission, effect="deny", scope_type="own_unit")
        call_command("enable_global_task_comments", dry_run=True, stdout=io.StringIO())
        rule.refresh_from_db()
        self.assertEqual(rule.scope_type, "own_unit")
        call_command("enable_global_task_comments", stdout=io.StringIO())
        rule.refresh_from_db()
        self.assertEqual(rule.scope_type, "global")
        self.assertTrue(JobRolePermission.objects.filter(job_role=missing, effect="allow", scope_type="global").exists())
        self.assertFalse(JobRolePermission.objects.filter(job_role=denied, effect="allow").exists())
        count = JobRolePermission.objects.count()
        call_command("enable_global_task_comments", stdout=io.StringIO())
        self.assertEqual(JobRolePermission.objects.count(), count)
