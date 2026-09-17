from django.urls import path

from .views import InvitationConfirmView, LoginView, LogoutView, MFADisableView, MFALoginVerifyView, PasswordChangeView, RecoveryConfirmView, RecoveryRequestView, SessionListView, SessionView, TOTPConfirmView, TOTPSetupView, WebSocketTicketView

urlpatterns = [
    path("session/", SessionView.as_view(), name="auth-session"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("mfa/verify/", MFALoginVerifyView.as_view(), name="auth-mfa-verify"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("sessions/", SessionListView.as_view(), name="auth-sessions"),
    path("password/change/", PasswordChangeView.as_view(), name="auth-password-change"),
    path("password/reset/request/", RecoveryRequestView.as_view(), name="auth-password-reset-request"),
    path("password/reset/confirm/", RecoveryConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("invitation/confirm/", InvitationConfirmView.as_view(), name="auth-invitation-confirm"),
    path("mfa/totp/setup/", TOTPSetupView.as_view(), name="auth-totp-setup"),
    path("mfa/totp/confirm/", TOTPConfirmView.as_view(), name="auth-totp-confirm"),
    path("mfa/disable/", MFADisableView.as_view(), name="auth-mfa-disable"),
    path("websocket-ticket/", WebSocketTicketView.as_view(), name="auth-websocket-ticket"),
]
