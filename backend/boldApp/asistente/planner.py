"""Codex interprets JSON only. It cannot call BOLD, approve or execute tools."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from django.conf import settings
from boldApp.mensajeria.support_codex import process_environment, SupportUnavailable


def generate(prompt):
    executable=shutil.which(settings.BOLD_SUPPORT_CODEX_BINARY)
    if not executable:raise SupportUnavailable('codex_missing')
    root=Path(__file__).resolve().parent
    config={'forced_login_method':'chatgpt','model_reasoning_effort':'none','model_verbosity':'low',
        'model_instructions_file':str(root/'instructions.md'),'project_doc_max_bytes':0,
        'web_search':'disabled','approval_policy':'never','history.persistence':'none'}
    for feature in ('shell_tool','apps','plugins','multi_agent','computer_use','browser_use','in_app_browser',
                    'image_generation','view_image','hooks','skill_search','code_mode','code_mode_host'):
        config['features.'+feature]=False
    config['features.skip_host_skill_discovery']=True
    command=[executable,'exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only',
        '--json','--model',settings.BOLD_SUPPORT_MODEL,'--output-schema',str(root/'schema.json')]
    for key,value in config.items():command.extend(['-c',key+'='+json.dumps(value)])
    command.append('-')
    try:
        with tempfile.TemporaryDirectory(prefix='bold-assistant-') as directory:
            response=subprocess.run(command,input=json.dumps(prompt,ensure_ascii=False,default=str),capture_output=True,
                text=True,encoding='utf-8',cwd=directory,env=process_environment(),timeout=90,
                creationflags=subprocess.CREATE_NO_WINDOW if __import__('os').name=='nt' else 0)
        if response.returncode:raise ValueError()
        text=None;usage=None;complete=False
        for line in response.stdout.splitlines():
            event=json.loads(line);item=event.get('item',{})
            if item.get('type') in ('command_execution','mcp_tool_call','web_search','file_change','collab_tool_call'):
                raise ValueError()
            if event.get('type')=='item.completed' and item.get('type')=='agent_message':text=item['text']
            if event.get('type')=='turn.completed':usage=event.get('usage',{});complete=True
        data=json.loads(text or '')
        if not complete or not isinstance(data,dict):raise ValueError()
        for collection in ('queries','steps'):
            for row in data.get(collection,[]):row['arguments']=json.loads(row.pop('arguments_json'))
        return data,usage
    except (ValueError,KeyError,TypeError,OSError,subprocess.TimeoutExpired):
        raise SupportUnavailable('codex_invalid_or_interrupted') from None
