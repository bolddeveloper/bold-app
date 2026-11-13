import uuid
from django.utils import timezone

from django.test import TestCase, override_settings

from . import test_channels as base
from .channel_events import channel_event
from .models import ChannelAccessRule, ChannelCategory, ChannelMessage, DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelCategoryTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send
    deny = base.DepartmentChannelTests.deny
    catalog = "/api/v2/messaging/channel-categories/"

    def scope(self, unit=None, server=None):
        return "?server=" + str(server) if server else "?unit=" + str(unit or self.it.pk)

    def create_category(self, name, *, scope=None, token=None, client=None):
        return (client or self.client).post(self.catalog + (scope or self.scope()), {"name": name, "client_id": token or str(uuid.uuid4())}, format="json")

    def move(self, category, before, version=None):
        return self.client.put(self.catalog + category["id"] + "/position/" + self.scope(), {"before_id": before, "version": version or category["version"]}, format="json")

    def test_create_retry_case_insensitive_names_and_server_boundaries(self):
        token = str(uuid.uuid4())
        result = self.create_category("App BOLD", token=token)
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["results"][0]["id"], token)
        again = self.create_category("App BOLD", token=token)
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual(ChannelCategory.objects.count(), 1)
        self.assertEqual(self.create_category("app bold").status_code, 409)
        self.assertEqual(self.create_category("Otro", token=token).status_code, 409)
        self.assertEqual(self.create_category("App BOLD", scope=self.scope(self.marketing.pk)).status_code, 201)
        self.assertEqual(self.client.get(self.catalog + "?unit=independent").data["results"], [])
        self.assertEqual(self.client.get(self.catalog).status_code, 400)
        self.assertEqual(self.client.get(self.catalog + self.scope() + "&server=" + str(uuid.uuid4())).status_code, 400)

    def test_move_channel_category_reorder_preserves_children_and_messages(self):
        first = self.create_category("Primera").data["results"][0]
        second = self.create_category("Segunda").data["results"][1]
        third = self.create_category("Tercera").data["results"][2]
        source = self.send("Conservar mensaje").data["message"]
        peer = self.as_person(self.bob)
        self.assertEqual(peer.put(self.url + "category/" + self.scope(), {"category_id": first["id"], "version": 1}, format="json").status_code, 403)
        moved = self.client.put(self.url + "category/" + self.scope(), {"category_id": first["id"], "version": 1}, format="json")
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(moved.data["channel"]["category_id"], first["id"])
        version = moved.data["channel"]["version"]
        again = self.client.put(self.url + "category/" + self.scope(), {"category_id": first["id"], "version": version}, format="json")
        self.assertEqual(again.data["channel"]["version"], version)
        result = self.move(third, first["id"])
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual([row["id"] for row in result.data["results"]], [third["id"], first["id"], second["id"]])
        self.assertEqual(DepartmentChannel.objects.get(pk=self.channel_id).category_id, uuid.UUID(first["id"]))
        self.assertTrue(ChannelMessage.objects.filter(pk=source["id"], body="Conservar mensaje").exists())
        self.assertEqual(self.move(first, None).status_code, 409, "a stale order cannot overwrite another window")
        self.assertEqual(self.client.put(self.url + "category/" + self.scope(), {"category_id": None, "version": 1}, format="json").status_code, 409)
        out = self.client.put(self.url + "category/" + self.scope(), {"category_id": None, "version": version}, format="json")
        self.assertIsNone(out.data["channel"]["category_id"])

    def test_rename_validates_name_scope_permissions_and_version(self):
        category = self.create_category("Primera").data["results"][0]
        self.create_category("Segunda")
        url = self.catalog + category["id"] + "/"
        values = {"version": category["version"], "name": "  Actualizada  "}
        self.assertEqual(self.client.patch(url + self.scope(self.marketing.pk), values, format="json").status_code, 404)
        result = self.client.patch(url + self.scope(), values, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        row = ChannelCategory.objects.get(pk=category["id"])
        self.assertEqual((row.name, row.version, row.position), ("Actualizada", 2, 0))
        self.assertEqual(self.client.patch(url + self.scope(), values, format="json").status_code, 409)
        for name in ("", "x" * 81):
            self.assertEqual(self.client.patch(url + self.scope(), {"version": 2, "name": name}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url + self.scope(), {"version": 2, "name": "segunda"}, format="json").status_code, 409)
        row.refresh_from_db()
        self.assertEqual((row.name, row.version), ("Actualizada", 2))
        self.deny("slack.channel.manage")
        self.assertEqual(self.client.patch(url + self.scope(), {"version": 2, "name": "Prohibida"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(url + self.scope(), {"version": 2}, format="json").status_code, 403)

    def test_delete_ungroups_active_archived_private_channels_without_deleting_content(self):
        category = self.create_category("Agrupación").data["results"][0]
        self.create_category("Conservar orden")
        message = self.send("Conservar mensaje y sus permisos").data["message"]
        channel = DepartmentChannel.objects.get(pk=self.channel_id)
        channel.category_id = category["id"]
        channel.save(update_fields=["category"])
        archived = DepartmentChannel.objects.create(name="Privado archivado", unit=self.it, creator=channel.creator,
            visibility="private", archived_at=timezone.now(), category_id=category["id"], version=7)
        rule = ChannelAccessRule.objects.create(channel=archived, employee=self.alice.employee, access="write")
        url = self.catalog + category["id"] + "/"
        self.assertEqual(self.client.delete(url + self.scope(self.marketing.pk), {"version": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(url + self.scope(), {"version": 99}, format="json").status_code, 409)
        self.assertEqual(DepartmentChannel.objects.filter(category_id=category["id"]).count(), 2)
        self.assertEqual(self.client.delete(url + self.scope(), {}, format="json").status_code, 400)
        result = self.client.delete(url + self.scope(), {"version": 1}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertFalse(ChannelCategory.objects.filter(pk=category["id"]).exists())
        channel.refresh_from_db(); archived.refresh_from_db()
        self.assertIsNone(channel.category_id); self.assertIsNone(archived.category_id)
        self.assertEqual((channel.version, archived.version, archived.visibility), (2, 8, "private"))
        self.assertIsNotNone(archived.archived_at)
        self.assertTrue(ChannelAccessRule.objects.filter(pk=rule.pk, access="write").exists())
        self.assertTrue(ChannelMessage.objects.filter(pk=message["id"], body="Conservar mensaje y sus permisos").exists())
        self.assertEqual(self.as_person(self.bob).get(self.root + str(archived.pk) + "/").status_code, 404)
        self.assertEqual(result.data["results"][0]["position"], 0)
        appended = self.create_category("Al final").data["results"]
        self.assertEqual([row["name"] for row in appended], ["Conservar orden", "Al final"])

    def test_cannot_cross_servers_or_change_visibility(self):
        category = self.create_category("Otro departamento", scope=self.scope(self.marketing.pk)).data["results"][0]
        self.assertEqual(self.client.put(self.url + "category/" + self.scope(), {"category_id": category["id"], "version": 1}, format="json").status_code, 404)
        create = self.client.post(self.root, {"name": "No cruzar", "unit_id": str(self.it.pk), "category_id": category["id"]}, format="json")
        self.assertEqual(create.status_code, 404)
        own = self.create_category("Proyecto").data["results"][0]
        created = self.client.post(self.root, {"name": "Dentro de categoría", "unit_id": str(self.it.pk), "category_id": own["id"]}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["category_id"], own["id"])
        self.assertEqual(created.data["visibility"], "public")
        self.deny("slack.channel.manage")
        self.assertFalse(self.client.get(self.catalog + self.scope()).data["can_manage"])
        self.assertEqual(self.create_category("Sin permiso").status_code, 403)
        self.assertEqual(self.client.put(self.url + "category/" + self.scope(), {"category_id": own["id"], "version": 1}, format="json").status_code, 403)

    def test_private_membership_and_owner_boundaries_for_http_and_push(self):
        server = self.client.post("/api/v2/messaging/servers/", {"name": "Reservado", "members": [{"employee_id": str(self.bob.employee_id), "access": "read"}]}, format="json").data
        scoped = self.scope(server=server["id"])
        result = self.create_category("Información privada", scope=scoped)
        self.assertEqual(result.status_code, 201, result.data)
        bob = self.as_person(self.bob)
        self.assertEqual(bob.get(self.catalog + scoped).status_code, 200)
        self.assertFalse(bob.get(self.catalog + scoped).data["can_manage"])
        self.assertEqual(self.create_category("Prohibida", scope=scoped, client=bob).status_code, 404)
        category_id = result.data["results"][0]["id"]
        self.assertEqual(bob.patch(self.catalog + category_id + "/" + scoped, {"version": 1, "name": "No permitida"}, format="json").status_code, 404)
        self.assertEqual(bob.delete(self.catalog + category_id + "/" + scoped, {"version": 1}, format="json").status_code, 404)
        owner = self.as_person(self.owner)
        self.assertEqual(owner.get(self.catalog + scoped).status_code, 404)
        event = {"kind": "channel.categories_changed", "server_id": server["id"], "unit_id": None}
        self.assertIsNone(channel_event(self.owner.pk, event))
        envelope = channel_event(self.bob.pk, event)
        self.assertEqual(envelope["payload"], {"kind": "channel.categories_changed", "scope": "server:" + server["id"]})
        self.assertNotIn("Información privada", str(envelope))
        from .models import PrivateServerMember
        PrivateServerMember.objects.filter(server_id=server["id"], employee=self.bob.employee).delete()
        self.assertEqual(bob.get(self.catalog + scoped).status_code, 404)
        self.assertIsNone(channel_event(self.bob.pk, event))

    def test_private_channel_invitation_is_not_inherited_from_category(self):
        category = self.create_category("Equipo").data["results"][0]
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.alice.employee, access="write")
        moved = self.client.put(self.url + "category/" + self.scope(), {"category_id": category["id"], "version": 1}, format="json")
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(self.as_person(self.bob).get(self.url).status_code, 404)
        self.assertEqual(ChannelAccessRule.objects.filter(channel_id=self.channel_id).count(), 1)
