/** Body válido: mapea los obligatorios y usa las tres reglas. */
export function rulesetBody() {
  return {
    mapping: [
      { attribute: 'title', column: 'Nombre' },
      { attribute: 'description', column: 'Descripción' },
      { attribute: 'link', column: 'URL' },
      { attribute: 'image_link', column: 'Imagen' },
      { attribute: 'price', column: 'Precio' },
      { attribute: 'availability', column: 'Stock' },
      { attribute: 'brand', column: 'Marca' },
    ],
    rules: [
      { type: 'clean_text', attributes: ['title', 'brand'] },
      { type: 'build_title', template: '{brand} {title}' },
      {
        type: 'exclude_when',
        attribute: 'id',
        operator: 'equals',
        value: 'X1',
      },
      { type: 'exclude_when', attribute: 'brand', operator: 'is_empty' },
    ],
  };
}

/** Body con las reglas dadas y el mapeo válido de `rulesetBody`. */
export function bodyWithRules(rules: unknown) {
  return { ...rulesetBody(), rules };
}
