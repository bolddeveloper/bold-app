from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor_assignment.employee.full_name", read_only=True, default="")

    class Meta:
        model = Notification
        fields = [
            "id", "recipient_assignment", "actor_assignment", "actor_name",
            "task", "project", "type", "module", "resource_type", "resource_id",
            "title", "body", "route", "metadata", "is_read", "created_at", "read_at",
        ]
        read_only_fields = fields
