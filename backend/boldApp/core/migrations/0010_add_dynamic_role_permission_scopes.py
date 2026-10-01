from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0009_permission_bulk_assignment")]

    operations = [
        migrations.AlterField(
            model_name="jobrolepermission",
            name="scope_type",
            field=models.CharField(
                choices=[
                    ("global", "Global"),
                    ("own_unit", "Unidad propia"),
                    ("own_sub_tree", "Unidad propia y subárbol"),
                    ("created_by_me", "Recursos creados por mí"),
                    ("sub_tree", "Unidad específica y subárbol"),
                    ("specific_unit", "Unidad específica"),
                ],
                max_length=30,
            ),
        ),
        migrations.RemoveConstraint(
            model_name="jobrolepermission",
            name="job_role_permission_valid_scope",
        ),
        migrations.RemoveConstraint(
            model_name="jobrolepermission",
            name="job_role_permission_scope_target_consistent",
        ),
        migrations.AddConstraint(
            model_name="jobrolepermission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    scope_type__in=[
                        "global", "own_unit", "own_sub_tree", "created_by_me",
                        "sub_tree", "specific_unit",
                    ]
                ),
                name="job_role_permission_valid_scope",
            ),
        ),
        migrations.AddConstraint(
            model_name="jobrolepermission",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(
                        scope_type__in=["global", "own_unit", "own_sub_tree", "created_by_me"],
                        target_unit__isnull=True,
                    )
                    | models.Q(
                        scope_type__in=["specific_unit", "sub_tree"],
                        target_unit__isnull=False,
                    )
                ),
                name="job_role_permission_scope_target_consistent",
            ),
        ),
    ]
