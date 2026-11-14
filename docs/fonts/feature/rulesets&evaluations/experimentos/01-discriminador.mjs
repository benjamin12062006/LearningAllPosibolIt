// Experimento E2.0: ¿cómo se comporta el discriminador de class-transformer
// dentro del ValidationPipe real del proyecto? No es código de la feature.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const project = '/Users/benji/Documents/KSuT/LearningAllPosibolIt/';
const require = createRequire(project + 'package.json');
const load = async (name) => import(pathToFileURL(require.resolve(name)).href);

await load('reflect-metadata');
const { Type } = await load('class-transformer');
const cv = await load('class-validator');
const { ValidationPipe } = await load('@nestjs/common');

const { IsIn, IsString, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested, Length } = cv;
const deco = (decorators, target, key) => decorators.forEach((d) => d(target.prototype, key));

const RULE_TYPES = ['clean_text', 'build_title'];

class RuleDto {}
deco([IsIn(RULE_TYPES)], RuleDto, 'type');

class CleanTextRuleDto extends RuleDto {}
deco([IsArray(), ArrayMinSize(1), IsString({ each: true })], CleanTextRuleDto, 'attributes');

class BuildTitleRuleDto extends RuleDto {}
deco([IsString(), Length(1, 300)], BuildTitleRuleDto, 'template');

const subTypes = [
  { value: CleanTextRuleDto, name: 'clean_text' },
  { value: BuildTitleRuleDto, name: 'build_title' },
];

function makeBody(keep) {
  class Body {}
  deco(
    [
      IsArray(),
      ArrayMinSize(1),
      ArrayMaxSize(20),
      ValidateNested({ each: true }),
      Type(() => RuleDto, {
        discriminator: { property: 'type', subTypes },
        keepDiscriminatorProperty: keep,
      }),
    ],
    Body,
    'rules',
  );
  return Body;
}

// Mismas opciones que src/configure-http.ts (sin exceptionFactory propio).
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  validationError: { target: false, value: false },
  exceptionFactory: (errors) => ({ errors }),
});

const flatten = (errors, prefix = '') =>
  errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    const own = Object.keys(e.constraints ?? {}).map((c) => `${path}:${c}`);
    return [...own, ...flatten(e.children ?? [], path)];
  });

async function run(label, body, keep = true) {
  const metatype = makeBody(keep);
  try {
    const out = await pipe.transform(structuredClone(body), { type: 'body', metatype });
    const shapes = out.rules.map((r) => `${r.constructor.name}${JSON.stringify(r)}`);
    console.log(`OK    ${label}\n      ${shapes.join('\n      ')}`);
  } catch (thrown) {
    if (!thrown.errors) {
      console.log(`THROW ${label}\n      ${thrown.constructor.name}: ${thrown.message}`);
      return;
    }
    console.log(`ERROR ${label}\n      ${flatten(thrown.errors).join('\n      ')}`);
  }
}

const clean = { type: 'clean_text', attributes: ['title'] };
const title = { type: 'build_title', template: '{brand} {title}' };

await run('1 válido mixto, keep=true', { rules: [clean, title] });
await run('2 válido mixto, keep=false', { rules: [clean, title] }, false);
await run('3 type desconocido con campo extra', { rules: [{ type: 'foo', anything: 1 }] });
await run('4 type desconocido sin campos', { rules: [{ type: 'foo' }] });
await run('5 type ausente', { rules: [{ template: 'x' }] });
await run('6 campo de otra subclase', { rules: [{ ...clean, template: 'x' }] });
await run('7 subclase con campo inválido', { rules: [{ type: 'build_title', template: '' }] });
await run('8 elemento null', { rules: [null] });
await run('9 elemento string', { rules: ['clean_text'] });
await run('10 rules objeto, no arreglo', { rules: { 0: clean } });
await run('11 type no string (número)', { rules: [{ type: 1 }] });
await run('12 type "__proto__"', { rules: [JSON.parse('{"type":"__proto__"}')] });
await run('13 21 reglas', { rules: Array.from({ length: 21 }, () => clean) });
