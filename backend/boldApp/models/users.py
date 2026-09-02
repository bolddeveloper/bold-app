from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models

from .mixins import UUIDPrimaryKeyModel


# Define el manager encargado de crear usuarios y superusuarios de boldApp.
class UserManager(BaseUserManager):

    def create_user(self, email, name, password=None, **extra_fields):
        if not email:
            raise ValueError("El usuario debe tener un email valido.")

        email = self.normalize_email(email)
        user = self.model(email=email, name=name, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, name, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("El superusuario debe tener is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("El superusuario debe tener is_superuser=True.")

        return self.create_user(email, name, password, **extra_fields)


# Define la tabla USERS del diagrama, usada como AUTH_USER_MODEL del proyecto.
# Los usuarios normales nunca reciben is_staff=True: el panel de administracion
# de Django queda reservado a un unico superusuario creado manualmente via
# `createsuperuser`; cualquier panel de cara al usuario se construye dentro
# de la propia app boldApp, no a traves del admin.
class User(UUIDPrimaryKeyModel, AbstractBaseUser, PermissionsMixin):
    name = models.CharField(max_length=120)
    email = models.EmailField(max_length=180, unique=True)
    password = models.CharField(max_length=255, db_column="password_hash")
    avatar_url = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.email
