export function chooseRandomCommand(view, random = Math.random) {
  if (!view.validCommands?.length) return null;

  if (view.phase === "AWAITING_DISCARD") {
    const discardCommand = view.validCommands.find(
      (command) => command.type === "DISCARD_RESOURCES",
    );
    const player = view.players.find((candidate) => candidate.id === view.viewerId);
    if (discardCommand && player?.resources) {
      return {
        type: "DISCARD_RESOURCES",
        resources: chooseDiscardResources(
          player.resources,
          discardCommand.required,
          random,
        ),
      };
    }
  }

  const bot = view.players?.find((player) => player.id === view.viewerId);
  const commands =
    bot?.isBot === true
      ? view.validCommands.filter((command) => command.type !== "CREATE_TRADE")
      : view.validCommands;
  if (commands.length === 0) return null;

  const index = Math.floor(random() * commands.length);
  return structuredClone(commands[index]);
}

function chooseDiscardResources(resources, required, random) {
  const remaining = { ...resources };
  const selected = Object.fromEntries(
    Object.keys(resources).map((resource) => [resource, 0]),
  );

  for (let count = 0; count < required; count += 1) {
    const available = Object.entries(remaining).filter(([, amount]) => amount > 0);
    if (available.length === 0) break;
    const [resource] = available[Math.floor(random() * available.length)];
    remaining[resource] -= 1;
    selected[resource] += 1;
  }

  return selected;
}
