from django.urls import path
from .views import RequestsView,RequestView,ActionView,ActivityView,EvidenceView,RecordView

urlpatterns=[path('requests/',RequestsView.as_view()),path('requests/<uuid:pk>/',RequestView.as_view()),
    path('requests/<uuid:pk>/evidence/<int:index>/',EvidenceView.as_view()),
    path('requests/<uuid:pk>/records/<str:step_id>/',RecordView.as_view()),
    path('requests/<uuid:pk>/<str:action>/',ActionView.as_view()),path('activity/',ActivityView.as_view())]
