import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS} from '../server/server.mjs';

test('Home is the same supported global and thread entrypoint',()=>{
  const home=TOOLS.find(t=>t.name==='paper_home');
  assert.deepEqual(home._meta['openai/ui'].entrypoints,[{type:'global'},{type:'thread'}]);
  assert.equal(home._meta.ui.resourceUri,home._meta['openai/outputTemplate']);
  assert.deepEqual(home.inputSchema.required,[]);
});
