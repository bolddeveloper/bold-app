from django.test import TestCase, override_settings
from boldApp.core.models import Employee, Position, PositionAssignment
from . import test_channels as base
from .models import DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelDiscoveryTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny

    def test_color_round_trip_validation_permissions_and_optimistic_version(self):
        response = self.client.post(self.root, {"name": "Diseño · Campañas", "color": "#B82146"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        url = self.root + response.data["id"] + "/"
        changed = self.client.patch(url, {"color": "#4760A8", "version": 1}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(self.client.get(url).data["color"], "#4760A8")
        self.assertEqual(self.client.patch(url, {"color": "#287065", "version": 1}, format="json").status_code, 409)
        for color in ("red", "#123", "url(bad)", "#1234567"):
            self.assertEqual(self.client.patch(url, {"color": color, "version": 2}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"color": "", "version": 2}, format="json").status_code, 200)
        self.deny("slack.channel.manage")
        self.assertEqual(self.client.patch(url, {"color": "#287065", "version": 3}, format="json").status_code, 403)

    def test_search_finds_unloaded_matching_channels_and_hides_private_groups(self):
        DepartmentChannel.objects.bulk_create([DepartmentChannel(name=f"A-{i:03}", unit=self.it, creator=self.alice) for i in range(55)])
        target = DepartmentChannel.objects.create(name="Diseño · Campañas", unit=self.marketing, creator=self.alice)
        DepartmentChannel.objects.create(name="Diseño · Reservado", unit=None, creator=self.bob, visibility="private")
        self.assertNotIn(str(target.pk), [row["id"] for row in self.client.get(self.root).data["results"]])
        for query in ("diseno", "disneo", "campanas", "campanas diseno"):
            result = self.client.get(self.root, {"q": query})
            self.assertEqual([row["id"] for row in result.data["results"]], [str(target.pk)])
            self.assertEqual([row["id"] for row in result.data["departments"]], [str(self.marketing.pk)])
        self.assertEqual(self.client.get(self.root, {"q": "finanzas"}).data["departments"], [])

    def test_invitation_directory_identity_pagination_department_and_inactive_exclusion(self):
        account = self.bob.employee.user_account
        account.avatar_url = "/api/v2/avatar/example/"
        account.save(update_fields=["avatar_url"])
        PositionAssignment.objects.create(employee=self.bob.employee, position=Position.objects.create(unit=self.it, job_role=self.role))
        for i in range(34):
            self.identity(f"Marketing {i:02}", self.marketing)
        inactive = self.identity("Inactive", self.marketing)
        inactive.is_active = False
        inactive.save()
        filters = {"channel": self.channel_id, "department": str(self.marketing.pk)}
        page = self.client.get(self.root+"people/", filters)
        self.assertEqual(page.status_code, 200, page.data)
        ids = [row["employee_id"] for row in page.data["results"]]
        self.assertEqual(len(ids), 30)
        self.assertTrue(page.data["next"])
        while page.data["next"]:
            page = self.client.get(page.data["next"])
            ids.extend(row["employee_id"] for row in page.data["results"])
        self.assertEqual(len(ids), 36)
        self.assertEqual(len(set(ids)), 36)
        self.assertNotIn(str(inactive.employee_id), ids)
        self.assertNotIn(str(self.alice.employee_id), ids)
        bob = self.client.get(self.root+"people/", {"channel": self.channel_id, "q": account.email}).data["results"][0]
        self.assertEqual(bob["avatar_url"], account.avatar_url)
        self.assertEqual({row["id"] for row in bob["departments"]}, {str(self.it.pk), str(self.marketing.pk)})
        self.assertEqual(self.client.get(self.root+"people/", {"channel": self.channel_id, "department": "bad"}).status_code, 400)

    def test_rich_invited_members_and_catalog_do_not_grant_private_reading(self):
        created = self.client.post(self.root, {"name": "Privado", "visibility": "private", "color": "#9250A3"}, format="json")
        url = self.root+created.data["id"]+"/"
        owner = self.as_person(self.owner)
        data = owner.get(url+"access/").data
        self.assertEqual(data["color"], "#9250A3")
        self.assertEqual(data["members"][0]["departments"][0]["name"], "IT")
        self.assertEqual(owner.get(url+"messages/").status_code, 404)
        managed = owner.get(self.root+"managed/").data["results"]
        self.assertEqual(next(row for row in managed if row["id"]==created.data["id"])["color"], "#9250A3")
        self.assertEqual(self.as_person(self.bob).get(self.root+"people/", {"channel": created.data["id"]}).status_code, 404)
