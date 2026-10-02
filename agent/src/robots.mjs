// robots.txt: se il sito chiede di non leggere una pagina, non la leggiamo.

/** Le regole che valgono per noi (gruppo "ConfrontoAutoBot" se c'è, altrimenti "*"). */
export function parseRobots(text, agentName = 'confrontoautobot') {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) {
      continue;
    }
    const [, field, value] = match;
    const key = field.toLowerCase();
    if (key === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current && (key === 'allow' || key === 'disallow')) {
      current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== '*' && agentName.includes(a)));
  return (ours ?? groups.find((g) => g.agents.includes('*')))?.rules ?? [];
}

function ruleToRegex(path) {
  const escaped = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + (escaped.endsWith('\\$') ? escaped.slice(0, -2) + '$' : escaped));
}

/** Vince la regola più lunga che corrisponde; a parità vince "allow". */
export function isAllowed(rules, pathWithQuery) {
  let best = null;
  for (const rule of rules) {
    if (rule.path === '') {
      continue; // "Disallow:" vuoto = tutto permesso
    }
    if (ruleToRegex(rule.path).test(pathWithQuery)) {
      if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
        best = rule;
      }
    }
  }
  return !best || best.allow;
}
