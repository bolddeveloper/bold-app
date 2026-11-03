from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor_assignment.employee.full_name", read_only=True, default="")
    actor_avatar_url = serializers.SerializerMethodField()

    def get_actor_avatar_url(self, notification):
        actor = notification.actor_assignment
        account = getattr(actor.employee, "user_account", None) if actor else None
        return account.avatar_url if account and account.is_active else None

    class Meta:
        model = Notification
        fields = [
            "id", "recipient_assignment", "actor_assignment", "actor_name", "actor_avatar_url",
            "task", "project", "type", "module", "resource_type", "resource_id",
            "title", "body", "route", "metadata", "is_read", "created_at", "read_at",
        ]
        read_only_fields = fields
