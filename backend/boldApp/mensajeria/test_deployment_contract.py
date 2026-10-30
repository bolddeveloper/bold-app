"""Source-level Compose contract, not a Redis/Celery runtime acceptance.

The focused reader deliberately accepts only the existing quoted environment
mapping. Docker's own `compose config` remains the syntax/interpolation gate.
No .env secrets, daemon, provider, database or production host are consulted.
"""
import ast
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase

ROOT=Path(__file__).resolve().parents[3]


def messaging_defaults():
    tree=ast.parse((ROOT/'backend/config/settings.py').read_text(encoding='utf-8'))
    result={}
    def number(node):
        if isinstance(node,ast.Constant) and type(node.value) is int:return node.value
        if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Mult):return number(node.left)*number(node.right)
        raise AssertionError('Review the capacity default expression explicitly.')
    for node in tree.body:
        if (isinstance(node,ast.Assign) and isinstance(node.value,ast.Call)
                and isinstance(node.value.func,ast.Name) and node.value.func.id=='_messaging_limit'):
            name=ast.literal_eval(node.value.args[0]);result[name]=number(node.value.args[1])
    return result


class DeploymentContractTests(SimpleTestCase):
    def test_web_push_configuration_reaches_both_services_without_enabling_it_by_default(self):
        compose=(ROOT/'deploy/oracle/compose.oracle.yaml').read_text(encoding='utf-8')
        shared=compose.split('x-backend-environment: &backend-environment\n',1)[1].split('\nx-backend-security:',1)[0]
        for name,default in {'WEB_PUSH_ENABLED':'false','WEB_PUSH_PUBLIC_KEY':'','WEB_PUSH_PRIVATE_KEY':'','WEB_PUSH_SUBJECT':'mailto:soporte@bold.gt'}.items():
            self.assertIn('  '+name+': "${'+name+':-'+default+'}"',shared)

    def renderer(self):
        spec=importlib.util.spec_from_file_location('messaging_environment_check',ROOT/'deploy/check_messaging_environment.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

    def test_every_messaging_budget_is_passed_to_the_shared_container_environment(self):
        compose=(ROOT/'deploy/oracle/compose.oracle.yaml').read_text(encoding='utf-8')
        shared=compose.split('x-backend-environment: &backend-environment\n',1)[1].split('\nx-backend-security:',1)[0]
        entries=re.findall(r'^  (MESSAGING_[A-Z_]+): "([^"\n]+)"$',shared,re.M)
        environment=dict(entries)
        self.assertEqual(len(entries),len(environment),'Duplicate environment keys require review.')
        example=dict(line.split('=',1) for line in (ROOT/'deploy/oracle/.env.oracle.example').read_text(encoding='utf-8').splitlines()
            if line and not line.startswith('#') and '=' in line)
        defaults=messaging_defaults();self.assertEqual(len(defaults),10)
        for name,default in defaults.items():
            with self.subTest(setting=name):
                self.assertEqual(environment.get(name),'${'+name+':-'+str(default)+'}')
                self.assertEqual(example.get(name),str(default))

    def test_api_and_worker_share_the_anchor_and_keep_automations_and_pilot_closed_by_default(self):
        compose=(ROOT/'deploy/oracle/compose.oracle.yaml').read_text(encoding='utf-8')
        self.assertIn('  MESSAGING_AUTOMATIONS_ENABLED: "${MESSAGING_AUTOMATIONS_ENABLED:-false}"',compose)
        self.assertIn('  MESSAGING_PILOT_ENABLED: "${MESSAGING_PILOT_ENABLED:-true}"',compose)
        self.assertIn('  MESSAGING_PILOT_UNIT_IDS: "${MESSAGING_PILOT_UNIT_IDS:-}"',compose)
        for service,next_service in [('backend','worker'),('worker','cloudflared')]:
            block=compose.split('\n  '+service+':\n',1)[1].split('\n  '+next_service+':\n',1)[0]
            self.assertIn('    environment: *backend-environment',block)
        self.assertIn('"worker", "-B"',compose)
        tree=ast.parse((ROOT/'backend/config/settings.py').read_text(encoding='utf-8'))
        schedule=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign)
            and any(isinstance(target,ast.Name) and target.id=='CELERY_BEAT_SCHEDULE' for target in node.targets))
        self.assertEqual(schedule['run-channel-automations'],{'task':'boldApp.mensajeria.automation_tasks.run_channel_automations','schedule':60.0})
        self.assertEqual(schedule['recover-media-uploads'],{'task':'boldApp.mensajeria.upload_tasks.drain_media_uploads','schedule':60.0})

    def test_read_only_renderer_never_inherits_production_overrides_or_starts_containers(self):
        module=self.renderer();seen=[]
        def run(command,**options):
            seen.append(options['env'])
            self.assertEqual(command[-3:],['config','--format','json'])
            self.assertNotIn('up',command);self.assertNotIn('build',command)
            self.assertNotIn('DATABASE_URL',options['env']);self.assertNotIn('COMPOSE_FILE',options['env'])
            self.assertNotIn('SECRET_KEY',options['env']);self.assertNotIn('DOCKER_HOST',options['env'])
            environment={**module.example_settings(),**{key:value for key,value in options['env'].items() if key.startswith('MESSAGING_')},
                'CELERY_TASK_ALWAYS_EAGER':'false'}
            return SimpleNamespace(returncode=0,stdout=json.dumps({'services':{name:{'environment':environment} for name in ('backend','worker')}}))
        with patch.dict(os.environ,{'PATH':'synthetic-path','DATABASE_URL':'never-copy','SECRET_KEY':'never-print',
                'COMPOSE_FILE':'production.yml','DOCKER_HOST':'remote-production','MESSAGING_AUTOMATIONS_ENABLED':'true'},clear=True),patch.object(module.subprocess,'run',side_effect=run):
            report=module.render_contract()
        self.assertEqual(len(seen),2);self.assertNotIn('MESSAGING_AUTOMATIONS_ENABLED',seen[0])
        self.assertEqual(seen[1]['MESSAGING_AUTOMATIONS_ENABLED'],'true')
        self.assertEqual(report['compose_interpolation_cases_passed'],2)
        self.assertFalse(report['containers_started']);self.assertFalse(report['distributed_runtime_verified'])

    def test_renderer_failure_is_closed_and_does_not_echo_captured_credentials(self):
        module=self.renderer()
        for effect in (FileNotFoundError(),subprocess.TimeoutExpired('docker',45),
                SimpleNamespace(returncode=1,stdout='sensitive-config',stderr='sensitive-config'),
                SimpleNamespace(returncode=0,stdout='sensitive-config')):
            with self.subTest(effect=type(effect).__name__),patch.object(module.subprocess,'run',
                    **({'side_effect':effect} if isinstance(effect,Exception) else {'return_value':effect})):
                with self.assertRaises(RuntimeError) as error:module.render_contract()
                self.assertNotIn('sensitive-config',str(error.exception))

    def test_renderer_rejects_a_missing_or_mismatched_worker_setting(self):
        module=self.renderer();environment={**module.example_settings(),'CELERY_TASK_ALWAYS_EAGER':'false'}
        for changed in ({},{'MESSAGING_AUTOMATIONS_ENABLED':'true'},{'CELERY_TASK_ALWAYS_EAGER':'true'}):
            worker={} if not changed else {**environment,**changed}
            output={'services':{'backend':{'environment':environment},'worker':{'environment':worker}}}
            with self.subTest(changed=changed),patch.object(module.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(output))):
                with self.assertRaises(RuntimeError):module.render_contract()
