from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from boldApp.hojas import engine


@override_settings(SHEETS_ENGINE_URL="http://127.0.0.1:8010", SHEETS_ENGINE_TOKEN="prepared-test-token")
class EngineTests(SimpleTestCase):
    @patch("boldApp.hojas.engine.requests.post")
    def test_sheet_actions_are_payload_fields_not_endpoint_arguments(self, post):
        document = {"id": "book", "sheetOrder": ["sheet"]}
        post.return_value.ok = True
        post.return_value.json.return_value = {"document": document}
        for action in ("remove", "rename", "copy"):
            with self.subTest(action=action):
                self.assertEqual(engine.call("sheet", document, sheet="sheet", action=action), {"document": document})
                self.assertEqual(post.call_args.args, ("http://127.0.0.1:8010/sheet",))
                self.assertEqual(post.call_args.kwargs["json"], {"document": document, "sheet": "sheet", "action": action})
