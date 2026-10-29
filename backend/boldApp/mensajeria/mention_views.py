from django.db.models import Q
from collections import Counter
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from boldApp.core.models import Employee
from .channel_views import SlackView
from .mentions import TOKEN, authorized_people, with_mention_assignments, direct_mention_people
from .serializers import StrictInputSerializer
from .views import PrivateChatView
from .page_views import PageView
from .page_mentions import PAGE_READ_CODES


class MentionQuery(StrictInputSerializer):
    q = serializers.CharField(min_length=2, max_length=80)


def mention_people_data(people):
    results = [{"employee_id": str(person.pk), "name": person.full_name, "email": person.user_account.email,
        "token": "@" + person.user_account.email.lower()} for person in people
        if TOKEN.fullmatch("@" + person.user_account.email.lower())]
    duplicates = Counter(row["token"] for row in results)
    return [row for row in results if duplicates[row["token"]] == 1]


class DirectMentionPeopleView(PrivateChatView):
    def get(self, request, conversation_id):
        conversation = self.conversation(conversation_id)
        query = MentionQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        term = query.validated_data["q"].casefold()
        people = direct_mention_people(conversation)
        # Disambiguate before the term filter, not only within a matching subset.
        results = [row for row in mention_people_data(people) if term in row["name"].casefold() or term in row["email"].casefold()]
        return Response({"results": results, "refine": False})


def channel_mention_results(request, channel, policy, codes=("slack.channel.read",)):
    query = MentionQuery(data=request.query_params)
    query.is_valid(raise_exception=True)
    term = query.validated_data['q']
    rows = Employee.objects.filter(Q(full_name__icontains=term) | Q(user_account__email__icontains=term),
        is_active=True, user_account__is_active=True).order_by('full_name', 'pk')
    people = list(with_mention_assignments(rows[:101]))
    if len(people) > 100:
        raise ValidationError('Hay demasiadas coincidencias. Escribe más del nombre o del correo.')
    results = mention_people_data(authorized_people(people, channel, policy.permissions, codes))
    return Response({'results':results[:20], 'refine':len(results)>20})


class ChannelMentionPeopleView(SlackView):
    def get(self, request, channel_id):
        return channel_mention_results(request, self.channel(channel_id), self.policy())


class PageMentionPeopleView(PageView):
    def get(self, request, channel_id, page_id):
        channel = self.scope(channel_id)
        get_object_or_404(channel.pages, pk=page_id)
        return channel_mention_results(request, channel, self.policy(), PAGE_READ_CODES)
