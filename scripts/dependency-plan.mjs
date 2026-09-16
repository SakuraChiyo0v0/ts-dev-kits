import semver from "semver";

export function resolveWorkspace(spec, version) {
  if (!spec.startsWith("workspace:")) return spec;
  const range = spec.slice(10);
  if (!version) throw new Error(`找不到 workspace 依赖: ${spec}`);
  if (range === "*") return version;
  if (range === "^" || range === "~") return `${range}${version}`;
  if (!semver.validRange(range)) throw new Error(`不支持的 workspace 范围: ${spec}`);
  return range;
}

export function checkDependencyPlan(manifests, registry) {
  const local = new Map(manifests.map(m => [m.name, m]));
  const pending = new Map();
  const roots = manifests.map(m => {
    const published = registry.manifest(m.name, m.version);
    if (published) return published; // 已发布版本必须读 registry，而非本地假想依赖。
    const deps = {};
    for (const [name, spec] of Object.entries({ ...m.dependencies, ...m.optionalDependencies })) {
      deps[name] = resolveWorkspace(spec, local.get(name)?.version);
    }
    const planned = { ...m, dependencies: deps, optionalDependencies: {} };
    pending.set(m.name, planned);
    return planned;
  });
  const order = manifests.map(m => m.name);
  const checked = new Set();
  function visit(manifest) {
    const key = `${manifest.name}@${manifest.version}`;
    if (checked.has(key)) return;
    checked.add(key);
    for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      if (!name.startsWith("@sakurachiyo0v0/")) continue;
      if (!semver.validRange(range)) throw new Error(`${key}: 非法依赖范围 ${name}@${range}`);
      const planned = pending.get(name);
      const canUsePlanned = planned && semver.satisfies(planned.version, range)
        && order.indexOf(name) < order.indexOf(manifest.name);
      const versions = registry.versions(name);
      const version = semver.maxSatisfying([...versions, ...(canUsePlanned ? [planned.version] : [])], range);
      if (!version) throw new Error(`${key}: ${name}@${range} 无已发布匹配版本或先行发布计划`);
      if (canUsePlanned && version === planned.version) { visit(planned); continue; }
      const remote = registry.manifest(name, version);
      if (!remote) throw new Error(`${name}@${version}: registry 元数据不一致`);
      visit(remote);
    }
  }
  roots.forEach(visit);
  return { checked: checked.size, pending: [...pending.values()].map(m => `${m.name}@${m.version}`) };
}
