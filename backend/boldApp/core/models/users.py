from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from .mixins import UUIDPrimaryKeyModel
from .organizational import Employee


class UserAccountManager(BaseUserManager):
    def create_user(self, email, employee, password=None, **extra_fields):
        if not email:
            raise ValueError("La cuenta debe tener un email valido.")
        if employee is None:
            raise ValueError("La cuenta debe pertenecer a un empleado.")

        normalized_email = self.normalize_email(email).strip().lower()
        if not normalized_email.endswith("@bold.gt"):
            raise ValueError("La cuenta debe utilizar un correo @bold.gt.")
        account = self.model(
            email=normalized_email,
            employee=employee,
            **extra_fields,
        )
        account.set_password(password)
        account.save(using=self._db)
        return account

    def create_superuser(self, email, employee, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        if extra_fields.get("is_staff") is not True or extra_fields.get("is_superuser") is not True:
            raise ValueError("El superusuario requiere is_staff e is_superuser.")
        return self.create_user(email, employee, password, **extra_fields)


class UserAccount(UUIDPrimaryKeyModel, AbstractBaseUser, PermissionsMixin):
    employee = models.OneToOneField(
        Employee,
        on_delete=models.PROTECT,
        related_name="user_account",
    )
    email = models.EmailField(max_length=180, unique=True)
    password = models.CharField(max_length=255, db_column="password_hash")
    avatar_url = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    last_login = models.DateTimeField(null=True, blank=True, db_column="last_login_at")
    email_verified_at = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    must_change_password = models.BooleanField(default=False)
    credentials_version = models.PositiveIntegerField(default=1)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserAccountManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["employee"]

    class Meta:
        db_table = "user_accounts"
        ordering = ["email"]
        constraints = [
            models.UniqueConstraint(Lower("email"), name="unique_user_email_case_insensitive"),
            models.CheckConstraint(condition=models.Q(email__endswith="@bold.gt"), name="user_email_must_be_bold_gt"),
        ]

    def save(self, *args, **kwargs):
        self.email = type(self).objects.normalize_email(self.email).strip().lower()
        if not self.is_active and self.deactivated_at is None:
            self.deactivated_at = timezone.now()
        elif self.is_active:
            self.deactivated_at = None
        super().save(*args, **kwargs)

    def __str__(self):
        return self.email
