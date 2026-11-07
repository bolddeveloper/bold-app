"""Text-only Codex calls billed to the signed-in ChatGPT account."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from django.conf import settings


class SupportUnavailable(Exception):
    pass


def process_environment():
    # The model client needs its own login, not Django, database or Google credentials.
    allowed = {'PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SYSTEMROOT','WINDIR',
               'USERNAME','USER','USERDOMAIN','TEMP','TMP','TMPDIR','LANG','LC_ALL','CODEX_HOME',
               'SSL_CERT_FILE','SSL_CERT_DIR','CODEX_CA_CERTIFICATE','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'}
    return {key:value for key,value in os.environ.items() if key.upper() in allowed}


def answer(prompt):
    executable = shutil.which(settings.BOLD_SUPPORT_CODEX_BINARY)
    if not executable:
        raise SupportUnavailable('codex_missing')
    files = Path(__file__).resolve().parent
    config = {
        'forced_login_method': 'chatgpt',
        'model_reasoning_effort': 'none',
        'model_verbosity': 'low',
        'model_instructions_file': str(files / 'support_instructions.md'),
        'project_doc_max_bytes': 0,
        'web_search': 'disabled',
        'approval_policy': 'never',
        'history.persistence': 'none',
    }
    # Channel text must never reach the person's computer, plugins or MCP tools.
    disabled = ('shell_tool', 'apps', 'plugins', 'multi_agent', 'computer_use',
                'browser_use', 'in_app_browser', 'image_generation', 'view_image',
                'hooks', 'skill_search', 'code_mode', 'code_mode_host')
    config.update({'features.' + feature: False for feature in disabled})
    config['features.skip_host_skill_discovery'] = True
    command = [executable, 'exec', '--ignore-user-config', '--ephemeral',
               '--skip-git-repo-check', '--sandbox', 'read-only', '--json',
               '--model', settings.BOLD_SUPPORT_MODEL,
               '--output-schema', str(files / 'support_schema.json')]
    for key, value in config.items():
        command.extend(['-c', key + '=' + json.dumps(value)])
    command.append('-')
    try:
        with tempfile.TemporaryDirectory(prefix='bold-support-') as directory:
            result = subprocess.run(command, input=prompt, text=True, encoding='utf-8',
                capture_output=True, cwd=directory, timeout=90,
                env=process_environment(),
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SupportUnavailable('codex_timeout_or_start') from error
    if result.returncode:
        # Provider diagnostics can contain private context; never send them to Slack.
        raise SupportUnavailable('codex_failed')
    text, usage, completed = None, {}, False
    try:
        for line in result.stdout.splitlines():
            event = json.loads(line)
            item = event.get('item', {})
            if item.get('type') in ('mcp_tool_call', 'command_execution', 'web_search', 'file_change', 'collab_tool_call'):
                raise ValueError('unexpected_tool')
            if event.get('type') == 'item.completed' and item.get('type') == 'agent_message':
                text = item['text']
            if event.get('type') == 'turn.completed':
                usage, completed = event.get('usage', {}), True
        data = json.loads(text or '{}')
        body = data.get('answer')
        if not completed or not isinstance(body, str) or not 1 <= len(body.strip()) <= 4000:
            raise ValueError('invalid_answer')
        return body.strip(), {
            key: max(0, int(usage.get(key, 0)))
            for key in ('input_tokens', 'cached_input_tokens', 'output_tokens')
        }
    except (ValueError, TypeError, KeyError) as error:
        raise SupportUnavailable('codex_invalid_result') from error
