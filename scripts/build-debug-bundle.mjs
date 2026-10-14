import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const entry = resolve(root, "debug/app.js");
const output = resolve(root, "debug/bundle.js");
const modules = new Map();

await collect(entry);

const sections = [];
for (const [id, module] of modules) {
  sections.push(
    `${JSON.stringify(id)}: function(module, exports, __require) {\n` +
      `${module.source}\n` +
      `${module.exports.map((name) => `exports[${JSON.stringify(name)}] = ${name};`).join("\n")}\n` +
      `}`,
  );
}

const bundle = `(function() {
  "use strict";
  const __modules = {
${sections.join(",\n")}
  };
  const __cache = {};
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    const module = { exports: {} };
    __cache[id] = module;
    __modules[id](module, module.exports, __require);
    return module.exports;
  }
  __require(${JSON.stringify(toId(entry))});
})();
`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, bundle, "utf8");
console.log(`Built ${relative(root, output)} with ${modules.size} modules.`);

async function collect(filePath) {
  const id = toId(filePath);
  if (modules.has(id)) return;

  let source = await readFile(filePath, "utf8");
  const dependencies = [];
  const exportNames = new Set();

  source = source.replace(
    /import\s+\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];?/g,
    (_match, specifiers, request) => {
      const dependencyPath = resolveImport(filePath, request);
      dependencies.push(dependencyPath);
      const bindings = specifiers
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => {
          const [imported, local = imported] = specifier.split(/\s+as\s+/);
          return `${imported}: ${local}`;
        })
        .join(", ");
      return `const { ${bindings} } = __require(${JSON.stringify(toId(dependencyPath))});`;
    },
  );

  source = source
    .replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, (_match, name) => {
      exportNames.add(name);
      return `const ${name} =`;
    })
    .replace(/export\s+function\s+([A-Za-z_$][\w$]*)\s*/g, (_match, name) => {
      exportNames.add(name);
      return `function ${name} `;
    })
    .replace(/export\s+class\s+([A-Za-z_$][\w$]*)\s*/g, (_match, name) => {
      exportNames.add(name);
      return `class ${name} `;
    })
    .replace(/export\s+\{([\s\S]*?)\};?/g, (_match, specifiers) => {
      for (const specifier of specifiers.split(",")) {
        const [local, exported = local] = specifier.trim().split(/\s+as\s+/);
        if (local) exportNames.add(exported || local);
      }
      return "";
    });

  modules.set(id, {
    source,
    exports: [...exportNames],
  });

  for (const dependency of dependencies) {
    await collect(dependency);
  }
}

function resolveImport(importer, request) {
  if (!request.startsWith(".")) {
    throw new Error(`Unsupported external import "${request}" in ${importer}`);
  }
  return resolve(dirname(importer), request);
}

function toId(filePath) {
  return relative(root, filePath).replaceAll("\\", "/");
}
