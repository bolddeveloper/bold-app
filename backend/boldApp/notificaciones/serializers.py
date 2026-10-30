from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor_assignment.employee.full_name", read_only=True, default="")
    actor_is_owner = serializers.BooleanField(source="metadata.actor_is_owner", read_only=True, default=False)

    class Meta:
        model = Notification
        fields = [
            "id", "recipient_assignment", "actor_assignment", "actor_name", "actor_is_owner",
            "task", "project", "type", "module", "resource_type", "resource_id",
            "title", "body", "route", "metadata", "is_read", "created_at", "read_at",
        ]
        read_only_fields = fields
