from django.test import TestCase
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount


class InterfaceSettingsTests(TestCase):
    def test_server_order_is_personal_and_preserves_other_preferences(self):
        users=[UserAccount.objects.create_user(email=f'order{i}@bold.gt',employee=Employee.objects.create(full_name=f'Order {i}')) for i in range(2)]
        url='/api/v2/auth/interface-settings/'
        first=['independent','00000000-0000-4000-8000-000000000001','server:00000000-0000-4000-8000-000000000002']
        client=APIClient();client.force_authenticate(users[0])
        client.patch(url,{'theme':'dark','onboarding_completed':True},format='json')
        self.assertEqual(client.patch(url,{'slack_server_order':first},format='json').status_code,200)
        users[0].refresh_from_db()
        self.assertEqual(client.get(url).data['slack_server_order'],first)
        client.force_authenticate(users[1]);self.assertNotIn('slack_server_order',client.get(url).data)
        client.patch(url,{'slack_server_order':list(reversed(first))},format='json')
        client.force_authenticate(users[0]);saved=client.get(url).data
        self.assertEqual(saved['slack_server_order'],first)
        self.assertEqual((saved['theme'],saved['onboarding_completed']),('dark',True))
        for order in [['independent','independent'],['private-name'],['server:other-user'],['x'*100],['independent']*501]:
            self.assertEqual(client.patch(url,{'slack_server_order':order},format='json').status_code,400)
        self.assertEqual(client.get(url).data['slack_server_order'],first)

    def test_preferences_are_validated_and_belong_only_to_current_account(self):
        users = [UserAccount.objects.create_user(email=f"interface{i}@bold.gt", employee=Employee.objects.create(full_name=f"Interface {i}")) for i in range(2)]
        client = APIClient()
        url = "/api/v2/auth/interface-settings/"
        self.assertIn(client.get(url).status_code, [401,403])
        client.force_authenticate(users[0])
        self.assertFalse(client.get(url).data["onboarding_completed"])
        self.assertEqual(client.patch(url,{"theme":"dark","onboarding_step":"google"},format="json").status_code,200)
        self.assertEqual(client.patch(url,{"onboarding_completed":True},format="json").data["theme"],"dark")
        for data in [{"theme":"invalid"},{"user":str(users[1].pk)},{"onboarding_step":"unknown"}]:
            self.assertEqual(client.patch(url,data,format="json").status_code,400)
        client.force_authenticate(users[1])
        self.assertNotIn("theme",client.get(url).data)
        self.assertFalse(client.get(url).data["onboarding_completed"])
