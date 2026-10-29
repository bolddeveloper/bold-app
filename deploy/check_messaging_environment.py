"""Read-only Docker Compose interpolation check; never starts a container.

Uses the checked-in example, not the server's .env. Captured Compose output is
not printed, including errors, because configuration can contain credentials.
This is not a distributed worker acceptance or a deployment command.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parent


def example_settings():
    values=dict(line.split('=',1) for line in (ROOT/'oracle/.env.oracle.example').read_text(encoding='utf-8').splitlines()
        if line and not line.startswith('#') and '=' in line)
    return {name:value for name,value in values.items() if name.startswith('MESSAGING_')}


def render_contract():
    expected=example_settings()
    # Compose needs PATH/platform paths to locate its plugin, not the caller's
    # database URL, cloud credentials, COMPOSE_FILE or production overrides.
    base={name:value for name,value in os.environ.items() if name.upper() in {
        'PATH','SYSTEMROOT','WINDIR','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOME'}}
    customized={name:str(1000+index) for index,name in enumerate(expected)
        if name not in {'MESSAGING_AUTOMATIONS_ENABLED','MESSAGING_PILOT_ENABLED','MESSAGING_PILOT_UNIT_IDS'}}
    customized.update(MESSAGING_AUTOMATIONS_ENABLED='true',MESSAGING_PILOT_ENABLED='true',
        MESSAGING_PILOT_UNIT_IDS='11111111-2222-4333-8444-555555555551')
    command=['docker','compose','--env-file',str(ROOT/'oracle/.env.oracle.example'),
        '-f',str(ROOT/'oracle/compose.oracle.yaml'),'config','--format','json']
    for overrides in ({},customized):
        try:
            result=subprocess.run(command,cwd=ROOT,env={**base,**overrides},capture_output=True,text=True,timeout=45,check=False)
        except FileNotFoundError:
            raise RuntimeError('Docker Compose no está disponible. No se inició ningún servicio.') from None
        except subprocess.TimeoutExpired:
            raise RuntimeError('La lectura de Compose agotó su espera. No se inició ningún servicio.') from None
        if result.returncode:
            raise RuntimeError('Compose no pudo validar el ejemplo. Su salida se conserva privada; no se inició ningún servicio.')
        try:
            services=json.loads(result.stdout)['services']
            for service in ('backend','worker'):
                environment=services[service]['environment']
                for name,value in {**expected,**overrides}.items():
                    if environment.get(name)!=value:
                        raise RuntimeError('La configuración de mensajería no coincide entre el ejemplo y '+service+'.')
                if environment.get('CELERY_TASK_ALWAYS_EAGER')!='false':
                    raise RuntimeError('El worker distribuido no debe ejecutar tareas eager.')
        except (KeyError,TypeError,ValueError):
            raise RuntimeError('Compose devolvió una estructura inesperada. No se inició ningún servicio.') from None
    return {'compose_interpolation_cases_passed':2,'http_and_worker_same_messaging_environment':True,
        'production_env_read':False,'containers_started':False,'distributed_runtime_verified':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render',action='store_true',required=True,help='Leer dos configuraciones con Docker Compose; no ejecutar up/build/down.')
    parser.parse_args()
    try:
        print(json.dumps(render_contract(),ensure_ascii=False));return 0
    except RuntimeError as error:
        print(str(error),file=sys.stderr);return 2


if __name__=='__main__':
    raise SystemExit(main())
