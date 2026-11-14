import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire('/Users/benji/Documents/KSuT/LearningAllPosibolIt/package.json');
const load = async (n) => import(pathToFileURL(require.resolve(n)).href);
await load('reflect-metadata');
const { Type } = await load('class-transformer');
const { IsIn, IsString, IsArray, ValidateNested } = await load('class-validator');
const { ValidationPipe } = await load('@nestjs/common');
const deco = (ds, t, k) => ds.forEach((d) => d(t.prototype, k));
class MappingDto {}
deco([IsIn(['title', 'price'])], MappingDto, 'attribute');
deco([IsString()], MappingDto, 'column');
class Body {}
deco([IsArray(), ValidateNested({ each: true }), Type(() => MappingDto)], Body, 'mapping');
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true,
  validationError: { target: false, value: false }, exceptionFactory: (errors) => ({ errors }) });
const flat = (es, pre = '') => es.flatMap((e) => { const p = pre ? `${pre}.${e.property}` : e.property;
  return [...Object.keys(e.constraints ?? {}).map((c) => `${p}:${c}`), ...flat(e.children ?? [], p)]; });
for (const [label, body] of [['null', { mapping: [null] }], ['string', { mapping: ['x'] }],
  ['valid', { mapping: [{ attribute: 'title', column: 'Nombre' }] }]]) {
  try { const o = await pipe.transform(body, { type: 'body', metatype: Body });
    console.log('OK', label, o.mapping.map((m) => m.constructor.name)); }
  catch (t) { console.log(t.errors ? `ERROR ${label} ${flat(t.errors)}` : `THROW ${label} ${t.message}`); }
}
