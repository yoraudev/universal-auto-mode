import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toRequest } from '../adapters/opencode2/request.js';

const cwd = '/work';
const kind = (action, resources = ['*'], metadata) => toRequest({ action, resources, metadata }, cwd).kind;

test('built-in actions map to their kinds', () => {
  assert.deepEqual(toRequest({ action: 'shell', resources: ['git status'] }, cwd), { kind: 'shell', command: 'git status', cwd });
  assert.deepEqual(toRequest({ action: 'read', resources: ['src/a.js'] }, cwd), { kind: 'read', paths: ['src/a.js'], cwd });
  assert.equal(kind('grep'), 'read');
  assert.equal(kind('glob'), 'read');
  assert.equal(kind('edit', ['src/a.js']), 'write');
  assert.equal(kind('webfetch'), 'network');
  assert.equal(kind('websearch'), 'network');
  assert.equal(kind('question'), 'none');
});

test('MCP tools are never mapped by what their name contains', () => {
  for (const action of ['testpage_read_page', 'universal-browser-control_tabs_list', 'universal-browser-control_evaluate_js', 'files_delete_all', 'mail_search_and_send', 'opencode_list_mcp_resources', 'subagent', 'external_directory'])
    assert.equal(kind(action), 'other', action);
});
