// Alternativa: @Transform elige la subclase a mano; los no-objetos pasan tal cual.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const project = '/Users/benji/Documents/KSuT/LearningAllPosibolIt/';
const require = createRequire(project + 'package.json');
const load = async (n) => import(pathToFileURL(require.resolve(n)).href);
await load('reflect-metadata');
const { Transform, plainToInstance } = await load('class-transformer');
const cv = await load('class-validator');
const { ValidationPipe } = await load('@nestjs/common');
const { IsIn, IsString, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested, Length, IsObject } = cv;
const deco = (ds, t, k) => ds.forEach((d) => d(t.prototype, k));

class RuleDto {}
deco([IsIn(['clean_text', 'build_title'])], RuleDto, 'type');
class CleanTextRuleDto extends RuleDto {}
deco([IsArray(), ArrayMinSize(1), IsString({ each: true })], CleanTextRuleDto, 'attributes');
class BuildTitleRuleDto extends RuleDto {}
deco([IsString(), Length(1, 300)], BuildTitleRuleDto, 'template');
const RULE_CLASSES = new Map([['clean_text', CleanTextRuleDto], ['build_title', BuildTitleRuleDto]]);

const toRule = (item) => {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
  const cls = RULE_CLASSES.get(item.type) ?? RuleDto;
  return plainToInstance(cls, item);
};

class Body {}
deco([
  IsArray(), ArrayMinSize(1), ArrayMaxSize(20),
  IsObject({ each: true }),
  ValidateNested({ each: true }),
  Transform(({ obj }) => (Array.isArray(obj.rules) ? obj.rules.map(toRule) : obj.rules), { toClassOnly: true }),
], Body, 'rules');

const pipe = new ValidationPipe({
  transform: true, whitelist: true, forbidNonWhitelisted: true,
  validationError: { target: false, value: false },
  exceptionFactory: (errors) => ({ errors }),
});
const flatten = (es, pre = '') => es.flatMap((e) => {
  const p = pre ? `${pre}.${e.property}` : e.property;
  return [...Object.keys(e.constraints ?? {}).map((c) => `${p}:${c}`), ...flatten(e.children ?? [], p)];
});
async function run(label, body) {
  try {
    const out = await pipe.transform(structuredClone(body), { type: 'body', metatype: Body });
    console.log(`OK    ${label}\n      ${out.rules.map((r) => r.constructor.name + JSON.stringify(r)).join('\n      ')}`);
  } catch (t) {
    if (!t.errors) return console.log(`THROW ${label}\n      ${t.constructor.name}: ${t.message}`);
    console.log(`ERROR ${label}\n      ${flatten(t.errors).join('\n      ')}`);
  }
}
const clean = { type: 'clean_text', attributes: ['title'] };
const title = { type: 'build_title', template: '{brand} {title}' };
await run('1 válido mixto', { rules: [clean, title] });
await run('3 type desconocido con campo extra', { rules: [{ type: 'foo', anything: 1 }] });
await run('5 type ausente', { rules: [{ template: 'x' }] });
await run('6 campo de otra subclase', { rules: [{ ...clean, template: 'x' }] });
await run('7 subclase con campo inválido', { rules: [{ type: 'build_title', template: '' }] });
await run('8 elemento null', { rules: [null] });
await run('9 elemento string', { rules: ['clean_text'] });
await run('9b elemento arreglo', { rules: [[clean]] });
await run('10 rules objeto', { rules: { 0: clean } });
await run('12 type "__proto__"', { rules: [JSON.parse('{"type":"__proto__"}')] });
await run('12b type "constructor"', { rules: [{ type: 'constructor' }] });
await run('13 21 reglas', { rules: Array.from({ length: 21 }, () => clean) });
await run('14 rules ausente', {});
