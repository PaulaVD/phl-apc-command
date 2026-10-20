import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('drizzle/0000_graceful_gwen_stacy.sql','utf8'));
globalThis.testEnv = {
 DB: {
  prepare(sql) {
   return { bind(...args) {
    const stmt = sqlite.prepare(sql);
    return {
     async first() { return stmt.get(...args) || null; },
     async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; }
    };
   }};
  }
 }
};
globalThis.testSeed=JSON.parse(fs.readFileSync('lib/seed.json','utf8'));
const compile=(s)=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
fs.writeFileSync('tests/.model-test.mjs',compile(fs.readFileSync('lib/model.ts','utf8')));
let src=fs.readFileSync('app/api/workspace/route.ts','utf8').replace("import { env } from 'cloudflare:workers';","const env=globalThis.testEnv;").replace("'@/lib/model'","'./.model-test.mjs'").replace("import seed from '@/lib/seed.json';","const seed=globalThis.testSeed;");fs.writeFileSync('tests/.route-test.mjs',compile(src));
const {GET,PUT}=await import('./.route-test.mjs');
const req=(id,body,origin='https://test.local')=>new Request('https://test.local/api/workspace',{method:body?'PUT':'GET',headers:{...(id?{'oai-authenticated-user-id':id}:{}),'content-type':'application/json',origin},...(body?{body:JSON.stringify(body)}:{})});
assert.equal((await GET(req(null))).status,401);
let initial=await (await GET(req('ownerA'))).json();assert.equal(initial.data.players.length,97);assert.equal(initial.revision,0);
const data=initial.data;data.players[0].notes='Saved note';assert.equal((await PUT(req('ownerA',{data,revision:0}))).status,200);
const loaded=await (await GET(req('ownerA'))).json();assert.equal(loaded.data.players[0].notes,'Saved note');assert.equal(loaded.revision,1);
assert.equal((await PUT(req('ownerA',{data,revision:0}))).status,409);
assert.equal((await PUT(req('ownerA',{data,revision:1},'https://other.local'))).status,403);
assert.equal((await PUT(req('ownerA',{data:{bad:true},revision:1}))).status,400);
const other=await (await GET(req('ownerB'))).json();assert.equal(other.data.players[0].notes,'');
assert.equal((await PUT(req('ownerA',{data,revision:1}))).status,200);
assert.equal((await PUT(req(null,{data,revision:0}))).status,401);
fs.unlinkSync('tests/.model-test.mjs');fs.unlinkSync('tests/.route-test.mjs');sqlite.close();console.log('PASS: SQL migration, persisted round trip, owner isolation, missing auth, stale-write conflict, origin check and invalid data.');
