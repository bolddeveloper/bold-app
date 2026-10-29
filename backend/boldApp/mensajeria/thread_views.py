from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from boldApp.core.models import Employee
from .channel_events import publish_channel
from .channel_notifications import mark_unfollowed_notices_read
from .channel_views import FollowChannel, SlackView
from .models import ChannelThreadSubscription
from .thread_following import thread_states

MAX_FOLLOWED_THREADS = 500


class ThreadFollowView(SlackView):
    def root(self, channel, message_id):
        return get_object_or_404(channel.messages, pk=message_id, parent__isnull=True)

    def get(self, request, channel_id, message_id):
        channel = self.channel(channel_id)
        parent = self.root(channel, message_id)
        return Response(thread_states([parent.pk], self.actor())[str(parent.pk)])

    @transaction.atomic
    def put(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        parent = self.root(channel, message_id)
        form = FollowChannel(data=request.data)
        form.is_valid(raise_exception=True)
        Employee.objects.select_for_update().get(pk=self.actor())
        following = form.validated_data["following"]
        subscription = ChannelThreadSubscription.objects.filter(parent=parent, employee_id=self.actor()).first()
        if subscription is None and not following:
            return Response({"parent_id": str(parent.pk), "following": False, "state_version": 0})
        if subscription is None:
            subscription, _ = ChannelThreadSubscription.objects.get_or_create(parent=parent, employee_id=self.actor())
        if subscription.following != following:
            if following and ChannelThreadSubscription.objects.filter(employee_id=self.actor(), following=True).count() >= MAX_FOLLOWED_THREADS:
                raise ValidationError("Puedes seguir hasta 500 hilos. Deja de seguir alguno antes de añadir otro.")
            subscription.following = following
            subscription.revision += 1
            subscription.save(update_fields=["following", "revision", "updated_at"])
            if not following:
                mark_unfollowed_notices_read(channel.pk, self.actor())
            publish_channel(channel, "thread.state.changed", self.actor())
        return Response({"parent_id": str(parent.pk), "following": subscription.following, "state_version": subscription.revision})
