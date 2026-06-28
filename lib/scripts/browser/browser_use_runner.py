#!/usr/bin/env python3
"""NapCat browser-use runner — 由 Node 传入 JSON 配置路径后执行。"""
import asyncio
import json
import sys
import traceback


def build_llm(llm):
    provider = (llm.get('provider') or 'openai').lower()
    model = llm.get('model') or 'gpt-4o-mini'
    api_key = llm.get('api_key') or ''
    api_url = (llm.get('api_url') or '').strip()
    base_url = api_url
    if base_url.endswith('/chat/completions'):
        base_url = base_url[: -len('/chat/completions')]
    base_url = base_url.rstrip('/')

    try:
        from browser_use import ChatOpenAI, ChatAnthropic, ChatGoogle
    except ImportError:
        from browser_use.llm import ChatOpenAI, ChatAnthropic, ChatGoogle  # type: ignore

    if provider in ('anthropic', 'claude'):
        return ChatAnthropic(model=model, api_key=api_key)
    if provider in ('google', 'gemini'):
        return ChatGoogle(model=model, api_key=api_key)

    kwargs = {'model': model, 'api_key': api_key}
    if base_url:
        kwargs['base_url'] = base_url
    return ChatOpenAI(**kwargs)


def cookies_to_storage(cookies):
    out = []
    for c in cookies or []:
        name = c.get('name')
        domain = c.get('domain')
        if not name or not domain:
            continue
        item = {
            'name': name,
            'value': c.get('value', ''),
            'domain': domain,
            'path': c.get('path') or '/',
        }
        if c.get('expires'):
            try:
                item['expires'] = int(c['expires'])
            except (TypeError, ValueError):
                pass
        if c.get('secure') is not None:
            item['secure'] = bool(c['secure'])
        if c.get('httpOnly') is not None:
            item['httpOnly'] = bool(c['httpOnly'])
        if c.get('sameSite'):
            item['sameSite'] = c['sameSite']
        out.append(item)
    return {'cookies': out, 'origins': []}


async def run_agent(cfg):
    from browser_use import Agent, Browser

    llm = build_llm(cfg.get('llm') or {})
    headless = bool(cfg.get('headless', False))
    max_steps = int(cfg.get('max_steps') or 30)
    task = (cfg.get('task') or '').strip()
    url = (cfg.get('url') or '').strip()
    mode = cfg.get('mode') or 'task'

    if mode == 'snapshot' and url:
        task = task or (
            f'Navigate to {url}, read the visible page content, '
            'then return the page title and a concise Chinese summary of the main text.'
        )
    elif mode == 'act' and url:
        action = (cfg.get('action') or 'click').lower()
        selector = (cfg.get('selector') or '').strip()
        text = (cfg.get('text') or '').strip()
        if action in ('fill', 'type'):
            task = (
                f'Go to {url}, find the input element matching CSS selector "{selector}", '
                f'fill it with: {text!r}. Then summarize what happened.'
            )
        elif action == 'press':
            task = (
                f'Go to {url}, focus element "{selector}" and press key {text!r}. '
                'Then summarize the page state.'
            )
        else:
            task = (
                f'Go to {url}, click the element matching CSS selector "{selector}". '
                'Then summarize the page state.'
            )
    elif url and url not in task:
        task = f'First open {url}. Then: {task}'

    if not task:
        raise ValueError('task 不能为空')

    browser_kwargs = {'headless': headless}
    storage = cookies_to_storage(cfg.get('cookies'))
    if storage['cookies']:
        browser_kwargs['storage_state'] = storage

    browser = Browser(**browser_kwargs)
    agent = Agent(task=task, llm=llm, browser=browser)
    history = await agent.run(max_steps=max_steps)

    output = ''
    if hasattr(history, 'final_result'):
        try:
            output = history.final_result() or ''
        except Exception:
            output = str(history.final_result)
    elif hasattr(history, 'extracted_content'):
        try:
            output = str(history.extracted_content() or '')
        except Exception:
            output = str(history)
    else:
        output = str(history)

    try:
        if hasattr(browser, 'kill'):
            await browser.kill()
        elif hasattr(browser, 'close'):
            await browser.close()
    except Exception:
        pass

    return {'ok': True, 'output': output}


async def main():
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': 'missing config path'}, ensure_ascii=False))
        sys.exit(1)
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    try:
        result = await run_agent(cfg)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            'ok': False,
            'error': str(e),
            'trace': traceback.format_exc()
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
